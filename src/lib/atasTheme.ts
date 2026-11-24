/**
 * Exact visual palette, chart gradient, candle colors, cluster settings,
 * indicator colors, heatmap palette, and SmartDOM colors extracted directly
 * from Nayan's Mac ATAS X workspace:
 *   ~/Library/Application Support/ATAS/Workspaces2/Asia_Template_Fixed.aws
 */
export const ATAS_ASIA_THEME = {
  // Window & Dock Chrome (from SmartDOM BackColor & Chart AxisColor)
  chrome: {
    windowBg: "#111620",
    panelBg: "#151B26", // AxisColor: 21, 27, 38
    domBg: "#1A2333", // SmartDOM BackColor: 26, 35, 51
    tabActiveBg: "#1F293B",
    tabInactiveBg: "#131822",
    border: "#2A2E39", // ClusterBorderPen: 42, 46, 57
    separator: "#434651", // IndicatorsSeparator: 67, 70, 81
    axisCurrentBg: "#363A45", // AxisCurrentBackColor: 54, 58, 69
    axisCurrentFg: "#F1F1F1", // AxisCurrentForeColor: 241, 241, 241
    textPrimary: "#F1F1F1",
    textSecondary: "#ABAEB8", // AxisTextColor / OhlcColor: 171, 174, 184
    textMuted: "#787D8C",
    accentBlue: "#2962FF", // LineChartPricePen / TradesColor: 41, 98, 255
    sessionLine: "#4985E7", // NewSessionPen: 73, 133, 231
  },

  // Chart Background Gradients (BackgroundBrushSettings)
  canvas: {
    candleBgTop: "#00006B", // 0, 0, 107 (H1, M30, M5, M1)
    clusterBgTop: "#00008B", // DarkBlue (M5 Footprints)
    bgBottom: "#000000", // Black
    grid: "rgba(33, 37, 47, 0.14)", // GridPen: 5, 33, 37, 47 (subtle)
    crosshair: "#9598A1", // CrosshairPen: 149, 152, 161
    priceLine: "#EF5350", // PriceLinePen: 239, 83, 80
  },

  // Candles (M5/M1 use White + #00A0FF; H1/M30/FP use White + #3BEFF0)
  candles: {
    bull: "#FFFFFF", // BuyColor: White
    bearM5M1: "#00A0FF", // SellColor M5/M1: 0, 160, 255
    bearCyan: "#3BEFF0", // SellColor H1/M30/FP: 59, 239, 240
    doji: "#7D7D7D", // DojiBarColor: 125, 125, 125
  },

  // Footprint Clusters (FP2 G1.W1 exact clusterSettings)
  clusters: {
    bid: "#F71427", // Bid: 247, 20, 39
    ask: "#007900", // Ask: 0, 121, 0
    pocVolume: "#FF4900", // Volumes: 255, 73, 0
    secondClusterVol: "#2962FF", // SecondClusters volumeHistogram: 41, 98, 255
    foreground: "#FFFFFF", // Foreground: White
    imbalanceBid: "#FFFFFF", // ImbalanceBid: White
    imbalanceAsk: "#FFFFFF", // ImbalanceAsk: White
    imbalanceRate: 1.5, // ImbalanceRate: 150%
    border: "#2A2E39", // ClusterBorderPen: 42, 46, 57
    valueArea: "rgba(200, 216, 255, 0.16)", // ValueAreaColor: 100, 200, 216, 255
  },

  // ClusterStatistic Panel (exact FP2 settings)
  clusterStats: {
    bg: "rgba(21, 27, 38, 0.72)", // 128, 21, 27, 38
    grid: "#21252F", // 33, 37, 47
    text: "#FFFFFF",
    volumeBg: "#434651", // 67, 70, 81
    askBg: "#007900", // 0, 121, 0
    bidBg: "#F71427", // 247, 20, 39
  },

  // Indicators (exact serialized settings)
  indicators: {
    vwap: "#FFFF00", // VWAP BullishColor/BearishColor: Yellow, VWAPOnly: true
    // BigTrades instance 1 (MinVol 25)
    bigTradeLargeBuy: "#0073FF", // 0, 115, 255
    bigTradeLargeSell: "#F2385A", // 242, 56, 90
    // BigTrades instance 2 (MinVol 100)
    bigTradeWhaleBuy: "#3BEFF0", // 59, 239, 240
    bigTradeWhaleSell: "#D900FC", // 217, 0, 252
    // Absorption (LineWidth 5, Ratio 300)
    absorptionBull: "rgba(60, 243, 60, 0.36)", // 89, 60, 243, 60
    absorptionBear: "rgba(255, 58, 58, 0.36)", // 89, 255, 58, 58
    // CumulativeDelta (Mode: candles)
    cvdPos: "#009900", // Green
    cvdNeg: "#FF3A3A", // 255, 58, 58
    // Drawings (DrawingObjectses)
    levelRed: "#FF3A3A", // Previous Day Low solid red
    levelCyan: "#3BEFF0", // Dashed cyan key level
  },

  // Trading & Order Lines (TradingSettings)
  trading: {
    buyOrder: "#089981", // 8, 153, 129
    sellOrder: "#F2385A", // 242, 56, 90
    orderText: "#D1D4DC", // 209, 212, 220
    posBg: "#151B26",
  },

  // Heatmap (G1.W0 HeatmapSettings)
  heatmap: {
    palette: "darkToRed" as const,
    bestBidLine: "rgba(255, 255, 255, 0.88)", // 217, 255, 255, 255
    bestAskLine: "rgba(59, 239, 240, 0.88)", // 217, 59, 239, 240
    bubbleBuy: "#FFFFFF", // White
    bubbleSell: "#3BEFF0", // 59, 239, 240
  },

  // SmartDOM (G1.W2 SmartDOMSettings)
  smartDom: {
    bg: "#1A2333",
    todayBar: "#74A6E2", // 116, 166, 226
    bidBar: "#089981", // 8, 153, 129
    askBar: "#F2385A", // 242, 56, 90
    chgBar: "#FF7F50", // Coral
    tradesBar: "#DC143C", // Crimson
    centerLine: "#F1F1F1",
  },
} as const;
