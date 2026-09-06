import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  oauth: text('oauth'),
  oauthState: text('oauth_state'),
  oauthExpires: integer('oauth_expires'),
});
export const records = sqliteTable(
  'records',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    kind: text('kind').notNull(),
    payload: text('payload').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_records_session_kind_created').on(
      t.sessionId,
      t.kind,
      t.createdAt,
    ),
  ],
);
export const proposals = sqliteTable(
  'proposals',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    payload: text('payload').notNull(),
    status: text('status').notNull(),
    expiresAt: integer('expires_at').notNull(),
    result: text('result'),
  },
  (t) => [
    uniqueIndex('idx_one_unresolved_proposal')
      .on(t.sessionId)
      .where(sql`${t.status} IN ('pending', 'submitting', 'unknown')`),
  ],
);
