/**
 * F6 유사도 스코어링 — PRD §F6 (엑셀 v7.2 3축 배점)
 *
 * 면적·건축연한·거리 각 5점, 합계 0~15점.
 * minTotalScore 기본 11, 사용자 10~15 범위 조정.
 */

export const DEFAULT_MIN_SCORE = 11;
export const MIN_SCORE_RANGE: readonly [number, number] = [10, 15] as const;

/** 면적 차이(평) → 5/4/3/2점, 4평 초과 0점 */
export function areaScore(diffPyeong: number): number {
  const d = Math.abs(diffPyeong);
  if (d <= 1) return 5;
  if (d <= 2) return 4;
  if (d <= 3) return 3;
  if (d <= 4) return 2;
  return 0;
}

/** 건축연한 차이(년) → 5/4/3/2/1점, 15년 초과 0점 */
export function ageScore(diffYears: number): number {
  const d = Math.abs(diffYears);
  if (d <= 3) return 5;
  if (d <= 5) return 4;
  if (d <= 7) return 3;
  if (d <= 10) return 2;
  if (d <= 15) return 1;
  return 0;
}

/**
 * 거리(km) → 5/4/3/2점, 1km 초과는 최소 1점.
 * null(좌표 미매핑)도 동명 폴백 매물을 살리기 위해 1점.
 */
export function distanceScore(km: number | null): number {
  if (km === null) return 1;
  if (km <= 0.3) return 5;
  if (km <= 0.5) return 4;
  if (km <= 0.7) return 3;
  if (km <= 1.0) return 2;
  return 1;
}

export interface SimilarityTarget {
  areaPyeong: number;
  buildYear: number | null;
}

export interface SimilarityCandidate {
  areaPyeong: number;
  buildYear: number | null;
  distanceKm: number | null;
}

export interface SimilarityScore {
  area: number;
  age: number;
  distance: number;
  total: number;
}

/**
 * 3축 점수 합산 (0~15).
 *
 * null 처리:
 * - target 또는 candidate buildYear가 null → age 0점 (비교 불가)
 * - candidate distanceKm이 null → distance 1점 (좌표 미매핑 매물도 동명 폴백 경로에서 살림)
 */
export function scoreSimilarity(
  target: SimilarityTarget,
  candidate: SimilarityCandidate,
): SimilarityScore {
  const area = areaScore(candidate.areaPyeong - target.areaPyeong);
  const age =
    target.buildYear !== null && candidate.buildYear !== null
      ? ageScore(candidate.buildYear - target.buildYear)
      : 0;
  const distance = distanceScore(candidate.distanceKm);
  return { area, age, distance, total: area + age + distance };
}
