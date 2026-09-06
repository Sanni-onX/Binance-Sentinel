import { database, setting } from './store';
import { HttpError } from './errors';
export { HttpError } from './errors';
export function configuredOrigin() {
  const value = setting('APP_ORIGIN');
  if (value) {
    const url = new URL(value);
    if (url.pathname !== '/' || url.search || url.hash)
      throw new Error('APP_ORIGIN must be an origin without a path.');
    return url.origin;
  }
  return undefined;
}
export function trustedOrigin(request: Request) {
  const origin = configuredOrigin();
  const current = new URL(request.url);
  if (origin) return origin;
  if (['localhost', '127.0.0.1'].includes(current.hostname))
    return current.origin;
  throw new HttpError(503, 'Set APP_ORIGIN to the deployed app origin.');
}
export function checkMutation(request: Request) {
  const origin = request.headers.get('origin');
  if (origin !== trustedOrigin(request))
    throw new HttpError(403, 'Request origin is not allowed.');
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new HttpError(415, 'JSON requests are required.');
}
export async function getSession(
  request: Request,
  create = false,
): Promise<{ id: string; cookie?: string }> {
  const candidate = request.headers
    .get('cookie')
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('sentinel_session='))
    ?.slice(17);
  if (candidate && /^[a-f0-9]{64}$/.test(candidate)) {
    const row = await database()
      .prepare('SELECT id FROM sessions WHERE id = ? AND expires_at > ?')
      .bind(candidate, Date.now())
      .first<{ id: string }>();
    if (row) return { id: row.id };
  }
  if (!create) throw new HttpError(401, 'Session expired. Refresh the page.');
  const id = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  await database()
    .prepare(
      'INSERT INTO sessions (id, created_at, expires_at) VALUES (?, ?, ?)',
    )
    .bind(id, Date.now(), Date.now() + 7 * 86400000)
    .run();
  const secure = new URL(request.url).protocol === 'https:';
  return {
    id,
    cookie: `sentinel_session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure ? '; Secure' : ''}`,
  };
}
export function json(data: unknown, status = 200, cookie?: string) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(cookie ? { 'Set-Cookie': cookie } : {}),
    },
  });
}
export function fail(error: unknown) {
  if (error instanceof HttpError)
    return json({ error: error.message }, error.status);
  if (error instanceof Error && error.name === 'ZodError')
    return json({ error: 'Invalid request parameters.' }, 400);
  return json(
    { error: error instanceof Error ? error.message : 'Request failed.' },
    502,
  );
}
export async function readJson(request: Request) {
  const body = await request.text();
  if (body.length > 16000) throw new HttpError(413, 'Request is too large.');
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, 'Invalid JSON.');
  }
}
