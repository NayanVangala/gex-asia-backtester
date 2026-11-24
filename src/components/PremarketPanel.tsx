"use client";

import React from "react";
import {
  BiasDirection,
  KeyLevelZone,
  PremarketPlan,
  VolumeProfileResult,
} from "@/lib/types";
import { Pin, Plus, Trash2 } from "lucide-react";

interface PremarketPanelProps {
  plan: PremarketPlan;
  onChangePlan: (next: PremarketPlan) => void;
  profiles: {
    previousDay: VolumeProfileResult | null;
    previousWeek: VolumeProfileResult | null;
    composite5d: VolumeProfileResult | null;
    developing: VolumeProfileResult | null;
  };
  zones: KeyLevelZone[];
  activeZoneId: string | null;
  onSelectZone: (id: string) => void;
  onTogglePinZone: (id: string) => void;
  onDeleteZone: (id: string) => void;
  drawZoneMode: boolean;
  onToggleDrawZone: () => void;
  onJumpToReplay: () => void;
}

export function PremarketPanel({
  plan,
  onChangePlan,
  profiles,
  zones,
  activeZoneId,
  onSelectZone,
  onTogglePinZone,
  onDeleteZone,
  drawZoneMode,
  onToggleDrawZone,
  onJumpToReplay,
}: PremarketPanelProps) {
  const setField = <K extends keyof PremarketPlan>(k: K, v: PremarketPlan[K]) =>
    onChangePlan({ ...plan, [k]: v });

  return (
    <div className="flex h-full flex-col bg-[#0f1217] text-xs">
      <div className="flex items-center justify-between border-b border-[#1c212b] px-4 py-3">
        <div>
          <h2 className="text-xs font-semibold text-[#e6e9ef]">
            Premarket Plan (Tokyo 16:00 PT)
          </h2>
          <p className="text-[10.5px] text-[#6e7787]">
            Auto-saved per session date
          </p>
        </div>
        <button
          type="button"
          onClick={onJumpToReplay}
          className="rounded bg-[#e6e9ef] px-3 py-1.5 text-[11px] font-semibold text-[#0b0d11] hover:bg-white"
        >
          Open Replay
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Reference Levels Grid */}
        <div className="grid grid-cols-3 gap-2 font-mono-num">
          {[
            { label: "Prev Day (PD)", prof: profiles.previousDay },
            { label: "Prev Week (PW)", prof: profiles.previousWeek },
            { label: "5D Composite", prof: profiles.composite5d },
          ].map(({ label, prof }) => (
            <div
              key={label}
              className="rounded border border-[#1c212b] bg-[#0b0d11] p-2.5"
            >
              <div className="text-[10px] font-medium text-[#8b94a5]">{label}</div>
              {prof ? (
                <div className="mt-1.5 space-y-0.5 text-[11px]">
                  <div className="flex justify-between text-[#8b94a5]">
                    <span>VAH</span>
                    <span className="text-[#e6e9ef]">{prof.vah.toFixed(1)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#d4a03a]">POC</span>
                    <span className="font-semibold text-[#eab854]">
                      {prof.poc.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex justify-between text-[#8b94a5]">
                    <span>VAL</span>
                    <span className="text-[#e6e9ef]">{prof.val.toFixed(1)}</span>
                  </div>
                </div>
              ) : (
                <div className="mt-1.5 text-[10px] text-[#586070]">Need history</div>
              )}
            </div>
          ))}
        </div>

        {/* Bias Selector */}
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-wider text-[#6e7787]">
            Session Bias
          </label>
          <div className="grid grid-cols-3 rounded bg-[#151922] p-0.5">
            {(["bullish", "balanced", "bearish"] as BiasDirection[]).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setField("bias", b)}
                className={`rounded py-1 text-[11px] font-medium capitalize transition ${
                  plan.bias === b
                    ? b === "bullish"
                      ? "bg-[#00c087] text-[#06140f]"
                      : b === "bearish"
                        ? "bg-[#f6465d] text-white"
                        : "bg-[#262d3b] text-[#e6e9ef]"
                    : "text-[#7d8594]"
                }`}
              >
                {b}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <select
              value={plan.priceVsWeeklyValue}
              onChange={(e) =>
                setField(
                  "priceVsWeeklyValue",
                  e.target.value as PremarketPlan["priceVsWeeklyValue"]
                )
              }
              className="rounded border border-[#1f2532] bg-[#151922] px-2 py-1.5 text-[11px] text-[#e6e9ef]"
            >
              <option value="above">Above PW Value</option>
              <option value="inside">Inside PW Value</option>
              <option value="below">Below PW Value</option>
            </select>
            <select
              value={plan.priceVsDailyValue}
              onChange={(e) =>
                setField(
                  "priceVsDailyValue",
                  e.target.value as PremarketPlan["priceVsDailyValue"]
                )
              }
              className="rounded border border-[#1f2532] bg-[#151922] px-2 py-1.5 text-[11px] text-[#e6e9ef]"
            >
              <option value="inside">Inside PD Value</option>
              <option value="above">Above PD Value</option>
              <option value="below">Below PD Value</option>
            </select>
          </div>
        </div>

        {/* Bias Reason & No-Trade Zone */}
        <div className="space-y-2">
          <input
            type="text"
            value={plan.biasReason}
            onChange={(e) => setField("biasReason", e.target.value)}
            placeholder="Bias reason (e.g. above PW VAH, balancing below PD VAH)"
            className="w-full rounded border border-[#1f2532] bg-[#151922] px-2.5 py-1.5 text-[11px] text-[#e6e9ef] placeholder:text-[#586070]"
          />
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.25"
              value={plan.noTradeZoneLow ?? ""}
              onChange={(e) =>
                setField("noTradeZoneLow", e.target.value ? Number(e.target.value) : null)
              }
              placeholder="No-Trade Low"
              className="w-full rounded border border-[#1f2532] bg-[#151922] px-2.5 py-1.5 font-mono-num text-[11px] text-[#e6e9ef] placeholder:text-[#586070]"
            />
            <span className="text-[#586070]">-</span>
            <input
              type="number"
              step="0.25"
              value={plan.noTradeZoneHigh ?? ""}
              onChange={(e) =>
                setField("noTradeZoneHigh", e.target.value ? Number(e.target.value) : null)
              }
              placeholder="No-Trade High"
              className="w-full rounded border border-[#1f2532] bg-[#151922] px-2.5 py-1.5 font-mono-num text-[11px] text-[#e6e9ef] placeholder:text-[#586070]"
            />
          </div>
          <textarea
            rows={2}
            value={plan.nightRule}
            onChange={(e) => setField("nightRule", e.target.value)}
            placeholder="Tonight's IF/THEN rule (rejection -> M1; 6 M5 acceptance -> M2)"
            className="w-full rounded border border-[#1f2532] bg-[#151922] px-2.5 py-1.5 text-[11px] text-[#e6e9ef] placeholder:text-[#586070]"
          />
        </div>

        {/* Zones List */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-wider text-[#6e7787]">
              Key Level Zones (Pin 2-3)
            </span>
            <button
              type="button"
              onClick={onToggleDrawZone}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10.5px] transition ${
                drawZoneMode
                  ? "bg-sky-500/20 text-sky-300"
                  : "bg-[#171c26] text-[#c8cfdc] hover:bg-[#222938]"
              }`}
            >
              <Plus className="h-3 w-3" />
              {drawZoneMode ? "Drag Chart..." : "Draw Zone"}
            </button>
          </div>
          <div className="max-h-52 space-y-1 overflow-y-auto">
            {zones.map((z) => (
              <div
                key={z.id}
                onClick={() => onSelectZone(z.id)}
                className={`flex cursor-pointer items-center justify-between rounded px-2.5 py-1.5 border transition ${
                  z.id === activeZoneId
                    ? "border-[#d4a03a]/60 bg-[#171510]"
                    : "border-[#1c212b] bg-[#0b0d11] hover:border-[#2a3140]"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`truncate text-[11px] font-medium ${
                        z.kind === "stacked" ? "text-[#eab854]" : "text-[#e6e9ef]"
                      }`}
                    >
                      {z.label.replace("STACKED: ", "★ ")}
                    </span>
                    {z.untested && (
                      <span className="text-[9px] text-[#00c087]">UNTESTED</span>
                    )}
                  </div>
                  <div className="font-mono-num text-[10px] text-[#6e7787]">
                    {z.low.toFixed(2)} - {z.high.toFixed(2)}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTogglePinZone(z.id);
                    }}
                    className={`rounded p-1 ${
                      z.pinned ? "text-[#eab854]" : "text-[#586070] hover:text-[#c8cfdc]"
                    }`}
                  >
                    <Pin className="h-3.5 w-3.5" />
                  </button>
                  {z.kind === "custom" && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteZone(z.id);
                      }}
                      className="rounded p-1 text-[#586070] hover:text-[#f6465d]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[#8b94a5]">
          <input
            type="checkbox"
            checked={plan.newsChecked}
            onChange={(e) => setField("newsChecked", e.target.checked)}
            className="h-3.5 w-3.5 accent-[#00c087]"
          />
          Checked red-folder Asia news (China / BoJ / RBA)
        </label>
      </div>
    </div>
  );
}
