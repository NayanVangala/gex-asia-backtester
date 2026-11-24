"use client";

import React, { useEffect, useRef, useState } from "react";
import { FootprintBar } from "@/lib/types";
import { formatPTTime } from "@/lib/goldMath";
import { ATAS_ASIA_THEME as T } from "@/lib/atasTheme";

interface CvdChartProps {
  bars: FootprintBar[];
  hasRealAggressorTape: boolean;
  heightClass?: string;
}

/**
 * Exact ATAS CumulativeDelta Sub-Panel from Asia_Template_Fixed.aws:
 *   Mode: "candles"
 *   PosColor: Green (#009900)
 *   NegColor: rgb(255, 58, 58) (#FF3A3A)
 *   Separator: #434651
 */
export function CvdChart({
  bars,
  hasRealAggressorTape,
  heightClass = "h-[145px]",
}: CvdChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState({ width: 560, height: 145 });

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

  const slice = bars.slice(-65);

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

    const padL = 8;
    const padR = 66;
    const padT = 16;
    const padB = 18;
    const axisX = dims.width - padR;
    const timeY = dims.height - padB;
    const plotW = Math.max(80, axisX - padL - 24);
    const plotH = Math.max(40, timeY - padT);

    // ATAS dark navy-black continuation background
    ctx.fillStyle = "#00000A";
    ctx.fillRect(0, 0, axisX, timeY);
    ctx.fillStyle = T.chrome.panelBg;
    ctx.fillRect(axisX, 0, padR, dims.height);
    ctx.fillRect(0, timeY, dims.width, padB);

    ctx.strokeStyle = T.chrome.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axisX + 0.5, 0);
    ctx.lineTo(axisX + 0.5, dims.height);
    ctx.moveTo(0, timeY + 0.5);
    ctx.lineTo(dims.width, timeY + 0.5);
    ctx.stroke();

    if (slice.length === 0) return;

    // Build CVD OHLC candles per bar (open = prev cumDelta, high = open + maxDelta, low = open + minDelta, close = cumDelta)
    const cvdCandles = slice.map((b) => {
      const open = b.cumDelta - b.delta;
      const close = b.cumDelta;
      const high = Math.max(open, close, open + b.maxDelta);
      const low = Math.min(open, close, open + b.minDelta);
      return { ts: b.ts, open, high, low, close, bullDiv: b.cvdDivergenceBull, bearDiv: b.cvdDivergenceBear };
    });

    let minC = Infinity;
    let maxC = -Infinity;
    for (const c of cvdCandles) {
      if (c.low < minC) minC = c.low;
      if (c.high > maxC) maxC = c.high;
    }
    const pad = Math.max(0.5, (maxC - minC) * 0.14);
    minC -= pad;
    maxC += pad;
    const span = Math.max(0.1, maxC - minC);
    const yOf = (v: number) => padT + ((maxC - v) / span) * plotH;

    // Zero line if inside range
    if (minC < 0 && maxC > 0) {
      const y0 = Math.round(yOf(0)) + 0.5;
      ctx.strokeStyle = "#2A2E39";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(padL, y0);
      ctx.lineTo(axisX, y0);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw ATAS CumulativeDelta Candles (Green #009900 / Red #FF3A3A)
    const stepX = plotW / Math.max(1, cvdCandles.length);
    const cw = Math.max(2, Math.min(11, stepX * 0.66));

    for (let i = 0; i < cvdCandles.length; i++) {
      const c = cvdCandles[i];
      const cx = padLeftX(padL, i, stepX);
      const isUp = c.close >= c.open;
      const col = isUp ? T.indicators.cvdPos : T.indicators.cvdNeg;

      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(cx) + 0.5, yOf(c.high));
      ctx.lineTo(Math.round(cx) + 0.5, yOf(c.low));
      ctx.stroke();

      const yO = yOf(c.open);
      const yC = yOf(c.close);
      ctx.fillStyle = col;
      ctx.fillRect(cx - cw / 2, Math.min(yO, yC), cw, Math.max(1.5, Math.abs(yC - yO)));

      if (c.bullDiv || c.bearDiv) {
        ctx.beginPath();
        ctx.arc(cx, c.bullDiv ? yOf(c.low) + 4 : yOf(c.high) - 4, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#FFFF00";
        ctx.fill();
      }
    }

    // Top-left ATAS panel label
    const last = slice[slice.length - 1];
    ctx.font = "10px 'Segoe UI', monospace";
    ctx.fillStyle = T.chrome.textSecondary;
    ctx.textAlign = "left";
    ctx.fillText(
      `Cumulative Delta (Candles)   Δ ${last.delta > 0 ? "+" : ""}${last.delta.toFixed(2)}   CVD ${last.cumDelta > 0 ? "+" : ""}${last.cumDelta.toFixed(2)}`,
      10,
      12
    );

    // Axis current CVD pill
    const ly = yOf(last.cumDelta);
    ctx.fillStyle = last.delta >= 0 ? T.indicators.cvdPos : T.indicators.cvdNeg;
    ctx.fillRect(axisX + 1, ly - 7, padR - 2, 14);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "600 9.5px 'Segoe UI', monospace";
    ctx.fillText(
      (last.cumDelta > 0 ? "+" : "") + last.cumDelta.toFixed(1),
      axisX + 5,
      ly + 3
    );

    // Time labels
    ctx.fillStyle = T.chrome.textSecondary;
    ctx.font = "9px 'Segoe UI', monospace";
    const every = Math.max(1, Math.floor(slice.length / 7));
    for (let i = 0; i < slice.length; i += every) {
      const x = padLeftX(padL, i, stepX);
      ctx.fillText(formatPTTime(slice[i].ts), x - 14, dims.height - 5);
    }
  }, [dims, slice, hasRealAggressorTape]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full border-t border-[#434651] bg-[#00000A] overflow-hidden ${heightClass}`}
    >
      {!hasRealAggressorTape ? (
        <div className="flex h-full items-center justify-center text-[11px] text-[#787D8C]">
          Cumulative Delta (Candles) disabled on OHLCV-only feed
        </div>
      ) : (
        <canvas ref={canvasRef} className="block h-full w-full" />
      )}
    </div>
  );
}

function padLeftX(padL: number, i: number, stepX: number) {
  return padL + i * stepX + stepX / 2;
}
