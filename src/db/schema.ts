import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * The single source of truth for the database schema.
 *
 * Everything here is plain `drizzle-orm/pg-core`, which is what lets the same
 * definitions drive both the local PGlite instance and a hosted Postgres — see
 * `src/db/index.ts`. Do not fork this file per driver.
 *
 * T2 scope is auth only. The domain tables (shutdown records, sources,
 * attribution grades) land in T3 against the ZCZ-2 data dictionary.
 */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Stored already lower-cased and trimmed; see `normalizeEmail`. */
    email: text("email").notNull(),
    /** scrypt digest, never a reversible encoding. Format in `src/lib/password.ts`. */
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    /**
     * SHA-256 of the session token, not the token itself. The raw token only
     * ever lives in the client cookie, so a database leak cannot be replayed
     * as a login.
     */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
