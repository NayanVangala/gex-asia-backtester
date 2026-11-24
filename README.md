# GEX Asia Terminal — Asia Value Model Backtester

Order-flow and volume profile historical replay terminal built specifically for the Gold Asia Value Model (read GC / PAXG order flow, execute 1OZ). Live on Vercel and runnable on `localhost`.

## Core Capabilities
- **Real Historical Market Data (Zero Fake Footprints)**
  - **Kraken PAXG/USD Real Trade Tape** (`/api/market/paxg`): real historical tick-by-tick aggressor buy/sell trades across weekday and Sunday Asia sessions (3:00 PM - 9:00 PM PT) plus 30d H1/M30 context for authentic Bid×Ask & Delta footprints, 300% diagonal imbalances, DeltaStrength %, absorption/exhaustion flags, CVD, Time & Sales tape, and Asia-calibrated Big Trades.
  - **COMEX GC=F Real OHLCV** (`/api/market/gc`): 30-day H1/M5 and 5-day M1 real COMEX Gold Futures candles for exact GC PD/PW/Composite/Developing volume profiles and Acceptance vs Rejection drills (clearly badged `OHLCV ONLY` with zero fabricated footprints).
  - **Databento CME `GLBX.MDP3` / ATAS CSV Importer**: auto-detects `trades`, `tbbo`, `mbp-10` (real L2 resting liquidity for Heatmap + DOM), ATAS/Sierra tick CSVs, and OHLCV CSVs.
- **ATAS-Style Multi-Layout Workspace**: switch between `Standard (4-Pane)`, `Dual Footprint (Bid×Ask + Delta)`, and `M5 + Footprint Focus`, with hover cell inspection, drag-to-pan, custom zone drawing (`Z`), and adjustable Large/Whale BigTrades thresholds.
- **Section 8 Working Orders & Chart Price Picking**: place working `Buy/Sell Stop` (1 tick above/below pullback bar), `Limit`, or `Market` orders; click straight on M5/M1 charts to snap Entry/Stop/T1/T2; working orders auto-cancel if price breaks absorption invalidation before filling and log stop-order slippage.
- **Blind Level-Touch Drill Mode & Blind Date Mode**: hide exact session dates, commit Model 1 / Model 2 / No-Trade before revealing +30 min (6 M5 bars), and auto-grade calls against Section 3 Acceptance/Rejection rules.
- **Optional L2 Heatmap & DOM**: off by default; renders real Databento `mbp-10` CSV depth or live-captured Kraken PAXG/USD real L2 depth snapshots.
- **Sim Rep Journal & Edge Review**: persistent plans & zones, auto-logged trades and disciplined skips, Cumulative R equity curve, First Valid Pullback vs Early-Entry leak win-rate comparison, Scenario #1-#6 and Model 1/2 breakdowns, Repeated Mistakes ranking, CSV/JSON export, and 1-click Google Sheet TSV copy (`$1.00/pt` 1OZ math).

## Local Development & Tests
```bash
npm install
npm test
npm run build
npm run dev
```
