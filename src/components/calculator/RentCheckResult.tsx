"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  loadInput,
  clearInput,
  isSubmitted,
  markSubmitted,
  type RentCheckInput,
} from "@/lib/rent-check-storage";
import { calcF8Rent, SQM_PER_PYEONG } from "@/lib/rent-pricing";

interface ComputedResult {
  input: RentCheckInput;
  /** 적정 월세 (만원) */
  fairRentManwon: number;
  /** 입력 월세 vs 적정 차이 비율 (-0.10 = -10%) */
  diffPct: number;
  judgment: "low" | "fair" | "high";
  /** |입력 - 적정| (만원, 절대값) */
  diffManwon: number;
  /** 주변 평당 단가 중앙값 (원/평) */
  perPyeongMedian: number;
  comparableCount: number;
  confidenceGrade: string;
  /** 연간 시세 증가율 (%, 양수면 상승) */
  yoyGrowthPct: number | null;
}

export function RentCheckResult() {
  const router = useRouter();
  const [computed, setComputed] = useState<ComputedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // iframe 안에서 로드된 경우 부모 ContactStep에 신호 — 이중 iframe(리캐치) 시나리오 대응.
  // 리캐치 redirect로 iframe 안에 result가 박힌 상태면 ContactStep listener가 router.push로 전환.
  useEffect(() => {
    if (window.parent === window) return;
    const msg = { type: "rent-check-redirect-result" } as const;
    const origin = window.location.origin;
    const visited = new Set<Window>();
    let current: Window | null = window.parent;
    while (current && !visited.has(current)) {
      visited.add(current);
      try {
        current.postMessage(msg, origin);
      } catch {
        /* cross-origin parent — 무시, 다음 ancestor 시도 */
      }
      if (current === window.top) break;
      current = current.parent;
    }
  }, []);

  useEffect(() => {
    const input = loadInput();
    if (!input) {
      router.replace("/calculator");
      return;
    }

    let cancelled = false;
    void runAnalysis(input).then((result) => {
      if (cancelled) return;
      if ("error" in result) {
        setError(result.error);
      } else {
        setComputed(result);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  // 결과 산출 직후 Sheets A에 적재 (fire-and-forget, sessionId 멱등)
  useEffect(() => {
    if (!computed) return;
    if (isSubmitted(computed.input.sessionId)) return;
    void submitLead(computed).then((ok) => {
      if (ok) markSubmitted(computed.input.sessionId);
    });
  }, [computed]);

  if (loading) {
    return <LoadingState />;
  }

  if (error || !computed) {
    return (
      <ErrorState
        error={error ?? "결과를 불러올 수 없습니다."}
        onRetry={() => router.push("/calculator")}
      />
    );
  }

  return (
    <ResultDisplay
      computed={computed}
      onRestart={() => {
        clearInput();
        router.push("/calculator");
      }}
    />
  );
}

// ─── 데이터 흐름 ──────────────────────────────────────────────────────────────

async function runAnalysis(
  input: RentCheckInput,
): Promise<ComputedResult | { error: string }> {
  try {
    // 1. 주소 → lawdCd + 좌표
    const lookupRes = await fetch(
      `/api/address/lookup?q=${encodeURIComponent(input.address)}`,
    );
    const lookupData = await lookupRes.json();
    if (lookupData.status !== "OK" || !lookupData.data) {
      return {
        error: lookupData.error?.message ?? "주소를 인식할 수 없습니다.",
      };
    }
    const { lawdCd } = lookupData.data;

    // 2. 주변 시세 분석 — 구 단위 + 면적·연식 유사도만으로 매칭
    // V-World 지오코딩(수백 호출)은 임대인 향 MVP에 과함. 좌표 매핑 없이 minScore 5로
    // 면적·연식 유사도만 가지고 비교군 추출. 정밀 거리 기반 매칭은 향후 옵션.
    const targetAreaSqm = input.areaPyeong * SQM_PER_PYEONG;
    const analyzeRes = await fetch("/api/rent-analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lawdCd,
        siteAddress: input.address,
        targetAreaSqm,
        months: 12,
        minScore: 5,
      }),
    });
    const analyzeData = await analyzeRes.json();
    if (analyzeData.status !== "OK" || !analyzeData.stats?.perPyeong) {
      return {
        error:
          analyzeData.error?.message ?? "주변 시세 데이터를 찾을 수 없습니다.",
      };
    }

    const median: number = analyzeData.stats.perPyeong.median; // 원/평

    // 3. 적정 월세 산출 — F8 공식 단순화 호출
    const f8 = calcF8Rent({
      pricePerPyeong: median,
      netSqm: targetAreaSqm,
      totalCommonSqm: 0, // 일반 임대인은 공용공간 모름 → 0 처리
      totalUnits: 1, // commonPyeong 계산 무력화
      newConstructionPct: 0,
      furnishedPct: 0,
      depositManwon: input.depositManwon,
      noDepositSurcharge: 0,
    });

    const fairRentManwon = Math.round(f8.longTermRent / 10_000);
    const diffPct = (input.monthlyRentManwon - fairRentManwon) / fairRentManwon;
    let judgment: "low" | "fair" | "high" = "fair";
    if (diffPct < -0.1) judgment = "low";
    else if (diffPct > 0.1) judgment = "high";

    const yoyGrowth = analyzeData.trend?.yoyGrowth;
    return {
      input,
      fairRentManwon,
      diffPct,
      judgment,
      diffManwon: Math.abs(input.monthlyRentManwon - fairRentManwon),
      perPyeongMedian: median,
      comparableCount: analyzeData.confidence?.comparableCount ?? 0,
      confidenceGrade: analyzeData.confidence?.grade ?? "Low",
      yoyGrowthPct: typeof yoyGrowth === "number" ? yoyGrowth * 100 : null,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "예기치 못한 오류가 발생했습니다.",
    };
  }
}

// ─── Sheets 적재 ──────────────────────────────────────────────────────────────

async function submitLead(c: ComputedResult): Promise<boolean> {
  try {
    const judgmentLabel =
      c.judgment === "low" ? "낮음" : c.judgment === "fair" ? "적정" : "높음";
    const res = await fetch("/api/rent-leads/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: c.input.sessionId,
        name: c.input.name,
        address: c.input.address,
        areaPyeong: c.input.areaPyeong,
        depositManwon: c.input.depositManwon,
        monthlyRentManwon: c.input.monthlyRentManwon,
        fairRentManwon: c.fairRentManwon,
        diffPct: c.diffPct,
        judgmentLabel,
        perPyeongMedian: c.perPyeongMedian,
        comparableCount: c.comparableCount,
        confidenceGrade: c.confidenceGrade,
        utmSource: c.input.utmSource,
        utmMedium: c.input.utmMedium,
        utmCampaign: c.input.utmCampaign,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── UI 컴포넌트 ──────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
      <p className="text-sm text-muted-foreground">
        주변 시세를 분석하고 있어요...
      </p>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="space-y-4 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
      <p className="text-sm text-destructive">{error}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        다시 입력하기
      </Button>
    </div>
  );
}

function ResultDisplay({
  computed,
  onRestart,
}: {
  computed: ComputedResult;
  onRestart: () => void;
}) {
  const { input, fairRentManwon, judgment, diffManwon } = computed;

  return (
    <div className="space-y-6">
      <section className="space-y-1">
        <p className="text-xs text-muted-foreground">분석 대상 자산</p>
        <p className="text-base font-medium leading-tight">
          {input.address}
        </p>
        <p className="text-sm text-muted-foreground">
          전용 {input.areaPyeong}평 · 보증금 {input.depositManwon.toLocaleString()}만원
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <RentCard label="현재 월세" value={input.monthlyRentManwon} muted />
        <RentCard label="적정 시세 월세" value={fairRentManwon} highlighted />
      </section>

      <JudgmentMessage judgment={judgment} diffManwon={diffManwon} />

      <section className="space-y-2 rounded-lg bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
        <p>
          비교군: 주변 오피스텔 실거래{" "}
          <span className="font-medium text-foreground">
            {computed.comparableCount}건
          </span>{" "}
          · 신뢰도{" "}
          <span className="font-medium text-foreground">
            {computed.confidenceGrade}
          </span>
        </p>
        <p>
          평당 시세 중앙값:{" "}
          <span className="font-medium text-foreground">
            {Math.round(computed.perPyeongMedian).toLocaleString()}원/평
          </span>
        </p>
        {computed.yoyGrowthPct !== null && (
          <p>
            최근 1년 시세 추이:{" "}
            <span className="font-medium text-foreground">
              {computed.yoyGrowthPct >= 0 ? "+" : ""}
              {computed.yoyGrowthPct.toFixed(1)}%
            </span>
          </p>
        )}
      </section>

      <p className="text-xs leading-relaxed text-muted-foreground">
        본 결과는 국토교통부 실거래 데이터 기반 추정치이며, 실제 임대료 ·
        행정처분 · 법적 의사결정과 다를 수 있습니다.
      </p>

      <Button variant="outline" className="w-full" onClick={onRestart}>
        다른 자산 계산하기
      </Button>
    </div>
  );
}

function RentCard({
  label,
  value,
  muted = false,
  highlighted = false,
}: {
  label: string;
  value: number;
  muted?: boolean;
  highlighted?: boolean;
}) {
  return (
    <div
      className={
        "rounded-lg border p-4 " +
        (highlighted
          ? "border-foreground bg-foreground text-background"
          : muted
            ? "border-border bg-muted/40"
            : "border-border")
      }
    >
      <p
        className={
          "text-xs " +
          (highlighted ? "text-background/70" : "text-muted-foreground")
        }
      >
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold leading-tight sm:text-3xl">
        {value.toLocaleString()}
        <span className="ml-1 text-sm font-normal">만원</span>
      </p>
    </div>
  );
}

function JudgmentMessage({
  judgment,
  diffManwon,
}: {
  judgment: "low" | "fair" | "high";
  diffManwon: number;
}) {
  const config = {
    low: {
      emoji: "📈",
      title: `시세보다 약 ${diffManwon.toLocaleString()}만원 낮게 받고 계세요`,
      detail: "주변 시세 기준 임대료를 더 받으실 수 있어요.",
      tone: "border-blue-200 bg-blue-50 text-blue-900",
    },
    fair: {
      emoji: "✅",
      title: "적정 시세 범위에 있어요",
      detail: "현재 임대료가 주변 시세 ±10% 안에 있습니다.",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-900",
    },
    high: {
      emoji: "ℹ️",
      title: `시세보다 약 ${diffManwon.toLocaleString()}만원 높게 받고 계세요`,
      detail: "주변 시세보다 높은 임대료입니다. 공실 가능성을 점검해보세요.",
      tone: "border-amber-200 bg-amber-50 text-amber-900",
    },
  }[judgment];

  return (
    <section className={"space-y-1 rounded-lg border p-4 " + config.tone}>
      <p className="text-base font-semibold leading-snug">
        {config.emoji} {config.title}
      </p>
      <p className="text-sm opacity-80">{config.detail}</p>
    </section>
  );
}
