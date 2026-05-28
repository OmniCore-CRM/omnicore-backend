import jwt from "jsonwebtoken";
import { env } from "@/config/env.js";

// Generate JWT access token
export const generateAccessToken = (
  userId: string,
  companyId: string,
  role: string
) => {
  return jwt.sign(
    {
      userId,
      companyId,
      role,
    },
    env.JWT_SECRET,
    {
      expiresIn: "1d",
    }
  );
};