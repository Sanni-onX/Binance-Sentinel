import Decimal from 'decimal.js';
import { z } from 'zod';
import { database, setting, audit } from './store';
import { HttpError } from './session';
import { binancePublic, getMarket } from './market';
import { getPortfolio } from './portfolio';
import { findOrderTool, unpackResult, withMcp } from './binance-mcp';
export const orderInput = z.object({
  symbol: z.enum(['BTCUSDT', 'BNBUSDT']),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
});
export interface Proposal {
  id: string;
  symbol: string;
  side: 'BUY';
  type: 'MARKET';
  quoteOrderQty: string;
  clientOrderId: string;
  tool: string;
  expiresAt: number;
  referencePrice: number;
  status: string;
}
import { checkOrderBudget } from './risk';
async function checkLive(
  sessionId: string,
  origin: string,
  symbol: string,
  amount: string,
) {
  if (setting('ENABLE_LIVE_TRADING') !== 'true')
    throw new HttpError(
      403,
      'Live trading is disabled in server configuration.',
    );
  const max = Number(setting('MAX_ORDER_USDT') || 25);
  if (!Number.isFinite(max) || max <= 0 || max > 25)
    throw new HttpError(
      503,
      'MAX_ORDER_USDT must be above zero and no more than 25.',
    );
  const portfolio = await getPortfolio(sessionId, origin);
  if (portfolio.unpriced)
    throw new HttpError(
      400,
      'Unpriced holdings prevent a complete exposure check.',
    );
  checkOrderBudget(
    amount,
    portfolio.holdings.find((h) => h.asset === 'USDT')?.free || '0',
    portfolio.total,
    portfolio.holdings.find((h) => h.asset === symbol.replace('USDT', ''))
      ?.value || 0,
    max,
  );
}
export async function stageOrder(
  sessionId: string,
  origin: string,
  raw: unknown,
) {
  const input = orderInput.parse(raw);
  await database()
    .prepare(
      "UPDATE proposals SET status = 'expired' WHERE session_id = ? AND status = 'pending' AND expires_at < ?",
    )
    .bind(sessionId, Date.now())
    .run();
  const outstanding = await database()
    .prepare(
      "SELECT id FROM proposals WHERE session_id = ? AND status IN ('pending', 'submitting', 'unknown')",
    )
    .bind(sessionId)
    .first();
  if (outstanding)
    throw new HttpError(
      409,
      'Resolve the existing order proposal before preparing another.',
    );
  await checkLive(sessionId, origin, input.symbol, input.amount);
  const exchange = z
    .object({
      symbols: z.array(
        z.object({
          symbol: z.string(),
          status: z.string(),
          isSpotTradingAllowed: z.boolean(),
          quoteOrderQtyMarketAllowed: z.boolean(),
          filters: z.array(
            z.object({
              filterType: z.string(),
              minNotional: z.coerce.number().optional(),
              maxNotional: z.coerce.number().optional(),
            }),
          ),
        }),
      ),
    })
    .parse(
      await binancePublic('/api/v3/exchangeInfo', { symbol: input.symbol }),
    );
  const rules = exchange.symbols.find((s) => s.symbol === input.symbol);
  if (
    !rules ||
    rules.status !== 'TRADING' ||
    !rules.isSpotTradingAllowed ||
    !rules.quoteOrderQtyMarketAllowed
  )
    throw new HttpError(
      400,
      'This symbol does not support the requested spot market order.',
    );
  for (const filter of rules.filters) {
    if (filter.minNotional && new Decimal(input.amount).lt(filter.minNotional))
      throw new HttpError(
        400,
        `Minimum order notional is ${filter.minNotional} USDT.`,
      );
    if (filter.maxNotional && new Decimal(input.amount).gt(filter.maxNotional))
      throw new HttpError(400, 'Order exceeds the symbol maximum notional.');
  }
  const tool = await withMcp(
    sessionId,
    origin,
    async (_client, tools) => findOrderTool(tools).name,
  );
  const market = await getMarket('live');
  const id = crypto.randomUUID();
  const proposal: Proposal = {
    id,
    symbol: input.symbol,
    side: 'BUY',
    type: 'MARKET',
    quoteOrderQty: new Decimal(input.amount).toFixed(2),
    clientOrderId: `sn${id.replaceAll('-', '')}`,
    tool,
    expiresAt: Date.now() + 60000,
    referencePrice: market.assets.find((a) => a.symbol === input.symbol)!.price,
    status: 'pending',
  };
  await database()
    .prepare(
      'INSERT INTO proposals (id, session_id, payload, status, expires_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(
      id,
      sessionId,
      JSON.stringify(proposal),
      'pending',
      proposal.expiresAt,
    )
    .run();
  await audit(
    sessionId,
    'Order staged',
    `BUY ${proposal.quoteOrderQty} USDT of ${proposal.symbol}; awaiting confirmation.`,
  );
  return proposal;
}
export async function confirmOrder(
  sessionId: string,
  origin: string,
  id: string,
) {
  const row = await database()
    .prepare(
      'SELECT payload, status, expires_at FROM proposals WHERE id = ? AND session_id = ?',
    )
    .bind(id, sessionId)
    .first<{ payload: string; status: string; expires_at: number }>();
  if (!row || row.status !== 'pending' || row.expires_at < Date.now())
    throw new HttpError(409, 'Order proposal is expired or already submitted.');
  const p: Proposal = JSON.parse(row.payload);
  await checkLive(sessionId, origin, p.symbol, p.quoteOrderQty);
  const tick = z
    .object({ price: z.coerce.number().positive() })
    .parse(await binancePublic('/api/v3/ticker/price', { symbol: p.symbol }));
  if (Math.abs(tick.price / p.referencePrice - 1) > 0.005)
    throw new HttpError(
      409,
      'Price moved more than 0.5%. Stage a new proposal.',
    );
  return withMcp(sessionId, origin, async (client, tools) => {
    const tool = findOrderTool(tools);
    if (tool.name !== p.tool)
      throw new HttpError(409, 'Order tool changed. Stage a new proposal.');
    const args: Record<string, unknown> = {
      symbol: p.symbol,
      side: p.side,
      type: p.type,
      quoteOrderQty: p.quoteOrderQty,
    };
    if (!tool.inputSchema.properties?.newClientOrderId)
      throw new HttpError(
        503,
        'Order tool must support an explicit client order ID.',
      );
    args.newClientOrderId = p.clientOrderId;
    const amountSchema = tool.inputSchema.properties?.quoteOrderQty as {
      type?: string;
    };
    if (amountSchema.type === 'number')
      args.quoteOrderQty = Number(p.quoteOrderQty);
    // Claim once before the external side effect. Ambiguous failures are never retried.
    const claim = await database()
      .prepare(
        "UPDATE proposals SET status = 'submitting' WHERE id = ? AND session_id = ? AND status = 'pending' AND expires_at > ?",
      )
      .bind(id, sessionId, Date.now())
      .run();
    if (claim.meta.changes !== 1)
      throw new HttpError(409, 'Proposal already used or expired.');
    try {
      const result = unpackResult(
        await client.callTool({ name: tool.name, arguments: args }),
      );
      await database()
        .prepare(
          "UPDATE proposals SET status = 'submitted', result = ? WHERE id = ?",
        )
        .bind(JSON.stringify(result), id)
        .run();
      await audit(
        sessionId,
        'Order submitted',
        `${p.symbol}; client reference ${p.clientOrderId}. Verify the exchange receipt.`,
      );
      return { status: 'submitted', result, clientOrderId: p.clientOrderId };
    } catch {
      await database()
        .prepare("UPDATE proposals SET status = 'unknown' WHERE id = ?")
        .bind(id)
        .run();
      await audit(
        sessionId,
        'Order outcome unknown',
        `Check Binance order history for ${p.clientOrderId} before creating another order.`,
      );
      throw new HttpError(
        502,
        'Order outcome is unknown. Do not retry. Check Binance order history using the client reference.',
      );
    }
  });
}
