import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const parseOrigins = (value: string) =>
  value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const envSchema = z.object({
  PORT: z.string().default("5001"),
  NODE_ENV: z
    .enum(["development", "test", "staging", "production"])
    .default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),

  APP_ORIGINS: z.string().default("http://localhost:3000"),
  SOCKET_ORIGINS: z.string().optional(),
  JSON_BODY_LIMIT: z.string().default("1mb"),
  ATTACHMENT_STORAGE_DIR: z.string().default("storage/attachments"),
  ATTACHMENT_MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),

  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),

  DEVELOPMENT_INGESTION_COMPANY_ID: z.string().optional(),
  ALLOW_UNSIGNED_WEBHOOKS_IN_DEVELOPMENT: z.string().optional(),
}).superRefine((value, ctx) => {
  const isProductionLike =
    value.NODE_ENV === "production" ||
    value.NODE_ENV === "staging";

  if (!isProductionLike) {
    return;
  }

  if (!process.env.APP_ORIGINS) {
    ctx.addIssue({
      code: "custom",
      path: ["APP_ORIGINS"],
      message: "APP_ORIGINS is required outside development",
    });
  }

  if (value.JWT_SECRET.length < 32) {
    ctx.addIssue({
      code: "custom",
      path: ["JWT_SECRET"],
      message: "JWT_SECRET must be at least 32 characters outside development",
    });
  }

  if (!value.WHATSAPP_VERIFY_TOKEN) {
    ctx.addIssue({
      code: "custom",
      path: ["WHATSAPP_VERIFY_TOKEN"],
      message: "WHATSAPP_VERIFY_TOKEN is required outside development",
    });
  }

  if (!value.WHATSAPP_APP_SECRET) {
    ctx.addIssue({
      code: "custom",
      path: ["WHATSAPP_APP_SECRET"],
      message: "WHATSAPP_APP_SECRET is required outside development",
    });
  }

  if (!value.WHATSAPP_PHONE_NUMBER_ID) {
    ctx.addIssue({
      code: "custom",
      path: ["WHATSAPP_PHONE_NUMBER_ID"],
      message: "WHATSAPP_PHONE_NUMBER_ID is required outside development",
    });
  }

  if (!value.WHATSAPP_ACCESS_TOKEN) {
    ctx.addIssue({
      code: "custom",
      path: ["WHATSAPP_ACCESS_TOKEN"],
      message: "WHATSAPP_ACCESS_TOKEN is required outside development",
    });
  }
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error(
    "Invalid environment variables:",
    parsedEnv.error.flatten().fieldErrors
  );

  process.exit(1);
}

const rawEnv = parsedEnv.data;

export const env = {
  ...rawEnv,
  APP_ORIGINS: parseOrigins(rawEnv.APP_ORIGINS),
  SOCKET_ORIGINS: parseOrigins(
    rawEnv.SOCKET_ORIGINS || rawEnv.APP_ORIGINS
  ),
  ALLOW_UNSIGNED_WEBHOOKS_IN_DEVELOPMENT:
    rawEnv.ALLOW_UNSIGNED_WEBHOOKS_IN_DEVELOPMENT === "true",
};
