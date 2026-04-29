import { Router, type IRouter } from "express";
import Stripe from "stripe";
import { logger } from "../lib/logger";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

const stripeKey = process.env["STRIPE_SECRET_KEY"];
const stripe = stripeKey ? new Stripe(stripeKey) : null;

router.post("/stripe/create-checkout-session", async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: "Stripe non configuré (STRIPE_SECRET_KEY manquant)" });
  }

  try {
    const {
      successUrl: bodySuccess,
      cancelUrl: bodyCancel,
      email,
      userId,
    } = (req.body ?? {}) as {
      successUrl?: string;
      cancelUrl?: string;
      email?: string;
      userId?: string;
    };

    const origin =
      (req.headers["origin"] as string | undefined) ??
      `https://${process.env["REPLIT_DEV_DOMAIN"] ?? "localhost"}`;

    const successUrl = bodySuccess ?? `${origin}/?paid=true`;
    const cancelUrl = bodyCancel ?? `${origin}/?paid=cancel`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: email,
      client_reference_id: userId,
      subscription_data: userId ? { metadata: { userId } } : undefined,
      line_items: [
        {
          price_data: {
            currency: "cad",
            product_data: {
              name: "FrigoMenu Premium",
              description:
                "Génération illimitée de menus personnalisés. Annulable à tout moment.",
            },
            unit_amount: 1000, // 10,00 $ CAD
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return res.json({ url: session.url });
  } catch (err) {
    logger.error({ err }, "Stripe checkout session error");
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    return res.status(500).json({ error: msg });
  }
});

router.post("/stripe/create-portal-session", async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: "Stripe non configuré" });
  }

  try {
    const { email, userId, returnUrl: bodyReturn } = (req.body ?? {}) as {
      email?: string;
      userId?: string;
      returnUrl?: string;
    };

    if (!email && !userId) {
      return res.status(400).json({ error: "Email ou identifiant utilisateur requis" });
    }

    const origin =
      (req.headers["origin"] as string | undefined) ??
      `https://${process.env["REPLIT_DEV_DOMAIN"] ?? "localhost"}`;
    const returnUrl = bodyReturn ?? `${origin}/`;

    let customerId: string | undefined;

    // 1) Chercher d'abord via metadata.userId sur les abonnements (le plus fiable)
    if (userId) {
      try {
        const subs = await stripe.subscriptions.search({
          query: `metadata['userId']:'${userId}'`,
          limit: 1,
        });
        const sub = subs.data[0];
        if (sub) {
          customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        }
      } catch (e) {
        logger.warn({ err: e }, "Subscription search by userId failed, falling back to email");
      }
    }

    // 2) Chercher via les sessions checkout par client_reference_id
    if (!customerId && userId) {
      try {
        const sessions = await stripe.checkout.sessions.list({ limit: 100 });
        const match = sessions.data.find(
          (s) => s.client_reference_id === userId && s.customer
        );
        if (match?.customer) {
          customerId = typeof match.customer === "string" ? match.customer : match.customer.id;
        }
      } catch (e) {
        logger.warn({ err: e }, "Checkout session lookup failed");
      }
    }

    // 3) Fallback : chercher par email
    if (!customerId && email) {
      const customers = await stripe.customers.list({ email, limit: 1 });
      const customer = customers.data[0];
      if (customer) customerId = customer.id;
    }

    if (!customerId) {
      return res.status(404).json({
        error:
          "Aucun abonnement trouvé pour ce compte. Si vous vous êtes abonné avec une autre adresse courriel, contactez-nous pour qu'on lie votre abonnement.",
      });
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return res.json({ url: portal.url });
  } catch (err) {
    logger.error({ err }, "Stripe portal session error");
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    return res.status(500).json({ error: msg });
  }
});

router.post("/stripe/cancel-subscription", requireAuth, async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: "Stripe non configuré" });
  }

  const userId = (req as AuthedRequest).userId;

  try {
    // Find active subscription by userId in metadata
    let sub: Stripe.Subscription | undefined;

    try {
      const subs = await stripe.subscriptions.search({
        query: `metadata['userId']:'${userId}' status:'active'`,
        limit: 1,
      });
      sub = subs.data[0];
    } catch {
      // search might not be available on all Stripe plans — fallback via sessions
    }

    if (!sub) {
      // Fallback: find via checkout sessions
      const sessions = await stripe.checkout.sessions.list({ limit: 100 });
      const match = sessions.data.find(
        (s) => s.client_reference_id === userId && s.subscription
      );
      if (match?.subscription) {
        const subId = typeof match.subscription === "string" ? match.subscription : match.subscription.id;
        sub = await stripe.subscriptions.retrieve(subId);
      }
    }

    if (!sub || sub.status !== "active") {
      return res.status(404).json({ error: "Aucun abonnement actif trouvé" });
    }

    if (sub.cancel_at_period_end) {
      // Already scheduled for cancellation — return the existing date
      return res.json({
        cancelAt: new Date(sub.current_period_end * 1000).toISOString(),
        alreadyScheduled: true,
      });
    }

    const updated = await stripe.subscriptions.update(sub.id, {
      cancel_at_period_end: true,
    });

    const cancelAt = new Date(updated.current_period_end * 1000).toISOString();
    logger.info({ userId, cancelAt }, "Subscription scheduled for cancellation");

    return res.json({ cancelAt });
  } catch (err) {
    logger.error({ err }, "Cancel subscription error");
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    return res.status(500).json({ error: msg });
  }
});

export default router;
