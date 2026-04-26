import { pgTable, serial, integer, real, timestamp, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userPreferencesTable = pgTable(
  "user_preferences",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    cookingTimePerDay: integer("cooking_time_per_day").notNull().default(45),
    weeklyBudget: real("weekly_budget").notNull().default(150),
    numberOfPeople: integer("number_of_people").notNull().default(2),
    allergies: text("allergies").array().notNull().default([]),
    dietaryPreferences: text("dietary_preferences").array().notNull().default([]),
    cuisinePreferences: text("cuisine_preferences").array().notNull().default([]),
    mealTypes: text("meal_types").array().notNull().default(["breakfast", "lunch", "dinner"]),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("user_preferences_user_id_unique").on(t.userId)],
);

export const insertUserPreferencesSchema = createInsertSchema(userPreferencesTable).omit({ id: true, updatedAt: true, userId: true });
export type InsertUserPreferences = z.infer<typeof insertUserPreferencesSchema>;
export type UserPreferences = typeof userPreferencesTable.$inferSelect;
