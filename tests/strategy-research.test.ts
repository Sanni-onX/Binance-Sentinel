import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateOutcome, developStrategy } from '../lib/strategy-research';
import { sampleCandles } from '../lib/market';
import { evaluateStrategy } from '../lib/strategy';
const input = {
  symbol: 'ETHUSDT',
  days: 180,
  capital: 1000,
  allocation: 25,
  feeBps: 10,
  slippageBps: 5,
  horizon: 7,
};

void test('strategy selection does not see held-out prices', () => {
  const candles = sampleCandles('ETHUSDT', 230);
  const first = developStrategy(input, candles, 'demo');
  const changed = candles.map((c, i) =>
    i < 200
      ? c
      : {
          ...c,
          open: c.open * 0.5,
          high: c.high * 0.5,
          low: c.low * 0.5,
          close: c.close * 0.5,
        },
  );
  const second = developStrategy(input, changed, 'demo');
  assert.deepEqual(first.rules, second.rules);
  assert.deepEqual(first.candidates, second.candidates);
  assert.equal(first.training.input.days, 150);
  assert.equal(first.validation.input.days, 30);
  assert.notEqual(first.validation.returnPct, second.validation.returnPct);
  assert.ok(first.proposal.risk <= input.capital * 0.005 + 1e-9);
  assert.ok(first.proposal.notional <= input.capital * 0.25);
  assert.ok(first.proposal.stop < first.proposal.entry);
  assert.ok(first.proposal.target > first.proposal.entry);
  assert.ok(first.outlook.observations <= Math.ceil(230 / 7));
});
void test('flat market produces wait rather than a forced buy', () => {
  const candles = sampleCandles('ETHUSDT', 230).map((c) => ({
    ...c,
    open: 100,
    high: 100,
    low: 100,
    close: 100,
  }));
  const result = developStrategy(input, candles, 'demo');
  assert.equal(result.decision, 'WAIT');
  assert.equal(result.validation.closedTrades, 0);
});
void test('stop wins an ambiguous candle and a gap fills at the worse open', () => {
  const candles = sampleCandles('ETHUSDT', 80).map((c, i) => ({
    ...c,
    open: 100 + i,
    high: 100 + i,
    low: 100 + i,
    close: 100 + i,
  }));
  candles[50] = { ...candles[50], open: 150, high: 180, low: 130, close: 150 };
  const rules = {
    ...input,
    strategy: 'trend' as const,
    days: 30,
    allocation: 10,
    stopPct: 5,
    targetPct: 10,
    feeBps: 0,
    slippageBps: 0,
  };
  const result = evaluateStrategy(rules, candles, 'demo');
  assert.equal(result.curve[1].strategy, 995);
  const gap = candles.map((c) => ({ ...c }));
  gap[50] = { ...gap[50], high: 150, low: 150 };
  gap[51] = { ...gap[51], open: 120, high: 120, low: 120, close: 120 };
  assert.equal(evaluateStrategy(rules, gap, 'demo').curve[2].strategy, 980);
});
void test('outcome P&L includes fees and rejects impossible dates', () => {
  const outcome = {
    strategyId: crypto.randomUUID(),
    execution: 'paper',
    entry: 100,
    exit: 110,
    quantity: 2,
    fees: 1,
    openedAt: Date.now() - 20000,
    closedAt: Date.now() - 10000,
    notes: 'Target hit',
  };
  const result = calculateOutcome(outcome);
  assert.equal(result.pnl, 19);
  assert.equal(result.returnPct, 9.5);
  assert.throws(() =>
    calculateOutcome({ ...outcome, closedAt: outcome.openedAt - 1 }),
  );
  assert.throws(() => calculateOutcome({ ...outcome, quantity: 0 }));
});
