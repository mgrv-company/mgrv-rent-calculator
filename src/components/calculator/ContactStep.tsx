"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { loadInput } from "@/lib/rent-check-storage";
import { RecatchEmbed } from "./RecatchEmbed";

const RECATCH_ORIGIN = "https://mgrv.recatch.cc";

/**
 * Step 2 — 리캐치(Re:catch) 리드 폼.
 *
 * 자동 라우팅 전략 (3중 폴백):
 * 1. 리캐치 admin redirect URL → iframe 안에 우리 result 페이지가 박힘 → RentCheckResult가
 *    부모(ContactStep)에 postMessage 신호 → router.push로 SPA 전환
 * 2. 리캐치 자체 postMessage (form submit 이벤트) — 일반적 type 패턴 매칭
 * 3. 사용자가 직접 [결과 보기] 버튼 클릭 (수동 폴백, 항상 표시)
 *
 * localhost dev에서는 (1)이 prod URL이라 동작 안 함 → (3) 버튼으로 폴백 필요.
 */
export function ContactStep() {
  const router = useRouter();

  useEffect(() => {
    if (!loadInput()) router.replace("/calculator");
  }, [router]);

  useEffect(() => {
    function handler(e: MessageEvent) {
      // dev 디버깅: 어떤 message가 오는지 콘솔에 표시
      if (process.env.NODE_ENV !== "production") {
        console.log("[ContactStep] message received:", e.origin, e.data);
      }

      // 패턴 1: 우리 result 페이지가 iframe 안에서 보낸 신호 (same-origin)
      if (
        e.origin === window.location.origin &&
        e.data?.type === "rent-check-redirect-result"
      ) {
        router.push("/calculator/result");
        return;
      }

      // 패턴 2: 리캐치 자체가 보내는 폼 제출 완료 신호 (있다면)
      if (e.origin === RECATCH_ORIGIN) {
        const raw = e.data;
        const type =
          typeof raw === "string"
            ? raw
            : ((raw?.type ?? raw?.event ?? raw?.action ?? "") as string);
        const lower = type.toLowerCase();
        if (
          lower.includes("submit") ||
          lower.includes("complete") ||
          lower.includes("success")
        ) {
          router.push("/calculator/result");
        }
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

      <div className="border-t pt-4 space-y-3 text-center">
        <p className="text-xs text-muted-foreground">
          폼 제출이 완료되었는데 결과 페이지가 자동으로 나타나지 않는다면 아래
          버튼을 눌러주세요.
        </p>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => router.push("/calculator/result")}
        >
          결과 보기
        </Button>
      </div>
    </div>
  );
}
