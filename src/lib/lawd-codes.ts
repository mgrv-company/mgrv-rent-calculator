/** 서울특별시 25개 구 법정동코드 (시군구 5자리) */
export const SEOUL_GU_CODES: Record<string, string> = {
  '종로구': '11110',
  '중구': '11140',
  '용산구': '11170',
  '성동구': '11200',
  '광진구': '11215',
  '동대문구': '11230',
  '중랑구': '11260',
  '성북구': '11290',
  '강북구': '11305',
  '도봉구': '11320',
  '노원구': '11350',
  '은평구': '11380',
  '서대문구': '11410',
  '마포구': '11440',
  '양천구': '11470',
  '강서구': '11500',
  '구로구': '11530',
  '금천구': '11545',
  '영등포구': '11560',
  '동작구': '11590',
  '관악구': '11620',
  '서초구': '11650',
  '강남구': '11680',
  '송파구': '11710',
  '강동구': '11740',
}

/** 주소 문자열에서 서울 구를 추출하여 법정동코드 반환. 못 찾으면 null */
export function extractLawdCd(address: string): string | null {
  for (const [gu, code] of Object.entries(SEOUL_GU_CODES)) {
    if (address.includes(gu)) return code
  }
  return null
}

/** 법정동코드로 구 이름 찾기 */
export function lawdCdToGuName(code: string): string | null {
  for (const [gu, c] of Object.entries(SEOUL_GU_CODES)) {
    if (c === code) return gu
  }
  return null
}

// ─── 서울 25개 구 대표 좌표 (구청 위치 기준) ─────────────────────────────────

export interface GuCoordinate {
  code: string
  name: string
  lat: number
  lng: number
}

export const SEOUL_GU_COORDS: GuCoordinate[] = [
  { code: '11110', name: '종로구', lat: 37.5735, lng: 126.9790 },
  { code: '11140', name: '중구', lat: 37.5641, lng: 126.9979 },
  { code: '11170', name: '용산구', lat: 37.5326, lng: 126.9906 },
  { code: '11200', name: '성동구', lat: 37.5634, lng: 127.0369 },
  { code: '11215', name: '광진구', lat: 37.5385, lng: 127.0823 },
  { code: '11230', name: '동대문구', lat: 37.5744, lng: 127.0399 },
  { code: '11260', name: '중랑구', lat: 37.6066, lng: 127.0928 },
  { code: '11290', name: '성북구', lat: 37.5894, lng: 127.0167 },
  { code: '11305', name: '강북구', lat: 37.6397, lng: 127.0255 },
  { code: '11320', name: '도봉구', lat: 37.6688, lng: 127.0472 },
  { code: '11350', name: '노원구', lat: 37.6543, lng: 127.0568 },
  { code: '11380', name: '은평구', lat: 37.6027, lng: 126.9291 },
  { code: '11410', name: '서대문구', lat: 37.5791, lng: 126.9368 },
  { code: '11440', name: '마포구', lat: 37.5664, lng: 126.9014 },
  { code: '11470', name: '양천구', lat: 37.5170, lng: 126.8665 },
  { code: '11500', name: '강서구', lat: 37.5510, lng: 126.8495 },
  { code: '11530', name: '구로구', lat: 37.4954, lng: 126.8874 },
  { code: '11545', name: '금천구', lat: 37.4569, lng: 126.8956 },
  { code: '11560', name: '영등포구', lat: 37.5264, lng: 126.8963 },
  { code: '11590', name: '동작구', lat: 37.5124, lng: 126.9393 },
  { code: '11620', name: '관악구', lat: 37.4784, lng: 126.9516 },
  { code: '11650', name: '서초구', lat: 37.4837, lng: 127.0324 },
  { code: '11680', name: '강남구', lat: 37.5173, lng: 127.0473 },
  { code: '11710', name: '송파구', lat: 37.5146, lng: 127.1050 },
  { code: '11740', name: '강동구', lat: 37.5301, lng: 127.1238 },
]

/**
 * 대상 좌표에서 maxDistKm 이내의 구 코드를 반환
 * 대상 구 포함, 인접 구까지 반환
 */
export function findNearbyGuCodes(
  center: { lat: number; lng: number },
  maxDistKm: number = 2.0,
): string[] {
  // haversineKm을 여기서 직접 계산 (geocoding.ts import 순환 방지)
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dist = (lat2: number, lng2: number) => {
    const dLat = toRad(lat2 - center.lat)
    const dLng = toRad(lng2 - center.lng)
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(center.lat)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }

  return SEOUL_GU_COORDS
    .map((gu) => ({ code: gu.code, dist: dist(gu.lat, gu.lng) }))
    .filter((g) => g.dist <= maxDistKm)
    .sort((a, b) => a.dist - b.dist)
    .map((g) => g.code)
}

/**
 * 대상 구를 제외한 인접 구 코드를 거리순으로 반환
 * route.ts에서 점진적 확장 시 사용
 */
export function findExpansionGuCodes(
  center: { lat: number; lng: number },
  excludeCode: string,
  maxDistKm: number = 5.0,
): string[] {
  return findNearbyGuCodes(center, maxDistKm)
    .filter((code) => code !== excludeCode)
}

/** lawdCd → "서울특별시 {구이름}" 형태의 주소 접두어 생성 */
export function buildAddressPrefix(lawdCd: string): string {
  const guName = lawdCdToGuName(lawdCd)
  return guName ? `서울특별시 ${guName}` : ''
}

/** 주소에서 동명(읍면동) 추출. 구 이름 기준으로 찾으므로 주소 포맷에 강건 */
export function extractUmdNm(address: string, lawdCd: string): string {
  const guName = lawdCdToGuName(lawdCd)
  if (!guName) return ''
  const guIdx = address.indexOf(guName)
  if (guIdx < 0) return ''
  const afterGu = address.slice(guIdx + guName.length).trim()
  const firstWord = afterGu.split(/\s+/)[0] || ''
  return firstWord
}
