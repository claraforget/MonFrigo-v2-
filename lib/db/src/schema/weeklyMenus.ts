import { pgTable, serial, text, real, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const weeklyMenusTable = pgTable("weekly_menus", {
  id: serial("id").primaryKey(),
  weekStart: text("week_start").notNull(),
  days: jsonb("days").notNull().$type<object[]>(),
  estimatedCost: real("estimated_cost").notNull().default(0),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWeeklyMenuSchema = createInsertSchema(weeklyMenusTable).omit({ id: true, generatedAt: true });
export type InsertWeeklyMenu = z.infer<typeof insertWeeklyMenuSchema>;
export type WeeklyMenu = typeof weeklyMenusTable.$inferSelect;
