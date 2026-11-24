"use client";

import React, { useEffect, useRef, useState } from "react";
import { L2Snapshot, Tick } from "@/lib/types";
import { formatPTTime } from "@/lib/goldMath";

interface HeatmapChartProps {
  l2Snapshots: L2Snapshot[];
  ticks: Tick[];
  onOpenCsvModal: () => void;
  heightClass?: string;
}

/**
 * Optional L2 Depth-of-Market Heatmap (Priority #5 in Asia Value Model; off by default).
 * Renders real resting orderbook depth bands ONLY from:
 * 1) Uploaded Databento GLBX.MDP3 mbp-10 CSV snapshots, OR
 * 2) User-started live Kraken PAXG/USD real L2 depth recorder.
 * Never fabricates resting liquidity from OHLCV.
 */
export function HeatmapChart({
  l2Snapshots,
  ticks,
  onOpenCsvModal,
  heightClass = "h-[240px]",
}: HeatmapChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState({ width: 560, height: 240 });
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

  // Optional live Kraken PAXG/USD real L2 recorder (polls every 3s while toggled on)
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

    ctx.fillStyle = "#070a10";
    ctx.fillRect(0, 0, dims.width, dims.height);

    const padL = 8;
    const padR = 62;
    const padT = 10;
    const padB = 18;
    const plotW = Math.max(80, dims.width - padL - padR - 46); // leave right 46px for current DOM ladder
    const domX = padL + plotW + 4;
    const domW = 42;
    const plotH = Math.max(60, dims.height - padT - padB);

    const slice = activeSnapshots.slice(-100);
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

    // Render resting orderbook liquidity heat columns
    slice.forEach((snap, idx) => {
      const x = padL + idx * colW;
      for (const b of snap.bids) {
        const y = priceToY(b.price);
        const norm = Math.min(1, b.size / maxSize);
        // Deep blue -> cyan -> bright gold for heavy resting bid walls
        const r = Math.round(norm > 0.6 ? 245 * norm : 15);
        const g = Math.round(80 + 170 * norm);
        const bl = Math.round(norm > 0.7 ? 70 : 195);
        ctx.fillStyle = `rgba(${r}, ${g}, ${bl}, ${(0.18 + norm * 0.78).toFixed(2)})`;
        ctx.fillRect(x, y - 2, colW + 0.5, 4);
      }
      for (const a of snap.asks) {
        const y = priceToY(a.price);
        const norm = Math.min(1, a.size / maxSize);
        // Deep violet -> orange -> hot amber for heavy resting ask walls
        const r = Math.round(140 + 115 * norm);
        const g = Math.round(norm > 0.55 ? 160 * norm : 45);
        const bl = Math.round(norm > 0.55 ? 40 : 150);
        ctx.fillStyle = `rgba(${r}, ${g}, ${bl}, ${(0.18 + norm * 0.78).toFixed(2)})`;
        ctx.fillRect(x, y - 2, colW + 0.5, 4);
      }
    });

    // Draw best bid & best ask lines across snapshots
    ctx.strokeStyle = "#34d399";
    ctx.lineWidth = 1.2;
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

    ctx.strokeStyle = "#fb7185";
    ctx.lineWidth = 1.2;
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

    // Overlay real trade bubbles if ticks overlap snapshot time window
    const startTs = slice[0].ts;
    const endTs = slice[slice.length - 1].ts;
    if (!usingLive && ticks.length > 0 && endTs > startTs) {
      const inRange = ticks.filter((t) => t.ts >= startTs && t.ts <= endTs);
      const maxTickSz = Math.max(...inRange.map((t) => t.size), 1);
      for (const t of inRange.slice(-300)) {
        const frac = (t.ts - startTs) / Math.max(1, endTs - startTs);
        const cx = padL + frac * plotW;
        const cy = priceToY(t.price);
        if (cy < padT || cy > padT + plotH) continue;
        const rad = 2 + Math.min(8, (t.size / maxTickSz) * 8);
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fillStyle =
          t.side === "buy"
            ? "rgba(34, 197, 94, 0.58)"
            : "rgba(244, 63, 94, 0.58)";
        ctx.fill();
      }
    }

    // Right-side Current DOM Bars (latest snapshot resting sizes)
    const latest = slice[slice.length - 1];
    ctx.fillStyle = "#0b0f18";
    ctx.fillRect(domX, padT, domW, plotH);
    for (const b of latest.bids) {
      const y = priceToY(b.price);
      const w = Math.max(2, (b.size / maxSize) * (domW - 2));
      ctx.fillStyle = "rgba(16, 185, 129, 0.65)";
      ctx.fillRect(domX, y - 2, w, 4);
    }
    for (const a of latest.asks) {
      const y = priceToY(a.price);
      const w = Math.max(2, (a.size / maxSize) * (domW - 2));
      ctx.fillStyle = "rgba(244, 63, 94, 0.65)";
      ctx.fillRect(domX, y - 2, w, 4);
    }

    // Price Axis
    ctx.font = "9px ui-monospace, monospace";
    ctx.fillStyle = "#7c8aa5";
    ctx.textAlign = "left";
    for (let i = 0; i <= 5; i++) {
      const p = maxP - (i / 5) * span;
      const y = priceToY(p);
      ctx.fillText(p.toFixed(2), dims.width - padR + 4, y + 3);
    }

    // Time ticks
    ctx.fillStyle = "#64748b";
    ctx.fillText(formatPTTime(slice[0].ts), padL, dims.height - 4);
    ctx.fillText(
      formatPTTime(slice[slice.length - 1].ts),
      padL + plotW - 32,
      dims.height - 4
    );
  }, [dims, activeSnapshots, ticks, usingLive]);

  return (
    <div className="flex flex-col rounded-lg border border-[#1c2436] bg-[#090d14] overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1c2436] bg-[#0c111b] px-3 py-1.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-100">
            L2 Orderbook Heatmap & DOM
          </span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            Optional · Priority #5
          </span>
          {usingLive && (
            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300 border border-emerald-500/40">
              LIVE KRAKEN PAXG L2 ({liveSnapshots.length} frames)
            </span>
          )}
          {l2Snapshots.length > 0 && (
            <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-300 border border-sky-500/40">
              REAL MBP-10 ({l2Snapshots.length} frames)
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {l2Snapshots.length === 0 && (
            <button
              type="button"
              onClick={() => setLiveRecording((v) => !v)}
              className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${
                liveRecording
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                  : "bg-[#141c2c] text-slate-300 border border-slate-700 hover:bg-[#1c273d]"
              }`}
            >
              {liveRecording ? "Stop Live L2 Capture" : "Record Live Kraken L2"}
            </button>
          )}
          <button
            type="button"
            onClick={onOpenCsvModal}
            className="rounded bg-[#141c2c] px-2 py-0.5 text-[11px] text-slate-300 border border-slate-700 hover:bg-[#1c273d]"
          >
            Upload MBP-10 CSV
          </button>
        </div>
      </div>

      <div ref={containerRef} className={`relative w-full ${heightClass}`}>
        {activeSnapshots.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-5 text-center">
            <div className="max-w-lg rounded-lg border border-slate-700/70 bg-[#0d121d] p-4">
              <div className="text-xs font-semibold text-slate-200">
                No Historical Level 2 Orderbook Loaded
              </div>
              <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">
                Asia Value Model reads absorption from Volume Profile + M5
                Footprint + CVD (executed trades beat resting orders). Heatmap is
                ready whenever you drop a Databento{" "}
                <code className="text-sky-300">GLBX.MDP3 mbp-10</code> CSV, or
                click <strong className="text-slate-200">Record Live Kraken L2</strong>{" "}
                above to watch real live gold depth walls stream in.
              </p>
              {liveError && (
                <p className="mt-2 text-[11px] text-rose-400">{liveError}</p>
              )}
            </div>
          </div>
        ) : (
          <canvas ref={canvasRef} className="block h-full w-full" />
        )}
      </div>
    </div>
  );
}
