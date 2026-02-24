import type { NextFunction, Request, Response } from "express";
import { env } from "@/config/env";

export function requireWorkerRegistrationToken(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Optional: if unset, allow unauthenticated registration (useful for dev).
  if (!env.workerRegistrationToken) return next();

  const auth = req.header("authorization") || "";
  const [scheme, token] = auth.split(" ");
  if (scheme !== "Bearer" || token !== env.workerRegistrationToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return next();
}

