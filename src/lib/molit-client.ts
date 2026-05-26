import {
  MolitTransaction, parseMolitXml, parseTotalCount, parseMolitError, lastNMonthKeys,
  getNextApiKey,
} from './molit-parser'
import { apiCache, MOLIT_CACHE_TTL } from './api-cache'

export const MOLIT_OFFI_ENDPOINT =
  'https://apis.data.go.kr/1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent'
export const MOLIT_RH_ENDPOINT =
  'https://apis.data.go.kr/1613000/RTMSDataSvcRHRent/getRTMSDataSvcRHRent'
export const MOLIT_OFFI_FALLBACK_THRESHOLD = 500

const MOLIT_TIMEOUT_MS = 10_000
const BATCH_CONCURRENCY = 6

export async function fetchMolitMonth(
  endpoint: string,
  lawdCd: string,
  dealYmd: string,
  skipCache = false,
): Promise<MolitTransaction[]> {
  const cacheKey = `molit:${endpoint.includes('RH') ? 'rh' : 'offi'}:${lawdCd}:${dealYmd}`
  if (!skipCache) {
    const cached = await apiCache.get<MolitTransaction[]>(cacheKey)
    if (cached) return cached
  }

  const buildUrl = (pageNo: number) => {
    const url = new URL(endpoint)
    url.searchParams.set('serviceKey', getNextApiKey())
    url.searchParams.set('LAWD_CD', lawdCd)
    url.searchParams.set('DEAL_YMD', dealYmd)
    url.searchParams.set('numOfRows', '1000')
    url.searchParams.set('pageNo', String(pageNo))
    return url.toString()
  }

  const res1 = await fetch(buildUrl(1), {
    signal: AbortSignal.timeout(MOLIT_TIMEOUT_MS),
  })
  if (!res1.ok) {
    throw new Error(`MOLIT HTTP ${res1.status} for ${dealYmd}`)
  }

  const xml1 = await res1.text()

  const apiError = parseMolitError(xml1)
  if (apiError) throw new Error(apiError.message)

  const transactions = parseMolitXml(xml1)
  const totalCount = parseTotalCount(xml1)

  const totalPages = Math.ceil(totalCount / 1000)
  if (totalPages > 1) {
    const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2)
    for (let i = 0; i < remainingPages.length; i += BATCH_CONCURRENCY) {
      const batch = remainingPages.slice(i, i + BATCH_CONCURRENCY)
      const settled = await Promise.allSettled(
        batch.map(async (pageNo) => {
          const res = await fetch(buildUrl(pageNo), {
            signal: AbortSignal.timeout(MOLIT_TIMEOUT_MS),
          })
          if (!res.ok) return []
          const xml = await res.text()
          const pageError = parseMolitError(xml)
          if (pageError) throw new Error(pageError.message)
          return parseMolitXml(xml)
        }),
      )
      for (const r of settled) {
        if (r.status === 'fulfilled') transactions.push(...r.value)
      }
    }
  }

  await apiCache.set(cacheKey, transactions, MOLIT_CACHE_TTL)
  return transactions
}

export interface BatchResult {
  transactions: MolitTransaction[]
  totalMonths: number
  failedMonths: number
  limitExceeded: boolean
}

export async function fetchMolitBatched(
  endpoint: string,
  lawdCd: string,
  months: number,
  skipCache = false,
): Promise<BatchResult> {
  const monthKeys = lastNMonthKeys(months)
  const allResults: MolitTransaction[] = []
  let failedMonths = 0
  let limitExceeded = false

  for (let i = 0; i < monthKeys.length; i += BATCH_CONCURRENCY) {
    const batch = monthKeys.slice(i, i + BATCH_CONCURRENCY)
    const settled = await Promise.allSettled(
      batch.map((ym) => fetchMolitMonth(endpoint, lawdCd, ym, skipCache)),
    )
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        allResults.push(...r.value)
      } else {
        failedMonths++
        if (r.reason instanceof Error && r.reason.message.includes('한도')) {
          limitExceeded = true
        }
      }
    }

    if (limitExceeded) {
      failedMonths += monthKeys.length - (i + batch.length)
      break
    }
  }

  return {
    transactions: allResults,
    totalMonths: monthKeys.length,
    failedMonths,
    limitExceeded,
  }
}
