/**
 * Runtime Secret 로딩 (apphosting.yaml secret 매핑 우회)
 *
 * Firebase App Hosting의 platform 버그 우회 — `secret:` 매핑이 빌드 시점에
 * PermissionDenied 에러 발생 (https://github.com/GoogleCloudPlatform/buildpacks/issues/561).
 *
 * 대안: API route 첫 호출 시 Secret Manager API에서 직접 fetch + process.env 주입.
 * Runtime SA(firebase-app-hosting-compute@...)가 ADC 자동 인증 + secret access 권한
 * (secret-level IAM에 부여됨).
 *
 * 로컬 dev: .env.local에 이미 값 있어 process.env 채워진 상태 → skip.
 * Prod: Secret Manager에서 1회 fetch 후 module-level 캐시.
 */

import { GoogleAuth } from "google-auth-library";

interface SecretMap {
  /** secret 이름 → process.env 변수 이름 매핑 */
  [secretName: string]: string;
}

/** apphosting.yaml에서 매핑하던 secret들. 키=Secret Manager 이름, 값=process.env 변수 이름 */
const REMOTE_SECRETS: SecretMap = {
  DATA_GO_KR_API_KEY: "DATA_GO_KR_API_KEY",
  VWORLD_API_KEY: "VWORLD_API_KEY",
};

let bootstrapPromise: Promise<void> | null = null;

export async function ensureSecretsLoaded(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    try {
      // 로컬 dev: .env.local로 이미 채워진 경우 skip
      const allLocal = Object.values(REMOTE_SECRETS).every(
        (envName) => !!process.env[envName]?.trim(),
      );
      if (allLocal) {
        console.log("[secrets-bootstrap] local env present, skip fetch");
        return;
      }

      // Prod: Secret Manager에서 fetch
      const projectId =
        process.env.GCLOUD_PROJECT?.trim() ||
        process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
        "mgrv-growth-opservice-db";

      console.log(`[secrets-bootstrap] fetching secrets for project=${projectId}`);

      const auth = new GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      });
      const client = await auth.getClient();
      const tokenResp = await client.getAccessToken();
      const token = tokenResp.token;
      if (!token) throw new Error("ADC access token 발급 실패");

      console.log("[secrets-bootstrap] ADC token acquired");

      await Promise.all(
        Object.entries(REMOTE_SECRETS).map(async ([secretName, envName]) => {
          if (process.env[envName]?.trim()) return;
          const value = await fetchSecret(projectId, secretName, token);
          process.env[envName] = value;
          console.log(
            `[secrets-bootstrap] loaded ${secretName} (${value.length} chars)`,
          );
        }),
      );

      console.log("[secrets-bootstrap] all secrets loaded");
    } catch (err) {
      console.error("[secrets-bootstrap] FATAL:", err);
      // 한 번 실패하면 cache 비워 다음 호출에 재시도
      bootstrapPromise = null;
      throw err;
    }
  })();

  return bootstrapPromise;
}

async function fetchSecret(
  projectId: string,
  secretName: string,
  token: string,
): Promise<string> {
  const url =
    `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
    `/secrets/${encodeURIComponent(secretName)}/versions/latest:access`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Secret Manager ${res.status} (${secretName}): ${text.slice(0, 200)}`,
    );
  }

  const data = (await res.json()) as { payload?: { data?: string } };
  if (!data.payload?.data) {
    throw new Error(`Secret Manager empty payload for ${secretName}`);
  }
  return Buffer.from(data.payload.data, "base64").toString("utf-8");
}
