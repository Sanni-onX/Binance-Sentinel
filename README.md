# Sentinel

A full-stack conservative Binance Agent OS workspace for BTC, BNB and an actual Agentic spot portfolio.

## Run locally

Node 22.13+ is required. On Windows use `npm.cmd` when PowerShell blocks `npm.ps1`.

```sh
npm install
node scripts/setup-local.mjs
npm run db:generate
npm exec wrangler -- d1 migrations apply DB --local --config wrangler.jsonc
npm run dev -- --host 127.0.0.1 --port 3001
```

Open the local URL printed by the server. The server chooses another port if occupied. `setup-local` creates an ignored `.dev.vars` encryption key without printing it. Preserve this key to retain access to encrypted authorization data.

## Implemented workflows

- Overview: live Binance Spot tickers, daily candles, BTC/BNB comparison, RSI, moving averages, realized volatility and a structured brief.
- Portfolio: authorized Agentic spot balances, available/locked amounts, actual market valuation and concentration review. Assets without a supported USDT price remain unpriced.
- Strategy lab: 50-day trend filter, weekly staged entry and buy-and-hold; 30/90/180-day windows; allocation, fees and slippage; same-allocation benchmark, daily drawdown and Sharpe ratio. Evaluations persist with their full parameters and curves.
- Reports: persisted market and portfolio reviews with Markdown export and data provenance.
- Analyst: grounded OpenAI Responses API conversation when configured; clearly labeled structured analytics otherwise. The model has no execution tools.
- Agent OS: OAuth 2.1/PKCE client, encrypted token storage, MCP discovery, account connection verification and an activity ledger.
- Orders: bounded spot BUY proposals, explicit confirmation, expiry, exact decimal risk checks, single-use submission and no automatic retries after an ambiguous result. Live trading is disabled by default.
- MCP mode: a local stdio MCP server exposes Sentinel market snapshots, reports, analyst answers, strategy development, strategy evaluation and order risk checks directly to MCP-capable clients.

Sample mode is synthetic and is explicitly selected; a failed live request never silently becomes a sample result. Sample runs do not establish Track B trade eligibility.

## Binance authorization

The official MCP endpoint is `https://agent.binance.com/mcp/agentic`. No Binance API secret is requested by this app.

Binance's authorization metadata advertises URL-based client registration. A custom client metadata document must be reachable over HTTPS. Localhost cannot be fetched by Binance. Configure one of:

1. `BINANCE_CLIENT_ID`: a client ID registered with Binance for this app and its exact callback.
2. `BINANCE_CLIENT_METADATA_URL`: a publicly reachable HTTPS metadata document identifying this client and listing the exact callback URI.
3. On a deployment with publicly retrievable metadata, use the built-in `/api/binance/client-metadata` route.

Set `APP_ORIGIN` to the exact origin. The callback is `/api/binance/callback`. A privately gated deployment may hide metadata from Binance, in which case a registered client or separately hosted public metadata document is necessary. Do not reuse another application's client identity.

In Agent OS, authorize with Binance, then verify the connection. Account scope is required for portfolio reads. Fund the Agentic sub-account manually through Binance. Actual authentication and account tool schemas must be verified with the user's account before enabling live trading.

The adapter discovers real tool names after authorization. If discovery is ambiguous, set `BINANCE_BALANCE_TOOL` and `BINANCE_ORDER_TOOL` to exact names from the catalog. The current balance adapter accepts `{ balances: [{ asset, free, locked }] }`, optionally wrapped in `data`. Trading requires a spot order tool exposing `symbol`, `side`, `type`, `quoteOrderQty` and `newClientOrderId`. Unsupported formats fail closed and require a reviewed adapter extension.

## Analyst configuration

Add `OPENAI_API_KEY` and `OPENAI_MODEL` to ignored `.dev.vars` locally or deployment secrets. Choose a Responses API model available to your API project. Neither key nor Binance tokens are sent to the browser. The analyst sends the user's question, recent conversation and retrieved market/portfolio context to OpenAI when configured. No key is included in the project. Without configuration, structured analytics remains usable and is labeled as such.

## Execution limits

`ENABLE_LIVE_TRADING=true` is required to stage orders after connection verification. `MAX_ORDER_USDT` can lower, but not exceed, 25 USDT. Each order must remain within 5% of priced portfolio value, preserve 20% in available USDT, and keep the purchased asset within 50% of priced holdings. Exchange minimum notionals also apply, so a very small account may not support a compliant order.

Confirmation rechecks balances and rejects a reference-price move over 0.5%. This is a pre-submission check, not a guaranteed fill-price limit on a market order. An ambiguous exchange response is marked unknown and is never retried automatically. Check Binance order history and balances before any further action. Submitted does not mean filled.

Limits apply to this app's session and observed account snapshot. Other clients can change the same account independently. Keep one active execution session. There is no withdrawal, margin, futures, payment or onchain execution in this version.

## Sentinel MCP server

Use the MCP server when the web OAuth flow is unavailable and you want to operate Sentinel directly from an MCP-capable client such as Codex or a ChatGPT app that supports local MCP connectors.

The server is stdio-based. Configure the client to run this command from the project root:

```sh
node node_modules/tsx/dist/cli.mjs scripts/sentinel-mcp.ts
```

Do not put `npm run mcp` in a stdio MCP client config unless that client explicitly tolerates npm wrapper output. The package script is convenient for manual launching:

```sh
npm run mcp
```

Available tools:

- `sentinel_market_snapshot`: live or demo indicators for tracked USDT pairs.
- `sentinel_market_report`: conservative market and optional portfolio report.
- `sentinel_analyst`: grounded analyst response using retrieved market evidence and optional supplied portfolio data. Uses `OPENAI_API_KEY` and `OPENAI_MODEL` when present, otherwise returns structured analytics.
- `sentinel_evaluate_strategy`: backtests one supplied rule set.
- `sentinel_develop_strategy`: develops and validates a conservative long-only spot setup with entry, stop, target, sizing and wait/buy-setup decision.
- `sentinel_order_guard`: read-only risk check for a proposed BUY before using a separate Binance execution tool.
- `sentinel_binance_mcp_instructions`: explains how to pair Sentinel MCP with the official Binance MCP endpoint.

Recommended pairing:

1. Connect this Sentinel MCP for analysis and strategy work.
2. Connect Binance's official MCP endpoint for account authorization and balance/order tools: `https://agent.binance.com/mcp/agentic`.
3. Ask Sentinel to analyze, develop a setup, and run `sentinel_order_guard`.
4. Use Binance MCP only for reviewed account reads or actions. Sentinel MCP itself never places trades.

## Data and architecture

- React / TypeScript, Vinext, Cloudflare-compatible server routes, D1 SQLite.
- Official MCP SDK for transport and OAuth; `technicalindicators` for indicators; `decimal.js` for order budget arithmetic; Zod for validation.
- `lib/market.ts`, `strategy.ts`, `portfolio.ts`: market and analytical domains.
- `lib/binance-mcp.ts`, `orders.ts`, `risk.ts`: connection and execution boundaries.
- `app/api/[...path]/route.ts`: validated HTTP endpoints.
- `db/schema.ts`, `drizzle/`: schema and migrations.
- Reports, history and OAuth are isolated by a secure opaque browser session cookie. The session lasts seven days. Clearing cookies creates a new workspace session; cross-device identity recovery is not implemented.
- Market context describes observed price changes, not unverified news or macroeconomic causes. Backtests exclude taxes, exchange lot rounding, liquidity and intraday drawdown; open positions are marked to market.

## Verification

```sh
npm run typecheck
npm test
npm run test:api
npm run test:mcp
npm run build
```

API tests require the local server and migrated D1 database. They create test-session reports and evaluations, check isolation and rejected mutations, and never place a live trade. Set `TEST_ORIGIN` if the server uses another port.

## Sources

- [Binance Agent OS MCP documentation](https://developers.binance.com/en/docs/agent-native/mcp-server/agentic)
- [Binance Spot market endpoints](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market)
- [MCP authorization](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/authorization)
- [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses)

## Remaining account-dependent verification

The Binance consent flow, actual balance schema, live order tool schema, execution receipt and Track B eligibility require the user's authorized account. The AI provider requires a configured key and model. These are not claimed as verified by local sample tests.
