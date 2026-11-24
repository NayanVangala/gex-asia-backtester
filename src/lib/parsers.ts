import {
  Candle,
  DataSourceKind,
  L2Level,
  L2Snapshot,
  SessionDataset,
  Tick,
} from "./types";
import { getGlobexSessionDate } from "./goldMath";

/**
 * Resamples raw ticks into OHLCV candles of intervalMs (e.g. 60_000 for M1, 300_000 for M5).
 */
export function resampleTicksToCandles(
  ticks: Tick[],
  intervalMs: number
): Candle[] {
  if (ticks.length === 0) return [];
  const sorted = [...ticks].sort((a, b) => a.ts - b.ts);
  const map = new Map<number, Candle>();

  for (const t of sorted) {
    const barTs = Math.floor(t.ts / intervalMs) * intervalMs;
    const existing = map.get(barTs);
    const buyAdd = t.side === "buy" ? t.size : 0;
    const sellAdd = t.side === "sell" ? t.size : 0;

    if (!existing) {
      map.set(barTs, {
        ts: barTs,
        open: t.price,
        high: t.price,
        low: t.price,
        close: t.price,
        volume: t.size,
        buyVolume: buyAdd,
        sellVolume: sellAdd,
        delta: buyAdd - sellAdd,
        tradeCount: 1,
      });
    } else {
      if (t.price > existing.high) existing.high = t.price;
      if (t.price < existing.low) existing.low = t.price;
      existing.close = t.price;
      existing.volume = Number((existing.volume + t.size).toFixed(4));
      existing.buyVolume = Number(((existing.buyVolume ?? 0) + buyAdd).toFixed(4));
      existing.sellVolume = Number(((existing.sellVolume ?? 0) + sellAdd).toFixed(4));
      existing.delta = Number(((existing.buyVolume ?? 0) - (existing.sellVolume ?? 0)).toFixed(4));
      existing.tradeCount = (existing.tradeCount ?? 0) + 1;
    }
  }

  return Array.from(map.values()).sort((a, b) => a.ts - b.ts);
}

/**
 * Resamples finer candles (e.g. M5) into higher timeframe candles (e.g. M30, H1).
 */
export function resampleCandles(
  candles: Candle[],
  targetIntervalMs: number
): Candle[] {
  if (candles.length === 0) return [];
  const sorted = [...candles].sort((a, b) => a.ts - b.ts);
  const map = new Map<number, Candle>();

  for (const c of sorted) {
    const bucket = Math.floor(c.ts / targetIntervalMs) * targetIntervalMs;
    const ex = map.get(bucket);
    if (!ex) {
      map.set(bucket, { ...c, ts: bucket });
    } else {
      ex.high = Math.max(ex.high, c.high);
      ex.low = Math.min(ex.low, c.low);
      ex.close = c.close;
      ex.volume = Number((ex.volume + c.volume).toFixed(4));
      if (c.buyVolume !== undefined) {
        ex.buyVolume = Number(((ex.buyVolume ?? 0) + c.buyVolume).toFixed(4));
      }
      if (c.sellVolume !== undefined) {
        ex.sellVolume = Number(((ex.sellVolume ?? 0) + c.sellVolume).toFixed(4));
      }
      if (ex.buyVolume !== undefined && ex.sellVolume !== undefined) {
        ex.delta = Number((ex.buyVolume - ex.sellVolume).toFixed(4));
      }
      if (c.tradeCount !== undefined) {
        ex.tradeCount = (ex.tradeCount ?? 0) + c.tradeCount;
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => a.ts - b.ts);
}

function parseTimestampMs(raw: string): number {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    // Nanoseconds (Databento ts_event ~ 1.7e18)
    if (num > 1e16) return Math.floor(num / 1e6);
    // Microseconds (~1.7e15)
    if (num > 1e13) return Math.floor(num / 1e3);
    // Milliseconds (~1.7e12)
    if (num > 1e10) return num;
    // Unix seconds (~1.7e9)
    return num * 1000;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeDatabentoPrice(rawVal: number): number {
  // Databento DBN CSV sometimes outputs fixed-point 1e-9 prices (e.g. 4392800000000)
  if (Math.abs(rawVal) > 1e7) {
    return Number((rawVal / 1e9).toFixed(4));
  }
  return rawVal;
}

function parseSide(raw?: string): "buy" | "sell" | "unknown" {
  if (!raw) return "unknown";
  const s = raw.trim().toUpperCase();
  if (s === "B" || s === "BUY" || s === "ASK" || s === "1" || s === "UP") {
    return "buy";
  }
  if (s === "S" || s === "A" || s === "SELL" || s === "BID" || s === "-1" || s === "DOWN") {
    // Note: in Databento trades schema, side='A' means aggressor hit the ask? Wait:
    // Databento docs: side 'B' = buyer initiated (aggressor bought), 'A' = seller initiated (aggressor sold / hit bid), 'N' = none.
    return "sell";
  }
  return "unknown";
}

export interface ParsedUploadResult {
  dataset: SessionDataset;
  detectedFormat: string;
  rowCount: number;
}

/**
 * Parses uploaded Databento CME GLBX.MDP3 CSV (trades, tbbo, mbp-10),
 * ATAS/Sierra Tick CSV, or generic OHLCV CSV into a full SessionDataset.
 */
export function parseMarketDataCSV(
  text: string,
  filename: string
): ParsedUploadResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  if (lines.length < 2) {
    throw new Error("CSV has fewer than 2 rows.");
  }

  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0]
    .split(delimiter)
    .map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());

  const idxOf = (...names: string[]) => {
    for (const n of names) {
      const idx = headers.indexOf(n);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  // Check if Databento MBP-10 (has bid_px_00 & ask_px_00)
  const hasMbp = headers.includes("bid_px_00") && headers.includes("ask_px_00");
  const hasOhlc =
    idxOf("open", "o") !== -1 &&
    idxOf("high", "h") !== -1 &&
    idxOf("low", "l") !== -1 &&
    idxOf("close", "c") !== -1;

  const tsIdx = idxOf(
    "ts_event",
    "ts_recv",
    "timestamp",
    "time",
    "datetime",
    "date"
  );
  if (tsIdx === -1) {
    throw new Error(
      `Could not find timestamp column in headers: ${headers.join(", ")}`
    );
  }

  const symbolIdx = idxOf("symbol", "instrument", "ticker");
  let detectedInstrument = filename.toUpperCase().includes("PAXG")
    ? "PAXG/USD"
    : "GC (Uploaded)";

  // 1) OHLCV CSV path
  if (hasOhlc && !hasMbp) {
    const oIdx = idxOf("open", "o");
    const hIdx = idxOf("high", "h");
    const lIdx = idxOf("low", "l");
    const cIdx = idxOf("close", "c");
    const vIdx = idxOf("volume", "vol", "v", "size");

    const candles: Candle[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(delimiter);
      const ts = parseTimestampMs(cols[tsIdx] ?? "");
      if (!ts) continue;
      if (symbolIdx !== -1 && i === 1 && cols[symbolIdx]) {
        detectedInstrument = cols[symbolIdx].trim();
      }
      const open = normalizeDatabentoPrice(Number(cols[oIdx]));
      const high = normalizeDatabentoPrice(Number(cols[hIdx]));
      const low = normalizeDatabentoPrice(Number(cols[lIdx]));
      const close = normalizeDatabentoPrice(Number(cols[cIdx]));
      const volume = vIdx !== -1 ? Number(cols[vIdx]) || 1 : 1;
      if ([open, high, low, close].some(Number.isNaN)) continue;
      candles.push({ ts, open, high, low, close, volume });
    }

    if (candles.length === 0) {
      throw new Error("Parsed 0 valid OHLCV rows.");
    }
    candles.sort((a, b) => a.ts - b.ts);

    // Infer bar interval
    const diffs = candles
      .slice(1, 20)
      .map((c, idx) => c.ts - candles[idx].ts)
      .filter((d) => d > 0)
      .sort((a, b) => a - b);
    const medianStep = diffs[Math.floor(diffs.length / 2)] ?? 300_000;

    const m1Candles = medianStep <= 90_000 ? candles : [];
    const m5Candles =
      medianStep <= 300_000
        ? resampleCandles(candles, 300_000)
        : candles;
    const m30Candles = resampleCandles(m5Candles, 1_800_000);
    const h1Candles = resampleCandles(m5Candles, 3_600_000);

    const lastTs = m5Candles[m5Candles.length - 1].ts;
    const sessionDate = getGlobexSessionDate(lastTs);

    return {
      detectedFormat: "OHLCV CSV",
      rowCount: candles.length,
      dataset: {
        id: `upload-ohlcv-${Date.now()}`,
        title: `${detectedInstrument} · ${filename}`,
        instrument: detectedInstrument,
        dataSource: "custom_ohlcv",
        capabilities: {
          hasRealAggressorTape: false,
          hasRealL2Depth: false,
          sourceLabel: `Uploaded OHLCV CSV (${filename})`,
          instrument: detectedInstrument,
          tickSize: 0.1,
          pointValue: 100,
          caveat:
            "OHLCV CSV only: volume profile and candles are real, but no bid/ask aggressor tape or L2 book is present.",
        },
        sessionDate,
        asiaOpenTs: m5Candles[0].ts,
        asiaCloseTs: lastTs,
        h1Candles,
        m30Candles,
        m5Candles,
        m1Candles,
        ticks: [],
        l2Snapshots: [],
        fetchedAt: new Date().toISOString(),
      },
    };
  }

  // 2) Tick / Databento trades / Databento MBP-10 path
  const priceIdx = idxOf("price", "last", "px", "trade_price");
  const sizeIdx = idxOf("size", "volume", "qty", "vol", "quantity");
  const sideIdx = idxOf("side", "aggressor", "direction", "taker_side");
  const actionIdx = idxOf("action");

  if (priceIdx === -1 && !hasMbp) {
    throw new Error(
      `Could not find price column in headers: ${headers.join(", ")}`
    );
  }

  // Precompute MBP column indices if present
  const mbpCols: Array<{
    bidPx: number;
    bidSz: number;
    askPx: number;
    askSz: number;
  }> = [];
  if (hasMbp) {
    for (let lvl = 0; lvl < 10; lvl++) {
      const s = String(lvl).padStart(2, "0");
      const bidPx = idxOf(`bid_px_${s}`);
      const bidSz = idxOf(`bid_sz_${s}`);
      const askPx = idxOf(`ask_px_${s}`);
      const askSz = idxOf(`ask_sz_${s}`);
      if (bidPx !== -1 && askPx !== -1) {
        mbpCols.push({ bidPx, bidSz, askPx, askSz });
      }
    }
  }

  const ticks: Tick[] = [];
  const l2Snapshots: L2Snapshot[] = [];
  let lastSnapshotTs = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delimiter);
    const ts = parseTimestampMs(cols[tsIdx] ?? "");
    if (!ts) continue;

    if (symbolIdx !== -1 && i === 1 && cols[symbolIdx]) {
      detectedInstrument = cols[symbolIdx].trim();
    }

    const action = actionIdx !== -1 ? (cols[actionIdx] ?? "").trim().toUpperCase() : "T";

    // Record trade rows (in Databento MBP-10, action === 'T' is a trade event)
    if (priceIdx !== -1 && (!hasMbp || action === "T" || action === "")) {
      const price = normalizeDatabentoPrice(Number(cols[priceIdx]));
      const size = sizeIdx !== -1 ? Number(cols[sizeIdx]) : 1;
      if (!Number.isNaN(price) && price > 0 && !Number.isNaN(size) && size > 0) {
        ticks.push({
          ts,
          price,
          size,
          side: sideIdx !== -1 ? parseSide(cols[sideIdx]) : "unknown",
        });
      }
    }

    // Sample L2 snapshots at most every 5 seconds to keep heatmap fast and crisp
    if (hasMbp && ts - lastSnapshotTs >= 5000) {
      const bids: L2Level[] = [];
      const asks: L2Level[] = [];
      for (const mc of mbpCols) {
        const bp = normalizeDatabentoPrice(Number(cols[mc.bidPx]));
        const bs = Number(cols[mc.bidSz]);
        const ap = normalizeDatabentoPrice(Number(cols[mc.askPx]));
        const as = Number(cols[mc.askSz]);
        if (!Number.isNaN(bp) && bp > 0 && !Number.isNaN(bs) && bs > 0) {
          bids.push({ price: bp, size: bs });
        }
        if (!Number.isNaN(ap) && ap > 0 && !Number.isNaN(as) && as > 0) {
          asks.push({ price: ap, size: as });
        }
      }
      if (bids.length > 0 || asks.length > 0) {
        l2Snapshots.push({ ts, bids, asks });
        lastSnapshotTs = ts;
      }
    }
  }

  if (ticks.length === 0 && l2Snapshots.length === 0) {
    throw new Error("Parsed 0 valid trade or L2 rows from CSV.");
  }

  // If MBP-10 file had only book updates and zero 'T' trades, derive midprice candles from L2
  const m1Candles =
    ticks.length > 0
      ? resampleTicksToCandles(ticks, 60_000)
      : l2Snapshots.map((s) => {
          const mid = ((s.bids[0]?.price ?? 0) + (s.asks[0]?.price ?? 0)) / 2;
          return {
            ts: s.ts,
            open: mid,
            high: mid,
            low: mid,
            close: mid,
            volume: 1,
          };
        });

  const m5Candles = resampleCandles(m1Candles, 300_000);
  const m30Candles = resampleCandles(m5Candles, 1_800_000);
  const h1Candles = resampleCandles(m5Candles, 3_600_000);

  const lastTs = m5Candles[m5Candles.length - 1]?.ts ?? Date.now();
  const firstTs = m5Candles[0]?.ts ?? lastTs;
  const sessionDate = getGlobexSessionDate(lastTs);

  const dataSource: DataSourceKind = hasMbp
    ? "databento_mbp10"
    : headers.includes("ts_event")
      ? "databento_trades"
      : "custom_ticks";

  const hasAggressor = ticks.some((t) => t.side === "buy" || t.side === "sell");

  return {
    detectedFormat: hasMbp
      ? "Databento MBP-10 (Trades + Real L2 Book)"
      : dataSource === "databento_trades"
        ? "Databento GLBX.MDP3 Trades"
        : "Tick Trade Tape CSV",
    rowCount: ticks.length + l2Snapshots.length,
    dataset: {
      id: `upload-${dataSource}-${Date.now()}`,
      title: `${detectedInstrument} · ${filename}`,
      instrument: detectedInstrument,
      dataSource,
      capabilities: {
        hasRealAggressorTape: hasAggressor,
        hasRealL2Depth: l2Snapshots.length > 0,
        sourceLabel: hasMbp
          ? `Databento MBP-10 (${filename})`
          : `Uploaded Trade Tape (${filename})`,
        instrument: detectedInstrument,
        tickSize: 0.1,
        pointValue: 100,
        caveat: hasMbp
          ? undefined
          : "Real trade tape loaded (Footprint, CVD, Big Trades live). No L2 depth columns in file; upload MBP-10 CSV for heatmap.",
      },
      sessionDate,
      asiaOpenTs: firstTs,
      asiaCloseTs: lastTs,
      h1Candles,
      m30Candles,
      m5Candles,
      m1Candles,
      ticks,
      l2Snapshots,
      fetchedAt: new Date().toISOString(),
    },
  };
}
