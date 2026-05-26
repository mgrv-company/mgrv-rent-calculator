# mgrv-rent-check

임대인 대상 **적정 임대료 계산기** — MGRV 그로스팀 리드 마그넷.

임대인이 자산 정보를 입력하면, 국토교통부 실거래 데이터 기반으로 주변 시세를 산출해 *낮음/적정/높음* 판정을 안내. 리캐치(Re:catch) 리드 폼을 통해 연락처를 수집한다.

## 흐름

```
[1. 입력]              [2. 리캐치 폼]         [3. 결과]
이름·주소·평수·       →  이름·전화·이메일   →  적정 월세 비교
보증금·월세                                       Sheets A 적재
```

## 기술 스택

- Next.js 16 (App Router + Turbopack) + React 19 + TypeScript
- Tailwind 4 + shadcn/ui (neutral 베이스) + Pretendard
- 외부 API: MOLIT 실거래(data.go.kr), V-World 지오코딩
- 호스팅: GCP `mgrv-growth-opservice-db` (Cloud Run + Firebase Hosting, asia-northeast3)

## 로컬 개발

```bash
# 1. 환경변수 설정 — .env.local 생성
cp .env.example .env.local
# 에디터로 .env.local 열어 DATA_GO_KR_API_KEY · VWORLD_API_KEY 값 입력

# 2. dev 서버
npm run dev          # http://localhost:3000
npm run build        # production 빌드 + 타입체크
```

API key 없이도 UI 흐름은 동작 (결과 페이지에서 `MISSING_API_KEY` 에러 표시).

## 디렉토리

```
src/
├── app/
│   ├── layout.tsx              # 한국어 + Pretendard
│   ├── page.tsx                # / → /calculator redirect
│   ├── calculator/
│   │   ├── page.tsx            # Step 1: 입력 폼
│   │   ├── contact/page.tsx    # Step 2: 리캐치 임베드 (Phase 2)
│   │   └── result/page.tsx     # Step 3: 결과
│   └── api/
│       ├── address/lookup/     # V-World 주소 → lawdCd + 좌표
│       └── rent-analyze/       # MOLIT 실거래 → 비교군·통계·신뢰도
├── components/
│   ├── ui/                     # shadcn (Button·Input·Label·Card)
│   └── calculator/             # RentCheckForm · RentCheckResult · ContactStep
└── lib/                        # 계산 로직 SSOT (deal-pipeline-ax 복사)
    ├── rent-pricing.ts         # F8 임대료 공식 (calcF8Rent)
    ├── rent-analyze-core.ts    # MOLIT → 비교군·통계 (analyzeRentData)
    ├── molit-client.ts         # data.go.kr 호출
    ├── geocoding.ts            # V-World 지오코딩
    └── rent-check-storage.ts   # sessionStorage helper
```

## 계산 공식

평당 시세 중앙값(MOLIT 실거래) → F8 공식 단순화 호출:

```ts
const f8 = calcF8Rent({
  pricePerPyeong: median,
  netSqm: inputPyeong * 3.3058,
  totalCommonSqm: 0,        // 일반 임대인은 공용공간 모름
  totalUnits: 1,
  newConstructionPct: 0,
  furnishedPct: 0,
  depositManwon: inputDeposit,
  noDepositSurcharge: 0,
})
const fairRent = f8.longTermRent
```

판정 기준: `(입력월세 - 시세월세) / 시세월세`
- `< -10%` → 낮음 (시세보다 더 받을 수 있음)
- `±10%` → 적정
- `> +10%` → 높음

## 외부 API key

- **MOLIT** (data.go.kr): "오피스텔 전월세 자료" 활용신청 → 즉시 자동 승인. 일일 한도 1만 호출.
- **V-World** (vworld.kr): 인증키 발급 + 사용 도메인 등록. Referer 헤더 기반 도메인 검증.
  - 등록 도메인: `https://www.mangrove.city`
  - 코드에서 호출 시 `VWORLD_REFERER` 환경변수로 Referer 헤더 박음.

## 운영 인프라

- GCP Project: `mgrv-growth-opservice-db`
- Cloud Run + Firebase Hosting (`da-rent-check.web.app` → 추후 커스텀 도메인)
- Sheets A 적재: `1oa8jnbm...y5C4` / `계산기_raw` 탭 (Phase 2)

## 참고

- 계산 로직 원본: [`deal-pipeline-ax/rent`](https://github.com/mgrv-company/deal-pipeline-ax) (타팀 운영, M1 v7.2)
- 플랜: `/Users/ws7028/.claude/plans/smooth-bouncing-torvalds.md`
