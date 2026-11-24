"use client";

import React, { useState } from "react";
import { Upload, X, Copy, Check } from "lucide-react";
import { parseMarketDataCSV } from "@/lib/parsers";
import { SessionDataset } from "@/lib/types";

interface DataLoaderModalProps {
  open: boolean;
  onClose: () => void;
  onLoadedDataset: (dataset: SessionDataset) => void;
}

const DATABENTO_SNIPPET = `import databento as db

client = db.Historical("YOUR_DATABENTO_KEY")
data = client.timeseries.get_range(
    dataset="GLBX.MDP3",
    symbols=["GC.c.0"],
    stype_in="continuous",
    schema="trades",            # or "mbp-10" for real L2 Heatmap + Trades
    start="2026-11-19T23:00Z",  # 3:00 PM PT Globex reopen
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
      setStatus(`Loaded ${parsed.detectedFormat} (${parsed.rowCount.toLocaleString()} rows).`);
      onLoadedDataset(parsed.dataset);
      onClose();
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : "Failed to parse CSV");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
      <div className="w-full max-w-xl rounded-md border border-[#262d3b] bg-[#0f1217] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#1c212b] px-4 py-3">
          <h2 className="text-xs font-semibold text-[#e6e9ef]">
            Import Historical CSV (Databento COMEX GC / ATAS / OHLCV)
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[#7d8594] hover:bg-[#1a202c] hover:text-[#e6e9ef]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4 text-xs">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded border border-dashed border-[#2d3546] bg-[#0b0d11] p-6 transition hover:border-[#586070]">
            <Upload className="h-5 w-5 text-[#8b94a5]" />
            <span className="mt-2 font-medium text-[#e6e9ef]">
              Drop CSV file or click to browse
            </span>
            <span className="mt-1 text-[11px] text-[#6e7787]">
              Databento GLBX.MDP3 (trades / tbbo / mbp-10), ATAS Tick CSV, or OHLCV
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

          {status && <div className="text-[11px] text-[#00c087]">{status}</div>}
          {error && <div className="text-[11px] text-[#f6465d]">{error}</div>}

          <div className="rounded border border-[#1c212b] bg-[#0b0d11] p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[#c8cfdc]">
                Databento COMEX GC Python Snippet ($125 free credit)
              </span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(DATABENTO_SNIPPET);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                }}
                className="flex items-center gap-1 rounded bg-[#181d27] px-2 py-0.5 text-[10.5px] text-[#c8cfdc] hover:bg-[#222938]"
              >
                {copied ? <Check className="h-3 w-3 text-[#00c087]" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="mt-2 overflow-x-auto font-mono-num text-[10.5px] leading-relaxed text-[#8b94a5]">
              {DATABENTO_SNIPPET}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
