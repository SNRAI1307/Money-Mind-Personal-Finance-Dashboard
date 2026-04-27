import { Suspense } from "react";
import { DataCharts } from "@/components/data-charts";
import { DataGrid } from "@/components/data-grid";
import { AiInsights } from "@/components/ai-insights";
export default function DashboardPage() {
  return (
    <div className="max-w-screen-xl mx-auto w-full pb-10 -mt-24">
      <Suspense fallback={<div>Loading grid...</div>}>
        <DataGrid />
      </Suspense>

      <Suspense fallback={<div>Loading charts...</div>}>
        <DataCharts />
      </Suspense>

      <Suspense fallback={<div>Loading AI insights...</div>}>
        <AiInsights />
      </Suspense>
    </div>
  );
}
