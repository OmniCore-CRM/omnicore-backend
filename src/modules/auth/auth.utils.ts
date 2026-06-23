import crypto from "node:crypto";
import type { Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "@/config/env.js";

export const REFRESH_COOKIE_NAME = "omnicore_refresh";
export const ACCESS_TOKEN_EXPIRES_IN = "15m";
export const REFRESH_SESSION_DAYS = 30;

export type AccessTokenPayload = {
  userId: string;
  companyId: string;
  role: string;
  sessionId: string;
};

export const generateAccessToken = (payload: AccessTokenPayload) => {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  });
};

export const createRefreshToken = () =>
  crypto.randomBytes(32).toString("base64url");

export const hashRefreshToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");

export const createRefreshExpiry = () => {
  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + REFRESH_SESSION_DAYS);
  return expiresAt;
};

const refreshCookieOptions = (expires: Date) => ({
  httpOnly: true,
  secure: env.NODE_ENV === "production" || env.NODE_ENV === "staging",
  sameSite: env.NODE_ENV === "production" ? ("none" as const) : ("lax" as const),
  expires,
  path: "/api/v1/auth",
});

export const setRefreshCookie = (res: Response, token: string, expires: Date) => {
  res.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions(expires));
};

export const clearRefreshCookie = (res: Response) => {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === "production" || env.NODE_ENV === "staging",
    sameSite: env.NODE_ENV === "production" ? ("none" as const) : ("lax" as const),
    path: "/api/v1/auth",
  });
};
