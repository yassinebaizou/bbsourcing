// DDPSourcing — Price estimator API (Vercel Serverless Function)
// Route: POST /api/estimate
// The pricing parameters below stay on the server: visitors only receive the final indicative price.

const CONFIG = {
  usdToMad: 10,            // 1 USD = 10 MAD
  batchQty: 100,           // estimate is always based on a 100-unit stock
  shippingPerKg: 130,      // MAD per 1000 g (express air)
  agreementFee: 700,       // MAD per stock, only for connected products (Bluetooth / WiFi)
  customsRate: 0.30,       // estimated customs on (stock + transport)
  transitFees: 700,        // MAD per stock
  otherFees: 200,          // MAD per stock (magazinage, misc.)
  margin: 0.20             // service margin on cost per unit
};

// Categories shown in the dropdown. Only `connected: true` changes the calculation.
const CATEGORIES = {
  gadget:      { label: "Gadget (standard)",                connected: false },
  connected:   { label: "Gadget with Bluetooth / WiFi",     connected: true  },
  vibration:   { label: "Product with vibration",           connected: false },
  textile:     { label: "Textile & clothing",               connected: false },
  home:        { label: "Home & kitchen",                   connected: false },
  beauty:      { label: "Beauty & accessories",             connected: false },
  other:       { label: "Other",                            connected: false }
};

function estimate({ category, priceUsd, weightGrams }) {
  const c = CONFIG;
  const cat = CATEGORIES[category];
  const priceMad = priceUsd * c.usdToMad;

  const stock = priceMad * c.batchQty;
  const transport = (weightGrams / 1000) * c.shippingPerKg * c.batchQty;
  const agreement = cat.connected ? c.agreementFee : 0;
  const customs = (stock + transport) * c.customsRate;
  const totalCost = stock + transport + agreement + customs + c.transitFees + c.otherFees;

  const costPerUnit = totalCost / c.batchQty;
  const pricePerUnit = Math.ceil(costPerUnit * (1 + c.margin)); // always round up

  return {
    pricePerUnit,
    batchQty: c.batchQty,
    batchTotal: pricePerUnit * c.batchQty,
    currency: "MAD",
    connectedNotice: cat.connected
  };
}

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}

module.exports = function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    // Lets the page build the dropdown without hard-coding categories twice.
    const categories = Object.entries(CATEGORIES).map(([id, v]) => ({ id, label: v.label }));
    return res.status(200).json({ categories });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = parseBody(req);
  const category = String(body.category || "");
  const priceUsd = Number(body.priceUsd);
  const weightGrams = Number(body.weightGrams);

  const errors = {};
  if (!CATEGORIES[category]) errors.category = "Please choose a product category.";
  if (!Number.isFinite(priceUsd) || priceUsd <= 0 || priceUsd > 5000)
    errors.priceUsd = "Enter the Alibaba unit price in USD (between 0.01 and 5,000).";
  if (!Number.isFinite(weightGrams) || weightGrams < 1 || weightGrams > 30000)
    errors.weightGrams = "Enter the weight of one unit with packaging, in grams (1 to 30,000).";

  if (Object.keys(errors).length) return res.status(400).json({ errors });

  return res.status(200).json(estimate({ category, priceUsd, weightGrams }));
};

// Exported for local tests only.
module.exports.estimate = estimate;
module.exports.CONFIG = CONFIG;
