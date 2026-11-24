"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { FootprintBar, FootprintPriceRow, KeyLevelZone } from "@/lib/types";
import { formatPTTime } from "@/lib/goldMath";

interface FootprintChartProps {
  title?: string;
  bars: FootprintBar[];
  hasRealAggressorTape: boolean;
  zones: KeyLevelZone[];
  activeZoneId?: string | null;
  priceStep: number;
  mode: "bid_ask" | "delta";
  onModeChange?: (mode: "bid_ask" | "delta") => void;
  onSwitchToPaxg?: () => void;
  onOpenCsvModal?: () => void;
  heightClass?: string;
  defaultVisibleBars?: number;
}

function fmtVol(v: number): string {
  if (v === 0) return "0";
  if (Math.abs(v) >= 100) return Math.round(v).toString();
  if (Math.abs(v) >= 10) return v.toFixed(1);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toFixed(2).replace(/^0/, "");
}

export function FootprintChart({
  title,
  bars,
  hasRealAggressorTape,
  zones,
  activeZoneId,
  priceStep,
  mode,
  onModeChange,
  onSwitchToPaxg,
  onOpenCsvModal,
  heightClass = "h-[365px]",
  defaultVisibleBars = 9,
}: FootprintChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visibleCount, setVisibleCount] = useState(defaultVisibleBars);
  const [rightOffset, setRightOffset] = useState(0);
  const [dims, setDims] = useState({ width: 580, height: 340 });
  const [hoverInfo, setHoverInfo] = useState<{
    bar: FootprintBar;
    row: FootprintPriceRow | null;
    colIdx: number;
  } | null>(null);
  const [dragPan, setDragPan] = useState<{
    startX: number;
    startOffset: number;
  } | null>(null);

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
    setRightOffset((prev) => Math.min(prev, Math.max(0, bars.length - 4)));
  }, [bars.length]);

  const visibleBars = useMemo(() => {
    if (bars.length === 0) return [];
    const end = Math.max(1, bars.length - rightOffset);
    const start = Math.max(0, end - visibleCount);
    return bars.slice(start, end);
  }, [bars, visibleCount, rightOffset]);

  // Shared geometry so canvas render and mouse hit-testing match identically
  const geom = useMemo(() => {
    const padLeft = 48;
    const padRight = 58;
    const padTop = 22;
    const statsRows = 6; // Delta, ΔStr%, MaxΔ, MinΔ, CVD, Vol
    const statsRowH = 14;
    const statsHeight = statsRows * statsRowH + 18;
    const plotW = Math.max(100, dims.width - padLeft - padRight);
    const plotH = Math.max(80, dims.height - padTop - statsHeight);

    let lo = Infinity;
    let hi = -Infinity;
    for (const b of visibleBars) {
      if (b.low < lo) lo = b.low;
      if (b.high > hi) hi = b.high;
    }
    const quantize = (p: number) => Math.round(p / priceStep) * priceStep;
    const minP = Number.isFinite(lo) ? quantize(lo) - priceStep : 3500;
    const maxP = Number.isFinite(hi) ? quantize(hi) + priceStep : 3510;
    const numPriceRows = Math.max(4, Math.round((maxP - minP) / priceStep) + 1);
    const rowH = Math.max(10, Math.min(20, plotH / numPriceRows));
    const colW = plotW / Math.max(1, visibleBars.length);

    return {
      padLeft,
      padRight,
      padTop,
      statsRows,
      statsRowH,
      statsHeight,
      plotW,
      plotH,
      minP,
      maxP,
      numPriceRows,
      rowH,
      colW,
    };
  }, [dims, visibleBars, priceStep]);

  const priceToY = (p: number) =>
    geom.padTop +
    ((geom.maxP - p) / Math.max(priceStep, geom.maxP - geom.minP)) *
      (geom.plotH - geom.rowH);

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

    ctx.fillStyle = "#090d14";
    ctx.fillRect(0, 0, dims.width, dims.height);

    if (visibleBars.length === 0) {
      ctx.fillStyle = "#64748b";
      ctx.font = "12px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(
        "Step replay forward to populate Asia M5 footprint clusters",
        dims.width / 2,
        dims.height / 2
      );
      return;
    }

    const {
      padLeft,
      padRight,
      padTop,
      statsRows,
      statsRowH,
      plotW,
      plotH,
      maxP,
      numPriceRows,
      rowH,
      colW,
    } = geom;

    // Zone highlights
    for (const z of zones) {
      const y1 = priceToY(z.high);
      const y2 = priceToY(z.low) + rowH;
      if (y2 < padTop || y1 > padTop + plotH) continue;
      const isActive = z.id === activeZoneId;
      ctx.fillStyle = isActive
        ? "rgba(250, 204, 21, 0.14)"
        : "rgba(148, 163, 184, 0.06)";
      ctx.fillRect(padLeft, Math.max(padTop, y1), plotW, Math.min(plotH, y2 - y1));
    }

    // Price Axis ticks
    ctx.font = "9px ui-monospace, monospace";
    ctx.textAlign = "left";
    const priceLabelSkip = Math.max(1, Math.ceil(13 / rowH));
    for (let r = 0; r < numPriceRows; r += priceLabelSkip) {
      const p = Number((maxP - r * priceStep).toFixed(2));
      const y = priceToY(p);
      if (y < padTop - 4 || y > padTop + plotH) continue;
      ctx.strokeStyle = "#121926";
      ctx.beginPath();
      ctx.moveTo(padLeft, y + rowH / 2);
      ctx.lineTo(dims.width - padRight, y + rowH / 2);
      ctx.stroke();

      ctx.fillStyle = "#7c8aa5";
      ctx.fillText(p.toFixed(2), dims.width - padRight + 5, y + rowH / 2 + 3);
    }

    const maxCellVol = Math.max(
      ...visibleBars.flatMap((b) => b.rows.map((r) => r.totalVol)),
      0.01
    );

    visibleBars.forEach((bar, idx) => {
      const colX = padLeft + idx * colW;
      const innerW = colW - 4;
      const barCenter = colX + colW / 2;

      // Highlight hovered bar column
      if (hoverInfo && hoverInfo.colIdx === idx) {
        ctx.fillStyle = "rgba(56, 189, 248, 0.06)";
        ctx.fillRect(colX, padTop, colW, plotH + statsRows * statsRowH);
      }

      // Top signal flags
      const tags: Array<{ t: string; c: string }> = [];
      if (bar.absorptionLow) tags.push({ t: "ABS↓", c: "#22c55e" });
      if (bar.absorptionHigh) tags.push({ t: "ABS↑", c: "#f43f5e" });
      if (bar.aggressionFlipBull) tags.push({ t: "FLIP↑", c: "#38bdf8" });
      if (bar.aggressionFlipBear) tags.push({ t: "FLIP↓", c: "#fb923c" });
      if (bar.exhaustionLow || bar.exhaustionHigh) tags.push({ t: "EXH", c: "#a78bfa" });
      if (bar.cvdDivergenceBull || bar.cvdDivergenceBear) tags.push({ t: "DIV", c: "#facc15" });

      if (tags.length > 0) {
        ctx.font = "bold 8px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = tags[0].c;
        ctx.fillText(tags.slice(0, 2).map((x) => x.t).join(" "), barCenter, 14);
      }

      // Open-close candle spine
      const spineX = colX + 3;
      const yO = priceToY(bar.open) + rowH / 2;
      const yC = priceToY(bar.close) + rowH / 2;
      ctx.fillStyle = bar.close >= bar.open ? "#10b981" : "#ef4444";
      ctx.fillRect(spineX, Math.min(yO, yC), 3, Math.max(2, Math.abs(yC - yO)));

      for (const row of bar.rows) {
        const ry = priceToY(row.price);
        if (ry < padTop - rowH || ry > padTop + plotH) continue;
        const intensity = Math.min(1, row.totalVol / maxCellVol);
        const isHoveredCell =
          hoverInfo?.colIdx === idx && hoverInfo.row?.price === row.price;

        if (mode === "bid_ask") {
          const halfW = (innerW - 7) / 2;
          const cellX = colX + 7;

          ctx.fillStyle = row.bidImbalance
            ? "rgba(239, 68, 68, 0.55)"
            : `rgba(239, 68, 68, ${(0.06 + intensity * 0.24).toFixed(2)})`;
          ctx.fillRect(cellX, ry, halfW, Math.max(9, rowH - 1));

          ctx.fillStyle = row.askImbalance
            ? "rgba(16, 185, 129, 0.55)"
            : `rgba(16, 185, 129, ${(0.06 + intensity * 0.24).toFixed(2)})`;
          ctx.fillRect(cellX + halfW + 1, ry, halfW, Math.max(9, rowH - 1));

          if (isHoveredCell) {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1.4;
            ctx.strokeRect(cellX, ry, innerW - 6, Math.max(9, rowH - 1));
          } else if (row.isPoc) {
            ctx.strokeStyle = "#facc15";
            ctx.lineWidth = 1.2;
            ctx.strokeRect(cellX, ry, innerW - 6, Math.max(9, rowH - 1));
          } else if (row.isAbsorptionCell) {
            ctx.strokeStyle = "#38bdf8";
            ctx.lineWidth = 1;
            ctx.strokeRect(cellX, ry, innerW - 6, Math.max(9, rowH - 1));
          }

          if (colW >= 54 && rowH >= 10) {
            ctx.font =
              row.bidImbalance || row.askImbalance
                ? "bold 9px ui-monospace, monospace"
                : "9px ui-monospace, monospace";
            ctx.textAlign = "right";
            ctx.fillStyle = row.bidImbalance ? "#fecdd3" : "#cbd5e1";
            ctx.fillText(fmtVol(row.bidVol), cellX + halfW - 2, ry + Math.min(rowH - 2, 10));

            ctx.textAlign = "left";
            ctx.fillStyle = row.askImbalance ? "#bbf7d0" : "#cbd5e1";
            ctx.fillText(fmtVol(row.askVol), cellX + halfW + 3, ry + Math.min(rowH - 2, 10));
          }
        } else {
          const cellX = colX + 7;
          const cellW = innerW - 6;
          const isPos = row.delta >= 0;
          ctx.fillStyle = isPos
            ? `rgba(16, 185, 129, ${(0.12 + intensity * 0.55).toFixed(2)})`
            : `rgba(239, 68, 68, ${(0.12 + intensity * 0.55).toFixed(2)})`;
          ctx.fillRect(cellX, ry, cellW, Math.max(9, rowH - 1));

          if (isHoveredCell) {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1.4;
            ctx.strokeRect(cellX, ry, cellW, Math.max(9, rowH - 1));
          } else if (row.isPoc) {
            ctx.strokeStyle = "#facc15";
            ctx.lineWidth = 1.2;
            ctx.strokeRect(cellX, ry, cellW, Math.max(9, rowH - 1));
          }

          if (colW >= 42 && rowH >= 10) {
            ctx.font = "9px ui-monospace, monospace";
            ctx.textAlign = "center";
            ctx.fillStyle = "#f8fafc";
            const sign = row.delta > 0 ? "+" : "";
            ctx.fillText(
              `${sign}${fmtVol(row.delta)}`,
              cellX + cellW / 2,
              ry + Math.min(rowH - 2, 10)
            );
          }
        }
      }

      // Column divider
      ctx.strokeStyle = "#161e2e";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(colX, padTop);
      ctx.lineTo(colX, dims.height - 16);
      ctx.stroke();

      // ClusterStatistic + DeltaStrength footer rows
      const statsTop = padTop + plotH + 2;
      const cells = [
        { val: bar.delta, text: (bar.delta > 0 ? "+" : "") + fmtVol(bar.delta), colorize: true },
        {
          val: bar.deltaStrengthPct,
          text: `${bar.deltaStrengthPct > 0 ? "+" : ""}${Math.round(bar.deltaStrengthPct)}%`,
          colorize: true,
        },
        { val: bar.maxDelta, text: "+" + fmtVol(Math.max(0, bar.maxDelta)), colorize: false },
        { val: bar.minDelta, text: fmtVol(Math.min(0, bar.minDelta)), colorize: false },
        { val: bar.cumDelta, text: (bar.cumDelta > 0 ? "+" : "") + fmtVol(bar.cumDelta), colorize: true },
        { val: bar.totalVol, text: fmtVol(bar.totalVol), colorize: false },
      ];

      cells.forEach((cell, rIdx) => {
        const y = statsTop + rIdx * statsRowH;
        if (cell.colorize) {
          ctx.fillStyle =
            cell.val >= 0 ? "rgba(16, 185, 129, 0.16)" : "rgba(239, 68, 68, 0.16)";
          ctx.fillRect(colX + 1, y, colW - 2, statsRowH - 1);
        }
        ctx.fillStyle = cell.colorize
          ? cell.val >= 0
            ? "#34d399"
            : "#fb7185"
          : "#94a3b8";
        ctx.font = "9px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(cell.text, barCenter, y + 10);
      });

      ctx.fillStyle = "#64748b";
      ctx.font = "9px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(formatPTTime(bar.ts), barCenter, dims.height - 4);
    });

    // Left ClusterStatistic row labels
    const statsTop = padTop + plotH + 2;
    const labels = ["Delta", "ΔStr%", "MaxΔ", "MinΔ", "CVD", "Vol"];
    ctx.fillStyle = "#0b0f18";
    ctx.fillRect(0, statsTop, padLeft - 2, statsRows * statsRowH);
    ctx.font = "bold 9px ui-monospace, monospace";
    ctx.textAlign = "left";
    labels.forEach((lbl, rIdx) => {
      ctx.fillStyle = "#94a3b8";
      ctx.fillText(lbl, 6, statsTop + rIdx * statsRowH + 10);
    });
  }, [dims, visibleBars, hasRealAggressorTape, zones, activeZoneId, priceStep, mode, geom, hoverInfo]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (dragPan) {
      const dx = x - dragPan.startX;
      const deltaCols = Math.round(dx / Math.max(20, geom.colW));
      setRightOffset(
        Math.max(0, Math.min(Math.max(0, bars.length - 4), dragPan.startOffset + deltaCols))
      );
      return;
    }

    if (visibleBars.length === 0) return;
    const colIdx = Math.floor((x - geom.padLeft) / geom.colW);
    if (colIdx < 0 || colIdx >= visibleBars.length) {
      setHoverInfo(null);
      return;
    }
    const bar = visibleBars[colIdx];
    const hitRow =
      bar.rows.find((r) => {
        const ry = priceToY(r.price);
        return y >= ry && y <= ry + geom.rowH;
      }) ?? null;

    setHoverInfo({ bar, row: hitRow, colIdx });
  };

  return (
    <div className="flex flex-col rounded-lg border border-[#1c2436] bg-[#090d14] overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1c2436] bg-[#0c111b] px-3 py-1.5 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold tracking-wide text-slate-100">
            {title ?? `M5 Footprint (${mode === "bid_ask" ? "Bid × Ask" : "Delta"})`}
          </span>
          {hoverInfo ? (
            <div className="flex items-center gap-2 font-mono-num text-[10px] text-slate-300 truncate">
              <span className="text-sky-300">
                {formatPTTime(hoverInfo.bar.ts)} PT
              </span>
              {hoverInfo.row && (
                <>
                  <span className="text-amber-300">
                    ${hoverInfo.row.price.toFixed(2)}
                  </span>
                  <span className="text-rose-300">
                    Bid {fmtVol(hoverInfo.row.bidVol)}
                  </span>
                  <span className="text-emerald-300">
                    Ask {fmtVol(hoverInfo.row.askVol)}
                  </span>
                  <span>
                    Δ {hoverInfo.row.delta > 0 ? "+" : ""}
                    {fmtVol(hoverInfo.row.delta)}
                  </span>
                </>
              )}
              <span className="text-slate-400">
                {hoverInfo.bar.tradeCount} prints · ΔStr{" "}
                {hoverInfo.bar.deltaStrengthPct > 0 ? "+" : ""}
                {hoverInfo.bar.deltaStrengthPct}%
              </span>
            </div>
          ) : (
            <span className="text-[10px] font-mono-num text-slate-400">
              300% Imb · Step ${priceStep.toFixed(2)} · Hover cells to inspect
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onModeChange && (
            <>
              <button
                type="button"
                onClick={() => onModeChange("bid_ask")}
                className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${
                  mode === "bid_ask"
                    ? "bg-sky-500/20 text-sky-300 border border-sky-500/40"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Bid × Ask
              </button>
              <button
                type="button"
                onClick={() => onModeChange("delta")}
                className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${
                  mode === "delta"
                    ? "bg-sky-500/20 text-sky-300 border border-sky-500/40"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Delta
              </button>
            </>
          )}
          {hasRealAggressorTape && (
            <div className="ml-1 flex items-center gap-0.5 border-l border-[#1c2436] pl-1.5">
              <button
                type="button"
                title="Zoom in (fewer bars)"
                onClick={() => setVisibleCount((c) => Math.max(4, c - 2))}
                className="rounded bg-[#141c2c] px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-[#1e2a40]"
              >
                +
              </button>
              <button
                type="button"
                title="Zoom out (more bars)"
                onClick={() => setVisibleCount((c) => Math.min(18, c + 2))}
                className="rounded bg-[#141c2c] px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-[#1e2a40]"
              >
                -
              </button>
            </div>
          )}
        </div>
      </div>

      <div ref={containerRef} className={`relative w-full ${heightClass}`}>
        {!hasRealAggressorTape ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center">
            <div className="max-w-md rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-amber-300">
                No Real Bid/Ask Aggressor Tape in OHLCV Feed
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-300">
                COMEX GC=F from Yahoo Finance gives real candles and volume
                profile levels, but zero trade-by-trade aggressor side. We do
                not fake footprint numbers from candle closes.
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                {onSwitchToPaxg && (
                  <button
                    type="button"
                    onClick={onSwitchToPaxg}
                    className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                  >
                    Switch to Kraken PAXG/USD Real Tape
                  </button>
                )}
                {onOpenCsvModal && (
                  <button
                    type="button"
                    onClick={onOpenCsvModal}
                    className="rounded border border-slate-600 bg-[#141c2c] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-[#1d283d]"
                  >
                    Upload Databento GC CSV
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="block h-full w-full cursor-grab active:cursor-grabbing"
            onMouseDown={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setDragPan({ startX: e.clientX - rect.left, startOffset: rightOffset });
            }}
            onMouseMove={handleMouseMove}
            onMouseUp={() => setDragPan(null)}
            onMouseLeave={() => {
              setDragPan(null);
              setHoverInfo(null);
            }}
            onWheel={(e) => {
              e.preventDefault();
              if (e.shiftKey) {
                setRightOffset((prev) =>
                  Math.max(
                    0,
                    Math.min(
                      Math.max(0, bars.length - 4),
                      prev + (e.deltaY > 0 ? 1 : -1)
                    )
                  )
                );
              } else {
                setVisibleCount((prev) =>
                  Math.max(4, Math.min(18, prev + (e.deltaY > 0 ? 1 : -1)))
                );
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
