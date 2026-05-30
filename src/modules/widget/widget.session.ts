import jwt from "jsonwebtoken";
import { env } from "@/config/env.js";

export type WidgetSessionPayload = {
  tokenType: "widget_session";
  companyId: string;
  widgetInstallationId: string;
  conversationId: string;
  customerId: string;
};

type JwtWidgetSessionPayload = WidgetSessionPayload & jwt.JwtPayload;

export const signWidgetSession = (
  payload: WidgetSessionPayload
) => {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: "7d",
  });
};

export const verifyWidgetSession = (
  token: string
): WidgetSessionPayload => {
  const decoded = jwt.verify(
    token,
    env.JWT_SECRET
  ) as JwtWidgetSessionPayload;

  if (decoded.tokenType !== "widget_session") {
    throw new Error("Invalid widget session token");
  }

  return {
    tokenType: decoded.tokenType,
    companyId: decoded.companyId,
    widgetInstallationId: decoded.widgetInstallationId,
    conversationId: decoded.conversationId,
    customerId: decoded.customerId,
  };
};
