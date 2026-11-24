"use client";

import React from "react";
import { FootprintBar, Tick } from "@/lib/types";

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
  const recentTicks = ticks.slice(-24).reverse();

  const buyPct =
    latestFootprint && latestFootprint.totalVol > 0
      ? (latestFootprint.buyVol / latestFootprint.totalVol) * 100
      : 50;

  return (
    <div className="flex flex-col border-t border-[#1c212b] bg-[#0b0d11] text-[11px]">
      <div className="flex h-7 items-center justify-between gap-2 border-b border-[#1c212b] bg-[#0f1217] px-2.5">
        <div className="flex items-center gap-3">
          <span className="font-medium text-[#e6e9ef]">Time &amp; Sales Tape</span>
          {latestFootprint && (
            <span className="font-mono-num text-[10px] text-[#7d8594]">
              {latestFootprint.tradeCount} prints · ΔStr{" "}
              <strong
                className={
                  latestFootprint.deltaStrengthPct >= 0
                    ? "text-[#00c087]"
                    : "text-[#f6465d]"
                }
              >
                {latestFootprint.deltaStrengthPct > 0 ? "+" : ""}
                {latestFootprint.deltaStrengthPct}%
              </strong>
            </span>
          )}
        </div>

        {hasRealAggressorTape && (
          <div className="flex items-center gap-2 font-mono-num text-[10px] text-[#8b94a5]">
            <label className="flex items-center gap-1">
              <span>Large≥</span>
              <input
                type="number"
                step="0.05"
                min="0.01"
                value={customLarge ?? activeLarge}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  onChangeCustomLarge(n > 0 ? n : null);
                }}
                className="w-12 rounded bg-[#151922] px-1 py-0.5 text-[10px] text-[#e6e9ef] border border-[#222836]"
              />
            </label>
            <label className="flex items-center gap-1">
              <span className="text-[#d4a03a]">Whale≥</span>
              <input
                type="number"
                step="0.1"
                min="0.05"
                value={customWhale ?? activeWhale}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  onChangeCustomWhale(n > 0 ? n : null);
                }}
                className="w-12 rounded bg-[#151922] px-1 py-0.5 text-[10px] text-[#eab854] border border-[#222836]"
              />
            </label>
            {(customLarge !== null || customWhale !== null) && (
              <button
                type="button"
                onClick={() => {
                  onChangeCustomLarge(null);
                  onChangeCustomWhale(null);
                }}
                className="text-[10px] text-[#c8cfdc] underline"
              >
                Auto
              </button>
            )}
          </div>
        )}
      </div>

      {!hasRealAggressorTape ? (
        <div className="px-3 py-3 text-[11px] text-[#586070]">
          Time &amp; Sales disabled on OHLCV feed.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12">
          <div className="border-b border-[#1c212b] p-2.5 lg:col-span-4 lg:border-b-0 lg:border-r">
            {latestFootprint && (
              <div className="space-y-2">
                <div className="flex justify-between font-mono-num text-[10px]">
                  <span className="text-[#f6465d]">
                    Bid {latestFootprint.sellVol.toFixed(2)}
                  </span>
                  <span className="text-[#7d8594]">
                    POC ${latestFootprint.pocPrice.toFixed(2)}
                  </span>
                  <span className="text-[#00c087]">
                    Ask {latestFootprint.buyVol.toFixed(2)}
                  </span>
                </div>
                <div className="flex h-1.5 overflow-hidden rounded-full bg-[#171c26]">
                  <div className="bg-[#f6465d]" style={{ width: `${100 - buyPct}%` }} />
                  <div className="bg-[#00c087]" style={{ width: `${buyPct}%` }} />
                </div>
                <div className="flex flex-wrap gap-1.5 font-mono-num text-[10px] text-[#8b94a5]">
                  <span>
                    Imb: <strong className="text-[#00c087]">{latestFootprint.stackedBuyImbalances}B</strong>/
                    <strong className="text-[#f6465d]">{latestFootprint.stackedSellImbalances}S</strong>
                  </span>
                  {latestFootprint.absorptionLow && <span className="text-[#d4a03a]">· ABS↓</span>}
                  {latestFootprint.absorptionHigh && <span className="text-[#d4a03a]">· ABS↑</span>}
                  {latestFootprint.aggressionFlipBull && <span className="text-[#00c087]">· FLIP↑</span>}
                  {latestFootprint.aggressionFlipBear && <span className="text-[#f6465d]">· FLIP↓</span>}
                </div>
              </div>
            )}
          </div>

          <div className="max-h-28 overflow-y-auto px-2.5 py-1.5 lg:col-span-8">
            <div className="divide-y divide-[#131720] font-mono-num text-[10px]">
              {recentTicks.map((t, i) => {
                const isWhale = t.size >= activeWhale;
                const isLarge = t.size >= activeLarge;
                return (
                  <div
                    key={`${t.ts}-${i}`}
                    className={`grid grid-cols-4 gap-2 py-0.5 ${
                      isWhale ? "bg-[#1c1912] font-semibold" : isLarge ? "bg-[#12161f]" : ""
                    }`}
                  >
                    <span className="text-[#586070]">{fmtTimeSec(t.ts)}</span>
                    <span className="text-[#e6e9ef]">{t.price.toFixed(2)}</span>
                    <span
                      className={`text-right ${
                        isWhale ? "text-[#eab854]" : isLarge ? "text-[#e6e9ef]" : "text-[#8b94a5]"
                      }`}
                    >
                      {t.size.toFixed(t.size >= 10 ? 1 : 3)}
                      {isWhale ? " ★" : ""}
                    </span>
                    <span
                      className={`text-right ${
                        t.side === "buy"
                          ? "text-[#00c087]"
                          : t.side === "sell"
                            ? "text-[#f6465d]"
                            : "text-[#586070]"
                      }`}
                    >
                      {t.side === "buy" ? "ASK (BUY)" : t.side === "sell" ? "BID (SELL)" : "-"}
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
