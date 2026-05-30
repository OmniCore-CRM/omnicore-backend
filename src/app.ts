import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import routes from "@/routes/index.js";
import { globalErrorHandler } from "@/core/middleware/error.middleware.js";
import { notFoundHandler } from "@/core/middleware/not-found.middleware.js";
import { env } from "@/config/env.js";
import { prisma } from "@/config/db.js";
import { requestIdMiddleware } from "@/core/middleware/request-id.middleware.js";
import { accessLogMiddleware } from "@/core/middleware/access-log.middleware.js";

const app = express();

// Security middleware
app.use(
  cors({
    origin: env.APP_ORIGINS,
    credentials: true,
}));

app.use(helmet());

app.use(requestIdMiddleware);
app.use(accessLogMiddleware);

// Parse incoming request bodies
app.use(express.json({
  limit: env.JSON_BODY_LIMIT,
  verify: (req, _res, buffer) => {
    (req as express.Request & { rawBody?: Buffer }).rawBody =
      Buffer.from(buffer);
  },
}));
app.use(express.urlencoded({ extended: true }));

// Parse cookies
app.use(cookieParser());

// Health check route
app.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Omnichannel CRM API is running...",
  });
});

app.get("/healthz", (_req, res) => {
  res.status(200).json({
    success: true,
    status: "ok",
  });
});

app.get("/readyz", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return res.status(200).json({
      success: true,
      status: "ready",
    });
  } catch {
    return res.status(503).json({
      success: false,
      status: "not_ready",
    });
  }
});

// API routes
app.use("/api/v1", routes);

// Handle unknown routes
app.use(notFoundHandler);

// Global error handler
app.use(globalErrorHandler);

export default app;
