"use client";

import React from "react";
import {
  BiasDirection,
  KeyLevelZone,
  PremarketPlan,
  VolumeProfileResult,
} from "@/lib/types";
import { CheckSquare, Pin, Plus, Trash2 } from "lucide-react";

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
  const pinnedZones = zones.filter((z) => z.pinned);
  const checklistReady =
    Boolean(plan.biasReason.trim()) &&
    Boolean(plan.nightRule.trim()) &&
    pinnedZones.length >= 1 &&
    plan.newsChecked;

  const setField = <K extends keyof PremarketPlan>(
    k: K,
    v: PremarketPlan[K]
  ) => onChangePlan({ ...plan, [k]: v });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[#1c2436] bg-[#0c1018] p-3.5 text-xs">
      <div className="flex items-center justify-between border-b border-[#1c2436] pb-2">
        <div>
          <h2 className="font-semibold text-slate-100">
            Premarket Routine (Tokyo Open 4:00 PM PT)
          </h2>
          <p className="text-[11px] text-slate-400">
            Location first, confirmation second, entry third. Pick 2-3 stacked untested levels.
          </p>
        </div>
        <button
          type="button"
          onClick={onJumpToReplay}
          className={`rounded px-3 py-1.5 text-xs font-semibold transition ${
            checklistReady
              ? "bg-emerald-600 text-white hover:bg-emerald-500"
              : "bg-sky-600 text-white hover:bg-sky-500"
          }`}
        >
          Start Asia Replay
        </button>
      </div>

      {/* Reference Levels Summary Grid */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Prev Day (PD)", prof: profiles.previousDay, color: "text-amber-300" },
          { label: "Prev Week (PW)", prof: profiles.previousWeek, color: "text-sky-300" },
          { label: "5D Composite", prof: profiles.composite5d, color: "text-violet-300" },
        ].map(({ label, prof, color }) => (
          <div
            key={label}
            className="rounded border border-[#1c2436] bg-[#090d14] p-2 font-mono-num"
          >
            <div className={`text-[10px] font-semibold ${color}`}>{label}</div>
            {prof ? (
              <div className="mt-1 space-y-0.5 text-[11px] text-slate-300">
                <div className="flex justify-between">
                  <span className="text-slate-500">VAH</span>
                  <span>{prof.vah.toFixed(1)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-amber-400">POC</span>
                  <span className="font-semibold text-amber-300">
                    {prof.poc.toFixed(1)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">VAL</span>
                  <span>{prof.val.toFixed(1)}</span>
                </div>
              </div>
            ) : (
              <div className="mt-1 text-[10px] text-slate-500">Need more history</div>
            )}
          </div>
        ))}
      </div>

      {/* Bigger Picture Bias */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-400">
            Session Bias
          </label>
          <div className="mt-1 grid grid-cols-3 gap-1">
            {(["bullish", "balanced", "bearish"] as BiasDirection[]).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setField("bias", b)}
                className={`rounded py-1 text-[11px] font-medium capitalize border transition ${
                  plan.bias === b
                    ? b === "bullish"
                      ? "bg-emerald-500/20 border-emerald-500/60 text-emerald-300"
                      : b === "bearish"
                        ? "bg-rose-500/20 border-rose-500/60 text-rose-300"
                        : "bg-amber-500/20 border-amber-500/60 text-amber-300"
                    : "border-[#1c2436] bg-[#090d14] text-slate-400"
                }`}
              >
                {b}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-400">
            Price vs Weekly Value
          </label>
          <select
            value={plan.priceVsWeeklyValue}
            onChange={(e) =>
              setField(
                "priceVsWeeklyValue",
                e.target.value as PremarketPlan["priceVsWeeklyValue"]
              )
            }
            className="mt-1 w-full rounded border border-[#1c2436] bg-[#090d14] px-2 py-1 text-xs text-slate-200"
          >
            <option value="above">Above PW Value (Bullish bias)</option>
            <option value="inside">Inside PW Value (Balanced)</option>
            <option value="below">Below PW Value (Bearish bias)</option>
          </select>
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-400">
            Price vs Yesterday Value
          </label>
          <select
            value={plan.priceVsDailyValue}
            onChange={(e) =>
              setField(
                "priceVsDailyValue",
                e.target.value as PremarketPlan["priceVsDailyValue"]
              )
            }
            className="mt-1 w-full rounded border border-[#1c2436] bg-[#090d14] px-2 py-1 text-xs text-slate-200"
          >
            <option value="inside">Inside PD Value (Edge fades)</option>
            <option value="above">Above PD Value (Trend cont.)</option>
            <option value="below">Below PD Value (Trend cont.)</option>
          </select>
        </div>
      </div>

      {/* Bias Reason & No-Trade Zone */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-400">
            Bias Why (1 line)
          </label>
          <input
            type="text"
            value={plan.biasReason}
            onChange={(e) => setField("biasReason", e.target.value)}
            placeholder="e.g. Above PW VAH, balancing below PD VAH"
            className="mt-1 w-full rounded border border-[#1c2436] bg-[#090d14] px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-400">
            No-Trade Middle Zone (Low - High)
          </label>
          <div className="mt-1 flex items-center gap-1.5">
            <input
              type="number"
              step="0.25"
              value={plan.noTradeZoneLow ?? ""}
              onChange={(e) =>
                setField(
                  "noTradeZoneLow",
                  e.target.value ? Number(e.target.value) : null
                )
              }
              placeholder="Dev VAL"
              className="w-full rounded border border-[#1c2436] bg-[#090d14] px-2 py-1.5 font-mono-num text-xs text-slate-100 placeholder:text-slate-600"
            />
            <span className="text-slate-500">-</span>
            <input
              type="number"
              step="0.25"
              value={plan.noTradeZoneHigh ?? ""}
              onChange={(e) =>
                setField(
                  "noTradeZoneHigh",
                  e.target.value ? Number(e.target.value) : null
                )
              }
              placeholder="Dev VAH"
              className="w-full rounded border border-[#1c2436] bg-[#090d14] px-2 py-1.5 font-mono-num text-xs text-slate-100 placeholder:text-slate-600"
            />
          </div>
        </div>
      </div>

      {/* Tonight's IF/THEN Rule */}
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-slate-400">
          Tonight&apos;s Rule (If level rejects -&gt; Model 1; if accepts 30m -&gt; Model 2)
        </label>
        <textarea
          rows={2}
          value={plan.nightRule}
          onChange={(e) => setField("nightRule", e.target.value)}
          placeholder="e.g. PD VAH rejection = short reversal back to vPOC; 6 M5 bars above PD VAH = kill short, wait retest for long cont."
          className="mt-1 w-full rounded border border-[#1c2436] bg-[#090d14] px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
        />
      </div>

      {/* Auto-detected & Custom Zones list */}
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Key Level Zones (Pin 2-3 Best Stacked / Untested)
          </span>
          <button
            type="button"
            onClick={onToggleDrawZone}
            className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium border transition ${
              drawZoneMode
                ? "bg-teal-500/20 border-teal-400 text-teal-200"
                : "bg-[#141c2c] border-[#26324a] text-slate-300 hover:bg-[#1c273d]"
            }`}
          >
            <Plus className="h-3 w-3" />
            {drawZoneMode ? "Drawing on Chart..." : "Draw Custom Zone"}
          </button>
        </div>

        <div className="mt-1.5 max-h-44 space-y-1 overflow-y-auto pr-1">
          {zones.map((z) => {
            const selected = z.id === activeZoneId;
            return (
              <div
                key={z.id}
                onClick={() => onSelectZone(z.id)}
                className={`flex cursor-pointer items-center justify-between gap-2 rounded border px-2.5 py-1.5 transition ${
                  selected
                    ? "border-amber-400/70 bg-amber-500/10"
                    : "border-[#1c2436] bg-[#090d14] hover:border-[#2a3650]"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`truncate font-medium ${
                        z.kind === "stacked" ? "text-amber-300" : "text-slate-200"
                      }`}
                    >
                      {z.label}
                    </span>
                    {z.untested && (
                      <span className="rounded bg-emerald-500/15 px-1 py-0.2 text-[9px] font-semibold text-emerald-300">
                        UNTESTED
                      </span>
                    )}
                  </div>
                  <div className="font-mono-num text-[10px] text-slate-400">
                    {z.low.toFixed(2)} - {z.high.toFixed(2)}
                    {z.notes ? ` · ${z.notes}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    title="Pin to tonight's 2-3 levels"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTogglePinZone(z.id);
                    }}
                    className={`rounded p-1 ${
                      z.pinned
                        ? "bg-amber-500/20 text-amber-300"
                        : "text-slate-500 hover:text-slate-200"
                    }`}
                  >
                    <Pin className="h-3.5 w-3.5" />
                  </button>
                  {z.kind === "custom" && (
                    <button
                      type="button"
                      title="Remove custom zone"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteZone(z.id);
                      }}
                      className="rounded p-1 text-slate-500 hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* News Check */}
      <label className="flex cursor-pointer items-center gap-2 rounded border border-[#1c2436] bg-[#090d14] px-2.5 py-2 text-slate-300">
        <input
          type="checkbox"
          checked={plan.newsChecked}
          onChange={(e) => setField("newsChecked", e.target.checked)}
          className="h-3.5 w-3.5 rounded accent-emerald-500"
        />
        <CheckSquare className="h-3.5 w-3.5 text-slate-400" />
        <span>
          Checked red-folder Asia news (China/BoJ/RBA data, USD/JPY spikes)
        </span>
      </label>
    </div>
  );
}
