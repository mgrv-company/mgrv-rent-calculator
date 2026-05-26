import type { NextConfig } from "next";

/**
 * Framer iframe 임베드 허용용 CSP.
 * `frame-ancestors`는 X-Frame-Options를 대체하는 modern 표준.
 *
 * 허용 도메인:
 * - 'self': 우리 자신 (localhost dev, prod 자체)
 * - *.framer.app · *.framer.website · *.framer.com: Framer publish 도메인들
 * - *.mangrove.city: 회사 마케팅 도메인 (커스텀 도메인 매핑 시 대비)
 */
const CSP_FRAME_ANCESTORS =
  "frame-ancestors 'self' https://*.framer.app https://*.framer.website https://*.framer.com https://*.mangrove.city;";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: CSP_FRAME_ANCESTORS,
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
