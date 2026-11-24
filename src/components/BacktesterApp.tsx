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
  Flame,
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
import {
  CandleProfileChart,
  PricePickTarget,
} from "./charts/CandleProfileChart";
import { FootprintChart } from "./charts/FootprintChart";
import { CvdChart } from "./charts/CvdChart";
import { HeatmapChart } from "./charts/HeatmapChart";
import { PremarketPanel } from "./PremarketPanel";
import { ExecutionSidebar } from "./ExecutionSidebar";
import { JournalView } from "./JournalView";
import { PlaybookView } from "./PlaybookView";
import { DataLoaderModal } from "./DataLoaderModal";
import { TapePanel } from "./TapePanel";
import { DrillModeCard } from "./DrillModeCard";

type ActiveTab = "premarket" | "replay" | "journal" | "playbook";
type FeedPreset = "paxg" | "gc";
type ReplayLayout = "standard" | "dual_fp" | "tape_focus";

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

export function BacktesterApp() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("replay");
  const [feedPreset, setFeedPreset] = useState<FeedPreset>("paxg");
  const [selectedSessionDate, setSelectedSessionDate] = useState<string>("");
  const [availableSessions, setAvailableSessions] = useState<string[]>([]);
  const [dataset, setDataset] = useState<SessionDataset | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [replayTs, setReplayTs] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playSpeedMs, setPlaySpeedMs] = useState<number>(700);

  // Clean workspace menu & chart state
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState<boolean>(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [replayLayout, setReplayLayout] = useState<ReplayLayout>("standard");
  const [showHeatmap, setShowHeatmap] = useState<boolean>(false);
  const [showTape, setShowTape] = useState<boolean>(false); // Clean 4-pane by default; toggle in Workspace menu
  const [drillMode, setDrillMode] = useState<boolean>(false);
  const [blindDate, setBlindDate] = useState<boolean>(false);
  const [footprintMode, setFootprintMode] = useState<"bid_ask" | "delta">(
    "bid_ask"
  );
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

  // Close workspace popover on outside click
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setWorkspaceMenuOpen(false);
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
        if (!res.ok) {
          throw new Error(json.error || `Failed to load ${preset}`);
        }
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
        if (dataset?.sessionDate) {
          saveCustomZonesForSession(dataset.sessionDate, next);
        }
        return next;
      });
    },
    [dataset?.sessionDate]
  );

  // Strict NO-LOOKAHEAD views up to replayTs
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
    if (!activeZoneId && allZones.length > 0) {
      setActiveZoneId(allZones[0].id);
    }
  }, [activeZoneId, allZones]);

  const activeZone = useMemo(
    () => allZones.find((z) => z.id === activeZoneId) ?? allZones[0] ?? null,
    [allZones, activeZoneId]
  );

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
      imbalanceRatio: 3.0,
      bigTradeLargeThreshold: customBigLarge ?? undefined,
      bigTradeWhaleThreshold: customBigWhale ?? undefined,
    });
  }, [dataset, visibleTicks, fpStep, customBigLarge, customBigWhale]);

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

  // Pending Order evaluation on each bar step
  useEffect(() => {
    if (pendingOrders.length === 0 || visibleM5.length === 0) return;
    const latestBar = visibleM5[visibleM5.length - 1];
    const hasOpenPos = positions.some((p) => p.status === "open");

    for (const ord of pendingOrders) {
      const ev = evaluatePendingOrderOnBar(ord, latestBar);
      if (ev.action === "cancelled_invalidated") {
        setPendingOrders((prev) => prev.filter((o) => o.id !== ord.id));
        setIsPlaying(false);
        flashToast(ev.reason ?? "Working order auto-cancelled on invalidation.");
        break;
      }
      if (ev.action === "filled" && !hasOpenPos && ev.fillPriceExec !== undefined) {
        setPendingOrders((prev) => prev.filter((o) => o.id !== ord.id));
        const filledPos: SimPosition = {
          id: `pos-${Date.now()}`,
          side: ord.side,
          orderType: ord.orderType,
          triggerPriceExec: ord.triggerPriceExec,
          slippagePts: ev.slippagePts ?? 0,
          model: ord.model,
          scenario: ord.scenario,
          setupTag: ord.setupTag,
          contract: ord.contract,
          entryPriceGC: ev.fillPriceExec,
          entryPriceExec: ev.fillPriceExec,
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
        };
        setPositions((prev) => [...prev, filledPos]);
        setIsPlaying(false);
        flashToast(ev.reason ?? `Filled @ ${ev.fillPriceExec.toFixed(2)}`);
        break;
      }
    }
  }, [replayTs, pendingOrders, positions, visibleM5, flashToast]);

  // Open Position Stop / T1 / T2 hits
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
        flashToast(`T1 (${openPos.t1PriceExec.toFixed(2)}) hit — consider BE.`);
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
        flashToast(`T1 (${openPos.t1PriceExec.toFixed(2)}) hit — consider BE.`);
      }
    }
  }, [replayTs, positions, visibleM5, closePosition, flashToast]);

  // Auto-grade Blind Drill calls
  useEffect(() => {
    const hasUngraded = drillCalls.some((c) => !c.graded);
    if (!hasUngraded || visibleM5.length === 0) return;
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
    if (changed) {
      setDrillCalls(next);
      const newest = next.find((c) => c.graded);
      if (newest?.graded) {
        flashToast(
          newest.graded.correct
            ? `Drill Correct: ${newest.graded.actualStatus.toUpperCase()}`
            : `Drill Mismatch: tape showed ${newest.graded.actualStatus.toUpperCase()}`
        );
      }
    }
  }, [replayTs, drillCalls, visibleM5, flashToast]);

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
        flashToast(
          `Touch: ${hitZone.label.replace("STACKED: ", "★ ")} (${formatPTTime(nextBar.ts)} PT)`
        );
      }
    } else {
      flashToast("No further zone touches in this session.");
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
      if (e.code === "Space" && activeTab === "replay") {
        e.preventDefault();
        setIsPlaying((p) => !p);
      } else if (e.key === "ArrowRight" && activeTab === "replay") {
        e.preventDefault();
        if (e.shiftKey) stepM1(1);
        else stepM5(1);
      } else if (e.key === "ArrowLeft" && activeTab === "replay") {
        e.preventDefault();
        stepM5(-1);
      } else if (e.key.toLowerCase() === "z") {
        setDrawZoneMode((d) => !d);
      } else if (e.key === "Escape") {
        setPickPriceMode(null);
        setDrawZoneMode(false);
        setWorkspaceMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTab, stepM1, stepM5]);

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
    flashToast(`Set ${pickPriceMode.toUpperCase()} to ${price.toFixed(2)}`);
    setPickPriceMode(null);
  };

  const latestFootprint =
    footprintSuite.bars[footprintSuite.bars.length - 1] ?? null;

  const isWorkstationView = activeTab === "replay" || activeTab === "premarket";

  return (
    <div
      className={`flex flex-col bg-[#0b0d11] text-[#e6e9ef] ${
        isWorkstationView ? "xl:h-screen xl:overflow-hidden min-h-screen" : "min-h-screen"
      }`}
    >
      {/* Single Clean 44px Institutional Top Bar */}
      <header className="sticky top-0 z-40 flex h-11 shrink-0 items-center justify-between gap-3 border-b border-[#1c212b] bg-[#0f1217] px-3">
        <div className="flex items-center gap-5 h-full">
          {/* Minimal Wordmark */}
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#d4a03a]" />
            <span className="text-xs font-semibold tracking-wider text-[#e6e9ef]">
              GEX
            </span>
          </div>

          {/* Borderless Underline Navigation */}
          <nav className="flex items-center gap-1 h-full text-xs">
            {(
              [
                { id: "premarket", label: "Premarket" },
                { id: "replay", label: "Replay" },
                {
                  id: "journal",
                  label: `Journal (${reps.filter((r) => !r.isSample).length})`,
                },
                { id: "playbook", label: "Playbook" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`h-full px-2.5 text-[12px] font-medium transition border-b-2 ${
                  activeTab === t.id
                    ? "border-[#e6e9ef] text-[#e6e9ef]"
                    : "border-transparent text-[#7d8594] hover:text-[#c8cfdc]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {/* Compact Live Ticker Readout */}
          {dataset && (
            <div
              className="hidden lg:flex items-center gap-2.5 border-l border-[#1c212b] pl-4 font-mono-num text-[11px]"
              title={dataset.capabilities.caveat ?? dataset.capabilities.sourceLabel}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  dataset.capabilities.hasRealAggressorTape
                    ? "bg-[#00c087]"
                    : "bg-[#d4a03a]"
                }`}
              />
              <span className="text-[#8b94a5]">
                {dataset.capabilities.hasRealAggressorTape ? "REAL TAPE" : "OHLCV ONLY"}
              </span>
              <span className="font-semibold text-[#e6e9ef]">
                ${currentPrice.toFixed(2)}
              </span>
              <span className="text-[#6e7787]">
                {blindDate
                  ? `${formatPTTime(replayTs)} PT`
                  : `${formatPTTime(replayTs, true)} PT`}
              </span>
            </div>
          )}
          {loading && (
            <span className="flex items-center gap-1.5 text-[11px] text-[#8b94a5]">
              <RefreshCw className="h-3 w-3 animate-spin" /> Loading
            </span>
          )}
        </div>

        {/* Right Controls: Clean Feed Switcher + Session Picker + Single Tools Popover */}
        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center rounded bg-[#151922] p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => {
                setFeedPreset("paxg");
                fetchFeed("paxg");
              }}
              className={`rounded-xs px-2 py-0.5 font-medium transition ${
                feedPreset === "paxg" && dataset?.dataSource === "paxg_ticks"
                  ? "bg-[#252c3a] text-[#e6e9ef]"
                  : "text-[#7d8594] hover:text-[#c8cfdc]"
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
              className={`rounded-xs px-2 py-0.5 font-medium transition ${
                feedPreset === "gc" && dataset?.dataSource === "gc_ohlcv"
                  ? "bg-[#252c3a] text-[#e6e9ef]"
                  : "text-[#7d8594] hover:text-[#c8cfdc]"
              }`}
            >
              COMEX GC=F
            </button>
          </div>

          {availableSessions.length > 0 && (
            <select
              value={selectedSessionDate}
              onChange={(e) => {
                setSelectedSessionDate(e.target.value);
                fetchFeed(feedPreset, e.target.value);
              }}
              className="rounded border border-[#222836] bg-[#151922] px-2 py-1 font-mono-num text-[11px] text-[#e6e9ef] focus:outline-none"
            >
              {availableSessions.map((d, idx) => (
                <option key={d} value={d}>
                  {blindDate ? `Blind Session #${idx + 1}` : d}
                </option>
              ))}
            </select>
          )}

          {/* Clean Workspace Popover (replaces 10 noisy topbar buttons) */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setWorkspaceMenuOpen((o) => !o)}
              className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-[11px] font-medium transition ${
                workspaceMenuOpen
                  ? "border-[#384257] bg-[#1d2330] text-[#e6e9ef]"
                  : "border-[#222836] bg-[#151922] text-[#c8cfdc] hover:bg-[#1b212e]"
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Workspace
              <ChevronDown className="h-3 w-3 text-[#7d8594]" />
            </button>

            {workspaceMenuOpen && (
              <div className="absolute right-0 mt-1.5 w-64 rounded-md border border-[#262d3b] bg-[#12161f] p-3 shadow-2xl space-y-3 text-[11px] z-50">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#6e7787] mb-1.5">
                    Chart Layout
                  </div>
                  <div className="grid grid-cols-1 gap-1">
                    {(
                      [
                        { id: "standard", label: "Standard (M5 · FP · M1 · CVD)" },
                        { id: "dual_fp", label: "Dual Footprint (Bid×Ask + Delta)" },
                        { id: "tape_focus", label: "Full-Width Footprint Study" },
                      ] as const
                    ).map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => setReplayLayout(l.id)}
                        className={`rounded px-2 py-1 text-left transition ${
                          replayLayout === l.id
                            ? "bg-[#252c3a] text-[#e6e9ef] font-medium"
                            : "text-[#8b94a5] hover:bg-[#191f2b]"
                        }`}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-[#1e2432] pt-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-[#6e7787] mb-1.5">
                    Footprint Row Step
                  </div>
                  <div className="grid grid-cols-4 gap-1 font-mono-num">
                    {[0.25, 0.5, 1.0, 2.0].map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setFpStep(st)}
                        className={`rounded py-1 text-[10px] ${
                          fpStep === st
                            ? "bg-[#252c3a] text-[#e6e9ef] font-semibold"
                            : "bg-[#171c26] text-[#7d8594]"
                        }`}
                      >
                        ${st.toFixed(2)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-[#1e2432] pt-2.5 space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-[#6e7787] mb-1">
                    Panels &amp; Practice Modes
                  </div>
                  <button
                    type="button"
                    onClick={() => setDrillMode((v) => !v)}
                    className="flex w-full items-center justify-between rounded px-2 py-1 hover:bg-[#191f2b]"
                  >
                    <span className="flex items-center gap-1.5 text-[#c8cfdc]">
                      <Crosshair className="h-3.5 w-3.5 text-[#d4a03a]" /> Blind Drill Mode
                    </span>
                    <span className={drillMode ? "text-[#00c087] font-semibold" : "text-[#586070]"}>
                      {drillMode ? "ON" : "OFF"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBlindDate((v) => !v)}
                    className="flex w-full items-center justify-between rounded px-2 py-1 hover:bg-[#191f2b]"
                  >
                    <span className="flex items-center gap-1.5 text-[#c8cfdc]">
                      {blindDate ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} Hide Session Date
                    </span>
                    <span className={blindDate ? "text-[#00c087] font-semibold" : "text-[#586070]"}>
                      {blindDate ? "ON" : "OFF"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowTape((v) => !v)}
                    className="flex w-full items-center justify-between rounded px-2 py-1 hover:bg-[#191f2b]"
                  >
                    <span className="text-[#c8cfdc]">Time &amp; Sales Tape</span>
                    <span className={showTape ? "text-[#00c087] font-semibold" : "text-[#586070]"}>
                      {showTape ? "ON" : "OFF"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowHeatmap((v) => !v)}
                    className="flex w-full items-center justify-between rounded px-2 py-1 hover:bg-[#191f2b]"
                  >
                    <span className="flex items-center gap-1.5 text-[#c8cfdc]">
                      <Flame className="h-3.5 w-3.5 text-[#d4a03a]" /> L2 Heatmap (Optional)
                    </span>
                    <span className={showHeatmap ? "text-[#00c087] font-semibold" : "text-[#586070]"}>
                      {showHeatmap ? "ON" : "OFF"}
                    </span>
                  </button>
                </div>

                <div className="border-t border-[#1e2432] pt-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setWorkspaceMenuOpen(false);
                      setCsvModalOpen(true);
                    }}
                    className="flex w-full items-center justify-center gap-1.5 rounded bg-[#e6e9ef] py-1.5 font-semibold text-[#0b0d11] hover:bg-white"
                  >
                    <Upload className="h-3.5 w-3.5" /> Import Databento / CSV
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Subtle Toast */}
      {toastMsg && (
        <div className="fixed bottom-12 right-4 z-50 rounded border border-[#2c3446] bg-[#151a24] px-3 py-1.5 text-[11px] font-medium text-[#e6e9ef] shadow-2xl">
          {toastMsg}
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 min-h-0 flex flex-col">
        {loadError && !dataset && (
          <div className="m-auto max-w-md rounded-md border border-[#2a2024] bg-[#141013] p-5 text-center text-xs">
            <div className="font-semibold text-[#f6465d]">Feed load failed</div>
            <p className="mt-1 text-[#8b94a5]">{loadError}</p>
            <div className="mt-3 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => fetchFeed(feedPreset)}
                className="rounded bg-[#e6e9ef] px-3 py-1.5 font-medium text-[#0b0d11]"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => setCsvModalOpen(true)}
                className="rounded border border-[#2a3140] px-3 py-1.5 text-[#c8cfdc]"
              >
                Import CSV
              </button>
            </div>
          </div>
        )}

        {/* 1. PREMARKET WORKSPACE */}
        {dataset && activeTab === "premarket" && (
          <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[1fr_340px]">
            <div className="flex flex-col min-h-0 divide-y divide-[#1c212b] border-r border-[#1c212b]">
              <div className="flex-1 min-h-[280px]">
                <CandleProfileChart
                  title="H1 Bias & Multi-Day Profile"
                  subtitle={dataset.instrument}
                  candles={visibleH1}
                  profiles={profiles}
                  activeProfileMode={profileDisplayMode}
                  nakedPocs={profiles.nakedPocs}
                  zones={allZones}
                  activeZoneId={activeZoneId}
                  onSelectZone={setActiveZoneId}
                  drawZoneMode={drawZoneMode}
                  onDrawZoneComplete={handleDrawZoneComplete}
                  defaultVisibleBars={96}
                  headerRight={
                    <div className="flex items-center gap-1 text-[10px]">
                      {(["pd", "pw", "composite", "developing"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setProfileDisplayMode(m)}
                          className={`rounded px-1.5 py-0.5 uppercase ${
                            profileDisplayMode === m
                              ? "bg-[#242b38] text-[#e6e9ef]"
                              : "text-[#6e7787] hover:text-[#b4bccb]"
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  }
                />
              </div>
              <div className="flex-1 min-h-[250px]">
                <CandleProfileChart
                  title="M30 Structure"
                  candles={visibleM30}
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
                onJumpToReplay={() => setActiveTab("replay")}
              />
            </div>
          </div>
        )}

        {/* 2. ASIA REPLAY WORKSPACE (Edge-to-Edge Hairline Pro Grid) */}
        {dataset && activeTab === "replay" && (
          <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[1fr_312px]">
            <div className="flex flex-col min-h-0 border-r border-[#1c212b] overflow-y-auto xl:overflow-hidden">
              {drillMode && (
                <DrillModeCard
                  activeZone={activeZone}
                  replayTs={replayTs}
                  drillCalls={drillCalls}
                  onLockCall={(call) => {
                    setDrillCalls((prev) => [call, ...prev]);
                    flashToast(`Locked Drill Call at ${call.zoneLabel}.`);
                  }}
                  onStep6Bars={() => stepM5(6)}
                />
              )}

              {/* Standard 4-Pane Hairline Grid */}
              {replayLayout === "standard" && (
                <div className="flex-1 min-h-0 flex flex-col divide-y divide-[#1c212b]">
                  <div className="flex-[1.55] min-h-[270px] grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#1c212b]">
                    <CandleProfileChart
                      title="M5 Setup · Profile · VWAP"
                      candles={visibleM5}
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
                      headerRight={
                        <div className="flex items-center gap-1 text-[10px]">
                          {(["developing", "pd", "composite"] as const).map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setProfileDisplayMode(m)}
                              className={`rounded px-1.5 py-0.5 uppercase ${
                                profileDisplayMode === m
                                  ? "bg-[#242b38] text-[#e6e9ef]"
                                  : "text-[#6e7787] hover:text-[#b4bccb]"
                              }`}
                            >
                              {m === "developing" ? "Dev" : m === "composite" ? "5D" : "PD"}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => setDrawZoneMode((d) => !d)}
                            className={`rounded px-1.5 py-0.5 ${
                              drawZoneMode
                                ? "bg-sky-500/20 text-sky-300"
                                : "text-[#6e7787] hover:text-[#e6e9ef]"
                            }`}
                          >
                            +Zone
                          </button>
                        </div>
                      }
                    />

                    <FootprintChart
                      bars={footprintSuite.bars}
                      hasRealAggressorTape={dataset.capabilities.hasRealAggressorTape}
                      zones={allZones}
                      activeZoneId={activeZoneId}
                      priceStep={fpStep}
                      mode={footprintMode}
                      onModeChange={setFootprintMode}
                      onSwitchToPaxg={() => {
                        setFeedPreset("paxg");
                        fetchFeed("paxg");
                      }}
                      onOpenCsvModal={() => setCsvModalOpen(true)}
                    />
                  </div>

                  <div className="flex-1 min-h-[180px] grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#1c212b]">
                    <CandleProfileChart
                      title="M1 Execution (1OZ $0.25)"
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
                    />

                    <CvdChart
                      bars={footprintSuite.bars}
                      hasRealAggressorTape={dataset.capabilities.hasRealAggressorTape}
                    />
                  </div>
                </div>
              )}

              {/* Dual Footprint Layout (ATAS Template) */}
              {replayLayout === "dual_fp" && (
                <div className="flex-1 min-h-0 flex flex-col divide-y divide-[#1c212b]">
                  <div className="flex-1 min-h-[220px]">
                    <CandleProfileChart
                      title="M5 Setup · Profile · VWAP"
                      candles={visibleM5}
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
                      defaultVisibleBars={75}
                    />
                  </div>
                  <div className="flex-[1.35] min-h-[260px] grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#1c212b]">
                    <FootprintChart
                      title="M5 Footprint (Bid × Ask)"
                      bars={footprintSuite.bars}
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
                    <FootprintChart
                      title="M5 Delta Clusters"
                      bars={footprintSuite.bars}
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
                  </div>
                </div>
              )}

              {/* Full-Width Footprint Focus */}
              {replayLayout === "tape_focus" && (
                <div className="flex-1 min-h-0 flex flex-col divide-y divide-[#1c212b]">
                  <div className="flex-[1.6] min-h-[300px]">
                    <FootprintChart
                      title="M5 Footprint · Full Width"
                      bars={footprintSuite.bars}
                      hasRealAggressorTape={dataset.capabilities.hasRealAggressorTape}
                      zones={allZones}
                      activeZoneId={activeZoneId}
                      priceStep={fpStep}
                      mode={footprintMode}
                      onModeChange={setFootprintMode}
                      onSwitchToPaxg={() => {
                        setFeedPreset("paxg");
                        fetchFeed("paxg");
                      }}
                      onOpenCsvModal={() => setCsvModalOpen(true)}
                      defaultVisibleBars={14}
                    />
                  </div>
                  <div className="flex-1 min-h-[180px] grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#1c212b]">
                    <CandleProfileChart
                      title="M5 Setup · Profile"
                      candles={visibleM5}
                      vwapSeries={vwapM5}
                      profiles={profiles}
                      activeProfileMode={profileDisplayMode}
                      zones={allZones}
                      activeZoneId={activeZoneId}
                      bigTrades={footprintSuite.allBigTrades}
                      positions={positions}
                      pendingOrders={pendingOrders}
                      pickPriceMode={pickPriceMode}
                      onSelectZone={setActiveZoneId}
                      onClickPrice={handleChartPricePick}
                      defaultVisibleBars={50}
                    />
                    <CvdChart
                      bars={footprintSuite.bars}
                      hasRealAggressorTape={dataset.capabilities.hasRealAggressorTape}
                    />
                  </div>
                </div>
              )}

              {showTape && (
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

              {showHeatmap && (
                <HeatmapChart
                  l2Snapshots={visibleL2}
                  ticks={visibleTicks}
                  onOpenCsvModal={() => setCsvModalOpen(true)}
                  heightClass="h-[210px]"
                />
              )}
            </div>

            {/* Right Rail (Fixed 312px) */}
            <div className="min-h-0 overflow-hidden">
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
                  flashToast(
                    `Filled ${pos.side.toUpperCase()} ${pos.contracts}× ${pos.contract} @ ${pos.entryPriceExec.toFixed(2)}`
                  );
                }}
                onPlacePendingOrder={(ord) => {
                  setPendingOrders([ord]);
                  flashToast(
                    `Working ${ord.side.toUpperCase()} ${ord.orderType.toUpperCase()} @ ${ord.triggerPriceExec.toFixed(2)}`
                  );
                }}
                onCancelPendingOrder={(id) => {
                  setPendingOrders((prev) => prev.filter((o) => o.id !== id));
                  flashToast("Working order cancelled.");
                }}
                onClosePosition={closePosition}
                onMoveStopToBE={(id) => {
                  setPositions((prev) =>
                    prev.map((p) =>
                      p.id === id
                        ? {
                            ...p,
                            stopPriceExec: p.entryPriceExec,
                            movedToBreakeven: true,
                          }
                        : p
                    )
                  );
                  flashToast("Stop moved to breakeven.");
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
          </div>
        )}

        {activeTab === "journal" && (
          <JournalView
            reps={reps}
            onAddRep={persistRep}
            onDeleteRep={deleteRep}
            currentSessionDate={dataset?.sessionDate ?? "2026-11-23"}
            currentInstrument={dataset?.instrument ?? "GC / 1OZ"}
          />
        )}

        {activeTab === "playbook" && <PlaybookView />}
      </main>

      {/* Sleek 40px Docked Replay Transport Bar */}
      {dataset && isWorkstationView && (
        <footer className="flex h-10 shrink-0 items-center justify-between gap-3 border-t border-[#1c212b] bg-[#0f1217] px-3 text-[11px]">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setReplayTs(dataset.asiaOpenTs)}
              className="rounded px-2 py-1 text-[#8b94a5] hover:bg-[#191f2b] hover:text-[#e6e9ef]"
            >
              Tokyo 16:00
            </button>
            <button
              type="button"
              onClick={jumpToNextLevelTouch}
              className="flex items-center gap-1 rounded bg-[#181c26] px-2.5 py-1 font-medium text-[#eab854] hover:bg-[#222836]"
            >
              <FastForward className="h-3 w-3" /> Next Touch
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => stepM5(-1)}
              className="rounded p-1.5 text-[#8b94a5] hover:bg-[#191f2b] hover:text-[#e6e9ef]"
              title="Back 1 M5 bar"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setIsPlaying((p) => !p)}
              className="flex items-center gap-1 rounded bg-[#e6e9ef] px-3 py-1 text-[11px] font-semibold text-[#0b0d11] hover:bg-white"
            >
              {isPlaying ? (
                <>
                  <Pause className="h-3 w-3" /> Pause
                </>
              ) : (
                <>
                  <Play className="h-3 w-3" /> Play
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => stepM1(1)}
              className="rounded px-2 py-1 font-mono-num text-[#8b94a5] hover:bg-[#191f2b] hover:text-[#e6e9ef]"
            >
              +1m
            </button>
            <button
              type="button"
              onClick={() => stepM5(1)}
              className="flex items-center gap-0.5 rounded bg-[#1a202e] px-2 py-1 font-mono-num font-medium text-[#e6e9ef] hover:bg-[#242c3f]"
            >
              +5m <ChevronRight className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => stepM5(6)}
              className="hidden sm:flex items-center gap-0.5 rounded px-2 py-1 font-mono-num text-[#8b94a5] hover:bg-[#191f2b] hover:text-[#e6e9ef]"
            >
              +30m <SkipForward className="h-3 w-3" />
            </button>

            <select
              value={playSpeedMs}
              onChange={(e) => setPlaySpeedMs(Number(e.target.value))}
              className="ml-1 rounded bg-[#151922] px-1.5 py-1 font-mono-num text-[10.5px] text-[#8b94a5] border border-[#222836]"
            >
              <option value={1200}>0.5×</option>
              <option value={700}>1×</option>
              <option value={350}>2×</option>
              <option value={150}>5×</option>
            </select>
          </div>

          <div className="hidden md:flex items-center gap-3 flex-1 max-w-sm">
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
            <span className="shrink-0 font-mono-num text-[10.5px] text-[#7d8594]">
              {asiaBarsRange.currentIdx}/{asiaBarsRange.total} ·{" "}
              <strong className="text-[#e6e9ef]">{formatPTTime(replayTs)} PT</strong>
            </span>
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
