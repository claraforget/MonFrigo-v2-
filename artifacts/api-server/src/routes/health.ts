import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/healthz/ai", (_req, res) => {
  const onReplit = !!(process.env.REPL_ID || process.env.REPLIT_DEPLOYMENT_ID || process.env.REPL_SLUG);
  let provider = "none";
  let model = "";
  let keyConfigured = false;

  if (onReplit && process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    provider = "replit-proxy";
    model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    keyConfigured = true;
  } else if (process.env.GEMINI_API_KEY) {
    provider = "gemini";
    model = process.env.OPENAI_MODEL ?? "gemini-1.5-flash";
    keyConfigured = true;
  } else if (process.env.GROQ_API_KEY) {
    provider = "groq";
    model = process.env.OPENAI_MODEL ?? "llama-3.3-70b-versatile";
    keyConfigured = true;
  } else if (process.env.OPENAI_API_KEY) {
    provider = "openai";
    model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    keyConfigured = true;
  }

  res.json({ provider, model, keyConfigured, onReplit });
});

export default router;
