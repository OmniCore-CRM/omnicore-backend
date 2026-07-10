/**
 * Branding-specific image upload validation.
 *
 * Only allows JPEG, PNG, and WebP images.
 * Validates MIME type, extension, and magic bytes.
 * Rejects SVG, HTML, scripts, and oversized files.
 */

import path from "node:path";
import multer from "multer";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";

const BRANDING_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const extensionMimeMap = new Map<string, Set<string>>([
  [".jpg", new Set(["image/jpeg"])],
  [".jpeg", new Set(["image/jpeg"])],
  [".png", new Set(["image/png"])],
  [".webp", new Set(["image/webp"])],
]);

const hasPrefix = (buf: Buffer, sig: readonly number[]) =>
  sig.every((byte, i) => buf[i] === byte);

const hasExpectedSignature = (ext: string, buf: Buffer): boolean => {
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return hasPrefix(buf, [0xff, 0xd8, 0xff]);
    case ".png":
      return hasPrefix(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case ".webp":
      return (
        buf.length >= 12 &&
        hasPrefix(buf, [0x52, 0x49, 0x46, 0x46]) &&
        buf.subarray(8, 12).toString("ascii") === "WEBP"
      );
    default:
      return false;
  }
};

export const validateBrandingFileSecurity = (file: Express.Multer.File): void => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mime = file.mimetype.toLowerCase();

  if (!allowedExtensions.has(ext) || !allowedMimeTypes.has(mime)) {
    throw new AppError(
      "Only JPEG, PNG, and WebP images are allowed for branding",
      HTTP_STATUS.BAD_REQUEST
    );
  }

  const expected = extensionMimeMap.get(ext);
  if (!expected?.has(mime)) {
    throw new AppError(
      "Only JPEG, PNG, and WebP images are allowed for branding",
      HTTP_STATUS.BAD_REQUEST
    );
  }

  if (!file.buffer?.length || !hasExpectedSignature(ext, file.buffer)) {
    throw new AppError(
      "File content does not match its declared type",
      HTTP_STATUS.BAD_REQUEST
    );
  }
};

// Multer instance for branding uploads only
const brandingUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: BRANDING_MAX_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype.toLowerCase();
    if (!allowedExtensions.has(ext) || !allowedMimeTypes.has(mime)) {
      callback(
        new AppError(
          "Only JPEG, PNG, and WebP images are allowed for branding",
          HTTP_STATUS.BAD_REQUEST
        )
      );
      return;
    }
    callback(null, true);
  },
});

import type { NextFunction, Request, Response } from "express";

const _brandingSingle = brandingUpload.single("file");

export const uploadBrandingImage = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  _brandingSingle(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return next(
        new AppError(
          "Branding image must be 2 MB or smaller",
          HTTP_STATUS.BAD_REQUEST
        )
      );
    }
    next(err);
  });
};
