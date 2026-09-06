import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const client = new Client({ name: 'sentinel', version: '0.1.0' });
try {
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL('https://agent.binance.com/mcp/agentic'),
      {
        fetch: (url, init) =>
          fetch(url, { ...init, signal: AbortSignal.timeout(20000) }),
      },
    ),
  );
  console.log(JSON.stringify(await client.listTools(), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.close();
}
