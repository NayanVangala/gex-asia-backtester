import {
  BigTradePrint,
  FootprintBar,
  FootprintPriceRow,
  Tick,
} from "./types";

export interface FootprintBuildOptions {
  intervalMs: number; // 300_000 for M5, 60_000 for M1
  priceStep: number; // e.g., 0.25 or 0.50 or 1.00
  imbalanceRatio?: number; // default 3.0 (300% per DeepCharts/ATAS template)
  minImbalanceVolume?: number; // minimum row vol to flag imbalance
  bigTradeLargeThreshold?: number; // auto-calibrated from Asia 90th pct if omitted
  bigTradeWhaleThreshold?: number; // auto-calibrated from Asia 98th pct if omitted
}

export interface FootprintSuite {
  bars: FootprintBar[];
  calibratedLargeThreshold: number;
  calibratedWhaleThreshold: number;
  allBigTrades: BigTradePrint[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * p))
  );
  return sorted[idx];
}

/**
 * Builds authentic Bid x Ask footprint bars, diagonal 300% imbalances,
 * ClusterStatistic rows (Delta, Max/Min Delta, CVD), Asia-calibrated Big Trades,
 * and objective Absorption / Exhaustion / Aggression Flip / CVD Divergence flags
 * strictly from REAL tick-by-tick trade data.
 */
export function buildFootprintsFromTicks(
  ticks: Tick[],
  options: FootprintBuildOptions
): FootprintSuite {
  if (ticks.length === 0) {
    return {
      bars: [],
      calibratedLargeThreshold: options.bigTradeLargeThreshold ?? 1,
      calibratedWhaleThreshold: options.bigTradeWhaleThreshold ?? 3,
      allBigTrades: [],
    };
  }

  const {
    intervalMs,
    priceStep,
    imbalanceRatio = 3.0,
    minImbalanceVolume = 0.05,
  } = options;

  // Calibrate Big Trades from THIS Asia tape (Section 4: never hardcode NY size on thin Asia tape!)
  const sizesSorted = ticks.map((t) => t.size).sort((a, b) => a - b);
  const autoLarge = Math.max(0.05, percentile(sizesSorted, 0.92));
  const autoWhale = Math.max(autoLarge * 1.8, percentile(sizesSorted, 0.985));

  const largeThreshold = options.bigTradeLargeThreshold ?? Number(autoLarge.toFixed(4));
  const whaleThreshold = options.bigTradeWhaleThreshold ?? Number(autoWhale.toFixed(4));

  const quantize = (p: number) =>
    Number((Math.round(p / priceStep) * priceStep).toFixed(4));

  // Bucket ticks into bars
  const sortedTicks = [...ticks].sort((a, b) => a.ts - b.ts);
  const barBuckets = new Map<number, Tick[]>();
  for (const t of sortedTicks) {
    const barTs = Math.floor(t.ts / intervalMs) * intervalMs;
    const arr = barBuckets.get(barTs);
    if (arr) arr.push(t);
    else barBuckets.set(barTs, [t]);
  }

  const barTimestamps = Array.from(barBuckets.keys()).sort((a, b) => a - b);
  const bars: FootprintBar[] = [];
  const allBigTrades: BigTradePrint[] = [];
  let runningCvd = 0;

  for (const barTs of barTimestamps) {
    const barTicks = barBuckets.get(barTs) ?? [];
    if (barTicks.length === 0) continue;

    const open = barTicks[0].price;
    const close = barTicks[barTicks.length - 1].price;
    let high = open;
    let low = open;
    let buyVol = 0;
    let sellVol = 0;
    let totalVol = 0;
    let intraDelta = 0;
    let maxDelta = -Infinity;
    let minDelta = Infinity;

    const rowMap = new Map<number, { bidVol: number; askVol: number }>();
    const barBigTrades: BigTradePrint[] = [];

    for (const t of barTicks) {
      if (t.price > high) high = t.price;
      if (t.price < low) low = t.price;
      totalVol += t.size;

      const pKey = quantize(t.price);
      const cell = rowMap.get(pKey) ?? { bidVol: 0, askVol: 0 };

      if (t.side === "buy") {
        buyVol += t.size;
        cell.askVol += t.size;
        intraDelta += t.size;
      } else if (t.side === "sell") {
        sellVol += t.size;
        cell.bidVol += t.size;
        intraDelta -= t.size;
      } else {
        // Unknown side split evenly without skewing delta
        cell.askVol += t.size * 0.5;
        cell.bidVol += t.size * 0.5;
      }

      rowMap.set(pKey, cell);
      if (intraDelta > maxDelta) maxDelta = intraDelta;
      if (intraDelta < minDelta) minDelta = intraDelta;

      if (t.size >= largeThreshold) {
        const print: BigTradePrint = {
          ts: t.ts,
          barTs,
          price: t.price,
          size: Number(t.size.toFixed(4)),
          side: t.side,
          tier: t.size >= whaleThreshold ? "whale" : "large",
        };
        barBigTrades.push(print);
        allBigTrades.push(print);
      }
    }

    if (maxDelta === -Infinity) maxDelta = 0;
    if (minDelta === Infinity) minDelta = 0;

    const delta = buyVol - sellVol;
    runningCvd += delta;

    // Build contiguous sorted rows from high down to low
    const pLow = quantize(low);
    const pHigh = quantize(high);
    const numRows = Math.min(80, Math.max(1, Math.round((pHigh - pLow) / priceStep) + 1));
    const pricesDesc: number[] = [];
    for (let i = 0; i < numRows; i++) {
      pricesDesc.push(Number((pHigh - i * priceStep).toFixed(4)));
    }

    // Find bar POC
    let pocPrice = pricesDesc[0];
    let maxRowVol = -1;
    const rawRows = pricesDesc.map((p) => {
      const c = rowMap.get(p) ?? { bidVol: 0, askVol: 0 };
      const tot = c.bidVol + c.askVol;
      if (tot > maxRowVol) {
        maxRowVol = tot;
        pocPrice = p;
      }
      return {
        price: p,
        bidVol: Number(c.bidVol.toFixed(3)),
        askVol: Number(c.askVol.toFixed(3)),
        totalVol: Number(tot.toFixed(3)),
        delta: Number((c.askVol - c.bidVol).toFixed(3)),
      };
    });

    // Diagonal 300% imbalances (ATAS / DeepCharts standard)
    // Ask (Buy) imbalance at price p compares askVol[p] vs bidVol[p - step] (next row down, idx + 1)
    // Bid (Sell) imbalance at price p compares bidVol[p] vs askVol[p + step] (next row up, idx - 1)
    const meanRowVol = totalVol / Math.max(1, rawRows.length);
    const rows: FootprintPriceRow[] = rawRows.map((r, idx) => {
      const below = idx + 1 < rawRows.length ? rawRows[idx + 1] : null;
      const above = idx - 1 >= 0 ? rawRows[idx - 1] : null;

      const askImbalance =
        r.askVol >= minImbalanceVolume &&
        below !== null &&
        r.askVol >= Math.max(below.bidVol, 1e-6) * imbalanceRatio &&
        r.askVol >= meanRowVol * 0.6;

      const bidImbalance =
        r.bidVol >= minImbalanceVolume &&
        above !== null &&
        r.bidVol >= Math.max(above.askVol, 1e-6) * imbalanceRatio &&
        r.bidVol >= meanRowVol * 0.6;

      const isNearLow = idx >= rawRows.length - Math.max(1, Math.ceil(rawRows.length * 0.3));
      const isNearHigh = idx < Math.max(1, Math.ceil(rawRows.length * 0.3));
      const barRange = Math.max(priceStep, high - low);
      const closePos = (close - low) / barRange;

      const isAbsorptionCell =
        (isNearLow && r.bidVol >= meanRowVol * 1.8 && r.delta < 0 && closePos >= 0.45) ||
        (isNearHigh && r.askVol >= meanRowVol * 1.8 && r.delta > 0 && closePos <= 0.55);

      return {
        ...r,
        bidImbalance,
        askImbalance,
        isPoc: r.price === pocPrice,
        isAbsorptionCell,
      };
    });

    // Count max consecutive stacked imbalances
    let stackedBuy = 0;
    let curBuy = 0;
    let stackedSell = 0;
    let curSell = 0;
    for (const r of rows) {
      if (r.askImbalance) {
        curBuy++;
        if (curBuy > stackedBuy) stackedBuy = curBuy;
      } else {
        curBuy = 0;
      }
      if (r.bidImbalance) {
        curSell++;
        if (curSell > stackedSell) stackedSell = curSell;
      } else {
        curSell = 0;
      }
    }

    // Objective Absorption & Exhaustion flags (Section 4)
    const barRange = Math.max(priceStep, high - low);
    const closePos = (close - low) / barRange;
    const bottomRows = rows.slice(-Math.max(1, Math.ceil(rows.length * 0.3)));
    const topRows = rows.slice(0, Math.max(1, Math.ceil(rows.length * 0.3)));
    const bottomBidSum = bottomRows.reduce((s, r) => s + r.bidVol, 0);
    const topAskSum = topRows.reduce((s, r) => s + r.askVol, 0);

    // Bullish absorption at low: heavy selling into bid at low (negative delta or big bottom bid vol), yet price closes off the lows
    const absorptionLow =
      rows.length >= 2 &&
      bottomBidSum >= totalVol * 0.32 &&
      (delta < 0 || minDelta < -totalVol * 0.15) &&
      closePos >= 0.48;

    // Bearish absorption at high: heavy buying into ask at high, yet price closes off the highs
    const absorptionHigh =
      rows.length >= 2 &&
      topAskSum >= totalVol * 0.32 &&
      (delta > 0 || maxDelta > totalVol * 0.15) &&
      closePos <= 0.52;

    const lowestRow = rows[rows.length - 1];
    const highestRow = rows[0];
    const exhaustionLow =
      rows.length >= 3 &&
      lowestRow.totalVol > 0 &&
      lowestRow.totalVol <= meanRowVol * 0.18 &&
      closePos >= 0.5;
    const exhaustionHigh =
      rows.length >= 3 &&
      highestRow.totalVol > 0 &&
      highestRow.totalVol <= meanRowVol * 0.18 &&
      closePos <= 0.5;

    bars.push({
      ts: barTs,
      open,
      high,
      low,
      close,
      totalVol: Number(totalVol.toFixed(3)),
      buyVol: Number(buyVol.toFixed(3)),
      sellVol: Number(sellVol.toFixed(3)),
      delta: Number(delta.toFixed(3)),
      maxDelta: Number(maxDelta.toFixed(3)),
      minDelta: Number(minDelta.toFixed(3)),
      cumDelta: Number(runningCvd.toFixed(3)),
      pocPrice,
      tradeCount: barTicks.length,
      rows,
      stackedBuyImbalances: stackedBuy,
      stackedSellImbalances: stackedSell,
      absorptionLow,
      absorptionHigh,
      exhaustionLow,
      exhaustionHigh,
      aggressionFlipBull: false,
      aggressionFlipBear: false,
      cvdDivergenceBull: false,
      cvdDivergenceBear: false,
      bigTrades: barBigTrades,
    });
  }

  // Second pass: Aggression Flip & CVD Divergence (needs recent bar history)
  for (let i = 1; i < bars.length; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    const prev2 = i >= 2 ? bars[i - 2] : null;

    // Bullish aggression flip: absorption or heavy negative delta in prior 1-2 bars followed by positive delta + close higher
    if (
      (prev.absorptionLow || prev.delta < 0 || prev2?.absorptionLow) &&
      cur.delta > 0 &&
      cur.close > cur.open &&
      (cur.stackedBuyImbalances >= 2 || cur.delta > Math.abs(prev.delta) * 0.5)
    ) {
      cur.aggressionFlipBull = true;
    }

    if (
      (prev.absorptionHigh || prev.delta > 0 || prev2?.absorptionHigh) &&
      cur.delta < 0 &&
      cur.close < cur.open &&
      (cur.stackedSellImbalances >= 2 || Math.abs(cur.delta) > prev.delta * 0.5)
    ) {
      cur.aggressionFlipBear = true;
    }

    // CVD Divergence over trailing 6 bars
    if (i >= 3) {
      const lookback = bars.slice(Math.max(0, i - 6), i);
      const minPrevLow = Math.min(...lookback.map((b) => b.low));
      const minPrevCvd = Math.min(...lookback.map((b) => b.cumDelta));
      if (cur.low < minPrevLow && cur.cumDelta > minPrevCvd) {
        cur.cvdDivergenceBull = true;
      }
      const maxPrevHigh = Math.max(...lookback.map((b) => b.high));
      const maxPrevCvd = Math.max(...lookback.map((b) => b.cumDelta));
      if (cur.high > maxPrevHigh && cur.cumDelta < maxPrevCvd) {
        cur.cvdDivergenceBear = true;
      }
    }
  }

  return {
    bars,
    calibratedLargeThreshold: largeThreshold,
    calibratedWhaleThreshold: whaleThreshold,
    allBigTrades,
  };
}
