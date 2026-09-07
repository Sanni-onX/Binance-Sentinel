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
import {
  audit,
  database,
  listRecords,
  openAiConfig,
  saveRecord,
  setting,
} from '@/lib/store';
import { getMarket, getCandles } from '@/lib/market';
import { evaluateStrategy, strategySchema } from '@/lib/strategy';
import {
  calculateOutcome,
  developStrategy,
  researchSchema,
} from '@/lib/strategy-research';
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
const symbolsFromUrl = (url: URL) => url.searchParams.get('symbols');
const symbolsFromBody = (body: unknown) =>
  z
    .object({ symbols: z.array(z.string()).max(8).optional() })
    .loose()
    .parse(body).symbols;
const binanceMetadataUrl = (origin: string) =>
  setting('BINANCE_CLIENT_METADATA_URL') ||
  `${origin}/api/binance/client-metadata`;
const binanceOAuthStatus = (origin: string) => {
  if (setting('BINANCE_CLIENT_ID'))
    return {
      ready: true,
      mode: 'registered_client',
      label: 'Registered client ID',
    };
  const metadataUrl = binanceMetadataUrl(origin);
  if (metadataUrl.startsWith('https:'))
    return {
      ready: true,
      mode: 'public_metadata',
      label: 'Public metadata URL',
    };
  return {
    ready: false,
    mode: 'local_only',
    label: 'Needs public HTTPS metadata',
  };
};
const route = (req: Request) =>
  new URL(req.url).pathname.replace(/^\/api\//, '').replace(/\/$/, '');
export async function GET(request: Request) {
  try {
    const path = route(request),
      url = new URL(request.url);
    if (path === 'health') return json({ status: 'ok', service: 'sentinel' });
    if (path === 'binance/client-metadata') {
      const origin = trustedOrigin(request);
      const metadataUrl = binanceMetadataUrl(origin);
      return json({
        client_id: metadataUrl,
        client_name: 'Sentinel',
        redirect_uris: [`${origin}/api/binance/callback`],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      });
    }
    const session = await getSession(request, true);
    if (path === 'session') {
      const ai = openAiConfig(),
        origin = trustedOrigin(request),
        binanceOAuth = binanceOAuthStatus(origin);
      return json(
        {
          aiConfigured: ai.configured,
          aiStatus: ai.status,
          tradingEnabled: setting('ENABLE_LIVE_TRADING') === 'true',
          oauthReady: binanceOAuth.ready,
          oauthMode: binanceOAuth.mode,
          oauthStatus: binanceOAuth.label,
        },
        200,
        session.cookie,
      );
    }
    if (path === 'market')
      return json(
        await getMarket(
          modeSchema.parse(url.searchParams.get('mode') || undefined),
          symbolsFromUrl(url),
        ),
        200,
        session.cookie,
      );
    if (path === 'reports')
      return json(await listRecords(session.id, 'report'), 200, session.cookie);
    if (path === 'strategies' || path === 'strategy/outcomes')
      return json(
        await listRecords(
          session.id,
          path === 'strategies' ? 'strategy' : 'strategy-outcome',
          200,
        ),
        200,
        session.cookie,
      );
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
    if (path === 'strategy/develop') {
      const input = researchSchema.parse(body);
      const mode = modeSchema.parse(body.mode);
      const candles = await getCandles(input.symbol, input.days + 50, mode);
      const result = await saveRecord(
        session.id,
        'strategy',
        developStrategy(input, candles, mode),
      );
      await audit(
        session.id,
        'Strategy developed',
        `${input.symbol}: development and held-out validation (${mode}).`,
      );
      return json(result);
    }
    if (path === 'strategy/outcomes') {
      const outcome = calculateOutcome(body);
      const owned = await database()
        .prepare(
          "SELECT payload FROM records WHERE id = ? AND session_id = ? AND kind = 'strategy'",
        )
        .bind(outcome.strategyId, session.id)
        .first<{ payload: string }>();
      if (!owned) throw new HttpError(404, 'Strategy not found.');
      if (
        JSON.parse(owned.payload).mode === 'demo' &&
        outcome.execution === 'actual'
      )
        throw new HttpError(
          400,
          'Sample strategies can only have paper outcomes.',
        );
      const saved = await saveRecord(session.id, 'strategy-outcome', outcome);
      await audit(
        session.id,
        'Strategy outcome recorded',
        `${outcome.execution} result, manually reported.`,
      );
      return json(saved);
    }
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
      const market = await getMarket(mode, symbolsFromBody(body));
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
        `Tracked market pairs and available portfolio data (${mode}).`,
      );
      return json(saved);
    }
    if (path === 'agent/ask') {
      const { message, mode, symbols } = z
        .object({
          message: z.string().trim().min(1).max(2000),
          mode: modeSchema,
          symbols: z.array(z.string()).max(8).optional(),
        })
        .parse(body);
      let portfolio: Portfolio | null = null;
      if (mode === 'live' && (await hasToken(session.id)))
        portfolio = await getPortfolio(session.id, trustedOrigin(request));
      return json(
        await askAgent(session.id, message, mode, portfolio, symbols),
      );
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
