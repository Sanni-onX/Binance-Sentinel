export type SymbolName = 'BTCUSDT' | 'BNBUSDT';
export type DataMode = 'live' | 'demo';
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export interface MarketAsset {
  symbol: SymbolName;
  price: number;
  change: number;
  high: number;
  low: number;
  volume: number;
  candles: Candle[];
  rsi: number;
  sma20: number;
  sma50: number;
  volatility: number;
  trend: 'Rising' | 'Falling' | 'Mixed';
}
export interface MarketSnapshot {
  source: string;
  mode: DataMode;
  asOf: string;
  assets: MarketAsset[];
}
export interface Holding {
  asset: string;
  free: string;
  locked: string;
  quantity: number;
  price: number | null;
  value: number | null;
  weight: number | null;
}
export interface Portfolio {
  holdings: Holding[];
  total: number;
  unpriced: number;
  asOf: string;
  scope: string;
}
export interface StrategyInput {
  symbol: SymbolName;
  strategy: 'trend' | 'dca' | 'hold';
  days: number;
  capital: number;
  allocation: number;
  feeBps: number;
  slippageBps: number;
}
export interface Evaluation {
  input: StrategyInput;
  asOf: string;
  source: string;
  mode: DataMode;
  returnPct: number;
  benchmarkPct: number;
  maxDrawdown: number;
  sharpe: number | null;
  fees: number;
  trades: number;
  finalValue: number;
  curve: { time: number; strategy: number; benchmark: number }[];
  verdict: string;
  assumptions: string[];
}
export interface SavedReport {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  mode: DataMode;
}
export interface ActivityEntry {
  id: string;
  action: string;
  detail: string;
  createdAt: number;
}
export interface ConnectionStatus {
  connected: boolean;
  tokenPresent: boolean;
  tools: { name: string; description?: string; readOnly: boolean }[];
  error?: string;
  aiConfigured: boolean;
  oauthReady: boolean;
}
