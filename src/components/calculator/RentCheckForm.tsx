"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveInput } from "@/lib/rent-check-storage";

export function RentCheckForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [areaPyeong, setAreaPyeong] = useState("");
  const [depositManwon, setDepositManwon] = useState("");
  const [monthlyRentManwon, setMonthlyRentManwon] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const area = parseFloat(areaPyeong);
    const deposit = parseFloat(depositManwon);
    const rent = parseFloat(monthlyRentManwon);

    if (!name.trim()) return setError("이름을 입력해주세요.");
    if (!address.trim()) return setError("자산 주소를 입력해주세요.");
    if (!area || area <= 0 || area > 200)
      return setError("전용면적은 1~200평 사이여야 합니다.");
    if (isNaN(deposit) || deposit < 0 || deposit > 100000)
      return setError("보증금은 0~10억원(만원 단위) 사이여야 합니다.");
    if (isNaN(rent) || rent <= 0 || rent > 5000)
      return setError("월세는 1~5천만원 사이여야 합니다.");

    saveInput({
      name: name.trim(),
      address: address.trim(),
      areaPyeong: area,
      depositManwon: deposit,
      monthlyRentManwon: rent,
      sessionId:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      utmSource: searchParams.get("utm_source") ?? undefined,
      utmMedium: searchParams.get("utm_medium") ?? undefined,
      utmCampaign: searchParams.get("utm_campaign") ?? undefined,
    });

    router.push("/calculator/contact");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="name">이름</Label>
        <Input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="홍길동"
          autoComplete="name"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="address">자산 주소</Label>
        <Input
          id="address"
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="예: 서울 중구 충무로3가 56-16"
          required
        />
        <p className="text-xs text-muted-foreground">
          지번 또는 도로명 주소 모두 가능 (서울 25개 구 지원)
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="area">전용면적 (평)</Label>
        <Input
          id="area"
          type="number"
          inputMode="decimal"
          value={areaPyeong}
          onChange={(e) => setAreaPyeong(e.target.value)}
          placeholder="25"
          min="1"
          max="200"
          step="0.1"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="deposit">보증금 (만원)</Label>
          <Input
            id="deposit"
            type="number"
            inputMode="decimal"
            value={depositManwon}
            onChange={(e) => setDepositManwon(e.target.value)}
            placeholder="1000"
            min="0"
            max="100000"
            step="100"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="rent">월세 (만원)</Label>
          <Input
            id="rent"
            type="number"
            inputMode="decimal"
            value={monthlyRentManwon}
            onChange={(e) => setMonthlyRentManwon(e.target.value)}
            placeholder="100"
            min="1"
            max="5000"
            step="1"
            required
          />
        </div>
      </div>

      {error && (
        <p
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}

      <Button type="submit" className="w-full h-12 text-base">
        계산하기
      </Button>

      <p className="text-xs text-muted-foreground text-center">
        입력 정보는 시세 분석에만 사용되며, 외부에 공개되지 않습니다.
      </p>
    </form>
  );
}
