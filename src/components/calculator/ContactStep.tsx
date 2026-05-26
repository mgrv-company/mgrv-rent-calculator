"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { loadInput } from "@/lib/rent-check-storage";

/**
 * Step 2 — 리캐치(Re:catch) 리드 폼 임베드 자리.
 *
 * Phase 1 (현재): mock — "결과 보기" 버튼 클릭 시 곧바로 /calculator/result 이동.
 * Phase 2 (예정): 리캐치 iframe 임베드 + 폼 제출 detection.
 *   - 리캐치 success URL이 `/calculator/result`로 등록되어 있어 폼 제출 시 자동 라우팅.
 *   - postMessage detection은 보조 안전망으로 추가 예정.
 */
export function ContactStep() {
  const router = useRouter();

  // 입력 없으면 첫 페이지로 (URL 직접 진입 방어)
  useEffect(() => {
    if (!loadInput()) router.replace("/calculator");
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

      <div className="rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          [Phase 2 — 리캐치(Re:catch) 리드 폼 임베드 자리]
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          실 배포에서는 리캐치 iframe이 여기에 노출되며, 제출 시 자동으로 결과
          페이지로 이동합니다.
        </p>
      </div>

      <Button
        className="w-full h-12 text-base"
        onClick={() => router.push("/calculator/result")}
      >
        [개발용] 결과 보기
      </Button>
    </div>
  );
}
