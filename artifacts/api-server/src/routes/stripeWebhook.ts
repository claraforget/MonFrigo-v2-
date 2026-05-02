import type { RequestHandler } from "express";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, userSubscriptionsTable } from "@workspace/db";
import { logger } from "../lib/logger";

const stripeKey = process.env["STRIPE_SECRET_KEY"];
const stripe = stripeKey ? new Stripe(stripeKey) : null;

// This handler must be mounted with express.raw() BEFORE express.json() in app.ts
export const stripeWebhookHandler: RequestHandler = async (req, res) => {
  if (!stripe) {
    res.status(500).json({ error: "Stripe non configuré" });
    return;
  }

  const secret = process.env["STRIPE_WEBHOOK_SECRET"];
  if (!secret) {
    logger.warn("STRIPE_WEBHOOK_SECRET not set — rejecting webhook");
    res.status(500).json({ error: "Webhook secret manquant (STRIPE_WEBHOOK_SECRET)" });
    return;
  }

  const sig = req.headers["stripe-signature"] as string | undefined;
  if (!sig) {
    res.status(400).json({ error: "Signature Stripe manquante" });
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig, secret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Stripe webhook signature invalid");
    res.status(400).json({ error: `Signature invalide: ${msg}` });
    return;
  }

  logger.info({ type: event.type }, "Stripe webhook received");

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;
        const userId = session.client_reference_id;
        if (!userId) break;
        const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
        const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;

        let periodEnd: Date | undefined;
        if (subscriptionId) {
          try {
            const sub = await stripe.subscriptions.retrieve(subscriptionId);
            periodEnd = new Date(sub.current_period_end * 1000);
          } catch { /* non-blocking */ }
        }

        await db
          .insert(userSubscriptionsTable)
          .values({
            userId,
            stripeCustomerId: customerId ?? null,
            stripeSubscriptionId: subscriptionId ?? null,
            status: "active",
            currentPeriodEnd: periodEnd ?? null,
          })
          .onConflictDoUpdate({
            target: userSubscriptionsTable.userId,
            set: {
              stripeCustomerId: customerId ?? undefined,
              stripeSubscriptionId: subscriptionId ?? undefined,
              status: "active",
              currentPeriodEnd: periodEnd ?? undefined,
              updatedAt: new Date(),
            },
          });

        logger.info({ userId, subscriptionId }, "Subscription activated via webhook");
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId;
        if (!userId) break;
        const newStatus = sub.cancel_at_period_end ? "canceling" : sub.status;
        await db
          .update(userSubscriptionsTable)
          .set({ status: newStatus, currentPeriodEnd: new Date(sub.current_period_end * 1000), updatedAt: new Date() })
          .where(eq(userSubscriptionsTable.userId, userId));
        logger.info({ userId, status: newStatus }, "Subscription updated via webhook");
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId;
        if (!userId) break;
        await db
          .update(userSubscriptionsTable)
          .set({ status: "canceled", updatedAt: new Date() })
          .where(eq(userSubscriptionsTable.userId, userId));
        logger.info({ userId }, "Subscription canceled via webhook");
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
        if (!subId) break;
        try {
          const sub = await stripe.subscriptions.retrieve(subId);
          const userId = sub.metadata?.userId;
          if (userId) {
            await db
              .update(userSubscriptionsTable)
              .set({ status: "past_due", updatedAt: new Date() })
              .where(eq(userSubscriptionsTable.userId, userId));
            logger.warn({ userId, subId }, "Subscription past_due — payment failed");
          }
        } catch { /* non-blocking */ }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    logger.error({ err, eventType: event.type }, "Error processing webhook event");
  }

  res.json({ received: true });
};
