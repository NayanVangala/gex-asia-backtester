import { NextResponse } from "next/server";
import { L2Snapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

interface KrakenDepthResponse {
  error?: string[];
  result?: {
    PAXGUSD?: {
      asks: Array<[string, string, number]>;
      bids: Array<[string, string, number]>;
    };
  };
}

/**
 * Returns a single REAL live Level 2 order book snapshot from Kraken PAXG/USD.
 * Used only when the user explicitly toggles Live L2 Recorder on the optional Heatmap panel.
 */
export async function GET() {
  try {
    const res = await fetch(
      "https://api.kraken.com/0/public/Depth?pair=PAXGUSD&count=40",
      { cache: "no-store" }
    );
    if (!res.ok) {
      throw new Error(`Kraken Depth HTTP ${res.status}`);
    }
    const data = (await res.json()) as KrakenDepthResponse;
    const book = data.result?.PAXGUSD;
    if (!book) {
      throw new Error(data.error?.join(", ") || "Empty Kraken depth");
    }

    const snapshot: L2Snapshot = {
      ts: Date.now(),
      bids: book.bids.map(([p, s]) => ({ price: Number(p), size: Number(s) })),
      asks: book.asks.map(([p, s]) => ({ price: Number(p), size: Number(s) })),
    };

    return NextResponse.json({
      source: "Kraken PAXG/USD Live L2 Depth",
      snapshot,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch live L2" },
      { status: 500 }
    );
  }
}
