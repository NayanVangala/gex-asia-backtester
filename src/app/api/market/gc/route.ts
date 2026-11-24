import { NextRequest, NextResponse } from "next/server";
import { Candle, SessionDataset } from "@/lib/types";
import { getGlobexSessionDate } from "@/lib/goldMath";
import { resampleCandles } from "@/lib/parsers";
import { getAsiaSessionWindow } from "@/lib/sessions";

export const dynamic = "force-dynamic";

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
    error?: { description?: string };
  };
}

async function fetchYahooCandles(
  symbol: string,
  interval: "1m" | "5m" | "30m" | "1h",
  range: string
): Promise<Candle[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?interval=${interval}&range=${range}&includePrePost=true`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Yahoo Finance ${interval} returned HTTP ${res.status}`);
  }
  const data = (await res.json()) as YahooChartResponse;
  const result = data.chart?.result?.[0];
  if (!result || !result.timestamp || !result.indicators?.quote?.[0]) {
    throw new Error(
      data.chart?.error?.description ?? `No ${interval} bars returned for ${symbol}`
    );
  }
  const tsArr = result.timestamp;
  const q = result.indicators.quote[0];
  const out: Candle[] = [];

  for (let i = 0; i < tsArr.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    const v = q.volume?.[i] ?? 0;
    if (
      o === null ||
      o === undefined ||
      h === null ||
      h === undefined ||
      l === null ||
      l === undefined ||
      c === null ||
      c === undefined
    ) {
      continue;
    }
    out.push({
      ts: tsArr[i] * 1000,
      open: Number(o.toFixed(2)),
      high: Number(h.toFixed(2)),
      low: Number(l.toFixed(2)),
      close: Number(c.toFixed(2)),
      volume: Math.max(0, Number(v)),
    });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

export async function GET(req: NextRequest) {
  try {
    const requestedDate = req.nextUrl.searchParams.get("sessionDate");

    const [h1Candles, m5All, m1Recent] = await Promise.all([
      fetchYahooCandles("GC=F", "1h", "1mo"),
      fetchYahooCandles("GC=F", "5m", "1mo"),
      fetchYahooCandles("GC=F", "1m", "5d").catch(() => [] as Candle[]),
    ]);

    // Discover available Asia sessions that have >= 24 M5 bars between 15:00-21:00 PT
    const sessionBarCounts = new Map<string, number>();
    for (const bar of m5All) {
      const sDate = getGlobexSessionDate(bar.ts);
      const win = getAsiaSessionWindow(sDate);
      if (bar.ts >= win.globexOpenTs && bar.ts <= win.asiaCloseTs) {
        sessionBarCounts.set(sDate, (sessionBarCounts.get(sDate) ?? 0) + 1);
      }
    }

    const availableSessions = Array.from(sessionBarCounts.entries())
      .filter(([, count]) => count >= 20)
      .map(([d]) => d)
      .sort()
      .reverse();

    if (availableSessions.length === 0) {
      return NextResponse.json(
        { error: "No complete COMEX GC Asia sessions found in Yahoo 1mo window." },
        { status: 502 }
      );
    }

    const sessionDate =
      requestedDate && availableSessions.includes(requestedDate)
        ? requestedDate
        : availableSessions[0];

    const win = getAsiaSessionWindow(sessionDate);

    // Keep prior 3 days + target Asia session of M5 bars for clean context & developing profile
    const m5StartCut = win.globexOpenTs - 3 * 24 * 3600 * 1000;
    const m5Candles = m5All.filter(
      (b) => b.ts >= m5StartCut && b.ts <= win.asiaCloseTs + 3600_000
    );

    const m30Candles = resampleCandles(
      m5All.filter(
        (b) =>
          b.ts >= win.globexOpenTs - 12 * 24 * 3600 * 1000 &&
          b.ts <= win.asiaCloseTs + 3600_000
      ),
      1_800_000
    );

    const h1Filtered = h1Candles.filter(
      (b) => b.ts <= win.asiaCloseTs + 3600_000
    );

    const m1Candles = m1Recent.filter(
      (b) =>
        b.ts >= win.globexOpenTs - 6 * 3600_000 &&
        b.ts <= win.asiaCloseTs + 3600_000
    );

    const dataset: SessionDataset = {
      id: `gc-ohlcv-${sessionDate}`,
      title: `COMEX GC=F · Asia ${sessionDate}`,
      instrument: "GC=F (COMEX Gold Futures)",
      dataSource: "gc_ohlcv",
      capabilities: {
        hasRealAggressorTape: false,
        hasRealL2Depth: false,
        sourceLabel: "Yahoo Finance COMEX GC=F (Real OHLCV)",
        sourceUrl: "https://finance.yahoo.com/quote/GC=F",
        instrument: "GC=F",
        tickSize: 0.1,
        pointValue: 100,
        caveat:
          "OHLCV only: real COMEX GC candles, H1/M30/M5/M1 structure, and Volume Profile levels (PD/PW/Composite/Developing/nPOC). No bid/ask aggressor tape or L2 book; switch to Kraken PAXG/USD for real Footprint/CVD/Big Trades or upload Databento GLBX.MDP3 CSV.",
      },
      sessionDate,
      asiaOpenTs: win.tokyoOpenTs,
      asiaCloseTs: win.asiaCloseTs,
      h1Candles: h1Filtered,
      m30Candles,
      m5Candles,
      m1Candles,
      ticks: [],
      l2Snapshots: [],
      fetchedAt: new Date().toISOString(),
    };

    return NextResponse.json({
      dataset,
      availableSessions,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load GC=F data" },
      { status: 500 }
    );
  }
}
