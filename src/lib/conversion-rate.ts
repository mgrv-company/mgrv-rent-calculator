/**
 * 전월세전환율 조회 공유 모듈
 *
 * KOSIS(한국통계청) 전월세전환율 API를 호출하고 인메모리 캐시를 관리한다.
 * API route(/api/conversion-rate)와 rent-analyze 로직 모두에서 import하여 사용.
 */

const TIMEOUT_MS = 10_000
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000 // 30일(ms)

/** 전환율 폴백값 (%, 전국 평균) */
export const FALLBACK_RATE_PERCENT = 6.07

/** 경계값 검증: rate > 0 AND rate <= 15 */
export function isValidRate(rate: number): boolean {
  return rate > 0 && rate <= 15
}

/** 법정동코드 시도 2자리 → KOSIS 지역코드 매핑 */
export const LAWD_TO_KOSIS: Record<string, { code: string; name: string }> = {
  '11': { code: 'a7', name: '서울' },
  '26': { code: 'a8', name: '부산' },
  '27': { code: 'a9', name: '대구' },
  '28': { code: 'a10', name: '인천' },
  '29': { code: 'a11', name: '광주' },
  '30': { code: 'a12', name: '대전' },
  '31': { code: 'a13', name: '울산' },
  '36': { code: 'a14', name: '세종' },
  '41': { code: 'a15', name: '경기' },
  '42': { code: 'a16', name: '강원' },
  '43': { code: 'a17', name: '충북' },
  '44': { code: 'a18', name: '충남' },
  '45': { code: 'a19', name: '전북' },
  '46': { code: 'a20', name: '전남' },
  '47': { code: 'a21', name: '경북' },
  '48': { code: 'a22', name: '경남' },
  '50': { code: 'a23', name: '제주' },
}

export interface ConversionRateResult {
  status: 'OK' | 'FALLBACK'
  /** 전환율 (% 단위, 예: 5.2) */
  rate: number
  source: 'kosis' | 'fallback'
  region: string
  period?: string
  message?: string
}

// 인메모리 캐시
const rateCache = new Map<string, { rate: number; region: string; period: string; fetchedAt: number }>()

/** 테스트용 캐시 초기화 */
export function _resetCacheForTest(): void {
  rateCache.clear()
}

/**
 * 지역별 전월세전환율 조회 (캐시 포함)
 * @param regionCode 법정동코드 시도 2자리 (예: '11' = 서울)
 * @returns 전환율 결과 (% 단위)
 */
export async function getConversionRate(regionCode: string): Promise<ConversionRateResult> {
  const regionName = LAWD_TO_KOSIS[regionCode]?.name ?? '전국'
  const apiKey = process.env.KOSIS_API_KEY

  if (!apiKey) {
    return {
      status: 'FALLBACK',
      rate: FALLBACK_RATE_PERCENT,
      source: 'fallback',
      region: regionName,
      message: 'KOSIS API 키가 설정되지 않아 기본값을 사용합니다.',
    }
  }

  // 캐시 확인
  const cacheKey = `convRate:${regionCode}`
  const cached = rateCache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return {
      status: 'OK',
      rate: cached.rate,
      source: 'kosis',
      region: cached.region,
      period: cached.period,
    }
  }

  try {
    const result = await fetchFromKosis(regionCode, apiKey)
    if (result && isValidRate(result.rate)) {
      rateCache.set(cacheKey, { ...result, fetchedAt: Date.now() })
      return {
        status: 'OK',
        rate: result.rate,
        source: 'kosis',
        region: result.region,
        period: result.period,
      }
    }

    return {
      status: 'FALLBACK',
      rate: FALLBACK_RATE_PERCENT,
      source: 'fallback',
      region: regionName,
      message: `${regionName} 지역 전환율 데이터 미발표 — 전국 기준 ${FALLBACK_RATE_PERCENT}% 적용`,
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.warn('[conversion-rate] KOSIS 조회 실패:', detail)

    return {
      status: 'FALLBACK',
      rate: FALLBACK_RATE_PERCENT,
      source: 'fallback',
      region: regionName,
      message: `전환율 자동 조회 실패 — 전국 기준 ${FALLBACK_RATE_PERCENT}% 적용`,
    }
  }
}

/**
 * KOSIS 전월세전환율 조회
 * - orgId=408 (한국부동산원), tblId=DT_30404_N0010 (지역별 전월세전환율)
 * - itmId=T1 (전환율), objL1=02 (연립다세대), objL2=지역코드
 * - 최근 6개월 조회 후 가장 최신 데이터 사용 (발표 지연 대응)
 */
async function fetchFromKosis(
  lawdCode: string,
  apiKey: string,
): Promise<{ rate: number; region: string; period: string } | null> {
  const mapping = LAWD_TO_KOSIS[lawdCode] ?? { code: 'a0', name: '전국' }

  // 최근 6개월 범위 (발표 지연 대응)
  const now = new Date()
  const start = new Date(now)
  start.setMonth(start.getMonth() - 6)
  const startPrd = `${start.getFullYear()}${String(start.getMonth() + 1).padStart(2, '0')}`
  const endPrd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`

  // KOSIS API 키에 '=' 등 특수문자가 포함되어 URL.searchParams.set()의
  // 퍼센트 인코딩(%3D)을 KOSIS 서버가 인식하지 못함 → template literal 사용
  const url = `https://kosis.kr/openapi/Param/statisticsParameterData.do?method=getList&apiKey=${apiKey}&orgId=408&tblId=DT_30404_N0010&itmId=T1&objL1=02&objL2=${mapping.code}&format=json&jsonVD=Y&prdSe=M&startPrdDe=${startPrd}&endPrdDe=${endPrd}`

  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!res.ok) {
    console.warn(`[conversion-rate] KOSIS HTTP ${res.status}`)
    return null
  }

  const text = await res.text()
  if (!text || text.trim().length === 0) return null

  // KOSIS 에러 응답 체크 (예: {"err":"11","errMsg":"유효하지 않은 인증KEY입니다."})
  let data: unknown
  try {
    // KOSIS는 키 따옴표 없는 비표준 JSON 반환할 수 있음 → 수정 후 파싱
    const fixed = text.replace(/(\{|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
    data = JSON.parse(fixed)
  } catch {
    console.warn('[conversion-rate] KOSIS 응답 파싱 실패:', text.slice(0, 200))
    return null
  }

  // 에러 객체 감지
  if (data && typeof data === 'object' && !Array.isArray(data) && 'err' in data) {
    const errObj = data as { err: string; errMsg?: string }
    console.warn(`[conversion-rate] KOSIS 에러: [${errObj.err}] ${errObj.errMsg ?? ''}`)
    return null
  }

  if (!Array.isArray(data) || data.length === 0) return null

  // 가장 최신 데이터 사용 (PRD_DE 내림차순 정렬)
  const sorted = data.sort((a: { PRD_DE: string }, b: { PRD_DE: string }) =>
    b.PRD_DE.localeCompare(a.PRD_DE),
  )
  const latest = sorted[0]
  const rate = parseFloat(latest.DT)
  if (!isValidRate(rate)) return null

  const prd = latest.PRD_DE as string // "202503"
  const period = `${prd.slice(0, 4)}.${prd.slice(4, 6)}`

  return { rate, region: mapping.name, period }
}
