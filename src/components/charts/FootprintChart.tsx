"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { FootprintBar, FootprintPriceRow, KeyLevelZone } from "@/lib/types";
import { formatPTTime } from "@/lib/goldMath";
import { ATAS_ASIA_THEME as T } from "@/lib/atasTheme";

interface FootprintChartProps {
  title?: string;
  instrumentLabel?: string;
  bars: FootprintBar[];
  vwapSeries?: Array<{ ts: number; vwap: number }>;
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

/**
 * Exact ATAS X Footprint (FP2 G1.W1 from Asia_Template_Fixed.aws):
 * - Background: DarkBlue (#00008B) -> Black vertical gradient
 * - Bid: #F71427 | Ask: #007900 | POC: #FF4900 | Text & 150% Imbalances: White
 * - SecondClusters: #2962FF cobalt-blue volumeHistogram beside each cluster
 * - Yellow VWAP + 5px translucent Absorption bars + BigTrades ellipses
 * - ClusterStatistic footer: Delta (#007900/#F71427) + Volume (#434651) + optional ΔStr/CVD
 */
export function FootprintChart({
  title,
  instrumentLabel = "/GC:XCEC",
  bars,
  vwapSeries = [],
  hasRealAggressorTape,
  zones,
  activeZoneId,
  priceStep,
  mode,
  onModeChange,
  onSwitchToPaxg,
  onOpenCsvModal,
  heightClass = "h-full min-h-[280px]",
  defaultVisibleBars = 7,
}: FootprintChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visibleCount, setVisibleCount] = useState(defaultVisibleBars);
  const [rightOffset, setRightOffset] = useState(0);
  const [dims, setDims] = useState({ width: 580, height: 420 });
  const [showExtendedStats, setShowExtendedStats] = useState(false);
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
    setRightOffset((prev) => Math.min(prev, Math.max(0, bars.length - 3)));
  }, [bars.length]);

  const visibleBars = useMemo(() => {
    if (bars.length === 0) return [];
    const end = Math.max(1, bars.length - rightOffset);
    const start = Math.max(0, end - visibleCount);
    return bars.slice(start, end);
  }, [bars, visibleCount, rightOffset]);

  const vwapMap = useMemo(() => {
    const m = new Map<number, number>();
    for (const v of vwapSeries) m.set(v.ts, v.vwap);
    return m;
  }, [vwapSeries]);

  const geom = useMemo(() => {
    const padLeft = 52;
    const padRight = 64;
    const padTop = 32;
    const statsRows = showExtendedStats ? 4 : 2; // ATAS default: Delta + Volume (exact RowsOrder: 2:Delta, 9:Volume)
    const statsRowH = 18;
    const statsHeight = statsRows * statsRowH + 20;
    const plotW = Math.max(100, dims.width - padLeft - padRight - 14);
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
    const rowH = Math.max(12, Math.min(22, plotH / numPriceRows));
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
  }, [dims, visibleBars, priceStep, showExtendedStats]);

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
    const statsTop = padTop + plotH;
    const timeAxisY = dims.height - 18;

    // 1. EXACT ATAS Footprint Gradient: DarkBlue (#00008B) -> Black (#000000)
    const grad = ctx.createLinearGradient(0, 0, 0, statsTop);
    grad.addColorStop(0, T.canvas.clusterBgTop);
    grad.addColorStop(1, T.canvas.bgBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, axisX, statsTop);

    // Axis & ClusterStatistic panels
    ctx.fillStyle = T.chrome.panelBg;
    ctx.fillRect(axisX, 0, padRight, dims.height);
    ctx.fillStyle = T.clusterStats.bg;
    ctx.fillRect(0, statsTop, axisX, timeAxisY - statsTop);
    ctx.fillStyle = T.chrome.panelBg;
    ctx.fillRect(0, timeAxisY, dims.width, 18);

    // Panel separator (#434651)
    ctx.strokeStyle = T.chrome.separator;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, statsTop + 0.5);
    ctx.lineTo(dims.width, statsTop + 0.5);
    ctx.moveTo(axisX + 0.5, 0);
    ctx.lineTo(axisX + 0.5, dims.height);
    ctx.stroke();

    if (visibleBars.length === 0) {
      ctx.fillStyle = T.chrome.textSecondary;
      ctx.font = "11px 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        "Step replay forward to populate M5 clusters",
        axisX / 2,
        statsTop / 2
      );
      return;
    }

    // Active Zone band
    const activeZ = zones.find((z) => z.id === activeZoneId);
    if (activeZ) {
      const y1 = priceToY(activeZ.high);
      const y2 = priceToY(activeZ.low) + rowH;
      if (y2 >= padTop && y1 <= statsTop) {
        ctx.fillStyle = "rgba(59, 239, 240, 0.09)";
        ctx.fillRect(padLeft, Math.max(padTop, y1), axisX - padLeft, Math.min(plotH, y2 - y1));
        ctx.strokeStyle = T.indicators.levelCyan;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(padLeft, Math.max(padTop, y1));
        ctx.lineTo(axisX, Math.max(padTop, y1));
        ctx.moveTo(padLeft, Math.min(statsTop, y2));
        ctx.lineTo(axisX, Math.min(statsTop, y2));
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Price Axis ticks (#ABAEB8)
    ctx.font = "10px 'Segoe UI', monospace";
    ctx.textAlign = "left";
    const priceLabelSkip = Math.max(1, Math.ceil(14 / rowH));
    for (let r = 0; r < numPriceRows; r += priceLabelSkip) {
      const p = Number((maxP - r * priceStep).toFixed(2));
      const y = priceToY(p);
      if (y < padTop - 4 || y > statsTop - 4) continue;
      ctx.strokeStyle = T.canvas.grid;
      ctx.beginPath();
      ctx.moveTo(padLeft, y + rowH / 2);
      ctx.lineTo(axisX, y + rowH / 2);
      ctx.stroke();

      ctx.fillStyle = T.chrome.textSecondary;
      ctx.fillText(p.toFixed(2), axisX + 6, y + rowH / 2 + 3);
    }

    const maxCellVol = Math.max(
      ...visibleBars.flatMap((b) => b.rows.map((r) => r.totalVol)),
      0.01
    );

    visibleBars.forEach((bar, idx) => {
      const colX = padLeft + idx * colW;
      const barCenter = colX + colW / 2;

      if (hoverInfo && hoverInfo.colIdx === idx) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
        ctx.fillRect(colX, padTop, colW, plotH + statsRows * statsRowH);
      }

      // ATAS 5px Absorption Bands on Footprint
      if (bar.absorptionLow) {
        const y = priceToY(bar.low) + rowH / 2;
        ctx.fillStyle = T.indicators.absorptionBull;
        ctx.fillRect(colX + 2, y - 2.5, colW - 4, 5);
      }
      if (bar.absorptionHigh) {
        const y = priceToY(bar.high) + rowH / 2;
        ctx.fillStyle = T.indicators.absorptionBear;
        ctx.fillRect(colX + 2, y - 2.5, colW - 4, 5);
      }

      // ATAS Direction Marker on left edge of cluster (White up / Cyan #3BEFF0 down)
      const spineX = colX + 3;
      const yO = priceToY(bar.open) + rowH / 2;
      const yC = priceToY(bar.close) + rowH / 2;
      ctx.fillStyle = bar.close >= bar.open ? T.candles.bull : T.candles.bearCyan;
      ctx.fillRect(spineX, Math.min(yO, yC), 3, Math.max(3, Math.abs(yC - yO)));

      // Reserve right 22% of cluster column for ATAS SecondClusters Cobalt-Blue Volume Histogram (#2962FF)!
      const secondW = mode === "bid_ask" && colW >= 78 ? Math.floor(colW * 0.2) : 0;
      const mainX = colX + 8;
      const mainW = colW - 12 - secondW;

      for (const row of bar.rows) {
        const ry = priceToY(row.price);
        if (ry < padTop - rowH || ry > statsTop - 2) continue;
        const intensity = Math.min(1, row.totalVol / maxCellVol);
        const isHoveredCell =
          hoverInfo?.colIdx === idx && hoverInfo.row?.price === row.price;

        if (mode === "bid_ask") {
          const halfW = (mainW - 2) / 2;

          // EXACT ATAS Bid (#F71427) & Ask (#007900) cluster fills
          ctx.fillStyle = row.isPoc
            ? T.clusters.pocVolume // Blazing orange #FF4900 for POC!
            : `rgba(247, 20, 39, ${(0.24 + intensity * 0.65).toFixed(2)})`;
          ctx.fillRect(mainX, ry + 0.5, halfW, Math.max(10, rowH - 1.5));

          ctx.fillStyle = row.isPoc
            ? T.clusters.pocVolume
            : `rgba(0, 121, 0, ${(0.24 + intensity * 0.65).toFixed(2)})`;
          ctx.fillRect(mainX + halfW + 1, ry + 0.5, halfW, Math.max(10, rowH - 1.5));

          // SecondClusters Cobalt-Blue (#2962FF) Volume Histogram on right side of cluster!
          if (secondW > 4) {
            const histW = Math.max(2, (row.totalVol / maxCellVol) * (secondW - 2));
            ctx.fillStyle = row.isPoc ? T.clusters.pocVolume : T.clusters.secondClusterVol;
            ctx.fillRect(mainX + mainW + 2, ry + 1, histW, Math.max(9, rowH - 2.5));
          }

          // Cell border (hovered white, POC blazing orange frame, or ATAS #2A2E39 border)
          if (isHoveredCell) {
            ctx.strokeStyle = "#FFFFFF";
            ctx.lineWidth = 1.4;
            ctx.strokeRect(mainX, ry + 0.5, mainW, Math.max(10, rowH - 1.5));
          } else if (row.isPoc) {
            ctx.strokeStyle = "#FFFF00";
            ctx.lineWidth = 1.3;
            ctx.strokeRect(mainX, ry + 0.5, mainW, Math.max(10, rowH - 1.5));
          } else {
            ctx.strokeStyle = T.clusters.border;
            ctx.lineWidth = 0.6;
            ctx.strokeRect(mainX, ry + 0.5, mainW, Math.max(10, rowH - 1.5));
          }

          // Text: White foreground, BOLD bright white for 150% Imbalances!
          if (mainW >= 46 && rowH >= 11) {
            ctx.textAlign = "right";
            ctx.font = row.bidImbalance
              ? "700 9.5px 'Segoe UI', monospace"
              : "400 9px 'Segoe UI', monospace";
            ctx.fillStyle = row.bidImbalance ? "#FFFFFF" : "rgba(255,255,255,0.86)";
            ctx.fillText(fmtVol(row.bidVol), mainX + halfW - 2, ry + Math.min(rowH - 2, 11));

            ctx.textAlign = "left";
            ctx.font = row.askImbalance
              ? "700 9.5px 'Segoe UI', monospace"
              : "400 9px 'Segoe UI', monospace";
            ctx.fillStyle = row.askImbalance ? "#FFFFFF" : "rgba(255,255,255,0.86)";
            ctx.fillText(fmtVol(row.askVol), mainX + halfW + 3, ry + Math.min(rowH - 2, 11));
          }
        } else {
          // Delta cluster mode
          const isPos = row.delta >= 0;
          ctx.fillStyle = row.isPoc
            ? T.clusters.pocVolume
            : isPos
              ? `rgba(0, 121, 0, ${(0.25 + intensity * 0.7).toFixed(2)})`
              : `rgba(247, 20, 39, ${(0.25 + intensity * 0.7).toFixed(2)})`;
          ctx.fillRect(mainX, ry + 0.5, mainW + secondW, Math.max(10, rowH - 1.5));

          if (isHoveredCell || row.isPoc) {
            ctx.strokeStyle = isHoveredCell ? "#FFFFFF" : "#FFFF00";
            ctx.lineWidth = 1.2;
            ctx.strokeRect(mainX, ry + 0.5, mainW + secondW, Math.max(10, rowH - 1.5));
          }

          if (mainW >= 36 && rowH >= 11) {
            ctx.font = "600 9px 'Segoe UI', monospace";
            ctx.textAlign = "center";
            ctx.fillStyle = "#FFFFFF";
            ctx.fillText(
              `${row.delta > 0 ? "+" : ""}${fmtVol(row.delta)}`,
              mainX + (mainW + secondW) / 2,
              ry + Math.min(rowH - 2, 11)
            );
          }
        }
      }

      // BigTrades ellipses on footprint (exact cyan/magenta + blue/red)
      for (const bt of bar.bigTrades) {
        const cy = priceToY(bt.price) + rowH / 2;
        if (cy < padTop || cy > statsTop) continue;
        const r = bt.tier === "whale" ? 6 : 4;
        const col =
          bt.tier === "whale"
            ? bt.side === "buy"
              ? T.indicators.bigTradeWhaleBuy
              : T.indicators.bigTradeWhaleSell
            : bt.side === "buy"
              ? T.indicators.bigTradeLargeBuy
              : T.indicators.bigTradeLargeSell;
        ctx.save();
        ctx.globalAlpha = 0.65;
        ctx.beginPath();
        ctx.arc(barCenter, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.fill();
        ctx.restore();
      }

      // Column grid divider (#21252F)
      ctx.strokeStyle = T.clusterStats.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(colX) + 0.5, padTop);
      ctx.lineTo(Math.round(colX) + 0.5, timeAxisY);
      ctx.stroke();

      // ATAS ClusterStatistic Footer Rows (Delta + Volume exact from Asia_Template_Fixed.aws!)
      const rowsData = showExtendedStats
        ? [
            { label: "Delta", val: bar.delta, text: (bar.delta > 0 ? "+" : "") + fmtVol(bar.delta), bg: bar.delta >= 0 ? T.clusterStats.askBg : T.clusterStats.bidBg },
            { label: "Volume", val: bar.totalVol, text: fmtVol(bar.totalVol), bg: T.clusterStats.volumeBg },
            { label: "ΔStr%", val: bar.deltaStrengthPct, text: `${bar.deltaStrengthPct > 0 ? "+" : ""}${Math.round(bar.deltaStrengthPct)}%`, bg: bar.deltaStrengthPct >= 0 ? "rgba(0,121,0,0.5)" : "rgba(247,20,39,0.5)" },
            { label: "CVD", val: bar.cumDelta, text: (bar.cumDelta > 0 ? "+" : "") + fmtVol(bar.cumDelta), bg: bar.cumDelta >= 0 ? "rgba(0,121,0,0.45)" : "rgba(247,20,39,0.45)" },
          ]
        : [
            { label: "Delta", val: bar.delta, text: (bar.delta > 0 ? "+" : "") + fmtVol(bar.delta), bg: bar.delta >= 0 ? T.clusterStats.askBg : T.clusterStats.bidBg },
            { label: "Volume", val: bar.totalVol, text: fmtVol(bar.totalVol), bg: T.clusterStats.volumeBg },
          ];

      rowsData.forEach((cell, rIdx) => {
        const y = statsTop + rIdx * statsRowH;
        ctx.fillStyle = cell.bg;
        ctx.fillRect(colX + 1, y + 1, colW - 2, statsRowH - 2);
        ctx.fillStyle = T.clusterStats.text;
        ctx.font = "600 9.5px 'Segoe UI', monospace";
        ctx.textAlign = "center";
        ctx.fillText(cell.text, barCenter, y + 12.5);
      });

      // Time axis label
      ctx.fillStyle = T.chrome.textSecondary;
      ctx.font = "9.5px 'Segoe UI', monospace";
      ctx.textAlign = "center";
      ctx.fillText(formatPTTime(bar.ts), barCenter, dims.height - 5);
    });

    // Yellow VWAP overlay across Footprint bars
    if (vwapMap.size > 0) {
      ctx.strokeStyle = T.indicators.vwap;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      let started = false;
      visibleBars.forEach((b, idx) => {
        const v = vwapMap.get(b.ts);
        if (v === undefined) return;
        const x = padLeft + idx * colW + colW / 2;
        const y = priceToY(v) + rowH / 2;
        if (y < padTop || y > statsTop) {
          started = false;
          return;
        }
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
    }

    // Left ClusterStatistic header labels
    const statLabels = showExtendedStats
      ? ["Delta", "Volume", "ΔStr%", "CVD"]
      : ["Delta", "Volume"];
    ctx.fillStyle = T.chrome.panelBg;
    ctx.fillRect(0, statsTop + 1, padLeft - 1, statsRows * statsRowH);
    ctx.font = "600 9.5px 'Segoe UI', monospace";
    ctx.textAlign = "left";
    statLabels.forEach((lbl, rIdx) => {
      ctx.fillStyle = T.chrome.textSecondary;
      ctx.fillText(lbl, 6, statsTop + rIdx * statsRowH + 12.5);
    });

    // Current Last Price axis box
    const lastBar = visibleBars[visibleBars.length - 1];
    if (lastBar) {
      const ly = priceToY(lastBar.close) + rowH / 2;
      ctx.fillStyle = T.chrome.axisCurrentBg;
      ctx.fillRect(axisX + 1, ly - 8, padRight - 2, 16);
      ctx.fillStyle = T.chrome.axisCurrentFg;
      ctx.font = "600 10px 'Segoe UI', monospace";
      ctx.fillText(lastBar.close.toFixed(2), axisX + 6, ly + 3.5);
    }

    // Top-left ATAS status header inside canvas
    ctx.textAlign = "left";
    ctx.font = "600 10.5px 'Segoe UI', monospace";
    ctx.fillStyle = T.chrome.textPrimary;
    if (hoverInfo) {
      const rowTxt = hoverInfo.row
        ? `  $${hoverInfo.row.price.toFixed(2)}  Bid ${fmtVol(hoverInfo.row.bidVol)} × Ask ${fmtVol(hoverInfo.row.askVol)}  Δ ${hoverInfo.row.delta > 0 ? "+" : ""}${fmtVol(hoverInfo.row.delta)}`
        : "";
      ctx.fillText(
        `${instrumentLabel} · M5 Clusters (${formatPTTime(hoverInfo.bar.ts)} PT)${rowTxt}`,
        10,
        14
      );
    } else {
      ctx.fillText(
        `${title ?? `${instrumentLabel} · M5 Clusters (${mode === "bid_ask" ? "Bid×Ask + Vol" : "Delta"})`}  ·  150% Imb · Step $${priceStep.toFixed(2)}`,
        10,
        14
      );
    }
    ctx.font = "9px 'Segoe UI', sans-serif";
    ctx.fillStyle = T.chrome.textSecondary;
    ctx.fillText(
      "VWAP · DeltaStrength · ClusterStatistic · Absorption (300%) · BigTrades",
      10,
      26
    );
  }, [
    dims,
    visibleBars,
    vwapMap,
    hasRealAggressorTape,
    zones,
    activeZoneId,
    priceStep,
    mode,
    geom,
    hoverInfo,
    showExtendedStats,
    instrumentLabel,
    title,
  ]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (dragPan) {
      const dx = x - dragPan.startX;
      const deltaCols = Math.round(dx / Math.max(24, geom.colW));
      setRightOffset(
        Math.max(0, Math.min(Math.max(0, bars.length - 3), dragPan.startOffset + deltaCols))
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
    <div className="relative flex flex-col h-full overflow-hidden bg-[#000040]">
      {/* Subtle floating top-right ATAS cluster controls */}
      {hasRealAggressorTape && (
        <div className="absolute right-[70px] top-1.5 z-10 flex items-center gap-1 rounded bg-[#151B26]/90 px-1.5 py-0.5 text-[10px] border border-[#2A2E39]">
          {onModeChange && (
            <>
              <button
                type="button"
                onClick={() => onModeChange("bid_ask")}
                className={`rounded-xs px-1.5 py-0.5 ${
                  mode === "bid_ask"
                    ? "bg-[#2962FF] text-white font-medium"
                    : "text-[#ABAEB8] hover:text-white"
                }`}
              >
                Bid×Ask
              </button>
              <button
                type="button"
                onClick={() => onModeChange("delta")}
                className={`rounded-xs px-1.5 py-0.5 ${
                  mode === "delta"
                    ? "bg-[#2962FF] text-white font-medium"
                    : "text-[#ABAEB8] hover:text-white"
                }`}
              >
                Delta
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setShowExtendedStats((v) => !v)}
            className="rounded-xs px-1.5 py-0.5 text-[#ABAEB8] hover:text-white"
            title="Toggle extended ClusterStatistic rows"
          >
            {showExtendedStats ? "2 Rows" : "4 Rows"}
          </button>
          <button
            type="button"
            onClick={() => setVisibleCount((c) => Math.max(4, c - 1))}
            className="px-1 text-[#ABAEB8] hover:text-white"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setVisibleCount((c) => Math.min(16, c + 1))}
            className="px-1 text-[#ABAEB8] hover:text-white"
          >
            -
          </button>
        </div>
      )}

      <div ref={containerRef} className={`relative flex-1 w-full ${heightClass}`}>
        {!hasRealAggressorTape ? (
          <div className="flex h-full flex-col items-center justify-center bg-gradient-to-b from-[#00008B] to-black p-6 text-center">
            <div className="max-w-sm rounded border border-[#2A2E39] bg-[#151B26]/95 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#3BEFF0]">
                No Real Bid/Ask Aggressor Tape in OHLCV Feed
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[#ABAEB8]">
                COMEX GC=F gives real candles and profiles, zero tick-level bid/ask side.
                Clusters stay blank rather than faking footprint volume.
              </p>
              <div className="mt-3 flex items-center justify-center gap-2">
                {onSwitchToPaxg && (
                  <button
                    type="button"
                    onClick={onSwitchToPaxg}
                    className="rounded bg-[#2962FF] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#3a70ff]"
                  >
                    Switch to PAXG Real Tape
                  </button>
                )}
                {onOpenCsvModal && (
                  <button
                    type="button"
                    onClick={onOpenCsvModal}
                    className="rounded border border-[#434651] bg-[#1A2333] px-2.5 py-1 text-[11px] text-[#F1F1F1]"
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
                      Math.max(0, bars.length - 3),
                      prev + (e.deltaY > 0 ? 1 : -1)
                    )
                  )
                );
              } else {
                setVisibleCount((prev) =>
                  Math.max(4, Math.min(16, prev + (e.deltaY > 0 ? 1 : -1)))
                );
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
