import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'sentinel-mcp-test', version: '0.1.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['node_modules/tsx/dist/cli.mjs', 'scripts/sentinel-mcp.ts'],
  cwd: process.cwd(),
  stderr: 'pipe',
});

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name);
  assert.ok(names.includes('sentinel_market_snapshot'));
  assert.ok(names.includes('sentinel_develop_strategy'));
  assert.ok(names.includes('sentinel_order_guard'));

  const market = await client.callTool({
    name: 'sentinel_market_snapshot',
    arguments: { mode: 'demo', symbols: ['BTCUSDT', 'ETH'] },
  });
  assert.equal(market.content[0].type, 'text');
  assert.match(market.content[0].text, /ETHUSDT/);

  const strategy = await client.callTool({
    name: 'sentinel_develop_strategy',
    arguments: {
      mode: 'demo',
      symbol: 'BTCUSDT',
      days: 90,
      capital: 1000,
      allocation: 20,
      feeBps: 10,
      slippageBps: 5,
      horizon: 7,
    },
  });
  assert.match(strategy.content[0].text, /BUY_SETUP|WAIT/);

  const guard = await client.callTool({
    name: 'sentinel_order_guard',
    arguments: {
      amount: '10.00',
      freeUSDT: '500',
      portfolioTotalUSDT: 1000,
      currentAssetValueUSDT: 100,
      maxOrderUSDT: 25,
    },
  });
  assert.match(guard.content[0].text, /allowed/);
  console.log('PASS sentinel MCP server');
} finally {
  await client.close();
}
