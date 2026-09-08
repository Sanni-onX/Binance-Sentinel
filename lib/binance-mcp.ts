import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  auth,
  type OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { database, setting, audit } from './store';
import { HttpError } from './session';
export const MCP_URL = 'https://agent.binance.com/mcp/agentic';
const clientMetadataUrlFor = (origin: string) =>
  setting('BINANCE_CLIENT_METADATA_URL') ||
  `${origin}/api/binance/client-metadata`;
interface OAuthData {
  tokens?: OAuthTokens;
  receivedAt?: number;
  client?: OAuthClientInformationMixed;
  verifier?: string;
}
function base64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}
function unbase64(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
async function encryptionKey() {
  const key = setting('TOKEN_ENCRYPTION_KEY');
  if (!key || unbase64(key).length !== 32)
    throw new HttpError(
      503,
      'Account connection needs a configured token encryption key.',
    );
  return crypto.subtle.importKey('raw', unbase64(key), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}
async function seal(value: OAuthData) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `${base64(iv)}.${base64(new Uint8Array(encrypted))}`;
}
async function unseal(value: string): Promise<OAuthData> {
  const [iv, data] = value.split('.');
  return JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: unbase64(iv) },
        await encryptionKey(),
        unbase64(data),
      ),
    ),
  );
}
export async function oauthData(sessionId: string): Promise<OAuthData> {
  const row = await database()
    .prepare('SELECT oauth FROM sessions WHERE id = ?')
    .bind(sessionId)
    .first<{ oauth: string | null }>();
  return row?.oauth ? unseal(row.oauth) : {};
}
export async function hasToken(sessionId: string) {
  const data = await oauthData(sessionId);
  return Boolean(
    data.tokens?.access_token &&
    (!data.tokens.expires_in ||
      Date.now() < (data.receivedAt || 0) + data.tokens.expires_in * 1000),
  );
}
function isBinanceHttpsUrl(url: URL) {
  return (
    url.protocol === 'https:' &&
    (url.hostname === 'binance.com' || url.hostname.endsWith('.binance.com'))
  );
}
const safeFetch: typeof fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (!isBinanceHttpsUrl(url))
    throw new Error('Unexpected OAuth destination blocked.');
  return fetch(input, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
};
export async function provider(sessionId: string, origin: string) {
  const data = await oauthData(sessionId);
  let redirect: string | undefined;
  const save = async () => {
    await database()
      .prepare('UPDATE sessions SET oauth = ? WHERE id = ?')
      .bind(await seal(data), sessionId)
      .run();
  };
  const callback = `${origin}/api/binance/callback`;
  const clientMetadataUrl = clientMetadataUrlFor(origin);
  const configuredClientId = setting('BINANCE_CLIENT_ID');
  const p: OAuthClientProvider = {
    redirectUrl: callback,
    clientMetadataUrl,
    clientMetadata: {
      client_name: 'Sentinel',
      redirect_uris: [callback],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    clientInformation: () =>
      configuredClientId
        ? { client_id: configuredClientId }
        : data.client || { client_id: clientMetadataUrl },
    saveClientInformation: async (value) => {
      data.client = value;
      await save();
    },
    tokens: () =>
      data.tokens &&
      (!data.tokens.expires_in ||
        Date.now() < (data.receivedAt || 0) + data.tokens.expires_in * 1000)
        ? data.tokens
        : undefined,
    saveTokens: async (tokens) => {
      data.tokens = tokens;
      data.receivedAt = Date.now();
      delete data.verifier;
      await save();
    },
    state: async () => {
      const state = crypto.randomUUID();
      await database()
        .prepare(
          'UPDATE sessions SET oauth_state = ?, oauth_expires = ? WHERE id = ?',
        )
        .bind(state, Date.now() + 600000, sessionId)
        .run();
      return state;
    },
    redirectToAuthorization: (url) => {
      if (!isBinanceHttpsUrl(url))
        throw new Error('Unexpected authorization destination.');
      redirect = url.href;
    },
    saveCodeVerifier: async (verifier) => {
      data.verifier = verifier;
      await save();
    },
    codeVerifier: () => {
      if (!data.verifier)
        throw new Error('Authorization expired. Connect again.');
      return data.verifier;
    },
  };
  return { p, getRedirect: () => redirect };
}
export async function beginAuthorization(sessionId: string, origin: string) {
  if (
    !setting('BINANCE_CLIENT_ID') &&
    !new URL(
      setting('BINANCE_CLIENT_METADATA_URL') || origin,
    ).protocol.startsWith('https')
  )
    throw new HttpError(
      503,
      'Binance needs a publicly reachable HTTPS client metadata URL or a registered client ID. Configure BINANCE_CLIENT_METADATA_URL or BINANCE_CLIENT_ID to connect from localhost.',
    );
  const { p, getRedirect } = await provider(sessionId, origin);
  await auth(p, { serverUrl: MCP_URL, fetchFn: safeFetch });
  return { url: getRedirect() || origin };
}
export async function finishAuthorization(
  sessionId: string,
  origin: string,
  code: string,
  state: string,
) {
  const changed = await database()
    .prepare(
      'UPDATE sessions SET oauth_state = NULL, oauth_expires = NULL WHERE id = ? AND oauth_state = ? AND oauth_expires > ?',
    )
    .bind(sessionId, state, Date.now())
    .run();
  if (changed.meta.changes !== 1)
    throw new HttpError(400, 'Invalid or expired authorization state.');
  const { p } = await provider(sessionId, origin);
  await auth(p, {
    serverUrl: MCP_URL,
    authorizationCode: code,
    fetchFn: safeFetch,
  });
  await audit(
    sessionId,
    'Binance authorized',
    'OAuth authorization completed. Account tools can now be verified.',
  );
}
export async function withMcp<T>(
  sessionId: string,
  origin: string,
  fn: (client: Client, tools: Tool[]) => Promise<T>,
): Promise<T> {
  if (!(await hasToken(sessionId)))
    throw new HttpError(401, 'Connect your Binance Agentic account first.');
  const { p } = await provider(sessionId, origin);
  const client = new Client({ name: 'sentinel', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    authProvider: p,
    fetch: safeFetch,
    reconnectionOptions: {
      maxRetries: 0,
      initialReconnectionDelay: 1000,
      maxReconnectionDelay: 1000,
      reconnectionDelayGrowFactor: 1,
    },
  });
  try {
    await client.connect(transport);
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const result = await client.listTools({ cursor });
      tools.push(...result.tools);
      cursor = result.nextCursor;
      if (tools.length > 500)
        throw new Error('Unexpectedly large tool catalog.');
    } while (cursor);
    return await fn(client, tools);
  } finally {
    await client.close();
  }
}
export function unpackResult(result: unknown): unknown {
  const r = result as {
    isError?: boolean;
    structuredContent?: unknown;
    content?: { type: string; text?: string }[];
  };
  if (r.isError)
    throw new Error(
      'Binance rejected the tool request. Check account permissions and parameters.',
    );
  if (r.structuredContent) return r.structuredContent;
  const text = r.content
    ?.filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  if (!text) throw new Error('Binance returned no structured result.');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      'Binance returned an unsupported response format. No account data was inferred.',
    );
  }
}
export function findBalanceTool(tools: Tool[]) {
  const configured = setting('BINANCE_BALANCE_TOOL');
  const candidates = tools.filter(
    (t) =>
      t.annotations?.readOnlyHint === true &&
      !/main|master|margin|future|funding|transfer|withdraw/i.test(t.name) &&
      /balance|account/i.test(t.name),
  );
  const tool = configured
    ? candidates.find((t) => t.name === configured)
    : candidates.find((t) => /spot/i.test(t.name)) ||
      (candidates.length === 1 ? candidates[0] : undefined);
  if (!tool)
    throw new HttpError(
      503,
      'No unambiguous Agentic spot balance tool found. Configure BINANCE_BALANCE_TOOL using the connected tool catalog.',
    );
  return tool;
}
export function readArguments(tool: Tool) {
  const args: Record<string, unknown> = {};
  const props = tool.inputSchema.properties || {};
  for (const name of tool.inputSchema.required || []) {
    const schema = props[name] as { default?: unknown };
    if (schema && schema.default !== undefined) args[name] = schema.default;
    else if (name === 'recvWindow') args[name] = 5000;
    else
      throw new HttpError(
        503,
        `Balance tool requires unsupported parameter: ${name}.`,
      );
  }
  return args;
}
export function findOrderTool(tools: Tool[]) {
  const configured = setting('BINANCE_ORDER_TOOL');
  const candidates = tools.filter(
    (t) =>
      /spot/i.test(t.name) &&
      !/cancel|test|margin|future|oco|oto/i.test(t.name) &&
      t.inputSchema.properties?.symbol &&
      t.inputSchema.properties?.side &&
      t.inputSchema.properties?.type &&
      t.inputSchema.properties?.quoteOrderQty,
  );
  const tool = configured
    ? candidates.find((t) => t.name === configured)
    : candidates.length === 1
      ? candidates[0]
      : undefined;
  if (!tool)
    throw new HttpError(
      503,
      'A verified spot order tool with quoteOrderQty is required. Configure BINANCE_ORDER_TOOL from the connected catalog.',
    );
  for (const field of tool.inputSchema.required || [])
    if (
      !['symbol', 'side', 'type', 'quoteOrderQty', 'newClientOrderId'].includes(
        field,
      )
    )
      throw new HttpError(
        503,
        `Order tool requires unsupported parameter: ${field}.`,
      );
  return tool;
}
