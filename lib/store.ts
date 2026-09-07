import { env } from 'cloudflare:workers';
let schemaReady: Promise<void> | undefined;
export function database() {
  if (!env.DB) throw new Error('Database unavailable.');
  return env.DB;
}
export async function ensureSchema() {
  schemaReady ??= database()
    .batch([
      database()
        .prepare(
          'CREATE TABLE IF NOT EXISTS proposals (id text PRIMARY KEY NOT NULL, session_id text NOT NULL, payload text NOT NULL, status text NOT NULL, expires_at integer NOT NULL, result text)',
        )
        .bind(),
      database()
        .prepare(
          'CREATE TABLE IF NOT EXISTS records (id text PRIMARY KEY NOT NULL, session_id text NOT NULL, kind text NOT NULL, payload text NOT NULL, created_at integer NOT NULL)',
        )
        .bind(),
      database()
        .prepare(
          'CREATE INDEX IF NOT EXISTS idx_records_session_kind_created ON records (session_id, kind, created_at)',
        )
        .bind(),
      database()
        .prepare(
          'CREATE TABLE IF NOT EXISTS sessions (id text PRIMARY KEY NOT NULL, created_at integer NOT NULL, expires_at integer NOT NULL, oauth text, oauth_state text, oauth_expires integer)',
        )
        .bind(),
      database()
        .prepare(
          "CREATE UNIQUE INDEX IF NOT EXISTS idx_one_unresolved_proposal ON proposals (session_id) WHERE status IN ('pending', 'submitting', 'unknown')",
        )
        .bind(),
    ])
    .then(() => undefined);
  await schemaReady;
}
export function setting(name: string): string | undefined {
  return (env as unknown as Record<string, string>)[name] || process.env[name];
}
export function firstSetting(names: string[]): string | undefined {
  return names.map(setting).find(Boolean);
}
export function openAiConfig() {
  const key = firstSetting(['OPENAI_API_KEY', 'OPENAI_KEY']);
  const model = firstSetting([
    'OPENAI_MODEL',
    'OPENAI_API_MODEL',
    'OPENAI_RESPONSES_MODEL',
    'MODEL',
  ]);
  return {
    key,
    model,
    configured: Boolean(key && model),
    status: key
      ? model
        ? `AI analyst / ${model}`
        : 'OpenAI key found, model missing'
      : model
        ? 'OpenAI model found, key missing'
        : 'OpenAI key and model missing',
  };
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
