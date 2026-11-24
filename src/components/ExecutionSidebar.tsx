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
  };
  onClearPickedPrice: (field: "entry" | "stop" | "t1" | "t2") => void;
}

const MODEL1_STEPS = [
  "Location: price reached key zone",
  "No acceptance (closed back inside 1-2 M5)",
  "Absorption + trapped prints at extreme",
  "Aggression flip (delta, imbalances, CVD)",
  "First valid pullback toward zone holds",
];

const MODEL2_STEPS = [
  "Breakout held (did not chase candle)",
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

  const eightyPctTarget = useMemo(() => {
    if (!previousDayProfile) return null;
    if (side === "long" && currentPrice <= previousDayProfile.poc) {
      return { label: "80% Rule -> PD VAH", price: previousDayProfile.vah };
    }
    if (side === "short" && currentPrice >= previousDayProfile.poc) {
      return { label: "80% Rule -> PD VAL", price: previousDayProfile.val };
    }
    return null;
  }, [previousDayProfile, side, currentPrice]);

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
    <aside className="flex h-full flex-col bg-[#0f1217] text-xs select-none">
      {/* Compact Active Zone + Section 3 Readout */}
      <div className="border-b border-[#1c212b] px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-[#6e7787]">
            Zone Read
          </span>
          <select
            value={activeZone?.id ?? ""}
            onChange={(e) => onSelectZone(e.target.value)}
            className="max-w-[190px] truncate rounded bg-[#151922] px-2 py-0.5 text-[11px] text-[#e6e9ef] border border-[#222836] focus:outline-none"
          >
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.label.replace("STACKED: ", "★ ")} ({z.low.toFixed(1)}-{z.high.toFixed(1)})
              </option>
            ))}
          </select>
        </div>
        {acceptanceRead && (
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <span
              className={`font-medium ${
                acceptanceRead.status === "rejection"
                  ? "text-[#00c087]"
                  : acceptanceRead.status === "acceptance"
                    ? "text-[#e6e9ef]"
                    : acceptanceRead.status === "unclear"
                      ? "text-[#d4a03a]"
                      : "text-[#6e7787]"
              }`}
            >
              {acceptanceRead.status === "rejection"
                ? "Rejection (Watch M1)"
                : acceptanceRead.status === "acceptance"
                  ? "Acceptance (Watch M2)"
                  : acceptanceRead.status === "unclear"
                    ? "Unclear (No Trade)"
                    : "Waiting for Touch"}
            </span>
            <span className="font-mono-num text-[10px] text-[#7d8594]">
              {acceptanceRead.barsBeyondCount} M5 · {acceptanceRead.minutesBeyond}m ·{" "}
              {acceptanceRead.closesBeyondCount} cls
            </span>
          </div>
        )}
      </div>

      {/* Rail Sub-Tabs: Trade Ticket vs Model Checklist */}
      <div className="grid grid-cols-2 border-b border-[#1c212b] text-[11px]">
        <button
          type="button"
          onClick={() => setRailTab("order")}
          className={`py-2 font-medium transition border-b-2 ${
            railTab === "order"
              ? "border-[#e6e9ef] text-[#e6e9ef]"
              : "border-transparent text-[#6e7787] hover:text-[#b4bccb]"
          }`}
        >
          Order Ticket
        </button>
        <button
          type="button"
          onClick={() => setRailTab("rules")}
          className={`py-2 font-medium transition border-b-2 ${
            railTab === "rules"
              ? "border-[#e6e9ef] text-[#e6e9ef]"
              : "border-transparent text-[#6e7787] hover:text-[#b4bccb]"
          }`}
        >
          Checklist ({checkedCount}/{stepsList.length})
        </button>
      </div>

      {/* Scrollable Inner Rail Body */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {/* Active Working Order Banner */}
        {pendingOrders.map((ord) => (
          <div
            key={ord.id}
            className="rounded border border-[#d4a03a]/40 bg-[#181611] p-2.5"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono-num text-[11px] font-semibold text-[#eab854]">
                WORKING {ord.side.toUpperCase()} {ord.orderType.toUpperCase()}
              </span>
              <button
                type="button"
                onClick={() => onCancelPendingOrder(ord.id)}
                className="flex items-center gap-0.5 text-[10px] text-[#8b94a5] hover:text-[#f6465d]"
              >
                <X className="h-3 w-3" /> Cancel
              </button>
            </div>
            <div className="mt-1.5 flex justify-between font-mono-num text-[10px] text-[#b4bccb]">
              <span>Trig {ord.triggerPriceExec.toFixed(2)}</span>
              <span className="text-[#f6465d]">Inv {ord.invalidationPriceExec.toFixed(2)}</span>
              <span className="text-[#00c087]">T2 {ord.t2PriceExec.toFixed(1)}</span>
            </div>
          </div>
        ))}

        {/* Active Open Position */}
        {openPosition && openStats && (
          <div className="rounded border border-[#2a3346] bg-[#141822] p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-[#e6e9ef]">
                OPEN {openPosition.side.toUpperCase()} {openPosition.contracts}×{" "}
                {openPosition.contract}
              </span>
              <span
                className={`font-mono-num text-xs font-bold ${
                  openStats.net >= 0 ? "text-[#00c087]" : "text-[#f6465d]"
                }`}
              >
                {openStats.net >= 0 ? "+" : ""}${openStats.net.toFixed(2)} (
                {openStats.r >= 0 ? "+" : ""}
                {openStats.r.toFixed(2)}R)
              </span>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1 font-mono-num text-[10px] text-[#8b94a5]">
              <div>
                <div className="text-[9px] text-[#586070]">FILL</div>
                <div className="text-[#e6e9ef]">{openPosition.entryPriceExec.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-[9px] text-[#f6465d]">SL</div>
                <div>{openPosition.stopPriceExec.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-[9px] text-[#00c087]">T1</div>
                <div>{openPosition.t1PriceExec.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-[9px] text-[#00c087]">T2</div>
                <div>{openPosition.t2PriceExec.toFixed(2)}</div>
              </div>
            </div>
            <div className="mt-2.5 grid grid-cols-3 gap-1">
              <button
                type="button"
                onClick={() => onMoveStopToBE(openPosition.id)}
                disabled={openPosition.movedToBreakeven}
                className="rounded bg-[#1e2433] py-1 text-[10px] text-[#c8cfdc] hover:bg-[#283044] disabled:opacity-40"
              >
                {openPosition.movedToBreakeven ? "@ BE" : "Move BE"}
              </button>
              <button
                type="button"
                onClick={() =>
                  onClosePosition(openPosition.id, currentPrice, "invalidation")
                }
                className="rounded bg-[#26181e] py-1 text-[10px] text-[#f6465d] hover:bg-[#351e27]"
              >
                Invalidated
              </button>
              <button
                type="button"
                onClick={() =>
                  onClosePosition(openPosition.id, currentPrice, "manual")
                }
                className="rounded bg-[#e6e9ef] py-1 text-[10px] font-semibold text-[#0b0d11] hover:bg-white"
              >
                Flatten Now
              </button>
            </div>
          </div>
        )}

        {railTab === "order" ? (
          <>
            {/* Long / Short Institutional Segmented Switch */}
            <div className="grid grid-cols-2 rounded-md bg-[#151922] p-0.5">
              <button
                type="button"
                onClick={() => setSide("long")}
                className={`rounded py-1.5 text-[11px] font-semibold transition ${
                  side === "long"
                    ? "bg-[#00c087] text-[#071410]"
                    : "text-[#8b94a5] hover:text-[#e6e9ef]"
                }`}
              >
                Long
              </button>
              <button
                type="button"
                onClick={() => setSide("short")}
                className={`rounded py-1.5 text-[11px] font-semibold transition ${
                  side === "short"
                    ? "bg-[#f6465d] text-white"
                    : "text-[#8b94a5] hover:text-[#e6e9ef]"
                }`}
              >
                Short
              </button>
            </div>

            {/* Order Type + Model compact row */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 text-[11px]">
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
                    className={`rounded px-2 py-0.5 transition ${
                      orderType === ot.id
                        ? "bg-[#222836] text-[#e6e9ef] font-medium"
                        : "text-[#6e7787] hover:text-[#b4bccb]"
                    }`}
                  >
                    {ot.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 text-[10px]">
                <button
                  type="button"
                  onClick={() => setModel("model1_reversal")}
                  className={`rounded px-1.5 py-0.5 ${
                    model === "model1_reversal"
                      ? "bg-[#222836] text-[#e6e9ef] font-medium"
                      : "text-[#6e7787]"
                  }`}
                >
                  M1 Rev
                </button>
                <button
                  type="button"
                  onClick={() => setModel("model2_continuation")}
                  className={`rounded px-1.5 py-0.5 ${
                    model === "model2_continuation"
                      ? "bg-[#222836] text-[#e6e9ef] font-medium"
                      : "text-[#6e7787]"
                  }`}
                >
                  M2 Cont
                </button>
              </div>
            </div>

            {/* Price Inputs (Hyperliquid / TradingView clean inline rows) */}
            <div className="space-y-1.5">
              {orderType !== "market" && (
                <div className="flex items-center gap-1.5 rounded bg-[#151922] px-2.5 py-1.5 border border-[#1f2532]">
                  <span className="text-[10px] text-[#7d8594] w-14">
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
                    className="w-full bg-transparent text-right font-mono-num text-xs text-[#e6e9ef] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={snapTriggerOneTickBeyondBar}
                    title="Snap 1 tick beyond last M5 high/low (Section 8)"
                    className="shrink-0 text-[9px] text-[#8b94a5] hover:text-[#e6e9ef]"
                  >
                    +1t
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onSetPickPriceMode(pickPriceMode === "entry" ? null : "entry")
                    }
                    title="Click chart to set trigger"
                    className={`shrink-0 ${
                      pickPriceMode === "entry" ? "text-[#d4a03a]" : "text-[#586070] hover:text-[#e6e9ef]"
                    }`}
                  >
                    <Crosshair className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              <div className="flex items-center gap-1.5 rounded bg-[#151922] px-2.5 py-1.5 border border-[#1f2532]">
                <span className="text-[10px] text-[#f6465d] w-14">Stop</span>
                <input
                  type="number"
                  step="0.1"
                  value={pickedPrices.stop !== undefined ? pickedPrices.stop : customStop}
                  placeholder={absorptionExtremeGC.toFixed(2)}
                  onChange={(e) => {
                    onClearPickedPrice("stop");
                    setCustomStop(e.target.value);
                  }}
                  className="w-full bg-transparent text-right font-mono-num text-xs text-[#e6e9ef] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() =>
                    onSetPickPriceMode(pickPriceMode === "stop" ? null : "stop")
                  }
                  title="Click chart to set stop"
                  className={`shrink-0 ${
                    pickPriceMode === "stop" ? "text-[#f6465d]" : "text-[#586070] hover:text-[#e6e9ef]"
                  }`}
                >
                  <Crosshair className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <div className="flex items-center gap-1 rounded bg-[#151922] px-2 py-1.5 border border-[#1f2532]">
                  <span className="text-[10px] text-[#00c087]">T1</span>
                  <input
                    type="number"
                    step="0.25"
                    value={pickedPrices.t1 !== undefined ? pickedPrices.t1 : customT1}
                    placeholder={t1PriceGC.toFixed(1)}
                    onChange={(e) => {
                      onClearPickedPrice("t1");
                      setCustomT1(e.target.value);
                    }}
                    className="w-full bg-transparent text-right font-mono-num text-[11px] text-[#e6e9ef] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onSetPickPriceMode(pickPriceMode === "t1" ? null : "t1")
                    }
                    className={`shrink-0 ${
                      pickPriceMode === "t1" ? "text-[#00c087]" : "text-[#586070] hover:text-[#e6e9ef]"
                    }`}
                  >
                    <Crosshair className="h-3 w-3" />
                  </button>
                </div>

                <div className="flex items-center gap-1 rounded bg-[#151922] px-2 py-1.5 border border-[#1f2532]">
                  <span className="text-[10px] text-[#00c087]">T2</span>
                  <input
                    type="number"
                    step="0.25"
                    value={pickedPrices.t2 !== undefined ? pickedPrices.t2 : customT2}
                    placeholder={t2PriceGC.toFixed(1)}
                    onChange={(e) => {
                      onClearPickedPrice("t2");
                      setCustomT2(e.target.value);
                    }}
                    className="w-full bg-transparent text-right font-mono-num text-[11px] text-[#e6e9ef] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onSetPickPriceMode(pickPriceMode === "t2" ? null : "t2")
                    }
                    className={`shrink-0 ${
                      pickPriceMode === "t2" ? "text-[#00c087]" : "text-[#586070] hover:text-[#e6e9ef]"
                    }`}
                  >
                    <Crosshair className="h-3 w-3" />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] text-[#6e7787] pt-0.5">
                <button
                  type="button"
                  onClick={snapTargetsFromProfile}
                  className="flex items-center gap-1 text-[#8b94a5] hover:text-[#e6e9ef]"
                >
                  <Target className="h-3 w-3" /> Snap Profile Levels
                </button>
                {eightyPctTarget && (
                  <button
                    type="button"
                    onClick={() => {
                      onClearPickedPrice("t2");
                      setCustomT2(eightyPctTarget.price.toFixed(2));
                    }}
                    className="text-[#8b94a5] hover:text-[#e6e9ef]"
                  >
                    {eightyPctTarget.label}
                  </button>
                )}
              </div>
            </div>

            {/* Compact Contract + Entry Timing */}
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              <select
                value={contract}
                onChange={(e) => setContract(e.target.value as ContractType)}
                className="rounded bg-[#151922] px-2 py-1.5 font-mono-num text-[11px] text-[#e6e9ef] border border-[#1f2532]"
              >
                <option value="1OZ">1OZ ($1/pt)</option>
                <option value="MGC">MGC ($10/pt)</option>
                <option value="GC">GC ($100/pt)</option>
              </select>
              <select
                value={entryTiming}
                onChange={(e) => setEntryTiming(e.target.value as EntryTiming)}
                className="rounded bg-[#151922] px-2 py-1.5 text-[11px] text-[#e6e9ef] border border-[#1f2532]"
              >
                <option value="first_valid_pullback">1st Valid Pullback</option>
                <option value="first_touch">First Touch (Leak)</option>
                <option value="early">Early Entry</option>
                <option value="late_chase">Late Chase</option>
              </select>
            </div>

            {/* Clean Risk / Reward Spec Table */}
            <div className="space-y-1 border-y border-[#1c212b] py-2 font-mono-num text-[10.5px]">
              <div className="flex justify-between">
                <span className="text-[#6e7787]">Outward {contract} Stop</span>
                <span className="text-[#e6e9ef]">
                  {sizing.stopExec.toFixed(2)}{" "}
                  <span className="text-[#6e7787]">({sizing.stopDistancePts.toFixed(2)}pt)</span>
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6e7787]">All-in Risk (${accountBalance})</span>
                <span className={sizing.oversizedForAccount ? "text-[#f6465d]" : "text-[#e6e9ef]"}>
                  ${sizing.allInRiskPerContract.toFixed(2)} ({sizing.accountRiskPct}%)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6e7787]">Net Reward (after comm)</span>
                <span>
                  <span className="text-[#00c087]">{sizing.t1R.toFixed(1)}R</span>
                  <span className="text-[#586070]"> / </span>
                  <span className={sizing.t2BelowMin2R ? "text-[#d4a03a]" : "text-[#00c087] font-semibold"}>
                    {sizing.t2R.toFixed(1)}R
                  </span>
                </span>
              </div>
            </div>

            {/* Collapsible Guardrail Pill (Never pushes Buy button off-screen) */}
            {warnings.length > 0 ? (
              <div className="rounded border border-[#2d2618] bg-[#16140e]">
                <button
                  type="button"
                  onClick={() => setShowWarningsDetail((v) => !v)}
                  className="flex w-full items-center justify-between px-2.5 py-1.5 text-[10.5px]"
                >
                  <span
                    className={`flex items-center gap-1.5 font-medium ${
                      blocked ? "text-[#f6465d]" : "text-[#d4a03a]"
                    }`}
                  >
                    {blocked ? (
                      <ShieldAlert className="h-3.5 w-3.5" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5" />
                    )}
                    {warnings.length} guardrail {warnings.length === 1 ? "flag" : "flags"}:{" "}
                    {warnings[0].title.slice(0, 26)}
                  </span>
                  {showWarningsDetail ? (
                    <ChevronUp className="h-3.5 w-3.5 text-[#7d8594]" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-[#7d8594]" />
                  )}
                </button>
                {showWarningsDetail && (
                  <div className="border-t border-[#262115] px-2.5 py-2 space-y-1.5 text-[10px] text-[#b4bccb]">
                    {warnings.map((w) => (
                      <div key={w.id}>
                        <div className="font-semibold text-[#e6e9ef]">{w.title}</div>
                        <div className="text-[#8b94a5]">{w.detail}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-[10.5px] text-[#00c087]">
                <Check className="h-3.5 w-3.5" /> All Asia Value rules clean
              </div>
            )}

            {/* Primary Order CTA */}
            <button
              type="button"
              disabled={blocked || Boolean(openPosition) || currentPrice <= 0}
              onClick={handleSubmitOrder}
              className={`w-full rounded-md py-2.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                side === "long"
                  ? "bg-[#00c087] text-[#06140f] hover:bg-[#00d495]"
                  : "bg-[#f6465d] text-white hover:bg-[#ff566c]"
              }`}
            >
              {openPosition
                ? "Position Open"
                : blocked
                  ? "Blocked by Daily Limit"
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
              placeholder="Optional 1-line order flow note..."
              className="w-full rounded bg-[#151922] px-2.5 py-1.5 text-[11px] text-[#e6e9ef] placeholder:text-[#586070] border border-[#1f2532] focus:outline-none"
            />
          </>
        ) : (
          /* Checklist & Settings Tab */
          <>
            <div className="space-y-1.5">
              <div className="text-[10px] font-medium uppercase tracking-wider text-[#6e7787]">
                {model === "model1_reversal"
                  ? "Model 1: Reversal Steps"
                  : "Model 2: Continuation Steps"}
              </div>
              {stepsList.map((label, idx) => (
                <label
                  key={label}
                  className="flex cursor-pointer items-start gap-2 rounded bg-[#151922] px-2.5 py-2 text-[11px] text-[#c8cfdc] hover:bg-[#1a202c]"
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
                    className="mt-0.5 h-3.5 w-3.5 accent-[#00c087]"
                  />
                  <span className={checkedSteps[idx] ? "text-[#00c087]" : ""}>
                    {label}
                  </span>
                </label>
              ))}
            </div>

            <div className="space-y-2 border-t border-[#1c212b] pt-2.5">
              <div>
                <label className="text-[10px] text-[#6e7787]">Scenario #1-6</label>
                <select
                  value={scenario}
                  onChange={(e) => setScenario(Number(e.target.value) as ScenarioNumber)}
                  className="mt-1 w-full rounded bg-[#151922] px-2 py-1.5 text-[11px] text-[#e6e9ef] border border-[#1f2532]"
                >
                  {([1, 2, 3, 4, 5, 6] as ScenarioNumber[]).map((n) => (
                    <option key={n} value={n}>
                      {SCENARIO_META[n].shortTitle}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-[#6e7787]">Setup Tag</label>
                <select
                  value={setupTag}
                  onChange={(e) => setSetupTag(e.target.value as SetupTag)}
                  className="mt-1 w-full rounded bg-[#151922] px-2 py-1.5 text-[11px] text-[#e6e9ef] border border-[#1f2532]"
                >
                  <option value="fade_vah_val">Fade VAH / VAL</option>
                  <option value="pd_poc_bounce">PD POC / Stacked Bounce</option>
                  <option value="hvn_reversal">HVN Reversal</option>
                  <option value="lvn_continuation">LVN Continuation</option>
                  <option value="trapped_participant">Trapped Participant</option>
                  <option value="failed_auction">Failed Auction + Reclaim</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-[#6e7787]">Account ($)</label>
                  <input
                    type="number"
                    value={accountBalance}
                    onChange={(e) =>
                      onAccountBalanceChange(Math.max(50, Number(e.target.value) || 300))
                    }
                    className="mt-1 w-full rounded bg-[#151922] px-2 py-1.5 font-mono-num text-[11px] text-[#e6e9ef] border border-[#1f2532]"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[#6e7787]">Risk %</label>
                  <input
                    type="number"
                    step="0.5"
                    value={riskPercent}
                    onChange={(e) =>
                      setRiskPercent(Math.max(0.25, Number(e.target.value) || 2))
                    }
                    className="mt-1 w-full rounded bg-[#151922] px-2 py-1.5 font-mono-num text-[11px] text-[#e6e9ef] border border-[#1f2532]"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] text-[#6e7787]">
                <span>Default Stop Dist</span>
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
                      className={`rounded px-1.5 py-0.5 font-mono-num ${
                        stopOffsetPts === d
                          ? "bg-[#242c3c] text-[#e6e9ef]"
                          : "bg-[#151922] text-[#6e7787]"
                      }`}
                    >
                      {d}pt
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Log Disciplined No-Trade Skip */}
            <div className="border-t border-[#1c212b] pt-2.5">
              <div className="text-[10px] font-medium uppercase tracking-wider text-[#6e7787]">
                Log Disciplined No-Trade
              </div>
              <div className="mt-1.5 flex gap-1.5">
                <input
                  type="text"
                  value={skipNote}
                  onChange={(e) => setSkipNote(e.target.value)}
                  placeholder="Why skipped?"
                  className="min-w-0 flex-1 rounded bg-[#151922] px-2 py-1.5 text-[11px] text-[#e6e9ef] placeholder:text-[#586070] border border-[#1f2532]"
                />
                <button
                  type="button"
                  onClick={() => {
                    onLogSkippedTouch({
                      scenario,
                      note:
                        skipNote.trim() ||
                        `No-Trade at ${activeZone?.label ?? "level"} (unclear)`,
                    });
                    setSkipNote("");
                  }}
                  className="shrink-0 rounded bg-[#222836] px-2.5 py-1.5 text-[11px] font-medium text-[#e6e9ef] hover:bg-[#2d3548]"
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
