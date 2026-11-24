import {
  Candle,
  KeyLevelZone,
  NakedPoc,
  Tick,
  VolumeProfileBin,
  VolumeProfileResult,
} from "./types";
import { getGlobexSessionDate } from "./goldMath";

/**
 * Standard 70% Value Area calculation matching CME Market Profile / ATAS Volume Profile:
 * 1. Find POC (bin with maximum volume).
 * 2. Expand outward comparing the sum of 2 bins above vs 2 bins below until >= 70% of total volume.
 */
export function buildVolumeProfile(params: {
  id: string;
  label: string;
  kind: VolumeProfileResult["kind"];
  candles: Candle[];
  ticks?: Tick[];
  priceStep?: number;
  valueAreaRatio?: number;
}): VolumeProfileResult | null {
  const { id, label, kind, candles, ticks, valueAreaRatio = 0.7 } = params;
  if (candles.length === 0 && (!ticks || ticks.length === 0)) return null;

  const allPrices =
    ticks && ticks.length > 0
      ? ticks.map((t) => t.price)
      : candles.flatMap((c) => [c.high, c.low]);
  const high = Math.max(...allPrices);
  const low = Math.min(...allPrices);
  const range = Math.max(0.5, high - low);

  // Pick a sensible price step if omitted so profiles have ~40-140 crisp bins
  const step =
    params.priceStep ??
    (range <= 20 ? 0.25 : range <= 60 ? 0.5 : range <= 160 ? 1.0 : 2.0);

  const binMap = new Map<number, number>();
  const quantize = (p: number) =>
    Number((Math.round(p / step) * step).toFixed(4));

  if (ticks && ticks.length > 0) {
    for (const t of ticks) {
      const key = quantize(t.price);
      binMap.set(key, (binMap.get(key) ?? 0) + Math.max(t.size, 0.0001));
    }
  } else {
    for (const c of candles) {
      const vol = Math.max(c.volume, 1);
      const loKey = quantize(c.low);
      const hiKey = quantize(c.high);
      const numSteps = Math.max(1, Math.round((hiKey - loKey) / step) + 1);
      // Weight slightly more volume toward the candle body (open-close range) than pure wick extremes
      const bodyLo = Math.min(c.open, c.close);
      const bodyHi = Math.max(c.open, c.close);
      let weightSum = 0;
      const weights: Array<{ price: number; w: number }> = [];
      for (let i = 0; i < numSteps; i++) {
        const p = Number((loKey + i * step).toFixed(4));
        const inBody = p >= bodyLo - step * 0.5 && p <= bodyHi + step * 0.5;
        const w = inBody ? 1.5 : 0.7;
        weights.push({ price: p, w });
        weightSum += w;
      }
      for (const item of weights) {
        binMap.set(
          item.price,
          (binMap.get(item.price) ?? 0) + (vol * item.w) / weightSum
        );
      }
    }
  }

  // Build contiguous price grid from min to max (capped at 450 bins for wide ranges)
  const rawSorted = Array.from(binMap.keys()).sort((a, b) => a - b);
  if (rawSorted.length === 0) return null;

  const minKey = rawSorted[0];
  const maxKey = rawSorted[rawSorted.length - 1];
  const spanCount = Math.round((maxKey - minKey) / step) + 1;
  const sortedPrices: number[] =
    spanCount <= 450
      ? Array.from({ length: spanCount }, (_, idx) =>
          Number((minKey + idx * step).toFixed(4))
        )
      : rawSorted;

  const volumes = sortedPrices.map((p) => binMap.get(p) ?? 0);
  const totalVolume = volumes.reduce((a, b) => a + b, 0);
  if (totalVolume <= 0) return null;

  // Locate POC
  let pocIdx = 0;
  for (let i = 1; i < volumes.length; i++) {
    if (volumes[i] > volumes[pocIdx]) pocIdx = i;
  }

  // Dual-row Value Area expansion (70%) with symmetric tie handling
  const targetVol = totalVolume * valueAreaRatio;
  let captured = volumes[pocIdx];
  let lowIdx = pocIdx;
  let highIdx = pocIdx;

  while (captured < targetVol && (lowIdx > 0 || highIdx < volumes.length - 1)) {
    const upVol =
      (highIdx + 1 < volumes.length ? volumes[highIdx + 1] : 0) +
      (highIdx + 2 < volumes.length ? volumes[highIdx + 2] : 0);
    const downVol =
      (lowIdx - 1 >= 0 ? volumes[lowIdx - 1] : 0) +
      (lowIdx - 2 >= 0 ? volumes[lowIdx - 2] : 0);

    if (upVol === 0 && downVol === 0) {
      // Expand through empty gap toward remaining non-zero bins
      if (highIdx < volumes.length - 1) highIdx++;
      if (lowIdx > 0) lowIdx--;
      captured +=
        (highIdx < volumes.length ? volumes[highIdx] : 0) +
        (lowIdx >= 0 ? volumes[lowIdx] : 0);
      continue;
    }

    if (Math.abs(upVol - downVol) < 1e-6 && highIdx < volumes.length - 1 && lowIdx > 0) {
      // Exact tie: expand symmetrically one row each side
      highIdx++;
      lowIdx--;
      captured += volumes[highIdx] + volumes[lowIdx];
    } else if (upVol > downVol && highIdx < volumes.length - 1) {
      highIdx++;
      captured += volumes[highIdx];
      if (captured < targetVol && highIdx < volumes.length - 1) {
        highIdx++;
        captured += volumes[highIdx];
      }
    } else if (lowIdx > 0) {
      lowIdx--;
      captured += volumes[lowIdx];
      if (captured < targetVol && lowIdx > 0) {
        lowIdx--;
        captured += volumes[lowIdx];
      }
    } else if (highIdx < volumes.length - 1) {
      highIdx++;
      captured += volumes[highIdx];
    }
  }

  // Detect HVNs & LVNs using smoothed neighborhood comparison
  const meanVol = totalVolume / volumes.length;
  const hvns: number[] = [];
  const lvns: number[] = [];
  const bins: VolumeProfileBin[] = sortedPrices.map((price, idx) => {
    const v = volumes[idx];
    const prev = idx > 0 ? volumes[idx - 1] : v;
    const next = idx < volumes.length - 1 ? volumes[idx + 1] : v;
    const prev2 = idx > 1 ? volumes[idx - 2] : prev;
    const next2 = idx < volumes.length - 2 ? volumes[idx + 2] : next;

    const isLocalMax =
      idx > 1 &&
      idx < volumes.length - 2 &&
      v >= prev &&
      v >= next &&
      v >= prev2 &&
      v >= next2 &&
      v >= meanVol * 1.45;

    const isLocalMin =
      idx > 2 &&
      idx < volumes.length - 3 &&
      v <= prev &&
      v <= next &&
      v <= meanVol * 0.48 &&
      Math.max(prev2, next2) >= meanVol * 0.75;

    if (isLocalMax) hvns.push(price);
    if (isLocalMin) lvns.push(price);

    return {
      price,
      volume: Number(v.toFixed(2)),
      isHvn: isLocalMax,
      isLvn: isLocalMin,
    };
  });

  const startTs =
    candles.length > 0 ? candles[0].ts : (ticks?.[0]?.ts ?? 0);
  const endTs =
    candles.length > 0
      ? candles[candles.length - 1].ts
      : (ticks?.[ticks.length - 1]?.ts ?? 0);

  return {
    id,
    label,
    kind,
    startTs,
    endTs,
    poc: sortedPrices[pocIdx],
    vah: sortedPrices[highIdx],
    val: sortedPrices[lowIdx],
    totalVolume: Number(totalVolume.toFixed(2)),
    bins,
    hvns: hvns.slice(0, 4),
    lvns: lvns.slice(0, 4),
    high,
    low,
  };
}

export interface SessionProfilesBundle {
  previousDay: VolumeProfileResult | null;
  previousWeek: VolumeProfileResult | null;
  composite5d: VolumeProfileResult | null;
  developing: VolumeProfileResult | null;
  nakedPocs: NakedPoc[];
  autoZones: KeyLevelZone[];
}

/**
 * Computes all Asia Value Model profiles strictly up to `replayTs` (zero lookahead):
 * - Previous Day (PD) VAH / POC / VAL
 * - Previous Week (PW) VAH / POC / VAL
 * - 5-Session Composite VAH / POC / VAL
 * - Developing (today's Asia/Globex session up to replayTs) VAH / vPOC / VAL
 * - Naked POCs (untested prior session POCs)
 * - Auto-detected Stacked Zones (levels within $3.00 of each other)
 */
export function computeAllSessionProfiles(params: {
  h1Candles: Candle[];
  m5Candles: Candle[];
  replayTs: number;
  currentSessionDate: string;
}): SessionProfilesBundle {
  const { h1Candles, m5Candles, replayTs, currentSessionDate } = params;

  // Strict no-lookahead filter
  const visibleH1 = h1Candles.filter((c) => c.ts <= replayTs);
  const visibleM5 = m5Candles.filter((c) => c.ts <= replayTs);

  // Group H1 candles by Globex session date
  const bySession = new Map<string, Candle[]>();
  for (const c of visibleH1) {
    const key = getGlobexSessionDate(c.ts);
    const arr = bySession.get(key) ?? [];
    arr.push(c);
    bySession.set(key, arr);
  }

  // Also include M5 candles for prior sessions if H1 history is short
  if (bySession.size < 2) {
    for (const c of visibleM5) {
      const key = getGlobexSessionDate(c.ts);
      if (key !== currentSessionDate) {
        const arr = bySession.get(key) ?? [];
        arr.push(c);
        bySession.set(key, arr);
      }
    }
  }

  const priorSessionDates = Array.from(bySession.keys())
    .filter((d) => d < currentSessionDate)
    .sort();

  const prevDayDate = priorSessionDates[priorSessionDates.length - 1];
  const prevDayCandles = prevDayDate ? (bySession.get(prevDayDate) ?? []) : [];

  const previousDay =
    prevDayCandles.length > 0
      ? buildVolumeProfile({
          id: `pd-${prevDayDate}`,
          label: `PD (${prevDayDate})`,
          kind: "pd",
          candles: prevDayCandles,
          priceStep: 0.5,
        })
      : null;

  // 5-Session Composite
  const last5Dates = priorSessionDates.slice(-5);
  const compCandles = last5Dates.flatMap((d) => bySession.get(d) ?? []);
  const composite5d =
    compCandles.length > 0
      ? buildVolumeProfile({
          id: "composite-5d",
          label: `Composite (${last5Dates.length}D)`,
          kind: "composite",
          candles: compCandles,
          priceStep: 1.0,
        })
      : null;

  // Previous Week (5-7 trading days prior to current week, or prior 5-10 sessions)
  const pwDates =
    priorSessionDates.length >= 6
      ? priorSessionDates.slice(-10, -5)
      : priorSessionDates.slice(0, Math.max(1, priorSessionDates.length - 1));
  const pwCandles = pwDates.flatMap((d) => bySession.get(d) ?? []);
  const previousWeek =
    pwCandles.length > 0
      ? buildVolumeProfile({
          id: "pw",
          label: `PW (${pwDates.length}D)`,
          kind: "pw",
          candles: pwCandles,
          priceStep: 1.0,
        })
      : null;

  // Developing session profile (today's bars up to replayTs)
  const devM5 = visibleM5.filter(
    (c) => getGlobexSessionDate(c.ts) === currentSessionDate
  );
  const developing =
    devM5.length > 0
      ? buildVolumeProfile({
          id: `dev-${currentSessionDate}`,
          label: "Developing",
          kind: "developing",
          candles: devM5,
          priceStep: 0.25,
        })
      : null;

  // Naked POCs across prior sessions
  const nakedPocs: NakedPoc[] = [];
  for (let i = 0; i < priorSessionDates.length; i++) {
    const sDate = priorSessionDates[i];
    const sCandles = bySession.get(sDate) ?? [];
    const prof = buildVolumeProfile({
      id: `npoc-${sDate}`,
      label: sDate,
      kind: "pd",
      candles: sCandles,
      priceStep: 0.5,
    });
    if (!prof) continue;

    // Check if any subsequent bar (prior sessions OR visible today up to replayTs) touched this POC
    const laterBars = [
      ...priorSessionDates
        .slice(i + 1)
        .flatMap((d) => bySession.get(d) ?? []),
      ...devM5,
    ];
    const hitBar = laterBars.find(
      (b) => b.low <= prof.poc && b.high >= prof.poc
    );
    nakedPocs.push({
      sessionDate: sDate,
      price: prof.poc,
      volume: prof.totalVolume,
      sessionTs: prof.endTs,
      untested: !hitBar,
      testedAtTs: hitBar?.ts,
    });
  }

  // Build candidate levels and detect stacked confluences (within $3.00)
  interface RawLevel {
    label: string;
    price: number;
    kind: KeyLevelZone["kind"];
  }
  const rawLevels: RawLevel[] = [];
  if (previousDay) {
    rawLevels.push(
      { label: "PD VAH", price: previousDay.vah, kind: "pd" },
      { label: "PD POC", price: previousDay.poc, kind: "pd" },
      { label: "PD VAL", price: previousDay.val, kind: "pd" }
    );
  }
  if (previousWeek) {
    rawLevels.push(
      { label: "PW VAH", price: previousWeek.vah, kind: "pw" },
      { label: "PW POC", price: previousWeek.poc, kind: "pw" },
      { label: "PW VAL", price: previousWeek.val, kind: "pw" }
    );
  }
  if (composite5d) {
    rawLevels.push(
      { label: "Comp VAH", price: composite5d.vah, kind: "composite" },
      { label: "Comp POC", price: composite5d.poc, kind: "composite" },
      { label: "Comp VAL", price: composite5d.val, kind: "composite" }
    );
    for (const hvn of composite5d.hvns.slice(0, 2)) {
      rawLevels.push({ label: "Comp HVN", price: hvn, kind: "hvn" });
    }
    for (const lvn of composite5d.lvns.slice(0, 2)) {
      rawLevels.push({ label: "Comp LVN", price: lvn, kind: "lvn" });
    }
  }
  for (const npoc of nakedPocs.filter((n) => n.untested).slice(-2)) {
    rawLevels.push({
      label: `nPOC (${npoc.sessionDate.slice(5)})`,
      price: npoc.price,
      kind: "npoc",
    });
  }

  // Cluster levels within $3.00 into Stacked Zones (like 4390-4393 PD POC + PW VAH)
  const sorted = [...rawLevels].sort((a, b) => a.price - b.price);
  const autoZones: KeyLevelZone[] = [];
  let i = 0;
  while (i < sorted.length) {
    const group = [sorted[i]];
    let j = i + 1;
    while (j < sorted.length && sorted[j].price - group[0].price <= 3.0) {
      group.push(sorted[j]);
      j++;
    }
    const minP = Math.min(...group.map((g) => g.price));
    const maxP = Math.max(...group.map((g) => g.price));
    const pad = group.length > 1 ? 0.5 : 1.0; // zones run a few points wide (Section 2)
    const low = Number((minP - pad).toFixed(2));
    const high = Number((maxP + pad).toFixed(2));
    const touches = devM5.filter((b) => b.low <= high && b.high >= low).length;

    autoZones.push({
      id: `zone-${i}-${low.toFixed(1)}`,
      label:
        group.length > 1
          ? `STACKED: ${group.map((g) => g.label).join(" + ")}`
          : group[0].label,
      low,
      high,
      kind: group.length > 1 ? "stacked" : group[0].kind,
      untested: touches === 0,
      touchCount: touches,
      notes:
        group.length > 1
          ? `${group.length} stacked levels (${group.map((g) => `${g.label} ${g.price.toFixed(1)}`).join(", ")})`
          : `${group[0].label} at ${group[0].price.toFixed(2)}`,
    });
    i = j;
  }

  return {
    previousDay,
    previousWeek,
    composite5d,
    developing,
    nakedPocs,
    autoZones,
  };
}

/**
 * Computes running Session VWAP strictly up to each candle (resets at Globex session open 15:00 PT).
 */
export function computeSessionVwap(candles: Candle[]): Array<{ ts: number; vwap: number }> {
  const result: Array<{ ts: number; vwap: number }> = [];
  let currentSession = "";
  let cumPV = 0;
  let cumV = 0;

  for (const c of candles) {
    const sess = getGlobexSessionDate(c.ts);
    if (sess !== currentSession) {
      currentSession = sess;
      cumPV = 0;
      cumV = 0;
    }
    const tp = (c.high + c.low + c.close) / 3;
    const v = Math.max(c.volume, 0.0001);
    cumPV += tp * v;
    cumV += v;
    result.push({ ts: c.ts, vwap: Number((cumPV / cumV).toFixed(4)) });
  }
  return result;
}
