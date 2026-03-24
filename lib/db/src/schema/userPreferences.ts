import { pgTable, serial, integer, real, timestamp, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userPreferencesTable = pgTable("user_preferences", {
  id: serial("id").primaryKey(),
  cookingTimePerDay: integer("cooking_time_per_day").notNull().default(45),
  weeklyBudget: real("weekly_budget").notNull().default(150),
  numberOfPeople: integer("number_of_people").notNull().default(2),
  allergies: text("allergies").array().notNull().default([]),
  dietaryPreferences: text("dietary_preferences").array().notNull().default([]),
  cuisinePreferences: text("cuisine_preferences").array().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserPreferencesSchema = createInsertSchema(userPreferencesTable).omit({ id: true, updatedAt: true });
export type InsertUserPreferences = z.infer<typeof insertUserPreferencesSchema>;
export type UserPreferences = typeof userPreferencesTable.$inferSelect;
