import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateStrategy, strategySchema } from '../lib/strategy';
import { sampleCandles, analyzeAsset } from '../lib/market';
import { checkOrderBudget } from '../lib/risk';
import type { Candle, StrategyInput } from '../lib/types';
const input: StrategyInput = {
  symbol: 'BTCUSDT',
  strategy: 'hold',
  days: 30,
  capital: 1000,
  allocation: 25,
  feeBps: 10,
  slippageBps: 5,
};
function candles(prices: number[]): Candle[] {
  return prices.map((p, i) => ({
    time: Date.UTC(2026, 0, 1) + i * 86400000,
    open: p,
    close: p,
    high: p * 1.01,
    low: p * 0.99,
    volume: 1000,
  }));
}
void test('flat prices incur only modeled entry fee and slippage', () => {
  const result = evaluateStrategy(input, candles(Array(80).fill(100)), 'demo');
  const expected = 750 + 250 / (1.001 * 1.0005);
  assert.ok(Math.abs(result.finalValue - expected) < 1e-8);
  assert.equal(result.trades, 1);
  assert.equal(result.returnPct, result.benchmarkPct);
  assert.ok(result.fees > 0);
  assert.ok(result.maxDrawdown > 0);
});
void test('zero-cost constant prices have zero return, drawdown and undefined Sharpe', () => {
  const r = evaluateStrategy(
    { ...input, feeBps: 0, slippageBps: 0 },
    candles(Array(80).fill(100)),
    'demo',
  );
  assert.equal(r.returnPct, 0);
  assert.equal(r.maxDrawdown, 0);
  assert.equal(r.sharpe, null);
});
void test('trend entry does not look ahead to current close', () => {
  const prices = Array(80).fill(100);
  prices[50] = 200;
  prices.fill(200, 51);
  const cs = candles(prices);
  const r = evaluateStrategy(
    { ...input, strategy: 'trend', feeBps: 0, slippageBps: 0 },
    cs,
    'demo',
  );
  assert.equal(r.curve[1].strategy, 1000);
  assert.equal(r.curve[2].strategy, 1000);
  assert.equal(r.trades, 1);
});
void test('drawdown includes loss on first evaluated day', () => {
  const cs = candles(Array(80).fill(100));
  cs[50] = { ...cs[50], close: 50, low: 49 };
  const r = evaluateStrategy(
    { ...input, feeBps: 0, slippageBps: 0 },
    cs,
    'demo',
  );
  assert.equal(r.maxDrawdown, 12.5);
});
void test('weekly allocation spends the fixed budget across scheduled entries', () => {
  const r = evaluateStrategy(
    { ...input, strategy: 'dca', feeBps: 0, slippageBps: 0 },
    candles(Array(80).fill(100)),
    'demo',
  );
  assert.equal(r.trades, 5);
  assert.equal(r.finalValue, 1000);
});
void test('rejects insufficient warm-up, invalid candles and invalid allocations', () => {
  assert.throws(
    () => evaluateStrategy(input, candles(Array(79).fill(100)), 'demo'),
    /warm-up/,
  );
  const cs = candles(Array(80).fill(100));
  cs[20].close = NaN;
  assert.throws(() => evaluateStrategy(input, cs, 'demo'), /Invalid/);
  assert.equal(
    strategySchema.safeParse({ ...input, allocation: 101 }).success,
    false,
  );
});
void test('sample windows share the same canonical prices', () => {
  assert.deepEqual(
    sampleCandles('BTCUSDT', 90),
    sampleCandles('BTCUSDT', 230).slice(-90),
  );
});
void test('indicators are finite and flat market volatility is zero', () => {
  const a = analyzeAsset('BTCUSDT', candles(Array(100).fill(100)), {
    price: 100,
    change: 0,
    high: 101,
    low: 99,
    volume: 100,
  });
  assert.equal(a.sma20, 100);
  assert.equal(a.sma50, 100);
  assert.equal(a.volatility, 0);
  assert.equal(a.trend, 'Mixed');
  assert.ok(Number.isFinite(a.rsi));
});
void test('order budget allows a measured purchase and rejects caps', () => {
  assert.doesNotThrow(() => checkOrderBudget('25.00', '500', 1000, 100));
  assert.throws(() => checkOrderBudget('25.01', '500', 1000, 100), /at most/);
  assert.throws(() => checkOrderBudget('10', '100', 100, 0), /5%/);
  assert.throws(() => checkOrderBudget('25', '210', 1000, 100), /20%/);
  assert.throws(() => checkOrderBudget('25', '500', 1000, 490), /50%/);
  assert.throws(() => checkOrderBudget('25', '25', 1000, 100), /Insufficient/);
  assert.throws(() => checkOrderBudget('0', '500', 1000, 100), /above zero/);
});
void test('order limits use exact decimal arithmetic at the boundary', () => {
  assert.doesNotThrow(() => checkOrderBudget('0.10', '1', 2, 0));
  assert.throws(() => checkOrderBudget('0.11', '1', 2, 0), /5%/);
});
