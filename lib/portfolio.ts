import { z } from 'zod';
import { binancePublic } from './market';
import {
  findBalanceTool,
  readArguments,
  unpackResult,
  withMcp,
} from './binance-mcp';
import { audit } from './store';
import type { Portfolio } from './types';
const balance = z.object({
  asset: z.string().regex(/^[A-Z0-9]{1,24}$/),
  free: z.coerce
    .string()
    .refine((s) => Number.isFinite(Number(s)) && Number(s) >= 0),
  locked: z.coerce
    .string()
    .refine((s) => Number.isFinite(Number(s)) && Number(s) >= 0),
});
export function parseBalances(raw: unknown) {
  const schema = z.object({ balances: z.array(balance) });
  const direct = schema.safeParse(raw);
  if (direct.success) return direct.data.balances;
  const envelope = z.object({ data: schema }).safeParse(raw);
  if (envelope.success) return envelope.data.data.balances;
  throw new Error(
    'Unsupported Binance balance format. Holdings were not inferred.',
  );
}
export async function getPortfolio(
  sessionId: string,
  origin: string,
): Promise<Portfolio> {
  const balances = await withMcp(sessionId, origin, async (client, tools) => {
    const tool = findBalanceTool(tools);
    return parseBalances(
      unpackResult(
        await client.callTool({
          name: tool.name,
          arguments: readArguments(tool),
        }),
      ),
    );
  });
  const tickers = z
    .array(
      z.object({
        symbol: z.string(),
        price: z.coerce.number().positive(),
      }),
    )
    .parse(await binancePublic('/api/v3/ticker/price'));
  const prices = new Map(tickers.map((t) => [t.symbol, t.price]));
  const holdings = balances
    .filter((b) => Number(b.free) + Number(b.locked) > 0)
    .map((b) => {
      const quantity = Number(b.free) + Number(b.locked);
      const price =
        b.asset === 'USDT'
          ? 1
          : (prices.get(`${b.asset}USDT`) ??
            (prices.get(`USDT${b.asset}`)
              ? 1 / prices.get(`USDT${b.asset}`)!
              : null));
      return {
        ...b,
        quantity,
        price,
        value: price === null ? null : quantity * price,
        weight: null as number | null,
      };
    });
  const total = holdings.reduce((sum, h) => sum + (h.value ?? 0), 0);
  holdings.forEach((h) => {
    h.weight = h.value !== null && total > 0 ? (h.value / total) * 100 : null;
  });
  holdings.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  await audit(
    sessionId,
    'Portfolio refreshed',
    `${holdings.length} funded assets returned by the Agentic spot balance tool.`,
  );
  return {
    holdings,
    total,
    unpriced: holdings.filter((h) => h.value === null).length,
    asOf: new Date().toISOString(),
    scope: 'Agentic spot account',
  };
}
