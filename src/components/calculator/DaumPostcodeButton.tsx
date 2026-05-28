"use client";

import { useState } from "react";
import Script from "next/script";
import { Button } from "@/components/ui/button";

// Daum 우편번호 SDK (https://postcode.map.daum.net/guide)
// 외부 SDK라 자체 .d.ts 안 만들고 한 곳에서만 쓰므로 inline 선언.

interface DaumPostcodeData {
  /** 도로명 주소 (예: "서울 마포구 서강로 121") */
  roadAddress: string;
  /** 지번 주소 (예: "서울 마포구 노고산동 56-74") */
  jibunAddress: string;
  /** 우편번호 5자리 */
  zonecode: string;
  /** 건물명 (예: "광장빌딩") */
  buildingName: string;
  /** 사용자가 선택한 주소 타입: R=도로명, J=지번 */
  userSelectedType: "R" | "J";
}

declare global {
  interface Window {
    daum?: {
      Postcode: new (config: {
        oncomplete: (data: DaumPostcodeData) => void;
      }) => { open: () => void };
    };
  }
}

const DAUM_SDK_URL =
  "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";

interface DaumPostcodeButtonProps {
  /** 사용자가 주소 선택 시 호출 — roadAddress 우선, 없으면 jibunAddress */
  onSelect: (address: string) => void;
  className?: string;
}

export function DaumPostcodeButton({
  onSelect,
  className,
}: DaumPostcodeButtonProps) {
  const [isReady, setIsReady] = useState(false);

  function handleClick() {
    if (!window.daum?.Postcode) return;
    new window.daum.Postcode({
      oncomplete: (data) => {
        // 도로명 우선 → 지번 폴백. 카카오 lookup이 도로명+번지 형식을 가장 잘 처리.
        // buildingName은 일부러 합치지 않음 — 카카오가 건물명 포함 주소를
        // NOT_FOUND로 떨굴 수 있어 단순 표준 주소만 채움.
        const address = data.roadAddress || data.jibunAddress;
        if (address) onSelect(address);
      },
    }).open();
  }

  return (
    <>
      <Script
        src={DAUM_SDK_URL}
        strategy="afterInteractive"
        onLoad={() => setIsReady(true)}
      />
      <Button
        type="button"
        variant="outline"
        onClick={handleClick}
        disabled={!isReady}
        className={className}
      >
        주소 검색
      </Button>
    </>
  );
}
