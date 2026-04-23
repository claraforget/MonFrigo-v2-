import { pgTable, text, serial, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const fridgeIngredientsTable = pgTable(
  "fridge_ingredients",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    quantity: text("quantity").notNull(),
    unit: text("unit").notNull(),
    category: text("category").notNull(),
    conservationType: text("conservation_type").notNull().default("frais"),
    expiryDate: text("expiry_date"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("fridge_ingredients_user_id_idx").on(t.userId)],
);

export const insertFridgeIngredientSchema = createInsertSchema(fridgeIngredientsTable).omit({ id: true, createdAt: true, userId: true });
export type InsertFridgeIngredient = z.infer<typeof insertFridgeIngredientSchema>;
export type FridgeIngredient = typeof fridgeIngredientsTable.$inferSelect;
