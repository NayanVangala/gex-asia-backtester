"use client";

import React, { useState } from "react";
import { Award, CheckCircle2, Crosshair, XCircle } from "lucide-react";
import {
  DrillCall,
  KeyLevelZone,
  ModelType,
  SCENARIO_META,
  ScenarioNumber,
} from "@/lib/types";
import { formatPTTime } from "@/lib/goldMath";

interface DrillModeCardProps {
  activeZone: KeyLevelZone | null;
  replayTs: number;
  drillCalls: DrillCall[];
  onLockCall: (call: DrillCall) => void;
  onStep6Bars: () => void;
}

export function DrillModeCard({
  activeZone,
  replayTs,
  drillCalls,
  onLockCall,
  onStep6Bars,
}: DrillModeCardProps) {
  const [predictedCall, setPredictedCall] = useState<ModelType>("model1_reversal");
  const [scenario, setScenario] = useState<ScenarioNumber>(5);
  const [reason, setReason] = useState("");

  const gradedCalls = drillCalls.filter((c) => c.graded);
  const correctCount = gradedCalls.filter((c) => c.graded?.correct).length;
  const latestCall = drillCalls[0] ?? null;

  const handleLock = () => {
    if (!activeZone) return;
    onLockCall({
      id: `drill-${Date.now()}`,
      calledAtTs: replayTs,
      zoneId: activeZone.id,
      zoneLabel: activeZone.label,
      zoneLow: activeZone.low,
      zoneHigh: activeZone.high,
      predictedCall,
      scenario,
      reason:
        reason.trim() ||
        `Called ${predictedCall.replace(/_/g, " ")} at ${activeZone.label}`,
    });
    setReason("");
  };

  return (
    <div className="rounded-lg border border-amber-500/40 bg-[#0f131f] p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1f2940] pb-2">
        <div className="flex items-center gap-2">
          <Crosshair className="h-4 w-4 text-amber-400" />
          <span className="font-semibold text-amber-200">
            Blind Level-Touch Drill Mode
          </span>
          <span className="text-[11px] text-slate-400">
            Commit your read BEFORE stepping +30m (6 M5 bars) to grade acceptance vs rejection.
          </span>
        </div>
        <div className="flex items-center gap-1.5 font-mono-num text-[11px]">
          <Award className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-slate-300">
            Drill Score:{" "}
            <strong className="text-emerald-400">
              {correctCount}/{gradedCalls.length}
            </strong>
          </span>
        </div>
      </div>

      <div className="mt-2.5 grid grid-cols-1 gap-2 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <label className="text-[10px] uppercase tracking-wider text-slate-400">
            Your Call at {activeZone ? activeZone.label : "Selected Zone"}
          </label>
          <div className="mt-1 grid grid-cols-3 gap-1">
            {(
              [
                { id: "model1_reversal", label: "M1 Rev", active: "bg-emerald-500/20 border-emerald-500 text-emerald-300" },
                { id: "model2_continuation", label: "M2 Cont", active: "bg-sky-500/20 border-sky-500 text-sky-300" },
                { id: "no_trade", label: "No Trade", active: "bg-amber-500/20 border-amber-500 text-amber-300" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPredictedCall(opt.id)}
                className={`rounded border py-1 text-[11px] font-semibold ${
                  predictedCall === opt.id
                    ? opt.active
                    : "border-[#222d44] bg-[#090d14] text-slate-400"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-3">
          <label className="text-[10px] uppercase tracking-wider text-slate-400">
            Scenario #1-6
          </label>
          <select
            value={scenario}
            onChange={(e) => setScenario(Number(e.target.value) as ScenarioNumber)}
            className="mt-1 w-full rounded border border-[#222d44] bg-[#090d14] px-2 py-1 text-[11px] text-slate-200"
          >
            {([1, 2, 3, 4, 5, 6] as ScenarioNumber[]).map((n) => (
              <option key={n} value={n}>
                {SCENARIO_META[n].shortTitle}
              </option>
            ))}
          </select>
        </div>

        <div className="lg:col-span-3">
          <label className="text-[10px] uppercase tracking-wider text-slate-400">
            What confirms or kills it?
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Need absorption + reclaim inside"
            className="mt-1 w-full rounded border border-[#222d44] bg-[#090d14] px-2 py-1 text-[11px] text-slate-100 placeholder:text-slate-600"
          />
        </div>

        <div className="flex items-end gap-1.5 lg:col-span-2">
          <button
            type="button"
            disabled={!activeZone}
            onClick={handleLock}
            className="flex-1 rounded bg-amber-600 py-1.5 text-[11px] font-bold text-white hover:bg-amber-500 disabled:opacity-40"
          >
            Lock Call
          </button>
          <button
            type="button"
            onClick={onStep6Bars}
            className="rounded border border-sky-500/40 bg-sky-500/15 px-2 py-1.5 text-[11px] font-semibold text-sky-300 hover:bg-sky-500/25"
            title="Reveal +30 min (6 M5 bars) to grade call"
          >
            +30m
          </button>
        </div>
      </div>

      {/* Latest Drill Call Status / Verdict */}
      {latestCall && (
        <div
          className={`mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded border px-2.5 py-1.5 text-[11px] ${
            !latestCall.graded
              ? "border-sky-500/30 bg-sky-500/10 text-sky-200"
              : latestCall.graded.correct
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                : "border-rose-500/40 bg-rose-500/10 text-rose-200"
          }`}
        >
          <div className="flex items-center gap-2">
            {!latestCall.graded ? (
              <span className="font-mono-num text-[10px] uppercase text-sky-300">
                PENDING GRADE
              </span>
            ) : latestCall.graded.correct ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 text-rose-400 shrink-0" />
            )}
            <span>
              <strong>{latestCall.zoneLabel}</strong> ({formatPTTime(latestCall.calledAtTs)} PT):{" "}
              {latestCall.graded
                ? latestCall.graded.summary
                : `Locked ${latestCall.predictedCall.replace(/_/g, " ")}. Step +6 M5 bars (+30m) to grade against real Section 3 outcome.`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
