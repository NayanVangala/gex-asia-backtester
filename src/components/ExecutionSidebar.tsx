"use client";

import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Crosshair,
  ShieldAlert,
  Target,
  X,
} from "lucide-react";
import {
  Candle,
  ContractType,
  EntryTiming,
  FootprintBar,
  KeyLevelZone,
  OrderSide,
  OrderType,
  PendingOrder,
  PremarketPlan,
  SCENARIO_META,
  ScenarioNumber,
  SetupTag,
  SimPosition,
  VolumeProfileResult,
} from "@/lib/types";
import {
  CONTRACT_SPECS,
  calculatePositionSizing,
  evaluateAcceptanceRejection,
  evaluateEntryGuardrails,
  roundGCForContract,
} from "@/lib/goldMath";
import { PricePickTarget } from "./charts/CandleProfileChart";

interface ExecutionSidebarProps {
  currentPrice: number;
  replayTs: number;
  visibleM5: Candle[];
  visibleFootprints: FootprintBar[];
  zones: KeyLevelZone[];
  activeZoneId: string | null;
  onSelectZone: (id: string) => void;
  developingProfile: VolumeProfileResult | null;
  previousDayProfile: VolumeProfileResult | null;
  plan: PremarketPlan;
  positions: SimPosition[];
  pendingOrders: PendingOrder[];
  accountBalance: number;
  onAccountBalanceChange: (v: number) => void;
  onOpenPosition: (pos: SimPosition) => void;
  onPlacePendingOrder: (order: PendingOrder) => void;
  onCancelPendingOrder: (id: string) => void;
  onClosePosition: (
    id: string,
    exitPrice: number,
    reason: SimPosition["exitReason"]
  ) => void;
  onMoveStopToBE: (id: string) => void;
  onLogSkippedTouch: (payload: {
    scenario: ScenarioNumber;
    note: string;
  }) => void;
  pickPriceMode: PricePickTarget;
  onSetPickPriceMode: (target: PricePickTarget) => void;
  pickedPrices: {
    entry?: number;
    stop?: number;
    t1?: number;
    t2?: number;
    side?: OrderSide;
  };
  onClearPickedPrice: (field: "entry" | "stop" | "t1" | "t2") => void;
}

const MODEL1_STEPS = [
  "Location: price reached key zone",
  "No acceptance (closed inside 1-2 M5)",
  "Absorption + trapped prints at extreme",
  "Aggression flip (delta, imbalances, CVD)",
  "First valid pullback toward zone holds",
];

const MODEL2_STEPS = [
  "Breakout held (no breakout candle chase)",
  "Acceptance: 6+ M5 bars (30m) beyond",
  "Retest of broken level from other side",
  "Absorption on retest + trend aggression",
  "Retest rejects & holds; stop behind",
];

export function ExecutionSidebar({
  currentPrice,
  replayTs,
  visibleM5,
  visibleFootprints,
  zones,
  activeZoneId,
  onSelectZone,
  developingProfile,
  previousDayProfile,
  plan,
  positions,
  pendingOrders,
  accountBalance,
  onAccountBalanceChange,
  onOpenPosition,
  onPlacePendingOrder,
  onCancelPendingOrder,
  onClosePosition,
  onMoveStopToBE,
  onLogSkippedTouch,
  pickPriceMode,
  onSetPickPriceMode,
  pickedPrices,
  onClearPickedPrice,
}: ExecutionSidebarProps) {
  const [railTab, setRailTab] = useState<"order" | "rules">("order");
  const [showWarningsDetail, setShowWarningsDetail] = useState(false);

  const [model, setModel] = useState<"model1_reversal" | "model2_continuation">(
    "model1_reversal"
  );
  const [side, setSide] = useState<OrderSide>("long");
  const [orderType, setOrderType] = useState<OrderType>("stop");
  const [scenario, setScenario] = useState<ScenarioNumber>(5);
  const [setupTag, setSetupTag] = useState<SetupTag>("fade_vah_val");
  const [contract, setContract] = useState<ContractType>("1OZ");
  const [entryTiming, setEntryTiming] = useState<EntryTiming>(
    "first_valid_pullback"
  );
  const [riskPercent, setRiskPercent] = useState<number>(2.0);
  const [stopOffsetPts, setStopOffsetPts] = useState<number>(3.5);
  const [t1OffsetPts, setT1OffsetPts] = useState<number>(7.0);
  const [t2OffsetPts, setT2OffsetPts] = useState<number>(13.0);
  const [customEntry, setCustomEntry] = useState<string>("");
  const [customStop, setCustomStop] = useState<string>("");
  const [customT1, setCustomT1] = useState<string>("");
  const [customT2, setCustomT2] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [checkedSteps, setCheckedSteps] = useState<Record<number, boolean>>({});
  const [skipNote, setSkipNote] = useState<string>("");

  // Sync side if user clicked Bid/Ask directly in ATAS SmartDOM
  React.useEffect(() => {
    if (pickedPrices.side) setSide(pickedPrices.side);
  }, [pickedPrices.side]);

  const activeZone = useMemo(
    () => zones.find((z) => z.id === activeZoneId) ?? zones[0] ?? null,
    [zones, activeZoneId]
  );

  const acceptanceRead = useMemo(() => {
    if (!activeZone) return null;
    return evaluateAcceptanceRejection(visibleM5, activeZone);
  }, [visibleM5, activeZone]);

  const latestM5 = visibleM5[visibleM5.length - 1] ?? null;

  const effectiveEntryGC = useMemo(() => {
    if (pickedPrices.entry !== undefined) return pickedPrices.entry;
    if (customEntry.trim() !== "" && !Number.isNaN(Number(customEntry))) {
      return Number(customEntry);
    }
    if (orderType === "stop" && latestM5) {
      const tick = CONTRACT_SPECS[contract].tickSize;
      return side === "long"
        ? roundGCForContract(latestM5.high + tick, contract, "up")
        : roundGCForContract(latestM5.low - tick, contract, "down");
    }
    return currentPrice;
  }, [pickedPrices.entry, customEntry, orderType, latestM5, contract, side, currentPrice]);

  const absorptionExtremeGC = useMemo(() => {
    if (pickedPrices.stop !== undefined) return pickedPrices.stop;
    if (customStop.trim() !== "" && !Number.isNaN(Number(customStop))) {
      return Number(customStop);
    }
    return side === "long"
      ? effectiveEntryGC - stopOffsetPts
      : effectiveEntryGC + stopOffsetPts;
  }, [pickedPrices.stop, customStop, side, effectiveEntryGC, stopOffsetPts]);

  const t1PriceGC = useMemo(() => {
    if (pickedPrices.t1 !== undefined) return pickedPrices.t1;
    if (customT1.trim() !== "" && !Number.isNaN(Number(customT1))) {
      return Number(customT1);
    }
    return side === "long"
      ? effectiveEntryGC + t1OffsetPts
      : effectiveEntryGC - t1OffsetPts;
  }, [pickedPrices.t1, customT1, side, effectiveEntryGC, t1OffsetPts]);

  const t2PriceGC = useMemo(() => {
    if (pickedPrices.t2 !== undefined) return pickedPrices.t2;
    if (customT2.trim() !== "" && !Number.isNaN(Number(customT2))) {
      return Number(customT2);
    }
    return side === "long"
      ? effectiveEntryGC + t2OffsetPts
      : effectiveEntryGC - t2OffsetPts;
  }, [pickedPrices.t2, customT2, side, effectiveEntryGC, t2OffsetPts]);

  const sizing = useMemo(
    () =>
      calculatePositionSizing({
        accountBalance,
        riskPercent,
        contract,
        side,
        entryPriceGC: effectiveEntryGC,
        absorptionExtremeGC,
        t1PriceGC,
        t2PriceGC,
        bufferGcTicks: 2,
      }),
    [
      accountBalance,
      riskPercent,
      contract,
      side,
      effectiveEntryGC,
      absorptionExtremeGC,
      t1PriceGC,
      t2PriceGC,
    ]
  );

  const warnings = useMemo(
    () =>
      evaluateEntryGuardrails({
        side,
        model,
        entryPrice: sizing.entryExec,
        t2R: sizing.t2R,
        commissionDragPct: sizing.commissionDragPctOfT1,
        visibleM5,
        visibleFootprints,
        activeZone,
        developingProfile,
        plan,
        sessionPositions: positions,
        entryTimingSelected: entryTiming,
      }),
    [
      side,
      model,
      sizing,
      visibleM5,
      visibleFootprints,
      activeZone,
      developingProfile,
      plan,
      positions,
      entryTiming,
    ]
  );

  const openPosition = positions.find((p) => p.status === "open") ?? null;
  const blocked = warnings.some((w) => w.severity === "block");
  const stepsList = model === "model1_reversal" ? MODEL1_STEPS : MODEL2_STEPS;
  const checkedCount = stepsList.filter((_, idx) => checkedSteps[idx]).length;

  const snapTargetsFromProfile = () => {
    onClearPickedPrice("stop");
    onClearPickedPrice("t1");
    onClearPickedPrice("t2");
    const candidates: number[] = [];
    if (developingProfile) {
      candidates.push(developingProfile.poc, developingProfile.vah, developingProfile.val);
    }
    if (previousDayProfile) {
      candidates.push(previousDayProfile.poc, previousDayProfile.vah, previousDayProfile.val);
    }
    const filtered = candidates
      .filter((p) =>
        side === "long" ? p > effectiveEntryGC + 1.5 : p < effectiveEntryGC - 1.5
      )
      .sort((a, b) => (side === "long" ? a - b : b - a));

    if (filtered[0]) setCustomT1(filtered[0].toFixed(2));
    if (filtered[1]) setCustomT2(filtered[1].toFixed(2));
    if (activeZone) {
      setCustomStop((side === "long" ? activeZone.low : activeZone.high).toFixed(2));
    }
  };

  const snapTriggerOneTickBeyondBar = () => {
    if (!latestM5) return;
    onClearPickedPrice("entry");
    const tick = CONTRACT_SPECS[contract].tickSize;
    const p =
      side === "long"
        ? roundGCForContract(latestM5.high + tick, contract, "up")
        : roundGCForContract(latestM5.low - tick, contract, "down");
    setCustomEntry(p.toFixed(2));
    setOrderType("stop");
  };

  const handleSubmitOrder = () => {
    if (blocked || openPosition || currentPrice <= 0) return;
    const contracts =
      contract === "1OZ" && accountBalance <= 400
        ? 1
        : sizing.recommendedContracts;
    const comm = contract === "1OZ" ? 1.5 : contract === "MGC" ? 1.7 : 4.5;
    const finalNote =
      note.trim() ||
      `${model === "model1_reversal" ? "M1 Rev" : "M2 Cont"} ${side} (${orderType}) @ ${activeZone?.label ?? "zone"}`;

    if (orderType === "market") {
      onOpenPosition({
        id: `pos-${Date.now()}`,
        side,
        orderType: "market",
        triggerPriceExec: sizing.entryExec,
        slippagePts: 0,
        model,
        scenario,
        setupTag,
        contract,
        entryPriceGC: currentPrice,
        entryPriceExec: sizing.entryExec,
        stopPriceGC: sizing.stopGC,
        stopPriceExec: sizing.stopExec,
        t1PriceExec: sizing.t1Exec,
        t2PriceExec: sizing.t2Exec,
        contracts,
        riskDollars: sizing.allInRiskPerContract,
        commissionDollars: comm,
        openedAtTs: replayTs,
        status: "open",
        entryTiming,
        warnings,
        zoneId: activeZone?.id,
        note: finalNote,
      });
    } else {
      onPlacePendingOrder({
        id: `ord-${Date.now()}`,
        side,
        orderType,
        model,
        scenario,
        setupTag,
        contract,
        triggerPriceExec: sizing.entryExec,
        invalidationPriceExec: sizing.stopExec,
        stopPriceGC: sizing.stopGC,
        stopPriceExec: sizing.stopExec,
        t1PriceExec: sizing.t1Exec,
        t2PriceExec: sizing.t2Exec,
        contracts,
        riskDollars: sizing.allInRiskPerContract,
        commissionDollars: comm,
        placedAtTs: replayTs,
        entryTiming,
        warnings,
        zoneId: activeZone?.id,
        note: finalNote,
      });
    }
    setNote("");
  };

  const openStats = useMemo(() => {
    if (!openPosition) return null;
    const ptVal =
      openPosition.contract === "1OZ"
        ? 1
        : openPosition.contract === "MGC"
          ? 10
          : 100;
    const pts =
      openPosition.side === "long"
        ? currentPrice - openPosition.entryPriceExec
        : openPosition.entryPriceExec - currentPrice;
    const net = pts * ptVal * openPosition.contracts - openPosition.commissionDollars;
    const r = openPosition.riskDollars > 0 ? net / openPosition.riskDollars : 0;
    return { pts, net, r };
  }, [openPosition, currentPrice]);

  return (
    <aside className="flex h-full flex-col bg-[#151B26] text-xs select-none border-l border-[#2A2E39]">
      {/* ATAS Chart Trader Header + Zone Acceptance Readout */}
      <div className="border-b border-[#2A2E39] bg-[#1A2333] px-2.5 py-2">
        <div className="flex items-center justify-between gap-1.5">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-[#F1F1F1]">
            Chart Trader
          </span>
          <select
            value={activeZone?.id ?? ""}
            onChange={(e) => onSelectZone(e.target.value)}
            className="max-w-[165px] truncate rounded-xs bg-[#111620] px-1.5 py-0.5 text-[10.5px] text-[#F1F1F1] border border-[#2A2E39] focus:outline-none"
          >
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.label.replace("STACKED: ", "★ ")} ({z.low.toFixed(1)}-{z.high.toFixed(1)})
              </option>
            ))}
          </select>
        </div>
        {acceptanceRead && (
          <div className="mt-1.5 flex items-center justify-between text-[10.5px]">
            <span
              className={`font-semibold ${
                acceptanceRead.status === "rejection"
                  ? "text-[#089981]"
                  : acceptanceRead.status === "acceptance"
                    ? "text-[#3BEFF0]"
                    : acceptanceRead.status === "unclear"
                      ? "text-[#FFFF00]"
                      : "text-[#ABAEB8]"
              }`}
            >
              {acceptanceRead.status === "rejection"
                ? "Rejection (M1)"
                : acceptanceRead.status === "acceptance"
                  ? "Acceptance (M2)"
                  : acceptanceRead.status === "unclear"
                    ? "Unclear (Skip)"
                    : "Untested"}
            </span>
            <span className="font-mono-num text-[10px] text-[#ABAEB8]">
              {acceptanceRead.barsBeyondCount} M5 · {acceptanceRead.minutesBeyond}m ·{" "}
              {acceptanceRead.closesBeyondCount} cls
            </span>
          </div>
        )}
      </div>

      {/* Sub-Tabs */}
      <div className="grid grid-cols-2 border-b border-[#2A2E39] bg-[#131822] text-[11px]">
        <button
          type="button"
          onClick={() => setRailTab("order")}
          className={`py-1.5 font-medium transition border-t-2 ${
            railTab === "order"
              ? "border-[#2962FF] bg-[#151B26] text-[#F1F1F1]"
              : "border-transparent text-[#ABAEB8] hover:text-white"
          }`}
        >
          Order
        </button>
        <button
          type="button"
          onClick={() => setRailTab("rules")}
          className={`py-1.5 font-medium transition border-t-2 ${
            railTab === "rules"
              ? "border-[#2962FF] bg-[#151B26] text-[#F1F1F1]"
              : "border-transparent text-[#ABAEB8] hover:text-white"
          }`}
        >
          Rules ({checkedCount}/{stepsList.length})
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 py-2.5 space-y-2.5">
        {/* Working Pending Orders */}
        {pendingOrders.map((ord) => (
          <div
            key={ord.id}
            className="rounded-xs border border-[#2962FF]/60 bg-[#1A2333] p-2"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono-num text-[10.5px] font-semibold text-[#3BEFF0]">
                WORKING {ord.side.toUpperCase()} {ord.orderType.toUpperCase()}
              </span>
              <button
                type="button"
                onClick={() => onCancelPendingOrder(ord.id)}
                className="flex items-center gap-0.5 text-[10px] text-[#ABAEB8] hover:text-[#F2385A]"
              >
                <X className="h-3 w-3" /> Cancel
              </button>
            </div>
            <div className="mt-1 flex justify-between font-mono-num text-[10px] text-[#D1D4DC]">
              <span>Trig {ord.triggerPriceExec.toFixed(2)}</span>
              <span className="text-[#F2385A]">Inv {ord.invalidationPriceExec.toFixed(2)}</span>
              <span className="text-[#089981]">T2 {ord.t2PriceExec.toFixed(1)}</span>
            </div>
          </div>
        ))}

        {/* Open Position */}
        {openPosition && openStats && (
          <div className="rounded-xs border border-[#434651] bg-[#1A2333] p-2">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] font-semibold text-[#F1F1F1]">
                {openPosition.side.toUpperCase()} {openPosition.contracts}×{" "}
                {openPosition.contract}
              </span>
              <span
                className={`font-mono-num text-xs font-bold ${
                  openStats.net >= 0 ? "text-[#089981]" : "text-[#F2385A]"
                }`}
              >
                {openStats.net >= 0 ? "+" : ""}${openStats.net.toFixed(2)} (
                {openStats.r >= 0 ? "+" : ""}
                {openStats.r.toFixed(2)}R)
              </span>
            </div>
            <div className="mt-1.5 grid grid-cols-4 gap-1 font-mono-num text-[10px] text-[#ABAEB8]">
              <div>
                <div className="text-[9px]">FILL</div>
                <div className="text-[#F1F1F1]">{openPosition.entryPriceExec.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-[9px] text-[#F2385A]">SL</div>
                <div>{openPosition.stopPriceExec.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-[9px] text-[#089981]">T1</div>
                <div>{openPosition.t1PriceExec.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-[9px] text-[#3BEFF0]">T2</div>
                <div>{openPosition.t2PriceExec.toFixed(2)}</div>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1">
              <button
                type="button"
                onClick={() => onMoveStopToBE(openPosition.id)}
                disabled={openPosition.movedToBreakeven}
                className="rounded-xs bg-[#2A2E39] py-1 text-[10px] text-[#F1F1F1] hover:bg-[#363A45] disabled:opacity-40"
              >
                {openPosition.movedToBreakeven ? "@ BE" : "BE"}
              </button>
              <button
                type="button"
                onClick={() =>
                  onClosePosition(openPosition.id, currentPrice, "invalidation")
                }
                className="rounded-xs bg-[#F2385A]/20 py-1 text-[10px] text-[#F2385A] hover:bg-[#F2385A]/30"
              >
                Invalidated
              </button>
              <button
                type="button"
                onClick={() =>
                  onClosePosition(openPosition.id, currentPrice, "manual")
                }
                className="rounded-xs bg-[#F1F1F1] py-1 text-[10px] font-semibold text-[#111620] hover:bg-white"
              >
                Flatten
              </button>
            </div>
          </div>
        )}

        {railTab === "order" ? (
          <>
            {/* ATAS Buy (#089981) / Sell (#F2385A) Buttons */}
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => setSide("long")}
                className={`rounded-xs py-1.5 text-[11px] font-semibold transition ${
                  side === "long"
                    ? "bg-[#089981] text-white"
                    : "bg-[#1A2333] text-[#ABAEB8] border border-[#2A2E39]"
                }`}
              >
                Buy / Long
              </button>
              <button
                type="button"
                onClick={() => setSide("short")}
                className={`rounded-xs py-1.5 text-[11px] font-semibold transition ${
                  side === "short"
                    ? "bg-[#F2385A] text-white"
                    : "bg-[#1A2333] text-[#ABAEB8] border border-[#2A2E39]"
                }`}
              >
                Sell / Short
              </button>
            </div>

            {/* Order Type + Model */}
            <div className="flex items-center justify-between gap-1 text-[10.5px]">
              <div className="flex items-center gap-0.5">
                {(
                  [
                    { id: "stop", label: "Stop" },
                    { id: "limit", label: "Limit" },
                    { id: "market", label: "Mkt" },
                  ] as const
                ).map((ot) => (
                  <button
                    key={ot.id}
                    type="button"
                    onClick={() => setOrderType(ot.id)}
                    className={`rounded-xs px-2 py-0.5 ${
                      orderType === ot.id
                        ? "bg-[#2962FF] text-white font-medium"
                        : "bg-[#1A2333] text-[#ABAEB8]"
                    }`}
                  >
                    {ot.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => setModel("model1_reversal")}
                  className={`rounded-xs px-1.5 py-0.5 ${
                    model === "model1_reversal"
                      ? "bg-[#363A45] text-white font-medium"
                      : "bg-[#1A2333] text-[#ABAEB8]"
                  }`}
                >
                  M1
                </button>
                <button
                  type="button"
                  onClick={() => setModel("model2_continuation")}
                  className={`rounded-xs px-1.5 py-0.5 ${
                    model === "model2_continuation"
                      ? "bg-[#363A45] text-white font-medium"
                      : "bg-[#1A2333] text-[#ABAEB8]"
                  }`}
                >
                  M2
                </button>
              </div>
            </div>

            {/* Price Inputs */}
            <div className="space-y-1.5">
              {orderType !== "market" && (
                <div className="flex items-center gap-1 rounded-xs bg-[#1A2333] px-2 py-1 border border-[#2A2E39]">
                  <span className="text-[10px] text-[#ABAEB8] w-12">
                    {orderType === "stop" ? "Trigger" : "Limit"}
                  </span>
                  <input
                    type="number"
                    step="0.25"
                    value={
                      pickedPrices.entry !== undefined
                        ? pickedPrices.entry
                        : customEntry
                    }
                    placeholder={effectiveEntryGC.toFixed(2)}
                    onChange={(e) => {
                      onClearPickedPrice("entry");
                      setCustomEntry(e.target.value);
                    }}
                    className="w-full bg-transparent text-right font-mono-num text-[11px] text-[#F1F1F1] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={snapTriggerOneTickBeyondBar}
                    title="Snap 1 tick beyond last M5 bar"
                    className="text-[9px] text-[#3BEFF0] hover:underline"
                  >
                    +1t
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onSetPickPriceMode(pickPriceMode === "entry" ? null : "entry")
                    }
                    className={
                      pickPriceMode === "entry" ? "text-[#FFFF00]" : "text-[#ABAEB8] hover:text-white"
                    }
                  >
                    <Crosshair className="h-3 w-3" />
                  </button>
                </div>
              )}

              <div className="flex items-center gap-1 rounded-xs bg-[#1A2333] px-2 py-1 border border-[#2A2E39]">
                <span className="text-[10px] text-[#F2385A] w-12">Stop</span>
                <input
                  type="number"
                  step="0.1"
                  value={pickedPrices.stop !== undefined ? pickedPrices.stop : customStop}
                  placeholder={absorptionExtremeGC.toFixed(2)}
                  onChange={(e) => {
                    onClearPickedPrice("stop");
                    setCustomStop(e.target.value);
                  }}
                  className="w-full bg-transparent text-right font-mono-num text-[11px] text-[#F1F1F1] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() =>
                    onSetPickPriceMode(pickPriceMode === "stop" ? null : "stop")
                  }
                  className={
                    pickPriceMode === "stop" ? "text-[#F2385A]" : "text-[#ABAEB8] hover:text-white"
                  }
                >
                  <Crosshair className="h-3 w-3" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-1">
                <div className="flex items-center gap-1 rounded-xs bg-[#1A2333] px-1.5 py-1 border border-[#2A2E39]">
                  <span className="text-[10px] text-[#089981]">T1</span>
                  <input
                    type="number"
                    step="0.25"
                    value={pickedPrices.t1 !== undefined ? pickedPrices.t1 : customT1}
                    placeholder={t1PriceGC.toFixed(1)}
                    onChange={(e) => {
                      onClearPickedPrice("t1");
                      setCustomT1(e.target.value);
                    }}
                    className="w-full bg-transparent text-right font-mono-num text-[11px] text-[#F1F1F1] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => onSetPickPriceMode(pickPriceMode === "t1" ? null : "t1")}
                    className={pickPriceMode === "t1" ? "text-[#089981]" : "text-[#ABAEB8]"}
                  >
                    <Crosshair className="h-3 w-3" />
                  </button>
                </div>

                <div className="flex items-center gap-1 rounded-xs bg-[#1A2333] px-1.5 py-1 border border-[#2A2E39]">
                  <span className="text-[10px] text-[#3BEFF0]">T2</span>
                  <input
                    type="number"
                    step="0.25"
                    value={pickedPrices.t2 !== undefined ? pickedPrices.t2 : customT2}
                    placeholder={t2PriceGC.toFixed(1)}
                    onChange={(e) => {
                      onClearPickedPrice("t2");
                      setCustomT2(e.target.value);
                    }}
                    className="w-full bg-transparent text-right font-mono-num text-[11px] text-[#F1F1F1] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => onSetPickPriceMode(pickPriceMode === "t2" ? null : "t2")}
                    className={pickPriceMode === "t2" ? "text-[#3BEFF0]" : "text-[#ABAEB8]"}
                  >
                    <Crosshair className="h-3 w-3" />
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={snapTargetsFromProfile}
                className="flex items-center gap-1 text-[10px] text-[#3BEFF0] hover:underline"
              >
                <Target className="h-3 w-3" /> Snap Profile Targets &amp; Zone Stop
              </button>
            </div>

            {/* Contract & Timing */}
            <div className="grid grid-cols-2 gap-1 text-[10.5px]">
              <select
                value={contract}
                onChange={(e) => setContract(e.target.value as ContractType)}
                className="rounded-xs bg-[#1A2333] px-1.5 py-1 font-mono-num text-[#F1F1F1] border border-[#2A2E39]"
              >
                <option value="1OZ">1OZ ($1/pt)</option>
                <option value="MGC">MGC ($10/pt)</option>
                <option value="GC">GC ($100/pt)</option>
              </select>
              <select
                value={entryTiming}
                onChange={(e) => setEntryTiming(e.target.value as EntryTiming)}
                className="rounded-xs bg-[#1A2333] px-1.5 py-1 text-[#F1F1F1] border border-[#2A2E39]"
              >
                <option value="first_valid_pullback">1st Pullback</option>
                <option value="first_touch">1st Touch (Leak)</option>
                <option value="early">Early</option>
                <option value="late_chase">Late Chase</option>
              </select>
            </div>

            {/* Risk Math */}
            <div className="space-y-1 border-y border-[#2A2E39] py-1.5 font-mono-num text-[10px]">
              <div className="flex justify-between">
                <span className="text-[#ABAEB8]">Outward {contract} SL</span>
                <span className="text-[#F1F1F1]">
                  {sizing.stopExec.toFixed(2)} ({sizing.stopDistancePts.toFixed(2)}pt)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#ABAEB8]">Risk (${accountBalance})</span>
                <span className={sizing.oversizedForAccount ? "text-[#F2385A]" : "text-[#F1F1F1]"}>
                  ${sizing.allInRiskPerContract.toFixed(2)} ({sizing.accountRiskPct}%)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#ABAEB8]">Net T1 / T2</span>
                <span>
                  <span className="text-[#089981]">{sizing.t1R.toFixed(1)}R</span> /{" "}
                  <span className={sizing.t2BelowMin2R ? "text-[#FFFF00]" : "text-[#3BEFF0] font-semibold"}>
                    {sizing.t2R.toFixed(1)}R
                  </span>
                </span>
              </div>
            </div>

            {/* Guardrails */}
            {warnings.length > 0 ? (
              <div className="rounded-xs border border-[#434651] bg-[#1A2333]">
                <button
                  type="button"
                  onClick={() => setShowWarningsDetail((v) => !v)}
                  className="flex w-full items-center justify-between px-2 py-1 text-[10px]"
                >
                  <span
                    className={`flex items-center gap-1 font-medium ${
                      blocked ? "text-[#F2385A]" : "text-[#FFFF00]"
                    }`}
                  >
                    {blocked ? <ShieldAlert className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                    {warnings.length} rule {warnings.length === 1 ? "flag" : "flags"}:{" "}
                    {warnings[0].title.slice(0, 22)}
                  </span>
                  {showWarningsDetail ? (
                    <ChevronUp className="h-3 w-3 text-[#ABAEB8]" />
                  ) : (
                    <ChevronDown className="h-3 w-3 text-[#ABAEB8]" />
                  )}
                </button>
                {showWarningsDetail && (
                  <div className="border-t border-[#2A2E39] px-2 py-1.5 space-y-1 text-[10px] text-[#ABAEB8]">
                    {warnings.map((w) => (
                      <div key={w.id}>
                        <div className="font-semibold text-[#F1F1F1]">{w.title}</div>
                        <div>{w.detail}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1 text-[10px] text-[#089981]">
                <Check className="h-3 w-3" /> Model rules clean
              </div>
            )}

            {/* Primary Order Button */}
            <button
              type="button"
              disabled={blocked || Boolean(openPosition) || currentPrice <= 0}
              onClick={handleSubmitOrder}
              className={`w-full rounded-xs py-2 text-[11px] font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40 ${
                side === "long"
                  ? "bg-[#089981] hover:bg-[#0ab195]"
                  : "bg-[#F2385A] hover:bg-[#ff4b6b]"
              }`}
            >
              {openPosition
                ? "Position Open"
                : blocked
                  ? "Daily Rule Cap"
                  : `${orderType === "market" ? "Market" : `Working ${orderType.toUpperCase()}`} ${side.toUpperCase()} ${
                      contract === "1OZ" && accountBalance <= 400
                        ? 1
                        : sizing.recommendedContracts
                    }× ${contract} @ ${sizing.entryExec.toFixed(2)}`}
            </button>

            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="1-line order flow note..."
              className="w-full rounded-xs bg-[#1A2333] px-2 py-1 text-[10.5px] text-[#F1F1F1] placeholder:text-[#787D8C] border border-[#2A2E39]"
            />
          </>
        ) : (
          /* Checklist & Skip Tab */
          <>
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-[#ABAEB8]">
                {model === "model1_reversal" ? "Model 1: Reversal" : "Model 2: Continuation"}
              </div>
              {stepsList.map((label, idx) => (
                <label
                  key={label}
                  className="flex cursor-pointer items-start gap-2 rounded-xs bg-[#1A2333] px-2 py-1.5 text-[10.5px] text-[#D1D4DC]"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(checkedSteps[idx])}
                    onChange={(e) =>
                      setCheckedSteps((prev) => ({
                        ...prev,
                        [idx]: e.target.checked,
                      }))
                    }
                    className="mt-0.5 h-3 w-3 accent-[#089981]"
                  />
                  <span className={checkedSteps[idx] ? "text-[#3BEFF0]" : ""}>
                    {label}
                  </span>
                </label>
              ))}
            </div>

            <div className="space-y-1.5 border-t border-[#2A2E39] pt-2">
              <select
                value={scenario}
                onChange={(e) => setScenario(Number(e.target.value) as ScenarioNumber)}
                className="w-full rounded-xs bg-[#1A2333] px-2 py-1 text-[10.5px] text-[#F1F1F1] border border-[#2A2E39]"
              >
                {([1, 2, 3, 4, 5, 6] as ScenarioNumber[]).map((n) => (
                  <option key={n} value={n}>
                    {SCENARIO_META[n].shortTitle}
                  </option>
                ))}
              </select>
              <select
                value={setupTag}
                onChange={(e) => setSetupTag(e.target.value as SetupTag)}
                className="w-full rounded-xs bg-[#1A2333] px-2 py-1 text-[10.5px] text-[#F1F1F1] border border-[#2A2E39]"
              >
                <option value="fade_vah_val">Fade VAH / VAL</option>
                <option value="pd_poc_bounce">PD POC / Stacked Bounce</option>
                <option value="hvn_reversal">HVN Reversal</option>
                <option value="lvn_continuation">LVN Continuation</option>
                <option value="trapped_participant">Trapped Participant</option>
                <option value="failed_auction">Failed Auction</option>
              </select>
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="number"
                  value={accountBalance}
                  onChange={(e) =>
                    onAccountBalanceChange(Math.max(50, Number(e.target.value) || 300))
                  }
                  className="rounded-xs bg-[#1A2333] px-2 py-1 font-mono-num text-[10.5px] text-[#F1F1F1] border border-[#2A2E39]"
                  title="Account Balance ($)"
                />
                <input
                  type="number"
                  step="0.5"
                  value={riskPercent}
                  onChange={(e) =>
                    setRiskPercent(Math.max(0.25, Number(e.target.value) || 2))
                  }
                  className="rounded-xs bg-[#1A2333] px-2 py-1 font-mono-num text-[10.5px] text-[#F1F1F1] border border-[#2A2E39]"
                  title="Risk %"
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-[#ABAEB8]">
                <span>Default Stop</span>
                <div className="flex gap-1">
                  {[2.5, 3.5, 4.5, 6.0].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        setStopOffsetPts(d);
                        setT1OffsetPts(d * 2);
                        setT2OffsetPts(d * 3.2);
                      }}
                      className={`rounded-xs px-1.5 py-0.5 font-mono-num ${
                        stopOffsetPts === d
                          ? "bg-[#2962FF] text-white"
                          : "bg-[#1A2333] text-[#ABAEB8]"
                      }`}
                    >
                      {d}pt
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="border-t border-[#2A2E39] pt-2">
              <div className="flex gap-1">
                <input
                  type="text"
                  value={skipNote}
                  onChange={(e) => setSkipNote(e.target.value)}
                  placeholder="Why skipped?"
                  className="min-w-0 flex-1 rounded-xs bg-[#1A2333] px-2 py-1 text-[10.5px] text-[#F1F1F1] border border-[#2A2E39]"
                />
                <button
                  type="button"
                  onClick={() => {
                    onLogSkippedTouch({
                      scenario,
                      note: skipNote.trim() || `No-Trade @ ${activeZone?.label ?? "zone"}`,
                    });
                    setSkipNote("");
                  }}
                  className="rounded-xs bg-[#2A2E39] px-2 py-1 text-[10.5px] text-[#F1F1F1] hover:bg-[#363A45]"
                >
                  Log Skip
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
