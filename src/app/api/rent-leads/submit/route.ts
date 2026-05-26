import { NextRequest, NextResponse } from "next/server";
import { appendSheetRow } from "@/lib/sheets-client";

interface RentLeadSubmitRequest {
  sessionId: string;
  name: string;
  address: string;
  areaPyeong: number;
  depositManwon: number;
  monthlyRentManwon: number;
  fairRentManwon: number;
  diffPct: number;
  judgmentLabel: string;
  perPyeongMedian: number;
  comparableCount: number;
  confidenceGrade: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

interface RentLeadSubmitResponse {
  status: "OK" | "ERROR";
  error?: { code: string; message: string };
}

export async function POST(
  req: NextRequest,
): Promise<NextResponse<RentLeadSubmitResponse>> {
  const sheetId = process.env.RENT_LEADS_SHEET_ID?.trim();
  const sheetTab = process.env.RENT_LEADS_SHEET_TAB?.trim() ?? "계산기_raw";

  if (!sheetId) {
    return NextResponse.json(
      {
        status: "ERROR",
        error: {
          code: "MISSING_SHEET_ID",
          message: "RENT_LEADS_SHEET_ID 환경변수가 설정되지 않았습니다.",
        },
      },
      { status: 500 },
    );
  }

  let body: RentLeadSubmitRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        status: "ERROR",
        error: {
          code: "INVALID_BODY",
          message: "요청 본문을 파싱할 수 없습니다.",
        },
      },
      { status: 400 },
    );
  }

  if (
    !body.sessionId ||
    !body.name ||
    !body.address ||
    typeof body.fairRentManwon !== "number"
  ) {
    return NextResponse.json(
      {
        status: "ERROR",
        error: { code: "MISSING_FIELDS", message: "필수 필드가 누락되었습니다." },
      },
      { status: 400 },
    );
  }

  const kstTimestamp = new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  // 컬럼 순서:
  // timestamp · sessionId · 이름 · 주소 · 평수 · 보증금(만원) · 월세(만원)
  // · 시세월세(만원) · 차이(%) · 판정 · 신뢰도 · 비교건수 · 평당시세(원/평)
  // · utm_source · utm_medium · utm_campaign
  const row: (string | number | null)[] = [
    kstTimestamp,
    body.sessionId,
    body.name,
    body.address,
    body.areaPyeong,
    body.depositManwon,
    body.monthlyRentManwon,
    body.fairRentManwon,
    Math.round(body.diffPct * 1000) / 10, // 소수1자리 % (예: -15.0)
    body.judgmentLabel,
    body.confidenceGrade,
    body.comparableCount,
    body.perPyeongMedian,
    body.utmSource ?? "",
    body.utmMedium ?? "",
    body.utmCampaign ?? "",
  ];

  try {
    await appendSheetRow(sheetId, sheetTab, row);
    return NextResponse.json({ status: "OK" });
  } catch (err) {
    console.error("[rent-leads/submit] Sheets append 실패:", err);
    return NextResponse.json(
      {
        status: "ERROR",
        error: {
          code: "SHEETS_APPEND_FAILED",
          message: err instanceof Error ? err.message : "Sheets 적재 실패",
        },
      },
      { status: 500 },
    );
  }
}
