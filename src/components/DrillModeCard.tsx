"use client";

import React, { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
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
      reason: reason.trim() || `Called ${predictedCall} at ${activeZone.label}`,
    });
    setReason("");
  };

  return (
    <div className="border-b border-[#2A2E39] bg-[#1A2333] px-3 py-1.5 text-[11px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-[#FFFF00]">Drill Mode</span>
          <div className="flex items-center rounded-xs bg-[#111620] p-0.5 text-[10px] border border-[#2A2E39]">
            {(
              [
                { id: "model1_reversal", label: "M1 Rev" },
                { id: "model2_continuation", label: "M2 Cont" },
                { id: "no_trade", label: "No Trade" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPredictedCall(opt.id)}
                className={`rounded-xs px-2 py-0.5 ${
                  predictedCall === opt.id
                    ? "bg-[#2962FF] text-white font-medium"
                    : "text-[#ABAEB8]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <select
            value={scenario}
            onChange={(e) => setScenario(Number(e.target.value) as ScenarioNumber)}
            className="rounded-xs bg-[#111620] px-1.5 py-0.5 text-[10.5px] text-[#F1F1F1] border border-[#2A2E39]"
          >
            {([1, 2, 3, 4, 5, 6] as ScenarioNumber[]).map((n) => (
              <option key={n} value={n}>{SCENARIO_META[n].shortTitle}</option>
            ))}
          </select>

          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Hypothesis..."
            className="w-36 rounded-xs bg-[#111620] px-2 py-0.5 text-[10.5px] text-[#F1F1F1] border border-[#2A2E39]"
          />

          <button
            type="button"
            disabled={!activeZone}
            onClick={handleLock}
            className="rounded-xs bg-[#2962FF] px-2.5 py-0.5 text-[10.5px] font-semibold text-white hover:bg-[#3a70ff] disabled:opacity-40"
          >
            Lock Call
          </button>
          <button
            type="button"
            onClick={onStep6Bars}
            className="rounded-xs bg-[#2A2E39] px-2 py-0.5 font-mono-num text-[10.5px] text-[#F1F1F1]"
          >
            +30m
          </button>
        </div>

        <div className="flex items-center gap-3 font-mono-num text-[10.5px]">
          {latestCall && (
            <span className="flex items-center gap-1">
              {!latestCall.graded ? (
                <span className="text-[#3BEFF0]">
                  PENDING ({formatPTTime(latestCall.calledAtTs)})
                </span>
              ) : latestCall.graded.correct ? (
                <span className="flex items-center gap-1 text-[#089981]">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {latestCall.graded.actualStatus.toUpperCase()}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[#F2385A]">
                  <XCircle className="h-3.5 w-3.5" /> Actual: {latestCall.graded.actualStatus.toUpperCase()}
                </span>
              )}
            </span>
          )}
          <span className="text-[#ABAEB8]">
            Score: <strong className="text-white">{correctCount}/{gradedCalls.length}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}
