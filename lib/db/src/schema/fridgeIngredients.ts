import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const fridgeIngredientsTable = pgTable("fridge_ingredients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  quantity: text("quantity").notNull(),
  unit: text("unit").notNull(),
  category: text("category").notNull(),
  conservationType: text("conservation_type").notNull().default("frais"),
  expiryDate: text("expiry_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFridgeIngredientSchema = createInsertSchema(fridgeIngredientsTable).omit({ id: true, createdAt: true });
export type InsertFridgeIngredient = z.infer<typeof insertFridgeIngredientSchema>;
export type FridgeIngredient = typeof fridgeIngredientsTable.$inferSelect;
