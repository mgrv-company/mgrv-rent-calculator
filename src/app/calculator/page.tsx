import { RentCheckForm } from "@/components/calculator/RentCheckForm";

export default function CalculatorPage() {
  return (
    <main className="flex-1 px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-md space-y-8">
        <header className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            적정 임대료 계산기
          </h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            내 임대료가 주변 시세 대비 적정한지
            <br className="sm:hidden" /> 1분 만에 확인해보세요.
          </p>
        </header>
        <RentCheckForm />
      </div>
    </main>
  );
}
