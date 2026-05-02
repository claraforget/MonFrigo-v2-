import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const userSubscriptionsTable = pgTable("user_subscriptions", {
  userId: text("user_id").primaryKey(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  status: text("status").notNull().default("inactive"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type UserSubscription = typeof userSubscriptionsTable.$inferSelect;
