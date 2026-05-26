"use client";

import { useEffect } from "react";

/**
 * Framer iframe 임베드 시 우리 페이지 height 변화를 부모에 알림.
 *
 * Framer 측에서 다음 형태의 메시지를 받아 iframe height를 조정해야 함:
 * `{ type: "rent-check-iframe-height", height: number }`
 *
 * Framer custom code 예시:
 * ```js
 * window.addEventListener("message", (e) => {
 *   if (e.data?.type === "rent-check-iframe-height") {
 *     iframe.style.height = e.data.height + "px";
 *   }
 * });
 * ```
 */
export function IframeResize() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.parent === window) return; // standalone (iframe 아님)

    let lastHeight = 0;
    const sendHeight = () => {
      const height = Math.ceil(document.documentElement.scrollHeight);
      if (height === lastHeight) return;
      lastHeight = height;
      try {
        window.parent.postMessage(
          { type: "rent-check-iframe-height", height },
          "*",
        );
      } catch {
        /* parent 접근 차단 시 무시 */
      }
    };

    sendHeight();
    const observer = new ResizeObserver(sendHeight);
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, []);

  return null;
}
