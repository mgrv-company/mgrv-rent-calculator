import { NextRequest, NextResponse } from "next/server";
import { hasApiKey, parsePrice } from "@/lib/molit-parser";
import type { Coordinates } from "@/lib/geocoding";
import { geocodeBuilding, geocodeUniqueBuildings } from "@/lib/geocoding";
import {
  analyzeRentData,
  type ComparableBuilding,
} from "@/lib/rent-analyze-core";
export type { ComparableBuilding } from "@/lib/rent-analyze-core";
import { fetchMolitBatched, MOLIT_OFFI_ENDPOINT } from "@/lib/molit-client";
import {
  RENT_F8_JEONSE_RATE,
  type RentTrend,
  type PricingConfidence,
} from "@/lib/rent-pricing";
import { isWriteFrozen } from "@/lib/maintenance";

// ─── 요청·응답 타입 ──────────────────────────────────────────────────────────

interface RentAnalyzeRequest {
  lawdCd: string;
  siteAddress?: string; // 대상 물건 전체 주소 (자동 지오코딩용)
  addressPrefix?: string;
  targetUmdNm?: string; // 읍면동명 (지오코딩 실패 시 폴백용)
  siteLat?: number;
  siteLng?: number;
  months?: number;
  targetAreaSqm: number;
  targetBuildYear?: number;
  jeonseRate?: number;
  forceRefresh?: boolean;
  /** F6 유사도 최소 총점 (0~15). 기본 11. 미만 매물 제외 */
  minScore?: number;
  /** F7 아웃라이어 제거 σ 임계값 (기본 1.5) */
  sigmaThreshold?: number;
  /** 타입별 평당단가 산출용 (이름 + 전용평) */
  unitTypes?: { name: string; netPyeong: number }[];
}

interface RentAnalyzeResponse {
  status: "OK" | "ERROR";
  error?: { code: string; message: string };
  data?: {
    rawCount: number;
    monthlyCount: number;
    ltFilteredCount: number;
    depositFilteredCount: number;
    scoredCount: number;
    monthsUsed: number;
    uniqueBuildings: number;
    geocodedBuildings: number;
    geocodingNote?: string;
    sourceNote?: string;
    apiWarnings?: string[];
  };
  comparables?: ComparableBuilding[];
  stats?: {
    perPyeong: {
      p75: number;
      median: number;
      mean: number;
      p25: number;
    };
  } | null;
  /** 타입별 평당단가 (엑셀 `선별_피봇 D29~F31`) */
  typesPerPyeong?: Record<string, number>;
  /** 타입별 매칭 건수 (디버깅·UI 표시용) */
  typeMatchCounts?: Record<string, number>;
  trend?: RentTrend | null;
  confidence?: PricingConfidence;
}

// ─── 핸들러 ───────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
): Promise<NextResponse<RentAnalyzeResponse>> {
  if (await isWriteFrozen()) {
    return NextResponse.json(
      {
        error: "Maintenance — writes frozen",
      } as unknown as RentAnalyzeResponse,
      {
        status: 503,
        headers: { "retry-after": "3600" },
      },
    );
  }
  if (!hasApiKey()) {
    return NextResponse.json(
      {
        status: "ERROR",
        error: {
          code: "MISSING_API_KEY",
          message:
            "DATA_GO_KR_API_KEY(S) 환경변수가 설정되지 않았습니다. 관리자에게 문의하세요.",
        },
      },
      { status: 500 },
    );
  }

  let body: RentAnalyzeRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        status: "ERROR",
        error: {
          code: "INVALID_BODY",
          message: "요청 본문을 파싱할 수 없습니다.",
        },
      },
      { status: 400 },
    );
  }

  const {
    lawdCd,
    siteAddress,
    addressPrefix = "",
    targetUmdNm,
    months = 12,
    targetAreaSqm,
    jeonseRate: clientJeonseRate = RENT_F8_JEONSE_RATE,
    forceRefresh = false,
    minScore,
    sigmaThreshold,
  } = body;

  const jeonseRate = clientJeonseRate;

  // siteLat/siteLng는 let — 자동 지오코딩으로 채울 수 있음
  let siteLat: number | undefined = body.siteLat;
  let siteLng: number | undefined = body.siteLng;

  // 좌표가 없고 주소가 있으면 자동 지오코딩 — 입력된 주소 그대로만 시도
  // 주소가 틀리거나 존재하지 않으면 지오코딩 실패 → 거리 필터 미적용이 정상 동작
  if ((!siteLat || !siteLng) && siteAddress) {
    const siteCoords = await geocodeBuilding(siteAddress);
    if (siteCoords) {
      siteLat = siteCoords.lat;
      siteLng = siteCoords.lng;
    }
  }

  // 입력 검증
  if (!lawdCd || String(lawdCd).length !== 5) {
    return NextResponse.json(
      {
        status: "ERROR",
        error: {
          code: "INVALID_LAWD_CD",
          message: "lawdCd는 5자리 법정동코드여야 합니다.",
        },
      },
      { status: 400 },
    );
  }
  if (!targetAreaSqm || isNaN(targetAreaSqm) || targetAreaSqm <= 0) {
    return NextResponse.json(
      {
        status: "ERROR",
        error: {
          code: "INVALID_TARGET_AREA",
          message: "targetAreaSqm (전용면적 m2)은 양수여야 합니다.",
        },
      },
      { status: 400 },
    );
  }

  const monthsInt = Math.min(Math.max(months, 1), 36);

  // ─── Step 1: MOLIT 데이터 수집 (엑셀 SSOT: 대상 구 오피스텔 원본만) ──────
  let rawTransactions: import("@/lib/molit-parser").MolitTransaction[] = [];
  const apiWarnings: string[] = [];

  /** 단일 구 코드에 대한 MOLIT 데이터 수집 */
  async function fetchGuData(guCode: string) {
    const offiResult = await fetchMolitBatched(
      MOLIT_OFFI_ENDPOINT,
      guCode,
      monthsInt,
      forceRefresh,
    );

    if (
      offiResult.limitExceeded &&
      offiResult.transactions.length === 0 &&
      rawTransactions.length === 0
    ) {
      throw new Error("API_LIMIT_EXCEEDED");
    }

    if (offiResult.failedMonths > 0) {
      apiWarnings.push(
        offiResult.limitExceeded
          ? `API 한도 초과로 ${offiResult.totalMonths}개월 중 ${offiResult.totalMonths - offiResult.failedMonths}개월만 수집됨`
          : `${guCode}: ${offiResult.totalMonths}개월 중 ${offiResult.failedMonths}개월 수집 실패`,
      );
    }

    rawTransactions = [...rawTransactions, ...offiResult.transactions];
  }

  try {
    await fetchGuData(String(lawdCd));
  } catch (err) {
    if (err instanceof Error && err.message === "API_LIMIT_EXCEEDED") {
      return NextResponse.json(
        {
          status: "ERROR",
          error: {
            code: "API_LIMIT_EXCEEDED",
            message:
              "국토부 API 일일 호출 한도를 초과했습니다. 내일 자정 이후 다시 시도해주세요.",
          },
        },
        { status: 429 },
      );
    }
    return NextResponse.json(
      {
        status: "ERROR",
        error: {
          code: "MOLIT_FETCH_FAILED",
          message: `국토부 API 호출 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`,
        },
      },
      { status: 502 },
    );
  }

  // Step 2: 월세 거래 확인
  const hasMonthly = rawTransactions.some(
    (tx) => parsePrice(tx.monthlyRent) > 0,
  );
  if (!hasMonthly) {
    return NextResponse.json(
      {
        status: "ERROR",
        error: {
          code: "NO_DATA",
          message:
            "해당 지역의 오피스텔 월세 거래 데이터가 없습니다. 수동으로 비교물건을 추가해주세요.",
        },
      },
      { status: 200 },
    );
  }

  // ─── Step 3: V-World 지오코딩 ──────────────────────────────────────────────
  let coordMap = new Map<string, Coordinates>();
  let uniqueBuildingCount = 0;
  let geocodedBuildingCount = 0;
  let geocodingNote: string | undefined;

  async function runGeocode() {
    const kakaoApiKey = process.env.KAKAO_REST_API_KEY?.trim();
    if (kakaoApiKey && siteLat && siteLng && addressPrefix) {
      const monthlyOnly = rawTransactions.filter(
        (tx) => parsePrice(tx.monthlyRent) > 0,
      );
      try {
        const geoResult = await geocodeUniqueBuildings(
          monthlyOnly,
          addressPrefix,
        );
        coordMap = geoResult.coordMap;
        uniqueBuildingCount = geoResult.totalBuildings;
        geocodedBuildingCount = coordMap.size;
      } catch {
        geocodingNote = "지오코딩 처리 중 오류 발생 — 거리 배점 제외";
      }
    } else if (!process.env.KAKAO_REST_API_KEY) {
      geocodingNote = "지오코딩 API 키 미설정 — 거리 배점 제외";
    }
  }

  await runGeocode();

  // ─── Step 4: 분석 (엑셀 SSOT: 추가 데이터 수집 없음) ────────────────────────

  function runAnalysis() {
    return analyzeRentData(rawTransactions, {
      targetAreaSqm,
      targetBuildYear: body.targetBuildYear,
      siteLat,
      siteLng,
      coordMap,
      targetUmdNm,
      jeonseRate,
      minScore,
      sigmaThreshold,
      unitTypes: body.unitTypes,
    });
  }

  const result = runAnalysis();

  const rawCount = rawTransactions.length;
  const sourceNote = `엑셀 SSOT 기준 — 대상 구 오피스텔 ${rawCount}건`;

  return NextResponse.json({
    status: "OK",
    data: {
      rawCount: result.rawCount,
      monthlyCount: result.monthlyCount,
      ltFilteredCount: result.ltFilteredCount,
      depositFilteredCount: result.depositFilteredCount,
      scoredCount: result.scoredCount,
      uniqueAddressCount: result.uniqueAddressCount,
      isInsufficient: result.isInsufficient,
      monthsUsed: monthsInt,
      uniqueBuildings: uniqueBuildingCount,
      geocodedBuildings: geocodedBuildingCount,
      geocodingNote,
      sourceNote,
      apiWarnings: apiWarnings.length > 0 ? apiWarnings : undefined,
    },
    comparables: result.comparables,
    stats: result.stats,
    typesPerPyeong: result.typesPerPyeong,
    typeMatchCounts: result.typeMatchCounts,
    trend: result.trend,
    confidence: result.confidence,
  });
}
