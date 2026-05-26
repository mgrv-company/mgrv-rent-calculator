/**
 * 시세 산출 로직 — CALC-LOGIC.md §1-0 ~ §1-2-MT
 *
 * LT: 국토부 비교물건 기반 시세 밴드 + 프리미엄 가산
 * MT: 독립 입력 (Phase 2에서 플랫폼 자동 수집 예정)
 */

// ─── 상수 (rent F8 한정) ──────────────────────────────────────────────────────
/**
 * rent F8 임대료 공식에서 사용하는 전월세 전환율 (연).
 * 엑셀 v7.2 `📋 사업개요!C34` 고정값 0.061. 글로벌 `DEFAULT_JEONSE_RATE`(0.0607)와
 * 분리. 이 상수는 임대료 산정용이고, molit-parser는 실거래 환산용이라 출처 다름.
 */
export const RENT_F8_JEONSE_RATE = 0.061

/** 평 변환 계수. molit-parser와 동일 값을 별도 정의해 import 의존 없이 self-contained. */
export const SQM_PER_PYEONG = 3.3058

// ─── F8 임대료 공식 ───────────────────────────────────────────────────────────

/** 만원 단위 반올림 — 엑셀 ROUND(., -4)와 동일 */
export function roundToManwon(won: number): number {
  return Math.round(won / 10_000) * 10_000
}

/** 엑셀 사업개요/임대료안의 평 단위 중간 셀과 동일하게 소수 2자리 반올림 */
function roundPyeong(value: number): number {
  return Math.round(value * 100) / 100
}

/** F8 공식 입력 — 엑셀 `임대료안` 시트 한 행 단위 */
export interface F8RentInput {
  /** 평당단가 (원/평) — 엑셀 E열 */
  pricePerPyeong: number
  /** 전용면적 (㎡) — 엑셀 `사업개요!E20·E21·E22` */
  netSqm: number
  /** 전체 공용공간 (㎡) — 엑셀 `사업개요!C38` */
  totalCommonSqm: number
  /** 총 세대수 — 엑셀 `사업개요!C11` */
  totalUnits: number
  /** 신축 프리미엄 (예: 0.1 = 10%) — 엑셀 G열 */
  newConstructionPct: number
  /** 풀퍼니 프리미엄 (예: 0 = 0%) — 엑셀 H열 */
  furnishedPct: number
  /** 보증금 (만원 단위) — 엑셀 F열 */
  depositManwon: number
  /** 무보증금 단기(MT) 할증률 (예: 0.35 = 35%) — 엑셀 K열 */
  noDepositSurcharge: number
  /** 전월세 전환율 (연). 미지정 시 `RENT_F8_JEONSE_RATE`(0.061) */
  jeonseRate?: number
}

export interface F8RentOutput {
  /** 장기 월세 (원, 만원 단위 반올림) — 엑셀 G열 */
  longTermRent: number
  /** 무보증금 단기(MT) 월세 (원, 만원 단위 반올림) — 엑셀 H열 */
  midTermRent: number
  /** 전용평 (평) */
  netPyeong: number
  /** 공용평 (평) — 전체 공용공간 / 총 세대수 / 평변환계수 */
  commonPyeong: number
}

/**
 * F8 임대료 공식 (엑셀 v7.2 `임대료안!G6·H6` 셀 그대로) —
 * 공용평 분리 + 보증금 만원→원 환산 + 만원 단위 반올림
 *
 * ```
 * 장기 = ROUND(단가 × (전용평 × (1+신축%+풀퍼니%) + 공용평) - 보증금×10000×전환율/12, -4)
 *  MT  = ROUND(장기 × (1 + 무보증금할증), -4)
 * ```
 *
 * 핵심 주의:
 * 1. 프리미엄은 **전용평에만** 곱하고 공용평은 단가 그대로
 * 2. 보증금은 만원 단위로 입력 → 공식 내부에서 ×10,000으로 원 환산
 * 3. 장기·MT 모두 만원 단위로 반올림
 */
export function calcF8Rent(input: F8RentInput): F8RentOutput {
  const {
    pricePerPyeong,
    netSqm,
    totalCommonSqm,
    totalUnits,
    newConstructionPct,
    furnishedPct,
    depositManwon,
    noDepositSurcharge,
    jeonseRate = RENT_F8_JEONSE_RATE,
  } = input

  const netPyeong = roundPyeong(netSqm / SQM_PER_PYEONG)
  const commonPyeong = totalUnits > 0 ? roundPyeong(totalCommonSqm / totalUnits / SQM_PER_PYEONG) : 0

  // 장기: 단가 × (전용평 × (1+신축+풀퍼니) + 공용평) - 보증금×10000×전환율/12
  const premiumNetPyeong = netPyeong * (1 + newConstructionPct + furnishedPct)
  const grossRent = pricePerPyeong * (premiumNetPyeong + commonPyeong)
  const depositOffset = depositManwon * 10_000 * jeonseRate / 12
  const longTermRent = roundToManwon(grossRent - depositOffset)

  // MT: 장기 × (1 + 무보증금할증)
  const midTermRent = roundToManwon(longTermRent * (1 + noDepositSurcharge))

  return {
    longTermRent,
    midTermRent,
    netPyeong,
    commonPyeong,
  }
}

// ─── 타입 ─────────────────────────────────────────────────────────────────────

export interface Comparable {
  name: string
  address?: string       // 비교물건 소재지
  areaPyeong: number
  standardRent: number   // 원 (표준 보증금 기준 환산 월세)
  pricePerPyeong: number // 원/평
  distanceKm?: number | null // 대상 물건으로부터의 거리 (km)
  selected: boolean      // 사용자 선택 여부
  matchedStep?: number | null // 개별 매칭 단계 (null = 거리 미확인 or 수동)
  isManual?: boolean     // 수동 추가 여부
  contractTerm?: string  // 계약기간 (예: "25.10~26.10")
  dealDate?: string      // 거래일 (YYYY-MM-DD, LT만 제공)
}

export interface RentBand {
  max: number     // 원/평
  p75: number     // 원/평
  median: number  // 원/평
  mean: number    // 원/평
  p25: number     // 원/평
  min: number     // 원/평
}

export type BasisType = 'max' | 'p75' | 'median' | 'mean' | 'p25' | 'min' | 'custom'

/** 밴드 산출 범위 — 드롭다운 선택지 */
export type BandScope = 'selected' | 'step-1' | 'step-1-2' | 'step-1-2-3' | 'step-1-2-3-4'

export interface PremiumItem {
  name: string
  rate: number    // 0~1 (예: 0.10 = 10%)
  enabled: boolean
}

// ─── 신뢰도 등급 ─────────────────────────────────────────────────────────────

export type ConfidenceGrade = 'High' | 'Medium' | 'Low'

export interface PricingConfidence {
  grade: ConfidenceGrade
  radiusKm: number | null
  comparableCount: number
  reason: string // "500m 반경, 23건"
}

/** 반경과 비교물건 수로 신뢰도 등급 산출 */
export function calcConfidence(
  radiusKm: number | null,
  comparableCount: number,
): PricingConfidence {
  let grade: ConfidenceGrade
  if (radiusKm !== null && radiusKm <= 0.5 && comparableCount >= 10) {
    grade = 'High'
  } else if (radiusKm !== null && radiusKm <= 1.0 && comparableCount >= 10) {
    grade = 'Medium'
  } else {
    grade = 'Low'
  }

  const radiusLabel = radiusKm !== null ? `${Math.round(radiusKm * 1000)}m 반경` : '구 전체'
  return {
    grade,
    radiusKm,
    comparableCount,
    reason: `${radiusLabel}, ${comparableCount}건`,
  }
}

export interface RentPricingResult {
  band: RentBand
  adjustedRents: {
    max: number
    p75: number
    median: number
    mean: number
    p25: number
    min: number
  }
  simpleAvgRent: number
  selectedBasis: BasisType
  ltRent: number              // 적정 LT 임대료 (원)
  mtRent: number              // 적정 MT 임대료 (원) — 독립 입력
  mtPricePerPyeong: number    // MT 평당 단가 (원/평)
  mtSource: 'manual' | 'platform'  // MT 시세 출처
  mtLtRatio: number           // 참고 지표 (mtRent / ltRent, 사후 산출)
  totalPremiumRate: number
  pricePerPyeong: number      // LT 선택 기준의 평당 단가 (원/평)
  targetAreaPyeong: number    // 탭① 대상 면적 (평) — 탭② 룸타입 기본 면적 연동용
}

// ─── 유틸 ─────────────────────────────────────────────────────────────────────

/**
 * 선형 보간법 Percentile (numpy/Excel 방식)
 */
export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0
  if (sortedValues.length === 1) return sortedValues[0]

  const idx = (p / 100) * (sortedValues.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  const frac = idx - lo

  if (lo === hi) return sortedValues[lo]
  return sortedValues[lo] * (1 - frac) + sortedValues[hi] * frac
}

// ─── 핵심 함수 ────────────────────────────────────────────────────────────────

/**
 * 시세 밴드 산출 — CALC-LOGIC §1-1
 *
 * @param comparables - 선택된 비교물건 리스트 (selected=true만 사용)
 * @returns 평당 단가 기준 6개 기준값
 */
export function calcRentBand(comparables: Comparable[]): RentBand {
  const selected = comparables.filter((c) => c.selected)
  if (selected.length === 0) {
    return { max: 0, p75: 0, median: 0, mean: 0, p25: 0, min: 0 }
  }

  const prices = selected.map((c) => c.pricePerPyeong).sort((a, b) => a - b)

  return {
    max: Math.round(Math.max(...prices)),
    p75: Math.round(percentile(prices, 75)),
    median: Math.round(percentile(prices, 50)),
    mean: Math.round(prices.reduce((s, v) => s + v, 0) / prices.length),
    p25: Math.round(percentile(prices, 25)),
    min: Math.round(Math.min(...prices)),
  }
}

/**
 * 적정 임대료 산출 — CALC-LOGIC §1-1 ~ §1-2-MT
 *
 * @param comparables - 비교물건 리스트
 * @param targetArea - 대상 물건 전용면적 (평)
 * @param premiums - 프리미엄 요소 리스트
 * @param selectedBasis - 사용자 선택 기준 (기본 'median')
 * @param mtRent - MT 적정 임대료 (독립 입력, 미입력 시 0)
 */
export function calcRentPricing(
  comparables: Comparable[],
  targetArea: number,
  premiums: PremiumItem[],
  selectedBasis: BasisType = 'median',
  mtRent?: number,
  mtSource: 'manual' | 'platform' = 'manual',
  customLtRent?: number,
): RentPricingResult {
  const band = calcRentBand(comparables)

  // 면적 보정 시세 (6개 기준값 각각)
  const adjustedRents = {
    max: Math.round(band.max * targetArea),
    p75: Math.round(band.p75 * targetArea),
    median: Math.round(band.median * targetArea),
    mean: Math.round(band.mean * targetArea),
    p25: Math.round(band.p25 * targetArea),
    min: Math.round(band.min * targetArea),
  }

  // 단순 평균 (면적 보정 없이 월세 자체의 평균)
  const selected = comparables.filter((c) => c.selected)
  const simpleAvgRent =
    selected.length > 0
      ? Math.round(selected.reduce((s, c) => s + c.standardRent, 0) / selected.length)
      : 0

  // 프리미엄 적용
  const totalPremiumRate = premiums
    .filter((p) => p.enabled)
    .reduce((sum, p) => sum + p.rate, 0)

  // custom일 때는 사용자 입력값 사용, 아니면 밴드 기준값
  const adjustedRent = selectedBasis === 'custom'
    ? (customLtRent ?? 0)
    : adjustedRents[selectedBasis]
  const pricePerPyeong = selectedBasis === 'custom'
    ? (targetArea > 0 ? (customLtRent ?? 0) / targetArea : 0)
    : band[selectedBasis]

  // 적정 LT 임대료
  const ltRent = Math.round(adjustedRent * (1 + totalPremiumRate))

  // MT: 독립 입력 + 프리미엄 적용 (LT와 동일 패턴)
  const baseMtRent = mtRent ?? 0
  const mtPricePerPyeong = targetArea > 0 ? Math.round(baseMtRent / targetArea) : 0
  const finalMtRent = Math.round(baseMtRent * (1 + totalPremiumRate))
  const mtLtRatio = ltRent > 0 ? finalMtRent / ltRent : 0

  return {
    band,
    adjustedRents,
    simpleAvgRent,
    selectedBasis,
    ltRent,
    mtRent: finalMtRent,
    mtPricePerPyeong,
    mtSource: mtRent != null ? mtSource : 'manual',
    mtLtRatio,
    totalPremiumRate,
    pricePerPyeong,
    targetAreaPyeong: targetArea,
  }
}

// ─── Scope 기반 밴드 산출 ──────────────────────────────────────────────────────

/** matchedStep 기준 최대 단계 인덱스 매핑 */
export const SCOPE_MAX_STEP: Record<Exclude<BandScope, 'selected'>, number> = {
  'step-1': 0,
  'step-1-2': 1,
  'step-1-2-3': 2,
  'step-1-2-3-4': 3,
}

/**
 * Scope 기반 시세 밴드 산출
 *
 * - 'selected': 기존 동작 (selected=true인 것만)
 * - 'step-N': matchedStep <= N인 것만 (tick 무시). matchedStep=null(좌표 미확인)은 모든 단계에 포함.
 */
export function calcRentBandByScope(comparables: Comparable[], scope: BandScope): RentBand {
  if (scope === 'selected') return calcRentBand(comparables)

  const maxStep = SCOPE_MAX_STEP[scope]
  const filtered = comparables.filter(c =>
    c.matchedStep === null || c.matchedStep === undefined || (c.matchedStep <= maxStep),
  )
  if (filtered.length === 0) return { max: 0, p75: 0, median: 0, mean: 0, p25: 0, min: 0 }

  const prices = filtered.map(c => c.pricePerPyeong).sort((a, b) => a - b)
  return {
    max: Math.round(Math.max(...prices)),
    p75: Math.round(percentile(prices, 75)),
    median: Math.round(percentile(prices, 50)),
    mean: Math.round(prices.reduce((s, v) => s + v, 0) / prices.length),
    p25: Math.round(percentile(prices, 25)),
    min: Math.round(Math.min(...prices)),
  }
}

/** Scope별 해당하는 비교물건 수 */
export function countByScope(comparables: Comparable[], scope: BandScope): number {
  if (scope === 'selected') return comparables.filter(c => c.selected).length
  const maxStep = SCOPE_MAX_STEP[scope]
  return comparables.filter(c =>
    c.matchedStep === null || c.matchedStep === undefined || (c.matchedStep <= maxStep),
  ).length
}

// ─── 집계 방식 (Aggregation) ─────────────────────────────────────────────────

/** 밴드 집계 방식 — 전체 거래 or 주소별 대표값 */
export type AggregationMode = 'all' | 'unique-max' | 'unique-median' | 'unique-mean' | 'unique-latest'

/**
 * Aggregation 모드에 따라 comparables의 selected 상태를 업데이트하고 정렬 반환
 *
 * 주소 기반으로 대표 행을 식별하므로 인덱스 의존 없이 안전.
 * ticked(대표) 행이 상단, unticked(비대표) 행이 하단으로 정렬.
 */
export function applyAggregation(
  comparables: Comparable[],
  mode: AggregationMode,
): Comparable[] {
  if (mode === 'all') {
    return comparables.map(c => ({ ...c, selected: true }))
  }

  // 주소별 그룹화 → 대표 거래 선정
  const groups = new Map<string, Comparable[]>()
  let noAddrSeq = 0
  for (const c of comparables) {
    const addr = (c.address ?? '').trim() || `__no_addr_${noAddrSeq++}`
    if (!groups.has(addr)) groups.set(addr, [])
    groups.get(addr)!.push(c)
  }

  const representativeSet = new Set<Comparable>()
  for (const items of groups.values()) {
    if (items.length === 1) { representativeSet.add(items[0]); continue }

    let best = items[0]
    switch (mode) {
      case 'unique-max':
        best = items.reduce((b, c) => c.pricePerPyeong > b.pricePerPyeong ? c : b)
        break
      case 'unique-median': {
        const sorted = [...items].sort((a, b) => a.pricePerPyeong - b.pricePerPyeong)
        best = sorted[Math.floor(sorted.length / 2)]
        break
      }
      case 'unique-mean': {
        const avg = items.reduce((s, c) => s + c.pricePerPyeong, 0) / items.length
        best = items.reduce((b, c) =>
          Math.abs(c.pricePerPyeong - avg) < Math.abs(b.pricePerPyeong - avg) ? c : b)
        break
      }
      case 'unique-latest': {
        best = items.reduce((b, c) => (c.dealDate ?? '') > (b.dealDate ?? '') ? c : b)
        break
      }
    }
    representativeSet.add(best)
  }

  const updated = comparables.map(c => ({ ...c, selected: representativeSet.has(c) }))
  const ticked = updated.filter(c => c.selected)
  const unticked = updated.filter(c => !c.selected)
  return [...ticked, ...unticked]
}

/** 주소별 대표 인덱스 산출 (하위호환) */
export function selectRepresentativeIndices(
  comparables: Comparable[],
  mode: AggregationMode,
): number[] {
  if (mode === 'all') return comparables.map((_, i) => i)
  const result = applyAggregation(comparables, mode)
  return result.map((c, i) => c.selected ? i : -1).filter(i => i >= 0)
}

/** 주소별 거래 건수 맵 반환 */
export function countByAddress(comparables: Comparable[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const c of comparables) {
    const addr = (c.address ?? '').trim()
    if (!addr) continue
    counts.set(addr, (counts.get(addr) ?? 0) + 1)
  }
  return counts
}

/** 유니크 주소 수 */
export function countUniqueAddresses(comparables: Comparable[]): number {
  const addrs = new Set(comparables.map(c => (c.address ?? '').trim()).filter(a => a))
  return addrs.size
}

// ─── 시세 트렌드 ─────────────────────────────────────────────────────────────

export interface MonthlyMedian {
  yyyymm: string       // "202401"
  median: number        // 원/평 (표준보증금 기준 환산 월세)
  count: number         // 해당 월 거래 건수
}

export type TrendConfidence = 'high' | 'moderate' | 'reference'

export interface RentTrend {
  yoyGrowth: number          // 연간 성장률 (예: 0.023 = 2.3%)
  recentAvg: number          // 최근 6개월 평당 평균 (원/평)
  pastAvg: number            // 과거 비교구간 평당 평균 (원/평)
  monthlyMedians: MonthlyMedian[]
  totalCount: number         // 전체 거래 건수
  confidence: TrendConfidence
  isAnnualized?: boolean     // 반기 성장률을 연율화했으면 true (데이터 부족 시 폴백)
}

/**
 * 시세 트렌드 산출 — 월별 평당 중앙값 → YoY 성장률
 *
 * 로직:
 * 1. 거래를 YYYYMM으로 그룹화 → 월별 평당 중앙값
 * 2. 기본: "최근 6개월 평균" vs "12~17개월 전 평균" → 진짜 YoY (12개월 간격)
 *    폴백: 과거 데이터 부족 시 "6~11개월 전 평균" 비교 후 연율화
 * 3. 총 거래 건수에 따라 신뢰도 부여
 *
 * @param transactions - 환산보증금 기준 평당 단가가 포함된 거래 데이터
 * @returns 트렌드 결과 (데이터 부족 시 null)
 */
export function calcRentTrend(
  transactions: { dealYear: string; dealMonth: string; pricePerPyeong: number }[],
): RentTrend | null {
  if (transactions.length === 0) return null

  // 1. YYYYMM 그룹화
  const groups = new Map<string, number[]>()
  for (const tx of transactions) {
    const ym = `${tx.dealYear}${String(parseInt(tx.dealMonth)).padStart(2, '0')}`
    if (!groups.has(ym)) groups.set(ym, [])
    groups.get(ym)!.push(tx.pricePerPyeong)
  }

  // 2. 월별 중앙값
  const monthlyMedians: MonthlyMedian[] = []
  for (const [ym, prices] of groups) {
    const sorted = [...prices].sort((a, b) => a - b)
    const n = sorted.length
    const median = n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)]
    monthlyMedians.push({ yyyymm: ym, median: Math.round(median), count: n })
  }
  monthlyMedians.sort((a, b) => a.yyyymm.localeCompare(b.yyyymm))

  // 3. 최근 6개월 vs 과거 비교 구간
  //    기본: recent=0~5개월 전, past=12~17개월 전 (진짜 YoY, 12개월 간격)
  //    폴백: past 12~17개월 데이터 부족 시 6~11개월 전 비교 + 연율화
  const allYms = monthlyMedians.map(m => m.yyyymm).sort()
  if (allYms.length < 2) return null

  const latestYm = allYms[allYms.length - 1]
  const latestDate = new Date(parseInt(latestYm.slice(0, 4)), parseInt(latestYm.slice(4, 6)) - 1, 1)

  // "최근 6개월" = latestDate 기준 0~5개월 전
  const recentMonths = new Set<string>()
  for (let i = 0; i < 6; i++) {
    const d = new Date(latestDate.getFullYear(), latestDate.getMonth() - i, 1)
    recentMonths.add(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  // 기본 past: 12~17개월 전 (진짜 YoY)
  const pastMonths12 = new Set<string>()
  for (let i = 12; i < 18; i++) {
    const d = new Date(latestDate.getFullYear(), latestDate.getMonth() - i, 1)
    pastMonths12.add(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  // 폴백 past: 6~11개월 전 (반기 비교)
  const pastMonths6 = new Set<string>()
  for (let i = 6; i < 12; i++) {
    const d = new Date(latestDate.getFullYear(), latestDate.getMonth() - i, 1)
    pastMonths6.add(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const recentMedians = monthlyMedians.filter(m => recentMonths.has(m.yyyymm))
  if (recentMedians.length === 0) return null

  // 기본 경로: 12개월 간격 비교 (진짜 YoY)
  let pastMedians = monthlyMedians.filter(m => pastMonths12.has(m.yyyymm))
  let isAnnualized = false

  // 폴백: 12~17개월 데이터가 부족하면(2개월 미만) 6~11개월로 폴백
  if (pastMedians.length < 2) {
    pastMedians = monthlyMedians.filter(m => pastMonths6.has(m.yyyymm))
    isAnnualized = true // 반기 성장률 → 연율화 필요
  }

  if (pastMedians.length === 0) return null

  const recentAvg = recentMedians.reduce((s, m) => s + m.median, 0) / recentMedians.length
  const pastAvg = pastMedians.reduce((s, m) => s + m.median, 0) / pastMedians.length

  if (pastAvg <= 0) return null

  const rawGrowth = recentAvg / pastAvg - 1
  // 반기 비교 시 연율화: annualRate = (1 + halfYearRate)^2 - 1
  const yoyGrowth = isAnnualized ? Math.pow(1 + rawGrowth, 2) - 1 : rawGrowth

  // 4. 신뢰도 판정
  const totalCount = transactions.length
  let confidence: TrendConfidence
  if (totalCount >= 20) {
    confidence = 'high'
  } else if (totalCount >= 10) {
    confidence = 'moderate'
  } else {
    confidence = 'reference'
  }

  return {
    yoyGrowth,
    recentAvg: Math.round(recentAvg),
    pastAvg: Math.round(pastAvg),
    monthlyMedians,
    totalCount,
    confidence,
    isAnnualized,
  }
}

/**
 * 미래 시세 추정 — 현재 시세에 성장률 적용
 */
export function estimateFutureRent(
  currentRent: number,
  annualGrowthRate: number,
  yearsAhead: number,
): number {
  return Math.round(currentRent * Math.pow(1 + annualGrowthRate, yearsAhead))
}

/**
 * 탭① → 탭② 연동용: 평당 단가로 면적 보정 — CALC-LOGIC §1-3
 *
 * @param ltPricePerPyeong - 탭①의 LT 평당 단가 (원/평)
 * @param mtPricePerPyeong - 탭①의 MT 평당 단가 (원/평)
 * @param typeArea - 해당 타입의 전용면적 (평)
 * @param totalPremiumRate - 프리미엄 합계 비율
 */
export function calcRentForArea(
  ltPricePerPyeong: number,
  mtPricePerPyeong: number,
  typeArea: number,
  totalPremiumRate: number,
): { ltRent: number; mtRent: number } {
  const ltRent = Math.round(ltPricePerPyeong * typeArea * (1 + totalPremiumRate))
  const mtRent = Math.round(mtPricePerPyeong * typeArea * (1 + totalPremiumRate))  // MT에도 프리미엄 적용
  return { ltRent, mtRent }
}
