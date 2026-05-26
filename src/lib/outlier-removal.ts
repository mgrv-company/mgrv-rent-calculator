import { calcStats } from "./molit-parser";

/**
 * 전체 풀 기반 ±σ 아웃라이어 제거 (엑셀 v7.2 권위)
 *
 * 엑셀 `선별_피봇` B11~H15는 전체 선별 통과 매물(예: 153건)에 한 번에
 * AVERAGEIFS로 ±sigmaσ 적용 → 클린(예: 140건) 반환. 그룹화 안 함.
 *
 * @param items 대상 배열
 * @param getPrice 가격 추출 함수 (평당 환산월세)
 * @param sigma 표준편차 배수 (default 1.5, 엑셀 `필터기준설정 C16`)
 */
export function removeOutliers<T>(
  items: T[],
  getPrice: (item: T) => number,
  sigma: number = 1.5,
): T[] {
  if (items.length === 0) return [];
  const stats = calcStats(items.map(getPrice));
  if (stats.stddev === 0) return [...items]; // 모두 동일가
  const lo = stats.mean - sigma * stats.stddev;
  const hi = stats.mean + sigma * stats.stddev;
  return items.filter((item) => {
    const p = getPrice(item);
    return p >= lo && p <= hi;
  });
}

export interface SigmaResult<T> {
  item: T;
  /** 매물 가격이 전체 풀 평균에서 몇 σ 떨어졌는지. stddev=0일 때 null */
  sigma: number | null;
}

/**
 * 매물별 σ 거리 계산 — 전체 풀 평균/표준편차 기반.
 * 엑셀이 그룹화 안 하므로 코드도 동일.
 *
 * - stddev === 0 (모두 동일가): sigma null
 * - 입력 순서 보존
 */
export function computePoolSigmas<T>(
  items: T[],
  getPrice: (item: T) => number,
): SigmaResult<T>[] {
  if (items.length === 0) return [];
  const stats = calcStats(items.map(getPrice));
  if (stats.stddev === 0) {
    return items.map((item) => ({ item, sigma: null }));
  }
  return items.map((item) => ({
    item,
    sigma: (getPrice(item) - stats.mean) / stats.stddev,
  }));
}
