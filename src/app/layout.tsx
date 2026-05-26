import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "적정 임대료 계산기 | MGRV",
  description:
    "내 임대료가 주변 시세 대비 적정한지 확인해보세요. 국토교통부 실거래 데이터 기반 무료 시세 분석.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css"
        />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
