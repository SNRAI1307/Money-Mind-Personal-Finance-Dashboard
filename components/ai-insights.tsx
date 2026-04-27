"use client";

import { useState } from "react";
import {
  Sparkles,
  TrendingUp,
  AlertTriangle,
  Info,
  Lightbulb,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency } from "@/lib/utils";
import { useGetInsights, type Insight, type InsightsResponse } from "@/features/insights/api/use-get-insights";

// ── Insight type config ──────────────────────────────────────────────────────
const insightConfig = {
  positive: {
    icon: TrendingUp,
    badgeClass: "bg-emerald-500/10 text-emerald-600 border-emerald-200",
    iconClass: "text-emerald-500",
    borderClass: "border-l-emerald-500",
    label: "Positive",
  },
  warning: {
    icon: AlertTriangle,
    badgeClass: "bg-rose-500/10 text-rose-600 border-rose-200",
    iconClass: "text-rose-500",
    borderClass: "border-l-rose-500",
    label: "Warning",
  },
  neutral: {
    icon: Info,
    badgeClass: "bg-blue-500/10 text-blue-600 border-blue-200",
    iconClass: "text-blue-500",
    borderClass: "border-l-blue-500",
    label: "Info",
  },
  tip: {
    icon: Lightbulb,
    badgeClass: "bg-yellow-500/10 text-yellow-600 border-yellow-200",
    iconClass: "text-yellow-500",
    borderClass: "border-l-yellow-500",
    label: "Tip",
  },
};

// ── Insight Card ─────────────────────────────────────────────────────────────
function InsightCard({ insight }: { insight: Insight }) {
  const config = insightConfig[insight.type] || insightConfig.neutral;
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "flex gap-x-3 p-4 rounded-lg border border-l-4 bg-card",
        config.borderClass
      )}
    >
      <div className="shrink-0 mt-0.5">
        <Icon className={cn("size-4", config.iconClass)} />
      </div>
      <div className="space-y-1 flex-1 min-w-0">
        <div className="flex items-center gap-x-2 flex-wrap gap-y-1">
          <p className="text-sm font-medium text-foreground leading-none">
            {insight.title}
          </p>
          <Badge
            variant="outline"
            className={cn("text-xs px-1.5 py-0", config.badgeClass)}
          >
            {config.label}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {insight.description}
        </p>
      </div>
    </div>
  );
}

// ── Stats Row ────────────────────────────────────────────────────────────────
function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center px-4 py-2 rounded-lg bg-muted/50">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}

// ── Loading Skeleton ─────────────────────────────────────────────────────────
function InsightsLoading() {
  return (
    <Card className="border-none drop-shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-8 w-28" />
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
        <Skeleton className="h-12 w-full" />
      </CardContent>
    </Card>
  );
}

// ── Empty State ──────────────────────────────────────────────────────────────
function InsightsEmpty({ onGenerate, isLoading }: { onGenerate: () => void; isLoading: boolean }) {
  return (
    <Card className="border-none drop-shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl flex items-center gap-x-2">
          <Sparkles className="size-5 text-blue-600" />
          AI Insights
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-10 gap-y-4 text-center">
          <div className="size-14 rounded-full bg-blue-500/10 flex items-center justify-center">
            <Sparkles className="size-6 text-blue-600" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              Get AI-powered financial insights
            </p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Analyze your transactions and get personalized recommendations based on your spending patterns.
            </p>
          </div>
          <Button
            size="sm"
            onClick={onGenerate}
            disabled={isLoading}
            className="gap-x-2"
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {isLoading ? "Analyzing..." : "Generate Insights"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
export const AiInsights = () => {
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [showStats, setShowStats] = useState(false);
  const { mutate, isPending } = useGetInsights();

  const handleGenerate = () => {
    mutate(undefined, {
      onSuccess: (res) => setData(res),
    });
  };

  if (isPending) return <InsightsLoading />;

  if (!data) {
    return <InsightsEmpty onGenerate={handleGenerate} isLoading={isPending} />;
  }

  const { summary, insights, topRecommendation, stats } = data;

  return (
    <Card className="border-none drop-shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-3 gap-y-2 flex-wrap">
        <CardTitle className="text-xl flex items-center gap-x-2">
          <Sparkles className="size-5 text-blue-600" />
          AI Insights
        </CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={handleGenerate}
          disabled={isPending}
          className="gap-x-2 text-xs"
        >
          {isPending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RefreshCw className="size-3" />
          )}
          Refresh
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Summary */}
        <div className="p-4 rounded-lg bg-blue-50 border border-blue-100">
          <p className="text-sm text-blue-800 leading-relaxed">{summary}</p>
        </div>

        {/* Quick stats */}
        <div>
          <button
            onClick={() => setShowStats(!showStats)}
            className="flex items-center gap-x-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            {showStats ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            {showStats ? "Hide" : "Show"} data summary
          </button>

          {showStats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              <StatPill label="Income" value={formatCurrency(stats.totalIncome)} />
              <StatPill label="Expenses" value={formatCurrency(stats.totalExpense)} />
              <StatPill label="Net" value={formatCurrency(stats.netBalance)} />
              <StatPill
                label="Savings rate"
                value={`${stats.savingsRate.toFixed(1)}%`}
              />
            </div>
          )}
        </div>

        {/* Insights */}
        <div className="space-y-2">
          {insights.map((insight, i) => (
            <InsightCard key={i} insight={insight} />
          ))}
        </div>

        {/* Top recommendation */}
        {topRecommendation && (
          <div className="flex gap-x-3 p-4 rounded-lg bg-gradient-to-r from-blue-600 to-blue-500">
            <Sparkles className="size-4 text-white shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-blue-100 mb-0.5">
                Top recommendation
              </p>
              <p className="text-sm text-white leading-relaxed">
                {topRecommendation}
              </p>
            </div>
          </div>
        )}

        {/* Category changes */}
        {stats.topCategoryChanges.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              vs previous period
            </p>
            {stats.topCategoryChanges.map((cat) => (
              <div
                key={cat.name}
                className="flex items-center justify-between py-1.5 px-3 rounded-md bg-muted/40 text-sm"
              >
                <span className="text-foreground font-medium">{cat.name}</span>
                <div className="flex items-center gap-x-2">
                  <span className="text-xs text-muted-foreground">
                    {formatCurrency(cat.current)}
                  </span>
                  <span
                    className={cn(
                      "text-xs font-medium",
                      cat.change > 0 ? "text-rose-500" : "text-emerald-500"
                    )}
                  >
                    {cat.change > 0 ? "+" : ""}
                    {cat.change.toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Recurring payees */}
        {stats.recurringPayees.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Possible recurring payments
            </p>
            <div className="flex flex-wrap gap-2">
              {stats.recurringPayees.map((p) => (
                <Badge
                  key={p.name}
                  variant="outline"
                  className="text-xs bg-muted/50"
                >
                  {p.name} · {p.count}×
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Uncategorized warning */}
        {stats.uncategorizedCount > 0 && (
          <div className="flex items-center gap-x-2 p-3 rounded-lg bg-yellow-50 border border-yellow-100">
            <AlertTriangle className="size-4 text-yellow-600 shrink-0" />
            <p className="text-xs text-yellow-700">
              <span className="font-medium">{stats.uncategorizedCount} transactions</span> are uncategorized. Categorizing them will improve your insights.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export const AiInsightsLoading = () => <InsightsLoading />;
