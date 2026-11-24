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
  const recentTicks = ticks.slice(-80).reverse();

  return (
    <div className="flex flex-col h-full bg-[#151B26] text-[11px] overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2A2E39] bg-[#1A2333] px-2.5 py-1.5">
        <span className="font-semibold text-[#F1F1F1]">
          Smart Tape · BigTrades Calibration
        </span>

        {hasRealAggressorTape && (
          <div className="flex items-center gap-2 font-mono-num text-[10px] text-[#ABAEB8]">
            <label className="flex items-center gap-1">
              <span className="text-[#0073FF]">Large≥</span>
              <input
                type="number"
                step="0.05"
                min="0.01"
                value={customLarge ?? activeLarge}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  onChangeCustomLarge(n > 0 ? n : null);
                }}
                className="w-12 rounded-xs bg-[#111620] px-1 py-0.5 text-[#F1F1F1] border border-[#2A2E39]"
              />
            </label>
            <label className="flex items-center gap-1">
              <span className="text-[#3BEFF0]">Whale≥</span>
              <input
                type="number"
                step="0.1"
                min="0.05"
                value={customWhale ?? activeWhale}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  onChangeCustomWhale(n > 0 ? n : null);
                }}
                className="w-12 rounded-xs bg-[#111620] px-1 py-0.5 text-[#3BEFF0] border border-[#2A2E39]"
              />
            </label>
            {(customLarge !== null || customWhale !== null) && (
              <button
                type="button"
                onClick={() => {
                  onChangeCustomLarge(null);
                  onChangeCustomWhale(null);
                }}
                className="text-[#3BEFF0] underline"
              >
                Auto
              </button>
            )}
          </div>
        )}
      </div>

      {!hasRealAggressorTape ? (
        <div className="flex flex-1 items-center justify-center text-[#ABAEB8]">
          Smart Tape requires real tick feed (PAXG Tape or Databento CSV).
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-2.5 py-1.5 font-mono-num text-[10.5px]">
          {latestFootprint && (
            <div className="mb-2 flex items-center justify-between rounded-xs bg-[#1A2333] px-2.5 py-1.5 border border-[#2A2E39]">
              <span className="text-[#F2385A]">Bid {latestFootprint.sellVol.toFixed(2)}</span>
              <span className="text-[#FF4900] font-semibold">POC ${latestFootprint.pocPrice.toFixed(2)}</span>
              <span className="text-[#089981]">Ask {latestFootprint.buyVol.toFixed(2)}</span>
              <span className="text-[#F1F1F1]">ΔStr {latestFootprint.deltaStrengthPct > 0 ? "+" : ""}{latestFootprint.deltaStrengthPct}%</span>
            </div>
          )}
          <div className="grid grid-cols-4 border-b border-[#2A2E39] pb-1 text-[10px] text-[#ABAEB8]">
            <span>Time (PT)</span>
            <span>Price</span>
            <span className="text-right">Volume</span>
            <span className="text-right">Side</span>
          </div>
          <div className="divide-y divide-[#1E2534]">
            {recentTicks.map((t, i) => {
              const isWhale = t.size >= activeWhale;
              const isLarge = t.size >= activeLarge;
              return (
                <div
                  key={`${t.ts}-${i}`}
                  className={`grid grid-cols-4 py-0.5 px-1 ${
                    isWhale
                      ? t.side === "buy"
                        ? "bg-[#3BEFF0]/20 font-bold"
                        : "bg-[#D900FC]/25 font-bold"
                      : isLarge
                        ? t.side === "buy"
                          ? "bg-[#0073FF]/20 font-semibold"
                          : "bg-[#F2385A]/20 font-semibold"
                        : ""
                  }`}
                >
                  <span className="text-[#ABAEB8]">{fmtTimeSec(t.ts)}</span>
                  <span className="text-[#F1F1F1]">{t.price.toFixed(2)}</span>
                  <span className="text-right text-[#F1F1F1]">
                    {t.size.toFixed(t.size >= 10 ? 1 : 3)}
                  </span>
                  <span
                    className={`text-right ${
                      t.side === "buy"
                        ? "text-[#089981]"
                        : t.side === "sell"
                          ? "text-[#F2385A]"
                          : "text-[#ABAEB8]"
                    }`}
                  >
                    {t.side === "buy" ? "ASK (BUY)" : t.side === "sell" ? "BID (SELL)" : "-"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
