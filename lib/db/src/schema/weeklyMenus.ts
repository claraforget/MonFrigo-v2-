import { pgTable, serial, text, real, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const weeklyMenusTable = pgTable(
  "weekly_menus",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    weekStart: text("week_start").notNull(),
    days: jsonb("days").notNull().$type<object[]>(),
    estimatedCost: real("estimated_cost").notNull().default(0),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("weekly_menus_user_id_idx").on(t.userId)],
);

export const insertWeeklyMenuSchema = createInsertSchema(weeklyMenusTable).omit({ id: true, generatedAt: true, userId: true });
export type InsertWeeklyMenu = z.infer<typeof insertWeeklyMenuSchema>;
export type WeeklyMenu = typeof weeklyMenusTable.$inferSelect;
