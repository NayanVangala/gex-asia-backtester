"use client";

import React from "react";
import { FootprintBar, Tick } from "@/lib/types";
import { SlidersHorizontal } from "lucide-react";

interface TapePanelProps {
  ticks: Tick[];
  latestFootprint: FootprintBar | null;
  hasRealAggressorTape: boolean;
  largeThreshold: number;
  whaleThreshold: number;
  customLarge: number | null;
  customWhale: number | null;
  onChangeCustomLarge: (v: number | null) => void;
  onChangeCustomWhale: (v: number | null) => void;
}

function fmtTimeSec(ts: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ts));
}

export function TapePanel({
  ticks,
  latestFootprint,
  hasRealAggressorTape,
  largeThreshold,
  whaleThreshold,
  customLarge,
  customWhale,
  onChangeCustomLarge,
  onChangeCustomWhale,
}: TapePanelProps) {
  const activeLarge = customLarge ?? largeThreshold;
  const activeWhale = customWhale ?? whaleThreshold;
  const recentTicks = ticks.slice(-36).reverse();

  const buyPct =
    latestFootprint && latestFootprint.totalVol > 0
      ? (latestFootprint.buyVol / latestFootprint.totalVol) * 100
      : 50;

  return (
    <div className="flex flex-col rounded-lg border border-[#1c2436] bg-[#090d14] overflow-hidden text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1c2436] bg-[#0c111b] px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-100">
            Time &amp; Sales Tape · BigTrades Calibration
          </span>
          {latestFootprint && (
            <span className="font-mono-num text-[10px] text-slate-400">
              Bar Prints: {latestFootprint.tradeCount} · ΔStr{" "}
              <strong
                className={
                  latestFootprint.deltaStrengthPct >= 0
                    ? "text-emerald-400"
                    : "text-rose-400"
                }
              >
                {latestFootprint.deltaStrengthPct > 0 ? "+" : ""}
                {latestFootprint.deltaStrengthPct}%
              </strong>
            </span>
          )}
        </div>

        {/* Section 15: Two adjustable BigTrades size thresholds (Large + Whale) */}
        {hasRealAggressorTape && (
          <div className="flex flex-wrap items-center gap-2 font-mono-num text-[10px] text-slate-300">
            <SlidersHorizontal className="h-3 w-3 text-slate-500" />
            <label className="flex items-center gap-1">
              <span className="text-slate-400">Large≥</span>
              <input
                type="number"
                step="0.05"
                min="0.01"
                value={customLarge ?? activeLarge}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  onChangeCustomLarge(n > 0 ? n : null);
                }}
                className="w-14 rounded border border-[#26324a] bg-[#090d14] px-1 py-0.5 text-[10px] text-slate-100"
              />
            </label>
            <label className="flex items-center gap-1">
              <span className="text-amber-300">Whale≥</span>
              <input
                type="number"
                step="0.1"
                min="0.05"
                value={customWhale ?? activeWhale}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  onChangeCustomWhale(n > 0 ? n : null);
                }}
                className="w-14 rounded border border-[#26324a] bg-[#090d14] px-1 py-0.5 text-[10px] text-amber-200"
              />
            </label>
            {(customLarge !== null || customWhale !== null) && (
              <button
                type="button"
                onClick={() => {
                  onChangeCustomLarge(null);
                  onChangeCustomWhale(null);
                }}
                className="rounded bg-[#162033] px-1.5 py-0.5 text-[10px] text-sky-300 hover:bg-[#1f2e48]"
              >
                Asia Auto
              </button>
            )}
          </div>
        )}
      </div>

      {!hasRealAggressorTape ? (
        <div className="p-4 text-center text-[11px] text-slate-500">
          Time &amp; Sales tape requires real tick feed (Kraken PAXG/USD or Databento CSV).
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12">
          {/* Active M5 Bar Order Flow Summary */}
          <div className="border-b border-[#1c2436] p-2.5 lg:col-span-4 lg:border-b-0 lg:border-r">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Latest M5 Bar Telemetry
            </div>
            {latestFootprint ? (
              <div className="mt-2 space-y-2">
                <div>
                  <div className="flex justify-between font-mono-num text-[10px]">
                    <span className="text-rose-400">
                      Sell {latestFootprint.sellVol.toFixed(2)} ({(100 - buyPct).toFixed(0)}%)
                    </span>
                    <span className="text-emerald-400">
                      Buy {latestFootprint.buyVol.toFixed(2)} ({buyPct.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-[#151d2e]">
                    <div
                      className="bg-rose-500/80"
                      style={{ width: `${100 - buyPct}%` }}
                    />
                    <div
                      className="bg-emerald-500/80"
                      style={{ width: `${buyPct}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-1.5 font-mono-num text-[10px]">
                  <div className="rounded bg-[#0d1320] p-1.5">
                    <div className="text-slate-500">Bar POC</div>
                    <div className="text-amber-300 font-semibold">
                      ${latestFootprint.pocPrice.toFixed(2)}
                    </div>
                  </div>
                  <div className="rounded bg-[#0d1320] p-1.5">
                    <div className="text-slate-500">Stacked Imb</div>
                    <div className="text-slate-200">
                      <span className="text-emerald-400">
                        {latestFootprint.stackedBuyImbalances}B
                      </span>{" "}
                      /{" "}
                      <span className="text-rose-400">
                        {latestFootprint.stackedSellImbalances}S
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1">
                  {latestFootprint.absorptionLow && (
                    <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 border border-emerald-500/40">
                      Absorption Low
                    </span>
                  )}
                  {latestFootprint.absorptionHigh && (
                    <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300 border border-rose-500/40">
                      Absorption High
                    </span>
                  )}
                  {latestFootprint.aggressionFlipBull && (
                    <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300 border border-sky-500/40">
                      Bull Aggression Flip
                    </span>
                  )}
                  {latestFootprint.aggressionFlipBear && (
                    <span className="rounded bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-orange-300 border border-orange-500/40">
                      Bear Aggression Flip
                    </span>
                  )}
                  {(latestFootprint.exhaustionLow || latestFootprint.exhaustionHigh) && (
                    <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300 border border-violet-500/40">
                      Exhaustion
                    </span>
                  )}
                  {(latestFootprint.cvdDivergenceBull ||
                    latestFootprint.cvdDivergenceBear) && (
                    <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300 border border-amber-500/40">
                      CVD Divergence
                    </span>
                  )}
                  {!latestFootprint.absorptionLow &&
                    !latestFootprint.absorptionHigh &&
                    !latestFootprint.aggressionFlipBull &&
                    !latestFootprint.aggressionFlipBear && (
                      <span className="text-[10px] text-slate-500">
                        No special signal on latest bar
                      </span>
                    )}
                </div>
              </div>
            ) : (
              <div className="mt-2 text-[11px] text-slate-500">
                Step replay to see live telemetry.
              </div>
            )}
          </div>

          {/* Scrolling Tape Prints */}
          <div className="max-h-36 overflow-y-auto p-2 lg:col-span-8">
            <div className="grid grid-cols-4 gap-2 border-b border-[#141c2c] pb-1 font-mono-num text-[10px] text-slate-500">
              <span>Time (PT)</span>
              <span>Price</span>
              <span className="text-right">Size</span>
              <span className="text-right">Aggressor</span>
            </div>
            <div className="divide-y divide-[#111826] font-mono-num text-[10px]">
              {recentTicks.map((t, i) => {
                const isWhale = t.size >= activeWhale;
                const isLarge = t.size >= activeLarge;
                return (
                  <div
                    key={`${t.ts}-${i}`}
                    className={`grid grid-cols-4 gap-2 py-0.5 px-1 rounded-xs ${
                      isWhale
                        ? "bg-amber-500/15 font-bold"
                        : isLarge
                          ? "bg-slate-800/50 font-semibold"
                          : ""
                    }`}
                  >
                    <span className="text-slate-500">{fmtTimeSec(t.ts)}</span>
                    <span className="text-slate-200">{t.price.toFixed(2)}</span>
                    <span
                      className={`text-right ${
                        isWhale
                          ? "text-amber-300"
                          : isLarge
                            ? "text-sky-300"
                            : "text-slate-300"
                      }`}
                    >
                      {t.size.toFixed(t.size >= 10 ? 1 : 3)}
                      {isWhale ? " ★" : isLarge ? " ●" : ""}
                    </span>
                    <span
                      className={`text-right uppercase ${
                        t.side === "buy"
                          ? "text-emerald-400"
                          : t.side === "sell"
                            ? "text-rose-400"
                            : "text-slate-500"
                      }`}
                    >
                      {t.side === "buy" ? "ASK (BUY)" : t.side === "sell" ? "BID (SELL)" : "N/A"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
