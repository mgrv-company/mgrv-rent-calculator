"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { loadInput } from "@/lib/rent-check-storage";
import { RecatchEmbed } from "./RecatchEmbed";

/**
 * Step 2 — 리캐치(Re:catch) 리드 폼.
 *
 * 리캐치 admin에 등록된 success URL `/calculator/result`로 폼 제출 시 redirect.
 * 리캐치 iframe target 옵션 미지원이라 redirect는 iframe 자체 안에서 일어남.
 * → result 페이지가 리캐치 iframe 안에 박히는 어색함 방지를 위해
 *   result 페이지가 mount되면 부모(이 ContactStep)에 postMessage 신호 → router.push로 SPA 전환.
 */
export function ContactStep() {
  const router = useRouter();

  useEffect(() => {
    if (!loadInput()) router.replace("/calculator");
  }, [router]);

  // 리캐치 redirect 후 iframe 안에 박힌 result 페이지의 postMessage 수신
  useEffect(() => {
    function handler(e: MessageEvent) {
      // same-origin만 (보안)
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "rent-check-redirect-result") {
        router.push("/calculator/result");
      }
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [router]);

  return (
    <div className="space-y-6">
      <header className="space-y-2 text-center">
        <h1 className="text-xl font-semibold sm:text-2xl">
          연락처를 알려주세요
        </h1>
        <p className="text-sm text-muted-foreground">
          분석 결과를 보여드리고, 추가 분석이 필요할 때 도움드릴게요.
        </p>
      </header>

      <RecatchEmbed />

      {/* 개발용 폴백: postMessage 안 동작 시 수동으로 결과 페이지 진입 */}
      {process.env.NODE_ENV !== "production" && (
        <button
          type="button"
          onClick={() => router.push("/calculator/result")}
          className="block w-full text-center text-xs text-muted-foreground underline"
        >
          [dev] 결과 보기로 직접 이동
        </button>
      )}
    </div>
  );
}
