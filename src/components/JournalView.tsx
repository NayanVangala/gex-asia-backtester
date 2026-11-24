"use client";

import React, { useMemo, useState } from "react";
import { Download, Plus, Trash2 } from "lucide-react";
import {
  EntryTiming,
  ModelType,
  OrderSide,
  SCENARIO_META,
  ScenarioNumber,
  SetupTag,
  SimRepLog,
} from "@/lib/types";
import { computeJournalStats, exportJournalCSV } from "@/lib/journal";

interface JournalViewProps {
  reps: SimRepLog[];
  onAddRep: (rep: SimRepLog) => void;
  onDeleteRep: (id: string) => void;
  currentSessionDate: string;
  currentInstrument: string;
}

export function JournalView({
  reps,
  onAddRep,
  onDeleteRep,
  currentSessionDate,
  currentInstrument,
}: JournalViewProps) {
  const stats = useMemo(() => computeJournalStats(reps), [reps]);

  const [showAdd, setShowAdd] = useState(false);
  const [scenario, setScenario] = useState<ScenarioNumber>(5);
  const [model, setModel] = useState<ModelType>("model1_reversal");
  const [setupTag, setSetupTag] = useState<SetupTag>("fade_vah_val");
  const [side, setSide] = useState<OrderSide | "none">("long");
  const [entryTiming, setEntryTiming] = useState<EntryTiming | "skipped">(
    "first_valid_pullback"
  );
  const [outcomeR, setOutcomeR] = useState<string>("1.5");
  const [note, setNote] = useState<string>("");
  const [ctxUsed, setCtxUsed] = useState({
    h1m30: true,
    m5: true,
    m5Footprint: true,
    m1: true,
  });

  const handleManualAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const rVal = model === "no_trade" ? 0 : Number(outcomeR) || 0;
    const violations: string[] = [];
    if (entryTiming === "first_touch") violations.push("FIRST_TOUCH");
    if (entryTiming === "early") violations.push("EARLY_ENTRY");
    if (entryTiming === "late_chase") violations.push("LATE_CHASE");

    onAddRep({
      id: `rep-${Date.now()}`,
      createdAt: new Date().toISOString(),
      sessionDate: currentSessionDate,
      instrument: currentInstrument,
      dataSource: "paxg_ticks",
      scenario,
      model,
      setupTag,
      side: model === "no_trade" ? "none" : side,
      entryTiming: model === "no_trade" ? "skipped" : entryTiming,
      contextUsed: ctxUsed,
      outcomeR: rVal,
      ruleViolations: violations,
      note: note.trim() || "Manual sim rep",
    });
    setNote("");
    setShowAdd(false);
  };

  const downloadFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const realRepCount = reps.filter((r) => !r.isSample).length;
  const pctTo50 = Math.min(100, (realRepCount / 50) * 100);
  const pctTo200 = Math.min(100, (realRepCount / 200) * 100);

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 text-xs">
      {/* Header + Progress toward 50 / 200 reps */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#1c2436] bg-[#0c1018] p-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">
            Sim Rep Journal &amp; Edge Review
          </h2>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Two jobs of backtesting: prove model edge in your hands and eliminate the early-entry leak.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-1 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500"
          >
            <Plus className="h-3.5 w-3.5" /> Log Manual Rep
          </button>
          <button
            type="button"
            onClick={() =>
              downloadFile(
                exportJournalCSV(reps),
                `gex-sim-reps-${currentSessionDate}.csv`,
                "text/csv"
              )
            }
            className="flex items-center gap-1 rounded border border-[#26324a] bg-[#141c2c] px-2.5 py-1.5 text-slate-200 hover:bg-[#1c273d]"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
          <button
            type="button"
            onClick={() =>
              downloadFile(
                JSON.stringify(reps, null, 2),
                `gex-sim-reps-${currentSessionDate}.json`,
                "application/json"
              )
            }
            className="flex items-center gap-1 rounded border border-[#26324a] bg-[#141c2c] px-2.5 py-1.5 text-slate-200 hover:bg-[#1c273d]"
          >
            <Download className="h-3.5 w-3.5" /> JSON
          </button>
        </div>
      </div>

      {/* Milestone Progress Bars */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-[#1c2436] bg-[#0c1018] p-3">
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-300">Phase 2 Target (50 Honest Sim Reps)</span>
            <span className="font-mono-num font-semibold text-amber-300">
              {realRepCount} / 50
            </span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-[#151c2c] overflow-hidden">
            <div
              className="h-full bg-amber-400 transition-all"
              style={{ width: `${pctTo50}%` }}
            />
          </div>
        </div>
        <div className="rounded-lg border border-[#1c2436] bg-[#0c1018] p-3">
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-300">Full Validation Target (200+ Reps)</span>
            <span className="font-mono-num font-semibold text-emerald-300">
              {realRepCount} / 200
            </span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-[#151c2c] overflow-hidden">
            <div
              className="h-full bg-emerald-400 transition-all"
              style={{ width: `${pctTo200}%` }}
            />
          </div>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-lg border border-[#1c2436] bg-[#0c1018] p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">
            Discipline %
          </div>
          <div
            className={`mt-1 font-mono-num text-xl font-bold ${
              stats.disciplinePct >= 80 ? "text-emerald-400" : "text-amber-400"
            }`}
          >
            {stats.disciplinePct}%
          </div>
          <div className="text-[10px] text-slate-500">Clean rule reps</div>
        </div>

        <div className="rounded-lg border border-[#1c2436] bg-[#0c1018] p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">
            Valid Pullbacks
          </div>
          <div className="mt-1 font-mono-num text-xl font-bold text-emerald-400">
            {stats.firstValidPullbackCount}
          </div>
          <div className="text-[10px] text-slate-500">Entered on rule</div>
        </div>

        <div className="rounded-lg border border-[#1c2436] bg-[#0c1018] p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">
            Early / 1st Touch
          </div>
          <div
            className={`mt-1 font-mono-num text-xl font-bold ${
              stats.firstTouchCount + stats.earlyCount > 0
                ? "text-rose-400"
                : "text-emerald-400"
            }`}
          >
            {stats.firstTouchCount + stats.earlyCount}
          </div>
          <div className="text-[10px] text-slate-500">
            1st touch: {stats.firstTouchCount} · early: {stats.earlyCount}
          </div>
        </div>

        <div className="rounded-lg border border-[#1c2436] bg-[#0c1018] p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">
            Net Outcome (R)
          </div>
          <div
            className={`mt-1 font-mono-num text-xl font-bold ${
              stats.totalR >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {stats.totalR >= 0 ? "+" : ""}
            {stats.totalR}R
          </div>
          <div className="text-[10px] text-slate-500">
            Avg {stats.avgR >= 0 ? "+" : ""}
            {stats.avgR}R / trade
          </div>
        </div>

        <div className="rounded-lg border border-[#1c2436] bg-[#0c1018] p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">
            Win Rate
          </div>
          <div className="mt-1 font-mono-num text-xl font-bold text-sky-300">
            {stats.winRatePct}%
          </div>
          <div className="text-[10px] text-slate-500">
            {stats.tradedReps} trades · {stats.skippedReps} skips
          </div>
        </div>

        <div className="rounded-lg border border-[#1c2436] bg-[#0c1018] p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">
            M1 vs M2 R
          </div>
          <div className="mt-1 font-mono-num text-sm font-bold text-slate-100">
            M1: {stats.byModel.model1_reversal.totalR >= 0 ? "+" : ""}
            {stats.byModel.model1_reversal.totalR}R
          </div>
          <div className="font-mono-num text-xs text-sky-300">
            M2: {stats.byModel.model2_continuation.totalR >= 0 ? "+" : ""}
            {stats.byModel.model2_continuation.totalR}R
          </div>
        </div>
      </div>

      {/* Optional Manual Add Form */}
      {showAdd && (
        <form
          onSubmit={handleManualAdd}
          className="grid grid-cols-1 gap-3 rounded-lg border border-sky-500/40 bg-[#0c121e] p-4 sm:grid-cols-3 lg:grid-cols-6"
        >
          <div>
            <label className="text-[10px] text-slate-400">Scenario</label>
            <select
              value={scenario}
              onChange={(e) =>
                setScenario(Number(e.target.value) as ScenarioNumber)
              }
              className="mt-1 w-full rounded border border-[#26324a] bg-[#090d14] px-2 py-1.5 text-slate-200"
            >
              {([1, 2, 3, 4, 5, 6] as ScenarioNumber[]).map((n) => (
                <option key={n} value={n}>
                  {SCENARIO_META[n].shortTitle}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-slate-400">Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value as ModelType)}
              className="mt-1 w-full rounded border border-[#26324a] bg-[#090d14] px-2 py-1.5 text-slate-200"
            >
              <option value="model1_reversal">Model 1: Reversal</option>
              <option value="model2_continuation">Model 2: Continuation</option>
              <option value="no_trade">No Trade (Skip)</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-slate-400">Setup</label>
            <select
              value={setupTag}
              onChange={(e) => setSetupTag(e.target.value as SetupTag)}
              className="mt-1 w-full rounded border border-[#26324a] bg-[#090d14] px-2 py-1.5 text-slate-200"
            >
              <option value="fade_vah_val">Fade VAH/VAL</option>
              <option value="pd_poc_bounce">PD POC Bounce</option>
              <option value="hvn_reversal">HVN Reversal</option>
              <option value="lvn_continuation">LVN Continuation</option>
              <option value="trapped_participant">Trapped Participant</option>
              <option value="failed_auction">Failed Auction</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-slate-400">Entry Timing</label>
            <select
              value={entryTiming}
              onChange={(e) =>
                setEntryTiming(e.target.value as EntryTiming | "skipped")
              }
              className="mt-1 w-full rounded border border-[#26324a] bg-[#090d14] px-2 py-1.5 text-slate-200"
            >
              <option value="first_valid_pullback">First Valid Pullback</option>
              <option value="first_touch">First Touch (Leak)</option>
              <option value="early">Early</option>
              <option value="late_chase">Late Chase</option>
              <option value="skipped">Skipped</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-slate-400">Side &amp; Outcome (R)</label>
            <div className="mt-1 flex gap-1">
              <select
                value={side}
                onChange={(e) => setSide(e.target.value as OrderSide | "none")}
                className="w-1/2 rounded border border-[#26324a] bg-[#090d14] px-1.5 py-1.5 text-slate-200"
              >
                <option value="long">Long</option>
                <option value="short">Short</option>
                <option value="none">None</option>
              </select>
              <input
                type="number"
                step="0.1"
                value={outcomeR}
                onChange={(e) => setOutcomeR(e.target.value)}
                className="w-1/2 rounded border border-[#26324a] bg-[#090d14] px-2 py-1.5 font-mono-num text-slate-100"
              />
            </div>
          </div>
          <div className="flex flex-col justify-end">
            <button
              type="submit"
              className="rounded bg-emerald-600 py-1.5 font-semibold text-white hover:bg-emerald-500"
            >
              Save Rep
            </button>
          </div>
          <div className="sm:col-span-3 lg:col-span-4">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="One-line note: what did order flow look like when you clicked?"
              className="w-full rounded border border-[#26324a] bg-[#090d14] px-2.5 py-1.5 text-slate-100"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-3 lg:col-span-2 text-[11px] text-slate-300">
            {(["h1m30", "m5", "m5Footprint", "m1"] as const).map((k) => (
              <label key={k} className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ctxUsed[k]}
                  onChange={(e) =>
                    setCtxUsed((prev) => ({ ...prev, [k]: e.target.checked }))
                  }
                  className="accent-sky-500"
                />
                <span className="uppercase">{k}</span>
              </label>
            ))}
          </div>
        </form>
      )}

      {/* Breakdowns: Scenarios & Repeated Mistakes */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[#1c2436] bg-[#0c1018] p-4">
          <h3 className="font-semibold text-slate-100">
            Breakdown by Scenario (#1 to #6)
          </h3>
          <table className="mt-2.5 w-full font-mono-num text-[11px]">
            <thead>
              <tr className="border-b border-[#1c2436] text-left text-slate-500">
                <th className="py-1.5">Scenario</th>
                <th className="py-1.5 text-right">Reps</th>
                <th className="py-1.5 text-right">Wins</th>
                <th className="py-1.5 text-right">Net R</th>
                <th className="py-1.5 text-right">Avg R</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#141b29]">
              {stats.byScenario.map((row) => (
                <tr key={row.scenario}>
                  <td className="py-1.5 font-sans text-slate-300">
                    {SCENARIO_META[row.scenario].shortTitle}
                  </td>
                  <td className="py-1.5 text-right text-slate-400">{row.count}</td>
                  <td className="py-1.5 text-right text-slate-400">{row.wins}</td>
                  <td
                    className={`py-1.5 text-right font-semibold ${
                      row.totalR > 0
                        ? "text-emerald-400"
                        : row.totalR < 0
                          ? "text-rose-400"
                          : "text-slate-500"
                    }`}
                  >
                    {row.totalR > 0 ? "+" : ""}
                    {row.totalR}R
                  </td>
                  <td className="py-1.5 text-right text-slate-300">
                    {row.avgR > 0 ? "+" : ""}
                    {row.avgR}R
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-[#1c2436] bg-[#0c1018] p-4">
          <h3 className="font-semibold text-slate-100">
            Repeated Mistakes Ranking
          </h3>
          {stats.repeatedMistakes.length === 0 ? (
            <div className="mt-4 rounded border border-emerald-500/20 bg-emerald-500/5 p-3 text-emerald-300">
              Zero rule violations or early-entry leaks recorded so far.
            </div>
          ) : (
            <div className="mt-2.5 space-y-1.5">
              {stats.repeatedMistakes.map((m) => (
                <div
                  key={m.mistake}
                  className="flex items-center justify-between rounded border border-rose-500/25 bg-rose-500/5 px-3 py-1.5"
                >
                  <span className="text-rose-200">{m.mistake}</span>
                  <span className="rounded bg-rose-500/20 px-2 py-0.5 font-mono-num font-bold text-rose-300">
                    {m.count}×
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Full Rep Log Table */}
      <div className="rounded-lg border border-[#1c2436] bg-[#0c1018] p-4">
        <h3 className="font-semibold text-slate-100">
          Logged Reps ({reps.length})
        </h3>
        <div className="mt-2.5 overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-[#1c2436] text-slate-500">
                <th className="py-2 pr-3">Session</th>
                <th className="py-2 pr-3">Scenario</th>
                <th className="py-2 pr-3">Model</th>
                <th className="py-2 pr-3">Timing</th>
                <th className="py-2 pr-3 text-right">Outcome</th>
                <th className="py-2 pr-3">Note</th>
                <th className="py-2 text-right">Del</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#141b29]">
              {reps.map((r) => (
                <tr key={r.id} className="hover:bg-[#111724]">
                  <td className="py-2 pr-3 font-mono-num text-slate-400">
                    {r.sessionDate}
                    {r.isSample && (
                      <span className="ml-1.5 rounded bg-slate-700 px-1 text-[9px] text-slate-300">
                        TEST
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-slate-200">#{r.scenario}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] ${
                        r.model === "model1_reversal"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : r.model === "model2_continuation"
                            ? "bg-sky-500/15 text-sky-300"
                            : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {r.model === "model1_reversal"
                        ? "M1 Rev"
                        : r.model === "model2_continuation"
                          ? "M2 Cont"
                          : "Skip"}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={
                        r.entryTiming === "first_touch" || r.entryTiming === "early"
                          ? "font-semibold text-rose-400"
                          : r.entryTiming === "first_valid_pullback"
                            ? "text-emerald-400"
                            : "text-slate-400"
                      }
                    >
                      {r.entryTiming.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td
                    className={`py-2 pr-3 text-right font-mono-num font-semibold ${
                      r.outcomeR > 0
                        ? "text-emerald-400"
                        : r.outcomeR < 0
                          ? "text-rose-400"
                          : "text-slate-400"
                    }`}
                  >
                    {r.model === "no_trade"
                      ? "0.0R"
                      : `${r.outcomeR > 0 ? "+" : ""}${r.outcomeR.toFixed(2)}R`}
                  </td>
                  <td className="py-2 pr-3 text-slate-300 max-w-md truncate">
                    {r.note}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onDeleteRep(r.id)}
                      className="rounded p-1 text-slate-500 hover:bg-rose-500/10 hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
