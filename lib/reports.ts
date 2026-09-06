import type { MarketSnapshot, Portfolio } from './types';
export function marketReport(
  market: MarketSnapshot,
  portfolio: Portfolio | null,
) {
  const parts = [
    `# Sentinel market and portfolio review`,
    `As of: ${market.asOf}\nSource: ${market.source}\nProfile: Conservative / Spot only`,
    ...market.assets.map(
      (a) =>
        `## ${a.symbol}\nPrice: ${a.price.toFixed(2)} USDT. 24-hour change: ${a.change.toFixed(2)}%.\nDaily trend: ${a.trend}. RSI(14): ${a.rsi.toFixed(1)}. SMA(20): ${a.sma20.toFixed(2)}. SMA(50): ${a.sma50.toFixed(2)}.\nAnnualized 30-day realized volatility: ${a.volatility.toFixed(1)}%.\nAssessment: ${a.trend === 'Falling' ? 'Trend is falling; avoid increasing exposure without a reviewed entry plan.' : a.rsi > 70 ? 'Momentum is elevated; avoid chasing a sharp move.' : 'Evaluate staged entries against current exposure and available cash.'}`,
    ),
    `## Portfolio\n${portfolio ? `Priced value: ${portfolio.total.toFixed(2)} USDT. ${portfolio.holdings.length} funded assets. ${portfolio.unpriced} unpriced assets.\n${portfolio.holdings.map((h) => `${h.asset}: ${h.quantity} units; ${h.weight === null ? 'unpriced' : h.weight.toFixed(1) + '% of priced holdings'}`).join('\n')}\n${portfolio.holdings.some((h) => (h.weight ?? 0) > 50 && !['USDT', 'USDC', 'FDUSD'].includes(h.asset)) ? 'Single-asset concentration exceeds the 50% review threshold.' : 'No priced non-stablecoin holding exceeds the 50% concentration review threshold.'}` : 'Account not connected or portfolio not available. No holdings have been assumed.'}`,
    `## Strategy review\nCompare a 50-day trend filter, weekly staged entry and buy-and-hold using the Strategy lab. Review drawdown, fees and the same-allocation benchmark before staging any order.\nThese signals describe price history; they do not establish why the market moved. News and macroeconomic causes are not included without verified sources.`,
  ];
  return parts.join('\n\n');
}
