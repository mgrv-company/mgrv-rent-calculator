import { NextRequest, NextResponse } from "next/server";
import { extractLawdCd, lawdCdToGuName } from "@/lib/lawd-codes";
import { VWORLD_REFERER } from "@/lib/geocoding";

export interface AddressInfo {
  jibun: string;
  roadName: string;
  lawdCd: string;
  sigunguName: string;
  lat: number;
  lng: number;
}

interface AddressLookupResponse {
  status: "OK" | "ERROR";
  data?: AddressInfo;
  error?: { code: string; message: string };
}

const VWORLD_TIMEOUT_MS = 5_000;
const VWORLD_SEARCH_URL = "https://api.vworld.kr/req/search";
const VWORLD_ADDRESS_URL = "https://api.vworld.kr/req/address";

interface VworldSearchItem {
  id: string;
  title: string;
  category: "parcel" | "road";
  address: {
    parcel?: string;
    road?: string;
    zipcode?: string;
    bldnm?: string;
  };
  point: { x: string; y: string };
}

async function searchVworld(
  query: string,
  category: "parcel" | "road",
  apiKey: string,
): Promise<VworldSearchItem | null> {
  const url = new URL(VWORLD_SEARCH_URL);
  url.searchParams.set("service", "search");
  url.searchParams.set("request", "search");
  url.searchParams.set("version", "2.0");
  url.searchParams.set("crs", "EPSG:4326");
  url.searchParams.set("size", "1");
  url.searchParams.set("page", "1");
  url.searchParams.set("type", "ADDRESS");
  url.searchParams.set("category", category);
  url.searchParams.set("format", "json");
  url.searchParams.set("errorformat", "json");
  url.searchParams.set("query", query);
  url.searchParams.set("key", apiKey);

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(VWORLD_TIMEOUT_MS),
      headers: { Referer: VWORLD_REFERER },
    });
    const data: {
      response?: {
        status?: string;
        result?: { items?: VworldSearchItem[] };
      };
    } = await res.json();
    if (data.response?.status === "OK" && data.response.result?.items?.[0]) {
      return data.response.result.items[0];
    }
  } catch {
    // V-World 일시 장애 — 호출자에서 다음 단계로 fallback
  }
  return null;
}

/**
 * V-World 역지오코딩 (좌표 → 시군구코드).
 * search 응답에 구 이름이 없을 때 보조 경로로 사용.
 * mass-study/backend/routers/parcel.py `_get_pnu_from_geocoder` 참고.
 *
 * @returns level4LC 5자리 시군구코드 (예: 11680=강남, 11440=마포). 실패 시 null.
 */
async function reverseGeocode(
  lat: number,
  lng: number,
  apiKey: string,
): Promise<string | null> {
  const url = new URL(VWORLD_ADDRESS_URL);
  url.searchParams.set("service", "address");
  url.searchParams.set("request", "getAddress");
  url.searchParams.set("type", "PARCEL");
  // V-World point 포맷: "경도,위도" 순서 (lng,lat)
  url.searchParams.set("point", `${lng},${lat}`);
  url.searchParams.set("crs", "EPSG:4326");
  url.searchParams.set("format", "json");
  url.searchParams.set("key", apiKey);

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(VWORLD_TIMEOUT_MS),
      headers: { Referer: VWORLD_REFERER },
    });
    const data = await res.json();
    // V-World가 HTTP 200으로 ERROR status를 돌려주는 케이스 명시 가드
    if (data?.response?.status !== "OK") return null;
    // level4LC는 10자리 법정동코드 (시군구 5 + 법정동 5). 시군구 5자리만 추출.
    const level4LC = data.response.result?.[0]?.structure?.level4LC;
    if (typeof level4LC === "string" && level4LC.length === 10) {
      return level4LC.slice(0, 5);
    }
  } catch {
    // 실패 시 null 반환 (호출 측에서 OUT_OF_SEOUL 처리)
  }
  return null;
}

export async function GET(
  req: NextRequest,
): Promise<NextResponse<AddressLookupResponse>> {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json(
      {
        status: "ERROR",
        error: {
          code: "MISSING_QUERY",
          message: "주소(q) 파라미터가 필요합니다.",
        },
      },
      { status: 400 },
    );
  }

  const apiKey = process.env.VWORLD_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        status: "ERROR",
        error: {
          code: "MISSING_API_KEY",
          message: "VWORLD_API_KEY가 설정되지 않았습니다.",
        },
      },
      { status: 500 },
    );
  }

  // PARCEL → ROAD 순 폴백 (PRD §F1)
  let item = await searchVworld(q, "parcel", apiKey);
  if (!item) {
    item = await searchVworld(q, "road", apiKey);
  }
  if (!item) {
    return NextResponse.json(
      {
        status: "ERROR",
        error: {
          code: "NOT_FOUND",
          message:
            "주소를 찾을 수 없습니다. 지번 또는 도로명 형식을 확인하세요.",
        },
      },
      { status: 404 },
    );
  }

  const jibun = item.address.parcel ?? item.title ?? "";
  const roadName = item.address.road ?? "";
  const fullAddress = jibun || roadName;
  const lat = parseFloat(item.point.y);
  const lng = parseFloat(item.point.x);

  // V-World 응답이 비정상이라 좌표 파싱 실패 시 NaN을 응답에 흘리지 않음
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json(
      {
        status: "ERROR",
        error: {
          code: "NOT_FOUND",
          message:
            "주소를 찾을 수 없습니다. 지번 또는 도로명 형식을 확인하세요.",
        },
      },
      { status: 404 },
    );
  }

  // 1차: search 응답 문자열에서 구 이름 추출
  let lawdCd = extractLawdCd(fullAddress);

  // 2차 폴백: 좌표 → 역지오코딩으로 시군구코드 직접 획득
  // (도로명 입력 시 search 응답에 구 이름이 없는 경우 대응)
  if (!lawdCd) {
    const reversed = await reverseGeocode(lat, lng, apiKey);
    if (reversed && lawdCdToGuName(reversed)) {
      // 서울 25개 구 매칭 시에만 채택 (서울 외는 SEOUL_GU_CODES에 없음 → null)
      lawdCd = reversed;
    }
  }

  if (!lawdCd) {
    return NextResponse.json(
      {
        status: "ERROR",
        error: {
          code: "OUT_OF_SEOUL",
          message:
            "현재는 서울 25개 구만 지원합니다. 주소에 구 이름이 포함되어 있는지 확인하세요.",
        },
      },
      { status: 422 },
    );
  }
  const guName = lawdCdToGuName(lawdCd) ?? "";

  return NextResponse.json({
    status: "OK",
    data: {
      jibun,
      roadName,
      lawdCd,
      sigunguName: guName ? `서울특별시 ${guName}` : "",
      lat,
      lng,
    },
  });
}
