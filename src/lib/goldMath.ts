import {
  Candle,
  ContractType,
  EntryTiming,
  FootprintBar,
  GuardrailWarning,
  KeyLevelZone,
  OrderSide,
  PremarketPlan,
  SimPosition,
  VolumeProfileResult,
} from "./types";

export const CONTRACT_SPECS: Record<
  ContractType,
  {
    symbol: ContractType;
    name: string;
    ounces: number;
    tickSize: number;
    tickValue: number;
    pointValue: number;
    defaultCommissionRT: number;
  }
> = {
  "1OZ": {
    symbol: "1OZ",
    name: "CME 1-Ounce Gold",
    ounces: 1,
    tickSize: 0.25,
    tickValue: 0.25,
    pointValue: 1.0,
    defaultCommissionRT: 1.5,
  },
  MGC: {
    symbol: "MGC",
    name: "COMEX Micro Gold",
    ounces: 10,
    tickSize: 0.1,
    tickValue: 1.0,
    pointValue: 10.0,
    defaultCommissionRT: 1.7,
  },
  GC: {
    symbol: "GC",
    name: "COMEX Gold Futures",
    ounces: 100,
    tickSize: 0.1,
    tickValue: 10.0,
    pointValue: 100.0,
    defaultCommissionRT: 4.5,
  },
};

export function roundToTick(
  price: number,
  tickSize: number,
  mode: "nearest" | "down" | "up" = "nearest"
): number {
  const scaled = price / tickSize;
  const rounded =
    mode === "down"
      ? Math.floor(scaled + 1e-9)
      : mode === "up"
        ? Math.ceil(scaled - 1e-9)
        : Math.round(scaled);
  return Number((rounded * tickSize).toFixed(4));
}

/**
 * Round GC price to 1OZ $0.25 grid.
 * Stops add 1-2 GC ticks ($0.10-$0.20) buffer and round outward (Section 9 & 12).
 */
export function roundGCForContract(
  price: number,
  contract: ContractType,
  mode: "nearest" | "down" | "up" = "nearest"
): number {
  return roundToTick(price, CONTRACT_SPECS[contract].tickSize, mode);
}

export interface SizingInput {
  accountBalance: number;
  riskPercent: number;
  contract: ContractType;
  side: OrderSide;
  entryPriceGC: number;
  absorptionExtremeGC: number; // low of absorption zone for long, high for short
  t1PriceGC: number;
  t2PriceGC: number;
  bufferGcTicks?: number; // default 2 GC ticks ($0.20)
  commissionRT?: number;
}

export interface SizingResult {
  entryExec: number;
  stopGC: number;
  stopExec: number;
  t1Exec: number;
  t2Exec: number;
  stopDistancePts: number;
  t1DistancePts: number;
  t2DistancePts: number;
  recommendedContracts: number;
  grossRiskPerContract: number;
  allInRiskPerContract: number;
  totalAllInRisk: number;
  accountRiskPct: number;
  t1GrossProfitPerContract: number;
  t1NetProfitPerContract: number;
  t2NetProfitPerContract: number;
  commissionDragPctOfT1: number;
  t1R: number;
  t2R: number;
  t2BelowMin2R: boolean;
  oversizedForAccount: boolean;
  notes: string[];
}

export function calculatePositionSizing(input: SizingInput): SizingResult {
  const spec = CONTRACT_SPECS[input.contract];
  const bufferPts = (input.bufferGcTicks ?? 2) * 0.1; // GC tick = $0.10
  const commissionRT = input.commissionRT ?? spec.defaultCommissionRT;

  const entryExec = roundGCForContract(
    input.entryPriceGC,
    input.contract,
    "nearest"
  );

  const rawStopGC =
    input.side === "long"
      ? input.absorptionExtremeGC - bufferPts
      : input.absorptionExtremeGC + bufferPts;

  // Section 9: round outward to next $0.25 on 1OZ
  const stopExec = roundGCForContract(
    rawStopGC,
    input.contract,
    input.side === "long" ? "down" : "up"
  );

  const t1Exec = roundGCForContract(
    input.t1PriceGC,
    input.contract,
    "nearest"
  );
  const t2Exec = roundGCForContract(
    input.t2PriceGC,
    input.contract,
    "nearest"
  );

  const stopDistancePts = Math.max(
    spec.tickSize,
    Number(
      (input.side === "long"
        ? entryExec - stopExec
        : stopExec - entryExec
      ).toFixed(4)
    )
  );
  const t1DistancePts = Math.max(
    0,
    Number(
      (input.side === "long"
        ? t1Exec - entryExec
        : entryExec - t1Exec
      ).toFixed(4)
    )
  );
  const t2DistancePts = Math.max(
    0,
    Number(
      (input.side === "long"
        ? t2Exec - entryExec
        : entryExec - t2Exec
      ).toFixed(4)
    )
  );

  const grossRiskPerContract = stopDistancePts * spec.pointValue;
  const allInRiskPerContract = grossRiskPerContract + commissionRT;
  const targetRiskDollars = (input.accountBalance * input.riskPercent) / 100;

  const rawContracts = Math.floor(targetRiskDollars / allInRiskPerContract);
  const recommendedContracts = Math.max(1, rawContracts);
  const totalAllInRisk = recommendedContracts * allInRiskPerContract;
  const accountRiskPct =
    input.accountBalance > 0
      ? (totalAllInRisk / input.accountBalance) * 100
      : 0;

  const t1GrossProfitPerContract = t1DistancePts * spec.pointValue;
  const t1NetProfitPerContract = t1GrossProfitPerContract - commissionRT;
  const t2GrossProfitPerContract = t2DistancePts * spec.pointValue;
  const t2NetProfitPerContract = t2GrossProfitPerContract - commissionRT;

  const commissionDragPctOfT1 =
    t1GrossProfitPerContract > 0
      ? (commissionRT / t1GrossProfitPerContract) * 100
      : 100;

  const t1R =
    allInRiskPerContract > 0 ? t1NetProfitPerContract / allInRiskPerContract : 0;
  const t2R =
    allInRiskPerContract > 0 ? t2NetProfitPerContract / allInRiskPerContract : 0;

  const t2BelowMin2R = t2R < 2.0;
  const oversizedForAccount = accountRiskPct > 2.5;

  const notes: string[] = [];
  if (input.contract === "1OZ" && recommendedContracts > 1 && input.accountBalance <= 400) {
    notes.push("Section 10 rule: stay at 1 contract 1OZ on ~$300 account until 50+ rule-following reps.");
  }
  if (oversizedForAccount) {
    notes.push(
      `1 contract risks ${accountRiskPct.toFixed(1)}% of $${input.accountBalance} ($${totalAllInRisk.toFixed(2)} all-in). Tighten stop behind absorption or skip.`
    );
  }
  if (t2BelowMin2R) {
    notes.push(
      `Section 9 rule: T2 net R is ${t2R.toFixed(2)}R (< 2.0R). Starting rule says skip.`
    );
  }
  if (commissionDragPctOfT1 >= 20) {
    notes.push(
      `Commission ($${commissionRT.toFixed(2)}) eats ${commissionDragPctOfT1.toFixed(0)}% of T1 gross winner ($${t1GrossProfitPerContract.toFixed(2)}).`
    );
  }

  return {
    entryExec,
    stopGC: Number(rawStopGC.toFixed(2)),
    stopExec,
    t1Exec,
    t2Exec,
    stopDistancePts,
    t1DistancePts,
    t2DistancePts,
    recommendedContracts,
    grossRiskPerContract: Number(grossRiskPerContract.toFixed(2)),
    allInRiskPerContract: Number(allInRiskPerContract.toFixed(2)),
    totalAllInRisk: Number(totalAllInRisk.toFixed(2)),
    accountRiskPct: Number(accountRiskPct.toFixed(2)),
    t1GrossProfitPerContract: Number(t1GrossProfitPerContract.toFixed(2)),
    t1NetProfitPerContract: Number(t1NetProfitPerContract.toFixed(2)),
    t2NetProfitPerContract: Number(t2NetProfitPerContract.toFixed(2)),
    commissionDragPctOfT1: Number(commissionDragPctOfT1.toFixed(1)),
    t1R: Number(t1R.toFixed(2)),
    t2R: Number(t2R.toFixed(2)),
    t2BelowMin2R,
    oversizedForAccount,
    notes,
  };
}

export interface AcceptanceRead {
  status: "rejection" | "acceptance" | "unclear" | "untested";
  direction: "above" | "below" | "inside";
  barsBeyondCount: number;
  closesBeyondCount: number;
  minutesBeyond: number;
  reclaimedWithinTwoBars: boolean;
  summary: string;
}

/**
 * Evaluates Section 3 starting rules on M5 bars around a key level zone:
 * - Rejection: pokes beyond level, closes back inside within 1-2 M5 bars (5-10 min).
 * - Acceptance: >= 6 M5 bars (30 min) beyond level with majority closing beyond.
 * - A wick is never acceptance.
 */
export function evaluateAcceptanceRejection(
  m5Bars: Candle[],
  zone: { low: number; high: number }
): AcceptanceRead {
  if (m5Bars.length === 0) {
    return {
      status: "untested",
      direction: "inside",
      barsBeyondCount: 0,
      closesBeyondCount: 0,
      minutesBeyond: 0,
      reclaimedWithinTwoBars: false,
      summary: "No M5 bars loaded yet.",
    };
  }

  // Look back up to last 18 M5 bars (90 min) for latest interaction with this zone
  const recent = m5Bars.slice(-18);
  const last = recent[recent.length - 1];

  // Find latest excursion beyond zone high or below zone low
  let excursionSide: "above" | "below" | null = null;
  let excursionStartIdx = -1;

  for (let i = recent.length - 1; i >= 0; i--) {
    const b = recent[i];
    if (b.high > zone.high && b.low <= zone.high) {
      excursionSide = "above";
      excursionStartIdx = i;
      break;
    }
    if (b.low < zone.low && b.high >= zone.low) {
      excursionSide = "below";
      excursionStartIdx = i;
      break;
    }
  }

  // Also check if price has already been trading completely beyond for several bars
  if (excursionStartIdx === -1) {
    if (last.close > zone.high) {
      excursionSide = "above";
      excursionStartIdx = recent.findIndex((b) => b.close > zone.high);
    } else if (last.close < zone.low) {
      excursionSide = "below";
      excursionStartIdx = recent.findIndex((b) => b.close < zone.low);
    }
  }

  if (excursionSide === null || excursionStartIdx === -1) {
    return {
      status: "untested",
      direction: "inside",
      barsBeyondCount: 0,
      closesBeyondCount: 0,
      minutesBeyond: 0,
      reclaimedWithinTwoBars: false,
      summary: "Price has not tested outside this zone recently.",
    };
  }

  // Walk backward from excursionStartIdx while contiguous bars poked beyond
  let start = excursionStartIdx;
  while (start > 0) {
    const prev = recent[start - 1];
    const beyond =
      excursionSide === "above"
        ? prev.high > zone.high
        : prev.low < zone.low;
    if (beyond) start--;
    else break;
  }

  const window = recent.slice(start);
  const barsBeyondCount = window.length;
  const closesBeyondCount = window.filter((b) =>
    excursionSide === "above" ? b.close > zone.high : b.close < zone.low
  ).length;
  const minutesBeyond = barsBeyondCount * 5;

  const lastClosedInside =
    excursionSide === "above"
      ? last.close <= zone.high
      : last.close >= zone.low;

  // Check if reclaimed within 1-2 M5 bars of poking through
  const reclaimedWithinTwoBars =
    lastClosedInside && closesBeyondCount <= 2 && barsBeyondCount <= 4;

  if (reclaimedWithinTwoBars) {
    return {
      status: "rejection",
      direction: excursionSide,
      barsBeyondCount,
      closesBeyondCount,
      minutesBeyond,
      reclaimedWithinTwoBars: true,
      summary: `Rejection candidate (${excursionSide}): closed back inside (${closesBeyondCount} close${closesBeyondCount === 1 ? "" : "s"} beyond). Watch for Model 1 reclaim + first valid pullback.`,
    };
  }

  if (
    barsBeyondCount >= 6 &&
    closesBeyondCount >= Math.ceil(barsBeyondCount * 0.65)
  ) {
    return {
      status: "acceptance",
      direction: excursionSide,
      barsBeyondCount,
      closesBeyondCount,
      minutesBeyond,
      reclaimedWithinTwoBars: false,
      summary: `Acceptance ${excursionSide} zone: ${barsBeyondCount} M5 bars (${minutesBeyond} min), ${closesBeyondCount}/${barsBeyondCount} closes beyond. Watch Model 2 retest hold.`,
    };
  }

  return {
    status: "unclear",
    direction: excursionSide,
    barsBeyondCount,
    closesBeyondCount,
    minutesBeyond,
    reclaimedWithinTwoBars: false,
    summary: `Unclear (${barsBeyondCount} M5 bars / ${minutesBeyond} min, ${closesBeyondCount} closes ${excursionSide}). Need <=2 bars reclaim (Rejection) or >=6 bars / 30 min (Acceptance). No call yet.`,
  };
}

export interface GuardrailCheckInput {
  side: OrderSide;
  model: "model1_reversal" | "model2_continuation";
  entryPrice: number;
  t2R: number;
  commissionDragPct: number;
  visibleM5: Candle[];
  visibleFootprints: FootprintBar[];
  activeZone: KeyLevelZone | null;
  developingProfile: VolumeProfileResult | null;
  plan: PremarketPlan;
  sessionPositions: SimPosition[];
  entryTimingSelected: EntryTiming;
}

/**
 * Enforces Nayan's Asia Value Model guardrails and detects his known early-entry leak.
 */
export function evaluateEntryGuardrails(
  input: GuardrailCheckInput
): GuardrailWarning[] {
  const warnings: GuardrailWarning[] = [];

  // 1. Session risk limits (Section 10: max 2 trades/session, 2R daily stop)
  if (input.sessionPositions.length >= 2) {
    warnings.push({
      id: "max-trades",
      severity: "block",
      code: "MAX_TRADES",
      title: "Max 2 trades per session reached",
      detail:
        "Section 10 rule: one A+ trade is enough, hard cap 2 trades per Asia session.",
    });
  }

  const closedR = input.sessionPositions
    .filter((p) => p.status === "closed")
    .reduce((acc, p) => acc + (p.rMultiple ?? 0), 0);

  if (closedR <= -2.0) {
    warnings.push({
      id: "daily-stop",
      severity: "block",
      code: "DAILY_STOP",
      title: `2R daily stop hit (${closedR.toFixed(2)}R)`,
      detail: "Section 10 rule: screens off at -2R daily loss.",
    });
  }

  // 2. Premarket plan written? (Section 10 & 11)
  if (!input.plan.biasReason.trim() || !input.plan.nightRule.trim()) {
    warnings.push({
      id: "no-plan",
      severity: "warn",
      code: "NO_PLAN",
      title: "Premarket plan incomplete",
      detail:
        "Write bias reason and tonight's rule before clicking an entry (Location first, confirmation second, entry third).",
    });
  }

  // 3. Inside developing value / middle no-trade zone? (Section 2 & 10)
  if (input.developingProfile) {
    const vaRange = input.developingProfile.vah - input.developingProfile.val;
    if (vaRange > 0) {
      const innerLow = input.developingProfile.val + vaRange * 0.2;
      const innerHigh = input.developingProfile.vah - vaRange * 0.2;
      if (input.entryPrice >= innerLow && input.entryPrice <= innerHigh) {
        warnings.push({
          id: "mid-value",
          severity: "warn",
          code: "MID_VALUE",
          title: "Entry is inside middle of Developing Value",
          detail: `Entry ${input.entryPrice.toFixed(2)} sits inside developing value (${input.developingProfile.val.toFixed(2)}-${input.developingProfile.vah.toFixed(2)}). Rule: ignore middle of developing value.`,
        });
      }
    }
  }

  if (
    input.plan.noTradeZoneLow !== null &&
    input.plan.noTradeZoneHigh !== null &&
    input.entryPrice >= Math.min(input.plan.noTradeZoneLow, input.plan.noTradeZoneHigh) &&
    input.entryPrice <= Math.max(input.plan.noTradeZoneLow, input.plan.noTradeZoneHigh)
  ) {
    warnings.push({
      id: "custom-no-trade",
      severity: "warn",
      code: "MID_VALUE",
      title: "Entry inside your marked No-Trade Zone",
      detail: `Marked no-trade zone is ${input.plan.noTradeZoneLow.toFixed(2)}-${input.plan.noTradeZoneHigh.toFixed(2)}.`,
    });
  }

  // 4. Model 1 & Model 2 early-entry leak checks (Section 5, 6, 8)
  const lastM5 = input.visibleM5[input.visibleM5.length - 1];
  if (input.activeZone && lastM5) {
    const acc = evaluateAcceptanceRejection(input.visibleM5, input.activeZone);

    if (input.model === "model1_reversal") {
      // Check reclaim
      const reclaimed =
        input.side === "long"
          ? lastM5.close >= input.activeZone.low
          : lastM5.close <= input.activeZone.high;
      if (!reclaimed) {
        warnings.push({
          id: "no-reclaim",
          severity: "warn",
          code: "NO_RECLAIM",
          title: "No reclaim yet (Model 1 leak)",
          detail: `Last M5 closed at ${lastM5.close.toFixed(2)}, still outside zone ${input.activeZone.low.toFixed(2)}-${input.activeZone.high.toFixed(2)}. Rule: No reclaim, no trade.`,
        });
      }

      // Check first touch (only 1 bar touched zone so far)
      const recentTouches = input.visibleM5
        .slice(-6)
        .filter(
          (b) =>
            b.low <= input.activeZone!.high && b.high >= input.activeZone!.low
        );
      if (recentTouches.length <= 1 || input.entryTimingSelected === "first_touch") {
        warnings.push({
          id: "first-touch",
          severity: "warn",
          code: "FIRST_TOUCH",
          title: "Early Entry Warning: First Touch",
          detail:
            "Known leak: first touch is the market asking a question. Wait for absorption, aggression flip, reclaim, then the FIRST VALID PULLBACK.",
        });
      }
    }

    if (input.model === "model2_continuation") {
      if (acc.status !== "acceptance") {
        warnings.push({
          id: "no-acceptance",
          severity: "warn",
          code: "NO_ACCEPTANCE",
          title: `No acceptance yet (${acc.barsBeyondCount}/6 M5 bars)`,
          detail:
            "Section 3 & 6 rule: don't chase the breakout candle. Need ~30 min (6 M5 bars) beyond level + retest hold.",
        });
      }
      if (input.entryTimingSelected === "late_chase") {
        warnings.push({
          id: "chase",
          severity: "warn",
          code: "BREAKOUT_CHASE",
          title: "Chasing move away from retest",
          detail:
            "Rule: if you miss the first valid pullback/retest, skip it. Do not chase.",
        });
      }
    }
  }

  // 5. T2 R:R check (Section 9)
  if (input.t2R < 2.0) {
    warnings.push({
      id: "low-rr",
      severity: "warn",
      code: "LOW_RR",
      title: `T2 reward is ${input.t2R.toFixed(2)}R (< 2.0R starting rule)`,
      detail:
        "Section 9 starting rule: skip trade if T2 is less than 2R away.",
    });
  }

  // 6. Commission drag check (Section 10)
  if (input.commissionDragPct >= 25) {
    warnings.push({
      id: "comm-drag",
      severity: "warn",
      code: "COMMISSION_DRAG",
      title: `Commission eats ${input.commissionDragPct.toFixed(0)}% of T1`,
      detail:
        "On 1OZ (~$1.50 RT), small targets get heavily taxed. Verify T1/T2 spacing.",
    });
  }

  return warnings;
}

/**
 * Computes PT (America/Los_Angeles) timestamp helpers for Globex & Asia sessions.
 * Post-DST (Nov-Mar): Globex reopen = 3:00 PM PT, Tokyo = 4:00 PM PT, China = 5:00 PM PT.
 */
export function formatPTTime(ts: number, withDate = false): string {
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  if (withDate) {
    opts.month = "short";
    opts.day = "2-digit";
  }
  return new Intl.DateTimeFormat("en-US", opts).format(new Date(ts));
}

export function getPTDateKey(ts: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ts));
  const y = parts.find((p) => p.type === "year")?.value ?? "2026";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

export function getPTHourMinute(ts: number): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ts));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return { hour, minute };
}

/**
 * Returns the Globex trading session key (session starts at 15:00 PT = 3:00 PM PT).
 */
export function getGlobexSessionDate(ts: number): string {
  const { hour } = getPTHourMinute(ts);
  // Bars at or after 15:00 PT belong to the evening Asia session labeled by that evening's PT date
  if (hour >= 15) return getPTDateKey(ts);
  // Bars before 15:00 PT belong to the session that started the previous afternoon at 15:00 PT
  return getPTDateKey(ts - 16 * 3600 * 1000);
}
