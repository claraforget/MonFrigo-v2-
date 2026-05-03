import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const COOKIE_NAME = "__mf_sess";
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function getJwtSecret(): string {
  return process.env.JWT_SECRET ?? "monfrigo-dev-secret-change-in-prod-2026";
}

function createToken(userId: string, email: string): string {
  return jwt.sign({ userId, email }, getJwtSecret(), { expiresIn: "30d" });
}

function cookieOpts(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    maxAge: COOKIE_MAX_AGE_MS,
    path: "/",
  };
}

function isSecure(req: { secure: boolean; headers: Record<string, string | string[] | undefined> }) {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

router.post("/auth/register", async (req, res): Promise<void> => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: "Email et mot de passe requis." });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "Format d'email invalide." });
    return;
  }
  if (typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "Mot de passe trop court (minimum 8 caractères)." });
    return;
  }
  try {
    const normalizedEmail = (email as string).toLowerCase().trim();
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, normalizedEmail))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "Un compte existe déjà avec cet email." });
      return;
    }
    const passwordHash = await bcrypt.hash(password as string, 12);
    const [user] = await db
      .insert(usersTable)
      .values({ email: normalizedEmail, passwordHash })
      .returning({ id: usersTable.id, email: usersTable.email });
    const token = createToken(user.id, user.email);
    res.cookie(COOKIE_NAME, token, cookieOpts(isSecure(req as Parameters<typeof isSecure>[0])));
    res.json({ user: { id: user.id, email: user.email } });
  } catch {
    res.status(500).json({ error: "Erreur serveur — réessayez dans un instant." });
  }
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: "Email et mot de passe requis." });
    return;
  }
  try {
    const normalizedEmail = (email as string).toLowerCase().trim();
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, normalizedEmail))
      .limit(1);
    if (!user) {
      res.status(401).json({ error: "Email ou mot de passe incorrect." });
      return;
    }
    const valid = await bcrypt.compare(password as string, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Email ou mot de passe incorrect." });
      return;
    }
    const token = createToken(user.id, user.email);
    res.cookie(COOKIE_NAME, token, cookieOpts(isSecure(req as Parameters<typeof isSecure>[0])));
    res.json({ user: { id: user.id, email: user.email } });
  } catch {
    res.status(500).json({ error: "Erreur serveur — réessayez dans un instant." });
  }
});

router.post("/auth/logout", (_req, res): void => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ success: true });
});

router.get("/auth/me", (req, res): void => {
  const token = (req.cookies as Record<string, string>)?.[COOKIE_NAME];
  if (!token) {
    res.status(401).json({ user: null });
    return;
  }
  try {
    const payload = jwt.verify(token, getJwtSecret()) as { userId: string; email: string };
    res.json({ user: { id: payload.userId, email: payload.email } });
  } catch {
    res.clearCookie(COOKIE_NAME, { path: "/" });
    res.status(401).json({ user: null });
  }
});

export default router;
