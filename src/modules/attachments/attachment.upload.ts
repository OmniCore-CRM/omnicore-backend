import multer from "multer";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { env } from "@/config/env.js";

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const allowedExtensions = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".pdf",
  ".txt",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.ATTACHMENT_MAX_FILE_SIZE_BYTES,
    files: 1,
    fields: 12,
  },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (
      !allowedMimeTypes.has(file.mimetype.toLowerCase()) ||
      !allowedExtensions.has(extension)
    ) {
      callback(
        new AppError(
          "This file type is not allowed",
          HTTP_STATUS.BAD_REQUEST
        )
      );
      return;
    }
    callback(null, true);
  },
});

export const uploadSingleAttachment = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  upload.single("file")(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      next(
        new AppError(
          error.code === "LIMIT_FILE_SIZE"
            ? "Attachment exceeds the maximum allowed size"
            : "Invalid attachment upload",
          HTTP_STATUS.BAD_REQUEST
        )
      );
      return;
    }
    next(error);
  });
};
