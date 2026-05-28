import type { MolitTransaction } from "./molit-parser";
import { apiCache, GEO_CACHE_TTL } from "./api-cache";

// ─── 타입 ─────────────────────────────────────────────────────────────────────

export interface Coordinates {
  lat: number;
  lng: number;
}

// ─── 건물 키 (offiNm 빈값 방어) ──────────────────────────────────────────────

/** coordMap 키 생성 — offiNm·umdNm 빈값/공백을 정규화하여 키 불일치 방지 */
export function buildingKey(tx: {
  offiNm: string;
  umdNm: string;
  jibun: string;
}): string {
  return `${(tx.offiNm || "").trim()}|${(tx.umdNm || "").trim()}|${tx.jibun}`;
}

// ─── Haversine 거리 (km) ──────────────────────────────────────────────────────

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── 단계적 반경 확장 ─────────────────────────────────────────────────────────

export const RADIUS_STEPS_KM = [0.5, 1.0, 2.0] as const;
export const MIN_COMPARABLES_RADIUS = 10;

export interface RadiusExpansionResult<T> {
  items: T[];
  radiusUsedKm: number;
  radiusStep: number; // 0=500m, 1=1km, 2=2km, -1=미달(전체 반환)
}

/**
 * 단계적 반경 확장으로 최소 minCount건 확보
 * 500m → 1km → 2km 순으로 확장, 최소 건수 충족 시 중단
 * 최대 반경에서도 미달 시 있는 데이터 전부 반환 (radiusStep=-1)
 */
export function expandByRadius<T>(
  items: T[],
  getCoords: (item: T) => { lat: number; lng: number } | null,
  center: { lat: number; lng: number },
  minCount: number = MIN_COMPARABLES_RADIUS,
): RadiusExpansionResult<T> {
  if (items.length === 0) {
    return { items: [], radiusUsedKm: 0, radiusStep: -1 };
  }

  for (let step = 0; step < RADIUS_STEPS_KM.length; step++) {
    const radiusKm = RADIUS_STEPS_KM[step];
    const filtered = items.filter((item) => {
      const coords = getCoords(item);
      if (!coords) return false;
      return (
        haversineKm(center.lat, center.lng, coords.lat, coords.lng) <= radiusKm
      );
    });
    if (filtered.length >= minCount) {
      return { items: filtered, radiusUsedKm: radiusKm, radiusStep: step };
    }
  }

  // 최대 반경에서도 미달 — 좌표가 있는 아이템 전부 반환
  const maxRadius = RADIUS_STEPS_KM[RADIUS_STEPS_KM.length - 1];
  const allWithCoords = items.filter((item) => {
    const coords = getCoords(item);
    if (!coords) return false;
    return (
      haversineKm(center.lat, center.lng, coords.lat, coords.lng) <= maxRadius
    );
  });

  // 2km 내에도 없으면 빈 배열 반환 (거리 무제한 폴백 제거)
  if (allWithCoords.length === 0) {
    return { items: [], radiusUsedKm: maxRadius, radiusStep: -1 };
  }

  return { items: allWithCoords, radiusUsedKm: maxRadius, radiusStep: -1 };
}

// ─── 카카오 로컬 지오코딩 ─────────────────────────────────────────────────────
//
// V-World 대체. V-World는 외국 IP(Cloud Run asia-east1)에서 502로 거절돼서 사용 불가.
// 카카오 로컬 "주소로 좌표 변환" API — 외국 IP 차단 없음 + 한도 10만건/일.

const GEOCODE_TIMEOUT_MS = 5_000;
const BATCH_CONCURRENCY = 6;
const KAKAO_ADDRESS_URL = "https://dapi.kakao.com/v2/local/search/address.json";

export async function geocodeBuilding(
  fullAddress: string,
): Promise<Coordinates | null> {
  const apiKey = process.env.KAKAO_REST_API_KEY?.trim();
  if (!apiKey) return null;

  const url = new URL(KAKAO_ADDRESS_URL);
  url.searchParams.set("query", fullAddress);
  url.searchParams.set("size", "1");

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
      headers: { Authorization: `KakaoAK ${apiKey}` },
    });
    if (!res.ok) return null;
    const data: {
      documents?: { x: string; y: string }[];
    } = await res.json();
    const doc = data.documents?.[0];
    if (!doc) return null;
    const lat = parseFloat(doc.y);
    const lng = parseFloat(doc.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

/** 유니크 건물 추출 후 배치 지오코딩 */
export async function geocodeUniqueBuildings(
  transactions: MolitTransaction[],
  addressPrefix: string,
): Promise<{ coordMap: Map<string, Coordinates>; totalBuildings: number }> {
  const buildingMap = new Map<string, MolitTransaction>();
  for (const tx of transactions) {
    const key = buildingKey(tx);
    if (!buildingMap.has(key)) {
      buildingMap.set(key, tx);
    }
  }

  const entries = [...buildingMap.entries()];
  const coordMap = new Map<string, Coordinates>();

  for (let i = 0; i < entries.length; i += BATCH_CONCURRENCY) {
    const batch = entries.slice(i, i + BATCH_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async ([key, tx]) => {
        const cacheKey = `geo:${addressPrefix} ${tx.umdNm} ${tx.jibun}`;
        const cached = await apiCache.get<Coordinates>(cacheKey);
        if (cached) return { key, coords: cached };

        const addr = `${addressPrefix} ${tx.umdNm} ${tx.jibun}`.trim();
        const coords = await geocodeBuilding(addr);
        if (coords) {
          await apiCache.set(cacheKey, coords, GEO_CACHE_TTL);
        }
        return { key, coords };
      }),
    );
    for (const r of settled) {
      if (r.status === "fulfilled" && r.value.coords) {
        coordMap.set(r.value.key, r.value.coords);
      }
    }
  }

  return { coordMap, totalBuildings: buildingMap.size };
}
