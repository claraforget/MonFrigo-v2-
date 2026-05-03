import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthedRequest extends Request {
  userId: string;
  userEmail: string;
}

function getJwtSecret(): string {
  return process.env.JWT_SECRET ?? "monfrigo-dev-secret-change-in-prod-2026";
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const token =
    cookies?.["__mf_sess"] ??
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : undefined);

  if (!token) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }

  try {
    const payload = jwt.verify(token, getJwtSecret()) as {
      userId: string;
      email: string;
    };
    (req as AuthedRequest).userId = payload.userId;
    (req as AuthedRequest).userEmail = payload.email;
    next();
  } catch {
    res.status(401).json({ error: "Session expirée — veuillez vous reconnecter." });
  }
}
