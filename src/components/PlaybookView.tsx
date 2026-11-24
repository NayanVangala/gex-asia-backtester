"use client";

import React from "react";
import { SCENARIO_META, ScenarioNumber } from "@/lib/types";

export function PlaybookView() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6 text-xs text-[#c8cfdc]">
      <div className="border-b border-[#1c212b] pb-4">
        <h1 className="text-base font-semibold tracking-tight text-[#e6e9ef]">
          Asia Value Model · Playbook Reference
        </h1>
        <p className="mt-1 text-xs text-[#8b94a5]">
          Order never changes: Location first, Confirmation second, Entry third.
          Read order flow on GC / PAXG real tape, size and execute on 1OZ ($1/pt, $0.25 tick).
          Ignore middle of developing value. Max 2 trades/session, 2R daily stop.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-md border border-[#1c212b] bg-[#0f1217] p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#00c087]">
            Model 1 · Reversal (Level Holds)
          </h2>
          <ol className="mt-3 list-decimal space-y-1.5 pl-4 text-[#c8cfdc] leading-relaxed">
            <li>Price reaches planned key zone (stacked + untested preferred).</li>
            <li>Poke beyond fails acceptance (closes back inside within 1-2 M5 bars).</li>
            <li>Absorption at extreme + trapped traders visible on footprint/delta.</li>
            <li>Aggression flips (delta flips, stacked imbalances, CVD turns).</li>
            <li>Price reclaims level inside value. No reclaim, no trade.</li>
            <li>Enter on FIRST VALID PULLBACK toward absorption zone that holds.</li>
            <li>Stop behind absorption extreme (+2 GC ticks, outward to $0.25).</li>
            <li>Targets: Developing vPOC (T1), opposite value edge / HVN (T2 &gt;= 2R).</li>
          </ol>
        </div>

        <div className="rounded-md border border-[#1c212b] bg-[#0f1217] p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#e6e9ef]">
            Model 2 · Continuation (Level Breaks)
          </h2>
          <ol className="mt-3 list-decimal space-y-1.5 pl-4 text-[#c8cfdc] leading-relaxed">
            <li>Price breaks beyond level. Never chase the breakout candle.</li>
            <li>Acceptance confirmed: 6+ M5 bars (30+ min) beyond, most closing beyond.</li>
            <li>A wick is NEVER acceptance. 3-5 bars = unclear, no trade.</li>
            <li>Wait for pullback to retest broken level from the other side.</li>
            <li>Absorption on retest + aggression back in breakout direction.</li>
            <li>Enter on retest hold; stop behind retest absorption.</li>
            <li>Targets: Next HVN, Composite VAH/VAL, or LVN travel zone.</li>
            <li>Invalidation: closes back inside old level, flip to Model 1 watch.</li>
          </ol>
        </div>
      </div>

      <div className="rounded-md border border-[#1c212b] bg-[#0f1217] p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#8b94a5]">
          6 Decision-Tree Scenarios
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {([1, 2, 3, 4, 5, 6] as ScenarioNumber[]).map((n) => {
            const s = SCENARIO_META[n];
            return (
              <div
                key={n}
                className="rounded border border-[#1c212b] bg-[#0b0d11] p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-[#e6e9ef]">{s.shortTitle}</span>
                  <span className="font-mono-num text-[10px] text-[#7d8594]">
                    {s.defaultModel === "model1_reversal"
                      ? "M1"
                      : s.defaultModel === "model2_continuation"
                        ? "M2"
                        : "SKIP"}
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-[#7d8594]">
                  {s.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-md border border-[#1c212b] bg-[#0f1217] p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#8b94a5]">
          Data Integrity &amp; Signal Priority
        </h2>
        <p className="mt-1.5 text-[11px] text-[#8b94a5]">
          Priority when signals disagree: 1. Volume Profile, 2. M5 Footprint, 3. CVD, 4. Big Trades, 5. Heatmap. Executed trades beat resting orders.
        </p>
        <table className="mt-3 w-full text-left font-mono-num text-[11px]">
          <thead>
            <tr className="border-b border-[#1c212b] text-[#586070]">
              <th className="py-2 pr-3 font-normal">Feed</th>
              <th className="py-2 pr-3 font-normal">Profiles &amp; Candles</th>
              <th className="py-2 pr-3 font-normal">Footprint &amp; CVD</th>
              <th className="py-2 font-normal">L2 Heatmap</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#151922]">
            <tr>
              <td className="py-2 pr-3 text-[#e6e9ef]">Kraken PAXG/USD</td>
              <td className="py-2 pr-3 text-[#8b94a5]">Real 30d H1 + Tick M5/M1</td>
              <td className="py-2 pr-3 text-[#00c087]">Real aggressor trades</td>
              <td className="py-2 text-[#7d8594]">Live capture only</td>
            </tr>
            <tr>
              <td className="py-2 pr-3 text-[#e6e9ef]">COMEX GC=F</td>
              <td className="py-2 pr-3 text-[#00c087]">Real COMEX futures</td>
              <td className="py-2 pr-3 text-[#d4a03a]">Disabled (OHLCV only)</td>
              <td className="py-2 text-[#586070]">None</td>
            </tr>
            <tr>
              <td className="py-2 pr-3 text-[#e6e9ef]">Databento GLBX.MDP3 CSV</td>
              <td className="py-2 pr-3 text-[#00c087]">Real COMEX GC</td>
              <td className="py-2 pr-3 text-[#00c087]">Real COMEX GC ticks</td>
              <td className="py-2 text-[#00c087]">Real MBP-10 L2</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
