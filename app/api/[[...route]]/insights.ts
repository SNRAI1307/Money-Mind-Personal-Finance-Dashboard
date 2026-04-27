import { Hono } from "hono";
import { z } from "zod";
import { and, eq, gte, lte, desc } from "drizzle-orm";
import { parse, subDays } from "date-fns";
import { clerkMiddleware, getAuth } from "@hono/clerk-auth";
import { zValidator } from "@hono/zod-validator";

import { db } from "@/db/drizzle";
import { accounts, categories, transactions } from "@/db/schema";
import { convertAmountFromMiliunits } from "@/lib/utils";

const app = new Hono().post(
  "/",
  clerkMiddleware(),
  zValidator(
    "json",
    z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      accountId: z.string().optional(),
    })
  ),
  async (c) => {
    const auth = getAuth(c);
    if (!auth?.userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return c.json({ error: "ANTHROPIC_API_KEY not configured" }, 500);
    }

    const { from, to, accountId } = c.req.valid("json");

    const defaultTo = new Date();
    const defaultFrom = subDays(defaultTo, 30);
    const startDate = from ? parse(from, "yyyy-MM-dd", new Date()) : defaultFrom;
    const endDate = to ? parse(to, "yyyy-MM-dd", new Date()) : defaultTo;
    const prevStart = subDays(startDate, 30);
    const prevEnd = subDays(endDate, 30);

    const currentTxns = await db
      .select({
        id: transactions.id,
        amount: transactions.amount,
        payee: transactions.payee,
        date: transactions.date,
        categoryName: categories.name,
        categoryId: transactions.categoryId,
        notes: transactions.notes,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(
        and(
          accountId ? eq(transactions.accountId, accountId) : undefined,
          eq(accounts.userId, auth.userId),
          gte(transactions.date, startDate),
          lte(transactions.date, endDate)
        )
      )
      .orderBy(desc(transactions.date));

    const prevTxns = await db
      .select({
        amount: transactions.amount,
        categoryName: categories.name,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(
        and(
          accountId ? eq(transactions.accountId, accountId) : undefined,
          eq(accounts.userId, auth.userId),
          gte(transactions.date, prevStart),
          lte(transactions.date, prevEnd)
        )
      );

    const categorySpend: Record<string, number> = {};
    const prevCategorySpend: Record<string, number> = {};
    let totalIncome = 0;
    let totalExpense = 0;
    let uncategorizedCount = 0;

    for (const t of currentTxns) {
      const amt = convertAmountFromMiliunits(t.amount);
      if (amt >= 0) {
        totalIncome += amt;
      } else {
        totalExpense += Math.abs(amt);
        const cat = t.categoryName || "Uncategorized";
        categorySpend[cat] = (categorySpend[cat] || 0) + Math.abs(amt);
        if (!t.categoryId) uncategorizedCount++;
      }
    }

    for (const t of prevTxns) {
      const amt = convertAmountFromMiliunits(t.amount);
      if (amt < 0) {
        const cat = t.categoryName || "Uncategorized";
        prevCategorySpend[cat] = (prevCategorySpend[cat] || 0) + Math.abs(amt);
      }
    }

    const topCategory = Object.entries(categorySpend).sort((a, b) => b[1] - a[1])[0];
    const biggestExpense = currentTxns
      .filter((t) => convertAmountFromMiliunits(t.amount) < 0)
      .sort((a, b) => a.amount - b.amount)[0];
    const savingsRate =
      totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome) * 100 : 0;

    const categoryChanges: {
      name: string;
      current: number;
      previous: number;
      change: number;
    }[] = [];
    const allCats = new Set([
      ...Object.keys(categorySpend),
      ...Object.keys(prevCategorySpend),
    ]);
    for (const cat of allCats) {
      const curr = categorySpend[cat] || 0;
      const prev = prevCategorySpend[cat] || 0;
      if (curr > 0 || prev > 0) {
        const change = prev > 0 ? ((curr - prev) / prev) * 100 : 100;
        categoryChanges.push({ name: cat, current: curr, previous: prev, change });
      }
    }
    categoryChanges.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

    const payeeCount: Record<string, number> = {};
    for (const t of currentTxns) {
      if (convertAmountFromMiliunits(t.amount) < 0) {
        payeeCount[t.payee] = (payeeCount[t.payee] || 0) + 1;
      }
    }
    const recurringPayees = Object.entries(payeeCount)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }));

    const dataSummary = {
      period: {
        from: startDate.toISOString().split("T")[0],
        to: endDate.toISOString().split("T")[0],
      },
      totalIncome: Math.round(totalIncome * 100) / 100,
      totalExpense: Math.round(totalExpense * 100) / 100,
      netBalance: Math.round((totalIncome - totalExpense) * 100) / 100,
      savingsRate: Math.round(savingsRate * 10) / 10,
      transactionCount: currentTxns.length,
      topSpendingCategory: topCategory
        ? { name: topCategory[0], amount: Math.round(topCategory[1] * 100) / 100 }
        : null,
      biggestExpense: biggestExpense
        ? {
            payee: biggestExpense.payee,
            amount:
              Math.round(
                Math.abs(convertAmountFromMiliunits(biggestExpense.amount)) * 100
              ) / 100,
          }
        : null,
      categoryBreakdown: Object.entries(categorySpend)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 })),
      topCategoryChanges: categoryChanges.slice(0, 3),
      recurringPayees,
      uncategorizedCount,
    };

    // No transactions — return helpful fallback without calling Claude
    if (currentTxns.length === 0) {
      return c.json({
        data: {
          summary:
            "No transactions found for the selected period. Add some transactions to get AI-powered insights.",
          insights: [
            {
              type: "neutral",
              title: "No data yet",
              description:
                "Start adding your income and expense transactions to see personalized financial insights.",
            },
          ],
          topRecommendation:
            "Add your first transaction to get started with financial tracking.",
          stats: dataSummary,
        },
      });
    }

    // Call Claude API
    let aiInsights;
    try {
      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          system: `You are a personal finance analyst. Return ONLY a valid JSON object with no markdown, no backticks, no extra text. Use exactly this structure:
{"summary":"2-3 sentence overall financial health summary","insights":[{"type":"positive","title":"short title","description":"1-2 sentence actionable insight"},{"type":"warning","title":"short title","description":"1-2 sentence actionable insight"},{"type":"tip","title":"short title","description":"1-2 sentence actionable insight"},{"type":"neutral","title":"short title","description":"1-2 sentence actionable insight"}],"topRecommendation":"single most important action the user should take right now"}
Rules: exactly 4 insights, types must be one of: positive/warning/neutral/tip, be specific with amounts from the data, keep language friendly and direct.`,
          messages: [
            {
              role: "user",
              content: `Analyze my financial data: ${JSON.stringify(dataSummary)}`,
            },
          ],
        }),
      });

      if (!claudeRes.ok) {
        const errText = await claudeRes.text();
        console.error("Claude API error:", claudeRes.status, errText);
        throw new Error(`Claude API returned ${claudeRes.status}`);
      }

      const claudeData = (await claudeRes.json()) as {
        content: { type: string; text: string }[];
      };

      const rawText =
        claudeData.content.find((b) => b.type === "text")?.text || "{}";
      const cleaned = rawText.replace(/```json|```/g, "").trim();
      aiInsights = JSON.parse(cleaned);
    } catch (err) {
      console.error("Insights generation error:", err);
      // Graceful fallback using computed stats
      aiInsights = {
        summary: `You had ${currentTxns.length} transactions this period. Total income: $${dataSummary.totalIncome.toFixed(2)}, total expenses: $${dataSummary.totalExpense.toFixed(2)}.`,
        insights: [
          {
            type: dataSummary.savingsRate >= 20 ? "positive" : "warning",
            title: "Savings rate",
            description: `Your savings rate is ${dataSummary.savingsRate.toFixed(1)}%. ${dataSummary.savingsRate >= 20 ? "Great job keeping expenses low!" : "Try to save at least 20% of your income."}`,
          },
          {
            type: "neutral",
            title: "Top spending category",
            description: dataSummary.topSpendingCategory
              ? `Your highest spending is in ${dataSummary.topSpendingCategory.name} at $${dataSummary.topSpendingCategory.amount.toFixed(2)}.`
              : "Categorize your transactions for better insights.",
          },
          {
            type: "tip",
            title: "Track consistently",
            description:
              "Keep logging transactions daily for more accurate insights and trends.",
          },
          {
            type: dataSummary.uncategorizedCount > 0 ? "warning" : "positive",
            title: "Transaction categories",
            description:
              dataSummary.uncategorizedCount > 0
                ? `${dataSummary.uncategorizedCount} transactions are uncategorized. Add categories for better analysis.`
                : "All your transactions are categorized — great for accurate reporting!",
          },
        ],
        topRecommendation:
          dataSummary.savingsRate < 20
            ? `Focus on reducing your ${dataSummary.topSpendingCategory?.name || "top"} spending to improve your savings rate.`
            : "Keep up the good financial habits and consider investing your surplus.",
      };
    }

    return c.json({
      data: {
        ...aiInsights,
        stats: dataSummary,
      },
    });
  }
);

export default app;