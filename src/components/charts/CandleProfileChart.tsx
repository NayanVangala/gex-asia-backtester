"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BigTradePrint,
  Candle,
  KeyLevelZone,
  NakedPoc,
  SimPosition,
  VolumeProfileResult,
} from "@/lib/types";
import { formatPTTime } from "@/lib/goldMath";

interface CandleProfileChartProps {
  title: string;
  subtitle?: string;
  candles: Candle[];
  vwapSeries?: Array<{ ts: number; vwap: number }>;
  profiles?: {
    previousDay?: VolumeProfileResult | null;
    previousWeek?: VolumeProfileResult | null;
    composite5d?: VolumeProfileResult | null;
    developing?: VolumeProfileResult | null;
  };
  activeProfileMode?: "developing" | "pd" | "composite" | "pw";
  nakedPocs?: NakedPoc[];
  zones: KeyLevelZone[];
  activeZoneId?: string | null;
  bigTrades?: BigTradePrint[];
  positions?: SimPosition[];
  asiaOpenTs?: number;
  drawZoneMode?: boolean;
  onDrawZoneComplete?: (low: number, high: number) => void;
  onSelectZone?: (zoneId: string) => void;
  onClickPrice?: (price: number) => void;
  show1OZGrid?: boolean;
  heightClass?: string;
  defaultVisibleBars?: number;
  hoverTs?: number | null;
  onHoverTs?: (ts: number | null) => void;
}

const ZONE_STYLE: Record<
  KeyLevelZone["kind"],
  { fill: string; stroke: string; text: string }
> = {
  stacked: {
    fill: "rgba(250, 204, 21, 0.16)",
    stroke: "#facc15",
    text: "#fde047",
  },
  pd: {
    fill: "rgba(245, 158, 11, 0.10)",
    stroke: "#f59e0b",
    text: "#fbbf24",
  },
  pw: {
    fill: "rgba(56, 189, 248, 0.10)",
    stroke: "#38bdf8",
    text: "#7dd3fc",
  },
  composite: {
    fill: "rgba(167, 139, 250, 0.10)",
    stroke: "#a78bfa",
    text: "#c4b5fd",
  },
  hvn: {
    fill: "rgba(34, 197, 94, 0.08)",
    stroke: "#22c55e",
    text: "#86efac",
  },
  lvn: {
    fill: "rgba(244, 63, 94, 0.08)",
    stroke: "#f43f5e",
    text: "#fda4af",
  },
  npoc: {
    fill: "rgba(251, 146, 60, 0.10)",
    stroke: "#fb923c",
    text: "#fdba74",
  },
  no_trade: {
    fill: "rgba(100, 116, 139, 0.16)",
    stroke: "#64748b",
    text: "#94a3b8",
  },
  custom: {
    fill: "rgba(45, 212, 191, 0.14)",
    stroke: "#2dd4bf",
    text: "#5eead4",
  },
};

export function CandleProfileChart({
  title,
  subtitle,
  candles,
  vwapSeries = [],
  profiles,
  activeProfileMode = "developing",
  nakedPocs = [],
  zones,
  activeZoneId,
  bigTrades = [],
  positions = [],
  asiaOpenTs,
  drawZoneMode = false,
  onDrawZoneComplete,
  onSelectZone,
  onClickPrice,
  show1OZGrid = false,
  heightClass = "h-[340px]",
  defaultVisibleBars = 72,
  hoverTs,
  onHoverTs,
}: CandleProfileChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [barsCount, setBarsCount] = useState(defaultVisibleBars);
  const [rightOffset, setRightOffset] = useState(0); // 0 = pinned to latest bar
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [dragPan, setDragPan] = useState<{
    startX: number;
    startOffset: number;
  } | null>(null);
  const [drawStartPrice, setDrawStartPrice] = useState<number | null>(null);
  const [drawCurrentPrice, setDrawCurrentPrice] = useState<number | null>(null);
  const [dims, setDims] = useState({ width: 640, height: 320 });

  // Reset offset if candles shrunk dramatically (new dataset)
  useEffect(() => {
    setRightOffset((prev) => Math.min(prev, Math.max(0, candles.length - 10)));
  }, [candles.length]);

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

  const visibleSlice = useMemo(() => {
    if (candles.length === 0) return [];
    const endIdx = Math.max(1, candles.length - rightOffset);
    const startIdx = Math.max(0, endIdx - barsCount);
    return candles.slice(startIdx, endIdx);
  }, [candles, barsCount, rightOffset]);

  const vwapMap = useMemo(() => {
    const m = new Map<number, number>();
    for (const v of vwapSeries) m.set(v.ts, v.vwap);
    return m;
  }, [vwapSeries]);

  const activeProfile = useMemo(() => {
    if (!profiles) return null;
    if (activeProfileMode === "pd") return profiles.previousDay ?? null;
    if (activeProfileMode === "pw") return profiles.previousWeek ?? null;
    if (activeProfileMode === "composite") return profiles.composite5d ?? null;
    return profiles.developing ?? profiles.previousDay ?? null;
  }, [profiles, activeProfileMode]);

  const priceBounds = useMemo(() => {
    if (visibleSlice.length === 0) return { min: 3500, max: 3600 };
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of visibleSlice) {
      if (c.low < lo) lo = c.low;
      if (c.high > hi) hi = c.high;
    }
    // Include active positions so stops/targets stay visible
    for (const p of positions) {
      if (p.status === "open") {
        lo = Math.min(lo, p.stopPriceExec, p.t1PriceExec, p.entryPriceExec);
        hi = Math.max(hi, p.stopPriceExec, p.t1PriceExec, p.entryPriceExec);
      }
    }
    const pad = Math.max((hi - lo) * 0.14, 1.5);
    return { min: lo - pad, max: hi + pad };
  }, [visibleSlice, positions]);

  const layout = useMemo(() => {
    const padLeft = 8;
    const padTop = 14;
    const padBottom = 24;
    const axisRightWidth = 66;
    const profileWidth = activeProfile ? 68 : 0;
    const plotWidth = Math.max(
      80,
      dims.width - padLeft - axisRightWidth - profileWidth - 6
    );
    const plotHeight = Math.max(80, dims.height - padTop - padBottom);
    const volHeight = Math.min(46, Math.floor(plotHeight * 0.18));
    const priceHeight = plotHeight - volHeight - 6;

    return {
      padLeft,
      padTop,
      padBottom,
      axisRightWidth,
      profileWidth,
      plotWidth,
      plotHeight,
      volHeight,
      priceHeight,
    };
  }, [dims, activeProfile]);

  const yToPrice = (y: number) => {
    const frac = (y - layout.padTop) / layout.priceHeight;
    return priceBounds.max - frac * (priceBounds.max - priceBounds.min);
  };

  const priceToY = (price: number) => {
    const span = Math.max(0.01, priceBounds.max - priceBounds.min);
    return layout.padTop + ((priceBounds.max - price) / span) * layout.priceHeight;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = dims.width * dpr;
    canvas.height = dims.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.fillStyle = "#090d14";
    ctx.fillRect(0, 0, dims.width, dims.height);

    const { padLeft, padTop, plotWidth, priceHeight, volHeight, profileWidth } = layout;

    if (visibleSlice.length === 0) {
      ctx.fillStyle = "#64748b";
      ctx.font = "12px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("No candles in view", dims.width / 2, dims.height / 2);
      return;
    }

    // Horizontal grid lines + price labels
    const numGrid = 6;
    const priceSpan = priceBounds.max - priceBounds.min;
    ctx.strokeStyle = "#141b29";
    ctx.lineWidth = 1;
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "left";

    for (let i = 0; i <= numGrid; i++) {
      const p = priceBounds.max - (i / numGrid) * priceSpan;
      const y = Math.round(priceToY(p)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(dims.width - layout.axisRightWidth, y);
      ctx.stroke();

      ctx.fillStyle = "#7c8aa5";
      ctx.fillText(
        p.toFixed(show1OZGrid ? 2 : 1),
        dims.width - layout.axisRightWidth + 6,
        y + 3
      );
    }

    // Shade Developing Value middle no-trade zone if developing profile exists
    if (profiles?.developing) {
      const dev = profiles.developing;
      const yVah = priceToY(dev.vah);
      const yVal = priceToY(dev.val);
      const top = Math.max(padTop, Math.min(yVah, yVal));
      const bot = Math.min(padTop + priceHeight, Math.max(yVah, yVal));
      if (bot > top) {
        ctx.fillStyle = "rgba(100, 116, 139, 0.09)";
        ctx.fillRect(padLeft, top, plotWidth, bot - top);
        ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(padLeft, yVah);
        ctx.lineTo(padLeft + plotWidth, yVah);
        ctx.moveTo(padLeft, yVal);
        ctx.lineTo(padLeft + plotWidth, yVal);
        ctx.stroke();
        ctx.setLineDash([]);

        // Developing vPOC line
        const yPoc = priceToY(dev.poc);
        if (yPoc >= padTop && yPoc <= padTop + priceHeight) {
          ctx.strokeStyle = "rgba(251, 191, 36, 0.55)";
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 2]);
          ctx.beginPath();
          ctx.moveTo(padLeft, yPoc);
          ctx.lineTo(padLeft + plotWidth, yPoc);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    // Draw Key Level Zones
    for (const z of zones) {
      const yTop = priceToY(z.high);
      const yBot = priceToY(z.low);
      if (yBot < padTop || yTop > padTop + priceHeight) continue;
      const clampedTop = Math.max(padTop, yTop);
      const clampedBot = Math.min(padTop + priceHeight, yBot);
      const st = ZONE_STYLE[z.kind] ?? ZONE_STYLE.custom;
      const isSelected = z.id === activeZoneId;

      ctx.fillStyle = isSelected ? "rgba(250, 204, 21, 0.25)" : st.fill;
      ctx.fillRect(padLeft, clampedTop, plotWidth, Math.max(2, clampedBot - clampedTop));

      ctx.strokeStyle = isSelected ? "#fef08a" : st.stroke;
      ctx.lineWidth = isSelected ? 1.5 : 1;
      if (!z.pinned && !isSelected) ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(padLeft, clampedTop);
      ctx.lineTo(padLeft + plotWidth, clampedTop);
      ctx.moveTo(padLeft, clampedBot);
      ctx.lineTo(padLeft + plotWidth, clampedBot);
      ctx.stroke();
      ctx.setLineDash([]);

      // Zone tag on left edge
      ctx.fillStyle = st.text;
      ctx.font = isSelected ? "bold 10px ui-monospace, monospace" : "10px ui-monospace, monospace";
      const badge = `${z.label} (${z.low.toFixed(1)}-${z.high.toFixed(1)})${z.untested ? " [UNTESTED]" : ""}`;
      ctx.fillText(badge, padLeft + 6, Math.max(padTop + 10, clampedTop + 11));
    }

    // Draw Naked POCs
    for (const np of nakedPocs) {
      if (!np.untested) continue;
      const y = priceToY(np.price);
      if (y < padTop || y > padTop + priceHeight) continue;
      ctx.strokeStyle = "#fb923c";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotWidth, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#fdba74";
      ctx.font = "9px ui-monospace, monospace";
      ctx.fillText(`nPOC ${np.price.toFixed(1)}`, padLeft + plotWidth - 88, y - 3);
    }

    // Draw Tokyo open vertical marker
    const stepX = plotWidth / Math.max(1, visibleSlice.length);
    const candleWidth = Math.max(2, Math.min(14, stepX * 0.68));
    if (asiaOpenTs) {
      const idx = visibleSlice.findIndex((c) => c.ts >= asiaOpenTs);
      if (idx > 0) {
        const x = padLeft + idx * stepX + stepX / 2;
        ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, padTop);
        ctx.lineTo(x, padTop + priceHeight + volHeight);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#38bdf8";
        ctx.font = "9px ui-monospace, monospace";
        ctx.fillText("TOKYO 16:00 PT", x + 4, padTop + 11);
      }
    }

    // Draw Candles + Volume Bars
    const maxVol = Math.max(...visibleSlice.map((c) => c.volume), 1);
    const volTop = padTop + priceHeight + 6;

    for (let i = 0; i < visibleSlice.length; i++) {
      const c = visibleSlice[i];
      const cx = padLeft + i * stepX + stepX / 2;
      const isUp = c.close >= c.open;
      const color = isUp ? "#10b981" : "#ef4444";

      const yHigh = priceToY(c.high);
      const yLow = priceToY(c.low);
      const yOpen = priceToY(c.open);
      const yClose = priceToY(c.close);

      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(cx) + 0.5, yHigh);
      ctx.lineTo(Math.round(cx) + 0.5, yLow);
      ctx.stroke();

      // Body
      const bodyTop = Math.min(yOpen, yClose);
      const bodyH = Math.max(1.5, Math.abs(yClose - yOpen));
      ctx.fillStyle = isUp ? "#059669" : "#dc2626";
      ctx.fillRect(cx - candleWidth / 2, bodyTop, candleWidth, bodyH);

      // Volume histogram
      const vh = (c.volume / maxVol) * (volHeight - 4);
      ctx.fillStyle = isUp
        ? "rgba(16, 185, 129, 0.35)"
        : "rgba(239, 68, 68, 0.35)";
      ctx.fillRect(
        cx - candleWidth / 2,
        volTop + volHeight - vh,
        candleWidth,
        vh
      );
    }

    // Draw VWAP curve
    if (vwapMap.size > 0) {
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < visibleSlice.length; i++) {
        const v = vwapMap.get(visibleSlice[i].ts);
        if (v === undefined) continue;
        const x = padLeft + i * stepX + stepX / 2;
        const y = priceToY(v);
        if (y < padTop || y > padTop + priceHeight) {
          started = false;
          continue;
        }
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    // Draw Big Trades tape markers (Section 15: markers on candles from trade tape, NOT heatmap bubbles)
    if (bigTrades.length > 0) {
      const tsToIdx = new Map<number, number>();
      visibleSlice.forEach((c, idx) => tsToIdx.set(c.ts, idx));
      for (const bt of bigTrades) {
        const idx = tsToIdx.get(bt.barTs);
        if (idx === undefined) continue;
        const cx = padLeft + idx * stepX + stepX / 2;
        const cy = priceToY(bt.price);
        if (cy < padTop || cy > padTop + priceHeight) continue;
        const radius = bt.tier === "whale" ? 5.5 : 3.5;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle =
          bt.side === "buy"
            ? "rgba(34, 197, 94, 0.72)"
            : bt.side === "sell"
              ? "rgba(244, 63, 94, 0.72)"
              : "rgba(250, 204, 21, 0.65)";
        ctx.fill();
        ctx.strokeStyle = bt.tier === "whale" ? "#fef08a" : "#0b0f17";
        ctx.lineWidth = bt.tier === "whale" ? 1.5 : 1;
        ctx.stroke();
      }
    }

    // Draw Right-Hand Volume Profile Histogram
    if (activeProfile && profileWidth > 0) {
      const profRightX = dims.width - layout.axisRightWidth - 2;
      const maxBinVol = Math.max(...activeProfile.bins.map((b) => b.volume), 1);

      for (const bin of activeProfile.bins) {
        const y = priceToY(bin.price);
        if (y < padTop || y > padTop + priceHeight) continue;
        const barW = Math.max(2, (bin.volume / maxBinVol) * (profileWidth - 4));
        const inVa = bin.price >= activeProfile.val && bin.price <= activeProfile.vah;
        const isPoc = Math.abs(bin.price - activeProfile.poc) < 1e-4;

        ctx.fillStyle = isPoc
          ? "#facc15"
          : inVa
            ? "rgba(56, 189, 248, 0.42)"
            : "rgba(100, 116, 139, 0.28)";
        ctx.fillRect(profRightX - barW, y - 1.5, barW, 3);
      }

      // Label VAH / POC / VAL ticks on profile column
      const drawTag = (p: number, lbl: string, color: string) => {
        const y = priceToY(p);
        if (y < padTop || y > padTop + priceHeight) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(profRightX - profileWidth, y);
        ctx.lineTo(profRightX, y);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.font = "bold 9px ui-monospace, monospace";
        ctx.fillText(lbl, profRightX - profileWidth + 2, y - 2);
      };
      drawTag(activeProfile.vah, "VAH", "#38bdf8");
      drawTag(activeProfile.poc, "POC", "#facc15");
      drawTag(activeProfile.val, "VAL", "#38bdf8");
    }

    // Draw Active/Closed Positions lines
    for (const pos of positions) {
      if (pos.status !== "open") continue;
      const drawOrderLine = (price: number, label: string, color: string) => {
        const y = priceToY(price);
        if (y < padTop || y > padTop + priceHeight) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.3;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + plotWidth, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.font = "bold 10px ui-monospace, monospace";
        ctx.fillText(`${label} ${price.toFixed(2)}`, padLeft + 8, y - 4);
      };
      drawOrderLine(pos.entryPriceExec, `${pos.side.toUpperCase()} ${pos.contracts}x`, "#38bdf8");
      drawOrderLine(pos.stopPriceExec, "STOP", "#ef4444");
      drawOrderLine(pos.t1PriceExec, "T1", "#10b981");
      drawOrderLine(pos.t2PriceExec, "T2", "#22c55e");
    }

    // Draw interactive zone preview while dragging
    if (drawZoneMode && drawStartPrice !== null && drawCurrentPrice !== null) {
      const y1 = priceToY(Math.max(drawStartPrice, drawCurrentPrice));
      const y2 = priceToY(Math.min(drawStartPrice, drawCurrentPrice));
      ctx.fillStyle = "rgba(45, 212, 191, 0.22)";
      ctx.fillRect(padLeft, y1, plotWidth, Math.max(2, y2 - y1));
      ctx.strokeStyle = "#2dd4bf";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(padLeft, y1, plotWidth, Math.max(2, y2 - y1));
    }

    // Current Last Price badge on right axis
    const lastCandle = visibleSlice[visibleSlice.length - 1];
    if (lastCandle) {
      const ly = priceToY(lastCandle.close);
      const isUp = lastCandle.close >= lastCandle.open;
      ctx.fillStyle = isUp ? "#059669" : "#dc2626";
      ctx.fillRect(dims.width - layout.axisRightWidth, ly - 8, layout.axisRightWidth - 2, 16);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 10px ui-monospace, monospace";
      ctx.fillText(
        lastCandle.close.toFixed(2),
        dims.width - layout.axisRightWidth + 5,
        ly + 3
      );
    }

    // Time Axis labels (PT)
    ctx.fillStyle = "#7c8aa5";
    ctx.font = "10px ui-monospace, monospace";
    const labelEvery = Math.max(1, Math.floor(visibleSlice.length / 7));
    for (let i = 0; i < visibleSlice.length; i += labelEvery) {
      const x = padLeft + i * stepX + stepX / 2;
      ctx.fillText(formatPTTime(visibleSlice[i].ts), x - 16, dims.height - 6);
    }

    // Synced external hover vertical line
    if (hoverTs && !mousePos) {
      const idx = visibleSlice.findIndex((c) => c.ts >= hoverTs);
      if (idx !== -1) {
        const hx = padLeft + idx * stepX + stepX / 2;
        ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(hx, padTop);
        ctx.lineTo(hx, padTop + priceHeight + volHeight);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Local Crosshair + OHLC readout
    if (mousePos) {
      const { x, y } = mousePos;
      ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + priceHeight + volHeight);
      ctx.moveTo(padLeft, y);
      ctx.lineTo(dims.width - layout.axisRightWidth, y);
      ctx.stroke();
      ctx.setLineDash([]);

      const hp = yToPrice(y);
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(dims.width - layout.axisRightWidth, y - 8, layout.axisRightWidth - 2, 16);
      ctx.fillStyle = "#f8fafc";
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillText(hp.toFixed(2), dims.width - layout.axisRightWidth + 5, y + 3);
    }
  }, [
    dims,
    visibleSlice,
    priceBounds,
    layout,
    zones,
    activeZoneId,
    profiles,
    activeProfile,
    nakedPocs,
    vwapMap,
    bigTrades,
    positions,
    asiaOpenTs,
    mousePos,
    hoverTs,
    drawZoneMode,
    drawStartPrice,
    drawCurrentPrice,
    show1OZGrid,
  ]);

  const hoveredCandle = useMemo(() => {
    if (!mousePos || visibleSlice.length === 0) return visibleSlice[visibleSlice.length - 1] ?? null;
    const idx = Math.floor(
      ((mousePos.x - layout.padLeft) / layout.plotWidth) * visibleSlice.length
    );
    return visibleSlice[Math.max(0, Math.min(visibleSlice.length - 1, idx))] ?? null;
  }, [mousePos, visibleSlice, layout]);

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.12 : 0.88;
    setBarsCount((prev) =>
      Math.max(16, Math.min(Math.max(40, candles.length), Math.round(prev * factor)))
    );
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const clickedPrice = yToPrice(y);

    if (drawZoneMode) {
      setDrawStartPrice(clickedPrice);
      setDrawCurrentPrice(clickedPrice);
      return;
    }

    // Check if clicking inside an existing zone
    const hitZone = zones.find(
      (z) => clickedPrice >= z.low && clickedPrice <= z.high
    );
    if (hitZone && onSelectZone && e.detail === 1) {
      onSelectZone(hitZone.id);
    }
    if (e.altKey && onClickPrice) {
      onClickPrice(Number(clickedPrice.toFixed(2)));
      return;
    }

    setDragPan({ startX: x, startOffset: rightOffset });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setMousePos({ x, y });

    if (visibleSlice.length > 0 && onHoverTs) {
      const idx = Math.floor(((x - layout.padLeft) / layout.plotWidth) * visibleSlice.length);
      const bar = visibleSlice[Math.max(0, Math.min(visibleSlice.length - 1, idx))];
      if (bar) onHoverTs(bar.ts);
    }

    if (drawZoneMode && drawStartPrice !== null) {
      setDrawCurrentPrice(yToPrice(y));
      return;
    }

    if (dragPan) {
      const dx = x - dragPan.startX;
      const barsPerPx = barsCount / Math.max(1, layout.plotWidth);
      const next = Math.round(dragPan.startOffset + dx * barsPerPx);
      setRightOffset(Math.max(0, Math.min(Math.max(0, candles.length - 12), next)));
    }
  };

  const handleMouseUp = () => {
    if (drawZoneMode && drawStartPrice !== null && drawCurrentPrice !== null) {
      const lo = Number(Math.min(drawStartPrice, drawCurrentPrice).toFixed(2));
      const hi = Number(Math.max(drawStartPrice, drawCurrentPrice).toFixed(2));
      if (hi - lo >= 0.25 && onDrawZoneComplete) {
        onDrawZoneComplete(lo, hi);
      }
      setDrawStartPrice(null);
      setDrawCurrentPrice(null);
    }
    setDragPan(null);
  };

  return (
    <div className="flex flex-col rounded-lg border border-[#1c2436] bg-[#090d14] overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-[#1c2436] bg-[#0c111b] px-3 py-1.5 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold tracking-wide text-slate-100">
            {title}
          </span>
          {subtitle && (
            <span className="truncate text-[11px] text-slate-400">
              {subtitle}
            </span>
          )}
          {drawZoneMode && (
            <span className="rounded bg-teal-500/20 px-1.5 py-0.5 text-[10px] font-medium text-teal-300 border border-teal-500/40">
              DRAG TO DRAW ZONE
            </span>
          )}
        </div>
        {hoveredCandle && (
          <div className="hidden sm:flex items-center gap-2.5 font-mono-num text-[11px] text-slate-300">
            <span className="text-slate-500">
              {formatPTTime(hoveredCandle.ts, true)} PT
            </span>
            <span>O {hoveredCandle.open.toFixed(2)}</span>
            <span className="text-emerald-400">H {hoveredCandle.high.toFixed(2)}</span>
            <span className="text-rose-400">L {hoveredCandle.low.toFixed(2)}</span>
            <span
              className={
                hoveredCandle.close >= hoveredCandle.open
                  ? "text-emerald-400 font-semibold"
                  : "text-rose-400 font-semibold"
              }
            >
              C {hoveredCandle.close.toFixed(2)}
            </span>
            <span className="text-slate-400">
              V {hoveredCandle.volume >= 10 ? hoveredCandle.volume.toFixed(0) : hoveredCandle.volume.toFixed(2)}
            </span>
          </div>
        )}
      </div>
      <div ref={containerRef} className={`relative w-full ${heightClass}`}>
        <canvas
          ref={canvasRef}
          className={`block h-full w-full ${drawZoneMode ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"}`}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            setMousePos(null);
            setDragPan(null);
            if (onHoverTs) onHoverTs(null);
          }}
        />
      </div>
    </div>
  );
}
