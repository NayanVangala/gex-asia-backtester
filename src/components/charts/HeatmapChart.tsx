"use client";

import React, { useEffect, useRef, useState } from "react";
import { L2Snapshot, Tick } from "@/lib/types";
import { formatPTTime } from "@/lib/goldMath";
import { ATAS_ASIA_THEME as T } from "@/lib/atasTheme";

interface HeatmapChartProps {
  l2Snapshots: L2Snapshot[];
  ticks: Tick[];
  onOpenCsvModal: () => void;
  heightClass?: string;
}

/**
 * Exact ATAS X Heatmap (G1.W0 from Asia_Template_Fixed.aws):
 * - SelectedPalette: "darkToRed" (obsidian -> deep red -> bright crimson -> hot orange/yellow)
 * - BestPriceLineBidColor: White | BestPriceLineAskColor: Cyan (#3BEFF0)
 * - BubbleBuyColor: White | BubbleSellColor: Cyan (#3BEFF0), log-scaled bubbles
 * Renders ONLY real Databento mbp-10 CSV snapshots or Live Kraken PAXG/USD L2 depth.
 */
function darkToRedColor(norm: number): string {
  const n = Math.max(0, Math.min(1, norm));
  if (n < 0.35) {
    const t = n / 0.35;
    return `rgba(${Math.round(40 + 110 * t)}, ${Math.round(8 * t)}, ${Math.round(14 * t)}, ${(0.22 + t * 0.45).toFixed(2)})`;
  }
  if (n < 0.72) {
    const t = (n - 0.35) / 0.37;
    return `rgba(${Math.round(150 + 105 * t)}, ${Math.round(10 + 55 * t)}, ${Math.round(14 * (1 - t))}, ${(0.67 + t * 0.23).toFixed(2)})`;
  }
  const t = (n - 0.72) / 0.28;
  return `rgba(255, ${Math.round(65 + 175 * t)}, ${Math.round(45 * t)}, ${(0.9 + t * 0.1).toFixed(2)})`;
}

export function HeatmapChart({
  l2Snapshots,
  ticks,
  onOpenCsvModal,
  heightClass = "h-full min-h-[320px]",
}: HeatmapChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState({ width: 560, height: 360 });
  const [liveRecording, setLiveRecording] = useState(false);
  const [liveSnapshots, setLiveSnapshots] = useState<L2Snapshot[]>([]);
  const [liveError, setLiveError] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        setDims({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!liveRecording) return;
    let active = true;

    const pull = async () => {
      try {
        const res = await fetch("/api/market/depth", { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Depth fetch failed");
        if (active && json.snapshot) {
          setLiveSnapshots((prev) => [...prev.slice(-119), json.snapshot as L2Snapshot]);
          setLiveError(null);
        }
      } catch (e) {
        if (active) setLiveError(e instanceof Error ? e.message : "Live depth error");
      }
    };

    pull();
    const timer = setInterval(pull, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [liveRecording]);

  const activeSnapshots = l2Snapshots.length > 0 ? l2Snapshots : liveSnapshots;
  const usingLive = l2Snapshots.length === 0 && liveSnapshots.length > 0;

  useEffect(() => {
    if (activeSnapshots.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = dims.width * dpr;
    canvas.height = dims.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const padL = 8;
    const padR = 64;
    const domW = 50;
    const padT = 10;
    const padB = 20;
    const axisX = dims.width - padR;
    const domX = axisX - domW;
    const plotW = Math.max(80, domX - padL - 4);
    const timeY = dims.height - padB;
    const plotH = Math.max(60, timeY - padT);

    // Pure ATAS darkToRed obsidian canvas
    ctx.fillStyle = "#05060A";
    ctx.fillRect(0, 0, axisX, timeY);
    ctx.fillStyle = T.chrome.panelBg;
    ctx.fillRect(axisX, 0, padR, dims.height);
    ctx.fillRect(0, timeY, dims.width, padB);

    const slice = activeSnapshots.slice(-110);
    let minP = Infinity;
    let maxP = -Infinity;
    let maxSize = 0;

    for (const s of slice) {
      for (const b of s.bids) {
        if (b.price < minP) minP = b.price;
        if (b.price > maxP) maxP = b.price;
        if (b.size > maxSize) maxSize = b.size;
      }
      for (const a of s.asks) {
        if (a.price < minP) minP = a.price;
        if (a.price > maxP) maxP = a.price;
        if (a.size > maxSize) maxSize = a.size;
      }
    }
    if (!Number.isFinite(minP) || maxSize <= 0) return;
    const span = Math.max(0.5, maxP - minP);
    const priceToY = (p: number) => padT + ((maxP - p) / span) * plotH;
    const colW = Math.max(2, plotW / Math.max(1, slice.length));

    // ATAS darkToRed liquidity heat bands
    slice.forEach((snap, idx) => {
      const x = padL + idx * colW;
      for (const b of snap.bids) {
        ctx.fillStyle = darkToRedColor(b.size / maxSize);
        ctx.fillRect(x, priceToY(b.price) - 2, colW + 0.6, 4);
      }
      for (const a of snap.asks) {
        ctx.fillStyle = darkToRedColor(a.size / maxSize);
        ctx.fillRect(x, priceToY(a.price) - 2, colW + 0.6, 4);
      }
    });

    // ATAS Best Bid Line (White) & Best Ask Line (Cyan #3BEFF0)
    ctx.strokeStyle = T.heatmap.bestBidLine;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    slice.forEach((s, idx) => {
      const bb = s.bids[0]?.price;
      if (!bb) return;
      const x = padL + idx * colW + colW / 2;
      const y = priceToY(bb);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.strokeStyle = T.heatmap.bestAskLine;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    slice.forEach((s, idx) => {
      const ba = s.asks[0]?.price;
      if (!ba) return;
      const x = padL + idx * colW + colW / 2;
      const y = priceToY(ba);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // ATAS Log-Scaled White (Buy) & Cyan (Sell) Trade Bubbles
    const startTs = slice[0].ts;
    const endTs = slice[slice.length - 1].ts;
    if (!usingLive && ticks.length > 0 && endTs > startTs) {
      const inRange = ticks.filter((t) => t.ts >= startTs && t.ts <= endTs);
      const maxTickSz = Math.max(...inRange.map((t) => t.size), 1);
      for (const t of inRange.slice(-300)) {
        const frac = (t.ts - startTs) / Math.max(1, endTs - startTs);
        const cx = padL + frac * plotW;
        const cy = priceToY(t.price);
        if (cy < padT || cy > timeY) continue;
        const rad = 2.5 + Math.log1p((t.size / maxTickSz) * 15) * 4;
        ctx.save();
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.min(18, rad), 0, Math.PI * 2);
        ctx.fillStyle = t.side === "buy" ? T.heatmap.bubbleBuy : T.heatmap.bubbleSell;
        ctx.fill();
        ctx.restore();
      }
    }

    // Current DOM resting ladder column
    const latest = slice[slice.length - 1];
    ctx.fillStyle = T.smartDom.bg;
    ctx.fillRect(domX, 0, domW, timeY);
    for (const b of latest.bids) {
      const y = priceToY(b.price);
      const w = Math.max(2, (b.size / maxSize) * (domW - 4));
      ctx.fillStyle = T.smartDom.bidBar;
      ctx.fillRect(domX + 2, y - 2, w, 4);
    }
    for (const a of latest.asks) {
      const y = priceToY(a.price);
      const w = Math.max(2, (a.size / maxSize) * (domW - 4));
      ctx.fillStyle = T.smartDom.askBar;
      ctx.fillRect(domX + 2, y - 2, w, 4);
    }

    // Axis ticks
    ctx.font = "10px 'Segoe UI', monospace";
    ctx.fillStyle = T.chrome.textSecondary;
    ctx.textAlign = "left";
    for (let i = 0; i <= 6; i++) {
      const p = maxP - (i / 6) * span;
      ctx.fillText(p.toFixed(2), axisX + 5, priceToY(p) + 3);
    }
    ctx.fillText(formatPTTime(slice[0].ts), padL, dims.height - 5);
    ctx.fillText(formatPTTime(slice[slice.length - 1].ts), domX - 38, dims.height - 5);
  }, [dims, activeSnapshots, ticks, usingLive]);

  return (
    <div className="flex flex-col h-full bg-[#05060A] overflow-hidden">
      <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-[#2A2E39] bg-[#151B26] px-2.5 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="font-medium text-[#F1F1F1]">Heatmap (darkToRed · White/Cyan)</span>
          {usingLive && (
            <span className="font-mono-num text-[10px] text-[#3BEFF0]">
              LIVE KRAKEN PAXG L2 ({liveSnapshots.length})
            </span>
          )}
          {l2Snapshots.length > 0 && (
            <span className="font-mono-num text-[10px] text-[#089981]">
              MBP-10 ({l2Snapshots.length})
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px]">
          {l2Snapshots.length === 0 && (
            <button
              type="button"
              onClick={() => setLiveRecording((v) => !v)}
              className={`rounded-xs px-2 py-0.5 ${
                liveRecording
                  ? "bg-[#F2385A] text-white"
                  : "bg-[#1A2333] text-[#F1F1F1] border border-[#2A2E39] hover:bg-[#243147]"
              }`}
            >
              {liveRecording ? "Stop Live L2" : "Record Live Kraken L2"}
            </button>
          )}
          <button
            type="button"
            onClick={onOpenCsvModal}
            className="rounded-xs bg-[#1A2333] px-2 py-0.5 text-[#F1F1F1] border border-[#2A2E39] hover:bg-[#243147]"
          >
            Upload MBP-10 CSV
          </button>
        </div>
      </div>

      <div ref={containerRef} className={`relative flex-1 w-full ${heightClass}`}>
        {activeSnapshots.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-[11px] text-[#ABAEB8]">
            <div className="max-w-sm rounded border border-[#2A2E39] bg-[#151B26] p-4">
              <div className="font-semibold text-[#F1F1F1]">
                ATAS Heatmap · darkToRed Palette
              </div>
              <p className="mt-1.5 leading-relaxed text-[#ABAEB8]">
                No Level 2 depth loaded (same as ATAS delayed feed). Upload a Databento{" "}
                <code className="text-[#3BEFF0]">mbp-10</code> CSV for historical GC depth or click{" "}
                <strong className="text-white">Record Live Kraken L2</strong> above.
              </p>
              {liveError && <div className="mt-1.5 text-[#F2385A]">{liveError}</div>}
            </div>
          </div>
        ) : (
          <canvas ref={canvasRef} className="block h-full w-full" />
        )}
      </div>
    </div>
  );
}
