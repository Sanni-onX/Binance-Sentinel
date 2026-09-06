import assert from 'node:assert/strict';
const origin = process.env.TEST_ORIGIN || 'http://localhost:3001';
let cookie = '';
async function request(path, body, options = {}) {
  const r = await fetch(`${origin}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body === undefined
        ? {}
        : { origin, 'content-type': 'application/json' }),
      ...options.headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    if (r.ok) throw new Error(`${path}: non-JSON success response`);
    data = { error: text };
  }
  return { r, data };
}
const session = await request('session');
assert.equal(session.r.status, 200);
cookie = session.r.headers.get('set-cookie').split(';')[0];
assert.ok(session.r.headers.get('set-cookie').includes('HttpOnly'));
const market = await request('market?mode=demo');
assert.equal(market.r.status, 200);
assert.equal(market.data.mode, 'demo');
assert.equal(market.data.assets.length, 2);
assert.equal(market.data.assets[0].candles.length, 230);
console.log('PASS sample market API');
const badMode = await request('market?mode=unknown');
assert.equal(badMode.r.status, 400);
const input = {
  symbol: 'BTCUSDT',
  strategy: 'trend',
  days: 90,
  capital: 1000,
  allocation: 25,
  feeBps: 10,
  slippageBps: 5,
  mode: 'demo',
};
const evaluation = await request('strategy/evaluate', input);
assert.equal(evaluation.r.status, 200);
assert.ok(Number.isFinite(evaluation.data.returnPct));
assert.equal(evaluation.data.curve.length, 91);
const saved = await request('evaluations');
assert.ok(saved.data.some((e) => e.id === evaluation.data.id));
console.log('PASS evaluation and persistence');
const invalid = await request('strategy/evaluate', {
  ...input,
  allocation: 101,
});
assert.equal(invalid.r.status, 400);
const report = await request('reports/generate', { mode: 'demo' });
assert.equal(report.r.status, 200);
assert.match(report.data.body, /Synthetic sample/);
const reports = await request('reports');
assert.ok(reports.data.some((r) => r.id === report.data.id));
console.log('PASS report generation and persistence');
const csrf = await request(
  'reports/generate',
  { mode: 'demo' },
  { headers: { origin: 'https://untrusted.example' } },
);
assert.equal(csrf.r.status, 403);
const ownerCookie = cookie;
cookie = '';
const anon = await request('reports/generate', { mode: 'demo' });
assert.equal(anon.r.status, 401);
const second = await request('session');
cookie = second.r.headers.get('set-cookie').split(';')[0];
const isolated = await request('reports');
assert.equal(isolated.data.length, 0);
cookie = ownerCookie;
console.log('PASS CSRF and session isolation');
const portfolio = await request('portfolio');
assert.equal(portfolio.r.status, 401);
const order = await request('orders/stage', {
  symbol: 'BTCUSDT',
  amount: '10.00',
});
assert.equal(order.r.status, 403);
const confirm = await request('orders/confirm', {
  id: crypto.randomUUID(),
  confirmed: true,
});
assert.equal(confirm.r.status, 409);
console.log('PASS disconnected account and live-order guards');
const chat = await request('agent/ask', {
  message: 'Develop a conservative strategy',
  mode: 'demo',
});
assert.equal(chat.r.status, 200);
assert.match(chat.data.answer, /SMA\(50\)|strategy/i);
const history = await request('chat');
assert.ok(history.data.length > 0);
console.log('PASS structured analyst and chat persistence');
const status = await request('binance/status');
assert.equal(status.data.connected, false);
console.log('All API integration checks passed. No live orders were placed.');
