// One operational row per locality. The pending immutable email contains only
// aggregate counts, panel links and its recipient snapshot, never card data.
import { boolean, char, date, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { DailyEmailBatch } from "../../notifications/daily.ts";
import { localities } from "./locality.ts";

export const dailyAdminEmailState = pgTable("daily_admin_email_state", {
  localityCode: char("locality_code", { length: 5 })
    .primaryKey()
    .references(() => localities.code, { onDelete: "cascade" }),
  environment: text("environment").notNull(),
  day: date("day", { mode: "string" }).notNull(),
  completed: boolean("completed").notNull().default(false),
  // Written before the first external request, not inside its transaction.
  firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }).notNull(),
  // Cleared immediately after a successful send or a completed empty day.
  batch: jsonb("batch").$type<DailyEmailBatch>(),
});
