import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import routes from "@/routes/index.js";
import { globalErrorHandler } from "@/core/middleware/error.middleware.js";
import { notFoundHandler } from "@/core/middleware/not-found.middleware.js";
import { env } from "@/config/env.js";

const app = express();

// Security middleware
app.use(
  cors({
    origin: env.APP_ORIGINS,
    credentials: true,
}));

app.use(helmet());

// Request logging
app.use(morgan("dev"));

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

// API routes
app.use("/api/v1", routes);

// Handle unknown routes
app.use(notFoundHandler);

// Global error handler
app.use(globalErrorHandler);

export default app;
