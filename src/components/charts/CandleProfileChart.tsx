"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BigTradePrint,
  Candle,
  FootprintBar,
  KeyLevelZone,
  NakedPoc,
  PendingOrder,
  SimPosition,
  VolumeProfileResult,
} from "@/lib/types";
import { formatPTTime } from "@/lib/goldMath";
import { ATAS_ASIA_THEME as T } from "@/lib/atasTheme";

export type PricePickTarget = "entry" | "stop" | "t1" | "t2" | null;

interface CandleProfileChartProps {
  title: string;
  timeframeLabel: "H1" | "M30" | "M5" | "M1";
  instrumentLabel?: string;
  candles: Candle[];
  footprintBars?: FootprintBar[]; // For ATAS Absorption 5px horizontal bars & DeltaStrength dots
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
  pendingOrders?: PendingOrder[];
  asiaOpenTs?: number;
  drawZoneMode?: boolean;
  pickPriceMode?: PricePickTarget;
  onDrawZoneComplete?: (low: number, high: number) => void;
  onSelectZone?: (zoneId: string) => void;
  onClickPrice?: (price: number) => void;
  show1OZGrid?: boolean;
  heightClass?: string;
  defaultVisibleBars?: number;
  hoverTs?: number | null;
  onHoverTs?: (ts: number | null) => void;
  indicatorBadges?: string[];
}

export function CandleProfileChart({
  title,
  timeframeLabel,
  instrumentLabel = "/GC:XCEC",
  candles,
  footprintBars = [],
  vwapSeries = [],
  profiles,
  activeProfileMode = "developing",
  nakedPocs = [],
  zones,
  activeZoneId,
  bigTrades = [],
  positions = [],
  pendingOrders = [],
  asiaOpenTs,
  drawZoneMode = false,
  pickPriceMode = null,
  onDrawZoneComplete,
  onSelectZone,
  onClickPrice,
  show1OZGrid = false,
  heightClass = "h-full min-h-[260px]",
  defaultVisibleBars = 72,
  hoverTs,
  onHoverTs,
  indicatorBadges = [
    "VWAP (Yellow)",
    "BigTrades (Large/Whale)",
    "Absorption (300%)",
    "BarTimer",
  ],
}: CandleProfileChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [barsCount, setBarsCount] = useState(defaultVisibleBars);
  const [rightOffset, setRightOffset] = useState(0);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [dragPan, setDragPan] = useState<{
    startX: number;
    startOffset: number;
  } | null>(null);
  const [drawStartPrice, setDrawStartPrice] = useState<number | null>(null);
  const [drawCurrentPrice, setDrawCurrentPrice] = useState<number | null>(null);
  const [dims, setDims] = useState({ width: 640, height: 340 });

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

  // Keep only active + pinned + top 3 nearest levels so ATAS canvas stays clean
  const displayZones = useMemo(() => {
    const picked: KeyLevelZone[] = [];
    const seen = new Set<string>();
    const add = (z: KeyLevelZone) => {
      if (!seen.has(z.id)) {
        seen.add(z.id);
        picked.push(z);
      }
    };
    const active = zones.find((z) => z.id === activeZoneId);
    if (active) add(active);
    zones.filter((z) => z.kind === "custom").forEach(add);
    zones.filter((z) => z.pinned).slice(0, 3).forEach(add);
    if (picked.length < 3) zones.slice(0, 3).forEach(add);
    return picked.slice(0, 4);
  }, [zones, activeZoneId]);

  const vwapMap = useMemo(() => {
    const m = new Map<number, number>();
    for (const v of vwapSeries) m.set(v.ts, v.vwap);
    return m;
  }, [vwapSeries]);

  const fpByTs = useMemo(() => {
    const m = new Map<number, FootprintBar>();
    for (const f of footprintBars) m.set(f.ts, f);
    return m;
  }, [footprintBars]);

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
    for (const p of positions) {
      if (p.status === "open") {
        lo = Math.min(lo, p.stopPriceExec, p.t1PriceExec, p.entryPriceExec);
        hi = Math.max(hi, p.stopPriceExec, p.t1PriceExec, p.entryPriceExec);
      }
    }
    for (const o of pendingOrders) {
      lo = Math.min(lo, o.triggerPriceExec, o.invalidationPriceExec, o.stopPriceExec);
      hi = Math.max(hi, o.triggerPriceExec, o.invalidationPriceExec, o.stopPriceExec);
    }
    const pad = Math.max((hi - lo) * 0.14, 1.2);
    return { min: lo - pad, max: hi + pad };
  }, [visibleSlice, positions, pendingOrders]);

  const layout = useMemo(() => {
    const padLeft = 8;
    const padTop = 18;
    const padBottom = 22;
    const axisRightWidth = 66;
    const chartOffsetRight = 24; // ATAS ChartOffset: 30 whitespace right of last bar
    const profileWidth = activeProfile ? 58 : 0;
    const plotWidth = Math.max(
      80,
      dims.width - padLeft - axisRightWidth - profileWidth - chartOffsetRight
    );
    const plotHeight = Math.max(80, dims.height - padTop - padBottom);
    const volHeight = Math.min(34, Math.floor(plotHeight * 0.13));
    const priceHeight = plotHeight - volHeight - 4;

    return {
      padLeft,
      padTop,
      padBottom,
      axisRightWidth,
      chartOffsetRight,
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

  // Exact ATAS bear candle color per timeframe from Asia_Template_Fixed.aws
  const bearCandleColor =
    timeframeLabel === "M5" || timeframeLabel === "M1"
      ? T.candles.bearM5M1 // rgb(0, 160, 255)
      : T.candles.bearCyan; // rgb(59, 239, 240)

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = dims.width * dpr;
    canvas.height = dims.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const { padLeft, padTop, plotWidth, priceHeight, volHeight, profileWidth } = layout;
    const axisX = dims.width - layout.axisRightWidth;
    const timeAxisY = dims.height - layout.padBottom;

    // 1. EXACT ATAS X Vertical Gradient Background: rgb(0,0,107) -> Black
    const bgGrad = ctx.createLinearGradient(0, 0, 0, timeAxisY);
    bgGrad.addColorStop(0, T.canvas.candleBgTop);
    bgGrad.addColorStop(1, T.canvas.bgBottom);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, axisX, timeAxisY);

    // 2. ATAS Axis Strips (#151B26)
    ctx.fillStyle = T.chrome.panelBg;
    ctx.fillRect(axisX, 0, layout.axisRightWidth, dims.height);
    ctx.fillRect(0, timeAxisY, dims.width, layout.padBottom);

    // Subtle hairline axis separators
    ctx.strokeStyle = T.chrome.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axisX + 0.5, 0);
    ctx.lineTo(axisX + 0.5, dims.height);
    ctx.moveTo(0, timeAxisY + 0.5);
    ctx.lineTo(dims.width, timeAxisY + 0.5);
    ctx.stroke();

    if (visibleSlice.length === 0) {
      ctx.fillStyle = T.chrome.textSecondary;
      ctx.font = "11px 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Loading historical session...", axisX / 2, timeAxisY / 2);
      return;
    }

    // 3. Ultra-faint ATAS Grid + Price Axis Labels (10px, #ABAEB8)
    const numGrid = 6;
    const priceSpan = priceBounds.max - priceBounds.min;
    ctx.strokeStyle = T.canvas.grid;
    ctx.lineWidth = 1;
    ctx.font = "10px 'Segoe UI', ui-monospace, monospace";
    ctx.textAlign = "left";

    for (let i = 0; i <= numGrid; i++) {
      const p = priceBounds.max - (i / numGrid) * priceSpan;
      const y = Math.round(priceToY(p)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(axisX, y);
      ctx.stroke();

      ctx.fillStyle = T.chrome.textSecondary;
      ctx.fillText(p.toFixed(show1OZGrid ? 2 : 1), axisX + 6, y + 3.5);
    }

    // 4. Developing Value faint band
    if (profiles?.developing) {
      const dev = profiles.developing;
      const yVah = priceToY(dev.vah);
      const yVal = priceToY(dev.val);
      const top = Math.max(padTop, Math.min(yVah, yVal));
      const bot = Math.min(padTop + priceHeight, Math.max(yVah, yVal));
      if (bot > top) {
        ctx.fillStyle = "rgba(100, 160, 255, 0.05)";
        ctx.fillRect(padLeft, top, axisX - padLeft, bot - top);
      }
    }

    // 5. Key Level Zones styled like ATAS DrawingObjects (Cyan dashed & Red solid rays, right-aligned labels)
    const usedLabelYs: number[] = [];
    for (const z of displayZones) {
      const yTop = priceToY(z.high);
      const yBot = priceToY(z.low);
      if (yBot < padTop || yTop > padTop + priceHeight) continue;
      const clampedTop = Math.max(padTop, yTop);
      const clampedBot = Math.min(padTop + priceHeight, yBot);
      const isSelected = z.id === activeZoneId;
      const isCyan = z.kind === "pw" || z.kind === "custom" || z.kind === "composite";
      const lineColor = isSelected
        ? "#FFFF00"
        : z.kind === "stacked"
          ? T.indicators.levelRed
          : isCyan
            ? T.indicators.levelCyan
            : T.indicators.levelRed;

      ctx.fillStyle = isSelected
        ? "rgba(255, 255, 0, 0.09)"
        : isCyan
          ? "rgba(59, 239, 240, 0.08)"
          : "rgba(255, 58, 58, 0.08)";
      ctx.fillRect(padLeft, clampedTop, axisX - padLeft - profileWidth, Math.max(2, clampedBot - clampedTop));

      ctx.strokeStyle = lineColor;
      ctx.lineWidth = isSelected ? 2 : 1.5;
      if (isCyan && !isSelected) ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(padLeft, clampedTop);
      ctx.lineTo(axisX - profileWidth, clampedTop);
      ctx.moveTo(padLeft, clampedBot);
      ctx.lineTo(axisX - profileWidth, clampedBot);
      ctx.stroke();
      ctx.setLineDash([]);

      // ATAS topRight label style
      const labelY = Math.max(padTop + 11, clampedTop - 3);
      if (usedLabelYs.every((uy) => Math.abs(uy - labelY) >= 14)) {
        usedLabelYs.push(labelY);
        const lbl = `${z.label.replace("STACKED: ", "")} ${z.low.toFixed(1)}-${z.high.toFixed(1)}`;
        ctx.font = "9.5px 'Segoe UI', ui-monospace, monospace";
        ctx.textAlign = "right";
        ctx.fillStyle = lineColor;
        ctx.fillText(lbl, axisX - profileWidth - 6, labelY);
        ctx.textAlign = "left";
      }
    }

    // 6. Naked POCs (subtle cyan/orange dotted rays)
    for (const np of nakedPocs.slice(-2)) {
      if (!np.untested) continue;
      const y = priceToY(np.price);
      if (y < padTop || y > padTop + priceHeight) continue;
      ctx.strokeStyle = "rgba(255, 73, 0, 0.65)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(axisX - profileWidth, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#FF8547";
      ctx.font = "9px 'Segoe UI', monospace";
      ctx.fillText(`nPOC ${np.price.toFixed(1)}`, padLeft + 6, y - 3);
    }

    // 7. New Session Vertical Line (ATAS NewSessionPen: rgb(73, 133, 231) dashed)
    const stepX = plotWidth / Math.max(1, visibleSlice.length);
    const candleWidth = Math.max(2, Math.min(12, stepX * 0.68));
    if (asiaOpenTs) {
      const idx = visibleSlice.findIndex((c) => c.ts >= asiaOpenTs);
      if (idx > 0) {
        const x = Math.round(padLeft + idx * stepX + stepX / 2) + 0.5;
        ctx.strokeStyle = T.chrome.sessionLine;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, padTop);
        ctx.lineTo(x, timeAxisY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = T.chrome.sessionLine;
        ctx.font = "9px 'Segoe UI', monospace";
        ctx.fillText("Asia 16:00 PT", x + 4, padTop + 10);
      }
    }

    // 8. ATAS Absorption Indicator (exact 5px translucent green/red bands at absorption lows/highs!)
    if (footprintBars.length > 0) {
      for (let i = 0; i < visibleSlice.length; i++) {
        const c = visibleSlice[i];
        const fp = fpByTs.get(c.ts);
        if (!fp) continue;
        const cx = padLeft + i * stepX + stepX / 2;
        if (fp.absorptionLow) {
          const y = priceToY(c.low);
          ctx.fillStyle = T.indicators.absorptionBull; // rgba(60, 243, 60, 0.36)
          ctx.fillRect(cx - candleWidth, y - 2.5, candleWidth * 3.5, 5);
        }
        if (fp.absorptionHigh) {
          const y = priceToY(c.high);
          ctx.fillStyle = T.indicators.absorptionBear; // rgba(255, 58, 58, 0.36)
          ctx.fillRect(cx - candleWidth, y - 2.5, candleWidth * 3.5, 5);
        }
      }
    }

    // 9. EXACT ATAS CANDLES: Solid White Bull (#FFFFFF) + Electric Blue/Cyan Bear (#00A0FF / #3BEFF0)
    const maxVol = Math.max(...visibleSlice.map((c) => c.volume), 1);
    const volTop = padTop + priceHeight + 4;

    for (let i = 0; i < visibleSlice.length; i++) {
      const c = visibleSlice[i];
      const cx = padLeft + i * stepX + stepX / 2;
      const isDoji = Math.abs(c.close - c.open) < 0.01;
      const isUp = c.close > c.open;
      const color = isDoji
        ? T.candles.doji
        : isUp
          ? T.candles.bull
          : bearCandleColor;

      const yHigh = priceToY(c.high);
      const yLow = priceToY(c.low);
      const yOpen = priceToY(c.open);
      const yClose = priceToY(c.close);

      // Wick (matches body color, ATAS CandleBorderColorAsBody: true)
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(cx) + 0.5, yHigh);
      ctx.lineTo(Math.round(cx) + 0.5, yLow);
      ctx.stroke();

      // Solid borderless body (DrawCandleBorder: false)
      const bodyTop = Math.min(yOpen, yClose);
      const bodyH = Math.max(1.5, Math.abs(yClose - yOpen));
      ctx.fillStyle = color;
      ctx.fillRect(cx - candleWidth / 2, bodyTop, candleWidth, bodyH);

      // Subtle bottom volume ticks
      const vh = (c.volume / maxVol) * (volHeight - 2);
      ctx.fillStyle = isUp
        ? "rgba(255, 255, 255, 0.2)"
        : "rgba(0, 160, 255, 0.25)";
      ctx.fillRect(cx - candleWidth / 2, volTop + volHeight - vh, candleWidth, vh);
    }

    // 10. EXACT ATAS YELLOW VWAP (VWAPOnly: true, Color: Yellow)
    if (vwapMap.size > 0) {
      ctx.strokeStyle = T.indicators.vwap;
      ctx.lineWidth = 1.6;
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

    // 11. EXACT ATAS TWO-TIER BIG TRADES ELLIPSES
    // Tier 1 (Large): Buy #0073FF (blue), Sell #F2385A (crimson)
    // Tier 2 (Whale): Buy #3BEFF0 (cyan), Sell #D900FC (neon magenta)
    if (bigTrades.length > 0) {
      const tsToIdx = new Map<number, number>();
      visibleSlice.forEach((c, idx) => tsToIdx.set(c.ts, idx));
      for (const bt of bigTrades) {
        const idx = tsToIdx.get(bt.barTs);
        if (idx === undefined) continue;
        const cx = padLeft + idx * stepX + stepX / 2;
        const cy = priceToY(bt.price);
        if (cy < padTop || cy > padTop + priceHeight) continue;
        const radius = bt.tier === "whale" ? 7 : 4.5;
        const fillHex =
          bt.tier === "whale"
            ? bt.side === "buy"
              ? T.indicators.bigTradeWhaleBuy
              : T.indicators.bigTradeWhaleSell
            : bt.side === "buy"
              ? T.indicators.bigTradeLargeBuy
              : T.indicators.bigTradeLargeSell;

        ctx.save();
        ctx.globalAlpha = bt.tier === "whale" ? 0.72 : 0.62;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = fillHex;
        ctx.fill();
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = fillHex;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }
    }

    // 12. Right-Hand Volume Profile Histogram (Cobalt Blue #2962FF + Blazing Orange #FF4900 POC)
    if (activeProfile && profileWidth > 0) {
      const profRightX = axisX - 2;
      const maxBinVol = Math.max(...activeProfile.bins.map((b) => b.volume), 1);

      for (const bin of activeProfile.bins) {
        const y = priceToY(bin.price);
        if (y < padTop || y > padTop + priceHeight) continue;
        const barW = Math.max(2, (bin.volume / maxBinVol) * (profileWidth - 4));
        const inVa = bin.price >= activeProfile.val && bin.price <= activeProfile.vah;
        const isPoc = Math.abs(bin.price - activeProfile.poc) < 1e-4;

        ctx.fillStyle = isPoc
          ? T.clusters.pocVolume // #FF4900
          : inVa
            ? "rgba(41, 98, 255, 0.55)" // #2962FF
            : "rgba(41, 98, 255, 0.24)";
        ctx.fillRect(profRightX - barW, y - 1.3, barW, 2.6);
      }

      const drawProfileTick = (p: number, lbl: string, color: string) => {
        const y = priceToY(p);
        if (y < padTop || y > padTop + priceHeight) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(profRightX - profileWidth, y);
        ctx.lineTo(profRightX, y);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.font = "600 8.5px 'Segoe UI', monospace";
        ctx.fillText(lbl, profRightX - profileWidth + 2, y - 2);
      };
      drawProfileTick(activeProfile.vah, "VAH", "#74A6E2");
      drawProfileTick(activeProfile.poc, "POC", T.clusters.pocVolume);
      drawProfileTick(activeProfile.val, "VAL", "#74A6E2");
    }

    // 13. ATAS Trading Orders & Position Lines (exact TradingSettings colors: #089981 Buy, #F2385A Sell)
    const findBarX = (ts: number) => {
      let idx = visibleSlice.findIndex((c) => c.ts >= ts);
      if (idx === -1) idx = visibleSlice.length - 1;
      return padLeft + idx * stepX + stepX / 2;
    };

    for (const ord of pendingOrders) {
      const yTrig = priceToY(ord.triggerPriceExec);
      const yInv = priceToY(ord.invalidationPriceExec);
      const col = ord.side === "long" ? T.trading.buyOrder : T.trading.sellOrder;
      if (yTrig >= padTop && yTrig <= padTop + priceHeight) {
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(padLeft, yTrig);
        ctx.lineTo(axisX, yTrig);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = col;
        ctx.fillRect(padLeft + 6, yTrig - 9, 134, 15);
        ctx.fillStyle = "#FFFFFF";
        ctx.font = "600 9.5px 'Segoe UI', monospace";
        ctx.fillText(
          `${ord.side.toUpperCase()} ${ord.orderType.toUpperCase()} ${ord.triggerPriceExec.toFixed(2)}`,
          padLeft + 10,
          yTrig + 2
        );
      }
      if (yInv >= padTop && yInv <= padTop + priceHeight) {
        ctx.strokeStyle = T.trading.sellOrder;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(padLeft, yInv);
        ctx.lineTo(axisX, yInv);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    for (const pos of positions) {
      const entryX = findBarX(pos.openedAtTs);
      const entryY = priceToY(pos.entryPriceExec);
      if (pos.status === "open") {
        const drawLine = (p: number, lbl: string, col: string) => {
          const y = priceToY(p);
          if (y < padTop || y > padTop + priceHeight) return;
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.3;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(padLeft, y);
          ctx.lineTo(axisX, y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = col;
          ctx.fillRect(padLeft + 6, y - 8, 92, 14);
          ctx.fillStyle = "#FFFFFF";
          ctx.font = "600 9.5px 'Segoe UI', monospace";
          ctx.fillText(`${lbl} ${p.toFixed(2)}`, padLeft + 10, y + 2.5);
        };
        drawLine(
          pos.entryPriceExec,
          `${pos.side.toUpperCase()} ${pos.contracts}×`,
          pos.side === "long" ? T.trading.buyOrder : T.trading.sellOrder
        );
        drawLine(pos.stopPriceExec, "SL", T.trading.sellOrder);
        drawLine(pos.t1PriceExec, "T1", T.trading.buyOrder);
        drawLine(pos.t2PriceExec, "T2", "#3BEFF0");
      } else if (pos.closedAtTs && pos.exitPriceExec !== undefined) {
        const exitX = findBarX(pos.closedAtTs);
        const exitY = priceToY(pos.exitPriceExec);
        const win = (pos.rMultiple ?? 0) >= 0;
        ctx.strokeStyle = win ? T.trading.buyOrder : T.trading.sellOrder;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.moveTo(entryX, entryY);
        ctx.lineTo(exitX, exitY);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = T.chrome.accentBlue;
        ctx.beginPath();
        ctx.arc(entryX, entryY, 4, 0, Math.PI * 2);
        ctx.fill();

        const rTxt = `${(pos.rMultiple ?? 0) >= 0 ? "+" : ""}${(pos.rMultiple ?? 0).toFixed(2)}R`;
        ctx.fillStyle = win ? T.trading.buyOrder : T.trading.sellOrder;
        ctx.fillRect(exitX - 18, exitY - 15, 38, 13);
        ctx.fillStyle = "#FFFFFF";
        ctx.font = "600 9px 'Segoe UI', monospace";
        ctx.fillText(rTxt, exitX - 14, exitY - 5.5);
      }
    }

    // 14. Zone draw preview
    if (drawZoneMode && drawStartPrice !== null && drawCurrentPrice !== null) {
      const y1 = priceToY(Math.max(drawStartPrice, drawCurrentPrice));
      const y2 = priceToY(Math.min(drawStartPrice, drawCurrentPrice));
      ctx.fillStyle = "rgba(59, 239, 240, 0.16)";
      ctx.fillRect(padLeft, y1, axisX - padLeft, Math.max(2, y2 - y1));
      ctx.strokeStyle = T.indicators.levelCyan;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(padLeft, y1, axisX - padLeft, Math.max(2, y2 - y1));
    }

    // 15. Extended Current Price Dashed Line + Axis Pill (exact ATAS ExtendPriceLine + AxisCurrentBackColor)
    const lastCandle = visibleSlice[visibleSlice.length - 1];
    if (lastCandle) {
      const ly = priceToY(lastCandle.close);
      const isUp = lastCandle.close >= lastCandle.open;
      ctx.strokeStyle = isUp ? T.candles.bull : bearCandleColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(padLeft, ly);
      ctx.lineTo(axisX, ly);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = T.chrome.axisCurrentBg; // #363A45
      ctx.fillRect(axisX + 1, ly - 8, layout.axisRightWidth - 2, 16);
      ctx.fillStyle = T.chrome.axisCurrentFg; // #F1F1F1
      ctx.font = "600 10px 'Segoe UI', monospace";
      ctx.fillText(lastCandle.close.toFixed(2), axisX + 6, ly + 3.5);
    }

    // 16. ATAS Top-Left Status / OHLC + Indicator Overlay Text (ShowOhlcValues + ShowIndicatorsList)
    const inspectBar =
      mousePos && visibleSlice.length > 0
        ? visibleSlice[
            Math.max(
              0,
              Math.min(
                visibleSlice.length - 1,
                Math.floor(((mousePos.x - padLeft) / plotWidth) * visibleSlice.length)
              )
            )
          ]
        : lastCandle;
    if (inspectBar) {
      ctx.font = "600 10.5px 'Segoe UI', ui-monospace, monospace";
      ctx.fillStyle = T.chrome.textPrimary;
      const head = `${instrumentLabel} · ${timeframeLabel}   O ${inspectBar.open.toFixed(2)}  H ${inspectBar.high.toFixed(2)}  L ${inspectBar.low.toFixed(2)}  C ${inspectBar.close.toFixed(2)}  V ${inspectBar.volume >= 10 ? inspectBar.volume.toFixed(0) : inspectBar.volume.toFixed(2)}`;
      ctx.fillText(head, 10, 14);

      ctx.font = "9.5px 'Segoe UI', sans-serif";
      ctx.fillStyle = T.chrome.textSecondary;
      ctx.fillText(indicatorBadges.join("  ·  "), 10, 28);
    }

    // 17. Time Axis Labels
    ctx.fillStyle = T.chrome.textSecondary;
    ctx.font = "9.5px 'Segoe UI', monospace";
    const labelEvery = Math.max(1, Math.floor(visibleSlice.length / 7));
    for (let i = 0; i < visibleSlice.length; i += labelEvery) {
      const x = padLeft + i * stepX + stepX / 2;
      ctx.fillText(formatPTTime(visibleSlice[i].ts), x - 14, dims.height - 6);
    }

    // Synced hover vertical line
    if (hoverTs && !mousePos) {
      const idx = visibleSlice.findIndex((c) => c.ts >= hoverTs);
      if (idx !== -1) {
        const hx = Math.round(padLeft + idx * stepX + stepX / 2) + 0.5;
        ctx.strokeStyle = "rgba(149, 152, 161, 0.4)";
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(hx, padTop);
        ctx.lineTo(hx, timeAxisY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 18. ATAS Crosshair (CrosshairPen: #9598A1 dashed)
    if (mousePos) {
      const { x, y } = mousePos;
      const pickColor =
        pickPriceMode === "stop"
          ? T.trading.sellOrder
          : pickPriceMode === "t1" || pickPriceMode === "t2"
            ? T.trading.buyOrder
            : pickPriceMode === "entry"
              ? "#FFFF00"
              : T.canvas.crosshair;

      ctx.strokeStyle = pickColor;
      ctx.lineWidth = pickPriceMode ? 1.3 : 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, timeAxisY);
      ctx.moveTo(0, y);
      ctx.lineTo(axisX, y);
      ctx.stroke();
      ctx.setLineDash([]);

      const hp = yToPrice(y);
      ctx.fillStyle = T.chrome.axisCurrentBg;
      ctx.fillRect(axisX + 1, y - 8, layout.axisRightWidth - 2, 16);
      ctx.fillStyle = pickPriceMode ? pickColor : T.chrome.axisCurrentFg;
      ctx.font = "600 10px 'Segoe UI', monospace";
      ctx.fillText(hp.toFixed(2), axisX + 6, y + 3.5);

      if (pickPriceMode) {
        ctx.fillStyle = T.chrome.panelBg;
        ctx.fillRect(x + 10, y - 16, 132, 18);
        ctx.strokeStyle = pickColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 10, y - 16, 132, 18);
        ctx.fillStyle = pickColor;
        ctx.font = "600 9.5px 'Segoe UI', monospace";
        ctx.fillText(`SET ${pickPriceMode.toUpperCase()} ${hp.toFixed(2)}`, x + 15, y - 4);
      }
    }
  }, [
    dims,
    visibleSlice,
    priceBounds,
    layout,
    displayZones,
    activeZoneId,
    profiles,
    activeProfile,
    nakedPocs,
    vwapMap,
    fpByTs,
    footprintBars.length,
    bigTrades,
    positions,
    pendingOrders,
    asiaOpenTs,
    mousePos,
    hoverTs,
    drawZoneMode,
    pickPriceMode,
    drawStartPrice,
    drawCurrentPrice,
    show1OZGrid,
    bearCandleColor,
    instrumentLabel,
    timeframeLabel,
    indicatorBadges,
  ]);

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

    if (pickPriceMode && onClickPrice) {
      onClickPrice(Number(clickedPrice.toFixed(2)));
      return;
    }

    if (drawZoneMode) {
      setDrawStartPrice(clickedPrice);
      setDrawCurrentPrice(clickedPrice);
      return;
    }

    const hitZone = displayZones.find(
      (z) => clickedPrice >= z.low && clickedPrice <= z.high
    );
    if (hitZone && onSelectZone && e.detail === 1) {
      onSelectZone(hitZone.id);
    }

    setDragPan({ startX: x, startOffset: rightOffset });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setMousePos({ x, y });

    if (visibleSlice.length > 0 && onHoverTs) {
      const idx = Math.floor(
        ((x - layout.padLeft) / layout.plotWidth) * visibleSlice.length
      );
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
      setRightOffset(
        Math.max(0, Math.min(Math.max(0, candles.length - 12), next))
      );
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
    <div
      ref={containerRef}
      title={title}
      className={`relative w-full overflow-hidden ${heightClass}`}
    >
      <canvas
        ref={canvasRef}
        className={`block h-full w-full ${
          drawZoneMode || pickPriceMode
            ? "cursor-crosshair"
            : "cursor-grab active:cursor-grabbing"
        }`}
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
  );
}
