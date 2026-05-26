/**
 * Google Sheets API append wrapper.
 *
 * 인증: ADC (Application Default Credentials) — 별도 SA 키 파일 불필요.
 *   - 로컬 dev: `gcloud auth application-default login` 으로 사용자 자격증명 사용
 *   - Cloud Run prod: runtime SA가 자동 인증 (key 파일 X)
 *
 * Sheets에 SA 또는 사용자 이메일이 편집자 권한으로 추가되어 있어야 함.
 */

import { GoogleAuth } from "google-auth-library";

const SHEETS_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

let cachedAuth: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  if (cachedAuth) return cachedAuth;
  cachedAuth = new GoogleAuth({ scopes: SHEETS_SCOPES });
  return cachedAuth;
}

/**
 * 시트 끝에 row 1개 append (`USER_ENTERED` — 사용자가 직접 입력한 것처럼 처리).
 *
 * @param spreadsheetId  대상 시트 ID
 * @param sheetTab       탭 이름 (예: "계산기_raw"). URL encoding 자동.
 * @param row            row 값 배열 (각 cell 단일 값). null 가능.
 */
export async function appendSheetRow(
  spreadsheetId: string,
  sheetTab: string,
  row: ReadonlyArray<string | number | null>,
): Promise<void> {
  const auth = getAuth();
  const client = await auth.getClient();
  const tokenResp = await client.getAccessToken();
  const token = tokenResp.token;
  if (!token) throw new Error("ADC access token 발급 실패");

  // range 표기: `시트탭!A1` — append는 A1부터 데이터 끝 다음 빈 row를 자동 탐색
  const range = `${sheetTab}!A1`;
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(range)}:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: [row] }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sheets API ${res.status}: ${text.slice(0, 200)}`);
  }
}
