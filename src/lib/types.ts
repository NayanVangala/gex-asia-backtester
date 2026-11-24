export type DataSourceKind =
  | "gc_ohlcv"
  | "paxg_ticks"
  | "databento_trades"
  | "databento_mbp10"
  | "custom_ticks"
  | "custom_ohlcv";

export type ContractType = "1OZ" | "MGC" | "GC";
export type OrderType = "stop" | "limit" | "market";

export interface MarketCapabilities {
  hasRealAggressorTape: boolean;
  hasRealL2Depth: boolean;
  sourceLabel: string;
  sourceUrl?: string;
  instrument: string;
  tickSize: number;
  pointValue: number;
  caveat?: string;
}

export interface Tick {
  ts: number; // Unix ms
  price: number;
  size: number;
  side: "buy" | "sell" | "unknown"; // aggressor side: buy = lifted ask, sell = hit bid
}

export interface Candle {
  ts: number; // Bar open Unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  buyVolume?: number;
  sellVolume?: number;
  delta?: number;
  tradeCount?: number;
}

export interface L2Level {
  price: number;
  size: number;
}

export interface L2Snapshot {
  ts: number;
  bids: L2Level[];
  asks: L2Level[];
}

export interface BigTradePrint {
  ts: number;
  barTs: number;
  price: number;
  size: number;
  side: "buy" | "sell" | "unknown";
  tier: "large" | "whale";
}

export interface FootprintPriceRow {
  price: number;
  bidVol: number; // aggressive sells hitting the bid
  askVol: number; // aggressive buys lifting the ask
  totalVol: number;
  delta: number; // askVol - bidVol
  bidImbalance: boolean; // diagonal 300% sell imbalance
  askImbalance: boolean; // diagonal 300% buy imbalance
  isPoc: boolean;
  isAbsorptionCell: boolean;
}

export interface FootprintBar {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  totalVol: number;
  buyVol: number;
  sellVol: number;
  delta: number;
  deltaStrengthPct: number; // (delta / totalVol) * 100 matching ATAS DeltaStrength
  maxDelta: number;
  minDelta: number;
  cumDelta: number;
  pocPrice: number;
  tradeCount: number;
  rows: FootprintPriceRow[];
  stackedBuyImbalances: number;
  stackedSellImbalances: number;
  absorptionLow: boolean;
  absorptionHigh: boolean;
  exhaustionLow: boolean;
  exhaustionHigh: boolean;
  aggressionFlipBull: boolean;
  aggressionFlipBear: boolean;
  cvdDivergenceBull: boolean;
  cvdDivergenceBear: boolean;
  bigTrades: BigTradePrint[];
}

export interface VolumeProfileBin {
  price: number;
  volume: number;
  isHvn: boolean;
  isLvn: boolean;
}

export interface VolumeProfileResult {
  id: string;
  label: string;
  kind: "pd" | "pw" | "composite" | "developing" | "cash";
  startTs: number;
  endTs: number;
  poc: number;
  vah: number;
  val: number;
  totalVolume: number;
  bins: VolumeProfileBin[];
  hvns: number[];
  lvns: number[];
  high: number;
  low: number;
}

export interface NakedPoc {
  sessionDate: string;
  price: number;
  volume: number;
  sessionTs: number;
  untested: boolean;
  testedAtTs?: number;
}

export interface KeyLevelZone {
  id: string;
  label: string;
  low: number;
  high: number;
  kind:
    | "stacked"
    | "pd"
    | "pw"
    | "composite"
    | "hvn"
    | "lvn"
    | "npoc"
    | "no_trade"
    | "custom";
  untested: boolean;
  touchCount: number;
  notes?: string;
  pinned?: boolean;
}

export type BiasDirection = "bullish" | "bearish" | "balanced";
export type ModelType = "model1_reversal" | "model2_continuation" | "no_trade";
export type ScenarioNumber = 1 | 2 | 3 | 4 | 5 | 6;
export type EntryTiming =
  | "first_valid_pullback"
  | "first_touch"
  | "early"
  | "late_chase";
export type OrderSide = "long" | "short";

export type SetupTag =
  | "fade_vah_val"
  | "pd_poc_bounce"
  | "hvn_reversal"
  | "lvn_continuation"
  | "trapped_participant"
  | "failed_auction"
  | "other";

export interface PremarketPlan {
  sessionDate: string;
  bias: BiasDirection;
  biasReason: string;
  priceVsWeeklyValue: "above" | "inside" | "below";
  priceVsDailyValue: "above" | "inside" | "below";
  noTradeZoneLow: number | null;
  noTradeZoneHigh: number | null;
  nightRule: string;
  newsChecked: boolean;
  scenariosText: string;
  selectedZoneIds: string[];
}

export interface GuardrailWarning {
  id: string;
  severity: "block" | "warn";
  code:
    | "FIRST_TOUCH"
    | "BREAKOUT_CHASE"
    | "NO_RECLAIM"
    | "NO_ACCEPTANCE"
    | "MID_VALUE"
    | "MAX_TRADES"
    | "DAILY_STOP"
    | "LOW_RR"
    | "NO_PLAN"
    | "COMMISSION_DRAG";
  title: string;
  detail: string;
}

/**
 * Working pending order (Section 8: Buy Stop 1 tick above pullback bar high / Limit at zone).
 * Automatically cancels if price breaks invalidationPrice before trigger fills.
 */
export interface PendingOrder {
  id: string;
  side: OrderSide;
  orderType: Exclude<OrderType, "market">;
  model: "model1_reversal" | "model2_continuation";
  scenario: ScenarioNumber;
  setupTag: SetupTag;
  contract: ContractType;
  triggerPriceExec: number;
  invalidationPriceExec: number; // Absorption zone low (long) or high (short)
  stopPriceGC: number;
  stopPriceExec: number;
  t1PriceExec: number;
  t2PriceExec: number;
  contracts: number;
  riskDollars: number;
  commissionDollars: number;
  placedAtTs: number;
  entryTiming: EntryTiming;
  warnings: GuardrailWarning[];
  zoneId?: string;
  note: string;
}

export interface SimPosition {
  id: string;
  side: OrderSide;
  orderType?: OrderType;
  triggerPriceExec?: number; // For tracking stop-order slippage (Section 8)
  slippagePts?: number;
  model: "model1_reversal" | "model2_continuation";
  scenario: ScenarioNumber;
  setupTag: SetupTag;
  contract: ContractType;
  entryPriceGC: number;
  entryPriceExec: number;
  stopPriceGC: number;
  stopPriceExec: number;
  t1PriceExec: number;
  t2PriceExec: number;
  contracts: number;
  riskDollars: number;
  commissionDollars: number;
  openedAtTs: number;
  status: "open" | "closed";
  closedAtTs?: number;
  exitPriceExec?: number;
  exitReason?: "stop" | "t1" | "t2" | "manual" | "invalidation";
  pnlDollars?: number;
  rMultiple?: number;
  t1Hit?: boolean;
  movedToBreakeven?: boolean;
  entryTiming: EntryTiming;
  warnings: GuardrailWarning[];
  zoneId?: string;
  note: string;
}

export interface DrillCall {
  id: string;
  calledAtTs: number;
  zoneId: string;
  zoneLabel: string;
  zoneLow: number;
  zoneHigh: number;
  predictedCall: ModelType;
  scenario: ScenarioNumber;
  reason: string;
  graded?: {
    actualStatus: "rejection" | "acceptance" | "unclear";
    correct: boolean;
    barsElapsed: number;
    summary: string;
  };
}

export interface SimRepLog {
  id: string;
  createdAt: string;
  sessionDate: string;
  instrument: string;
  dataSource: DataSourceKind;
  scenario: ScenarioNumber;
  model: ModelType;
  setupTag: SetupTag;
  side: OrderSide | "none";
  entryTiming: EntryTiming | "skipped";
  contextUsed: {
    h1m30: boolean;
    m5: boolean;
    m5Footprint: boolean;
    m1: boolean;
  };
  outcomeR: number;
  pnlDollars?: number;
  entryPrice?: number;
  triggerPrice?: number;
  slippagePts?: number;
  stopPrice?: number;
  targetPrice?: number;
  ruleViolations: string[];
  note: string;
  isSample?: boolean;
}

export interface SessionDataset {
  id: string;
  title: string;
  instrument: string;
  dataSource: DataSourceKind;
  capabilities: MarketCapabilities;
  sessionDate: string; // YYYY-MM-DD (PT Asia evening date)
  asiaOpenTs: number; // 4:00 PM PT (post-DST) or session start
  asiaCloseTs: number; // 9:00 PM PT
  h1Candles: Candle[];
  m30Candles: Candle[];
  m5Candles: Candle[];
  m1Candles: Candle[];
  ticks: Tick[];
  l2Snapshots: L2Snapshot[];
  fetchedAt: string;
}

export const SCENARIO_META: Record<
  ScenarioNumber,
  {
    number: ScenarioNumber;
    shortTitle: string;
    defaultModel: ModelType;
    description: string;
  }
> = {
  1: {
    number: 1,
    shortTitle: "#1 PDH / ATH Reversal",
    defaultModel: "model1_reversal",
    description:
      "Push above PDH / major high fails acceptance, absorption + flip + reclaim back inside.",
  },
  2: {
    number: 2,
    shortTitle: "#2 PDL Pullback Bounce",
    defaultModel: "model1_reversal",
    description:
      "Poke below PDL / key support fails, sellers trapped, reclaim + first valid pullback long.",
  },
  3: {
    number: 3,
    shortTitle: "#3 Failed Auction / Breakout Cont.",
    defaultModel: "model2_continuation",
    description:
      "Clean break & acceptance beyond key edge (6+ M5 bars), retest holds in breakout direction.",
  },
  4: {
    number: 4,
    shortTitle: "#4 Gap / Drive to Lows (No Trade)",
    defaultModel: "no_trade",
    description:
      "One-way drive or gap without tested zone. Do not chase; wait for planned level.",
  },
  5: {
    number: 5,
    shortTitle: "#5 Fade Value Edges (VAH / VAL)",
    defaultModel: "model1_reversal",
    description:
      "Rejection at PD/PW VAH or VAL back into value (80% rule target toward opposite edge).",
  },
  6: {
    number: 6,
    shortTitle: "#6 Breakdown Continuation",
    defaultModel: "model2_continuation",
    description:
      "Acceptance below key support/value edge, failed reclaim on retest, continuation to next LVN/HVN.",
  },
};
