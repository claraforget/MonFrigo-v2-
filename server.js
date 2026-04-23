const express = require("express");
const cors = require("cors");
const stripe = require("stripe")("sk_test_51TPTy1GxQ54QbConDcD7iXpKHaZ6Wqzn8PHD4tZ9CqBao7ZI6Z1KiyQGOAortpCVPHmjppC9zLRLIQTMLlZOCUmV00brvPUzjN");

const app = express();

app.use(cors());
app.use(express.json());

app.post("/create-checkout-session", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "cad",
            product_data: {
              name: "Mon produit",
            },
            unit_amount: 2000,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: "https://example.com/success",
      cancel_url: "https://example.com/cancel",
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});

