"use client";

import React, { useEffect, useRef, useState } from "react";
import { FootprintBar } from "@/lib/types";
import { formatPTTime } from "@/lib/goldMath";

interface CvdChartProps {
  bars: FootprintBar[];
  hasRealAggressorTape: boolean;
  heightClass?: string;
}

export function CvdChart({
  bars,
  hasRealAggressorTape,
  heightClass = "h-full min-h-[150px]",
}: CvdChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState({ width: 560, height: 160 });

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

  const slice = bars.slice(-60);

  useEffect(() => {
    if (!hasRealAggressorTape) return;
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

    if (slice.length === 0) return;

    const padL = 10;
    const padR = 56;
    const padT = 10;
    const padB = 20;
    const axisX = dims.width - padR;
    const plotW = Math.max(80, dims.width - padL - padR);
    const plotH = Math.max(40, dims.height - padT - padB);

    ctx.strokeStyle = "#171b24";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axisX + 0.5, 0);
    ctx.lineTo(axisX + 0.5, dims.height - padB);
    ctx.moveTo(0, dims.height - padB + 0.5);
    ctx.lineTo(dims.width, dims.height - padB + 0.5);
    ctx.stroke();

    const cvds = slice.map((b) => b.cumDelta);
    const minC = Math.min(0, ...cvds);
    const maxC = Math.max(0, ...cvds);
    const span = Math.max(0.1, maxC - minC);
    const cvdToY = (v: number) => padT + ((maxC - v) / span) * plotH;

    // Zero line
    const y0 = Math.round(cvdToY(0)) + 0.5;
    ctx.strokeStyle = "#1f2533";
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(padL, y0);
    ctx.lineTo(axisX, y0);
    ctx.stroke();
    ctx.setLineDash([]);

    const stepX = plotW / Math.max(1, slice.length);
    const maxAbsDelta = Math.max(...slice.map((b) => Math.abs(b.delta)), 0.01);

    for (let i = 0; i < slice.length; i++) {
      const b = slice[i];
      const cx = padL + i * stepX + stepX / 2;
      const bw = Math.max(2, stepX * 0.52);
      const bh = (Math.abs(b.delta) / maxAbsDelta) * (plotH * 0.34);
      ctx.fillStyle =
        b.delta >= 0 ? "rgba(0, 192, 135, 0.25)" : "rgba(246, 70, 93, 0.25)";
      if (b.delta >= 0) {
        ctx.fillRect(cx - bw / 2, y0 - bh, bw, bh);
      } else {
        ctx.fillRect(cx - bw / 2, y0, bw, bh);
      }
    }

    // Crisp ivory CVD curve
    ctx.strokeStyle = "#d0d7e3";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    slice.forEach((b, i) => {
      const x = padL + i * stepX + stepX / 2;
      const y = cvdToY(b.cumDelta);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Divergence dots
    slice.forEach((b, i) => {
      if (!b.cvdDivergenceBull && !b.cvdDivergenceBear) return;
      const x = padL + i * stepX + stepX / 2;
      const y = cvdToY(b.cumDelta);
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = b.cvdDivergenceBull ? "#00c087" : "#f6465d";
      ctx.fill();
    });

    // Latest CVD badge
    const last = slice[slice.length - 1];
    const ly = cvdToY(last.cumDelta);
    ctx.fillStyle = last.cumDelta >= 0 ? "#00a876" : "#dc354d";
    ctx.fillRect(axisX + 1, ly - 7, padR - 3, 14);
    ctx.fillStyle = "#ffffff";
    ctx.font = "600 9.5px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText(
      (last.cumDelta > 0 ? "+" : "") + last.cumDelta.toFixed(1),
      axisX + 5,
      ly + 3
    );

    ctx.fillStyle = "#586070";
    ctx.font = "9px ui-monospace, monospace";
    const every = Math.max(1, Math.floor(slice.length / 6));
    for (let i = 0; i < slice.length; i += every) {
      const x = padL + i * stepX + stepX / 2;
      ctx.fillText(formatPTTime(slice[i].ts), x - 14, dims.height - 5);
    }
  }, [dims, slice, hasRealAggressorTape]);

  const latest = slice[slice.length - 1];

  return (
    <div className="flex flex-col bg-[#0b0d11] overflow-hidden h-full">
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-[#1c212b] bg-[#0f1217] px-2.5 text-[11px]">
        <span className="font-medium text-[#e6e9ef]">CVD &amp; Bar Delta</span>
        {hasRealAggressorTape && latest ? (
          <div className="flex items-center gap-3 font-mono-num text-[10px]">
            <span className={latest.delta >= 0 ? "text-[#00c087]" : "text-[#f6465d]"}>
              Δ {latest.delta > 0 ? "+" : ""}
              {latest.delta.toFixed(2)}
            </span>
            <span className="text-[#d0d7e3]">
              CVD {latest.cumDelta > 0 ? "+" : ""}
              {latest.cumDelta.toFixed(2)}
            </span>
          </div>
        ) : (
          <span className="text-[10px] text-[#586070]">OHLCV only</span>
        )}
      </div>
      <div ref={containerRef} className={`relative flex-1 w-full ${heightClass}`}>
        {!hasRealAggressorTape ? (
          <div className="flex h-full items-center justify-center text-[11px] text-[#586070]">
            CVD disabled on OHLCV-only feed.
          </div>
        ) : (
          <canvas ref={canvasRef} className="block h-full w-full" />
        )}
      </div>
    </div>
  );
}
