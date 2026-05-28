// ─── 상수 ─────────────────────────────────────────────────────────────────────
export const SQM_PER_PYEONG = 3.3058;
export const DEFAULT_JEONSE_RATE = 0.0607;

// ─── 타입 ─────────────────────────────────────────────────────────────────────

export interface MolitTransaction {
  umdNm: string;
  offiNm: string;
  excluUseAr: string;
  deposit: string;
  monthlyRent: string;
  floor: string;
  buildYear: string;
  dealYear: string;
  dealMonth: string;
  dealDay: string;
  jibun: string;
  contractTerm?: string; // 계약기간 (예: "25.10~26.10")
}

// ─── 유틸 함수 ────────────────────────────────────────────────────────────────

/** 콤마 포함 문자열을 숫자로 파싱 */
export function parsePrice(val: string | undefined | null): number {
  if (val === undefined || val === null || val === "") return 0;
  return parseInt(String(val).replace(/,/g, ""), 10) || 0;
}

/** XML 태그에서 <item> 블록별 필드 추출 (경량 regex 파서) */
export function parseMolitXml(xml: string): MolitTransaction[] {
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  const transactions: MolitTransaction[] = [];
  let match;
  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1];
    const extract = (tag: string): string => {
      const inner = new RegExp(`<${tag}>([^<]*)</${tag}>`);
      const m = inner.exec(block);
      return m ? m[1].trim() : "";
    };
    transactions.push({
      umdNm: extract("umdNm"),
      offiNm: extract("offiNm"),
      excluUseAr: extract("excluUseAr"),
      deposit: extract("deposit"),
      monthlyRent: extract("monthlyRent"),
      floor: extract("floor"),
      buildYear: extract("buildYear"),
      dealYear: extract("dealYear"),
      dealMonth: extract("dealMonth"),
      dealDay: extract("dealDay"),
      jibun: extract("jibun"),
      contractTerm: extract("contractTerm") || undefined,
    });
  }
  return transactions;
}

/**
 * contractTerm 문자열 → 계약 기간 (개월)
 * 형식: "YY.MM~YY.MM" (예: "26.02~27.02" = 12개월)
 * 빈 문자열이나 파싱 불가 → 0 반환
 */
export function parseContractTermMonths(term: string | undefined): number {
  if (!term || term.trim().length === 0) return 0;
  const match = /(\d{2})\.(\d{2})~(\d{2})\.(\d{2})/.exec(term.trim());
  if (!match) return 0;
  const startYear = 2000 + parseInt(match[1], 10);
  const startMonth = parseInt(match[2], 10);
  const endYear = 2000 + parseInt(match[3], 10);
  const endMonth = parseInt(match[4], 10);
  const months = (endYear - startYear) * 12 + (endMonth - startMonth);
  return months > 0 ? months : 0;
}

/** 국토부 API XML 응답에서 <totalCount> 값 추출 */
export function parseTotalCount(xml: string): number {
  const m = /<totalCount>(\d+)<\/totalCount>/.exec(xml);
  return m ? parseInt(m[1], 10) : 0;
}

// ─── API 에러 감지 ──────────────────────────────────────────────────────────

/**
 * data.go.kr API 에러 XML 감지
 *
 * 한도 초과 등 에러 시 HTTP 200이지만 본문에 에러 XML이 담겨 옴:
 * <returnReasonCode>22</returnReasonCode>
 * <returnAuthMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</returnAuthMsg>
 */
const DATA_GO_KR_ERROR_MESSAGES: Record<string, string> = {
  "4": "활용 신청이 되지 않은 서비스입니다.",
  "12": "해당 오픈 API 서비스가 없거나 폐기되었습니다.",
  "20": "서비스 키(API Key)가 올바르지 않습니다. 키를 확인해주세요.",
  "22": "국토부 API 일일 호출 한도를 초과했습니다. 내일 자정 이후 다시 시도해주세요.",
  "30": "등록되지 않은 서비스 키입니다.",
  "31": "서비스 키 사용 기한이 만료되었습니다. 공공데이터포털에서 갱신해주세요.",
  "32": "등록되지 않은 IP입니다.",
  "99": "국토부 API 서버에 알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
};

export interface MolitApiError {
  code: string;
  message: string;
  isLimitExceeded: boolean;
}

export function parseMolitError(xml: string): MolitApiError | null {
  const codeMatch = /<returnReasonCode>(\d+)<\/returnReasonCode>/.exec(xml);
  if (!codeMatch) return null;

  const code = codeMatch[1];
  const message =
    DATA_GO_KR_ERROR_MESSAGES[code] ?? `국토부 API 오류 (코드: ${code})`;

  return {
    code,
    message,
    isLimitExceeded: code === "22",
  };
}

// ─── API 키 로테이션 ────────────────────────────────────────────────────────

// secret store(Cloud Secret Manager 등)가 trailing newline을 포함해 등록되는 경우가 있어
// 키 단위 trim 필수 (2026-04-29 prod V-World INVALID_KEY 함정 사건).
// App Hosting이 시크릿을 런타임 env로 주입 → process.env가 컨테이너 시작 시점에
// 채워지므로 module-level 평가로 충분.
const apiKeys = (
  process.env.DATA_GO_KR_API_KEYS ??
  process.env.DATA_GO_KR_API_KEY ??
  ""
)
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

let keyIndex = 0;

/** API 키가 1개 이상 등록되어 있는지 (side effect 없음) */
export function hasApiKey(): boolean {
  return apiKeys.length > 0;
}

/** 다음 API 키 반환 + 라운드로빈 (side effect: keyIndex++) */
export function getNextApiKey(): string {
  const key = apiKeys[keyIndex % apiKeys.length];
  keyIndex++;
  return key;
}

/** 최근 N개월 YYYYMM 키 배열 생성 */
export function lastNMonthKeys(n: number): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    keys.push(`${yyyy}${mm}`);
  }
  return keys;
}

// ─── 통계 ─────────────────────────────────────────────────────────────────────

export interface Stats {
  count: number;
  mean: number;
  median: number;
  stddev: number;
  min: number;
  max: number;
}

export function calcStats(values: number[]): Stats {
  if (values.length === 0) {
    return { count: 0, mean: 0, median: 0, stddev: 0, min: 0, max: 0 };
  }
  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const median =
    n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);
  return { count: n, mean, median, stddev, min: sorted[0], max: sorted[n - 1] };
}

export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const idx = (p / 100) * (sortedValues.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const frac = idx - lo;
  if (lo === hi) return sortedValues[lo];
  return sortedValues[lo] * (1 - frac) + sortedValues[hi] * frac;
}
