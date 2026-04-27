import { useMutation } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";

type InsightType = "positive" | "warning" | "neutral" | "tip";

export type Insight = {
  type: InsightType;
  title: string;
  description: string;
};

export type InsightsResponse = {
  summary: string;
  insights: Insight[];
  topRecommendation: string;
  stats: {
    period: { from: string; to: string };
    totalIncome: number;
    totalExpense: number;
    netBalance: number;
    savingsRate: number;
    transactionCount: number;
    topSpendingCategory: { name: string; amount: number } | null;
    biggestExpense: { payee: string; amount: number } | null;
    categoryBreakdown: { name: string; amount: number }[];
    topCategoryChanges: { name: string; current: number; previous: number; change: number }[];
    recurringPayees: { name: string; count: number }[];
    uncategorizedCount: number;
  };
};

export const useGetInsights = () => {
  const params = useSearchParams();
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  const accountId = params.get("accountId") || "";

  const mutation = useMutation<InsightsResponse, Error>({
    mutationFn: async () => {
      const response = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, accountId }),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch insights");
      }

      const json = await response.json();
      return json.data as InsightsResponse;
    },
  });

  return mutation;
};