import { Router, type IRouter } from "express";
import {
  GetNearbyStoresQueryParams,
  GetNearbyStoresResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const STORE_CHAINS = [
  { name: "IGA", priceIndex: 1.05 },
  { name: "Metro", priceIndex: 1.08 },
  { name: "Maxi", priceIndex: 0.88 },
  { name: "Super C", priceIndex: 0.85 },
  { name: "Walmart Supercentre", priceIndex: 0.82 },
  { name: "Provigo", priceIndex: 1.10 },
  { name: "Costco", priceIndex: 0.78 },
  { name: "Marché Adonis", priceIndex: 0.90 },
];

function randomOffset(base: number, range: number): number {
  return base + (Math.random() - 0.5) * range;
}

router.get("/stores/nearby", async (req, res): Promise<void> => {
  const params = GetNearbyStoresQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { lat, lng } = params.data;

  const baseTotal = 85 + Math.random() * 40;

  const stores = STORE_CHAINS.slice(0, 6).map((chain, i) => {
    const distance = 0.3 + i * 0.8 + Math.random() * 0.5;
    const estimatedTotal = Math.round(baseTotal * chain.priceIndex * 100) / 100;
    const cheapestTotal = Math.round(baseTotal * 0.78 * 100) / 100;
    const savings = Math.round((estimatedTotal - cheapestTotal) * 100) / 100;

    const storeLat = randomOffset(lat, 0.02);
    const storeLng = randomOffset(lng, 0.02);

    const googleMapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(chain.name)}/@${storeLat},${storeLng},15z`;

    return {
      name: chain.name,
      address: `${Math.floor(Math.random() * 9000 + 1000)} Boulevard Principal, Québec`,
      distance: Math.round(distance * 10) / 10,
      estimatedTotal,
      savings: Math.max(0, savings),
      lat: storeLat,
      lng: storeLng,
      googleMapsUrl,
    };
  }).sort((a, b) => a.estimatedTotal - b.estimatedTotal);

  res.json(GetNearbyStoresResponse.parse(stores));
});

export default router;
