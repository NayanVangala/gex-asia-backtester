"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Database,
  FastForward,
  Flame,
  Layers,
  Pause,
  Play,
  RefreshCw,
  SkipForward,
  Upload,
} from "lucide-react";
import {
  KeyLevelZone,
  PremarketPlan,
  ScenarioNumber,
  SessionDataset,
  SimPosition,
  SimRepLog,
} from "@/lib/types";
import { formatPTTime } from "@/lib/goldMath";
import {
  computeAllSessionProfiles,
  computeSessionVwap,
} from "@/lib/volumeProfile";
import { buildFootprintsFromTicks } from "@/lib/footprint";
import { loadJournalReps, saveJournalReps } from "@/lib/journal";
import { CandleProfileChart } from "./charts/CandleProfileChart";
import { FootprintChart } from "./charts/FootprintChart";
import { CvdChart } from "./charts/CvdChart";
import { HeatmapChart } from "./charts/HeatmapChart";
import { PremarketPanel } from "./PremarketPanel";
import { ExecutionSidebar } from "./ExecutionSidebar";
import { JournalView } from "./JournalView";
import { PlaybookView } from "./PlaybookView";
import { DataLoaderModal } from "./DataLoaderModal";

type ActiveTab = "premarket" | "replay" | "journal" | "playbook";
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

export function BacktesterApp() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("replay");
  const [feedPreset, setFeedPreset] = useState<FeedPreset>("paxg");
  const [selectedSessionDate, setSelectedSessionDate] = useState<string>("");
  const [availableSessions, setAvailableSessions] = useState<string[]>([]);
  const [dataset, setDataset] = useState<SessionDataset | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Replay clock (strictly hides all future candles/ticks/profiles > replayTs)
  const [replayTs, setReplayTs] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playSpeedMs, setPlaySpeedMs] = useState<number>(700);

  // Chart tools & toggles
  const [showHeatmap, setShowHeatmap] = useState<boolean>(false); // OFF by default per user request
  const [footprintMode, setFootprintMode] = useState<"bid_ask" | "delta">(
    "bid_ask"
  );
  const [fpStep, setFpStep] = useState<number>(0.5);
  const [profileDisplayMode, setProfileDisplayMode] = useState<
    "developing" | "pd" | "composite" | "pw"
  >("developing");
  const [drawZoneMode, setDrawZoneMode] = useState<boolean>(false);
  const [customZones, setCustomZones] = useState<KeyLevelZone[]>([]);
  const [pinnedZoneIds, setPinnedZoneIds] = useState<Set<string>>(new Set());
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  const [hoverTs, setHoverTs] = useState<number | null>(null);
  const [csvModalOpen, setCsvModalOpen] = useState<boolean>(false);

  // Plan, Positions, Account & Sim Rep Journal
  const [plan, setPlan] = useState<PremarketPlan>(() => DEFAULT_PLAN(""));
  const [accountBalance, setAccountBalance] = useState<number>(300);
  const [positions, setPositions] = useState<SimPosition[]>([]);
  const [reps, setReps] = useState<SimRepLog[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    setReps(loadJournalReps());
  }, []);

  const flashToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg((cur) => (cur === msg ? null : cur)), 3800);
  }, []);

  const applyDataset = useCallback((ds: SessionDataset) => {
    setDataset(ds);
    setSelectedSessionDate(ds.sessionDate);
    setPlan(DEFAULT_PLAN(ds.sessionDate));
    setPositions([]);
    setCustomZones([]);
    setPinnedZoneIds(new Set());
    setIsPlaying(false);

    // Position replay cleanly at ~35 minutes into Tokyo open (or first available bar near asiaOpenTs)
    const targetStart = ds.asiaOpenTs + 35 * 60_000;
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
        const qs = sessionDate ? `?sessionDate=${encodeURIComponent(sessionDate)}` : "";
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

  // Initial load: real Kraken PAXG/USD tick-by-tick gold tape
  useEffect(() => {
    fetchFeed("paxg");
  }, [fetchFeed]);

  // Strict NO-LOOKAHEAD filtered views up to replayTs
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

  // Profiles strictly up to replayTs
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

  // Combine auto-detected zones + custom drawn zones + pin state
  const allZones = useMemo(() => {
    const merged = [...profiles.autoZones, ...customZones].map((z) => ({
      ...z,
      pinned: pinnedZoneIds.has(z.id) || z.kind === "stacked" || z.kind === "custom",
    }));
    // Keep zones reasonably near current price first
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

  // Real Footprint & Big Trades strictly from real visible ticks
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
    });
  }, [dataset, visibleTicks, fpStep]);

  const vwapM5 = useMemo(() => computeSessionVwap(visibleM5), [visibleM5]);
  const vwapM1 = useMemo(() => computeSessionVwap(visibleM1), [visibleM1]);

  // Journal helpers
  const persistRep = useCallback(
    (rep: SimRepLog) => {
      setReps((prev) => {
        const next = [rep, ...prev];
        saveJournalReps(next);
        return next;
      });
      flashToast(`Logged rep to Sim Rep Journal (${rep.model === "no_trade" ? "No Trade" : `${rep.outcomeR >= 0 ? "+" : ""}${rep.outcomeR}R`})`);
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

  // Close position helper + auto-log to Sim Rep Journal
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

          // Automatically record to Sim Rep Journal so zero reps are lost
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

  // Check Stop / T1 / T2 hits whenever replay steps forward to a new bar
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
        flashToast(`T1 (${openPos.t1PriceExec.toFixed(2)}) reached! Consider moving stop to BE.`);
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
        flashToast(`T1 (${openPos.t1PriceExec.toFixed(2)}) reached! Consider moving stop to BE.`);
      }
    }
  }, [replayTs, positions, visibleM5, closePosition, flashToast]);

  // Replay stepping helpers
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
        flashToast(`Level touch at ${hitZone.label} (${formatPTTime(nextBar.ts)} PT)`);
      }
    } else {
      flashToast("No further level touches in this Asia session.");
    }
  }, [dataset, allZones, replayTs, flashToast]);

  // Playback timer
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => stepM5(1), playSpeedMs);
    return () => clearInterval(id);
  }, [isPlaying, playSpeedMs, stepM5]);

  // Keyboard shortcuts
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
      maxTs: slice[slice.length - 1]?.ts ?? dataset.m5Candles[dataset.m5Candles.length - 1].ts,
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
    setCustomZones((prev) => [...prev, newZone]);
    setActiveZoneId(newZone.id);
    setDrawZoneMode(false);
    flashToast(`Marked custom zone ${low.toFixed(2)} - ${high.toFixed(2)}`);
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#07090e] text-slate-100">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-2 border-b border-[#1c2436] bg-[#0a0e17]/95 px-3 py-2 backdrop-blur-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/15 border border-amber-500/40 font-mono-num text-xs font-bold text-amber-300">
              GX
            </div>
            <div>
              <div className="text-xs font-bold tracking-wider text-slate-100">
                GEX ASIA TERMINAL
              </div>
              <div className="text-[10px] text-slate-400">
                Asia Value Model · GC Read / 1OZ Exec
              </div>
            </div>
          </div>

          {/* Primary Navigation Tabs */}
          <nav className="ml-2 flex items-center gap-1 rounded-lg border border-[#1c2436] bg-[#070a11] p-0.5 text-xs">
            {(
              [
                { id: "premarket", label: "1. Premarket (H1/M30)", icon: Layers },
                { id: "replay", label: "2. Asia Replay", icon: Activity },
                {
                  id: "journal",
                  label: `3. Sim Journal (${reps.filter((r) => !r.isSample).length})`,
                  icon: ClipboardList,
                },
                { id: "playbook", label: "Playbook", icon: BookOpen },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                  activeTab === id
                    ? "bg-[#172136] text-sky-300 shadow-xs"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Right Controls: Feed Switcher, Session Date, Heatmap Toggle, Upload */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center rounded-md border border-[#1c2436] bg-[#070a11] p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => {
                setFeedPreset("paxg");
                fetchFeed("paxg");
              }}
              className={`rounded px-2 py-1 font-medium transition ${
                feedPreset === "paxg" && dataset?.dataSource === "paxg_ticks"
                  ? "bg-emerald-600/25 text-emerald-300"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              PAXG Real Tape
            </button>
            <button
              type="button"
              onClick={() => {
                setFeedPreset("gc");
                fetchFeed("gc");
              }}
              className={`rounded px-2 py-1 font-medium transition ${
                feedPreset === "gc" && dataset?.dataSource === "gc_ohlcv"
                  ? "bg-amber-600/25 text-amber-300"
                  : "text-slate-400 hover:text-slate-200"
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
              className="rounded border border-[#26324a] bg-[#0c121e] px-2 py-1 font-mono-num text-[11px] text-slate-200"
              title="Select past Asia session date (PT)"
            >
              {availableSessions.map((d) => (
                <option key={d} value={d}>
                  Asia {d}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={() => setCsvModalOpen(true)}
            className="flex items-center gap-1 rounded border border-[#26324a] bg-[#101829] px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-[#19253d]"
          >
            <Upload className="h-3.5 w-3.5 text-sky-400" />
            Databento / CSV
          </button>

          <button
            type="button"
            onClick={() => setShowHeatmap((v) => !v)}
            className={`flex items-center gap-1 rounded border px-2.5 py-1 text-[11px] font-medium transition ${
              showHeatmap
                ? "border-orange-500/50 bg-orange-500/15 text-orange-300"
                : "border-[#1c2436] bg-[#0c111b] text-slate-400 hover:text-slate-200"
            }`}
            title="Optional L2 Heatmap panel (off by default)"
          >
            <Flame className="h-3.5 w-3.5" />
            Heatmap {showHeatmap ? "ON" : "OFF"}
          </button>
        </div>
      </header>

      {/* Data Provenance & Capability Strip (Always honest about feed source & limits) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#141c2c] bg-[#090d15] px-3 py-1 text-[11px]">
        <div className="flex flex-wrap items-center gap-2">
          <Database className="h-3.5 w-3.5 text-slate-500" />
          {loading ? (
            <span className="flex items-center gap-1.5 text-sky-300">
              <RefreshCw className="h-3 w-3 animate-spin" /> Loading real historical gold session...
            </span>
          ) : dataset ? (
            <>
              <span className="font-medium text-slate-200">
                {dataset.capabilities.sourceLabel}
              </span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                  dataset.capabilities.hasRealAggressorTape
                    ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                    : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                }`}
              >
                {dataset.capabilities.hasRealAggressorTape
                  ? "REAL BID/ASK TAPE"
                  : "OHLCV ONLY"}
              </span>
              {dataset.capabilities.hasRealL2Depth && (
                <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300 border border-sky-500/30">
                  REAL L2 BOOK
                </span>
              )}
              {dataset.capabilities.caveat && (
                <span className="hidden xl:inline text-slate-400 truncate max-w-2xl">
                  · {dataset.capabilities.caveat}
                </span>
              )}
            </>
          ) : (
            <span className="text-rose-400">{loadError ?? "No dataset loaded"}</span>
          )}
        </div>
        {dataset && (
          <div className="flex items-center gap-3 font-mono-num text-slate-300">
            <span>
              Replay Clock:{" "}
              <strong className="text-sky-300">
                {formatPTTime(replayTs, true)} PT
              </strong>
            </span>
            <span>
              Last:{" "}
              <strong className="text-amber-300">
                ${currentPrice.toFixed(2)}
              </strong>
            </span>
          </div>
        )}
      </div>

      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-16 right-4 z-50 rounded-lg border border-sky-500/50 bg-[#0e1729] px-3.5 py-2 text-xs font-medium text-sky-200 shadow-xl">
          {toastMsg}
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1">
        {loadError && !dataset && (
          <div className="mx-auto mt-10 max-w-lg rounded-lg border border-rose-500/40 bg-rose-500/10 p-5 text-center text-xs">
            <div className="font-semibold text-rose-300">
              Could not fetch market feed
            </div>
            <p className="mt-1 text-slate-300">{loadError}</p>
            <div className="mt-3 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => fetchFeed(feedPreset)}
                className="rounded bg-sky-600 px-3 py-1.5 text-white hover:bg-sky-500"
              >
                Retry Live Fetch
              </button>
              <button
                type="button"
                onClick={() => setCsvModalOpen(true)}
                className="rounded border border-slate-600 px-3 py-1.5 text-slate-200"
              >
                Upload CSV File
              </button>
            </div>
          </div>
        )}

        {dataset && activeTab === "premarket" && (
          <div className="grid grid-cols-1 gap-3 p-3 xl:grid-cols-12">
            <div className="space-y-3 xl:col-span-8">
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400">Right Profile Overlay:</span>
                  {(
                    [
                      { id: "pd", label: "Prev Day (PD)" },
                      { id: "pw", label: "Prev Week (PW)" },
                      { id: "composite", label: "5D Composite" },
                      { id: "developing", label: "Developing" },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setProfileDisplayMode(m.id)}
                      className={`rounded px-2 py-1 text-[11px] border ${
                        profileDisplayMode === m.id
                          ? "bg-amber-500/20 border-amber-500/50 text-amber-300"
                          : "bg-[#0c1018] border-[#1c2436] text-slate-400"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-slate-500">
                  Press <kbd className="rounded bg-slate-800 px-1 text-slate-300">Z</kbd> to draw custom zone
                </span>
              </div>

              <CandleProfileChart
                title="H1 Bias & Multi-Day Volume Profile"
                subtitle={`${dataset.instrument} · Strict premarket cutoff ${formatPTTime(replayTs, true)} PT`}
                candles={visibleH1}
                profiles={profiles}
                activeProfileMode={profileDisplayMode}
                nakedPocs={profiles.nakedPocs}
                zones={allZones}
                activeZoneId={activeZoneId}
                onSelectZone={setActiveZoneId}
                drawZoneMode={drawZoneMode}
                onDrawZoneComplete={handleDrawZoneComplete}
                heightClass="h-[340px]"
                defaultVisibleBars={96}
              />

              <CandleProfileChart
                title="M30 Structure & Stacked Value Zones"
                subtitle="Mark 2-3 untested levels before Tokyo open (4:00 PM PT)"
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
                heightClass="h-[300px]"
                defaultVisibleBars={80}
              />
            </div>

            <div className="xl:col-span-4">
              <PremarketPanel
                plan={plan}
                onChangePlan={setPlan}
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
                  setCustomZones((prev) => prev.filter((z) => z.id !== id))
                }
                drawZoneMode={drawZoneMode}
                onToggleDrawZone={() => setDrawZoneMode((v) => !v)}
                onJumpToReplay={() => setActiveTab("replay")}
              />
            </div>
          </div>
        )}

        {dataset && activeTab === "replay" && (
          <div className="grid grid-cols-1 gap-3 p-3 pb-20 xl:grid-cols-12">
            {/* Charts Grid (9 cols) */}
            <div className="space-y-3 xl:col-span-9">
              {/* Row 1: M5 Candles + Profile (left) AND M5 Footprint Bid x Ask / Delta (right) */}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] px-0.5">
                    <div className="flex items-center gap-1">
                      {(["developing", "pd", "composite", "pw"] as const).map(
                        (m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setProfileDisplayMode(m)}
                            className={`rounded px-1.5 py-0.5 text-[10px] uppercase border ${
                              profileDisplayMode === m
                                ? "bg-sky-500/20 border-sky-500/50 text-sky-300"
                                : "bg-[#0c1018] border-[#1c2436] text-slate-400"
                            }`}
                          >
                            {m}
                          </button>
                        )
                      )}
                      <button
                        type="button"
                        onClick={() => setDrawZoneMode((d) => !d)}
                        className={`ml-1 rounded px-1.5 py-0.5 text-[10px] border ${
                          drawZoneMode
                            ? "bg-teal-500/20 border-teal-400 text-teal-200"
                            : "bg-[#0c1018] border-[#1c2436] text-slate-400"
                        }`}
                      >
                        {drawZoneMode ? "Drawing..." : "+ Zone (Z)"}
                      </button>
                    </div>
                    {dataset.capabilities.hasRealAggressorTape && (
                      <span className="font-mono-num text-[10px] text-slate-400">
                        Asia BigTrades ≥ {footprintSuite.calibratedLargeThreshold}
                      </span>
                    )}
                  </div>

                  <CandleProfileChart
                    title="M5 Setup Chart + Profile + VWAP + BigTrades"
                    candles={visibleM5}
                    vwapSeries={vwapM5}
                    profiles={profiles}
                    activeProfileMode={profileDisplayMode}
                    nakedPocs={profiles.nakedPocs}
                    zones={allZones}
                    activeZoneId={activeZoneId}
                    bigTrades={footprintSuite.allBigTrades}
                    positions={positions}
                    asiaOpenTs={dataset.asiaOpenTs}
                    drawZoneMode={drawZoneMode}
                    onDrawZoneComplete={handleDrawZoneComplete}
                    onSelectZone={setActiveZoneId}
                    hoverTs={hoverTs}
                    onHoverTs={setHoverTs}
                    heightClass="h-[365px]"
                    defaultVisibleBars={60}
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] px-0.5">
                    <span className="text-[10px] text-slate-400">
                      Footprint Row Aggregation:
                    </span>
                    <div className="flex items-center gap-1">
                      {[0.25, 0.5, 1.0, 2.0].map((st) => (
                        <button
                          key={st}
                          type="button"
                          onClick={() => setFpStep(st)}
                          className={`rounded px-1.5 py-0.5 font-mono-num text-[10px] border ${
                            fpStep === st
                              ? "bg-amber-500/20 border-amber-500/50 text-amber-300"
                              : "bg-[#0c1018] border-[#1c2436] text-slate-400"
                          }`}
                        >
                          ${st.toFixed(2)}
                        </button>
                      ))}
                    </div>
                  </div>
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
                    heightClass="h-[365px]"
                  />
                </div>
              </div>

              {/* Row 2: M1 1OZ Execution Chart + CVD Pane */}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <CandleProfileChart
                  title="M1 Execution Timing (1OZ $0.25 Grid)"
                  subtitle={
                    visibleM1.length > 0
                      ? "First valid pullback entry timing"
                      : "M1 unavailable for dates > 5d old on GC=F; showing M5"
                  }
                  candles={visibleM1.length > 0 ? visibleM1 : visibleM5}
                  vwapSeries={visibleM1.length > 0 ? vwapM1 : vwapM5}
                  zones={allZones}
                  activeZoneId={activeZoneId}
                  positions={positions}
                  onSelectZone={setActiveZoneId}
                  show1OZGrid
                  hoverTs={hoverTs}
                  onHoverTs={setHoverTs}
                  heightClass="h-[225px]"
                  defaultVisibleBars={65}
                />

                <div className="flex flex-col gap-3">
                  <CvdChart
                    bars={footprintSuite.bars}
                    hasRealAggressorTape={dataset.capabilities.hasRealAggressorTape}
                    heightClass="h-[225px]"
                  />
                </div>
              </div>

              {/* Row 3 (Optional): L2 Depth Heatmap — OFF by default */}
              {showHeatmap && (
                <HeatmapChart
                  l2Snapshots={visibleL2}
                  ticks={visibleTicks}
                  onOpenCsvModal={() => setCsvModalOpen(true)}
                  heightClass="h-[250px]"
                />
              )}
            </div>

            {/* Right Dock: Execution, Guardrails & Position Manager (3 cols) */}
            <div className="xl:col-span-3">
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
                accountBalance={accountBalance}
                onAccountBalanceChange={setAccountBalance}
                onOpenPosition={(pos) => {
                  setPositions((prev) => [...prev, pos]);
                  flashToast(
                    `Filled ${pos.side.toUpperCase()} ${pos.contracts}× ${pos.contract} @ ${pos.entryPriceExec.toFixed(2)}`
                  );
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

      {/* Sticky Bottom Replay Transport Bar */}
      {dataset && (activeTab === "replay" || activeTab === "premarket") && (
        <footer className="fixed bottom-0 left-0 right-0 z-30 flex flex-wrap items-center justify-between gap-2 border-t border-[#1c2436] bg-[#0a0e17]/95 px-3 py-2 text-xs backdrop-blur-xs">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setReplayTs(dataset.asiaOpenTs)}
              className="rounded border border-[#26324a] bg-[#111827] px-2 py-1 text-[11px] text-slate-300 hover:bg-[#1a243b]"
              title="Jump to Tokyo Open (4:00 PM PT)"
            >
              Tokyo 16:00 PT
            </button>
            <button
              type="button"
              onClick={() => setReplayTs(dataset.asiaOpenTs + 3600_000)}
              className="hidden sm:inline-flex rounded border border-[#26324a] bg-[#111827] px-2 py-1 text-[11px] text-slate-300 hover:bg-[#1a243b]"
              title="Jump to China / SGE Open (5:00 PM PT)"
            >
              China 17:00 PT
            </button>
            <button
              type="button"
              onClick={jumpToNextLevelTouch}
              className="flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/25"
              title="Skip dead mid-value chop and jump to next bar touching a key zone"
            >
              <FastForward className="h-3.5 w-3.5" /> Next Level Touch
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => stepM5(-1)}
              className="rounded border border-[#26324a] bg-[#111827] p-1.5 text-slate-300 hover:bg-[#1a243b]"
              title="Step back 1 M5 bar (Left Arrow)"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setIsPlaying((p) => !p)}
              className={`flex items-center gap-1 rounded px-3 py-1.5 text-xs font-semibold text-white ${
                isPlaying
                  ? "bg-amber-600 hover:bg-amber-500"
                  : "bg-sky-600 hover:bg-sky-500"
              }`}
              title="Play / Pause (Space)"
            >
              {isPlaying ? (
                <>
                  <Pause className="h-3.5 w-3.5" /> Pause
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" /> Play
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => stepM1(1)}
              className="rounded border border-[#26324a] bg-[#111827] px-2 py-1 text-[11px] font-mono-num text-slate-200 hover:bg-[#1a243b]"
              title="Step +1 M1 bar (Shift+Right)"
            >
              +1m
            </button>
            <button
              type="button"
              onClick={() => stepM5(1)}
              className="flex items-center gap-0.5 rounded border border-sky-500/40 bg-sky-500/15 px-2.5 py-1 text-[11px] font-mono-num font-semibold text-sky-300 hover:bg-sky-500/25"
              title="Step +1 M5 bar (Right Arrow)"
            >
              +5m <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => stepM5(6)}
              className="hidden md:flex items-center gap-0.5 rounded border border-[#26324a] bg-[#111827] px-2 py-1 text-[11px] font-mono-num text-slate-300 hover:bg-[#1a243b]"
              title="Step +30 min (6 M5 bars)"
            >
              +30m <SkipForward className="h-3 w-3" />
            </button>

            <select
              value={playSpeedMs}
              onChange={(e) => setPlaySpeedMs(Number(e.target.value))}
              className="ml-1 rounded border border-[#26324a] bg-[#111827] px-1.5 py-1 font-mono-num text-[11px] text-slate-300"
            >
              <option value={1200}>0.5×</option>
              <option value={700}>1×</option>
              <option value={350}>2×</option>
              <option value={150}>5×</option>
            </select>
          </div>

          <div className="flex items-center gap-3 min-w-[200px] flex-1 max-w-md">
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
              className="w-full accent-sky-400 cursor-pointer"
            />
            <span className="shrink-0 font-mono-num text-[11px] text-slate-400">
              {asiaBarsRange.currentIdx}/{asiaBarsRange.total} ·{" "}
              <strong className="text-slate-200">{formatPTTime(replayTs)} PT</strong>
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
