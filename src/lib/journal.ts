import {
  EntryTiming,
  ModelType,
  ScenarioNumber,
  SetupTag,
  SimRepLog,
} from "./types";

const STORAGE_KEY = "gex_asia_sim_rep_journal_v1";

export const SEED_SAMPLE_REP: SimRepLog = {
  id: "seed-test-rep-1",
  createdAt: "2026-10-11T04:15:00.000Z",
  sessionDate: "2026-09-20",
  instrument: "GC / 1OZ",
  dataSource: "gc_ohlcv",
  scenario: 5,
  model: "model1_reversal",
  setupTag: "pd_poc_bounce",
  side: "long",
  entryTiming: "first_valid_pullback",
  contextUsed: {
    h1m30: true,
    m5: true,
    m5Footprint: true,
    m1: true,
  },
  outcomeR: 2.1,
  pnlDollars: 9.45,
  entryPrice: 4393.5,
  stopPrice: 4389.75,
  targetPrice: 4407.0,
  ruleViolations: [],
  note: "TEST REP (deletable) - Stacked PD POC 4392.8 + PW VAH 4390 held, waited for reclaim + first valid pullback.",
  isSample: true,
};

export function loadJournalReps(): SimRepLog[] {
  if (typeof window === "undefined") return [SEED_SAMPLE_REP];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [SEED_SAMPLE_REP];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [SEED_SAMPLE_REP];
    return parsed as SimRepLog[];
  } catch {
    return [SEED_SAMPLE_REP];
  }
}

export function saveJournalReps(reps: SimRepLog[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(reps));
  } catch {
    // ignore quota errors
  }
}

export interface JournalStats {
  totalReps: number;
  tradedReps: number;
  skippedReps: number;
  winRatePct: number;
  totalR: number;
  avgR: number;
  disciplinePct: number;
  firstValidPullbackCount: number;
  firstTouchCount: number;
  earlyCount: number;
  lateChaseCount: number;
  byScenario: Array<{
    scenario: ScenarioNumber;
    count: number;
    wins: number;
    totalR: number;
    avgR: number;
  }>;
  byModel: Record<
    ModelType,
    { count: number; wins: number; totalR: number; avgR: number }
  >;
  bySetup: Array<{
    setupTag: SetupTag;
    count: number;
    totalR: number;
    avgR: number;
  }>;
  repeatedMistakes: Array<{ mistake: string; count: number }>;
}

export function computeJournalStats(reps: SimRepLog[]): JournalStats {
  const realReps = reps.filter((r) => !r.isSample);
  const pool = realReps.length > 0 ? realReps : reps;

  const traded = pool.filter((r) => r.model !== "no_trade" && r.entryTiming !== "skipped");
  const skipped = pool.filter((r) => r.model === "no_trade" || r.entryTiming === "skipped");

  const wins = traded.filter((r) => r.outcomeR > 0);
  const totalR = traded.reduce((s, r) => s + r.outcomeR, 0);
  const avgR = traded.length > 0 ? totalR / traded.length : 0;
  const winRatePct = traded.length > 0 ? (wins.length / traded.length) * 100 : 0;

  const timingCounts: Record<EntryTiming, number> = {
    first_valid_pullback: 0,
    first_touch: 0,
    early: 0,
    late_chase: 0,
  };

  let cleanDisciplineCount = 0;
  const mistakeMap = new Map<string, number>();

  for (const r of pool) {
    if (r.entryTiming !== "skipped") {
      timingCounts[r.entryTiming] = (timingCounts[r.entryTiming] ?? 0) + 1;
    }
    const isClean =
      r.ruleViolations.length === 0 &&
      (r.entryTiming === "first_valid_pullback" || r.entryTiming === "skipped");
    if (isClean) cleanDisciplineCount++;

    for (const v of r.ruleViolations) {
      mistakeMap.set(v, (mistakeMap.get(v) ?? 0) + 1);
    }
    if (r.entryTiming === "first_touch") {
      mistakeMap.set(
        "First-touch entry (early leak)",
        (mistakeMap.get("First-touch entry (early leak)") ?? 0) + 1
      );
    } else if (r.entryTiming === "early") {
      mistakeMap.set(
        "Early entry before pullback hold",
        (mistakeMap.get("Early entry before pullback hold") ?? 0) + 1
      );
    } else if (r.entryTiming === "late_chase") {
      mistakeMap.set(
        "Late chase after missing first pullback",
        (mistakeMap.get("Late chase after missing first pullback") ?? 0) + 1
      );
    }
  }

  const disciplinePct =
    pool.length > 0 ? (cleanDisciplineCount / pool.length) * 100 : 100;

  // Breakdown by scenario 1..6
  const scenarios: ScenarioNumber[] = [1, 2, 3, 4, 5, 6];
  const byScenario = scenarios.map((sc) => {
    const sub = pool.filter((r) => r.scenario === sc);
    const subTraded = sub.filter((r) => r.model !== "no_trade");
    const scR = subTraded.reduce((s, r) => s + r.outcomeR, 0);
    return {
      scenario: sc,
      count: sub.length,
      wins: subTraded.filter((r) => r.outcomeR > 0).length,
      totalR: Number(scR.toFixed(2)),
      avgR: subTraded.length > 0 ? Number((scR / subTraded.length).toFixed(2)) : 0,
    };
  });

  const byModel: JournalStats["byModel"] = {
    model1_reversal: { count: 0, wins: 0, totalR: 0, avgR: 0 },
    model2_continuation: { count: 0, wins: 0, totalR: 0, avgR: 0 },
    no_trade: { count: 0, wins: 0, totalR: 0, avgR: 0 },
  };
  for (const r of pool) {
    const bucket = byModel[r.model];
    bucket.count++;
    if (r.outcomeR > 0) bucket.wins++;
    bucket.totalR = Number((bucket.totalR + r.outcomeR).toFixed(2));
  }
  for (const k of Object.keys(byModel) as ModelType[]) {
    byModel[k].avgR =
      byModel[k].count > 0
        ? Number((byModel[k].totalR / byModel[k].count).toFixed(2))
        : 0;
  }

  const setupMap = new Map<SetupTag, { count: number; totalR: number }>();
  for (const r of traded) {
    const ex = setupMap.get(r.setupTag) ?? { count: 0, totalR: 0 };
    ex.count++;
    ex.totalR += r.outcomeR;
    setupMap.set(r.setupTag, ex);
  }
  const bySetup = Array.from(setupMap.entries())
    .map(([setupTag, v]) => ({
      setupTag,
      count: v.count,
      totalR: Number(v.totalR.toFixed(2)),
      avgR: Number((v.totalR / v.count).toFixed(2)),
    }))
    .sort((a, b) => b.totalR - a.totalR);

  const repeatedMistakes = Array.from(mistakeMap.entries())
    .map(([mistake, count]) => ({ mistake, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalReps: pool.length,
    tradedReps: traded.length,
    skippedReps: skipped.length,
    winRatePct: Number(winRatePct.toFixed(1)),
    totalR: Number(totalR.toFixed(2)),
    avgR: Number(avgR.toFixed(2)),
    disciplinePct: Number(disciplinePct.toFixed(1)),
    firstValidPullbackCount: timingCounts.first_valid_pullback,
    firstTouchCount: timingCounts.first_touch,
    earlyCount: timingCounts.early,
    lateChaseCount: timingCounts.late_chase,
    byScenario,
    byModel,
    bySetup,
    repeatedMistakes,
  };
}

export function exportJournalCSV(reps: SimRepLog[]): string {
  const header = [
    "createdAt",
    "sessionDate",
    "instrument",
    "dataSource",
    "scenario",
    "model",
    "setupTag",
    "side",
    "entryTiming",
    "h1m30",
    "m5",
    "m5Footprint",
    "m1",
    "outcomeR",
    "pnlDollars",
    "entryPrice",
    "stopPrice",
    "targetPrice",
    "ruleViolations",
    "note",
  ].join(",");

  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const rows = reps.map((r) =>
    [
      r.createdAt,
      r.sessionDate,
      r.instrument,
      r.dataSource,
      r.scenario,
      r.model,
      r.setupTag,
      r.side,
      r.entryTiming,
      r.contextUsed.h1m30,
      r.contextUsed.m5,
      r.contextUsed.m5Footprint,
      r.contextUsed.m1,
      r.outcomeR,
      r.pnlDollars ?? "",
      r.entryPrice ?? "",
      r.stopPrice ?? "",
      r.targetPrice ?? "",
      r.ruleViolations.join("; "),
      r.note,
    ]
      .map(escape)
      .join(",")
  );

  return [header, ...rows].join("\n");
}
