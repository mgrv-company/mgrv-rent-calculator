"use client";

import { useEffect } from "react";

/**
 * 리캐치(Re:catch) 리드 폼 임베드.
 *
 * 흐름:
 * 1. cdn.recatch.cc script를 동적 추가 (한 번만)
 * 2. iframe 렌더링
 * 3. 사용자 폼 제출 → 리캐치 admin에 등록된 success URL `/calculator/result`로 redirect
 *    (리캐치 iframe 안에서 navigate 발생)
 * 4. result 페이지가 리캐치 iframe 안에서 로드되면 `postMessage`로 부모에 신호
 *    → ContactStep listener가 받아서 router.push로 result로 전환 (contact DOM 사라짐)
 */
export function RecatchEmbed() {
  useEffect(() => {
    if (document.getElementById("recatch-embed-script")) return;
    const script = document.createElement("script");
    script.id = "recatch-embed-script";
    script.async = true;
    script.defer = true;
    script.src =
      "https://cdn.recatch.cc/recatch-embed.iife.js?t=mgrv&b=zxjgtbyzvo&c=recatch-form&tr=true&th=light&mode=sdk";
    document.head.prepend(script);
  }, []);

  return (
    <div className="w-full" style={{ minHeight: 560 }}>
      <iframe
        src="https://mgrv.recatch.cc/workflows/zxjgtbyzvo"
        className="h-full w-full border-0"
        style={{ width: "100%", height: 560, border: "none" }}
        title="연락처 입력 폼"
      />
    </div>
  );
}
