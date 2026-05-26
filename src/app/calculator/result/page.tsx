import { RentCheckResult } from "@/components/calculator/RentCheckResult";

export default function ResultPage() {
  return (
    <main className="flex-1 px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-md">
        <RentCheckResult />
      </div>
    </main>
  );
}
