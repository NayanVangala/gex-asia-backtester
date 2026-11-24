import { NextRequest, NextResponse } from "next/server";
import { Candle, SessionDataset, Tick } from "@/lib/types";
import { resampleCandles, resampleTicksToCandles } from "@/lib/parsers";
import { getAsiaSessionWindow, listRecentAsiaDates } from "@/lib/sessions";

export const dynamic = "force-dynamic";

interface KrakenOhlcResponse {
  error?: string[];
  result?: Record<string, unknown>;
}

interface KrakenTradesResponse {
  error?: string[];
  result?: {
    PAXGUSD?: Array<[string, string, number, string, string, string, number?]>;
    last?: string;
    [k: string]: unknown;
  };
}

async function fetchKrakenOHLC(intervalMin: 5 | 30 | 60): Promise<Candle[]> {
  const url = `https://api.kraken.com/0/public/OHLC?pair=PAXGUSD&interval=${intervalMin}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Kraken OHLC ${intervalMin}m HTTP ${res.status}`);
  const data = (await res.json()) as KrakenOhlcResponse;
  if (data.error && data.error.length > 0) {
    throw new Error(`Kraken OHLC error: ${data.error.join(", ")}`);
  }
  const rawList = (data.result?.PAXGUSD ?? []) as Array<
    [number, string, string, string, string, string, string, number]
  >;
  return rawList
    .map((row) => ({
      ts: Number(row[0]) * 1000,
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[6]),
      tradeCount: Number(row[7]),
    }))
    .sort((a, b) => a.ts - b.ts);
}

/**
 * Fetches REAL historical tick-by-tick PAXG/USD trades from Kraken for a full Asia session
 * (3:00 PM PT Globex open through 9:00 PM PT Asia close).
 * Every trade carries real aggressor side ('b' = buyer lifted ask, 's' = seller hit bid).
 */
async function fetchKrakenTradesRange(
  startMs: number,
  endMs: number,
  maxBatches = 7
): Promise<Tick[]> {
  const ticks: Tick[] = [];
  let sinceNs = `${Math.floor(startMs / 1000)}000000000`;

  for (let batch = 0; batch < maxBatches; batch++) {
    const url = `https://api.kraken.com/0/public/Trades?pair=PAXGUSD&since=${sinceNs}&count=1000`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      if (ticks.length > 0) break;
      throw new Error(`Kraken Trades HTTP ${res.status}`);
    }
    const data = (await res.json()) as KrakenTradesResponse;
    if (data.error && data.error.length > 0) {
      if (ticks.length > 0) break;
      throw new Error(`Kraken Trades error: ${data.error.join(", ")}`);
    }

    const rows = data.result?.PAXGUSD ?? [];
    if (rows.length === 0) break;

    let hitEnd = false;
    for (const r of rows) {
      const tsMs = Math.round(Number(r[2]) * 1000);
      if (tsMs < startMs) continue;
      if (tsMs > endMs) {
        hitEnd = true;
        break;
      }
      ticks.push({
        ts: tsMs,
        price: Number(r[0]),
        size: Number(r[1]),
        side: r[3] === "b" ? "buy" : r[3] === "s" ? "sell" : "unknown",
      });
    }

    const nextLast = data.result?.last;
    if (hitEnd || !nextLast || nextLast === sinceNs || rows.length < 1000) {
      break;
    }
    sinceNs = nextLast;
  }

  return ticks.sort((a, b) => a.ts - b.ts);
}

export async function GET(req: NextRequest) {
  try {
    // Prefer Mon-Thu weekday Asia sessions by default (higher volume/cleaner tape than thin Sunday)
    const weekdaySessions = listRecentAsiaDates(16, false, true);
    const allSessions = listRecentAsiaDates(20, true);
    const requestedDate = req.nextUrl.searchParams.get("sessionDate");
    const sessionDate =
      requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
        ? requestedDate
        : weekdaySessions[0] ?? allSessions[0];

    const win = getAsiaSessionWindow(sessionDate);
    // Start tick pull at 15:00 PT (Globex open) through 21:00 PT (Asia close)
    const tickStartMs = win.globexOpenTs;
    const tickEndMs = Math.min(Date.now(), win.asiaCloseTs);

    const [h1All, m30All, m5Recent, ticks] = await Promise.all([
      fetchKrakenOHLC(60),
      fetchKrakenOHLC(30),
      fetchKrakenOHLC(5),
      fetchKrakenTradesRange(tickStartMs, tickEndMs, 10),
    ]);

    const tickM1 = resampleTicksToCandles(ticks, 60_000);
    const tickM5 = resampleTicksToCandles(ticks, 300_000);

    // Merge Kraken 5m OHLC (before tick window) with exact tick-built 5m bars (during Asia session)
    const m5Map = new Map<number, Candle>();
    for (const c of m5Recent) {
      if (c.ts <= tickEndMs && c.ts >= tickStartMs - 48 * 3600_000) {
        m5Map.set(c.ts, c);
      }
    }
    for (const c of tickM5) {
      m5Map.set(c.ts, c);
    }
    const m5Candles = Array.from(m5Map.values()).sort((a, b) => a.ts - b.ts);

    const h1Filtered = h1All.filter((c) => c.ts <= tickEndMs + 3600_000);
    const m30Filtered =
      m30All.filter((c) => c.ts <= tickEndMs + 1800_000).length > 0
        ? m30All.filter((c) => c.ts <= tickEndMs + 1800_000)
        : resampleCandles(m5Candles, 1_800_000);

    const dataset: SessionDataset = {
      id: `paxg-ticks-${sessionDate}`,
      title: `Kraken PAXG/USD (Real Gold Tape) · Asia ${sessionDate}`,
      instrument: "PAXG/USD (1 oz Physical Gold Token)",
      dataSource: "paxg_ticks",
      capabilities: {
        hasRealAggressorTape: ticks.length > 0,
        hasRealL2Depth: false,
        sourceLabel: `Kraken PAXG/USD Real Trade Tape (${ticks.length.toLocaleString()} real trades)`,
        sourceUrl: "https://api.kraken.com/0/public/Trades?pair=PAXGUSD",
        instrument: "PAXG/USD",
        tickSize: 0.1,
        pointValue: 1,
        caveat:
          "100% real historical buy/sell aggressor trades (authentic Footprints, 300% Imbalances, Absorption, CVD, Big Trades). Caveat: PAXG/USD is crypto gold spot (1 oz backed), so liquidity & spread differ slightly from COMEX GC futures; upload Databento GLBX.MDP3 CSV for native COMEX GC tape + L2 heatmap.",
      },
      sessionDate,
      asiaOpenTs: win.tokyoOpenTs,
      asiaCloseTs: win.asiaCloseTs,
      h1Candles: h1Filtered,
      m30Candles: m30Filtered,
      m5Candles,
      m1Candles: tickM1,
      ticks,
      l2Snapshots: [],
      fetchedAt: new Date().toISOString(),
    };

    return NextResponse.json({
      dataset,
      availableSessions: allSessions,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to load Kraken PAXG/USD real tape",
      },
      { status: 500 }
    );
  }
}
