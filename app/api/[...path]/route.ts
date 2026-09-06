import { z } from 'zod';
import {
  checkMutation,
  fail,
  getSession,
  HttpError,
  json,
  readJson,
  trustedOrigin,
} from '@/lib/session';
import { audit, database, listRecords, saveRecord, setting } from '@/lib/store';
import { getMarket, getCandles } from '@/lib/market';
import { evaluateStrategy, strategySchema } from '@/lib/strategy';
import {
  beginAuthorization,
  finishAuthorization,
  hasToken,
  withMcp,
} from '@/lib/binance-mcp';
import { getPortfolio } from '@/lib/portfolio';
import { marketReport } from '@/lib/reports';
import { askAgent } from '@/lib/agent';
import { confirmOrder, stageOrder } from '@/lib/orders';
import type { Portfolio } from '@/lib/types';
const modeSchema = z.enum(['live', 'demo']).default('live');
const route = (req: Request) =>
  new URL(req.url).pathname.replace(/^\/api\//, '').replace(/\/$/, '');
export async function GET(request: Request) {
  try {
    const path = route(request),
      url = new URL(request.url);
    if (path === 'health') return json({ status: 'ok', service: 'sentinel' });
    if (path === 'binance/client-metadata') {
      const origin = trustedOrigin(request);
      return json({
        client_id:
          setting('BINANCE_CLIENT_METADATA_URL') ||
          `${origin}/api/binance/client-metadata`,
        client_name: 'Sentinel',
        redirect_uris: [`${origin}/api/binance/callback`],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      });
    }
    const session = await getSession(request, true);
    if (path === 'session')
      return json(
        {
          aiConfigured: Boolean(
            setting('OPENAI_API_KEY') && setting('OPENAI_MODEL'),
          ),
          tradingEnabled: setting('ENABLE_LIVE_TRADING') === 'true',
          oauthReady: Boolean(
            setting('BINANCE_CLIENT_ID') ||
            setting('BINANCE_CLIENT_METADATA_URL')?.startsWith('https:') ||
            trustedOrigin(request).startsWith('https:'),
          ),
        },
        200,
        session.cookie,
      );
    if (path === 'market')
      return json(
        await getMarket(
          modeSchema.parse(url.searchParams.get('mode') || undefined),
        ),
        200,
        session.cookie,
      );
    if (path === 'reports')
      return json(await listRecords(session.id, 'report'), 200, session.cookie);
    if (path === 'evaluations')
      return json(
        await listRecords(session.id, 'evaluation', 10),
        200,
        session.cookie,
      );
    if (path === 'activity')
      return json(
        await listRecords(session.id, 'activity'),
        200,
        session.cookie,
      );
    if (path === 'chat')
      return json(
        (await listRecords(session.id, 'chat', 20)).reverse(),
        200,
        session.cookie,
      );
    if (path === 'portfolio')
      return json(
        await getPortfolio(session.id, trustedOrigin(request)),
        200,
        session.cookie,
      );
    if (path === 'binance/status') {
      const tokenPresent = await hasToken(session.id);
      if (!tokenPresent)
        return json(
          { connected: false, tokenPresent: false, tools: [] },
          200,
          session.cookie,
        );
      try {
        const tools = await withMcp(
          session.id,
          trustedOrigin(request),
          async (_client, tools) =>
            tools.map((t) => ({
              name: t.name,
              description: t.description,
              readOnly: t.annotations?.readOnlyHint === true,
            })),
        );
        return json(
          { connected: true, tokenPresent, tools },
          200,
          session.cookie,
        );
      } catch (e) {
        return json(
          {
            connected: false,
            tokenPresent,
            tools: [],
            error: e instanceof Error ? e.message : 'Connection check failed.',
          },
          200,
          session.cookie,
        );
      }
    }
    if (path === 'binance/callback') {
      if (url.searchParams.has('error'))
        return Response.redirect(
          `${trustedOrigin(request)}/?view=Agent%20OS&connection=denied`,
          303,
        );
      await finishAuthorization(
        session.id,
        trustedOrigin(request),
        z.string().min(1).parse(url.searchParams.get('code')),
        z.string().min(1).parse(url.searchParams.get('state')),
      );
      return Response.redirect(
        `${trustedOrigin(request)}/?view=Agent%20OS&connection=authorized`,
        303,
      );
    }
    throw new HttpError(404, 'Endpoint not found.');
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const session = await getSession(request);
    const path = route(request);
    const body = await readJson(request);
    if (path === 'binance/connect')
      return json(await beginAuthorization(session.id, trustedOrigin(request)));
    if (path === 'binance/disconnect') {
      await database()
        .prepare(
          'UPDATE sessions SET oauth = NULL, oauth_state = NULL, oauth_expires = NULL WHERE id = ?',
        )
        .bind(session.id)
        .run();
      await audit(
        session.id,
        'Connection removed',
        'Local tokens removed. Manage Binance grants in your Binance account.',
      );
      return json({ disconnected: true });
    }
    if (path === 'strategy/evaluate') {
      const input = strategySchema.parse(body);
      const mode = modeSchema.parse(body.mode);
      const candles = await getCandles(input.symbol, input.days + 50, mode);
      const evaluation = evaluateStrategy(input, candles, mode);
      const saved = await saveRecord(session.id, 'evaluation', evaluation);
      await audit(
        session.id,
        'Strategy evaluated',
        `${input.symbol}: ${input.strategy}, ${input.days} days (${mode}).`,
      );
      return json(saved);
    }
    if (path === 'reports/generate') {
      const mode = modeSchema.parse(body.mode);
      const market = await getMarket(mode);
      let portfolio: Portfolio | null = null;
      if (mode === 'live' && (await hasToken(session.id)))
        portfolio = await getPortfolio(session.id, trustedOrigin(request));
      const saved = await saveRecord(session.id, 'report', {
        title: `${mode === 'demo' ? 'Sample / ' : ''}Market & portfolio review`,
        body: marketReport(market, portfolio),
        mode,
      });
      await audit(
        session.id,
        'Report generated',
        `BTC, BNB and available portfolio data (${mode}).`,
      );
      return json(saved);
    }
    if (path === 'agent/ask') {
      const { message, mode } = z
        .object({
          message: z.string().trim().min(1).max(2000),
          mode: modeSchema,
        })
        .parse(body);
      let portfolio: Portfolio | null = null;
      if (mode === 'live' && (await hasToken(session.id)))
        portfolio = await getPortfolio(session.id, trustedOrigin(request));
      return json(await askAgent(session.id, message, mode, portfolio));
    }
    if (path === 'orders/stage')
      return json(await stageOrder(session.id, trustedOrigin(request), body));
    if (path === 'orders/confirm') {
      const input = z
        .object({ id: z.uuid(), confirmed: z.literal(true) })
        .parse(body);
      return json(
        await confirmOrder(session.id, trustedOrigin(request), input.id),
      );
    }
    if (path === 'orders/cancel') {
      const { id } = z.object({ id: z.uuid() }).parse(body);
      await database()
        .prepare(
          "UPDATE proposals SET status = 'cancelled' WHERE id = ? AND session_id = ? AND status = 'pending'",
        )
        .bind(id, session.id)
        .run();
      return json({ cancelled: true });
    }
    throw new HttpError(404, 'Endpoint not found.');
  } catch (error) {
    return fail(error);
  }
}
