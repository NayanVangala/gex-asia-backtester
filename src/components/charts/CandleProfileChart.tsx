"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BigTradePrint,
  Candle,
  KeyLevelZone,
  NakedPoc,
  PendingOrder,
  SimPosition,
  VolumeProfileResult,
} from "@/lib/types";
import { formatPTTime } from "@/lib/goldMath";

export type PricePickTarget = "entry" | "stop" | "t1" | "t2" | null;

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
  headerRight?: React.ReactNode;
}

const ZONE_PALETTE: Record<
  KeyLevelZone["kind"],
  { fill: string; border: string; tagBg: string; tagText: string }
> = {
  stacked: {
    fill: "rgba(212, 160, 58, 0.11)",
    border: "rgba(212, 160, 58, 0.55)",
    tagBg: "rgba(212, 160, 58, 0.18)",
    tagText: "#eab854",
  },
  pd: {
    fill: "rgba(212, 160, 58, 0.06)",
    border: "rgba(212, 160, 58, 0.32)",
    tagBg: "rgba(30, 35, 45, 0.9)",
    tagText: "#d4a03a",
  },
  pw: {
    fill: "rgba(96, 165, 250, 0.06)",
    border: "rgba(96, 165, 250, 0.34)",
    tagBg: "rgba(22, 30, 44, 0.9)",
    tagText: "#93c5fd",
  },
  composite: {
    fill: "rgba(167, 139, 250, 0.06)",
    border: "rgba(167, 139, 250, 0.32)",
    tagBg: "rgba(28, 25, 42, 0.9)",
    tagText: "#c4b5fd",
  },
  hvn: {
    fill: "rgba(0, 192, 135, 0.05)",
    border: "rgba(0, 192, 135, 0.28)",
    tagBg: "rgba(16, 30, 28, 0.9)",
    tagText: "#6ee7b7",
  },
  lvn: {
    fill: "rgba(246, 70, 93, 0.05)",
    border: "rgba(246, 70, 93, 0.28)",
    tagBg: "rgba(34, 18, 24, 0.9)",
    tagText: "#fda4af",
  },
  npoc: {
    fill: "rgba(245, 158, 11, 0.06)",
    border: "rgba(245, 158, 11, 0.32)",
    tagBg: "rgba(32, 24, 16, 0.9)",
    tagText: "#fcd34d",
  },
  no_trade: {
    fill: "rgba(100, 116, 139, 0.08)",
    border: "rgba(100, 116, 139, 0.28)",
    tagBg: "rgba(24, 29, 38, 0.9)",
    tagText: "#94a3b8",
  },
  custom: {
    fill: "rgba(56, 189, 248, 0.10)",
    border: "rgba(56, 189, 248, 0.55)",
    tagBg: "rgba(14, 34, 48, 0.92)",
    tagText: "#7dd3fc",
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
  headerRight,
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
  const [dims, setDims] = useState({ width: 640, height: 320 });

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

  // Show only top 4 clean zones (active + pinned + nearest) so chart never turns into label soup
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
    const padLeft = 10;
    const padTop = 12;
    const padBottom = 22;
    const axisRightWidth = 64;
    const profileWidth = activeProfile ? 58 : 0;
    const plotWidth = Math.max(
      80,
      dims.width - padLeft - axisRightWidth - profileWidth - 6
    );
    const plotHeight = Math.max(80, dims.height - padTop - padBottom);
    const volHeight = Math.min(38, Math.floor(plotHeight * 0.15));
    const priceHeight = plotHeight - volHeight - 4;

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

    ctx.fillStyle = "#0b0d11";
    ctx.fillRect(0, 0, dims.width, dims.height);

    const { padLeft, padTop, plotWidth, priceHeight, volHeight, profileWidth } = layout;
    const axisX = dims.width - layout.axisRightWidth;

    // Right price axis separator
    ctx.strokeStyle = "#171b24";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axisX + 0.5, 0);
    ctx.lineTo(axisX + 0.5, dims.height - layout.padBottom);
    ctx.stroke();

    // Bottom time axis separator
    ctx.beginPath();
    ctx.moveTo(0, dims.height - layout.padBottom + 0.5);
    ctx.lineTo(dims.width, dims.height - layout.padBottom + 0.5);
    ctx.stroke();

    if (visibleSlice.length === 0) {
      ctx.fillStyle = "#586070";
      ctx.font = "11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("Waiting for session bars...", dims.width / 2, dims.height / 2);
      return;
    }

    // Subtle horizontal gridlines
    const numGrid = 5;
    const priceSpan = priceBounds.max - priceBounds.min;
    ctx.strokeStyle = "#12161e";
    ctx.lineWidth = 1;
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "left";

    for (let i = 0; i <= numGrid; i++) {
      const p = priceBounds.max - (i / numGrid) * priceSpan;
      const y = Math.round(priceToY(p)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(axisX, y);
      ctx.stroke();

      ctx.fillStyle = "#626b7c";
      ctx.fillText(p.toFixed(show1OZGrid ? 2 : 1), axisX + 7, y + 3);
    }

    // Developing Value middle shading (very understated)
    if (profiles?.developing) {
      const dev = profiles.developing;
      const yVah = priceToY(dev.vah);
      const yVal = priceToY(dev.val);
      const top = Math.max(padTop, Math.min(yVah, yVal));
      const bot = Math.min(padTop + priceHeight, Math.max(yVah, yVal));
      if (bot > top) {
        ctx.fillStyle = "rgba(139, 148, 165, 0.045)";
        ctx.fillRect(padLeft, top, plotWidth, bot - top);
        ctx.strokeStyle = "rgba(139, 148, 165, 0.18)";
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(padLeft, yVah);
        ctx.lineTo(padLeft + plotWidth, yVah);
        ctx.moveTo(padLeft, yVal);
        ctx.lineTo(padLeft + plotWidth, yVal);
        ctx.stroke();
        ctx.setLineDash([]);

        const yPoc = priceToY(dev.poc);
        if (yPoc >= padTop && yPoc <= padTop + priceHeight) {
          ctx.strokeStyle = "rgba(212, 160, 58, 0.45)";
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(padLeft, yPoc);
          ctx.lineTo(padLeft + plotWidth, yPoc);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    // Key Level Zones (clean subtle bands + compact non-overlapping pill tags)
    const usedLabelYs: number[] = [];
    for (const z of displayZones) {
      const yTop = priceToY(z.high);
      const yBot = priceToY(z.low);
      if (yBot < padTop || yTop > padTop + priceHeight) continue;
      const clampedTop = Math.max(padTop, yTop);
      const clampedBot = Math.min(padTop + priceHeight, yBot);
      const st = ZONE_PALETTE[z.kind] ?? ZONE_PALETTE.custom;
      const isSelected = z.id === activeZoneId;

      ctx.fillStyle = isSelected ? "rgba(212, 160, 58, 0.15)" : st.fill;
      ctx.fillRect(padLeft, clampedTop, plotWidth, Math.max(2, clampedBot - clampedTop));

      ctx.strokeStyle = isSelected ? "#d4a03a" : st.border;
      ctx.lineWidth = isSelected ? 1.2 : 0.8;
      if (!isSelected) ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(padLeft, clampedTop);
      ctx.lineTo(padLeft + plotWidth, clampedTop);
      ctx.moveTo(padLeft, clampedBot);
      ctx.lineTo(padLeft + plotWidth, clampedBot);
      ctx.stroke();
      ctx.setLineDash([]);

      // Compact tag on left only if it doesn't collide vertically with another tag
      const labelY = Math.max(padTop + 11, clampedTop + 11);
      if (usedLabelYs.every((uy) => Math.abs(uy - labelY) >= 15)) {
        usedLabelYs.push(labelY);
        const shortLabel = z.label
          .replace("STACKED: ", "★ ")
          .slice(0, 26);
        const txt = `${shortLabel} ${z.low.toFixed(1)}-${z.high.toFixed(1)}`;
        ctx.font = "500 9.5px ui-monospace, monospace";
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = st.tagBg;
        ctx.fillRect(padLeft + 4, labelY - 9, tw + 8, 13);
        ctx.fillStyle = isSelected ? "#f6d27a" : st.tagText;
        ctx.fillText(txt, padLeft + 8, labelY + 1);
      }
    }

    // Naked POCs (subtle dotted ray)
    for (const np of nakedPocs.slice(-2)) {
      if (!np.untested) continue;
      const y = priceToY(np.price);
      if (y < padTop || y > padTop + priceHeight) continue;
      ctx.strokeStyle = "rgba(212, 160, 58, 0.45)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotWidth, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#b88a32";
      ctx.font = "9px ui-monospace, monospace";
      ctx.fillText(`nPOC ${np.price.toFixed(1)}`, padLeft + plotWidth - 76, y - 3);
    }

    // Tokyo Open marker
    const stepX = plotWidth / Math.max(1, visibleSlice.length);
    const candleWidth = Math.max(2, Math.min(11, stepX * 0.64));
    if (asiaOpenTs) {
      const idx = visibleSlice.findIndex((c) => c.ts >= asiaOpenTs);
      if (idx > 0) {
        const x = Math.round(padLeft + idx * stepX + stepX / 2) + 0.5;
        ctx.strokeStyle = "rgba(139, 148, 165, 0.22)";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(x, padTop);
        ctx.lineTo(x, padTop + priceHeight + volHeight);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#626b7c";
        ctx.font = "9px ui-monospace, monospace";
        ctx.fillText("TOKYO 16:00", x + 4, padTop + 10);
      }
    }

    // Candles + Subtle Volume Bars
    const maxVol = Math.max(...visibleSlice.map((c) => c.volume), 1);
    const volTop = padTop + priceHeight + 4;

    for (let i = 0; i < visibleSlice.length; i++) {
      const c = visibleSlice[i];
      const cx = padLeft + i * stepX + stepX / 2;
      const isUp = c.close >= c.open;
      const bodyColor = isUp ? "#00c087" : "#f6465d";

      const yHigh = priceToY(c.high);
      const yLow = priceToY(c.low);
      const yOpen = priceToY(c.open);
      const yClose = priceToY(c.close);

      // Crisp 1px wick
      ctx.strokeStyle = bodyColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(cx) + 0.5, yHigh);
      ctx.lineTo(Math.round(cx) + 0.5, yLow);
      ctx.stroke();

      // Body
      const bodyTop = Math.min(yOpen, yClose);
      const bodyH = Math.max(1.2, Math.abs(yClose - yOpen));
      ctx.fillStyle = bodyColor;
      ctx.fillRect(cx - candleWidth / 2, bodyTop, candleWidth, bodyH);

      // Volume bar
      const vh = (c.volume / maxVol) * (volHeight - 2);
      ctx.fillStyle = isUp
        ? "rgba(0, 192, 135, 0.22)"
        : "rgba(246, 70, 93, 0.22)";
      ctx.fillRect(
        cx - candleWidth / 2,
        volTop + volHeight - vh,
        candleWidth,
        vh
      );
    }

    // VWAP smooth line
    if (vwapMap.size > 0) {
      ctx.strokeStyle = "rgba(230, 233, 239, 0.72)";
      ctx.lineWidth = 1.25;
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

    // Big Trades markers (subtle, clean rings)
    if (bigTrades.length > 0) {
      const tsToIdx = new Map<number, number>();
      visibleSlice.forEach((c, idx) => tsToIdx.set(c.ts, idx));
      for (const bt of bigTrades) {
        const idx = tsToIdx.get(bt.barTs);
        if (idx === undefined) continue;
        const cx = padLeft + idx * stepX + stepX / 2;
        const cy = priceToY(bt.price);
        if (cy < padTop || cy > padTop + priceHeight) continue;
        const radius = bt.tier === "whale" ? 5 : 3;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle =
          bt.side === "buy"
            ? "rgba(0, 192, 135, 0.55)"
            : bt.side === "sell"
              ? "rgba(246, 70, 93, 0.55)"
              : "rgba(212, 160, 58, 0.55)";
        ctx.fill();
        if (bt.tier === "whale") {
          ctx.strokeStyle = "#eab854";
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }
    }

    // Right-Hand Volume Profile Histogram (Exocharts subtle graphite + gold POC)
    if (activeProfile && profileWidth > 0) {
      const profRightX = axisX - 2;
      const maxBinVol = Math.max(...activeProfile.bins.map((b) => b.volume), 1);

      for (const bin of activeProfile.bins) {
        const y = priceToY(bin.price);
        if (y < padTop || y > padTop + priceHeight) continue;
        const barW = Math.max(1.5, (bin.volume / maxBinVol) * (profileWidth - 4));
        const inVa = bin.price >= activeProfile.val && bin.price <= activeProfile.vah;
        const isPoc = Math.abs(bin.price - activeProfile.poc) < 1e-4;

        ctx.fillStyle = isPoc
          ? "#d4a03a"
          : inVa
            ? "rgba(148, 163, 184, 0.34)"
            : "rgba(71, 85, 105, 0.22)";
        ctx.fillRect(profRightX - barW, y - 1.2, barW, 2.4);
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
        ctx.font = "600 8.5px ui-monospace, monospace";
        ctx.fillText(lbl, profRightX - profileWidth + 1, y - 2.5);
      };
      drawProfileTick(activeProfile.vah, "VAH", "#8b94a5");
      drawProfileTick(activeProfile.poc, "POC", "#d4a03a");
      drawProfileTick(activeProfile.val, "VAL", "#8b94a5");
    }

    // Pending Working Orders
    for (const ord of pendingOrders) {
      const yTrig = priceToY(ord.triggerPriceExec);
      const yInv = priceToY(ord.invalidationPriceExec);
      if (yTrig >= padTop && yTrig <= padTop + priceHeight) {
        ctx.strokeStyle = "#d4a03a";
        ctx.lineWidth = 1.2;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(padLeft, yTrig);
        ctx.lineTo(padLeft + plotWidth, yTrig);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#eab854";
        ctx.font = "600 9.5px ui-monospace, monospace";
        ctx.fillText(
          `${ord.side.toUpperCase()} ${ord.orderType.toUpperCase()} ${ord.triggerPriceExec.toFixed(2)}`,
          padLeft + 8,
          yTrig - 4
        );
      }
      if (yInv >= padTop && yInv <= padTop + priceHeight) {
        ctx.strokeStyle = "rgba(246, 70, 93, 0.65)";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(padLeft, yInv);
        ctx.lineTo(padLeft + plotWidth, yInv);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#f6465d";
        ctx.font = "9px ui-monospace, monospace";
        ctx.fillText(`CANCEL ${ord.invalidationPriceExec.toFixed(2)}`, padLeft + 8, yInv + 10);
      }
    }

    // Open & Closed Positions
    const findBarX = (ts: number) => {
      let idx = visibleSlice.findIndex((c) => c.ts >= ts);
      if (idx === -1) idx = visibleSlice.length - 1;
      return padLeft + idx * stepX + stepX / 2;
    };

    for (const pos of positions) {
      const entryX = findBarX(pos.openedAtTs);
      const entryY = priceToY(pos.entryPriceExec);

      if (pos.status === "open") {
        const rightEdge = padLeft + plotWidth;
        const stopY = priceToY(pos.stopPriceExec);
        const t2Y = priceToY(pos.t2PriceExec);

        ctx.fillStyle = "rgba(246, 70, 93, 0.07)";
        ctx.fillRect(
          entryX,
          Math.min(entryY, stopY),
          Math.max(12, rightEdge - entryX),
          Math.abs(stopY - entryY)
        );
        ctx.fillStyle = "rgba(0, 192, 135, 0.07)";
        ctx.fillRect(
          entryX,
          Math.min(entryY, t2Y),
          Math.max(12, rightEdge - entryX),
          Math.abs(t2Y - entryY)
        );

        const drawOrderLine = (price: number, label: string, color: string) => {
          const y = priceToY(price);
          if (y < padTop || y > padTop + priceHeight) return;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.2;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(padLeft, y);
          ctx.lineTo(padLeft + plotWidth, y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = color;
          ctx.font = "600 9.5px ui-monospace, monospace";
          ctx.fillText(`${label} ${price.toFixed(2)}`, padLeft + 8, y - 4);
        };
        drawOrderLine(pos.entryPriceExec, `${pos.side.toUpperCase()} ${pos.contracts}×`, "#e6e9ef");
        drawOrderLine(pos.stopPriceExec, "SL", "#f6465d");
        drawOrderLine(pos.t1PriceExec, "T1", "#00c087");
        drawOrderLine(pos.t2PriceExec, "T2", "#34d399");
      } else if (pos.closedAtTs && pos.exitPriceExec !== undefined) {
        const exitX = findBarX(pos.closedAtTs);
        const exitY = priceToY(pos.exitPriceExec);
        const win = (pos.rMultiple ?? 0) >= 0;

        ctx.strokeStyle = win ? "#00c087" : "#f6465d";
        ctx.lineWidth = 1.3;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.moveTo(entryX, entryY);
        ctx.lineTo(exitX, exitY);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = pos.side === "long" ? "#00c087" : "#f6465d";
        ctx.beginPath();
        if (pos.side === "long") {
          ctx.moveTo(entryX, entryY - 5);
          ctx.lineTo(entryX - 4.5, entryY + 4);
          ctx.lineTo(entryX + 4.5, entryY + 4);
        } else {
          ctx.moveTo(entryX, entryY + 5);
          ctx.lineTo(entryX - 4.5, entryY - 4);
          ctx.lineTo(entryX + 4.5, entryY - 4);
        }
        ctx.closePath();
        ctx.fill();

        const rTxt = `${(pos.rMultiple ?? 0) >= 0 ? "+" : ""}${(pos.rMultiple ?? 0).toFixed(2)}R`;
        ctx.fillStyle = win ? "#064e3b" : "#4c0519";
        ctx.fillRect(exitX - 18, exitY - 15, 38, 13);
        ctx.fillStyle = win ? "#6ee7b7" : "#fda4af";
        ctx.font = "600 9px ui-monospace, monospace";
        ctx.fillText(rTxt, exitX - 14, exitY - 5.5);
      }
    }

    // Zone drag preview
    if (drawZoneMode && drawStartPrice !== null && drawCurrentPrice !== null) {
      const y1 = priceToY(Math.max(drawStartPrice, drawCurrentPrice));
      const y2 = priceToY(Math.min(drawStartPrice, drawCurrentPrice));
      ctx.fillStyle = "rgba(56, 189, 248, 0.14)";
      ctx.fillRect(padLeft, y1, plotWidth, Math.max(2, y2 - y1));
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 1.2;
      ctx.strokeRect(padLeft, y1, plotWidth, Math.max(2, y2 - y1));
    }

    // Last Price pill on right axis
    const lastCandle = visibleSlice[visibleSlice.length - 1];
    if (lastCandle) {
      const ly = priceToY(lastCandle.close);
      const isUp = lastCandle.close >= lastCandle.open;
      ctx.fillStyle = isUp ? "#00a876" : "#dc354d";
      ctx.fillRect(axisX + 1, ly - 8, layout.axisRightWidth - 3, 16);
      ctx.fillStyle = "#ffffff";
      ctx.font = "600 10px ui-monospace, monospace";
      ctx.fillText(lastCandle.close.toFixed(2), axisX + 6, ly + 3.5);
    }

    // Time Axis labels
    ctx.fillStyle = "#586070";
    ctx.font = "9.5px ui-monospace, monospace";
    const labelEvery = Math.max(1, Math.floor(visibleSlice.length / 7));
    for (let i = 0; i < visibleSlice.length; i += labelEvery) {
      const x = padLeft + i * stepX + stepX / 2;
      ctx.fillText(formatPTTime(visibleSlice[i].ts), x - 14, dims.height - 6);
    }

    // Synced hover line
    if (hoverTs && !mousePos) {
      const idx = visibleSlice.findIndex((c) => c.ts >= hoverTs);
      if (idx !== -1) {
        const hx = Math.round(padLeft + idx * stepX + stepX / 2) + 0.5;
        ctx.strokeStyle = "rgba(139, 148, 165, 0.28)";
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(hx, padTop);
        ctx.lineTo(hx, padTop + priceHeight + volHeight);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Crosshair
    if (mousePos) {
      const { x, y } = mousePos;
      const pickColor =
        pickPriceMode === "stop"
          ? "#f6465d"
          : pickPriceMode === "t1" || pickPriceMode === "t2"
            ? "#00c087"
            : pickPriceMode === "entry"
              ? "#d4a03a"
              : "rgba(139, 148, 165, 0.36)";

      ctx.strokeStyle = pickColor;
      ctx.lineWidth = pickPriceMode ? 1.2 : 0.9;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + priceHeight + volHeight);
      ctx.moveTo(padLeft, y);
      ctx.lineTo(axisX, y);
      ctx.stroke();
      ctx.setLineDash([]);

      const hp = yToPrice(y);
      ctx.fillStyle = "#202633";
      ctx.fillRect(axisX + 1, y - 8, layout.axisRightWidth - 3, 16);
      ctx.fillStyle = pickPriceMode ? pickColor : "#e6e9ef";
      ctx.font = "600 10px ui-monospace, monospace";
      ctx.fillText(hp.toFixed(2), axisX + 6, y + 3.5);

      if (pickPriceMode) {
        ctx.fillStyle = "#12161f";
        ctx.fillRect(x + 10, y - 16, 128, 18);
        ctx.strokeStyle = pickColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 10, y - 16, 128, 18);
        ctx.fillStyle = pickColor;
        ctx.font = "600 9.5px ui-monospace, monospace";
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
  ]);

  const hoveredCandle = useMemo(() => {
    if (!mousePos || visibleSlice.length === 0)
      return visibleSlice[visibleSlice.length - 1] ?? null;
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
    <div className="flex flex-col bg-[#0b0d11] overflow-hidden h-full">
      <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-[#1c212b] bg-[#0f1217] px-2.5 text-[11px]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-[#e6e9ef]">{title}</span>
          {subtitle && (
            <span className="hidden md:inline truncate text-[10px] text-[#586070]">
              {subtitle}
            </span>
          )}
          {drawZoneMode && (
            <span className="text-[10px] font-medium text-sky-400">
              Drag to mark zone
            </span>
          )}
          {pickPriceMode && (
            <span className="text-[10px] font-semibold text-[#eab854]">
              Click chart for {pickPriceMode.toUpperCase()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          {hoveredCandle && (
            <div className="hidden sm:flex items-center gap-2 font-mono-num text-[10px] text-[#8b94a5]">
              <span>O {hoveredCandle.open.toFixed(2)}</span>
              <span className="text-[#00c087]">H {hoveredCandle.high.toFixed(2)}</span>
              <span className="text-[#f6465d]">L {hoveredCandle.low.toFixed(2)}</span>
              <span
                className={
                  hoveredCandle.close >= hoveredCandle.open
                    ? "text-[#00c087] font-medium"
                    : "text-[#f6465d] font-medium"
                }
              >
                C {hoveredCandle.close.toFixed(2)}
              </span>
            </div>
          )}
          {headerRight}
        </div>
      </div>
      <div ref={containerRef} className={`relative flex-1 w-full ${heightClass}`}>
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
    </div>
  );
}
