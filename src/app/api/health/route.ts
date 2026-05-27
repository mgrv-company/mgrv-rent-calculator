import { NextResponse } from "next/server";
import { ensureSecretsLoaded } from "@/lib/secrets-bootstrap";

/**
 * 진단용 endpoint — secret 로딩 + env 상태 확인.
 *
 * 안전: secret 값 자체는 응답에 노출하지 않음 (boolean으로만 표시).
 */
export async function GET() {
  try {
    await ensureSecretsLoaded();
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[health] ensureSecretsLoaded failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error: {
          message,
          stack: stack?.split("\n").slice(0, 10).join("\n"),
        },
      },
      { status: 500 },
    );
  }
}
