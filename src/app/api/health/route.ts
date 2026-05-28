import { NextResponse } from "next/server";

/**
 * 진단용 endpoint — 런타임 env 주입 상태 확인.
 *
 * 안전: secret 값 자체는 응답에 노출하지 않음 (boolean으로만 표시).
 * 배포 후 https://<backend>/api/health 로 시크릿 주입 여부 검증.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    env: {
      GCLOUD_PROJECT: process.env.GCLOUD_PROJECT ?? null,
      hasMolitKey: !!process.env.DATA_GO_KR_API_KEY?.trim(),
      hasVworldKey: !!process.env.VWORLD_API_KEY?.trim(),
      vworldReferer: process.env.VWORLD_REFERER ?? null,
      sheetId: process.env.RENT_LEADS_SHEET_ID ?? null,
      nodeVersion: process.version,
    },
  });
}
