"use client";

import React from "react";
import { SCENARIO_META, ScenarioNumber } from "@/lib/types";

export function PlaybookView() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 text-xs text-slate-300">
      <div className="rounded-lg border border-[#1c2436] bg-[#0c1018] p-4">
        <h2 className="text-sm font-semibold text-slate-100">
          Asia Value Model: One-Page Reference
        </h2>
        <p className="mt-1 text-slate-400">
          Order never changes: <strong className="text-amber-300">Location first</strong>,{" "}
          <strong className="text-sky-300">Confirmation second</strong>,{" "}
          <strong className="text-emerald-300">Entry third</strong>. Read order flow on GC
          (or real PAXG tick tape in sim), size and execute on 1OZ ($1/pt, $0.25 tick).
          Ignore middle of developing value. One A+ trade is enough. Max 2 trades / 2R daily stop.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3.5">
            <h3 className="font-semibold text-emerald-300">
              Model 1: Reversal (Level Holds / No Acceptance)
            </h3>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-slate-300">
              <li>Price reaches planned key zone (stacked + untested preferred).</li>
              <li>Push beyond fails acceptance (closes back inside within 1-2 M5 bars).</li>
              <li>Absorption at extreme (heavy opposing delta, price stalls) + trapped traders.</li>
              <li>Aggression flips (delta flips, stacked imbalances, CVD turns).</li>
              <li>Price reclaims the level back inside value. (No reclaim, no trade.)</li>
              <li>Wait for FIRST VALID PULLBACK toward absorption zone that holds.</li>
              <li>Stop behind absorption extreme (+1-2 GC ticks, rounded outward to $0.25).</li>
              <li>Targets: Developing vPOC (T1), opposite value edge / next HVN (T2 &gt;= 2R).</li>
            </ol>
          </div>

          <div className="rounded-lg border border-sky-500/25 bg-sky-500/5 p-3.5">
            <h3 className="font-semibold text-sky-300">
              Model 2: Continuation (Level Breaks & Accepts)
            </h3>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-slate-300">
              <li>Price breaks beyond planned level. Do NOT chase breakout candle.</li>
              <li>Wait for acceptance: 6+ M5 bars (30+ min) beyond, most closing beyond, volume building.</li>
              <li>A wick is NEVER acceptance. Anything 3-5 bars = unclear, no trade.</li>
              <li>Price pulls back to retest old level from the other side.</li>
              <li>Absorption on retest + aggression back in breakout direction.</li>
              <li>Enter on retest hold (first valid pullback). Stop behind retest absorption.</li>
              <li>Targets: Next HVN, Composite VAH/VAL, or LVN travel zone.</li>
              <li>Invalidation: closes back inside old level = break failed, flip to Model 1 watch.</li>
            </ol>
          </div>
        </div>
      </div>

      {/* 6 Scenarios */}
      <div className="rounded-lg border border-[#1c2436] bg-[#0c1018] p-4">
        <h3 className="text-sm font-semibold text-slate-100">
          The 6 Decision-Tree Scenarios
        </h3>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {([1, 2, 3, 4, 5, 6] as ScenarioNumber[]).map((n) => {
            const s = SCENARIO_META[n];
            return (
              <div
                key={n}
                className="rounded border border-[#1c2436] bg-[#090d14] p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-100">
                    {s.shortTitle}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      s.defaultModel === "model1_reversal"
                        ? "bg-emerald-500/15 text-emerald-300"
                        : s.defaultModel === "model2_continuation"
                          ? "bg-sky-500/15 text-sky-300"
                          : "bg-slate-700 text-slate-300"
                    }`}
                  >
                    {s.defaultModel === "model1_reversal"
                      ? "Model 1"
                      : s.defaultModel === "model2_continuation"
                        ? "Model 2"
                        : "No Trade"}
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
                  {s.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Data Integrity & Priority Matrix */}
      <div className="rounded-lg border border-[#1c2436] bg-[#0c1018] p-4">
        <h3 className="text-sm font-semibold text-slate-100">
          Data Honesty & Order Flow Priority
        </h3>
        <p className="mt-1 text-slate-400">
          Read priority when signals disagree: <strong className="text-slate-100">1. Volume Profile</strong>,{" "}
          <strong className="text-slate-100">2. M5 Footprint</strong>,{" "}
          <strong className="text-slate-100">3. CVD</strong>,{" "}
          <strong className="text-slate-100">4. Big Trades</strong>,{" "}
          <strong className="text-slate-100">5. Heatmap</strong>. Executed trades always beat resting orders.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left font-mono-num text-[11px]">
            <thead>
              <tr className="border-b border-[#1c2436] text-slate-400">
                <th className="py-2 pr-3">Data Source</th>
                <th className="py-2 pr-3">Volume Profile & Candles</th>
                <th className="py-2 pr-3">Bid×Ask Footprint & CVD</th>
                <th className="py-2 pr-3">L2 Heatmap</th>
                <th className="py-2">Best Use</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#141b29]">
              <tr>
                <td className="py-2 pr-3 text-emerald-300 font-semibold">Kraken PAXG/USD (Built-in)</td>
                <td className="py-2 pr-3">Real (30d H1 + Tick M5/M1)</td>
                <td className="py-2 pr-3 text-emerald-300">REAL Aggressor Tape</td>
                <td className="py-2 pr-3 text-slate-400">Live capture only</td>
                <td className="py-2">Zero-setup footprint, absorption, flip &amp; pullback drills</td>
              </tr>
              <tr>
                <td className="py-2 pr-3 text-amber-300 font-semibold">COMEX GC=F (Built-in)</td>
                <td className="py-2 pr-3 text-emerald-300">Real COMEX Futures (30d)</td>
                <td className="py-2 pr-3 text-amber-400">None (OHLCV only)</td>
                <td className="py-2 pr-3 text-slate-500">None</td>
                <td className="py-2">Exact GC PD/PW/Composite levels &amp; Acceptance vs Rejection</td>
              </tr>
              <tr>
                <td className="py-2 pr-3 text-sky-300 font-semibold">Databento GLBX.MDP3 CSV</td>
                <td className="py-2 pr-3 text-emerald-300">Real COMEX GC</td>
                <td className="py-2 pr-3 text-emerald-300">REAL COMEX GC Ticks</td>
                <td className="py-2 pr-3 text-emerald-300">REAL MBP-10 L2</td>
                <td className="py-2">100% authentic COMEX GC tape + Heatmap ($125 free credit)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
