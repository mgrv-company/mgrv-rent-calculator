import type { MolitTransaction } from "./molit-parser";
import { apiCache, GEO_CACHE_TTL } from "./api-cache";

// ─── V-World Referer (env 기반) ───────────────────────────────────────────────

/**
 * V-World API 호출 시 보낼 Referer.
 * V-World 인증키는 발급 시 등록 도메인(Whitelist)을 강제 검증하므로,
 * 환경별로 다른 도메인을 박을 수 있게 env로 분리. default는 prod 도메인.
 *
 * - prod: `https://da-rent-mgrv.web.app` (apphosting.yaml에서 명시)
 * - 로컬: `.env.local`에 미설정 시 default(prod 도메인) 사용
 */
export const VWORLD_REFERER =
  process.env.VWORLD_REFERER ?? "https://da-rent-mgrv.web.app";

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

// ─── V-World 지오코딩 ─────────────────────────────────────────────────────────

const GEOCODE_TIMEOUT_MS = 5_000;
const BATCH_CONCURRENCY = 6;

export async function geocodeBuilding(
  fullAddress: string,
): Promise<Coordinates | null> {
  const apiKey = process.env.VWORLD_API_KEY?.trim();
  if (!apiKey) return null;

  // 지번(PARCEL) → 도로명(ROAD) 순서로 시도
  for (const addrType of ["PARCEL", "ROAD"] as const) {
    const url = new URL("https://api.vworld.kr/req/address");
    url.searchParams.set("service", "address");
    url.searchParams.set("request", "getCoord");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("type", addrType);
    url.searchParams.set("address", fullAddress);
    url.searchParams.set("format", "json");
    url.searchParams.set("crs", "EPSG:4326");

    try {
      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
        headers: { Referer: VWORLD_REFERER },
      });
      const data = await res.json();

      if (data.response?.status === "OK" && data.response.result?.point) {
        const { x, y } = data.response.result.point;
        return { lat: parseFloat(y), lng: parseFloat(x) };
      }
    } catch {
      // 이 타입으로 실패 → 다음 타입 시도
    }
  }
  return null;
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
