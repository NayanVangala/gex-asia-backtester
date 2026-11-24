"use client";

import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Candle,
  ContractType,
  EntryTiming,
  FootprintBar,
  KeyLevelZone,
  OrderSide,
  PremarketPlan,
  SCENARIO_META,
  ScenarioNumber,
  SetupTag,
  SimPosition,
  VolumeProfileResult,
} from "@/lib/types";
import {
  calculatePositionSizing,
  evaluateAcceptanceRejection,
  evaluateEntryGuardrails,
} from "@/lib/goldMath";

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
  accountBalance: number;
  onAccountBalanceChange: (v: number) => void;
  onOpenPosition: (pos: SimPosition) => void;
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
}

const MODEL1_STEPS = [
  "Price reached planned key zone (location first)",
  "No acceptance beyond (reclaimed within 1-2 M5 bars)",
  "Absorption + trapped traders visible at extreme",
  "Aggression flipped (delta + imbalances + CVD)",
  "First valid pullback toward absorption zone holds",
];

const MODEL2_STEPS = [
  "Level broke cleanly (did NOT chase breakout candle)",
  "Acceptance confirmed (6+ M5 bars / 30+ min beyond)",
  "Price pulled back to retest old level from other side",
  "Absorption on retest + aggression back in trend",
  "Retest rejected and held (entry on hold, stop behind)",
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
  accountBalance,
  onAccountBalanceChange,
  onOpenPosition,
  onClosePosition,
  onMoveStopToBE,
  onLogSkippedTouch,
}: ExecutionSidebarProps) {
  const [model, setModel] = useState<"model1_reversal" | "model2_continuation">(
    "model1_reversal"
  );
  const [side, setSide] = useState<OrderSide>("long");
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

  const absorptionExtremeGC = useMemo(() => {
    if (customStop.trim() !== "" && !Number.isNaN(Number(customStop))) {
      return Number(customStop);
    }
    return side === "long"
      ? currentPrice - stopOffsetPts
      : currentPrice + stopOffsetPts;
  }, [customStop, side, currentPrice, stopOffsetPts]);

  const t1PriceGC = useMemo(() => {
    if (customT1.trim() !== "" && !Number.isNaN(Number(customT1))) {
      return Number(customT1);
    }
    return side === "long"
      ? currentPrice + t1OffsetPts
      : currentPrice - t1OffsetPts;
  }, [customT1, side, currentPrice, t1OffsetPts]);

  const t2PriceGC = useMemo(() => {
    if (customT2.trim() !== "" && !Number.isNaN(Number(customT2))) {
      return Number(customT2);
    }
    return side === "long"
      ? currentPrice + t2OffsetPts
      : currentPrice - t2OffsetPts;
  }, [customT2, side, currentPrice, t2OffsetPts]);

  const sizing = useMemo(
    () =>
      calculatePositionSizing({
        accountBalance,
        riskPercent,
        contract,
        side,
        entryPriceGC: currentPrice,
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
      currentPrice,
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
    const candidates: number[] = [];
    if (developingProfile) {
      candidates.push(
        developingProfile.poc,
        developingProfile.vah,
        developingProfile.val
      );
    }
    if (previousDayProfile) {
      candidates.push(
        previousDayProfile.poc,
        previousDayProfile.vah,
        previousDayProfile.val
      );
    }
    const filtered = candidates
      .filter((p) =>
        side === "long" ? p > currentPrice + 1.5 : p < currentPrice - 1.5
      )
      .sort((a, b) => (side === "long" ? a - b : b - a));

    if (filtered[0]) setCustomT1(filtered[0].toFixed(2));
    if (filtered[1]) setCustomT2(filtered[1].toFixed(2));
    if (activeZone) {
      setCustomStop(
        (side === "long" ? activeZone.low : activeZone.high).toFixed(2)
      );
    }
  };

  const handleSubmitOrder = () => {
    if (blocked || openPosition || currentPrice <= 0) return;
    const pos: SimPosition = {
      id: `pos-${Date.now()}`,
      side,
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
      contracts: contract === "1OZ" && accountBalance <= 400 ? 1 : sizing.recommendedContracts,
      riskDollars: sizing.allInRiskPerContract,
      commissionDollars:
        contract === "1OZ" ? 1.5 : contract === "MGC" ? 1.7 : 4.5,
      openedAtTs: replayTs,
      status: "open",
      entryTiming,
      warnings,
      zoneId: activeZone?.id,
      note:
        note.trim() ||
        `${model === "model1_reversal" ? "M1 Reversal" : "M2 Continuation"} ${side} at ${activeZone?.label ?? "chart level"}`,
    };
    onOpenPosition(pos);
    setNote("");
  };

  // Compute live unrealized P&L for open position
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
    const gross = pts * ptVal * openPosition.contracts;
    const net = gross - openPosition.commissionDollars;
    const r =
      openPosition.riskDollars > 0 ? net / openPosition.riskDollars : 0;
    return { pts, net, r };
  }, [openPosition, currentPrice]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[#1c2436] bg-[#0c1018] p-3 text-xs">
      {/* 1. Active Zone & Live Acceptance vs Rejection Evaluator */}
      <div className="rounded-lg border border-[#1c2436] bg-[#090d14] p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Active Zone &amp; Section 3 Meter
          </span>
          <select
            value={activeZone?.id ?? ""}
            onChange={(e) => onSelectZone(e.target.value)}
            className="max-w-[175px] truncate rounded border border-[#26324a] bg-[#0f1623] px-1.5 py-0.5 text-[11px] text-slate-200"
          >
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.label} ({z.low.toFixed(1)}-{z.high.toFixed(1)})
              </option>
            ))}
          </select>
        </div>

        {acceptanceRead && (
          <div className="mt-2">
            <div className="flex items-center justify-between">
              <span
                className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                  acceptanceRead.status === "rejection"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                    : acceptanceRead.status === "acceptance"
                      ? "bg-sky-500/20 text-sky-300 border border-sky-500/40"
                      : acceptanceRead.status === "unclear"
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                        : "bg-slate-800 text-slate-400"
                }`}
              >
                {acceptanceRead.status === "rejection"
                  ? "Rejection -> Model 1"
                  : acceptanceRead.status === "acceptance"
                    ? "Acceptance -> Model 2"
                    : acceptanceRead.status === "unclear"
                      ? "Unclear -> No Trade"
                      : "Waiting for Touch"}
              </span>
              <span className="font-mono-num text-[10px] text-slate-400">
                {acceptanceRead.barsBeyondCount} M5 ({acceptanceRead.minutesBeyond}m) ·{" "}
                {acceptanceRead.closesBeyondCount} closes
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
              {acceptanceRead.summary}
            </p>
          </div>
        )}
      </div>

      {/* 2. Open Position Manager (when in a trade) */}
      {openPosition && openStats && (
        <div className="rounded-lg border border-sky-500/40 bg-sky-500/5 p-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sky-300">
              OPEN {openPosition.side.toUpperCase()} {openPosition.contracts}×{" "}
              {openPosition.contract}
            </span>
            <span
              className={`font-mono-num text-sm font-bold ${
                openStats.net >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {openStats.net >= 0 ? "+" : ""}${openStats.net.toFixed(2)} (
              {openStats.r >= 0 ? "+" : ""}
              {openStats.r.toFixed(2)}R)
            </span>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1 font-mono-num text-[10px] text-slate-300">
            <div className="rounded bg-[#090d14] p-1.5">
              <div className="text-slate-500">ENTRY</div>
              <div>{openPosition.entryPriceExec.toFixed(2)}</div>
            </div>
            <div className="rounded bg-[#090d14] p-1.5">
              <div className="text-rose-400">STOP</div>
              <div>{openPosition.stopPriceExec.toFixed(2)}</div>
            </div>
            <div className="rounded bg-[#090d14] p-1.5">
              <div className="text-emerald-400">T1</div>
              <div>{openPosition.t1PriceExec.toFixed(2)}</div>
            </div>
            <div className="rounded bg-[#090d14] p-1.5">
              <div className="text-emerald-300">T2</div>
              <div>{openPosition.t2PriceExec.toFixed(2)}</div>
            </div>
          </div>
          <div className="mt-2.5 grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => onMoveStopToBE(openPosition.id)}
              disabled={openPosition.movedToBreakeven}
              className="rounded border border-amber-500/40 bg-amber-500/10 py-1 text-[10px] font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-40"
            >
              {openPosition.movedToBreakeven ? "Stop @ BE" : "Move Stop BE"}
            </button>
            <button
              type="button"
              onClick={() =>
                onClosePosition(openPosition.id, currentPrice, "invalidation")
              }
              className="rounded border border-rose-500/40 bg-rose-500/10 py-1 text-[10px] font-medium text-rose-300 hover:bg-rose-500/20"
            >
              Invalidation Exit
            </button>
            <button
              type="button"
              onClick={() =>
                onClosePosition(openPosition.id, currentPrice, "manual")
              }
              className="rounded bg-slate-700 py-1 text-[10px] font-semibold text-white hover:bg-slate-600"
            >
              Flatten Now
            </button>
          </div>
        </div>
      )}

      {/* 3. Model Selector & Stepper Checklist */}
      <div>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => {
              setModel("model1_reversal");
              setCheckedSteps({});
            }}
            className={`rounded py-1.5 text-[11px] font-semibold border transition ${
              model === "model1_reversal"
                ? "bg-emerald-500/20 border-emerald-500/60 text-emerald-300"
                : "bg-[#090d14] border-[#1c2436] text-slate-400"
            }`}
          >
            Model 1: Reversal
          </button>
          <button
            type="button"
            onClick={() => {
              setModel("model2_continuation");
              setCheckedSteps({});
            }}
            className={`rounded py-1.5 text-[11px] font-semibold border transition ${
              model === "model2_continuation"
                ? "bg-sky-500/20 border-sky-500/60 text-sky-300"
                : "bg-[#090d14] border-[#1c2436] text-slate-400"
            }`}
          >
            Model 2: Continuation
          </button>
        </div>

        <div className="mt-2 space-y-1 rounded border border-[#1c2436] bg-[#090d14] p-2">
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span className="font-semibold uppercase tracking-wider">
              Confirmation Steps
            </span>
            <span className="font-mono-num text-slate-300">
              {checkedCount}/{stepsList.length}
            </span>
          </div>
          {stepsList.map((label, idx) => (
            <label
              key={label}
              className="flex cursor-pointer items-start gap-2 text-[11px] text-slate-300 hover:text-slate-100"
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
                className="mt-0.5 h-3.5 w-3.5 rounded accent-emerald-500"
              />
              <span className={checkedSteps[idx] ? "text-emerald-300" : ""}>
                {label}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* 4. Order Ticket + 1OZ Sizing Calculator */}
      <div className="space-y-2 rounded border border-[#1c2436] bg-[#090d14] p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Order Ticket &amp; 1OZ Sizing
          </span>
          <button
            type="button"
            onClick={snapTargetsFromProfile}
            className="flex items-center gap-1 rounded bg-[#141c2c] px-1.5 py-0.5 text-[10px] text-sky-300 hover:bg-[#1d2a42]"
          >
            <Target className="h-3 w-3" /> Snap Levels
          </button>
        </div>

        {/* Direction + Contract */}
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => setSide("long")}
            className={`flex items-center justify-center gap-1 rounded py-1.5 font-semibold border ${
              side === "long"
                ? "bg-emerald-600/25 border-emerald-500 text-emerald-300"
                : "bg-[#0d121d] border-[#1c2436] text-slate-400"
            }`}
          >
            <TrendingUp className="h-3.5 w-3.5" /> LONG
          </button>
          <button
            type="button"
            onClick={() => setSide("short")}
            className={`flex items-center justify-center gap-1 rounded py-1.5 font-semibold border ${
              side === "short"
                ? "bg-rose-600/25 border-rose-500 text-rose-300"
                : "bg-[#0d121d] border-[#1c2436] text-slate-400"
            }`}
          >
            <TrendingDown className="h-3.5 w-3.5" /> SHORT
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <div>
            <label className="text-[10px] text-slate-500">Contract</label>
            <select
              value={contract}
              onChange={(e) => setContract(e.target.value as ContractType)}
              className="mt-0.5 w-full rounded border border-[#1c2436] bg-[#0d121d] px-1.5 py-1 font-mono-num text-[11px] text-slate-200"
            >
              <option value="1OZ">1OZ ($1/pt)</option>
              <option value="MGC">MGC ($10/pt)</option>
              <option value="GC">GC ($100/pt)</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-slate-500">Account ($)</label>
            <input
              type="number"
              value={accountBalance}
              onChange={(e) =>
                onAccountBalanceChange(Math.max(50, Number(e.target.value) || 300))
              }
              className="mt-0.5 w-full rounded border border-[#1c2436] bg-[#0d121d] px-1.5 py-1 font-mono-num text-[11px] text-slate-200"
            />
          </div>
          <div>
            <label className="text-[10px] text-slate-500">Risk %</label>
            <input
              type="number"
              step="0.5"
              value={riskPercent}
              onChange={(e) =>
                setRiskPercent(Math.max(0.25, Number(e.target.value) || 2))
              }
              className="mt-0.5 w-full rounded border border-[#1c2436] bg-[#0d121d] px-1.5 py-1 font-mono-num text-[11px] text-slate-200"
            />
          </div>
        </div>

        {/* Scenario + Entry Timing (honesty check for early-entry leak) */}
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className="text-[10px] text-slate-500">Scenario #1-6</label>
            <select
              value={scenario}
              onChange={(e) =>
                setScenario(Number(e.target.value) as ScenarioNumber)
              }
              className="mt-0.5 w-full rounded border border-[#1c2436] bg-[#0d121d] px-1.5 py-1 text-[11px] text-slate-200"
            >
              {([1, 2, 3, 4, 5, 6] as ScenarioNumber[]).map((n) => (
                <option key={n} value={n}>
                  {SCENARIO_META[n].shortTitle}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-slate-500">Entry Timing</label>
            <select
              value={entryTiming}
              onChange={(e) => setEntryTiming(e.target.value as EntryTiming)}
              className="mt-0.5 w-full rounded border border-[#1c2436] bg-[#0d121d] px-1.5 py-1 text-[11px] text-slate-200"
            >
              <option value="first_valid_pullback">First Valid Pullback (Rule)</option>
              <option value="first_touch">First Touch (Leak!)</option>
              <option value="early">Early Before Hold</option>
              <option value="late_chase">Late Chase</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-[10px] text-slate-500">Setup Tag</label>
          <select
            value={setupTag}
            onChange={(e) => setSetupTag(e.target.value as SetupTag)}
            className="mt-0.5 w-full rounded border border-[#1c2436] bg-[#0d121d] px-1.5 py-1 text-[11px] text-slate-200"
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

        {/* Stop / T1 / T2 numeric inputs */}
        <div className="grid grid-cols-3 gap-1.5 font-mono-num">
          <div>
            <label className="text-[10px] text-rose-400">Abs. Extreme</label>
            <input
              type="number"
              step="0.1"
              placeholder={absorptionExtremeGC.toFixed(1)}
              value={customStop}
              onChange={(e) => setCustomStop(e.target.value)}
              className="mt-0.5 w-full rounded border border-[#1c2436] bg-[#0d121d] px-1.5 py-1 text-[11px] text-slate-100"
            />
          </div>
          <div>
            <label className="text-[10px] text-emerald-400">T1 (vPOC)</label>
            <input
              type="number"
              step="0.25"
              placeholder={t1PriceGC.toFixed(1)}
              value={customT1}
              onChange={(e) => setCustomT1(e.target.value)}
              className="mt-0.5 w-full rounded border border-[#1c2436] bg-[#0d121d] px-1.5 py-1 text-[11px] text-slate-100"
            />
          </div>
          <div>
            <label className="text-[10px] text-emerald-300">T2 (2R+)</label>
            <input
              type="number"
              step="0.25"
              placeholder={t2PriceGC.toFixed(1)}
              value={customT2}
              onChange={(e) => setCustomT2(e.target.value)}
              className="mt-0.5 w-full rounded border border-[#1c2436] bg-[#0d121d] px-1.5 py-1 text-[11px] text-slate-100"
            />
          </div>
        </div>

        {/* Quick Stop/T1/T2 Offset Presets when custom blank */}
        {!customStop && (
          <div className="flex items-center justify-between text-[10px] text-slate-500">
            <span>Quick Stop Dist:</span>
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
                      ? "bg-sky-500/20 text-sky-300"
                      : "bg-[#121926] text-slate-400"
                  }`}
                >
                  {d}pt
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Computed 1OZ Rounded Readout */}
        <div className="rounded bg-[#0d1320] p-2 font-mono-num text-[10px] space-y-1 border border-[#1c2436]">
          <div className="flex justify-between">
            <span className="text-slate-400">
              {contract} Entry / Stop (outward):
            </span>
            <span className="text-slate-100">
              {sizing.entryExec.toFixed(2)} /{" "}
              <span className="text-rose-400">{sizing.stopExec.toFixed(2)}</span>
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Stop Dist / All-in Risk:</span>
            <span className="text-slate-100">
              {sizing.stopDistancePts.toFixed(2)}pt · $
              {sizing.allInRiskPerContract.toFixed(2)} ({sizing.accountRiskPct}%)
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Net R (after comm):</span>
            <span>
              <span className="text-emerald-400">T1 {sizing.t1R.toFixed(2)}R</span>{" "}
              ·{" "}
              <span
                className={
                  sizing.t2BelowMin2R ? "text-amber-400 font-bold" : "text-emerald-300 font-bold"
                }
              >
                T2 {sizing.t2R.toFixed(2)}R
              </span>
            </span>
          </div>
        </div>

        {/* One-line Trade Note */}
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="1-line order flow read before clicking..."
          className="w-full rounded border border-[#1c2436] bg-[#0d121d] px-2 py-1 text-[11px] text-slate-100 placeholder:text-slate-600"
        />

        {/* Guardrail Warnings (Early-Entry Leak & Session Rules) */}
        {warnings.length > 0 ? (
          <div className="space-y-1">
            {warnings.map((w) => (
              <div
                key={w.id}
                className={`flex items-start gap-1.5 rounded border px-2 py-1.5 text-[10px] leading-snug ${
                  w.severity === "block"
                    ? "border-rose-500/60 bg-rose-500/15 text-rose-200"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-200"
                }`}
              >
                {w.severity === "block" ? (
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                )}
                <div>
                  <div className="font-semibold">{w.title}</div>
                  <div className="text-slate-300/80">{w.detail}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[10px] text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            All Asia Value Model guardrails clean.
          </div>
        )}

        <button
          type="button"
          disabled={blocked || Boolean(openPosition) || currentPrice <= 0}
          onClick={handleSubmitOrder}
          className={`w-full rounded py-2 text-xs font-bold tracking-wide text-white transition disabled:cursor-not-allowed disabled:opacity-40 ${
            side === "long"
              ? "bg-emerald-600 hover:bg-emerald-500"
              : "bg-rose-600 hover:bg-rose-500"
          }`}
        >
          {openPosition
            ? "Position Already Open"
            : blocked
              ? "Blocked by Daily Session Rule"
              : `Place Sim ${side.toUpperCase()} (${
                  contract === "1OZ" && accountBalance <= 400
                    ? 1
                    : sizing.recommendedContracts
                }× ${contract} @ ${sizing.entryExec.toFixed(2)})`}
        </button>
      </div>

      {/* 5. Log Disciplined No-Trade / Skipped Touch */}
      <div className="rounded border border-[#1c2436] bg-[#090d14] p-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Unclear Read? Log Disciplined No-Trade
        </div>
        <div className="mt-1.5 flex gap-1.5">
          <input
            type="text"
            value={skipNote}
            onChange={(e) => setSkipNote(e.target.value)}
            placeholder="Why skipped (e.g. unclear 3 bars, no flip)"
            className="min-w-0 flex-1 rounded border border-[#1c2436] bg-[#0d121d] px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-600"
          />
          <button
            type="button"
            onClick={() => {
              onLogSkippedTouch({
                scenario,
                note:
                  skipNote.trim() ||
                  `Disciplined No-Trade at ${activeZone?.label ?? "level"} (unclear confirmation)`,
              });
              setSkipNote("");
            }}
            className="shrink-0 rounded border border-slate-600 bg-[#151d2e] px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-[#1e2940]"
          >
            Log Skip
          </button>
        </div>
      </div>
    </div>
  );
}
