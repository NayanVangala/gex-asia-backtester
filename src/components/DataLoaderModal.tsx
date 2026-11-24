"use client";

import React, { useState } from "react";
import { Upload, X, FileSpreadsheet, Copy, Check } from "lucide-react";
import { parseMarketDataCSV } from "@/lib/parsers";
import { SessionDataset } from "@/lib/types";

interface DataLoaderModalProps {
  open: boolean;
  onClose: () => void;
  onLoadedDataset: (dataset: SessionDataset) => void;
}

const DATABENTO_SNIPPET = `import databento as db

# $125 free credit on signup covers months of real COMEX GC Asia sessions
client = db.Historical("YOUR_DATABENTO_KEY")

# 1) Real COMEX GC trades (for authentic M5 Footprints, CVD, Big Trades)
#    Change schema="mbp-10" if you also want real L2 Heatmap resting liquidity
data = client.timeseries.get_range(
    dataset="GLBX.MDP3",
    symbols=["GC.c.0"],
    stype_in="continuous",
    schema="trades",            # or "mbp-10" for real L2 Heatmap + Trades
    start="2026-11-19T23:00Z",  # 3:00 PM PT Globex reopen (post-DST)
    end="2026-11-20T05:00Z",    # 9:00 PM PT Asia close
)
data.to_csv("gc_asia_2026-11-19.csv")`;

export function DataLoaderModal({
  open,
  onClose,
  onLoadedDataset,
}: DataLoaderModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const handleFile = async (file: File) => {
    setError(null);
    setStatus(`Parsing ${file.name}...`);
    try {
      const text = await file.text();
      const parsed = parseMarketDataCSV(text, file.name);
      setStatus(
        `Loaded ${parsed.detectedFormat} (${parsed.rowCount.toLocaleString()} rows).`
      );
      onLoadedDataset(parsed.dataset);
      onClose();
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : "Failed to parse CSV");
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(DATABENTO_SNIPPET);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
      <div className="w-full max-w-2xl rounded-xl border border-[#2a3650] bg-[#0c1018] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#1c2436] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              Import Real Historical Data (Databento COMEX GC / ATAS / CSV)
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5 text-xs">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-[#2a3650] bg-[#090d14] p-6 transition hover:border-sky-500/60 hover:bg-[#0d1422]">
            <Upload className="h-6 w-6 text-sky-400" />
            <span className="mt-2 font-semibold text-slate-200">
              Drop CSV file or click to browse
            </span>
            <span className="mt-1 text-[11px] text-slate-400">
              Auto-detects: Databento GLBX.MDP3 (trades, tbbo, mbp-10), ATAS /
              Sierra Tick CSV, or OHLCV CSV
            </span>
            <input
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </label>

          {status && (
            <div className="rounded border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sky-300">
              {status}
            </div>
          )}
          {error && (
            <div className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-rose-300">
              {error}
            </div>
          )}

          <div className="rounded-lg border border-[#1c2436] bg-[#090d14] p-3.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200">
                Pull Real COMEX GC Ticks + L2 Book via Databento ($125 free credit)
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 rounded bg-[#151e30] px-2 py-1 text-[11px] text-slate-300 hover:bg-[#1e2a42]"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> Copy Python
                  </>
                )}
              </button>
            </div>
            <pre className="mt-2 overflow-x-auto rounded bg-[#06080d] p-3 font-mono-num text-[11px] leading-relaxed text-slate-300">
              {DATABENTO_SNIPPET}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
