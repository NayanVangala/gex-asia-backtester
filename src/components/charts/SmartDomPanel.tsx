"use client";

import React, { useMemo } from "react";
import { L2Snapshot, PendingOrder, SimPosition, Tick, VolumeProfileResult } from "@/lib/types";
import { roundGCForContract } from "@/lib/goldMath";

interface SmartDomPanelProps {
  currentPrice: number;
  ticks: Tick[];
  developingProfile: VolumeProfileResult | null;
  latestL2: L2Snapshot | null;
  positions: SimPosition[];
  pendingOrders: PendingOrder[];
  onClickDomPrice: (price: number, side: "long" | "short") => void;
}

/**
 * Exact ATAS X SmartDOM (G1.W2 from Asia_Template_Fixed.aws):
 * - BackColor / HeaderBackground: #1A2333
 * - CenterLineColor: #F1F1F1
 * - Columns: Orders/PnL | Today (#74A6E2) | Price | Bid (#089981) | Sells (Crimson) | Buys (#089981) | Ask (#F2385A)
 * Clicking a Bid row pre-fills a Long order at that price; clicking an Ask row pre-fills a Short order.
 */
export function SmartDomPanel({
  currentPrice,
  ticks,
  developingProfile,
  latestL2,
  positions,
  pendingOrders,
  onClickDomPrice,
}: SmartDomPanelProps) {
  const step = 0.25; // 1OZ $0.25 ladder step
  const centerPrice = roundGCForContract(currentPrice || 3600, "1OZ", "nearest");

  // Aggregate real session traded volume (Today, Sells, Buys) per $0.25 price rung
  const { rows, maxToday, maxSide, maxDepth } = useMemo(() => {
    const todayMap = new Map<number, number>();
    const buyMap = new Map<number, number>();
    const sellMap = new Map<number, number>();
    const bidDepth = new Map<number, number>();
    const askDepth = new Map<number, number>();

    const q = (p: number) => Number((Math.round(p / step) * step).toFixed(2));

    if (ticks.length > 0) {
      for (const t of ticks) {
        const k = q(t.price);
        todayMap.set(k, (todayMap.get(k) ?? 0) + t.size);
        if (t.side === "buy") buyMap.set(k, (buyMap.get(k) ?? 0) + t.size);
        else if (t.side === "sell") sellMap.set(k, (sellMap.get(k) ?? 0) + t.size);
      }
    } else if (developingProfile) {
      for (const b of developingProfile.bins) {
        const k = q(b.price);
        todayMap.set(k, (todayMap.get(k) ?? 0) + b.volume);
      }
    }

    if (latestL2) {
      for (const b of latestL2.bids) {
        const k = q(b.price);
        bidDepth.set(k, (bidDepth.get(k) ?? 0) + b.size);
      }
      for (const a of latestL2.asks) {
        const k = q(a.price);
        askDepth.set(k, (askDepth.get(k) ?? 0) + a.size);
      }
    }

    const halfLevels = 16; // 33 visible rungs centered on current price
    const built = [];
    let mToday = 0.01;
    let mSide = 0.01;
    let mDepth = 0.01;

    for (let i = halfLevels; i >= -halfLevels; i--) {
      const p = Number((centerPrice + i * step).toFixed(2));
      const today = todayMap.get(p) ?? 0;
      const buys = buyMap.get(p) ?? 0;
      const sells = sellMap.get(p) ?? 0;
      const bidSz = bidDepth.get(p) ?? 0;
      const askSz = askDepth.get(p) ?? 0;
      if (today > mToday) mToday = today;
      if (buys > mSide) mSide = buys;
      if (sells > mSide) mSide = sells;
      if (bidSz > mDepth) mDepth = bidSz;
      if (askSz > mDepth) mDepth = askSz;
      built.push({ price: p, today, buys, sells, bidSz, askSz });
    }
    return { rows: built, maxToday: mToday, maxSide: mSide, maxDepth: mDepth };
  }, [centerPrice, ticks, developingProfile, latestL2]);

  const openPos = positions.find((p) => p.status === "open") ?? null;

  const fmt = (v: number) =>
    v === 0 ? "" : v >= 100 ? Math.round(v).toString() : v >= 10 ? v.toFixed(1) : v.toFixed(2);

  return (
    <div className="flex flex-col h-full bg-[#1A2333] text-[#F1F1F1] select-none overflow-hidden">
      {/* Header matching ATAS SmartDOM column headers */}
      <div className="grid grid-cols-[72px_1fr_68px_56px_54px_54px_56px] border-b border-[#2A2E39] bg-[#151B26] text-[10px] font-medium text-[#ABAEB8] text-center">
        <div className="py-1.5 border-r border-[#2A2E39]">Orders/PnL</div>
        <div className="py-1.5 border-r border-[#2A2E39]">Today</div>
        <div className="py-1.5 border-r border-[#2A2E39] text-[#F1F1F1]">Price</div>
        <div className="py-1.5 border-r border-[#2A2E39] text-[#089981]">Bid</div>
        <div className="py-1.5 border-r border-[#2A2E39] text-[#F2385A]">Sells</div>
        <div className="py-1.5 border-r border-[#2A2E39] text-[#089981]">Buys</div>
        <div className="py-1.5 text-[#F2385A]">Ask</div>
      </div>

      {/* Ladder Rows (RowHeight: 20px exact from SmartDOMSettings) */}
      <div className="flex-1 overflow-y-auto font-mono-num text-[11px]">
        {rows.map((r) => {
          const isCenter = Math.abs(r.price - centerPrice) < 0.001;
          const isPoc =
            developingProfile && Math.abs(r.price - developingProfile.poc) <= step / 2;
          const matchingOrd = pendingOrders.find(
            (o) => Math.abs(o.triggerPriceExec - r.price) <= step / 2
          );
          const isEntry =
            openPos && Math.abs(openPos.entryPriceExec - r.price) <= step / 2;
          const isStop =
            openPos && Math.abs(openPos.stopPriceExec - r.price) <= step / 2;
          const isT1 =
            openPos && Math.abs(openPos.t1PriceExec - r.price) <= step / 2;

          return (
            <div
              key={r.price}
              className={`grid h-[21px] grid-cols-[72px_1fr_68px_56px_54px_54px_56px] border-b border-[#222B3D] items-center hover:bg-[#595959]/35 ${
                isCenter ? "border-y border-y-[#F1F1F1] bg-[#26344C]" : ""
              }`}
            >
              {/* Orders / PnL */}
              <div className="h-full flex items-center justify-center border-r border-[#222B3D] text-[9.5px]">
                {matchingOrd && (
                  <span
                    className={`px-1 rounded-xs font-semibold ${
                      matchingOrd.side === "long" ? "bg-[#089981]" : "bg-[#F2385A]"
                    }`}
                  >
                    {matchingOrd.orderType.toUpperCase()}
                  </span>
                )}
                {isEntry && (
                  <span className="px-1 rounded-xs bg-[#2962FF] font-semibold">
                    {openPos.side === "long" ? "+1" : "-1"}
                  </span>
                )}
                {isStop && (
                  <span className="px-1 rounded-xs bg-[#F2385A] font-semibold">SL</span>
                )}
                {isT1 && (
                  <span className="px-1 rounded-xs bg-[#089981] font-semibold">T1</span>
                )}
              </div>

              {/* Today Volume Profile Bar (#74A6E2) */}
              <div className="relative h-full flex items-center justify-end pr-1.5 border-r border-[#222B3D]">
                {r.today > 0 && (
                  <div
                    className="absolute left-0 top-0.5 bottom-0.5"
                    style={{
                      width: `${Math.min(100, (r.today / maxToday) * 100)}%`,
                      backgroundColor: isPoc ? "#FF4900" : "rgba(116, 166, 226, 0.45)",
                    }}
                  />
                )}
                <span className="relative z-10 text-[10px] text-[#D1D4DC]">
                  {fmt(r.today)}
                </span>
              </div>

              {/* Price */}
              <div
                className={`h-full flex items-center justify-center border-r border-[#222B3D] font-semibold ${
                  isCenter ? "bg-[#363A45] text-white" : isPoc ? "text-[#FF8547]" : "text-[#F1F1F1]"
                }`}
              >
                {r.price.toFixed(2)}
              </div>

              {/* Bid Column (#089981) - Click to set Long price */}
              <button
                type="button"
                onClick={() => onClickDomPrice(r.price, "long")}
                title="Click to stage Long Limit/Stop at this price"
                className="relative h-full flex items-center justify-center border-r border-[#222B3D] hover:bg-[#089981]/30 cursor-pointer"
              >
                {r.bidSz > 0 && (
                  <div
                    className="absolute inset-y-0.5 right-0 bg-[#089981]/50"
                    style={{ width: `${Math.min(100, (r.bidSz / maxDepth) * 100)}%` }}
                  />
                )}
                <span className="relative z-10 text-[10px] text-[#7BF1D4]">
                  {fmt(r.bidSz)}
                </span>
              </button>

              {/* Sells Column (Crimson) */}
              <div className="relative h-full flex items-center justify-end pr-1 border-r border-[#222B3D]">
                {r.sells > 0 && (
                  <div
                    className="absolute inset-y-0.5 right-0 bg-[#DC143C]/45"
                    style={{ width: `${Math.min(100, (r.sells / maxSide) * 100)}%` }}
                  />
                )}
                <span className="relative z-10 text-[10px] text-[#FFA3B1]">
                  {fmt(r.sells)}
                </span>
              </div>

              {/* Buys Column (#089981) */}
              <div className="relative h-full flex items-center justify-start pl-1 border-r border-[#222B3D]">
                {r.buys > 0 && (
                  <div
                    className="absolute inset-y-0.5 left-0 bg-[#089981]/45"
                    style={{ width: `${Math.min(100, (r.buys / maxSide) * 100)}%` }}
                  />
                )}
                <span className="relative z-10 text-[10px] text-[#98F5D4]">
                  {fmt(r.buys)}
                </span>
              </div>

              {/* Ask Column (#F2385A) - Click to set Short price */}
              <button
                type="button"
                onClick={() => onClickDomPrice(r.price, "short")}
                title="Click to stage Short Limit/Stop at this price"
                className="relative h-full flex items-center justify-center hover:bg-[#F2385A]/30 cursor-pointer"
              >
                {r.askSz > 0 && (
                  <div
                    className="absolute inset-y-0.5 left-0 bg-[#F2385A]/50"
                    style={{ width: `${Math.min(100, (r.askSz / maxDepth) * 100)}%` }}
                  />
                )}
                <span className="relative z-10 text-[10px] text-[#FF9BAE]">
                  {fmt(r.askSz)}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Footer note */}
      <div className="flex items-center justify-between border-t border-[#2A2E39] bg-[#151B26] px-2.5 py-1 text-[10px] text-[#ABAEB8]">
        <span>Click Bid/Ask cell to snap 1OZ entry price</span>
        <span>{latestL2 ? "Live L2 Depth Active" : "Session Prints (No L2 Book)"}</span>
      </div>
    </div>
  );
}
