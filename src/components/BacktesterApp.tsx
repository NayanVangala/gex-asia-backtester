"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Eye,
  EyeOff,
  FastForward,
  PanelRight,
  Pause,
  Play,
  RefreshCw,
  SkipForward,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import {
  DrillCall,
  KeyLevelZone,
  OrderSide,
  PendingOrder,
  PremarketPlan,
  ScenarioNumber,
  SessionDataset,
  SimPosition,
  SimRepLog,
} from "@/lib/types";
import {
  evaluatePendingOrderOnBar,
  formatPTTime,
  gradeDrillCall,
} from "@/lib/goldMath";
import {
  computeAllSessionProfiles,
  computeSessionVwap,
} from "@/lib/volumeProfile";
import { buildFootprintsFromTicks } from "@/lib/footprint";
import {
  loadJournalReps,
  loadSavedCustomZones,
  loadSavedPlan,
  saveCustomZonesForSession,
  saveJournalReps,
  savePlanForSession,
} from "@/lib/journal";
import { ATAS_ASIA_THEME as T } from "@/lib/atasTheme";
import {
  CandleProfileChart,
  PricePickTarget,
} from "./charts/CandleProfileChart";
import { FootprintChart } from "./charts/FootprintChart";
import { CvdChart } from "./charts/CvdChart";
import { HeatmapChart } from "./charts/HeatmapChart";
import { SmartDomPanel } from "./charts/SmartDomPanel";
import { PremarketPanel } from "./PremarketPanel";
import { ExecutionSidebar } from "./ExecutionSidebar";
import { JournalView } from "./JournalView";
import { PlaybookView } from "./PlaybookView";
import { DataLoaderModal } from "./DataLoaderModal";
import { TapePanel } from "./TapePanel";
import { DrillModeCard } from "./DrillModeCard";

type MainWorkspaceTab = "gc" | "premarket" | "journal" | "playbook";
type LeftDockTab = "h1" | "m30" | "m5" | "m1" | "m5_cluster";
type RightDockTab = "clusters" | "delta" | "heatmap" | "smartdom" | "tape";
type FeedPreset = "paxg" | "gc";

const DEFAULT_PLAN = (sessionDate: string): PremarketPlan => ({
  sessionDate,
  bias: "balanced",
  biasReason: "",
  priceVsWeeklyValue: "inside",
  priceVsDailyValue: "inside",
  noTradeZoneLow: null,
  noTradeZoneHigh: null,
  nightRule: "",
  newsChecked: false,
  scenariosText: "",
  selectedZoneIds: [],
});

/**
 * Exact ATAS X Asia_Template_Fixed.aws layout:
 * - Top ATAS X Window Bar (Workspace badge + GC/Premarket/Journal/Playbook + Replay Strip + Connector)
 * - GC Tab: Exact 51% Left Dock (H1 | M30 | M5 [default] | M1 | M5 Cluster)
 *           + 49% Right Dock (M5 Clusters [default] | M5 Delta | Heatmap | SmartDOM | Tape)
 *           + Collapsible 276px ATAS Chart Trader Dock
 */
export function BacktesterApp() {
  const [mainTab, setMainTab] = useState<MainWorkspaceTab>("gc");
  // Exact Asia_Template_Fixed.aws defaults: Left ActiveWidgetIndex=2 (M5), Right FP2 (M5 Clusters)
  const [leftTab, setLeftTab] = useState<LeftDockTab>("m5");
  const [rightTab, setRightTab] = useState<RightDockTab>("clusters");
  const [showChartTrader, setShowChartTrader] = useState<boolean>(true);

  const [feedPreset, setFeedPreset] = useState<FeedPreset>("paxg");
  const [selectedSessionDate, setSelectedSessionDate] = useState<string>("");
  const [availableSessions, setAvailableSessions] = useState<string[]>([]);
  const [dataset, setDataset] = useState<SessionDataset | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [replayTs, setReplayTs] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playSpeedMs, setPlaySpeedMs] = useState<number>(700);

  const [toolsOpen, setToolsOpen] = useState<boolean>(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [drillMode, setDrillMode] = useState<boolean>(false);
  const [blindDate, setBlindDate] = useState<boolean>(false);
  const [fpStep, setFpStep] = useState<number>(0.5);
  const [customBigLarge, setCustomBigLarge] = useState<number | null>(null);
  const [customBigWhale, setCustomBigWhale] = useState<number | null>(null);
  const [profileDisplayMode, setProfileDisplayMode] = useState<
    "developing" | "pd" | "composite" | "pw"
  >("developing");
  const [drawZoneMode, setDrawZoneMode] = useState<boolean>(false);
  const [pickPriceMode, setPickPriceMode] = useState<PricePickTarget>(null);
  const [pickedPrices, setPickedPrices] = useState<{
    entry?: number;
    stop?: number;
    t1?: number;
    t2?: number;
    side?: OrderSide;
  }>({});
  const [customZones, setCustomZones] = useState<KeyLevelZone[]>([]);
  const [pinnedZoneIds, setPinnedZoneIds] = useState<Set<string>>(new Set());
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  const [hoverTs, setHoverTs] = useState<number | null>(null);
  const [csvModalOpen, setCsvModalOpen] = useState<boolean>(false);

  const [plan, setPlan] = useState<PremarketPlan>(() => DEFAULT_PLAN(""));
  const [accountBalance, setAccountBalance] = useState<number>(300);
  const [positions, setPositions] = useState<SimPosition[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [drillCalls, setDrillCalls] = useState<DrillCall[]>([]);
  const [reps, setReps] = useState<SimRepLog[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    setReps(loadJournalReps());
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setToolsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const flashToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg((cur) => (cur === msg ? null : cur)), 3800);
  }, []);

  const applyDataset = useCallback((ds: SessionDataset) => {
    setDataset(ds);
    setSelectedSessionDate(ds.sessionDate);
    setPlan(loadSavedPlan(ds.sessionDate) ?? DEFAULT_PLAN(ds.sessionDate));
    setCustomZones(loadSavedCustomZones(ds.sessionDate));
    setPositions([]);
    setPendingOrders([]);
    setDrillCalls([]);
    setPickedPrices({});
    setPickPriceMode(null);
    setPinnedZoneIds(new Set());
    setIsPlaying(false);

    const targetStart = ds.asiaOpenTs + 45 * 60_000;
    const m5 = ds.m5Candles;
    if (m5.length > 0) {
      const candidate =
        m5.find((c) => c.ts >= targetStart) ??
        m5.find((c) => c.ts >= ds.asiaOpenTs) ??
        m5[Math.max(0, Math.floor(m5.length * 0.65))];
      setReplayTs(candidate.ts);
    }
  }, []);

  const fetchFeed = useCallback(
    async (preset: FeedPreset, sessionDate?: string) => {
      setLoading(true);
      setLoadError(null);
      try {
        const qs = sessionDate
          ? `?sessionDate=${encodeURIComponent(sessionDate)}`
          : "";
        const res = await fetch(`/api/market/${preset}${qs}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `Failed to load ${preset}`);
        setAvailableSessions(json.availableSessions ?? []);
        applyDataset(json.dataset as SessionDataset);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    },
    [applyDataset]
  );

  useEffect(() => {
    fetchFeed("paxg");
  }, [fetchFeed]);

  const updatePlan = useCallback((next: PremarketPlan) => {
    setPlan(next);
    savePlanForSession(next);
  }, []);

  const updateCustomZones = useCallback(
    (updater: (prev: KeyLevelZone[]) => KeyLevelZone[]) => {
      setCustomZones((prev) => {
        const next = updater(prev);
        if (dataset?.sessionDate) saveCustomZonesForSession(dataset.sessionDate, next);
        return next;
      });
    },
    [dataset?.sessionDate]
  );

  // Strict no-lookahead views
  const visibleH1 = useMemo(
    () => (dataset ? dataset.h1Candles.filter((c) => c.ts <= replayTs) : []),
    [dataset, replayTs]
  );
  const visibleM30 = useMemo(
    () => (dataset ? dataset.m30Candles.filter((c) => c.ts <= replayTs) : []),
    [dataset, replayTs]
  );
  const visibleM5 = useMemo(
    () => (dataset ? dataset.m5Candles.filter((c) => c.ts <= replayTs) : []),
    [dataset, replayTs]
  );
  const visibleM1 = useMemo(
    () =>
      dataset
        ? dataset.m1Candles.filter((c) => c.ts <= replayTs + 299_999)
        : [],
    [dataset, replayTs]
  );
  const visibleTicks = useMemo(
    () =>
      dataset
        ? dataset.ticks.filter((t) => t.ts <= replayTs + 299_999)
        : [],
    [dataset, replayTs]
  );
  const visibleL2 = useMemo(
    () =>
      dataset
        ? dataset.l2Snapshots.filter((s) => s.ts <= replayTs + 299_999)
        : [],
    [dataset, replayTs]
  );

  const currentPrice = useMemo(() => {
    const lastM1 = visibleM1[visibleM1.length - 1];
    const lastM5 = visibleM5[visibleM5.length - 1];
    if (lastM1 && lastM5 && lastM1.ts >= lastM5.ts) return lastM1.close;
    return lastM5?.close ?? visibleH1[visibleH1.length - 1]?.close ?? 0;
  }, [visibleM1, visibleM5, visibleH1]);

  const profiles = useMemo(() => {
    if (!dataset) {
      return {
        previousDay: null,
        previousWeek: null,
        composite5d: null,
        developing: null,
        nakedPocs: [],
        autoZones: [],
      };
    }
    return computeAllSessionProfiles({
      h1Candles: dataset.h1Candles,
      m5Candles: dataset.m5Candles,
      replayTs,
      currentSessionDate: dataset.sessionDate,
    });
  }, [dataset, replayTs]);

  const allZones = useMemo(() => {
    const merged = [...profiles.autoZones, ...customZones].map((z) => ({
      ...z,
      pinned:
        pinnedZoneIds.has(z.id) || z.kind === "stacked" || z.kind === "custom",
    }));
    return merged.sort((a, b) => {
      const distA = Math.abs((a.low + a.high) / 2 - currentPrice);
      const distB = Math.abs((b.low + b.high) / 2 - currentPrice);
      return distA - distB;
    });
  }, [profiles.autoZones, customZones, pinnedZoneIds, currentPrice]);

  useEffect(() => {
    if (!activeZoneId && allZones.length > 0) setActiveZoneId(allZones[0].id);
  }, [activeZoneId, allZones]);

  const activeZone = useMemo(
    () => allZones.find((z) => z.id === activeZoneId) ?? allZones[0] ?? null,
    [allZones, activeZoneId]
  );

  // Exact ATAS Asia Template imbalanceRate: 150% (1.5)
  const footprintSuite = useMemo(() => {
    if (!dataset?.capabilities.hasRealAggressorTape) {
      return {
        bars: [],
        calibratedLargeThreshold: 1,
        calibratedWhaleThreshold: 3,
        allBigTrades: [],
      };
    }
    return buildFootprintsFromTicks(visibleTicks, {
      intervalMs: 300_000,
      priceStep: fpStep,
      imbalanceRatio: T.clusters.imbalanceRate,
      bigTradeLargeThreshold: customBigLarge ?? undefined,
      bigTradeWhaleThreshold: customBigWhale ?? undefined,
    });
  }, [dataset, visibleTicks, fpStep, customBigLarge, customBigWhale]);

  const vwapH1 = useMemo(() => computeSessionVwap(visibleH1), [visibleH1]);
  const vwapM30 = useMemo(() => computeSessionVwap(visibleM30), [visibleM30]);
  const vwapM5 = useMemo(() => computeSessionVwap(visibleM5), [visibleM5]);
  const vwapM1 = useMemo(() => computeSessionVwap(visibleM1), [visibleM1]);

  const persistRep = useCallback(
    (rep: SimRepLog) => {
      setReps((prev) => {
        const next = [rep, ...prev];
        saveJournalReps(next);
        return next;
      });
      flashToast(
        `Logged rep (${rep.model === "no_trade" ? "Skip" : `${rep.outcomeR >= 0 ? "+" : ""}${rep.outcomeR}R`})`
      );
    },
    [flashToast]
  );

  const deleteRep = useCallback((id: string) => {
    setReps((prev) => {
      const next = prev.filter((r) => r.id !== id);
      saveJournalReps(next);
      return next;
    });
  }, []);

  const closePosition = useCallback(
    (id: string, exitPrice: number, reason: SimPosition["exitReason"]) => {
      setPositions((prev) =>
        prev.map((p) => {
          if (p.id !== id || p.status === "closed") return p;
          const ptVal = p.contract === "1OZ" ? 1 : p.contract === "MGC" ? 10 : 100;
          const pts =
            p.side === "long"
              ? exitPrice - p.entryPriceExec
              : p.entryPriceExec - exitPrice;
          const netPnl = Number(
            (pts * ptVal * p.contracts - p.commissionDollars).toFixed(2)
          );
          const rMult = Number(
            (p.riskDollars > 0 ? netPnl / p.riskDollars : 0).toFixed(2)
          );

          if (dataset) {
            persistRep({
              id: `rep-${Date.now()}`,
              createdAt: new Date().toISOString(),
              sessionDate: dataset.sessionDate,
              instrument: `${dataset.instrument} / ${p.contract}`,
              dataSource: dataset.dataSource,
              scenario: p.scenario,
              model: p.model,
              setupTag: p.setupTag,
              side: p.side,
              entryTiming: p.entryTiming,
              contextUsed: {
                h1m30: true,
                m5: true,
                m5Footprint: dataset.capabilities.hasRealAggressorTape,
                m1: visibleM1.length > 0,
              },
              outcomeR: rMult,
              pnlDollars: netPnl,
              entryPrice: p.entryPriceExec,
              triggerPrice: p.triggerPriceExec,
              slippagePts: p.slippagePts,
              stopPrice: p.stopPriceExec,
              targetPrice: p.t2PriceExec,
              ruleViolations: p.warnings.map((w) => w.code),
              note: `${p.note} [${reason ?? "closed"} @ ${exitPrice.toFixed(2)}]`,
            });
          }

          return {
            ...p,
            status: "closed",
            closedAtTs: replayTs,
            exitPriceExec: exitPrice,
            exitReason: reason,
            pnlDollars: netPnl,
            rMultiple: rMult,
          };
        })
      );
    },
    [dataset, persistRep, replayTs, visibleM1.length]
  );

  // Pending Order evaluation
  useEffect(() => {
    if (pendingOrders.length === 0 || visibleM5.length === 0) return;
    const latestBar = visibleM5[visibleM5.length - 1];
    const hasOpenPos = positions.some((p) => p.status === "open");

    for (const ord of pendingOrders) {
      const ev = evaluatePendingOrderOnBar(ord, latestBar);
      if (ev.action === "cancelled_invalidated") {
        setPendingOrders((prev) => prev.filter((o) => o.id !== ord.id));
        setIsPlaying(false);
        flashToast(ev.reason ?? "Order cancelled on invalidation.");
        break;
      }
      if (ev.action === "filled" && !hasOpenPos && ev.fillPriceExec !== undefined) {
        const fillPx = ev.fillPriceExec;
        setPendingOrders((prev) => prev.filter((o) => o.id !== ord.id));
        setPositions((prev) => [
          ...prev,
          {
            id: `pos-${Date.now()}`,
            side: ord.side,
            orderType: ord.orderType,
            triggerPriceExec: ord.triggerPriceExec,
            slippagePts: ev.slippagePts ?? 0,
            model: ord.model,
            scenario: ord.scenario,
            setupTag: ord.setupTag,
            contract: ord.contract,
            entryPriceGC: fillPx,
            entryPriceExec: fillPx,
            stopPriceGC: ord.stopPriceGC,
            stopPriceExec: ord.stopPriceExec,
            t1PriceExec: ord.t1PriceExec,
            t2PriceExec: ord.t2PriceExec,
            contracts: ord.contracts,
            riskDollars: ord.riskDollars,
            commissionDollars: ord.commissionDollars,
            openedAtTs: latestBar.ts,
            status: "open",
            entryTiming: ord.entryTiming,
            warnings: ord.warnings,
            zoneId: ord.zoneId,
            note: ord.note,
          },
        ]);
        setIsPlaying(false);
        flashToast(ev.reason ?? `Filled @ ${ev.fillPriceExec.toFixed(2)}`);
        break;
      }
    }
  }, [replayTs, pendingOrders, positions, visibleM5, flashToast]);

  // Open Position Stop/T1/T2 evaluation
  useEffect(() => {
    const openPos = positions.find((p) => p.status === "open");
    if (!openPos || visibleM5.length === 0) return;
    const latestBar = visibleM5[visibleM5.length - 1];
    if (latestBar.ts <= openPos.openedAtTs) return;

    if (openPos.side === "long") {
      if (latestBar.low <= openPos.stopPriceExec) {
        closePosition(openPos.id, openPos.stopPriceExec, "stop");
        setIsPlaying(false);
        return;
      }
      if (latestBar.high >= openPos.t2PriceExec) {
        closePosition(openPos.id, openPos.t2PriceExec, "t2");
        setIsPlaying(false);
        return;
      }
      if (!openPos.t1Hit && latestBar.high >= openPos.t1PriceExec) {
        setPositions((prev) =>
          prev.map((p) => (p.id === openPos.id ? { ...p, t1Hit: true } : p))
        );
        flashToast(`T1 (${openPos.t1PriceExec.toFixed(2)}) reached`);
      }
    } else {
      if (latestBar.high >= openPos.stopPriceExec) {
        closePosition(openPos.id, openPos.stopPriceExec, "stop");
        setIsPlaying(false);
        return;
      }
      if (latestBar.low <= openPos.t2PriceExec) {
        closePosition(openPos.id, openPos.t2PriceExec, "t2");
        setIsPlaying(false);
        return;
      }
      if (!openPos.t1Hit && latestBar.low <= openPos.t1PriceExec) {
        setPositions((prev) =>
          prev.map((p) => (p.id === openPos.id ? { ...p, t1Hit: true } : p))
        );
        flashToast(`T1 (${openPos.t1PriceExec.toFixed(2)}) reached`);
      }
    }
  }, [replayTs, positions, visibleM5, closePosition, flashToast]);

  // Drill auto-grade
  useEffect(() => {
    if (!drillCalls.some((c) => !c.graded) || visibleM5.length === 0) return;
    let changed = false;
    const next = drillCalls.map((c) => {
      if (c.graded) return c;
      const res = gradeDrillCall(c, visibleM5);
      if (res) {
        changed = true;
        return { ...c, graded: res };
      }
      return c;
    });
    if (changed) setDrillCalls(next);
  }, [replayTs, drillCalls, visibleM5]);

  const stepM5 = useCallback(
    (deltaBars: number) => {
      if (!dataset || dataset.m5Candles.length === 0) return;
      const bars = dataset.m5Candles;
      let idx = bars.findIndex((b) => b.ts >= replayTs);
      if (idx === -1) idx = bars.length - 1;
      const nextIdx = Math.max(0, Math.min(bars.length - 1, idx + deltaBars));
      setReplayTs(bars[nextIdx].ts);
      if (nextIdx >= bars.length - 1) setIsPlaying(false);
    },
    [dataset, replayTs]
  );

  const stepM1 = useCallback(
    (deltaBars: number) => {
      if (!dataset || dataset.m1Candles.length === 0) {
        stepM5(deltaBars);
        return;
      }
      const nextTs = replayTs + deltaBars * 60_000;
      const maxTs = dataset.m5Candles[dataset.m5Candles.length - 1]?.ts ?? nextTs;
      const minTs = dataset.m5Candles[0]?.ts ?? nextTs;
      setReplayTs(Math.max(minTs, Math.min(maxTs, nextTs)));
    },
    [dataset, replayTs, stepM5]
  );

  const jumpToNextLevelTouch = useCallback(() => {
    if (!dataset) return;
    const pinned = allZones.filter((z) => z.pinned);
    const targets = pinned.length > 0 ? pinned : allZones.slice(0, 3);
    if (targets.length === 0) return;
    const nextBar = dataset.m5Candles.find(
      (b) =>
        b.ts > replayTs &&
        targets.some((z) => b.low <= z.high && b.high >= z.low)
    );
    if (nextBar) {
      setReplayTs(nextBar.ts);
      setIsPlaying(false);
      const hitZone = targets.find(
        (z) => nextBar.low <= z.high && nextBar.high >= z.low
      );
      if (hitZone) {
        setActiveZoneId(hitZone.id);
        flashToast(`Touch: ${hitZone.label.replace("STACKED: ", "")} (${formatPTTime(nextBar.ts)} PT)`);
      }
    } else {
      flashToast("No further zone touches in session.");
    }
  }, [dataset, allZones, replayTs, flashToast]);

  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => stepM5(1), playSpeedMs);
    return () => clearInterval(id);
  }, [isPlaying, playSpeedMs, stepM5]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Space" && mainTab === "gc") {
        e.preventDefault();
        setIsPlaying((p) => !p);
      } else if (e.key === "ArrowRight" && mainTab === "gc") {
        e.preventDefault();
        if (e.shiftKey) stepM1(1);
        else stepM5(1);
      } else if (e.key === "ArrowLeft" && mainTab === "gc") {
        e.preventDefault();
        stepM5(-1);
      } else if (e.key.toLowerCase() === "z") {
        setDrawZoneMode((d) => !d);
      } else if (e.key === "Escape") {
        setPickPriceMode(null);
        setDrawZoneMode(false);
        setToolsOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mainTab, stepM1, stepM5]);

  const asiaBarsRange = useMemo(() => {
    if (!dataset || dataset.m5Candles.length === 0) {
      return { minTs: 0, maxTs: 1, currentIdx: 0, total: 0 };
    }
    const startIdx = Math.max(
      0,
      dataset.m5Candles.findIndex((c) => c.ts >= dataset.asiaOpenTs - 3600_000)
    );
    const slice = dataset.m5Candles.slice(startIdx);
    const curIdx = slice.filter((c) => c.ts <= replayTs).length;
    return {
      minTs: slice[0]?.ts ?? dataset.m5Candles[0].ts,
      maxTs:
        slice[slice.length - 1]?.ts ??
        dataset.m5Candles[dataset.m5Candles.length - 1].ts,
      currentIdx: curIdx,
      total: slice.length,
    };
  }, [dataset, replayTs]);

  const handleDrawZoneComplete = (low: number, high: number) => {
    const newZone: KeyLevelZone = {
      id: `custom-${Date.now()}`,
      label: `Zone ${low.toFixed(1)}-${high.toFixed(1)}`,
      low,
      high,
      kind: "custom",
      untested: true,
      touchCount: 0,
      pinned: true,
    };
    updateCustomZones((prev) => [...prev, newZone]);
    setActiveZoneId(newZone.id);
    setDrawZoneMode(false);
    flashToast(`Marked zone ${low.toFixed(2)} - ${high.toFixed(2)}`);
  };

  const handleChartPricePick = (price: number) => {
    if (!pickPriceMode) return;
    setPickedPrices((prev) => ({ ...prev, [pickPriceMode]: price }));
    flashToast(`Set ${pickPriceMode.toUpperCase()} = ${price.toFixed(2)}`);
    setPickPriceMode(null);
  };

  const latestFootprint =
    footprintSuite.bars[footprintSuite.bars.length - 1] ?? null;
  const instrTag = dataset?.dataSource === "gc_ohlcv" ? "/GC:XCEC" : "PAXG/USD";
  const isWorkstationView = mainTab === "gc" || mainTab === "premarket";

  return (
    <div
      className={`flex flex-col bg-[#111620] text-[#F1F1F1] ${
        isWorkstationView ? "xl:h-screen xl:overflow-hidden min-h-screen" : "min-h-screen"
      }`}
    >
      {/* ATAS X Top Window Bar (#151B26, 40px) */}
      <header className="sticky top-0 z-40 flex h-10 shrink-0 items-center justify-between gap-2 border-b border-[#2A2E39] bg-[#151B26] px-2.5 text-xs">
        {/* Left: ATAS Workspace Title + Exact Window Tabs */}
        <div className="flex items-center gap-2 h-full">
          <div className="flex items-center gap-1.5 pr-2 border-r border-[#2A2E39]">
            <div className="h-5 w-5 rounded-xs bg-[#2962FF] flex items-center justify-center font-mono-num text-[10px] font-bold text-white">
              AX
            </div>
            <span className="hidden sm:inline text-[11px] font-semibold text-[#F1F1F1]">
              Asia_Template_Fixed
            </span>
          </div>

          <nav className="flex items-end gap-0.5 h-full pt-1 text-[11px]">
            {(
              [
                { id: "gc", label: "GC" },
                { id: "premarket", label: "Premarket" },
                {
                  id: "journal",
                  label: `Sim Journal (${reps.filter((r) => !r.isSample).length})`,
                },
                { id: "playbook", label: "Playbook" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setMainTab(t.id)}
                className={`h-full px-3 rounded-t-xs font-medium transition border-t-2 ${
                  mainTab === t.id
                    ? "border-[#2962FF] bg-[#1F293B] text-white"
                    : "border-transparent bg-transparent text-[#ABAEB8] hover:bg-[#1A2333] hover:text-white"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {/* Compact ATAS Replay Controls right inside header when on GC tab */}
          {dataset && mainTab === "gc" && (
            <div className="hidden lg:flex items-center gap-1 border-l border-[#2A2E39] pl-2.5 text-[11px]">
              <button
                type="button"
                onClick={() => setReplayTs(dataset.asiaOpenTs)}
                className="rounded-xs bg-[#1A2333] px-1.5 py-0.5 text-[10px] text-[#ABAEB8] hover:text-white border border-[#2A2E39]"
              >
                16:00 PT
              </button>
              <button
                type="button"
                onClick={jumpToNextLevelTouch}
                className="flex items-center gap-1 rounded-xs bg-[#1A2333] px-2 py-0.5 text-[10px] font-medium text-[#3BEFF0] hover:bg-[#243147] border border-[#2A2E39]"
              >
                <FastForward className="h-3 w-3" /> Next Touch
              </button>
              <button
                type="button"
                onClick={() => stepM5(-1)}
                className="rounded-xs p-1 text-[#ABAEB8] hover:bg-[#1A2333] hover:text-white"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setIsPlaying((p) => !p)}
                className="flex items-center gap-1 rounded-xs bg-[#2962FF] px-2.5 py-0.5 text-[10.5px] font-semibold text-white hover:bg-[#3a70ff]"
              >
                {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                {isPlaying ? "Pause" : "Replay"}
              </button>
              <button
                type="button"
                onClick={() => stepM1(1)}
                className="rounded-xs bg-[#1A2333] px-1.5 py-0.5 font-mono-num text-[10px] text-[#F1F1F1] hover:bg-[#243147]"
              >
                +1m
              </button>
              <button
                type="button"
                onClick={() => stepM5(1)}
                className="flex items-center gap-0.5 rounded-xs bg-[#1A2333] px-1.5 py-0.5 font-mono-num text-[10px] text-[#F1F1F1] hover:bg-[#243147]"
              >
                +5m <ChevronRight className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => stepM5(6)}
                className="rounded-xs bg-[#1A2333] px-1.5 py-0.5 font-mono-num text-[10px] text-[#ABAEB8] hover:text-white"
              >
                +30m
              </button>
              <span className="ml-1 font-mono-num text-[10.5px] text-[#3BEFF0]">
                {blindDate ? `${formatPTTime(replayTs)} PT` : `${formatPTTime(replayTs, true)} PT`}
              </span>
            </div>
          )}
        </div>

        {/* Right: ATAS Connector Selector, Session Date, Chart Trader Toggle, Settings */}
        <div className="flex items-center gap-1.5 text-[11px]">
          {loading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-[#3BEFF0]" />}

          <div className="flex items-center rounded-xs bg-[#111620] p-0.5 border border-[#2A2E39] text-[10.5px]">
            <button
              type="button"
              onClick={() => {
                setFeedPreset("paxg");
                fetchFeed("paxg");
              }}
              className={`rounded-xs px-2 py-0.5 font-medium ${
                feedPreset === "paxg" && dataset?.dataSource === "paxg_ticks"
                  ? "bg-[#089981] text-white"
                  : "text-[#ABAEB8] hover:text-white"
              }`}
            >
              PAXG Tape
            </button>
            <button
              type="button"
              onClick={() => {
                setFeedPreset("gc");
                fetchFeed("gc");
              }}
              className={`rounded-xs px-2 py-0.5 font-medium ${
                feedPreset === "gc" && dataset?.dataSource === "gc_ohlcv"
                  ? "bg-[#2962FF] text-white"
                  : "text-[#ABAEB8] hover:text-white"
              }`}
            >
              GC=F
            </button>
          </div>

          {availableSessions.length > 0 && (
            <select
              value={selectedSessionDate}
              onChange={(e) => {
                setSelectedSessionDate(e.target.value);
                fetchFeed(feedPreset, e.target.value);
              }}
              className="rounded-xs border border-[#2A2E39] bg-[#1A2333] px-1.5 py-1 font-mono-num text-[10.5px] text-[#F1F1F1]"
            >
              {availableSessions.map((d, idx) => (
                <option key={d} value={d}>
                  {blindDate ? `Blind #${idx + 1}` : d}
                </option>
              ))}
            </select>
          )}

          {mainTab === "gc" && (
            <button
              type="button"
              onClick={() => setShowChartTrader((v) => !v)}
              className={`flex items-center gap-1 rounded-xs border px-2 py-1 text-[10.5px] font-medium ${
                showChartTrader
                  ? "border-[#2962FF] bg-[#2962FF]/20 text-white"
                  : "border-[#2A2E39] bg-[#1A2333] text-[#ABAEB8] hover:text-white"
              }`}
              title="Toggle ATAS Chart Trader side panel"
            >
              <PanelRight className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">Chart Trader</span>
            </button>
          )}

          {/* ATAS Settings Popover */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setToolsOpen((o) => !o)}
              className="flex items-center gap-1 rounded-xs border border-[#2A2E39] bg-[#1A2333] px-2 py-1 text-[10.5px] text-[#F1F1F1] hover:bg-[#243147]"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <ChevronDown className="h-3 w-3 text-[#ABAEB8]" />
            </button>

            {toolsOpen && (
              <div className="absolute right-0 mt-1 w-60 rounded-xs border border-[#434651] bg-[#151B26] p-3 shadow-2xl space-y-3 text-[11px] z-50">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#ABAEB8] mb-1">
                    Profile Overlay
                  </div>
                  <div className="grid grid-cols-4 gap-1 font-mono-num text-[10px]">
                    {(["developing", "pd", "pw", "composite"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setProfileDisplayMode(m)}
                        className={`rounded-xs py-1 uppercase ${
                          profileDisplayMode === m
                            ? "bg-[#2962FF] text-white font-semibold"
                            : "bg-[#1A2333] text-[#ABAEB8]"
                        }`}
                      >
                        {m === "developing" ? "Dev" : m === "composite" ? "5D" : m}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-[#2A2E39] pt-2">
                  <div className="text-[10px] uppercase tracking-wider text-[#ABAEB8] mb-1">
                    Cluster Tick Step
                  </div>
                  <div className="grid grid-cols-4 gap-1 font-mono-num text-[10px]">
                    {[0.25, 0.5, 1.0, 2.0].map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setFpStep(st)}
                        className={`rounded-xs py-1 ${
                          fpStep === st
                            ? "bg-[#2962FF] text-white font-semibold"
                            : "bg-[#1A2333] text-[#ABAEB8]"
                        }`}
                      >
                        ${st.toFixed(2)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-[#2A2E39] pt-2 space-y-1">
                  <button
                    type="button"
                    onClick={() => setDrawZoneMode((v) => !v)}
                    className="flex w-full items-center justify-between rounded-xs px-2 py-1 hover:bg-[#1A2333]"
                  >
                    <span>Draw Level Zone (Z)</span>
                    <span className={drawZoneMode ? "text-[#3BEFF0] font-semibold" : "text-[#787D8C]"}>
                      {drawZoneMode ? "ON" : "OFF"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrillMode((v) => !v)}
                    className="flex w-full items-center justify-between rounded-xs px-2 py-1 hover:bg-[#1A2333]"
                  >
                    <span className="flex items-center gap-1.5">
                      <Crosshair className="h-3 w-3 text-[#FFFF00]" /> Blind Drill Mode
                    </span>
                    <span className={drillMode ? "text-[#089981] font-semibold" : "text-[#787D8C]"}>
                      {drillMode ? "ON" : "OFF"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBlindDate((v) => !v)}
                    className="flex w-full items-center justify-between rounded-xs px-2 py-1 hover:bg-[#1A2333]"
                  >
                    <span className="flex items-center gap-1.5">
                      {blindDate ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />} Hide Date
                    </span>
                    <span className={blindDate ? "text-[#089981] font-semibold" : "text-[#787D8C]"}>
                      {blindDate ? "ON" : "OFF"}
                    </span>
                  </button>
                </div>

                <div className="border-t border-[#2A2E39] pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setToolsOpen(false);
                      setCsvModalOpen(true);
                    }}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xs bg-[#2962FF] py-1.5 font-semibold text-white hover:bg-[#3a70ff]"
                  >
                    <Upload className="h-3.5 w-3.5" /> Import Databento / ATAS CSV
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-11 right-4 z-50 rounded-xs border border-[#434651] bg-[#1A2333] px-3 py-1.5 text-[11px] font-medium text-[#F1F1F1] shadow-2xl">
          {toastMsg}
        </div>
      )}

      {/* Main Workspace */}
      <main className="flex-1 min-h-0 flex flex-col">
        {loadError && !dataset && (
          <div className="m-auto max-w-md rounded-xs border border-[#F2385A]/40 bg-[#151B26] p-5 text-center text-xs">
            <div className="font-semibold text-[#F2385A]">Feed load failed</div>
            <p className="mt-1 text-[#ABAEB8]">{loadError}</p>
            <div className="mt-3 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => fetchFeed(feedPreset)}
                className="rounded-xs bg-[#2962FF] px-3 py-1.5 font-medium text-white"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => setCsvModalOpen(true)}
                className="rounded-xs border border-[#434651] px-3 py-1.5 text-[#F1F1F1]"
              >
                Import CSV
              </button>
            </div>
          </div>
        )}

        {/* GC TAB — EXACT ATAS X 50.9% LEFT DOCK | 49.1% RIGHT DOCK + COLLAPSIBLE CHART TRADER */}
        {dataset && mainTab === "gc" && (
          <div className="flex-1 min-h-0 flex flex-col">
            {drillMode && (
              <DrillModeCard
                activeZone={activeZone}
                replayTs={replayTs}
                drillCalls={drillCalls}
                onLockCall={(call) => {
                  setDrillCalls((prev) => [call, ...prev]);
                  flashToast(`Locked Drill Call at ${call.zoneLabel}`);
                }}
                onStep6Bars={() => stepM5(6)}
              />
            )}

            <div className="flex-1 min-h-0 flex flex-col xl:flex-row">
              {/* LEFT DOCK (51%): Exact G0.W0..W4 Tabbed Chart Stack */}
              <section className="flex flex-col min-h-[460px] xl:min-h-0 xl:flex-[51] border-b xl:border-b-0 xl:border-r border-[#2A2E39]">
                {/* ATAS WidgetGroup Tab Strip */}
                <div className="flex h-7 shrink-0 items-end justify-between border-b border-[#2A2E39] bg-[#131822] px-1 text-[11px]">
                  <div className="flex items-end gap-0.5 h-full pt-0.5">
                    {(
                      [
                        { id: "h1", label: `${instrTag} H1` },
                        { id: "m30", label: `${instrTag} M30` },
                        { id: "m5", label: `${instrTag} M5` },
                        { id: "m1", label: `${instrTag} M1` },
                        { id: "m5_cluster", label: `${instrTag} M5 Cluster` },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setLeftTab(tab.id)}
                        className={`h-full px-2.5 rounded-t-xs font-medium transition border-t-2 ${
                          leftTab === tab.id
                            ? "border-[#3BEFF0] bg-[#1F293B] text-white"
                            : "border-transparent text-[#ABAEB8] hover:bg-[#1A2333] hover:text-white"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <div className="hidden sm:flex items-center gap-1 pr-1.5 pb-1 text-[10px] font-mono-num text-[#ABAEB8]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#089981]" />
                    <span>
                      {dataset.capabilities.hasRealAggressorTape ? "Real Tape" : "OHLCV Only"}
                    </span>
                  </div>
                </div>

                {/* Active Left Chart + ATAS CumulativeDelta Candles Sub-Panel on M5 & M1 */}
                <div className="flex-1 min-h-0 flex flex-col">
                  {leftTab === "h1" && (
                    <CandleProfileChart
                      title={`${instrTag} H1`}
                      timeframeLabel="H1"
                      instrumentLabel={instrTag}
                      candles={visibleH1}
                      vwapSeries={vwapH1}
                      profiles={profiles}
                      activeProfileMode={profileDisplayMode}
                      nakedPocs={profiles.nakedPocs}
                      zones={allZones}
                      activeZoneId={activeZoneId}
                      positions={positions}
                      pendingOrders={pendingOrders}
                      drawZoneMode={drawZoneMode}
                      pickPriceMode={pickPriceMode}
                      onDrawZoneComplete={handleDrawZoneComplete}
                      onSelectZone={setActiveZoneId}
                      onClickPrice={handleChartPricePick}
                      defaultVisibleBars={96}
                      indicatorBadges={["BigTrades", "VWAP", "DeltaStrength", "BarTimer", "Absorption"]}
                    />
                  )}
                  {leftTab === "m30" && (
                    <CandleProfileChart
                      title={`${instrTag} M30`}
                      timeframeLabel="M30"
                      instrumentLabel={instrTag}
                      candles={visibleM30}
                      vwapSeries={vwapM30}
                      profiles={profiles}
                      activeProfileMode="pd"
                      nakedPocs={profiles.nakedPocs}
                      zones={allZones}
                      activeZoneId={activeZoneId}
                      positions={positions}
                      pendingOrders={pendingOrders}
                      asiaOpenTs={dataset.asiaOpenTs}
                      drawZoneMode={drawZoneMode}
                      pickPriceMode={pickPriceMode}
                      onDrawZoneComplete={handleDrawZoneComplete}
                      onSelectZone={setActiveZoneId}
                      onClickPrice={handleChartPricePick}
                      defaultVisibleBars={80}
                      indicatorBadges={["BigTrades", "VWAP", "DeltaStrength", "BarTimer", "Absorption"]}
                    />
                  )}
                  {leftTab === "m5" && (
                    <>
                      <div className="flex-1 min-h-[260px]">
                        <CandleProfileChart
                          title={`${instrTag} M5`}
                          timeframeLabel="M5"
                          instrumentLabel={instrTag}
                          candles={visibleM5}
                          footprintBars={footprintSuite.bars}
                          vwapSeries={vwapM5}
                          profiles={profiles}
                          activeProfileMode={profileDisplayMode}
                          nakedPocs={profiles.nakedPocs}
                          zones={allZones}
                          activeZoneId={activeZoneId}
                          bigTrades={footprintSuite.allBigTrades}
                          positions={positions}
                          pendingOrders={pendingOrders}
                          asiaOpenTs={dataset.asiaOpenTs}
                          drawZoneMode={drawZoneMode}
                          pickPriceMode={pickPriceMode}
                          onDrawZoneComplete={handleDrawZoneComplete}
                          onSelectZone={setActiveZoneId}
                          onClickPrice={handleChartPricePick}
                          hoverTs={hoverTs}
                          onHoverTs={setHoverTs}
                          defaultVisibleBars={60}
                          indicatorBadges={[
                            "BigTrades ×2",
                            "AdaptiveBigTrades",
                            "VWAP (Yellow)",
                            "Absorption (300%)",
                            "BarTimer",
                          ]}
                        />
                      </div>
                      <CvdChart
                        bars={footprintSuite.bars}
                        hasRealAggressorTape={dataset.capabilities.hasRealAggressorTape}
                        heightClass="h-[145px] shrink-0"
                      />
                    </>
                  )}
                  {leftTab === "m1" && (
                    <>
                      <div className="flex-1 min-h-[260px]">
                        <CandleProfileChart
                          title={`${instrTag} M1 (1OZ $0.25)`}
                          timeframeLabel="M1"
                          instrumentLabel={instrTag}
                          candles={visibleM1.length > 0 ? visibleM1 : visibleM5}
                          vwapSeries={visibleM1.length > 0 ? vwapM1 : vwapM5}
                          zones={allZones}
                          activeZoneId={activeZoneId}
                          positions={positions}
                          pendingOrders={pendingOrders}
                          pickPriceMode={pickPriceMode}
                          onSelectZone={setActiveZoneId}
                          onClickPrice={handleChartPricePick}
                          show1OZGrid
                          hoverTs={hoverTs}
                          onHoverTs={setHoverTs}
                          defaultVisibleBars={65}
                          indicatorBadges={["VWAP", "BarTimer", "Absorption", "BigTrades", "CumulativeDelta"]}
                        />
                      </div>
                      <CvdChart
                        bars={footprintSuite.bars}
                        hasRealAggressorTape={dataset.capabilities.hasRealAggressorTape}
                        heightClass="h-[145px] shrink-0"
                      />
                    </>
                  )}
                  {leftTab === "m5_cluster" && (
                    <FootprintChart
                      title={`${instrTag} M5 Bid×Ask`}
                      instrumentLabel={instrTag}
                      bars={footprintSuite.bars}
                      vwapSeries={vwapM5}
                      hasRealAggressorTape={dataset.capabilities.hasRealAggressorTape}
                      zones={allZones}
                      activeZoneId={activeZoneId}
                      priceStep={fpStep}
                      mode="bid_ask"
                      onSwitchToPaxg={() => {
                        setFeedPreset("paxg");
                        fetchFeed("paxg");
                      }}
                      onOpenCsvModal={() => setCsvModalOpen(true)}
                    />
                  )}
                </div>
              </section>

              {/* RIGHT DOCK (49%): Exact G1.W0..W2 Tabbed Stack (M5 Clusters | M5 Delta | Heatmap | SmartDOM | Tape) */}
              <section className="flex flex-col min-h-[460px] xl:min-h-0 xl:flex-[49]">
                <div className="flex h-7 shrink-0 items-end justify-between border-b border-[#2A2E39] bg-[#131822] px-1 text-[11px]">
                  <div className="flex items-end gap-0.5 h-full pt-0.5">
                    {(
                      [
                        { id: "clusters", label: "M5 Footprint" },
                        { id: "delta", label: "M5 Delta" },
                        { id: "heatmap", label: "Heatmap" },
                        { id: "smartdom", label: "SmartDOM" },
                        { id: "tape", label: "Tape" },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setRightTab(tab.id)}
                        className={`h-full px-2.5 rounded-t-xs font-medium transition border-t-2 ${
                          rightTab === tab.id
                            ? "border-[#FF4900] bg-[#1F293B] text-white"
                            : "border-transparent text-[#ABAEB8] hover:bg-[#1A2333] hover:text-white"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <span className="hidden sm:inline pr-2 pb-1 font-mono-num text-[10.5px] text-[#F1F1F1]">
                    ${currentPrice.toFixed(2)}
                  </span>
                </div>

                <div className="flex-1 min-h-0">
                  {rightTab === "clusters" && (
                    <FootprintChart
                      instrumentLabel={instrTag}
                      bars={footprintSuite.bars}
                      vwapSeries={vwapM5}
                      hasRealAggressorTape={dataset.capabilities.hasRealAggressorTape}
                      zones={allZones}
                      activeZoneId={activeZoneId}
                      priceStep={fpStep}
                      mode="bid_ask"
                      onSwitchToPaxg={() => {
                        setFeedPreset("paxg");
                        fetchFeed("paxg");
                      }}
                      onOpenCsvModal={() => setCsvModalOpen(true)}
                    />
                  )}
                  {rightTab === "delta" && (
                    <FootprintChart
                      title={`${instrTag} M5 Delta Clusters`}
                      instrumentLabel={instrTag}
                      bars={footprintSuite.bars}
                      vwapSeries={vwapM5}
                      hasRealAggressorTape={dataset.capabilities.hasRealAggressorTape}
                      zones={allZones}
                      activeZoneId={activeZoneId}
                      priceStep={fpStep}
                      mode="delta"
                      onSwitchToPaxg={() => {
                        setFeedPreset("paxg");
                        fetchFeed("paxg");
                      }}
                      onOpenCsvModal={() => setCsvModalOpen(true)}
                    />
                  )}
                  {rightTab === "heatmap" && (
                    <HeatmapChart
                      l2Snapshots={visibleL2}
                      ticks={visibleTicks}
                      onOpenCsvModal={() => setCsvModalOpen(true)}
                    />
                  )}
                  {rightTab === "smartdom" && (
                    <SmartDomPanel
                      currentPrice={currentPrice}
                      ticks={visibleTicks}
                      developingProfile={profiles.developing}
                      latestL2={visibleL2[visibleL2.length - 1] ?? null}
                      positions={positions}
                      pendingOrders={pendingOrders}
                      onClickDomPrice={(price, side) => {
                        setPickedPrices((prev) => ({ ...prev, entry: price, side }));
                        setShowChartTrader(true);
                        flashToast(`SmartDOM snapped ${side.toUpperCase()} @ ${price.toFixed(2)}`);
                      }}
                    />
                  )}
                  {rightTab === "tape" && (
                    <TapePanel
                      ticks={visibleTicks}
                      latestFootprint={latestFootprint}
                      hasRealAggressorTape={dataset.capabilities.hasRealAggressorTape}
                      largeThreshold={footprintSuite.calibratedLargeThreshold}
                      whaleThreshold={footprintSuite.calibratedWhaleThreshold}
                      customLarge={customBigLarge}
                      customWhale={customBigWhale}
                      onChangeCustomLarge={setCustomBigLarge}
                      onChangeCustomWhale={setCustomBigWhale}
                    />
                  )}
                </div>
              </section>

              {/* FAR-RIGHT COLLAPSIBLE ATAS CHART TRADER DOCK (276px) */}
              {showChartTrader && (
                <div className="w-full xl:w-[276px] shrink-0 min-h-0 overflow-hidden">
                  <ExecutionSidebar
                    currentPrice={currentPrice}
                    replayTs={replayTs}
                    visibleM5={visibleM5}
                    visibleFootprints={footprintSuite.bars}
                    zones={allZones}
                    activeZoneId={activeZoneId}
                    onSelectZone={setActiveZoneId}
                    developingProfile={profiles.developing}
                    previousDayProfile={profiles.previousDay}
                    plan={plan}
                    positions={positions}
                    pendingOrders={pendingOrders}
                    accountBalance={accountBalance}
                    onAccountBalanceChange={setAccountBalance}
                    onOpenPosition={(pos) => {
                      setPositions((prev) => [...prev, pos]);
                      flashToast(`Filled ${pos.side.toUpperCase()} @ ${pos.entryPriceExec.toFixed(2)}`);
                    }}
                    onPlacePendingOrder={(ord) => {
                      setPendingOrders([ord]);
                      flashToast(`Working ${ord.side.toUpperCase()} ${ord.orderType.toUpperCase()} @ ${ord.triggerPriceExec.toFixed(2)}`);
                    }}
                    onCancelPendingOrder={(id) => {
                      setPendingOrders((prev) => prev.filter((o) => o.id !== id));
                      flashToast("Order cancelled.");
                    }}
                    onClosePosition={closePosition}
                    onMoveStopToBE={(id) => {
                      setPositions((prev) =>
                        prev.map((p) =>
                          p.id === id
                            ? { ...p, stopPriceExec: p.entryPriceExec, movedToBreakeven: true }
                            : p
                        )
                      );
                      flashToast("Stop moved to BE.");
                    }}
                    onLogSkippedTouch={({ scenario, note }) => {
                      persistRep({
                        id: `skip-${Date.now()}`,
                        createdAt: new Date().toISOString(),
                        sessionDate: dataset.sessionDate,
                        instrument: dataset.instrument,
                        dataSource: dataset.dataSource,
                        scenario: scenario as ScenarioNumber,
                        model: "no_trade",
                        setupTag: "other",
                        side: "none",
                        entryTiming: "skipped",
                        contextUsed: {
                          h1m30: true,
                          m5: true,
                          m5Footprint: dataset.capabilities.hasRealAggressorTape,
                          m1: visibleM1.length > 0,
                        },
                        outcomeR: 0,
                        ruleViolations: [],
                        note,
                      });
                    }}
                    pickPriceMode={pickPriceMode}
                    onSetPickPriceMode={setPickPriceMode}
                    pickedPrices={pickedPrices}
                    onClearPickedPrice={(field) =>
                      setPickedPrices((prev) => {
                        const copy = { ...prev };
                        delete copy[field];
                        return copy;
                      })
                    }
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* PREMARKET TAB */}
        {dataset && mainTab === "premarket" && (
          <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[1fr_340px]">
            <div className="flex flex-col min-h-0 divide-y divide-[#2A2E39] border-r border-[#2A2E39]">
              <div className="flex-1 min-h-[280px]">
                <CandleProfileChart
                  title={`${instrTag} H1`}
                  timeframeLabel="H1"
                  instrumentLabel={instrTag}
                  candles={visibleH1}
                  vwapSeries={vwapH1}
                  profiles={profiles}
                  activeProfileMode={profileDisplayMode}
                  nakedPocs={profiles.nakedPocs}
                  zones={allZones}
                  activeZoneId={activeZoneId}
                  onSelectZone={setActiveZoneId}
                  drawZoneMode={drawZoneMode}
                  onDrawZoneComplete={handleDrawZoneComplete}
                  defaultVisibleBars={96}
                />
              </div>
              <div className="flex-1 min-h-[250px]">
                <CandleProfileChart
                  title={`${instrTag} M30`}
                  timeframeLabel="M30"
                  instrumentLabel={instrTag}
                  candles={visibleM30}
                  vwapSeries={vwapM30}
                  profiles={profiles}
                  activeProfileMode="pd"
                  nakedPocs={profiles.nakedPocs}
                  zones={allZones}
                  activeZoneId={activeZoneId}
                  onSelectZone={setActiveZoneId}
                  drawZoneMode={drawZoneMode}
                  onDrawZoneComplete={handleDrawZoneComplete}
                  asiaOpenTs={dataset.asiaOpenTs}
                  defaultVisibleBars={80}
                />
              </div>
            </div>
            <div className="min-h-0 overflow-hidden">
              <PremarketPanel
                plan={plan}
                onChangePlan={updatePlan}
                profiles={profiles}
                zones={allZones}
                activeZoneId={activeZoneId}
                onSelectZone={setActiveZoneId}
                onTogglePinZone={(id) => {
                  setPinnedZoneIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  });
                }}
                onDeleteZone={(id) =>
                  updateCustomZones((prev) => prev.filter((z) => z.id !== id))
                }
                drawZoneMode={drawZoneMode}
                onToggleDrawZone={() => setDrawZoneMode((v) => !v)}
                onJumpToReplay={() => setMainTab("gc")}
              />
            </div>
          </div>
        )}

        {mainTab === "journal" && (
          <JournalView
            reps={reps}
            onAddRep={persistRep}
            onDeleteRep={deleteRep}
            currentSessionDate={dataset?.sessionDate ?? "2026-11-23"}
            currentInstrument={dataset?.instrument ?? "GC / 1OZ"}
          />
        )}

        {mainTab === "playbook" && <PlaybookView />}
      </main>

      {/* Compact 30px ATAS Status & Scrubber Bar */}
      {dataset && isWorkstationView && (
        <footer className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-[#2A2E39] bg-[#151B26] px-2.5 text-[10.5px]">
          <div className="flex items-center gap-2 text-[#ABAEB8]">
            <span className="h-2 w-2 rounded-full bg-[#089981]" />
            <span className="font-mono-num">
              ATAS Replay · {dataset.capabilities.sourceLabel}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-1 max-w-md">
            <select
              value={playSpeedMs}
              onChange={(e) => setPlaySpeedMs(Number(e.target.value))}
              className="rounded-xs bg-[#1A2333] px-1 py-0.5 font-mono-num text-[10px] text-[#F1F1F1] border border-[#2A2E39]"
            >
              <option value={1200}>0.5×</option>
              <option value={700}>1×</option>
              <option value={350}>2×</option>
              <option value={150}>5×</option>
            </select>
            <input
              type="range"
              min={asiaBarsRange.minTs}
              max={asiaBarsRange.maxTs}
              step={300_000}
              value={Math.max(
                asiaBarsRange.minTs,
                Math.min(asiaBarsRange.maxTs, replayTs)
              )}
              onChange={(e) => {
                setIsPlaying(false);
                setReplayTs(Number(e.target.value));
              }}
              className="w-full cursor-pointer"
            />
            <span className="shrink-0 font-mono-num text-[#ABAEB8]">
              {asiaBarsRange.currentIdx}/{asiaBarsRange.total} ·{" "}
              <strong className="text-[#F1F1F1]">{formatPTTime(replayTs)} PT</strong>
            </span>
          </div>

          {/* Mobile/Tablet Replay Step Controls */}
          <div className="flex lg:hidden items-center gap-1">
            <button
              type="button"
              onClick={() => setIsPlaying((p) => !p)}
              className="rounded-xs bg-[#2962FF] px-2 py-0.5 text-white"
            >
              {isPlaying ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              onClick={() => stepM5(1)}
              className="rounded-xs bg-[#1A2333] px-1.5 py-0.5 text-white"
            >
              +5m
            </button>
            <button
              type="button"
              onClick={() => stepM5(6)}
              className="rounded-xs bg-[#1A2333] px-1.5 py-0.5 text-[#ABAEB8]"
            >
              <SkipForward className="h-3 w-3" />
            </button>
          </div>
        </footer>
      )}

      <DataLoaderModal
        open={csvModalOpen}
        onClose={() => setCsvModalOpen(false)}
        onLoadedDataset={(ds) => {
          applyDataset(ds);
          flashToast(`Loaded ${ds.title}`);
        }}
      />
    </div>
  );
}
