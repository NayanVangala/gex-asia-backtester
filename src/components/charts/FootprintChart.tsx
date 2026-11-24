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
  headerRight?: React.ReactNode;
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
  heightClass = "h-full min-h-[260px]",
  defaultVisibleBars = 8,
  headerRight,
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

  const geom = useMemo(() => {
    const padLeft = 44;
    const padRight = 56;
    const padTop = 20;
    const statsRows = 5; // Delta, ΔStr%, MaxΔ/MinΔ -> Delta, ΔStr%, CVD, Vol, Trades
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
    const rowH = Math.max(11, Math.min(20, plotH / numPriceRows));
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

    ctx.fillStyle = "#0b0d11";
    ctx.fillRect(0, 0, dims.width, dims.height);

    if (visibleBars.length === 0) {
      ctx.fillStyle = "#586070";
      ctx.font = "11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(
        "Step replay forward to populate M5 footprint clusters",
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
    const axisX = dims.width - padRight;

    // Axis hairlines
    ctx.strokeStyle = "#171b24";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axisX + 0.5, 0);
    ctx.lineTo(axisX + 0.5, padTop + plotH);
    ctx.moveTo(0, padTop + plotH + 0.5);
    ctx.lineTo(dims.width, padTop + plotH + 0.5);
    ctx.stroke();

    // Active Zone band only (clean, zero clutter)
    const activeZ = zones.find((z) => z.id === activeZoneId);
    if (activeZ) {
      const y1 = priceToY(activeZ.high);
      const y2 = priceToY(activeZ.low) + rowH;
      if (y2 >= padTop && y1 <= padTop + plotH) {
        ctx.fillStyle = "rgba(212, 160, 58, 0.08)";
        ctx.fillRect(
          padLeft,
          Math.max(padTop, y1),
          plotW,
          Math.min(plotH, y2 - y1)
        );
      }
    }

    // Price axis
    ctx.font = "9.5px ui-monospace, monospace";
    ctx.textAlign = "left";
    const priceLabelSkip = Math.max(1, Math.ceil(14 / rowH));
    for (let r = 0; r < numPriceRows; r += priceLabelSkip) {
      const p = Number((maxP - r * priceStep).toFixed(2));
      const y = priceToY(p);
      if (y < padTop - 4 || y > padTop + plotH) continue;
      ctx.strokeStyle = "#11151d";
      ctx.beginPath();
      ctx.moveTo(padLeft, y + rowH / 2);
      ctx.lineTo(axisX, y + rowH / 2);
      ctx.stroke();

      ctx.fillStyle = "#626b7c";
      ctx.fillText(p.toFixed(2), axisX + 6, y + rowH / 2 + 3);
    }

    const maxCellVol = Math.max(
      ...visibleBars.flatMap((b) => b.rows.map((r) => r.totalVol)),
      0.01
    );

    visibleBars.forEach((bar, idx) => {
      const colX = padLeft + idx * colW;
      const innerW = colW - 6;
      const barCenter = colX + colW / 2;

      if (hoverInfo && hoverInfo.colIdx === idx) {
        ctx.fillStyle = "rgba(230, 233, 239, 0.035)";
        ctx.fillRect(colX, padTop, colW, plotH + statsRows * statsRowH);
      }

      // Top signal badge (clean single highest-priority flag)
      let tag: { t: string; c: string } | null = null;
      if (bar.aggressionFlipBull) tag = { t: "FLIP↑", c: "#00c087" };
      else if (bar.aggressionFlipBear) tag = { t: "FLIP↓", c: "#f6465d" };
      else if (bar.absorptionLow) tag = { t: "ABS↓", c: "#d4a03a" };
      else if (bar.absorptionHigh) tag = { t: "ABS↑", c: "#d4a03a" };
      else if (bar.cvdDivergenceBull || bar.cvdDivergenceBear) tag = { t: "DIV", c: "#93c5fd" };
      else if (bar.exhaustionLow || bar.exhaustionHigh) tag = { t: "EXH", c: "#8b94a5" };

      if (tag) {
        ctx.font = "600 8.5px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = tag.c;
        ctx.fillText(tag.t, barCenter, 13);
      }

      // Slim candle body indicator on far left of cluster
      const spineX = colX + 3;
      const yO = priceToY(bar.open) + rowH / 2;
      const yC = priceToY(bar.close) + rowH / 2;
      ctx.fillStyle = bar.close >= bar.open ? "#00c087" : "#f6465d";
      ctx.fillRect(spineX, Math.min(yO, yC), 2.5, Math.max(2, Math.abs(yC - yO)));

      for (const row of bar.rows) {
        const ry = priceToY(row.price);
        if (ry < padTop - rowH || ry > padTop + plotH) continue;
        const intensity = Math.min(1, row.totalVol / maxCellVol);
        const isHoveredCell =
          hoverInfo?.colIdx === idx && hoverInfo.row?.price === row.price;

        if (mode === "bid_ask") {
          const halfW = (innerW - 7) / 2;
          const cellX = colX + 8;

          // Proportional subtle horizontal bars growing outward from center spine (Exocharts look)
          const bidBarW = Math.max(2, (row.bidVol / maxCellVol) * halfW);
          const askBarW = Math.max(2, (row.askVol / maxCellVol) * halfW);

          ctx.fillStyle = row.bidImbalance
            ? "rgba(246, 70, 93, 0.38)"
            : `rgba(246, 70, 93, ${(0.08 + intensity * 0.18).toFixed(2)})`;
          ctx.fillRect(cellX + halfW - bidBarW, ry + 0.5, bidBarW, Math.max(9, rowH - 1.5));

          ctx.fillStyle = row.askImbalance
            ? "rgba(0, 192, 135, 0.38)"
            : `rgba(0, 192, 135, ${(0.08 + intensity * 0.18).toFixed(2)})`;
          ctx.fillRect(cellX + halfW + 1, ry + 0.5, askBarW, Math.max(9, rowH - 1.5));

          if (isHoveredCell) {
            ctx.strokeStyle = "#e6e9ef";
            ctx.lineWidth = 1;
            ctx.strokeRect(cellX, ry + 0.5, innerW - 6, Math.max(9, rowH - 1.5));
          } else if (row.isPoc) {
            ctx.strokeStyle = "#d4a03a";
            ctx.lineWidth = 1;
            ctx.strokeRect(cellX, ry + 0.5, innerW - 6, Math.max(9, rowH - 1.5));
          }

          if (colW >= 54 && rowH >= 10) {
            ctx.font =
              row.bidImbalance || row.askImbalance
                ? "700 9px ui-monospace, monospace"
                : "400 9px ui-monospace, monospace";
            ctx.textAlign = "right";
            ctx.fillStyle = row.bidImbalance ? "#ff8fa0" : "#9aa3b2";
            ctx.fillText(fmtVol(row.bidVol), cellX + halfW - 2.5, ry + Math.min(rowH - 2, 10));

            ctx.textAlign = "left";
            ctx.fillStyle = row.askImbalance ? "#5ef2c2" : "#9aa3b2";
            ctx.fillText(fmtVol(row.askVol), cellX + halfW + 3.5, ry + Math.min(rowH - 2, 10));
          }
        } else {
          const cellX = colX + 8;
          const cellW = innerW - 6;
          const isPos = row.delta >= 0;
          ctx.fillStyle = isPos
            ? `rgba(0, 192, 135, ${(0.1 + intensity * 0.42).toFixed(2)})`
            : `rgba(246, 70, 93, ${(0.1 + intensity * 0.42).toFixed(2)})`;
          ctx.fillRect(cellX, ry + 0.5, cellW, Math.max(9, rowH - 1.5));

          if (isHoveredCell) {
            ctx.strokeStyle = "#e6e9ef";
            ctx.lineWidth = 1;
            ctx.strokeRect(cellX, ry + 0.5, cellW, Math.max(9, rowH - 1.5));
          } else if (row.isPoc) {
            ctx.strokeStyle = "#d4a03a";
            ctx.lineWidth = 1;
            ctx.strokeRect(cellX, ry + 0.5, cellW, Math.max(9, rowH - 1.5));
          }

          if (colW >= 42 && rowH >= 10) {
            ctx.font = "500 9px ui-monospace, monospace";
            ctx.textAlign = "center";
            ctx.fillStyle = "#e6e9ef";
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
      ctx.strokeStyle = "#141820";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(colX) + 0.5, padTop);
      ctx.lineTo(Math.round(colX) + 0.5, dims.height - 16);
      ctx.stroke();

      // ClusterStatistic table footer
      const statsTop = padTop + plotH + 2;
      const cells = [
        { val: bar.delta, text: (bar.delta > 0 ? "+" : "") + fmtVol(bar.delta), colorize: true },
        {
          val: bar.deltaStrengthPct,
          text: `${bar.deltaStrengthPct > 0 ? "+" : ""}${Math.round(bar.deltaStrengthPct)}%`,
          colorize: true,
        },
        { val: bar.cumDelta, text: (bar.cumDelta > 0 ? "+" : "") + fmtVol(bar.cumDelta), colorize: true },
        { val: bar.totalVol, text: fmtVol(bar.totalVol), colorize: false },
        { val: bar.tradeCount, text: String(bar.tradeCount), colorize: false },
      ];

      cells.forEach((cell, rIdx) => {
        const y = statsTop + rIdx * statsRowH;
        if (cell.colorize) {
          ctx.fillStyle =
            cell.val >= 0 ? "rgba(0, 192, 135, 0.11)" : "rgba(246, 70, 93, 0.11)";
          ctx.fillRect(colX + 1, y, colW - 2, statsRowH - 1);
        }
        ctx.fillStyle = cell.colorize
          ? cell.val >= 0
            ? "#00c087"
            : "#f6465d"
          : "#7d8594";
        ctx.font = "9px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(cell.text, barCenter, y + 10);
      });

      ctx.fillStyle = "#586070";
      ctx.font = "9px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(formatPTTime(bar.ts), barCenter, dims.height - 4);
    });

    // Left ClusterStatistic labels
    const statsTop = padTop + plotH + 2;
    const labels = ["Delta", "ΔStr", "CVD", "Vol", "Trds"];
    ctx.fillStyle = "#0e1116";
    ctx.fillRect(0, statsTop, padLeft - 1, statsRows * statsRowH);
    ctx.font = "500 9px ui-monospace, monospace";
    ctx.textAlign = "left";
    labels.forEach((lbl, rIdx) => {
      ctx.fillStyle = "#626b7c";
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
    <div className="flex flex-col bg-[#0b0d11] overflow-hidden h-full">
      <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-[#1c212b] bg-[#0f1217] px-2.5 text-[11px]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-[#e6e9ef]">
            {title ?? `M5 Footprint · ${mode === "bid_ask" ? "Bid × Ask" : "Delta"}`}
          </span>
          {hoverInfo ? (
            <div className="hidden md:flex items-center gap-2 font-mono-num text-[10px] text-[#8b94a5] truncate">
              <span>{formatPTTime(hoverInfo.bar.ts)}</span>
              {hoverInfo.row && (
                <>
                  <span className="text-[#d4a03a]">${hoverInfo.row.price.toFixed(2)}</span>
                  <span className="text-[#f6465d]">B {fmtVol(hoverInfo.row.bidVol)}</span>
                  <span className="text-[#00c087]">A {fmtVol(hoverInfo.row.askVol)}</span>
                </>
              )}
              <span>ΔStr {hoverInfo.bar.deltaStrengthPct > 0 ? "+" : ""}{hoverInfo.bar.deltaStrengthPct}%</span>
            </div>
          ) : (
            <span className="hidden md:inline font-mono-num text-[10px] text-[#586070]">
              300% Imb · ${priceStep.toFixed(2)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {headerRight}
          {onModeChange && (
            <div className="flex items-center rounded bg-[#151922] p-0.5 text-[10px]">
              <button
                type="button"
                onClick={() => onModeChange("bid_ask")}
                className={`rounded-xs px-1.5 py-0.5 transition ${
                  mode === "bid_ask"
                    ? "bg-[#252c3a] text-[#e6e9ef] font-medium"
                    : "text-[#6e7787] hover:text-[#b4bccb]"
                }`}
              >
                Bid×Ask
              </button>
              <button
                type="button"
                onClick={() => onModeChange("delta")}
                className={`rounded-xs px-1.5 py-0.5 transition ${
                  mode === "delta"
                    ? "bg-[#252c3a] text-[#e6e9ef] font-medium"
                    : "text-[#6e7787] hover:text-[#b4bccb]"
                }`}
              >
                Delta
              </button>
            </div>
          )}
          {hasRealAggressorTape && (
            <div className="flex items-center gap-0.5 pl-1 text-[10px]">
              <button
                type="button"
                onClick={() => setVisibleCount((c) => Math.max(4, c - 2))}
                className="rounded px-1.5 py-0.5 text-[#8b94a5] hover:bg-[#1b212d] hover:text-[#e6e9ef]"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => setVisibleCount((c) => Math.min(18, c + 2))}
                className="rounded px-1.5 py-0.5 text-[#8b94a5] hover:bg-[#1b212d] hover:text-[#e6e9ef]"
              >
                -
              </button>
            </div>
          )}
        </div>
      </div>

      <div ref={containerRef} className={`relative flex-1 w-full ${heightClass}`}>
        {!hasRealAggressorTape ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center">
            <div className="max-w-sm border border-[#262d3b] bg-[#0f1217] p-4 rounded-md">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#d4a03a]">
                No Real Bid/Ask Aggressor Tape in OHLCV Feed
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[#8b94a5]">
                COMEX GC=F gives real candles and profiles, zero tick-level bid/ask side.
                Footprint stays blank instead of fabricating fake numbers.
              </p>
              <div className="mt-3 flex items-center justify-center gap-2">
                {onSwitchToPaxg && (
                  <button
                    type="button"
                    onClick={onSwitchToPaxg}
                    className="rounded bg-[#e6e9ef] px-2.5 py-1 text-[11px] font-medium text-[#0b0d11] hover:bg-white"
                  >
                    Use PAXG Real Tape
                  </button>
                )}
                {onOpenCsvModal && (
                  <button
                    type="button"
                    onClick={onOpenCsvModal}
                    className="rounded border border-[#2d3546] bg-[#151922] px-2.5 py-1 text-[11px] text-[#e6e9ef] hover:bg-[#1e2431]"
                  >
                    Import Databento CSV
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
