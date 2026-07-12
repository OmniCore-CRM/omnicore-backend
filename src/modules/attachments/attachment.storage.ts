import crypto from "node:crypto";
import path from "node:path";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import axios from "axios";
import { v2 as cloudinary } from "cloudinary";
import { env } from "@/config/env.js";

export interface AttachmentStorageProvider {
  save(buffer: Buffer): Promise<string>;
  read(storageKey: string): Promise<Buffer>;
  remove(storageKey: string): Promise<void>;
}

const CLOUDINARY_KEY_PREFIX = "cld_";

const localUuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const cloudinaryConfigured =
  Boolean(env.CLOUDINARY_CLOUD_NAME) &&
  Boolean(env.CLOUDINARY_API_KEY) &&
  Boolean(env.CLOUDINARY_API_SECRET);

const useCloudinaryStorage = env.STORAGE_PROVIDER === "cloudinary";

if (cloudinaryConfigured) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

const encodeCloudinaryKey = (publicId: string) =>
  `${CLOUDINARY_KEY_PREFIX}${Buffer.from(publicId, "utf8").toString("base64url")}`;

const decodeCloudinaryKey = (storageKey: string) => {
  if (!storageKey.startsWith(CLOUDINARY_KEY_PREFIX)) {
    return null;
  }

  const encoded = storageKey.slice(CLOUDINARY_KEY_PREFIX.length);
  if (!encoded) return null;

  try {
    const publicId = Buffer.from(encoded, "base64url").toString("utf8");
    return publicId.trim() ? publicId : null;
  } catch {
    return null;
  }
};

const assertCloudinaryConfigured = () => {
  if (!cloudinaryConfigured) {
    throw new Error(
      "Cloudinary branding storage is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET."
    );
  }
};

// Local storage is kept as the development/staging provider. Downloads stay
// server-mediated so authorization is checked before bytes leave storage; future
// cloud providers should keep storage keys private and issue short-lived signed
// reads only after the same tenant/session checks pass.
class LocalAttachmentStorage implements AttachmentStorageProvider {
  private readonly root = path.resolve(env.ATTACHMENT_STORAGE_DIR);

  async save(buffer: Buffer) {
    await mkdir(this.root, { recursive: true });
    const storageKey = crypto.randomUUID();
    await writeFile(path.join(this.root, storageKey), buffer, {
      flag: "wx",
    });
    return storageKey;
  }

  async read(storageKey: string) {
    return readFile(path.join(this.root, path.basename(storageKey)));
  }

  async remove(storageKey: string) {
    await unlink(path.join(this.root, path.basename(storageKey))).catch(
      () => undefined
    );
  }
}

class CloudinaryBrandingStorage implements AttachmentStorageProvider {
  private readonly folder = env.CLOUDINARY_FOLDER;

  async save(buffer: Buffer) {
    if (!useCloudinaryStorage) {
      throw new Error("Cloudinary branding storage is disabled by STORAGE_PROVIDER");
    }

    assertCloudinaryConfigured();

    const uploaded = await new Promise<{ public_id: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: this.folder,
          resource_type: "image",
          overwrite: false,
          unique_filename: true,
        },
        (error, result) => {
          if (error) {
            reject(error);
            return;
          }

          if (!result?.public_id) {
            reject(new Error("Cloudinary upload did not return a public_id"));
            return;
          }

          resolve({ public_id: result.public_id });
        }
      );

      stream.end(buffer);
    });

    return encodeCloudinaryKey(uploaded.public_id);
  }

  async read(storageKey: string) {
    const cloudinaryPublicId = decodeCloudinaryKey(storageKey);
    if (!cloudinaryPublicId) {
      throw new Error("Cloudinary key is invalid");
    }

    assertCloudinaryConfigured();

    const url = cloudinary.url(cloudinaryPublicId, {
      resource_type: "image",
      type: "upload",
      secure: true,
      sign_url: false,
    });

    const response = await axios.get<ArrayBuffer>(url, {
      responseType: "arraybuffer",
      validateStatus: (status) => status >= 200 && status < 300,
    });

    return Buffer.from(response.data);
  }

  async remove(storageKey: string) {
    const cloudinaryPublicId = decodeCloudinaryKey(storageKey);
    if (!cloudinaryPublicId) {
      return;
    }

    if (!cloudinaryConfigured) {
      return;
    }

    await cloudinary.uploader
      .destroy(cloudinaryPublicId, {
        resource_type: "image",
        type: "upload",
        invalidate: true,
      })
      .catch(() => undefined);
  }
}

class HybridBrandingStorage implements AttachmentStorageProvider {
  constructor(
    private readonly localStorage: AttachmentStorageProvider,
    private readonly cloudinaryStorage: AttachmentStorageProvider
  ) {}

  async save(buffer: Buffer) {
    if (useCloudinaryStorage) {
      return this.cloudinaryStorage.save(buffer);
    }

    return this.localStorage.save(buffer);
  }

  async read(storageKey: string) {
    if (decodeCloudinaryKey(storageKey)) {
      return this.cloudinaryStorage.read(storageKey);
    }

    if (!localUuidRegex.test(storageKey)) {
      throw new Error("Branding storage key is invalid");
    }

    return this.localStorage.read(storageKey);
  }

  async remove(storageKey: string) {
    if (decodeCloudinaryKey(storageKey)) {
      await this.cloudinaryStorage.remove(storageKey);
      return;
    }

    if (!localUuidRegex.test(storageKey)) {
      return;
    }

    await this.localStorage.remove(storageKey);
  }
}

export const attachmentStorage: AttachmentStorageProvider =
  new LocalAttachmentStorage();

export const brandingStorage: AttachmentStorageProvider =
  new HybridBrandingStorage(
    attachmentStorage,
    new CloudinaryBrandingStorage()
  );
