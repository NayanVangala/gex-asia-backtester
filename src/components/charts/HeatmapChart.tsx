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

export function HeatmapChart({
  l2Snapshots,
  ticks,
  onOpenCsvModal,
  heightClass = "h-[220px]",
}: HeatmapChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState({ width: 560, height: 220 });
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

    ctx.fillStyle = "#0b0d11";
    ctx.fillRect(0, 0, dims.width, dims.height);

    const padL = 8;
    const padR = 60;
    const padT = 8;
    const padB = 18;
    const plotW = Math.max(80, dims.width - padL - padR - 44);
    const domX = padL + plotW + 4;
    const domW = 40;
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

    slice.forEach((snap, idx) => {
      const x = padL + idx * colW;
      for (const b of snap.bids) {
        const y = priceToY(b.price);
        const norm = Math.min(1, b.size / maxSize);
        const r = Math.round(norm > 0.65 ? 212 * norm : 12);
        const g = Math.round(75 + 150 * norm);
        const bl = Math.round(norm > 0.7 ? 58 : 170);
        ctx.fillStyle = `rgba(${r}, ${g}, ${bl}, ${(0.16 + norm * 0.78).toFixed(2)})`;
        ctx.fillRect(x, y - 2, colW + 0.5, 4);
      }
      for (const a of snap.asks) {
        const y = priceToY(a.price);
        const norm = Math.min(1, a.size / maxSize);
        const r = Math.round(135 + 115 * norm);
        const g = Math.round(norm > 0.55 ? 140 * norm : 40);
        const bl = Math.round(norm > 0.55 ? 40 : 120);
        ctx.fillStyle = `rgba(${r}, ${g}, ${bl}, ${(0.16 + norm * 0.78).toFixed(2)})`;
        ctx.fillRect(x, y - 2, colW + 0.5, 4);
      }
    });

    ctx.strokeStyle = "#00c087";
    ctx.lineWidth = 1.1;
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

    ctx.strokeStyle = "#f6465d";
    ctx.lineWidth = 1.1;
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
        const rad = 2 + Math.min(7, (t.size / maxTickSz) * 7);
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fillStyle =
          t.side === "buy" ? "rgba(0, 192, 135, 0.55)" : "rgba(246, 70, 93, 0.55)";
        ctx.fill();
      }
    }

    const latest = slice[slice.length - 1];
    ctx.fillStyle = "#0f1217";
    ctx.fillRect(domX, padT, domW, plotH);
    for (const b of latest.bids) {
      const y = priceToY(b.price);
      const w = Math.max(2, (b.size / maxSize) * (domW - 2));
      ctx.fillStyle = "rgba(0, 192, 135, 0.65)";
      ctx.fillRect(domX, y - 2, w, 4);
    }
    for (const a of latest.asks) {
      const y = priceToY(a.price);
      const w = Math.max(2, (a.size / maxSize) * (domW - 2));
      ctx.fillStyle = "rgba(246, 70, 93, 0.65)";
      ctx.fillRect(domX, y - 2, w, 4);
    }

    ctx.font = "9px ui-monospace, monospace";
    ctx.fillStyle = "#626b7c";
    ctx.textAlign = "left";
    for (let i = 0; i <= 5; i++) {
      const p = maxP - (i / 5) * span;
      ctx.fillText(p.toFixed(2), dims.width - padR + 5, priceToY(p) + 3);
    }
    ctx.fillStyle = "#586070";
    ctx.fillText(formatPTTime(slice[0].ts), padL, dims.height - 4);
    ctx.fillText(formatPTTime(slice[slice.length - 1].ts), padL + plotW - 32, dims.height - 4);
  }, [dims, activeSnapshots, ticks, usingLive]);

  return (
    <div className="flex flex-col bg-[#0b0d11] border-t border-[#1c212b] overflow-hidden">
      <div className="flex h-7 items-center justify-between gap-2 border-b border-[#1c212b] bg-[#0f1217] px-2.5 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="font-medium text-[#e6e9ef]">L2 Orderbook Heatmap &amp; DOM</span>
          {usingLive && (
            <span className="font-mono-num text-[10px] text-[#00c087]">
              LIVE KRAKEN PAXG L2 ({liveSnapshots.length})
            </span>
          )}
          {l2Snapshots.length > 0 && (
            <span className="font-mono-num text-[10px] text-[#d4a03a]">
              REAL MBP-10 ({l2Snapshots.length})
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px]">
          {l2Snapshots.length === 0 && (
            <button
              type="button"
              onClick={() => setLiveRecording((v) => !v)}
              className={`rounded px-2 py-0.5 transition ${
                liveRecording
                  ? "bg-[#f6465d]/20 text-[#f6465d]"
                  : "bg-[#171c26] text-[#c8cfdc] hover:bg-[#222938]"
              }`}
            >
              {liveRecording ? "Stop Live L2" : "Record Live Kraken L2"}
            </button>
          )}
          <button
            type="button"
            onClick={onOpenCsvModal}
            className="rounded bg-[#171c26] px-2 py-0.5 text-[#c8cfdc] hover:bg-[#222938]"
          >
            Upload MBP-10 CSV
          </button>
        </div>
      </div>

      <div ref={containerRef} className={`relative w-full ${heightClass}`}>
        {activeSnapshots.length === 0 ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-[11px] text-[#7d8594]">
            <div className="max-w-md">
              No L2 depth loaded (model priority #5; optional). Upload a Databento{" "}
              <code className="text-[#c8cfdc]">mbp-10</code> CSV or click{" "}
              <span className="text-[#e6e9ef] font-medium">Record Live Kraken L2</span>{" "}
              to stream real gold orderbook depth.
              {liveError && <div className="mt-1 text-[#f6465d]">{liveError}</div>}
            </div>
          </div>
        ) : (
          <canvas ref={canvasRef} className="block h-full w-full" />
        )}
      </div>
    </div>
  );
}
