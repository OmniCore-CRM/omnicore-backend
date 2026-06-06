import crypto from "node:crypto";
import path from "node:path";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { env } from "@/config/env.js";

export interface AttachmentStorageProvider {
  save(buffer: Buffer): Promise<string>;
  read(storageKey: string): Promise<Buffer>;
  remove(storageKey: string): Promise<void>;
}

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

export const attachmentStorage: AttachmentStorageProvider =
  new LocalAttachmentStorage();
