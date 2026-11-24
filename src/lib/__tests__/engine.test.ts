import { describe, expect, it } from "vitest";
import {
  calculatePositionSizing,
  evaluateAcceptanceRejection,
  evaluateEntryGuardrails,
  evaluatePendingOrderOnBar,
  gradeDrillCall,
  roundGCForContract,
} from "../goldMath";
import { buildVolumeProfile, computeAllSessionProfiles } from "../volumeProfile";
import { buildFootprintsFromTicks } from "../footprint";
import { parseMarketDataCSV } from "../parsers";
import { computeJournalStats, exportGoogleSheetTSV } from "../journal";
import { Candle, DrillCall, PendingOrder, PremarketPlan, SimRepLog, Tick } from "../types";

describe("1OZ / MGC / GC contract math & outward stop rounding", () => {
  it("rounds GC prices onto 1OZ $0.25 grid with outward stop buffer", () => {
    expect(roundGCForContract(4421.6, "1OZ", "nearest")).toBe(4421.5);
    expect(roundGCForContract(4421.65, "1OZ", "nearest")).toBe(4421.75);

    // Long stop below 4390.10 with 2 GC ticks ($0.20) buffer => 4389.90 => outward down = 4389.75
    const sizing = calculatePositionSizing({
      accountBalance: 300,
      riskPercent: 2,
      contract: "1OZ",
      side: "long",
      entryPriceGC: 4393.4,
      absorptionExtremeGC: 4390.1,
      t1PriceGC: 4407.0,
      t2PriceGC: 4421.6,
      bufferGcTicks: 2,
      commissionRT: 1.5,
    });

    expect(sizing.entryExec).toBe(4393.5);
    expect(sizing.stopExec).toBe(4389.75);
    expect(sizing.stopDistancePts).toBe(3.75);
    expect(sizing.grossRiskPerContract).toBe(3.75);
    expect(sizing.allInRiskPerContract).toBe(5.25);
    expect(sizing.recommendedContracts).toBe(1);
    expect(sizing.t2BelowMin2R).toBe(false);
    expect(sizing.t2R).toBeGreaterThan(2.0);
  });

  it("matches Section 9 MGC example (2 MGC long 4321.5, stop 4316.8, target 4334.8)", () => {
    const sizing = calculatePositionSizing({
      accountBalance: 2500,
      riskPercent: 4,
      contract: "MGC",
      side: "long",
      entryPriceGC: 4321.5,
      absorptionExtremeGC: 4317.0,
      t1PriceGC: 4328.0,
      t2PriceGC: 4334.8,
      bufferGcTicks: 2,
      commissionRT: 0,
    });
    expect(sizing.stopExec).toBe(4316.8);
    expect(sizing.stopDistancePts).toBe(4.7);
    expect(sizing.grossRiskPerContract).toBe(47);
    expect(sizing.t2R).toBeCloseTo(13.3 / 4.7, 1);
  });
});

describe("Section 3 Acceptance vs Rejection rules", () => {
  const makeBar = (i: number, o: number, h: number, l: number, c: number): Candle => ({
    ts: 1_760_000_000_000 + i * 300_000,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: 100,
  });

  it("classifies 1-2 M5 poke + close back inside as rejection", () => {
    const bars: Candle[] = [
      makeBar(0, 4395, 4396, 4392, 4393),
      makeBar(1, 4393, 4393.5, 4388.5, 4389.5), // pokes below 4390
      makeBar(2, 4389.5, 4392.5, 4389.0, 4391.8), // closes back inside
    ];
    const read = evaluateAcceptanceRejection(bars, { low: 4390, high: 4393 });
    expect(read.status).toBe("rejection");
    expect(read.reclaimedWithinTwoBars).toBe(true);
  });

  it("classifies 6+ M5 bars closing beyond level as acceptance", () => {
    const bars: Candle[] = [
      makeBar(0, 4420, 4422.5, 4419.5, 4422.2),
      makeBar(1, 4422.2, 4424, 4421.8, 4423.5),
      makeBar(2, 4423.5, 4425, 4422.5, 4424.1),
      makeBar(3, 4424.1, 4425.5, 4423.0, 4425.0),
      makeBar(4, 4425.0, 4426.2, 4424.0, 4425.8),
      makeBar(5, 4425.8, 4427.0, 4424.5, 4426.5),
    ];
    const read = evaluateAcceptanceRejection(bars, { low: 4420.5, high: 4421.6 });
    expect(read.status).toBe("acceptance");
    expect(read.barsBeyondCount).toBeGreaterThanOrEqual(6);
  });

  it("classifies 3-4 bars beyond as unclear (no trade)", () => {
    const bars: Candle[] = [
      makeBar(0, 4420, 4423, 4419.5, 4422.4),
      makeBar(1, 4422.4, 4423.5, 4421.9, 4422.9),
      makeBar(2, 4422.9, 4424.0, 4422.0, 4423.2),
    ];
    const read = evaluateAcceptanceRejection(bars, { low: 4420.5, high: 4421.6 });
    expect(read.status).toBe("unclear");
  });
});

describe("Volume Profile 70% Value Area & Stacked Zone detection", () => {
  it("computes POC, VAH, VAL containing >= 70% volume", () => {
    const ticks: Tick[] = [];
    // Heavy cluster around 4400, tails at 4390 and 4410
    for (let i = 0; i < 40; i++) {
      ticks.push({ ts: 1000 + i, price: 4400, size: 5, side: "buy" });
      ticks.push({ ts: 2000 + i, price: 4401, size: 3, side: "sell" });
      ticks.push({ ts: 3000 + i, price: 4399, size: 3, side: "buy" });
    }
    ticks.push({ ts: 4000, price: 4390, size: 1, side: "sell" });
    ticks.push({ ts: 4001, price: 4410, size: 1, side: "buy" });

    const vp = buildVolumeProfile({
      id: "test-vp",
      label: "Test",
      kind: "pd",
      candles: [],
      ticks,
      priceStep: 1.0,
    });

    expect(vp).not.toBeNull();
    expect(vp!.poc).toBe(4400);
    expect(vp!.val).toBe(4399);
    expect(vp!.vah).toBe(4401);
  });

  it("respects strict no-lookahead on replayTs", () => {
    const day1Start = Date.UTC(2026, 10, 18, 23, 0, 0); // 15:00 PT Nov 18
    const day2Start = Date.UTC(2026, 10, 19, 23, 0, 0); // 15:00 PT Nov 19
    const h1: Candle[] = [
      { ts: day1Start, open: 4390, high: 4395, low: 4388, close: 4392, volume: 500 },
      { ts: day2Start, open: 4400, high: 4405, low: 4398, close: 4402, volume: 200 },
      // Future bar that must NOT affect replayTs = day2Start
      { ts: day2Start + 7200_000, open: 4450, high: 4480, low: 4445, close: 4475, volume: 9999 },
    ];
    const bundle = computeAllSessionProfiles({
      h1Candles: h1,
      m5Candles: h1,
      replayTs: day2Start,
      currentSessionDate: "2026-11-19",
    });
    expect(bundle.developing?.high).toBe(4405);
    expect(bundle.previousDay?.poc).toBeGreaterThanOrEqual(4388);
    expect(bundle.previousDay?.poc).toBeLessThanOrEqual(4395);
  });
});

describe("Real tick Footprint, 300% diagonal imbalances, Absorption, CVD", () => {
  it("computes diagonal buy/sell imbalances, absorption at low, and aggression flip", () => {
    const t0 = 1_760_000_100_000;
    const bar1 = Math.floor(t0 / 300_000) * 300_000;
    const bar2 = bar1 + 300_000;

    const ticks: Tick[] = [
      // Bar 1: heavy selling absorbed at 4390.00, closes back up at 4391.50
      { ts: bar1 + 1000, price: 4391.0, size: 2, side: "sell" },
      { ts: bar1 + 2000, price: 4390.0, size: 18, side: "sell" },
      { ts: bar1 + 3000, price: 4390.0, size: 15, side: "sell" },
      { ts: bar1 + 4000, price: 4390.5, size: 4, side: "buy" },
      { ts: bar1 + 5000, price: 4391.5, size: 6, side: "buy" },
      // Bar 2: buyers flip with stacked 300% diagonal imbalances
      { ts: bar2 + 1000, price: 4391.0, size: 1, side: "sell" },
      { ts: bar2 + 2000, price: 4391.5, size: 12, side: "buy" },
      { ts: bar2 + 3000, price: 4391.5, size: 1, side: "sell" },
      { ts: bar2 + 4000, price: 4392.0, size: 15, side: "buy" },
      { ts: bar2 + 5000, price: 4392.0, size: 1, side: "sell" },
      { ts: bar2 + 6000, price: 4392.5, size: 14, side: "buy" },
    ];

    const suite = buildFootprintsFromTicks(ticks, {
      intervalMs: 300_000,
      priceStep: 0.5,
      imbalanceRatio: 3.0,
      minImbalanceVolume: 1,
    });

    expect(suite.bars).toHaveLength(2);
    expect(suite.bars[0].absorptionLow).toBe(true);
    expect(suite.bars[0].delta).toBeLessThan(0);
    expect(suite.bars[1].delta).toBeGreaterThan(0);
    expect(suite.bars[1].stackedBuyImbalances).toBeGreaterThanOrEqual(2);
    expect(suite.bars[1].aggressionFlipBull).toBe(true);
    expect(suite.bars[1].cumDelta).toBeCloseTo(suite.bars[0].delta + suite.bars[1].delta, 3);
  });
});

describe("Databento CSV parser (trades & MBP-10 L2)", () => {
  it("parses Databento MBP-10 CSV with fixed-point prices and real L2 depth", () => {
    const csv = [
      "ts_event,action,side,price,size,bid_px_00,bid_sz_00,ask_px_00,ask_sz_00,symbol",
      "1763596800000000000,T,B,4392500000000,3,4392400000000,12,4392500000000,8,GCZ6",
      "1763596806000000000,T,A,4392400000000,5,4392300000000,25,4392400000000,7,GCZ6",
    ].join("\n");

    const parsed = parseMarketDataCSV(csv, "glbx-mdp3-mbp10.csv");
    expect(parsed.dataset.capabilities.hasRealAggressorTape).toBe(true);
    expect(parsed.dataset.capabilities.hasRealL2Depth).toBe(true);
    expect(parsed.dataset.ticks).toHaveLength(2);
    expect(parsed.dataset.ticks[0].price).toBe(4392.5);
    expect(parsed.dataset.ticks[0].side).toBe("buy");
    expect(parsed.dataset.ticks[1].side).toBe("sell");
    expect(parsed.dataset.l2Snapshots.length).toBeGreaterThanOrEqual(2);
    expect(parsed.dataset.l2Snapshots[1].bids[0].size).toBe(25);
  });
});

describe("Early-Entry Guardrail & Sim Rep Journal stats", () => {
  it("flags first-touch entry and missing reclaim on Model 1", () => {
    const plan: PremarketPlan = {
      sessionDate: "2026-11-23",
      bias: "bullish",
      biasReason: "",
      priceVsWeeklyValue: "above",
      priceVsDailyValue: "inside",
      noTradeZoneLow: null,
      noTradeZoneHigh: null,
      nightRule: "",
      newsChecked: false,
      scenariosText: "",
      selectedZoneIds: [],
    };
    const warnings = evaluateEntryGuardrails({
      side: "long",
      model: "model1_reversal",
      entryPrice: 4389.0,
      t2R: 1.4,
      commissionDragPct: 26,
      visibleM5: [
        { ts: 1, open: 4392, high: 4392.5, low: 4388.5, close: 4389.0, volume: 50 },
      ],
      visibleFootprints: [],
      activeZone: {
        id: "z1",
        label: "PD POC + PW VAH",
        low: 4390,
        high: 4393,
        kind: "stacked",
        untested: true,
        touchCount: 1,
      },
      developingProfile: null,
      plan,
      sessionPositions: [],
      entryTimingSelected: "first_touch",
    });

    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("FIRST_TOUCH");
    expect(codes).toContain("NO_RECLAIM");
    expect(codes).toContain("LOW_RR");
    expect(codes).toContain("NO_PLAN");
  });

  it("computes discipline %, early-entry count, and R breakdown", () => {
    const reps: SimRepLog[] = [
      {
        id: "1",
        createdAt: "2026-11-23T01:00:00Z",
        sessionDate: "2026-11-22",
        instrument: "GC/1OZ",
        dataSource: "paxg_ticks",
        scenario: 5,
        model: "model1_reversal",
        setupTag: "fade_vah_val",
        side: "long",
        entryTiming: "first_valid_pullback",
        contextUsed: { h1m30: true, m5: true, m5Footprint: true, m1: true },
        outcomeR: 2.2,
        ruleViolations: [],
        note: "Clean pullback",
      },
      {
        id: "2",
        createdAt: "2026-11-23T02:00:00Z",
        sessionDate: "2026-11-22",
        instrument: "GC/1OZ",
        dataSource: "paxg_ticks",
        scenario: 2,
        model: "model1_reversal",
        setupTag: "pd_poc_bounce",
        side: "long",
        entryTiming: "first_touch",
        contextUsed: { h1m30: true, m5: true, m5Footprint: false, m1: true },
        outcomeR: -1.0,
        ruleViolations: ["FIRST_TOUCH"],
        note: "Clicked early",
      },
    ];
    const stats = computeJournalStats(reps);
    expect(stats.totalReps).toBe(2);
    expect(stats.disciplinePct).toBe(50);
    expect(stats.firstTouchCount).toBe(1);
    expect(stats.firstValidPullbackCount).toBe(1);
    expect(stats.totalR).toBe(1.2);

    const tsv = exportGoogleSheetTSV(reps);
    expect(tsv).toContain("1OZ Net $ ($1/pt)");
    expect(tsv).toContain("#5\tModel 1");
  });
});

describe("Section 8 Working Stop/Limit Orders & Blind Drill Grading", () => {
  const baseOrder: PendingOrder = {
    id: "ord-1",
    side: "long",
    orderType: "stop",
    model: "model1_reversal",
    scenario: 5,
    setupTag: "pd_poc_bounce",
    contract: "1OZ",
    triggerPriceExec: 4394.0,
    invalidationPriceExec: 4389.75,
    stopPriceGC: 4389.9,
    stopPriceExec: 4389.75,
    t1PriceExec: 4407.0,
    t2PriceExec: 4421.5,
    contracts: 1,
    riskDollars: 5.75,
    commissionDollars: 1.5,
    placedAtTs: 1000,
    entryTiming: "first_valid_pullback",
    warnings: [],
    note: "Buy stop above pullback bar",
  };

  it("auto-cancels working Buy Stop if absorption low breaks before fill", () => {
    const res = evaluatePendingOrderOnBar(baseOrder, {
      ts: 2000,
      open: 4392.0,
      high: 4393.0,
      low: 4389.5,
      close: 4389.6,
      volume: 40,
    });
    expect(res.action).toBe("cancelled_invalidated");
  });

  it("fills working Buy Stop and logs slippage on wide trigger bar", () => {
    const res = evaluatePendingOrderOnBar(baseOrder, {
      ts: 2000,
      open: 4393.0,
      high: 4397.5,
      low: 4392.5,
      close: 4396.5,
      volume: 65,
    });
    expect(res.action).toBe("filled");
    expect(res.fillPriceExec).toBe(4394.25);
    expect(res.slippagePts).toBe(0.25);
  });

  it("grades Blind Drill Mode call accurately after 6 M5 bars", () => {
    const call: DrillCall = {
      id: "d1",
      calledAtTs: 1_760_000_000_000,
      zoneId: "z1",
      zoneLabel: "PD VAH",
      zoneLow: 4420.5,
      zoneHigh: 4421.6,
      predictedCall: "model2_continuation",
      scenario: 3,
      reason: "Expect acceptance above PD VAH",
    };
    const bars: Candle[] = Array.from({ length: 6 }, (_, i) => ({
      ts: 1_760_000_000_000 + i * 300_000,
      open: 4422 + i * 0.4,
      high: 4423 + i * 0.4,
      low: 4421.8 + i * 0.3,
      close: 4422.5 + i * 0.4,
      volume: 50,
    }));
    const graded = gradeDrillCall(call, bars);
    expect(graded).not.toBeNull();
    expect(graded!.actualStatus).toBe("acceptance");
    expect(graded!.correct).toBe(true);
  });
});
