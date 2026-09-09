import OpenAI from 'openai';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getCandles, getMarket, normalizeSymbols } from '../lib/market';
import { marketReport } from '../lib/reports';
import { checkOrderBudget } from '../lib/risk';
import { evaluateStrategy, strategySchema } from '../lib/strategy';
import { developStrategy, researchSchema } from '../lib/strategy-research';
import type { DataMode, MarketSnapshot, Portfolio } from '../lib/types';

const modeSchema = z.enum(['live', 'demo']).default('live');
const symbolsSchema = z.array(z.string()).max(8).optional();
const portfolioSchema = z
  .object({
    total: z.number().nonnegative(),
    unpriced: z.number().int().nonnegative().default(0),
    asOf: z.string().default(() => new Date().toISOString()),
    scope: z.string().default('Provided MCP input'),
    holdings: z
      .array(
        z.object({
          asset: z.string(),
          free: z.string(),
          locked: z.string().default('0'),
          quantity: z.number().nonnegative(),
          price: z.number().nullable(),
          value: z.number().nullable(),
          weight: z.number().nullable(),
        }),
      )
      .default([]),
  })
  .optional();

function text(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  };
}

function compactMarket(market: MarketSnapshot) {
  return {
    ...market,
    assets: market.assets.map(({ candles, ...asset }) => ({
      ...asset,
      recentCloses: candles.slice(-14).map((c) => ({
        date: new Date(c.time).toISOString().slice(0, 10),
        close: c.close,
      })),
    })),
  };
}

function config() {
  const key = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
  const model =
    process.env.OPENAI_MODEL ||
    process.env.OPENAI_API_MODEL ||
    process.env.OPENAI_RESPONSES_MODEL ||
    process.env.MODEL;
  return { key, model };
}

async function analyzeWithOpenAI(
  message: string,
  mode: DataMode,
  symbols: string[] | undefined,
  portfolio: Portfolio | null,
) {
  const market = await getMarket(mode, symbols);
  const { key, model } = config();
  if (!key || !model) {
    return {
      engine: 'Structured analytics',
      asOf: market.asOf,
      answer: marketReport(market, portfolio).replace(/^#{1,2} /gm, ''),
      evidence: compactMarket(market),
    };
  }
  const client = new OpenAI({ apiKey: key, timeout: 45000, maxRetries: 0 });
  const result = await client.responses.create({
    model,
    store: false,
    max_output_tokens: 1800,
    instructions:
      'You are Sentinel, a conservative Binance Agent OS analyst. Answer with concrete evidence from supplied market and optional portfolio data. Separate observations from inference. Identify synthetic data. Do not claim account access, news causes, completed actions, or order execution. You may propose testable strategy rules, risk limits, and next checks, but never present historical tests as guaranteed predictions.',
    input: [
      {
        role: 'developer',
        content: `Retrieved evidence: ${JSON.stringify({
          market: compactMarket(market),
          portfolio,
        })}`,
      },
      { role: 'user', content: message },
    ],
  });
  return {
    engine: `AI analyst / ${model}`,
    asOf: market.asOf,
    answer: result.output_text,
    evidence: compactMarket(market),
  };
}

const server = new McpServer({
  name: 'sentinel-binance-agent',
  version: '0.1.0',
});

server.registerTool(
  'sentinel_market_snapshot',
  {
    title: 'Sentinel Market Snapshot',
    description:
      'Get Binance public Spot market indicators for tracked USDT pairs. Use demo mode for synthetic offline samples.',
    inputSchema: {
      mode: modeSchema.describe(
        'live uses Binance public data; demo is synthetic',
      ),
      symbols: symbolsSchema.describe('USDT pairs, e.g. BTCUSDT or ETH'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ mode, symbols }) =>
    text(compactMarket(await getMarket(mode, symbols))),
);

server.registerTool(
  'sentinel_market_report',
  {
    title: 'Sentinel Market Report',
    description:
      'Generate a conservative market and optional portfolio report for selected USDT pairs.',
    inputSchema: {
      mode: modeSchema,
      symbols: symbolsSchema,
      portfolio: portfolioSchema,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ mode, symbols, portfolio }) => {
    const market = await getMarket(mode, symbols);
    return text({
      report: marketReport(market, portfolio ?? null),
      evidence: compactMarket(market),
    });
  },
);

server.registerTool(
  'sentinel_evaluate_strategy',
  {
    title: 'Sentinel Strategy Evaluation',
    description:
      'Backtest one strategy with prior-close signals, next-open fills, fees, slippage, drawdown, Sharpe, and same-allocation benchmark.',
    inputSchema: {
      mode: modeSchema,
      symbol: z.string().describe('Binance USDT pair, e.g. BTCUSDT'),
      strategy: z.enum(['trend', 'dca', 'hold']),
      days: z.number().int().min(30).max(180),
      capital: z.number().min(10).max(10000000),
      allocation: z.number().min(5).max(80),
      feeBps: z.number().min(0).max(100).default(10),
      slippageBps: z.number().min(0).max(100).default(5),
      trendPeriod: z.number().int().min(10).max(50).optional(),
      stopPct: z.number().min(1).max(20).optional(),
      targetPct: z.number().min(1).max(50).optional(),
      holdingDays: z.number().int().min(1).max(30).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ mode, ...raw }) => {
    const input = strategySchema.parse(raw);
    const candles = await getCandles(input.symbol, input.days + 50, mode);
    return text(evaluateStrategy(input, candles, mode));
  },
);

server.registerTool(
  'sentinel_develop_strategy',
  {
    title: 'Sentinel Strategy Developer',
    description:
      'Develop a conservative long-only spot setup, validate it on a held-out window, and return entry, stop, target, sizing, and wait/buy-setup decision.',
    inputSchema: {
      mode: modeSchema,
      symbol: z.string().describe('Binance USDT pair, e.g. BTCUSDT'),
      days: z.number().int().min(90).max(180),
      capital: z.number().min(10).max(10000000),
      allocation: z.number().min(5).max(25),
      feeBps: z.number().min(0).max(100).default(10),
      slippageBps: z.number().min(0).max(100).default(5),
      horizon: z.number().int().min(3).max(14).default(7),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ mode, ...raw }) => {
    const input = researchSchema.parse(raw);
    const candles = await getCandles(input.symbol, input.days + 50, mode);
    return text(developStrategy(input, candles, mode));
  },
);

server.registerTool(
  'sentinel_analyst',
  {
    title: 'Sentinel Analyst',
    description:
      'Ask Sentinel a grounded market, portfolio, or strategy question using retrieved market evidence and optional supplied portfolio data.',
    inputSchema: {
      message: z.string().trim().min(1).max(4000),
      mode: modeSchema,
      symbols: symbolsSchema,
      portfolio: portfolioSchema,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ message, mode, symbols, portfolio }) =>
    text(await analyzeWithOpenAI(message, mode, symbols, portfolio ?? null)),
);

server.registerTool(
  'sentinel_order_guard',
  {
    title: 'Sentinel Order Guard',
    description:
      'Read-only risk check for a proposed spot BUY amount before using a separate Binance execution tool.',
    inputSchema: {
      amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
      freeUSDT: z.string().regex(/^\d+(\.\d+)?$/),
      portfolioTotalUSDT: z.number().positive(),
      currentAssetValueUSDT: z.number().nonnegative().default(0),
      maxOrderUSDT: z.number().positive().max(25).default(25),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({
    amount,
    freeUSDT,
    portfolioTotalUSDT,
    currentAssetValueUSDT,
    maxOrderUSDT,
  }) => {
    checkOrderBudget(
      amount,
      freeUSDT,
      portfolioTotalUSDT,
      currentAssetValueUSDT,
      maxOrderUSDT,
    );
    return text({
      allowed: true,
      detail:
        'The proposal passes Sentinel risk limits. This tool is read-only and did not place an order.',
    });
  },
);

server.registerTool(
  'sentinel_binance_mcp_instructions',
  {
    title: 'Sentinel Binance MCP Instructions',
    description:
      'Explain how to pair Sentinel MCP analysis with the official Binance MCP for balances and account actions inside the same MCP-capable client.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () =>
    text({
      sentinelRole:
        'Use this MCP for market analysis, reports, strategy development, backtests, and risk checks.',
      binanceRole:
        'Use the official Binance MCP endpoint for account authorization, balances, and any real exchange action.',
      binanceMcpEndpoint: 'https://agent.binance.com/mcp/agentic',
      safety:
        'Run sentinel_order_guard before any proposed BUY. Sentinel MCP never places trades.',
    }),
);

normalizeSymbols();
await server.connect(new StdioServerTransport());
