import { z } from 'zod';
import { SMA, RSI } from 'technicalindicators';
import type {
  Candle,
  DataMode,
  MarketAsset,
  MarketSnapshot,
  SymbolName,
} from './types';

const number = z.coerce.number();
const positive = number.positive();
const tickerSchema = z.object({
  symbol: z.string(),
  lastPrice: positive,
  priceChangePercent: number,
  highPrice: positive,
  lowPrice: positive,
  quoteVolume: number.nonnegative(),
  closeTime: positive,
});
const candleSchema = z
  .tuple([
    number,
    positive,
    positive,
    positive,
    positive,
    number.nonnegative(),
    number,
  ])
  .rest(z.unknown());
const DATA_ORIGIN = 'https://data-api.binance.vision';
export const DEFAULT_SYMBOLS = ['BTCUSDT', 'BNBUSDT'];
export const MAX_TRACKED_SYMBOLS = 8;
export function normalizeSymbols(input?: string[] | string | null) {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];
  const symbols = raw
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .map((s) => (s.endsWith('USDT') ? s : `${s}USDT`));
  const unique = [...new Set(symbols.length ? symbols : DEFAULT_SYMBOLS)];
  if (unique.length > MAX_TRACKED_SYMBOLS)
    throw new Error(`Track at most ${MAX_TRACKED_SYMBOLS} pairs at once.`);
  for (const symbol of unique) {
    if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol))
      throw new Error(
        'Tracked pairs must be Binance-style USDT symbols, such as BTCUSDT or ETHUSDT.',
      );
  }
  return unique;
}
export async function binancePublic(
  path: string,
  query: Record<string, string> = {},
) {
  const url = new URL(path, DATA_ORIGIN);
  url.search = new URLSearchParams(query).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok)
    throw new Error(
      `Binance market data unavailable (HTTP ${response.status}). Try again or select sample data.`,
    );
  return response.json();
}
export function sampleCandles(symbol: SymbolName, count = 231): Candle[] {
  const end = Date.UTC(2026, 8, 4);
  const bases: Record<string, number> = {
    BTCUSDT: 68000,
    BNBUSDT: 580,
    ETHUSDT: 3600,
    SOLUSDT: 160,
    XRPUSDT: 0.62,
    ADAUSDT: 0.48,
    DOGEUSDT: 0.12,
  };
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) hash += symbol.charCodeAt(i);
  const base = bases[symbol] ?? 10 + (hash % 500);
  let price = base;
  return Array.from({ length: 231 }, (_, i) => {
    const open = price;
    const movement =
      0.002 + Math.sin(i * 1.71) * 0.013 + Math.cos(i * 0.23) * 0.008;
    price = open * (1 + movement);
    return {
      time: end - (230 - i) * 86400000,
      open,
      high: Math.max(open, price) * 1.009,
      low: Math.min(open, price) * 0.992,
      close: price,
      volume: 4000 + (Math.sin(i) * 0.5 + 0.5) * 9000,
    };
  }).slice(-count);
}
export async function getCandles(
  symbol: SymbolName,
  count: number,
  mode: DataMode,
): Promise<Candle[]> {
  if (mode === 'demo') return sampleCandles(symbol, count);
  const raw = z.array(candleSchema).parse(
    await binancePublic('/api/v3/klines', {
      symbol,
      interval: '1d',
      limit: String(count + 1),
    }),
  );
  return raw
    .filter((c) => c[6] < Date.now())
    .slice(-count)
    .map((c) => ({
      time: c[0],
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5],
    }));
}
export function analyzeAsset(
  symbol: SymbolName,
  candles: Candle[],
  ticker: {
    price: number;
    change: number;
    high: number;
    low: number;
    volume: number;
  },
): MarketAsset {
  const closes = candles.map((c) => c.close);
  const sma20 = SMA.calculate({ period: 20, values: closes }).at(-1)!;
  const sma50 = SMA.calculate({ period: 50, values: closes }).at(-1)!;
  const rsi = RSI.calculate({ period: 14, values: closes }).at(-1)!;
  const returns = closes
    .slice(-31)
    .slice(1)
    .map((p, i) => Math.log(p / closes.slice(-31)[i]));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const volatility =
    Math.sqrt(
      returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1),
    ) *
    Math.sqrt(365) *
    100;
  return {
    symbol,
    ...ticker,
    candles,
    rsi,
    sma20,
    sma50,
    volatility,
    trend:
      ticker.price > sma20 && sma20 > sma50
        ? 'Rising'
        : ticker.price < sma20 && sma20 < sma50
          ? 'Falling'
          : 'Mixed',
  };
}
let cached: { at: number; value: MarketSnapshot } | undefined;
export async function getMarket(
  mode: DataMode = 'live',
  requestedSymbols?: string[] | string | null,
): Promise<MarketSnapshot> {
  const symbols = normalizeSymbols(requestedSymbols);
  const cacheKey = `${mode}:${symbols.join(',')}`;
  if (
    mode === 'live' &&
    cached &&
    cached.value.cacheKey === cacheKey &&
    Date.now() - cached.at < 30000
  )
    return cached.value;
  const assets = await Promise.all(
    symbols.map(async (symbol) => {
      const [candles, raw] = await Promise.all([
        getCandles(symbol, 230, mode),
        mode === 'live'
          ? binancePublic('/api/v3/ticker/24hr', { symbol })
          : Promise.resolve(null),
      ]);
      if (candles.length < 60)
        throw new Error('Insufficient closed daily candles from Binance.');
      const last = candles.at(-1)!;
      const prev = candles.at(-2)!;
      const ticker = raw ? tickerSchema.parse(raw) : null;
      if (ticker && Date.now() - ticker.closeTime > 120000)
        throw new Error('Binance returned stale ticker data.');
      return analyzeAsset(
        symbol,
        candles,
        ticker
          ? {
              price: ticker.lastPrice,
              change: ticker.priceChangePercent,
              high: ticker.highPrice,
              low: ticker.lowPrice,
              volume: ticker.quoteVolume,
            }
          : {
              price: last.close,
              change: (last.close / prev.close - 1) * 100,
              high: last.high,
              low: last.low,
              volume: last.volume * last.close,
            },
      );
    }),
  );
  const value = {
    assets,
    mode,
    symbols,
    cacheKey,
    source:
      mode === 'live' ? 'Binance public Spot API' : 'Synthetic sample data',
    asOf:
      mode === 'live' ? new Date().toISOString() : '2026-09-04T23:59:59.000Z',
  };
  if (mode === 'live') cached = { at: Date.now(), value };
  return value;
}
