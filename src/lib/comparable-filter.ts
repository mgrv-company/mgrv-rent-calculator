/**
 * 비교군 최소 모수 임계값 — rent-analyze-core `isInsufficient` 판정에 사용.
 *
 * 2026-04-29 SSOT drift 패치(`fc550b9`)에서 RELAX_STEPS 단계적 완화 로직을 산정
 * 경로에서 제거하며 본 상수만 잔존. 2026-05-15 PR-A에서 `filterWithRelaxation`·
 * `itemPassesStep`·`RELAX_STEPS`·관련 interface 전체 dead code로 제거.
 */
export const MIN_COMPARABLES = 10;
