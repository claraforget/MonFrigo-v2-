import { Router, type IRouter } from "express";
import Stripe from "stripe";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const stripeKey = process.env["STRIPE_SECRET_KEY"];
const stripe = stripeKey ? new Stripe(stripeKey) : null;

router.post("/stripe/create-checkout-session", async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: "Stripe non configuré (STRIPE_SECRET_KEY manquant)" });
  }

  try {
    const origin =
      (req.headers["origin"] as string | undefined) ??
      (req.headers["referer"] as string | undefined)?.replace(/\/[^/]*$/, "") ??
      `https://${process.env["REPLIT_DEV_DOMAIN"] ?? "localhost"}`;

    const successUrl = `${origin}/frigomenu/menu?paid=true`;
    const cancelUrl = `${origin}/frigomenu/menu?paid=cancel`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "cad",
            product_data: {
              name: "FrigoMenu — Accès illimité",
              description:
                "Génération illimitée de menus personnalisés. Vos économies à l'épicerie rembourseront largement ce coût.",
            },
            unit_amount: 1000, // 10,00 $ CAD
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

export default router;
