import { env } from 'cloudflare:workers';
export function database() {
  if (!env.DB) throw new Error('Database unavailable.');
  return env.DB;
}
export function setting(name: string): string | undefined {
  return (env as unknown as Record<string, string>)[name] || process.env[name];
}
export async function saveRecord(
  sessionId: string,
  kind: string,
  payload: unknown,
) {
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  await database()
    .prepare(
      'INSERT INTO records (id, session_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(id, sessionId, kind, JSON.stringify(payload), createdAt)
    .run();
  return { id, createdAt, ...(payload as object) };
}
export async function listRecords<T>(
  sessionId: string,
  kind: string,
  limit = 40,
): Promise<T[]> {
  const rows = await database()
    .prepare(
      'SELECT id, payload, created_at FROM records WHERE session_id = ? AND kind = ? ORDER BY created_at DESC LIMIT ?',
    )
    .bind(sessionId, kind, limit)
    .all<{ id: string; payload: string; created_at: number }>();
  return rows.results.map((r) => ({
    ...JSON.parse(r.payload),
    id: r.id,
    createdAt: r.created_at,
  }));
}
export const audit = (sessionId: string, action: string, detail: string) =>
  saveRecord(sessionId, 'activity', { action, detail });
