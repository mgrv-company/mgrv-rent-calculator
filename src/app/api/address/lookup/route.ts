import { NextRequest, NextResponse } from "next/server";
import { lawdCdToGuName } from "@/lib/lawd-codes";

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

// ─── 카카오 로컬 API (주소 검색) ─────────────────────────────────────────────
//
// V-World 대체. V-World는 외국 IP(Cloud Run asia-east1)에서 502로 거절돼서 사용 불가.
// 카카오는 외국 IP 차단 없음 + REST API 키 + Authorization 헤더만으로 인증.
//
// 한 번 호출로 jibun · road name · b_code(10자리 법정동코드) · 좌표 다 받음
// → V-World처럼 search + reverseGeocode 2단계 폴백 불필요.

const KAKAO_TIMEOUT_MS = 5_000;
const KAKAO_ADDRESS_URL = "https://dapi.kakao.com/v2/local/search/address.json";

interface KakaoAddressDocument {
  address_name: string;
  address_type: string;
  x: string; // lng
  y: string; // lat
  address: {
    address_name: string;
    region_1depth_name: string;
    region_2depth_name: string;
    region_3depth_name: string;
    b_code: string; // 10자리 법정동코드
  } | null;
  road_address: {
    address_name: string;
  } | null;
}

interface KakaoAddressResponse {
  meta?: { total_count: number };
  documents?: KakaoAddressDocument[];
}

async function fetchKakao(
  query: string,
  apiKey: string,
): Promise<KakaoAddressDocument | null> {
  const url = new URL(KAKAO_ADDRESS_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("size", "1");
  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(KAKAO_TIMEOUT_MS),
      headers: { Authorization: `KakaoAK ${apiKey}` },
    });
    if (!res.ok) return null;
    const data: KakaoAddressResponse = await res.json();
    return data.documents?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * 카카오 v2 주소 검색이 "서울시 서대문구 서강로 121" 같은 verbose 한국식 풀-주소를
 * 못 찾는 케이스가 흔함 (도로명+번지에 특화). 자동 폴백으로 매칭률 회복:
 *
 * 1. 원본 그대로
 * 2. "서울시" → "서울특별시" 정규화
 * 3. "서울(특별시)" 접두사 제거
 * 4. 시군구까지 제거하고 도로명+번지만 (region이 서울인 경우만 채택)
 */
async function searchKakaoAddress(
  query: string,
  apiKey: string,
): Promise<KakaoAddressDocument | null> {
  // 1. 원본
  let doc = await fetchKakao(query, apiKey);
  if (doc) return doc;

  // 2. "서울시" → "서울특별시"
  const normalized = query.replace(/^서울시(\s|$)/, "서울특별시$1");
  if (normalized !== query) {
    doc = await fetchKakao(normalized, apiKey);
    if (doc) return doc;
  }

  // 3. "서울(특별시)" 접두사 제거
  const stripSido = query.replace(/^(서울특별시|서울시|서울)\s+/, "");
  if (stripSido !== query) {
    doc = await fetchKakao(stripSido, apiKey);
    if (doc) return doc;
  }

  // 4. 시군구까지 제거 — region check로 서울만 채택
  const stripGu = stripSido.replace(/^[가-힣]+구\s+/, "");
  if (stripGu !== stripSido) {
    doc = await fetchKakao(stripGu, apiKey);
    if (doc?.address?.region_1depth_name === "서울") return doc;
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

  const apiKey = process.env.KAKAO_REST_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        status: "ERROR",
        error: {
          code: "MISSING_API_KEY",
          message: "KAKAO_REST_API_KEY가 설정되지 않았습니다.",
        },
      },
      { status: 500 },
    );
  }

  const doc = await searchKakaoAddress(q, apiKey);
  if (!doc || !doc.address) {
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

  const jibun = doc.address.address_name;
  const roadName = doc.road_address?.address_name ?? "";
  const lat = parseFloat(doc.y);
  const lng = parseFloat(doc.x);

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

  // b_code(10자리) → 시군구 5자리 lawdCd
  const lawdCd = doc.address.b_code?.slice(0, 5);
  const guName = lawdCd ? lawdCdToGuName(lawdCd) : null;
  if (!lawdCd || !guName) {
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

  return NextResponse.json({
    status: "OK",
    data: {
      jibun,
      roadName,
      lawdCd,
      sigunguName: `서울특별시 ${guName}`,
      lat,
      lng,
    },
  });
}
