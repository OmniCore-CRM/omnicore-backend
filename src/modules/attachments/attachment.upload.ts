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

const extensionMimeTypes = new Map<string, Set<string>>([
  [".jpg", new Set(["image/jpeg"])],
  [".jpeg", new Set(["image/jpeg"])],
  [".png", new Set(["image/png"])],
  [".gif", new Set(["image/gif"])],
  [".webp", new Set(["image/webp"])],
  [".pdf", new Set(["application/pdf"])],
  [".txt", new Set(["text/plain"])],
  [".doc", new Set(["application/msword"])],
  [
    ".docx",
    new Set([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]),
  ],
  [".xls", new Set(["application/vnd.ms-excel"])],
  [
    ".xlsx",
    new Set([
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]),
  ],
]);

const dangerousExtensions = new Set([
  ".app",
  ".bat",
  ".cmd",
  ".com",
  ".dll",
  ".exe",
  ".hta",
  ".html",
  ".htm",
  ".jar",
  ".js",
  ".jse",
  ".msi",
  ".php",
  ".ps1",
  ".scr",
  ".sh",
  ".svg",
  ".vb",
  ".vbe",
  ".vbs",
  ".wsf",
]);

const dangerousMimeTypePrefixes = [
  "application/javascript",
  "application/x-msdownload",
  "application/x-sh",
  "text/html",
];

const hasPrefix = (buffer: Buffer, signature: readonly number[]) =>
  signature.every((byte, index) => buffer[index] === byte);

const hasAsciiPrefix = (buffer: Buffer, signature: string) =>
  buffer.subarray(0, signature.length).toString("ascii") === signature;

const isZipContainer = (buffer: Buffer) =>
  hasPrefix(buffer, [0x50, 0x4b, 0x03, 0x04]) ||
  hasPrefix(buffer, [0x50, 0x4b, 0x05, 0x06]) ||
  hasPrefix(buffer, [0x50, 0x4b, 0x07, 0x08]);

const isUtf8Text = (buffer: Buffer) => {
  if (buffer.includes(0)) return false;
  const decoded = buffer.toString("utf8");
  return Buffer.from(decoded, "utf8").equals(buffer);
};

const hasExpectedSignature = (extension: string, buffer: Buffer) => {
  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return hasPrefix(buffer, [0xff, 0xd8, 0xff]);
    case ".png":
      return hasPrefix(buffer, [
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
    case ".gif":
      return (
        hasAsciiPrefix(buffer, "GIF87a") || hasAsciiPrefix(buffer, "GIF89a")
      );
    case ".webp":
      return (
        buffer.length >= 12 &&
        hasAsciiPrefix(buffer, "RIFF") &&
        buffer.subarray(8, 12).toString("ascii") === "WEBP"
      );
    case ".pdf":
      return hasAsciiPrefix(buffer, "%PDF-");
    case ".doc":
    case ".xls":
      return hasPrefix(buffer, [
        0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
      ]);
    case ".docx":
    case ".xlsx":
      return isZipContainer(buffer);
    case ".txt":
      return isUtf8Text(buffer);
    default:
      return false;
  }
};

const validateAttachmentMetadata = (
  file: Pick<Express.Multer.File, "originalname" | "mimetype">
) => {
  const extension = path.extname(file.originalname).toLowerCase();
  const mimeType = file.mimetype.toLowerCase();

  if (
    dangerousExtensions.has(extension) ||
    dangerousMimeTypePrefixes.some((prefix) => mimeType.startsWith(prefix))
  ) {
    throw new AppError("This file type is not allowed", HTTP_STATUS.BAD_REQUEST);
  }

  const expectedMimeTypes = extensionMimeTypes.get(extension);
  if (!expectedMimeTypes || !expectedMimeTypes.has(mimeType)) {
    throw new AppError("This file type is not allowed", HTTP_STATUS.BAD_REQUEST);
  }
};

export const validateAttachmentFileSecurity = (file: Express.Multer.File) => {
  validateAttachmentMetadata(file);
  const extension = path.extname(file.originalname).toLowerCase();

  if (!file.buffer?.length || !hasExpectedSignature(extension, file.buffer)) {
    throw new AppError(
      "Attachment file content does not match its file type",
      HTTP_STATUS.BAD_REQUEST
    );
  }
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.ATTACHMENT_MAX_FILE_SIZE_BYTES,
    files: 1,
    fields: 12,
  },
  fileFilter: (_req, file, callback) => {
    try {
      const extension = path.extname(file.originalname).toLowerCase();
      if (
        !allowedMimeTypes.has(file.mimetype.toLowerCase()) ||
        !allowedExtensions.has(extension)
      ) {
        throw new AppError(
          "This file type is not allowed",
          HTTP_STATUS.BAD_REQUEST
        );
      }
      validateAttachmentMetadata(file);
    } catch (error) {
      callback(error as Error);
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

    if (error) {
      next(error);
      return;
    }

    try {
      if (req.file) validateAttachmentFileSecurity(req.file);
      next();
    } catch (validationError) {
      next(validationError);
    }
  });
};
