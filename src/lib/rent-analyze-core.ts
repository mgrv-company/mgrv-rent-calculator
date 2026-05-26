/**
 * rent-analyze 순수 로직 — route.ts에서 추출
 *
 * HTTP/캐시/외부 API fetch 의존 없이 MolitTransaction[] 데이터를 받아
 * 비교물건 리스트 + 통계 + 트렌드를 산출하는 순수 함수.
 */

import type { MolitTransaction } from "./molit-parser";
import {
  SQM_PER_PYEONG,
  calcStats,
  percentile,
  parsePrice,
} from "./molit-parser";
import type { Coordinates } from "./geocoding";
import { haversineKm, buildingKey } from "./geocoding";
import {
  RENT_F8_JEONSE_RATE,
  calcRentTrend,
  calcConfidence,
  type RentTrend,
  type PricingConfidence,
} from "./rent-pricing";
import { MIN_COMPARABLES } from "./comparable-filter";
import { scoreSimilarity } from "./similarity-scoring";
import { removeOutliers, computePoolSigmas } from "./outlier-removal";

// ─── 상수 ─────────────────────────────────────────────────────────────────────

/** 타입별 평당단가 매칭 — 면적 허용 범위(평). 엑셀 `선별_피봇 C27 = 1` 권위 */
export const TYPE_AREA_TOLERANCE_PYEONG = 1;

/**
 * 환산보증금 → 평당 환산월세 — 엑셀 인근거래_RAW W/Y 권위.
 * 비교군 단가 산출과 F9 행 단위 재계산이 같은 공식을 쓰도록 SSOT.
 *
 * 반환값은 round 안 한 raw — 호출자가 sigma 계산엔 raw로, 표시엔 round로.
 */
export function computeStandardRent(
  deposit: number,
  monthlyRent: number,
  areaPyeong: number,
  jeonseRate: number,
): { standardRent: number; pricePerPyeong: number } {
  if (areaPyeong <= 0) return { standardRent: 0, pricePerPyeong: 0 };
  const convertedDeposit = deposit + (monthlyRent * 12) / jeonseRate;
  const standardRent = ((convertedDeposit * jeonseRate) / 12) * 10_000;
  const pricePerPyeong = standardRent / areaPyeong;
  return { standardRent, pricePerPyeong };
}

/** 타입별 평당단가 매칭 — 최소 건수. 미만이면 전체 클린 평균 fallback. 엑셀 `선별_피봇 C26 = 5` 권위 */
export const TYPE_MIN_MATCHES = 5;

// ─── 타입 ─────────────────────────────────────────────────────────────────────

export interface UnitTypeForAnalyze {
  name: string;
  netPyeong: number;
}

export interface RentAnalyzeConfig {
  targetAreaSqm: number;
  targetBuildYear?: number;
  siteLat?: number;
  siteLng?: number;
  coordMap?: Map<string, Coordinates>;
  targetUmdNm?: string; // 지오코딩 실패 시 동명 기반 폴백용
  jeonseRate?: number; // default 0.061 (엑셀 사업개요!C34)
  /** F6 유사도 최소 총점 (0~15). 기본 11. 미만 매물 제외 */
  minScore?: number;
  /** F7 아웃라이어 제거 σ 임계값. 기본 1.5. 0 이하면 제거 비활성화 */
  sigmaThreshold?: number;
  /** 타입별 평당단가 산출용 입력 (이름 + 전용평). 없으면 typesPerPyeong undefined */
  unitTypes?: UnitTypeForAnalyze[];
}

export interface ComparableBuilding {
  name: string;
  address: string;
  buildYear: number;
  areaSqm: number;
  areaPyeong: number;
  deposit: number; // 만원
  monthlyRent: number; // 만원
  standardRent: number; // 원 (표준 보증금 기준 환산 월세)
  pricePerPyeong: number; // 원/평
  distanceKm: number | null;
  score: number;
  /** 전체 풀 평당단가 평균에서 몇 σ 떨어졌는지. stddev=0 또는 산출 불가 시 null */
  sigma: number | null;
  matchedStep: number | null; // 개별 매칭 단계 (null = 거리 미확인 or 수동)
  dealDate: string;
  floor: string;
  contractTerm?: string; // 계약기간 (예: "25.10~26.10")
  /** 사용자 수동 제외 (F9 그리드 체크박스). default false */
  excluded?: boolean;
  /** 사용자 인라인 편집값 (만원). undefined = 미편집, 원본 deposit 사용 */
  overrideDeposit?: number;
  /** 사용자 인라인 편집값 (만원). undefined = 미편집, 원본 monthlyRent 사용 */
  overrideMonthlyRent?: number;
}

export interface RentAnalyzeResult {
  rawCount: number;
  monthlyCount: number;
  ltFilteredCount: number; // 월세 거래 중 계약기간 제외 없이 통과한 건수 (하위호환 필드명)
  depositFilteredCount: number; // 보증금 상한 제외 없이 통과한 건수 (하위호환 필드명)
  scoredCount: number;
  radiusUsedKm: number | null;
  geocodingFallback?: boolean;
  geocodingSource?: string;
  comparables: ComparableBuilding[];
  uniqueAddressCount: number; // 유니크 주소(동+지번) 수
  isInsufficient: boolean; // 유니크 10건 미달 여부
  stats: {
    perPyeong: {
      p75: number;
      median: number;
      mean: number;
      p25: number;
    };
  } | null;
  /**
   * 타입별 평당단가 (원/평) — 엑셀 `선별_피봇 D29~F31` 권위.
   * 각 타입 전용평 ±TYPE_AREA_TOLERANCE_PYEONG 범위의 클린 매물 평균.
   * TYPE_MIN_MATCHES 미만이면 stats.perPyeong.mean fallback.
   * config.unitTypes 미전달 시 undefined.
   */
  typesPerPyeong?: Record<string, number>;
  /** 타입별 매칭 건수 (디버깅·UI 표시용) */
  typeMatchCounts?: Record<string, number>;
  trend: RentTrend | null;
  confidence: PricingConfidence;
}

// ─── 내부 타입 ──────────────────────────────────────────────────────────────────

interface ScoredTx {
  tx: MolitTransaction;
  score: number;
  matchedStep: number | null;
  distanceKm: number | null;
}

interface EnrichedTx extends ScoredTx {
  standardRent: number;
  pricePerPyeong: number;
  areaPyeong: number;
}

// ─── 메인 함수 ──────────────────────────────────────────────────────────────────

/**
 * MOLIT 거래 데이터를 받아 비교물건 리스트 + 통계 + 트렌드를 산출.
 * route.ts의 Step 2~9에 해당하는 순수 로직.
 */
export function analyzeRentData(
  rawTransactions: MolitTransaction[],
  config: RentAnalyzeConfig,
): RentAnalyzeResult {
  const {
    targetAreaSqm,
    siteLat,
    siteLng,
    coordMap = new Map(),
    targetUmdNm,
    jeonseRate = RENT_F8_JEONSE_RATE,
    /** 엑셀 `필터기준설정!C13 = 11` */
    minScore = 11,
    /** 라이브러리 default = 0 (제거 비활성). 정책 default(PRD §F7 = 1.5)는 호출자에서 명시 */
    sigmaThreshold = 0,
  } = config;

  const rawCount = rawTransactions.length;

  // Step 2: 월세 거래만 필터
  const monthlyOnly = rawTransactions.filter(
    (tx) => parsePrice(tx.monthlyRent) > 0,
  );
  const monthlyCount = monthlyOnly.length;

  if (monthlyCount === 0) {
    return {
      rawCount,
      monthlyCount: 0,
      ltFilteredCount: 0,
      depositFilteredCount: 0,
      scoredCount: 0,
      radiusUsedKm: null,
      comparables: [],
      uniqueAddressCount: 0,
      isInsufficient: true,
      stats: null,
      trend: null,
      confidence: calcConfidence(null, 0),
    };
  }

  // 엑셀 SSOT: 계약기간 컬럼은 보존하지만 6개월 미만 자동 제외 조건은 없다.
  const ltFiltered = monthlyOnly;
  const ltFilteredCount = ltFiltered.length;

  // 엑셀 SSOT: 보증금 상한 필터 없이 환산보증금 공식으로 처리한다.
  const depositFiltered = ltFiltered;
  const depositFilteredCount = depositFiltered.length;

  // Step 3.5: 경로 분기 + 거리 계산
  let geocodingFallback = false;
  let geocodingSource: string | undefined;

  // 좌표 기반 vs 동명 폴백 경로 결정
  let txForProcessing = depositFiltered;
  if (siteLat && siteLng && coordMap.size > 0) {
    geocodingSource = "coords";
  } else if (targetUmdNm) {
    txForProcessing = depositFiltered.filter((tx) => tx.umdNm === targetUmdNm);
    geocodingFallback = true;
    geocodingSource = "umdNm-fallback";
  }

  // Step 4: 엑셀 F6 유사도 점수 산출
  const targetAreaPyeong = targetAreaSqm / SQM_PER_PYEONG;

  const filterables = txForProcessing.map((tx) => {
    const bKey = buildingKey(tx);
    const buildingCoords = coordMap.get(bKey);
    let distanceKm: number | null = null;
    if (buildingCoords && siteLat && siteLng) {
      distanceKm = haversineKm(
        siteLat,
        siteLng,
        buildingCoords.lat,
        buildingCoords.lng,
      );
    }

    const areaPyeong = parseFloat(tx.excluUseAr) / SQM_PER_PYEONG;
    const buildYear = parseInt(tx.buildYear, 10) || null;

    const addressKey = `${tx.umdNm}|${tx.jibun}`;
    return { tx, distanceKm, areaPyeong, buildYear, addressKey };
  });

  // 좌표 경로에서 distanceKm=null인 매물 제외 (좌표 매핑 안 된 건물)
  let filterable =
    geocodingSource === "coords"
      ? filterables.filter((item) => item.distanceKm !== null)
      : filterables;

  // 좌표 전부 실패 시 동명 폴백으로 자동 전환
  if (geocodingSource === "coords" && filterable.length === 0 && targetUmdNm) {
    filterable = filterables;
    geocodingFallback = true;
    geocodingSource = "umdNm-fallback";
  }

  const scored: ScoredTx[] = filterable
    .map((item) => {
      const sim = scoreSimilarity(
        {
          areaPyeong: targetAreaPyeong,
          buildYear: config.targetBuildYear ?? null,
        },
        {
          areaPyeong: item.areaPyeong,
          buildYear: item.buildYear,
          distanceKm: item.distanceKm,
        },
      );
      return {
        tx: item.tx,
        score: sim.total,
        matchedStep: null,
        distanceKm: item.distanceKm,
      };
    })
    .filter((item) => item.score >= minScore);

  // Step 4.6: 점수순 → 거리순 정렬
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.distanceKm === null && b.distanceKm === null) return 0;
    if (a.distanceKm === null) return 1;
    if (b.distanceKm === null) return -1;
    return a.distanceKm - b.distanceKm;
  });

  // Step 5: 환산보증금 → 평당 환산월세
  // 엑셀 `인근거래_RAW!W/Y`: 보증금 + 월세*12/전환율을 다시 월세화한다.
  // 대상/표준 보증금 차감은 비교군 단가가 아니라 F8 최종 임대료 공식에서만 한다.
  const enrichedRaw: EnrichedTx[] = scored
    .map((item) => {
      const deposit = parsePrice(item.tx.deposit);
      const rent = parsePrice(item.tx.monthlyRent);
      const areaSqm = parseFloat(item.tx.excluUseAr) || 0;
      if (areaSqm <= 0) return null;

      const areaPyeong = areaSqm / SQM_PER_PYEONG;
      const { standardRent, pricePerPyeong } = computeStandardRent(
        deposit,
        rent,
        areaPyeong,
        jeonseRate,
      );

      return { ...item, standardRent, pricePerPyeong, areaPyeong };
    })
    .filter((v): v is EnrichedTx => v !== null && v.pricePerPyeong > 0);

  // Step 5.5: F7 아웃라이어 제거 — 전체 풀 ±sigmaσ (엑셀 `선별_피봇 B11~H15` 권위)
  const enriched: EnrichedTx[] =
    sigmaThreshold > 0
      ? removeOutliers(enrichedRaw, (e) => e.pricePerPyeong, sigmaThreshold)
      : enrichedRaw;

  // Step 5.7: σ 거리 계산 (F9 표시용) — 전체 풀 평균/stddev 기반
  const sigmaResults = computePoolSigmas(enriched, (e) => e.pricePerPyeong);

  // Step 6: 비교물건 리스트 생성
  const comparables: ComparableBuilding[] = enriched.map((e, i) => ({
    name: e.tx.offiNm || "(이름없음)",
    address: `${e.tx.umdNm} ${e.tx.jibun}`.trim(),
    buildYear: parseInt(e.tx.buildYear, 10) || 0,
    areaSqm: parseFloat(e.tx.excluUseAr) || 0,
    areaPyeong: Math.round(e.areaPyeong * 100) / 100,
    deposit: parsePrice(e.tx.deposit),
    monthlyRent: parsePrice(e.tx.monthlyRent),
    standardRent: Math.round(e.standardRent),
    pricePerPyeong: Math.round(e.pricePerPyeong),
    distanceKm:
      e.distanceKm !== null ? Math.round(e.distanceKm * 1000) / 1000 : null,
    score: e.score,
    sigma: sigmaResults[i]?.sigma ?? null,
    matchedStep: e.matchedStep ?? null,
    dealDate: `${e.tx.dealYear}-${String(e.tx.dealMonth).padStart(2, "0")}-${String(e.tx.dealDay).padStart(2, "0")}`,
    floor: e.tx.floor,
    contractTerm: e.tx.contractTerm || undefined,
  }));

  // 결정적 정렬: 점수 → 거리 → 거래일 → 건물명 → 면적
  comparables.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (
      a.distanceKm !== null &&
      b.distanceKm !== null &&
      a.distanceKm !== b.distanceKm
    )
      return a.distanceKm - b.distanceKm;
    const dateComp = a.dealDate.localeCompare(b.dealDate);
    if (dateComp !== 0) return dateComp;
    const nameComp = a.name.localeCompare(b.name);
    if (nameComp !== 0) return nameComp;
    return a.areaPyeong - b.areaPyeong;
  });

  // Step 7: 평당 단가 통계 — comparables와 동일 모집단 사용
  if (enriched.length === 0) {
    return {
      rawCount,
      monthlyCount,
      ltFilteredCount,
      depositFilteredCount,
      scoredCount: scored.length,
      radiusUsedKm: null,
      geocodingFallback: geocodingFallback || undefined,
      geocodingSource,
      comparables: [],
      uniqueAddressCount: 0,
      isInsufficient: true,
      stats: null,
      trend: null,
      confidence: calcConfidence(null, 0),
    };
  }

  const sortedPrices = enriched
    .map((e) => e.pricePerPyeong)
    .sort((a, b) => a - b);
  const perPyeongStats = {
    p75: Math.round(percentile(sortedPrices, 75)),
    median: Math.round(percentile(sortedPrices, 50)),
    mean: Math.round(calcStats(sortedPrices).mean),
    p25: Math.round(percentile(sortedPrices, 25)),
  };

  // Step 7.5: 타입별 평당단가 (엑셀 `선별_피봇 D29~F31` 권위)
  // 각 타입 전용평 ±TYPE_AREA_TOLERANCE_PYEONG 범위 매물 평균.
  // TYPE_MIN_MATCHES 미만이면 stats.perPyeong.mean fallback.
  let typesPerPyeong: Record<string, number> | undefined;
  let typeMatchCounts: Record<string, number> | undefined;
  if (config.unitTypes && config.unitTypes.length > 0) {
    typesPerPyeong = {};
    typeMatchCounts = {};
    for (const t of config.unitTypes) {
      const matched = enriched.filter(
        (e) =>
          Math.abs(e.areaPyeong - t.netPyeong) <= TYPE_AREA_TOLERANCE_PYEONG,
      );
      typeMatchCounts[t.name] = matched.length;
      if (matched.length >= TYPE_MIN_MATCHES) {
        const sum = matched.reduce((s, e) => s + e.pricePerPyeong, 0);
        typesPerPyeong[t.name] = Math.round(sum / matched.length);
      } else {
        typesPerPyeong[t.name] = perPyeongStats.mean;
      }
    }
  }

  // Step 8: 시세 트렌드
  const trendInput = enriched.map((e) => ({
    dealYear: e.tx.dealYear,
    dealMonth: e.tx.dealMonth,
    pricePerPyeong: e.pricePerPyeong,
  }));
  const trend = calcRentTrend(trendInput);

  // Step 9: 신뢰도 등급 — 유니크 주소 수 기준
  const finalUniqueAddressCount = new Set(comparables.map((c) => c.address))
    .size;
  const confidence = calcConfidence(null, finalUniqueAddressCount);

  return {
    rawCount,
    monthlyCount,
    ltFilteredCount,
    depositFilteredCount,
    scoredCount: scored.length,
    radiusUsedKm: null,
    geocodingFallback: geocodingFallback || undefined,
    geocodingSource,
    comparables,
    uniqueAddressCount: finalUniqueAddressCount,
    isInsufficient: finalUniqueAddressCount < MIN_COMPARABLES,
    stats: { perPyeong: perPyeongStats },
    typesPerPyeong,
    typeMatchCounts,
    trend,
    confidence,
  };
}
