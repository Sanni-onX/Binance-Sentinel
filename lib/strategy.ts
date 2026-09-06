import { z } from 'zod';
import { SMA } from 'technicalindicators';
import type { Candle, DataMode, Evaluation, StrategyInput } from './types';
export const strategySchema = z.object({
  symbol: z.enum(['BTCUSDT', 'BNBUSDT']),
  strategy: z.enum(['trend', 'dca', 'hold']),
  days: z.number().int().min(30).max(180),
  capital: z.number().min(10).max(10000000),
  allocation: z.number().min(5).max(80),
  feeBps: z.number().min(0).max(100),
  slippageBps: z.number().min(0).max(100),
});

export function evaluateStrategy(
  raw: StrategyInput,
  candles: Candle[],
  mode: DataMode,
): Evaluation {
  const input = strategySchema.parse(raw);
  if (candles.length < input.days + 50)
    throw new Error(
      'At least 50 warm-up candles are required before the evaluation window.',
    );
  if (
    candles.some(
      (c, i) =>
        ![c.open, c.high, c.low, c.close].every(
          (p) => Number.isFinite(p) && p > 0,
        ) ||
        c.low > Math.min(c.open, c.close) ||
        c.high < Math.max(c.open, c.close) ||
        (i > 0 && c.time <= candles[i - 1].time),
    )
  )
    throw new Error('Invalid or unsorted market candles.');
  const start = candles.length - input.days;
  const closes = candles.map((c) => c.close);
  const averages = SMA.calculate({ period: 50, values: closes });
  const fee = input.feeBps / 10000,
    slip = input.slippageBps / 10000,
    allocation = input.allocation / 100;
  let cash = input.capital,
    units = 0,
    fees = 0,
    trades = 0,
    peak = input.capital,
    drawdown = 0;
  const budget = input.capital * allocation;
  const benchmarkUnits =
    budget / (candles[start].open * (1 + slip) * (1 + fee));
  const curve: Evaluation['curve'] = [
    {
      time: candles[start].time - 1,
      strategy: input.capital,
      benchmark: input.capital,
    },
  ];
  const buy = (spend: number, price: number) => {
    spend = Math.min(spend, cash);
    if (spend <= 1e-8) return;
    const net = spend / (1 + fee);
    units += net / (price * (1 + slip));
    fees += spend - net;
    cash -= spend;
    trades++;
  };
  const sell = (price: number) => {
    if (units <= 0) return;
    const gross = units * price * (1 - slip);
    fees += gross * fee;
    cash += gross * (1 - fee);
    units = 0;
    trades++;
  };
  for (let i = start; i < candles.length; i++) {
    const c = candles[i];
    // Signals use yesterday's close and average; fills use today's open.
    if (input.strategy === 'hold' && i === start) buy(budget, c.open);
    if (input.strategy === 'dca' && (i - start) % 7 === 0)
      buy(budget / Math.ceil(input.days / 7), c.open);
    if (input.strategy === 'trend') {
      const trend = closes[i - 1] > averages[i - 50];
      if (trend && units === 0) buy(cash * allocation, c.open);
      else if (!trend) sell(c.open);
    }
    const value = cash + units * c.close;
    peak = Math.max(peak, value);
    drawdown = Math.max(drawdown, ((peak - value) / peak) * 100);
    curve.push({
      time: c.time,
      strategy: value,
      benchmark: input.capital - budget + benchmarkUnits * c.close,
    });
  }
  const daily = curve
    .slice(1)
    .map((p, i) => p.strategy / curve[i].strategy - 1);
  const mean = daily.reduce((a, b) => a + b, 0) / daily.length;
  const sd = Math.sqrt(
    daily.reduce((a, b) => a + (b - mean) ** 2, 0) / (daily.length - 1),
  );
  const finalValue = curve.at(-1)!.strategy;
  const returnPct = (finalValue / input.capital - 1) * 100;
  return {
    input,
    mode,
    source:
      mode === 'live'
        ? 'Binance closed daily candles'
        : 'Synthetic sample candles',
    asOf: new Date().toISOString(),
    returnPct,
    benchmarkPct: (curve.at(-1)!.benchmark / input.capital - 1) * 100,
    maxDrawdown: drawdown,
    sharpe: sd > 1e-12 ? (mean / sd) * Math.sqrt(365) : null,
    fees,
    trades,
    finalValue,
    curve,
    verdict:
      drawdown > 10
        ? 'Drawdown exceeds the conservative review threshold.'
        : returnPct < 0
          ? 'Negative historical return. Keep this strategy under review.'
          : 'Within the drawdown review threshold for this sample. Forward testing required.',
    assumptions: [
      'Signals use prior closed candles; orders fill at the next daily open.',
      'Benchmark uses the same starting allocation, entry fees and slippage.',
      'Uninvested cash earns no interest. Open positions are marked to market without a final liquidation.',
      'Drawdown is measured at daily close; intraday losses can be larger.',
      'No exchange lot-size rounding, tax, liquidity constraints or funding costs are modeled.',
      'Historical or synthetic results do not predict future performance.',
    ],
  };
}
