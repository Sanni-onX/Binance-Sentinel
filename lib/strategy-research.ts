import { z } from 'zod';
import { SMA } from 'technicalindicators';
import { evaluateStrategy, strategySchema } from './strategy';
import type { Candle, DataMode, Evaluation, StrategyInput } from './types';

export const researchSchema = strategySchema.omit({ strategy: true }).extend({
  days: z.number().int().min(90).max(180),
  allocation: z.number().min(5).max(25),
  horizon: z.number().int().min(3).max(14).default(7),
});
export type ResearchInput = z.infer<typeof researchSchema>;
export interface StrategyResearch {
  id: string;
  createdAt: number;
  name: string;
  mode: DataMode;
  input: ResearchInput;
  rules: StrategyInput;
  candidates: {
    name: string;
    returnPct: number;
    drawdown: number;
    score: number;
  }[];
  training: Evaluation;
  validation: Evaluation;
  dataThrough: number;
  expiresAt: number;
  thesis: string;
  reasons: string[];
  decision: 'BUY_SETUP' | 'WAIT';
  proposal: {
    entry: number;
    stop: number;
    target: number;
    quantity: number;
    notional: number;
    risk: number;
    horizon: number;
  };
  outlook: {
    observations: number;
    upFrequency: number | null;
    medianPct: number | null;
    lowPct: number | null;
    highPct: number | null;
  };
}
export const outcomeSchema = z
  .object({
    strategyId: z.uuid(),
    execution: z.enum(['paper', 'actual']),
    entry: z.number().positive().max(1e12),
    exit: z.number().positive().max(1e12),
    quantity: z.number().positive().max(1e12),
    fees: z.number().nonnegative().max(1e12),
    openedAt: z.number().int().positive(),
    closedAt: z.number().int().positive(),
    notes: z.string().trim().max(2000).default(''),
  })
  .refine((v) => v.closedAt >= v.openedAt && v.closedAt <= Date.now(), {
    message: 'Close time must follow entry and cannot be in the future.',
  });
export type StrategyOutcome = z.infer<typeof outcomeSchema> & {
  id: string;
  createdAt: number;
  pnl: number;
  returnPct: number;
};
export function calculateOutcome(raw: unknown) {
  const input = outcomeSchema.parse(raw);
  const pnl = (input.exit - input.entry) * input.quantity - input.fees;
  return {
    ...input,
    pnl,
    returnPct: (pnl / (input.entry * input.quantity)) * 100,
  };
}

export function developStrategy(
  raw: ResearchInput,
  candles: Candle[],
  mode: DataMode,
): Omit<StrategyResearch, 'id' | 'createdAt'> {
  const input = researchSchema.parse(raw);
  if (candles.length < input.days + 50)
    throw new Error('Insufficient history for development and validation.');
  const trainingCandles = candles.slice(0, -30);
  const options = [20, 50].flatMap((trendPeriod) =>
    [3, 5].map((stopPct) => {
      const rules: StrategyInput = {
        symbol: input.symbol,
        strategy: 'trend',
        days: input.days - 30,
        capital: input.capital,
        allocation: Math.min(input.allocation, 50 / stopPct),
        feeBps: input.feeBps,
        slippageBps: input.slippageBps,
        trendPeriod,
        stopPct,
        targetPct: stopPct * 2,
        holdingDays: input.horizon,
      };
      const result = evaluateStrategy(rules, trainingCandles, mode);
      return {
        rules,
        result,
        name: `${trendPeriod}-day trend / ${stopPct}% stop`,
        score: result.returnPct - 2 * result.maxDrawdown,
      };
    }),
  );
  options.sort((a, b) => b.score - a.score);
  const selected = options[0];
  const validation = evaluateStrategy(
    { ...selected.rules, days: 30 },
    candles,
    mode,
  );
  const last = candles.at(-1)!;
  const period = selected.rules.trendPeriod!;
  const averages = SMA.calculate({
    period,
    values: candles.map((c) => c.close),
  });
  const bullish = last.close > averages.at(-1)!;
  const reasons: string[] = [];
  if (!bullish) reasons.push(`Last closed price is below SMA(${period}).`);
  if (selected.result.returnPct <= 0)
    reasons.push(
      'The development period did not produce a positive net return.',
    );
  if (validation.returnPct <= 0)
    reasons.push(
      'The held-out validation period did not produce a positive net return.',
    );
  if (validation.maxDrawdown > 10)
    reasons.push('Validation drawdown exceeds 10%.');
  if ((validation.closedTrades ?? 0) < 3)
    reasons.push('Fewer than three completed validation trades.');
  if (mode === 'live' && Date.now() - (last.time + 86400000) > 36 * 3600000)
    reasons.push('Closed candle evidence is stale.');
  const entry = last.close;
  const stop = entry * (1 - selected.rules.stopPct! / 100);
  const target = entry * (1 + selected.rules.targetPct! / 100);
  const fee = input.feeBps / 10000,
    slip = input.slippageBps / 10000;
  const unitCost = entry * (1 + slip) * (1 + fee);
  const unitRisk = unitCost - stop * (1 - slip) * (1 - fee);
  const quantity = Math.min(
    (input.capital * selected.rules.allocation) / 100 / unitCost,
    (input.capital * 0.005) / unitRisk,
  );
  // Non-overlapping analogues avoid counting almost identical future windows repeatedly.
  const analogues: number[] = [];
  for (let i = period - 1; i + input.horizon < candles.length; i++) {
    const above = candles[i].close > averages[i - period + 1];
    if (above !== bullish) continue;
    analogues.push(
      (candles[i + input.horizon].close / candles[i].close - 1) * 100,
    );
    i += input.horizon - 1;
  }
  const sorted = [...analogues].sort((a, b) => a - b);
  const quantile = (q: number) =>
    sorted.length ? sorted[Math.floor((sorted.length - 1) * q)] : null;
  return {
    name: `${input.symbol} / ${selected.name}`,
    input,
    mode,
    rules: selected.rules,
    candidates: options.map((o) => ({
      name: o.name,
      returnPct: o.result.returnPct,
      drawdown: o.result.maxDrawdown,
      score: o.score,
    })),
    training: selected.result,
    validation,
    dataThrough: last.time + 86400000,
    expiresAt: Math.min(Date.now() + 86400000, last.time + 3 * 86400000),
    thesis: `Long-only spot: enter at the next daily open after a close above SMA(${period}); exit on a prior close below it, a ${selected.rules.stopPct}% stop, a ${selected.rules.targetPct}% target, or after ${input.horizon} days. Skip re-entry on a scheduled exit day.`,
    reasons: reasons.length
      ? reasons
      : [
          'Positive development and validation returns; validation drawdown within 10%; trend condition active.',
        ],
    decision: reasons.length ? 'WAIT' : 'BUY_SETUP',
    proposal: {
      entry,
      stop,
      target,
      quantity,
      notional: quantity * unitCost,
      risk: quantity * unitRisk,
      horizon: input.horizon,
    },
    outlook: {
      observations: sorted.length,
      upFrequency: sorted.length
        ? (analogues.filter((v) => v > 0).length / sorted.length) * 100
        : null,
      medianPct: quantile(0.5),
      lowPct: quantile(0.1),
      highPct: quantile(0.9),
    },
  };
}
