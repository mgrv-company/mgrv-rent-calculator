/**
 * 임대료 계산기 — sessionStorage 입력값 보관
 *
 * 사용자가 Step 1(/calculator)에서 입력한 자산 정보를 Step 2(/calculator/contact)
 * 리캐치 폼 → Step 3(/calculator/result) 결과까지 전달하기 위한 keystore.
 *
 * URL query string 대신 sessionStorage를 쓰는 이유:
 * - 이름·주소가 URL에 노출되지 않음 (PII)
 * - 리캐치 iframe redirect 후에도 같은 탭에 유지됨
 */

export interface RentCheckInput {
  /** 임대인 이름 (리캐치 폼 데이터와 VLOOKUP 매칭 키) */
  name: string;
  /** 자산 주소 (지번 또는 도로명) */
  address: string;
  /** 전용면적 (평) */
  areaPyeong: number;
  /** 현재 보증금 (만원) */
  depositManwon: number;
  /** 현재 월세 (만원) */
  monthlyRentManwon: number;
}

const STORAGE_KEY = "rent-check:input";

export function saveInput(input: RentCheckInput): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(input));
}

export function loadInput(): RentCheckInput | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RentCheckInput;
    if (
      typeof parsed.name === "string" &&
      typeof parsed.address === "string" &&
      typeof parsed.areaPyeong === "number" &&
      typeof parsed.depositManwon === "number" &&
      typeof parsed.monthlyRentManwon === "number"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearInput(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STORAGE_KEY);
}
