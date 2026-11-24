# GEX Asia Terminal — Asia Value Model Backtester

Order-flow and volume profile historical replay terminal built specifically for the Gold Asia Value Model (read GC / PAXG order flow, execute 1OZ). Runs on `localhost` and deploys cleanly to Vercel.

## Features
- **Real Historical Market Data (Zero Fake Footprints)**
  - **Kraken PAXG/USD Real Trade Tape** (`/api/market/paxg`): real historical tick-by-tick aggressor buy/sell trades across past Asia sessions (4:00 PM - 9:00 PM PT) plus 30-day H1/M30 context for authentic Bid x Ask footprints, 300% diagonal imbalances, absorption/exhaustion flags, CVD, and Asia-calibrated Big Trades.
  - **COMEX GC=F Real OHLCV** (`/api/market/gc`): 30-day H1/M5 and 5-day M1 real COMEX Gold Futures candles for exact GC PD/PW/Composite/Developing volume profiles and Acceptance vs Rejection drills (clearly badged OHLCV-only without fabricated footprints).
  - **Databento CME `GLBX.MDP3` / ATAS CSV Importer**: auto-detects `trades`, `tbbo`, `mbp-10` (real L2 resting liquidity for Heatmap + DOM), ATAS/Sierra tick CSVs, and OHLCV CSVs.
- **Premarket Workspace (H1 / M30)**: automatic Previous Day, Previous Week, 5-Session Composite, Developing Value (shaded no-trade zone), HVN/LVN, Naked POCs, Stacked Confluence Zone detector, custom zone drawing (`Z`), and Premarket Checklist.
- **Strict No-Lookahead Asia Replay**: Tokyo Open (`16:00 PT`), China Open (`17:00 PT`), `Next Level Touch` jump, bar-by-bar (`+1m`, `+5m`, `+30m`), and playback speed controls.
- **Model 1 / Model 2 Guardrails & Early-Entry Leak Detector**: live Section 3 Acceptance (6+ M5 bars / 30 min) vs Rejection (1-2 M5 bars) meter, 1OZ `$0.25` outward stop rounding, `$1/pt + $1.50` commission drag check, T2 >= 2R check, max 2 trades / 2R daily stop, and First-Touch / No-Reclaim warnings.
- **Optional L2 Heatmap & DOM**: off by default; renders real Databento `mbp-10` CSV depth or live-recorded Kraken PAXG/USD real L2 depth snapshots.
- **Integrated Sim Rep Journal & Review**: logs every closed sim trade and skipped touch automatically; tracks Discipline %, First Valid Pullback vs First Touch/Early counts, Scenario #1-#6 and Model 1/2 R breakdowns, Repeated Mistakes ranking, and CSV/JSON export.

## Local Development
```bash
npm install
npm run dev
# Open http://localhost:3000
```

## Tests & Production Build
```bash
npm test
npm run build
```

## Deploy to Vercel
Push this repository to GitHub and import into Vercel, or run `npx vercel` from this directory. All market data fetches execute server-side in Next.js Route Handlers with zero API keys required.
