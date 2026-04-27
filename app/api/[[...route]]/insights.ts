import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, gte, lte, lt, sql, sum } from "drizzle-orm";
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

    const { from, to, accountId } = c.req.valid("json");

    const defaultTo = new Date();
    const defaultFrom = subDays(defaultTo, 30);

    const startDate = from ? parse(from, "yyyy-MM-dd", new Date()) : defaultFrom;
    const endDate = to ? parse(to, "yyyy-MM-dd", new Date()) : defaultTo;

    const prevStart = subDays(startDate, 30);
    const prevEnd = subDays(endDate, 30);

    // Fetch current period transactions with category info
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

    // Fetch previous period for comparison
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

    // Category spending current
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

    // Top spending category
    const topCategory = Object.entries(categorySpend).sort((a, b) => b[1] - a[1])[0];

    // Biggest single expense
    const biggestExpense = currentTxns
      .filter((t) => convertAmountFromMiliunits(t.amount) < 0)
      .sort((a, b) => a.amount - b.amount)[0];

    // Savings rate
    const savingsRate = totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome) * 100 : 0;

    // Category change vs previous period
    const categoryChanges: { name: string; current: number; previous: number; change: number }[] = [];
    const allCats = new Set([...Object.keys(categorySpend), ...Object.keys(prevCategorySpend)]);
    for (const cat of allCats) {
      const curr = categorySpend[cat] || 0;
      const prev = prevCategorySpend[cat] || 0;
      if (curr > 0 || prev > 0) {
        const change = prev > 0 ? ((curr - prev) / prev) * 100 : 100;
        categoryChanges.push({ name: cat, current: curr, previous: prev, change });
      }
    }
    categoryChanges.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

    // Frequent payees (possible subscriptions)
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

    // Build structured data summary for Claude
    const dataSummary = {
      period: { from: startDate.toISOString().split("T")[0], to: endDate.toISOString().split("T")[0] },
      totalIncome: Math.round(totalIncome * 100) / 100,
      totalExpense: Math.round(totalExpense * 100) / 100,
      netBalance: Math.round((totalIncome - totalExpense) * 100) / 100,
      savingsRate: Math.round(savingsRate * 10) / 10,
      transactionCount: currentTxns.length,
      topSpendingCategory: topCategory ? { name: topCategory[0], amount: Math.round(topCategory[1] * 100) / 100 } : null,
      biggestExpense: biggestExpense
        ? { payee: biggestExpense.payee, amount: Math.round(Math.abs(convertAmountFromMiliunits(biggestExpense.amount)) * 100) / 100 }
        : null,
      categoryBreakdown: Object.entries(categorySpend)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 })),
      topCategoryChanges: categoryChanges.slice(0, 3),
      recurringPayees,
      uncategorizedCount,
    };

    // Call Claude API for AI insights
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: `You are a personal finance analyst. Analyze the user's financial data and return ONLY a valid JSON object (no markdown, no explanation) with this exact structure:
{
  "summary": "2-3 sentence overall financial health summary",
  "insights": [
    { "type": "positive|warning|neutral|tip", "title": "short title", "description": "actionable insight in 1-2 sentences" }
  ],
  "topRecommendation": "single most important action the user should take right now"
}
Generate exactly 4 insights. Types: positive=good news, warning=concern, neutral=observation, tip=actionable advice. Be specific with numbers from the data. Keep language friendly and direct.`,
        messages: [
          {
            role: "user",
            content: `Analyze my financial data for ${dataSummary.period.from} to ${dataSummary.period.to}:\n${JSON.stringify(dataSummary, null, 2)}`,
          },
        ],
      }),
    });

    if (!claudeRes.ok) {
      return c.json({ error: "Failed to generate insights" }, 500);
    }

    const claudeData = await claudeRes.json() as { content: { type: string; text: string }[] };
    const rawText = claudeData.content.find((b) => b.type === "text")?.text || "{}";

    let aiInsights;
    try {
      const cleaned = rawText.replace(/```json|```/g, "").trim();
      aiInsights = JSON.parse(cleaned);
    } catch {
      aiInsights = { summary: "Unable to generate insights.", insights: [], topRecommendation: "" };
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