"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, Plus, Trash2 } from "lucide-react";
import {
  EntryTiming,
  ModelType,
  OrderSide,
  SCENARIO_META,
  ScenarioNumber,
  SetupTag,
  SimRepLog,
} from "@/lib/types";
import {
  computeJournalStats,
  exportGoogleSheetTSV,
  exportJournalCSV,
} from "@/lib/journal";

interface JournalViewProps {
  reps: SimRepLog[];
  onAddRep: (rep: SimRepLog) => void;
  onDeleteRep: (id: string) => void;
  currentSessionDate: string;
  currentInstrument: string;
}

function EquityCurveCanvas({ reps }: { reps: SimRepLog[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const series = useMemo(() => {
    const real = reps.filter((r) => !r.isSample && r.model !== "no_trade");
    const pool = real.length > 0 ? real : reps.filter((r) => r.model !== "no_trade");
    const chrono = [...pool].reverse();
    let cum = 0;
    const pts = [{ idx: 0, r: 0 }];
    chrono.forEach((rep, idx) => {
      cum = Number((cum + rep.outcomeR).toFixed(2));
      pts.push({ idx: idx + 1, r: cum });
    });
    return pts;
  }, [reps]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = 560;
    const h = 148;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = "#0b0d11";
    ctx.fillRect(0, 0, w, h);

    const padL = 36;
    const padR = 14;
    const padT = 14;
    const padB = 18;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const rs = series.map((p) => p.r);
    const minR = Math.min(-1, ...rs);
    const maxR = Math.max(1, ...rs);
    const span = Math.max(0.5, maxR - minR);
    const yOf = (r: number) => padT + ((maxR - r) / span) * plotH;
    const xOf = (i: number) =>
      padL + (series.length <= 1 ? 0 : (i / (series.length - 1)) * plotW);

    const y0 = Math.round(yOf(0)) + 0.5;
    ctx.strokeStyle = "#1f2533";
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(padL, y0);
    ctx.lineTo(w - padR, y0);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#626b7c";
    ctx.font = "9px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.fillText(`${maxR.toFixed(1)}R`, padL - 4, padT + 4);
    ctx.fillText("0.0R", padL - 4, y0 + 3);
    ctx.fillText(`${minR.toFixed(1)}R`, padL - 4, padT + plotH + 3);

    if (series.length > 1) {
      const lastR = series[series.length - 1].r;
      const lineColor = lastR >= 0 ? "#00c087" : "#f6465d";

      ctx.beginPath();
      series.forEach((pt, idx) => {
        const x = xOf(idx);
        const y = yOf(pt.r);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.lineTo(xOf(series.length - 1), y0);
      ctx.lineTo(xOf(0), y0);
      ctx.closePath();
      ctx.fillStyle =
        lastR >= 0 ? "rgba(0, 192, 135, 0.12)" : "rgba(246, 70, 93, 0.12)";
      ctx.fill();

      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      series.forEach((pt, idx) => {
        const x = xOf(idx);
        const y = yOf(pt.r);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }, [series]);

  return (
    <canvas
      ref={canvasRef}
      className="h-[148px] w-full rounded border border-[#1c212b]"
    />
  );
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
  const [copiedTsv, setCopiedTsv] = useState(false);
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

  const timingComparison = useMemo(() => {
    const real = reps.filter((r) => !r.isSample && r.model !== "no_trade");
    const pool = real.length > 0 ? real : reps.filter((r) => r.model !== "no_trade");
    return [
      {
        label: "First Valid Pullback",
        items: pool.filter((r) => r.entryTiming === "first_valid_pullback"),
        color: "bg-[#00c087]",
      },
      {
        label: "First Touch / Early (Leak)",
        items: pool.filter(
          (r) => r.entryTiming === "first_touch" || r.entryTiming === "early"
        ),
        color: "bg-[#f6465d]",
      },
      {
        label: "Late Chase",
        items: pool.filter((r) => r.entryTiming === "late_chase"),
        color: "bg-[#d4a03a]",
      },
    ].map((b) => {
      const count = b.items.length;
      const wins = b.items.filter((x) => x.outcomeR > 0).length;
      const totalR = Number(b.items.reduce((s, x) => s + x.outcomeR, 0).toFixed(2));
      const wr = count > 0 ? Math.round((wins / count) * 100) : 0;
      return { ...b, count, totalR, wr };
    });
  }, [reps]);

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

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-6 text-xs">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1c212b] pb-4">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-[#e6e9ef]">
            Sim Rep Journal &amp; Edge Review
          </h1>
          <p className="mt-0.5 text-xs text-[#7d8594]">
            {realRepCount} / 50 calibration reps · {realRepCount} / 200 validation target
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-1 rounded bg-[#e6e9ef] px-3 py-1.5 text-[11px] font-semibold text-[#0b0d11] hover:bg-white"
          >
            <Plus className="h-3.5 w-3.5" /> Log Rep
          </button>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(exportGoogleSheetTSV(reps));
              setCopiedTsv(true);
              setTimeout(() => setCopiedTsv(false), 1800);
            }}
            className="flex items-center gap-1 rounded border border-[#262d3b] bg-[#151922] px-2.5 py-1.5 text-[11px] text-[#e6e9ef] hover:bg-[#1c2230]"
          >
            {copiedTsv ? <Check className="h-3.5 w-3.5 text-[#00c087]" /> : <Copy className="h-3.5 w-3.5" />}
            Copy Sheet TSV ($1/pt)
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
            className="flex items-center gap-1 rounded border border-[#262d3b] bg-[#151922] px-2.5 py-1.5 text-[11px] text-[#c8cfdc] hover:bg-[#1c2230]"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-px bg-[#1c212b] border border-[#1c212b] rounded-md overflow-hidden sm:grid-cols-3 lg:grid-cols-6">
        {[
          {
            label: "Discipline",
            val: `${stats.disciplinePct}%`,
            sub: "Clean rule reps",
            tone: stats.disciplinePct >= 80 ? "text-[#00c087]" : "text-[#d4a03a]",
          },
          {
            label: "Valid Pullbacks",
            val: String(stats.firstValidPullbackCount),
            sub: "Followed entry rule",
            tone: "text-[#00c087]",
          },
          {
            label: "Early / 1st Touch",
            val: String(stats.firstTouchCount + stats.earlyCount),
            sub: `1st: ${stats.firstTouchCount} · early: ${stats.earlyCount}`,
            tone: stats.firstTouchCount + stats.earlyCount > 0 ? "text-[#f6465d]" : "text-[#e6e9ef]",
          },
          {
            label: "Net R",
            val: `${stats.totalR >= 0 ? "+" : ""}${stats.totalR}R`,
            sub: `Avg ${stats.avgR >= 0 ? "+" : ""}${stats.avgR}R`,
            tone: stats.totalR >= 0 ? "text-[#00c087]" : "text-[#f6465d]",
          },
          {
            label: "Win Rate",
            val: `${stats.winRatePct}%`,
            sub: `${stats.tradedReps} trades · ${stats.skippedReps} skips`,
            tone: "text-[#e6e9ef]",
          },
          {
            label: "Model 1 / 2",
            val: `${stats.byModel.model1_reversal.totalR >= 0 ? "+" : ""}${stats.byModel.model1_reversal.totalR} / ${stats.byModel.model2_continuation.totalR >= 0 ? "+" : ""}${stats.byModel.model2_continuation.totalR}R`,
            sub: "Reversal vs Cont.",
            tone: "text-[#e6e9ef]",
          },
        ].map((k) => (
          <div key={k.label} className="bg-[#0f1217] p-3.5">
            <div className="text-[10px] uppercase tracking-wider text-[#6e7787]">
              {k.label}
            </div>
            <div className={`mt-1 font-mono-num text-lg font-semibold ${k.tone}`}>
              {k.val}
            </div>
            <div className="mt-0.5 text-[10px] text-[#586070]">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Manual Add Drawer */}
      {showAdd && (
        <form
          onSubmit={handleManualAdd}
          className="grid grid-cols-1 gap-3 rounded-md border border-[#262d3b] bg-[#0f1217] p-4 sm:grid-cols-3 lg:grid-cols-6"
        >
          <select
            value={scenario}
            onChange={(e) => setScenario(Number(e.target.value) as ScenarioNumber)}
            className="rounded border border-[#222836] bg-[#151922] px-2 py-1.5 text-[#e6e9ef]"
          >
            {([1, 2, 3, 4, 5, 6] as ScenarioNumber[]).map((n) => (
              <option key={n} value={n}>{SCENARIO_META[n].shortTitle}</option>
            ))}
          </select>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as ModelType)}
            className="rounded border border-[#222836] bg-[#151922] px-2 py-1.5 text-[#e6e9ef]"
          >
            <option value="model1_reversal">Model 1: Reversal</option>
            <option value="model2_continuation">Model 2: Continuation</option>
            <option value="no_trade">No Trade (Skip)</option>
          </select>
          <select
            value={setupTag}
            onChange={(e) => setSetupTag(e.target.value as SetupTag)}
            className="rounded border border-[#222836] bg-[#151922] px-2 py-1.5 text-[#e6e9ef]"
          >
            <option value="fade_vah_val">Fade VAH/VAL</option>
            <option value="pd_poc_bounce">PD POC Bounce</option>
            <option value="hvn_reversal">HVN Reversal</option>
            <option value="lvn_continuation">LVN Continuation</option>
            <option value="trapped_participant">Trapped Participant</option>
            <option value="failed_auction">Failed Auction</option>
          </select>
          <select
            value={entryTiming}
            onChange={(e) => setEntryTiming(e.target.value as EntryTiming | "skipped")}
            className="rounded border border-[#222836] bg-[#151922] px-2 py-1.5 text-[#e6e9ef]"
          >
            <option value="first_valid_pullback">First Valid Pullback</option>
            <option value="first_touch">First Touch (Leak)</option>
            <option value="early">Early</option>
            <option value="late_chase">Late Chase</option>
            <option value="skipped">Skipped</option>
          </select>
          <div className="flex gap-1.5">
            <select
              value={side}
              onChange={(e) => setSide(e.target.value as OrderSide | "none")}
              className="w-1/2 rounded border border-[#222836] bg-[#151922] px-2 py-1.5 text-[#e6e9ef]"
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
              className="w-1/2 rounded border border-[#222836] bg-[#151922] px-2 py-1.5 font-mono-num text-[#e6e9ef]"
            />
          </div>
          <button
            type="submit"
            className="rounded bg-[#00c087] py-1.5 font-semibold text-[#06140f]"
          >
            Save Rep
          </button>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="One-line order flow note..."
            className="sm:col-span-3 lg:col-span-4 rounded border border-[#222836] bg-[#151922] px-2.5 py-1.5 text-[#e6e9ef]"
          />
          <div className="flex items-center gap-3 sm:col-span-3 lg:col-span-2 text-[11px] text-[#8b94a5]">
            {(["h1m30", "m5", "m5Footprint", "m1"] as const).map((k) => (
              <label key={k} className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ctxUsed[k]}
                  onChange={(e) =>
                    setCtxUsed((prev) => ({ ...prev, [k]: e.target.checked }))
                  }
                  className="accent-[#00c087]"
                />
                <span className="uppercase">{k}</span>
              </label>
            ))}
          </div>
        </form>
      )}

      {/* Equity Curve + Timing Comparison */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-[#1c212b] bg-[#0f1217] p-4">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="font-medium text-[#e6e9ef]">Cumulative R Equity Curve</h3>
            <span className="font-mono-num text-[11px] text-[#7d8594]">
              {stats.tradedReps} traded reps
            </span>
          </div>
          <EquityCurveCanvas reps={reps} />
        </div>

        <div className="rounded-md border border-[#1c212b] bg-[#0f1217] p-4">
          <h3 className="font-medium text-[#e6e9ef]">
            Pullback Discipline vs Early-Entry Leak
          </h3>
          <div className="mt-4 space-y-3.5">
            {timingComparison.map((row) => (
              <div key={row.label}>
                <div className="flex justify-between text-[11px]">
                  <span className="text-[#c8cfdc]">{row.label}</span>
                  <span className="font-mono-num text-[#8b94a5]">
                    {row.count} reps · {row.wr}% WR ·{" "}
                    <strong className={row.totalR >= 0 ? "text-[#00c087]" : "text-[#f6465d]"}>
                      {row.totalR >= 0 ? "+" : ""}
                      {row.totalR}R
                    </strong>
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-[#1a202c] overflow-hidden">
                  <div className={`h-full ${row.color}`} style={{ width: `${Math.max(2, row.wr)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Scenarios + Repeated Mistakes */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-[#1c212b] bg-[#0f1217] p-4">
          <h3 className="font-medium text-[#e6e9ef] mb-2.5">Scenario #1 to #6</h3>
          <table className="w-full font-mono-num text-[11px]">
            <thead>
              <tr className="border-b border-[#1c212b] text-left text-[#586070]">
                <th className="py-1.5 font-normal">Scenario</th>
                <th className="py-1.5 text-right font-normal">Reps</th>
                <th className="py-1.5 text-right font-normal">Net R</th>
                <th className="py-1.5 text-right font-normal">Avg R</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#151922]">
              {stats.byScenario.map((row) => (
                <tr key={row.scenario}>
                  <td className="py-1.5 font-sans text-[#c8cfdc]">
                    {SCENARIO_META[row.scenario].shortTitle}
                  </td>
                  <td className="py-1.5 text-right text-[#7d8594]">{row.count}</td>
                  <td
                    className={`py-1.5 text-right font-medium ${
                      row.totalR > 0
                        ? "text-[#00c087]"
                        : row.totalR < 0
                          ? "text-[#f6465d]"
                          : "text-[#586070]"
                    }`}
                  >
                    {row.totalR > 0 ? "+" : ""}
                    {row.totalR}R
                  </td>
                  <td className="py-1.5 text-right text-[#8b94a5]">
                    {row.avgR > 0 ? "+" : ""}
                    {row.avgR}R
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-md border border-[#1c212b] bg-[#0f1217] p-4">
          <h3 className="font-medium text-[#e6e9ef] mb-2.5">Repeated Mistakes Ranking</h3>
          {stats.repeatedMistakes.length === 0 ? (
            <p className="text-[11px] text-[#7d8594]">
              Zero rule violations or early-entry leaks recorded.
            </p>
          ) : (
            <div className="space-y-1.5">
              {stats.repeatedMistakes.map((m) => (
                <div
                  key={m.mistake}
                  className="flex items-center justify-between border-b border-[#171c26] pb-1.5"
                >
                  <span className="text-[#c8cfdc]">{m.mistake}</span>
                  <span className="font-mono-num font-semibold text-[#f6465d]">
                    {m.count}×
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Rep Log Table */}
      <div className="rounded-md border border-[#1c212b] bg-[#0f1217] p-4">
        <h3 className="font-medium text-[#e6e9ef] mb-2.5">
          Logged Reps ({reps.length})
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-[#1c212b] text-[#586070]">
                <th className="py-2 pr-3 font-normal">Date</th>
                <th className="py-2 pr-3 font-normal">Scenario</th>
                <th className="py-2 pr-3 font-normal">Model</th>
                <th className="py-2 pr-3 font-normal">Timing</th>
                <th className="py-2 pr-3 text-right font-normal">Slip</th>
                <th className="py-2 pr-3 text-right font-normal">Outcome</th>
                <th className="py-2 pr-3 font-normal">Note</th>
                <th className="py-2 text-right font-normal"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#151922]">
              {reps.map((r) => (
                <tr key={r.id} className="hover:bg-[#141821]">
                  <td className="py-2 pr-3 font-mono-num text-[#8b94a5]">
                    {r.sessionDate}
                    {r.isSample && (
                      <span className="ml-1.5 text-[9px] text-[#586070]">TEST</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 font-mono-num text-[#e6e9ef]">#{r.scenario}</td>
                  <td className="py-2 pr-3 text-[#c8cfdc]">
                    {r.model === "model1_reversal"
                      ? "Model 1"
                      : r.model === "model2_continuation"
                        ? "Model 2"
                        : "Skip"}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={
                        r.entryTiming === "first_touch" || r.entryTiming === "early"
                          ? "text-[#f6465d]"
                          : r.entryTiming === "first_valid_pullback"
                            ? "text-[#00c087]"
                            : "text-[#7d8594]"
                      }
                    >
                      {r.entryTiming.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono-num text-[#d4a03a]">
                    {r.slippagePts ? `+${r.slippagePts.toFixed(2)}` : "-"}
                  </td>
                  <td
                    className={`py-2 pr-3 text-right font-mono-num font-semibold ${
                      r.outcomeR > 0
                        ? "text-[#00c087]"
                        : r.outcomeR < 0
                          ? "text-[#f6465d]"
                          : "text-[#586070]"
                    }`}
                  >
                    {r.model === "no_trade"
                      ? "0.0R"
                      : `${r.outcomeR > 0 ? "+" : ""}${r.outcomeR.toFixed(2)}R`}
                  </td>
                  <td className="py-2 pr-3 text-[#8b94a5] max-w-md truncate">
                    {r.note}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onDeleteRep(r.id)}
                      className="p-1 text-[#586070] hover:text-[#f6465d]"
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
