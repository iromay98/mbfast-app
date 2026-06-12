import path from "node:path";
import { createHash } from "node:crypto";
import { LocalDiskStorage } from "./local";
import type { StorageProvider } from "./types";

export type { StorageProvider, StoredFile } from "./types";

function createStorage(): StorageProvider {
  const driver = process.env.STORAGE_DRIVER ?? "local";
  switch (driver) {
    // case "s3":
    //   return new S3Storage({ ... }); // 将来: @aws-sdk/client-s3 等で実装
    case "local":
    default:
      return new LocalDiskStorage(process.env.STORAGE_LOCAL_DIR ?? "./storage");
  }
}

export const storage: StorageProvider = createStorage();

export const MAX_UPLOAD_BYTES = Number(
  process.env.MAX_UPLOAD_BYTES ?? 52428800,
); // 既定 50MB

// 拡張子は緩め（ECUファイルは多様）。サイズ上限と空ファイル拒否のみ。
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic"]);

export function isImageKey(key: string): boolean {
  return IMAGE_EXT.has(path.extname(key).toLowerCase());
}

function randomId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function safeName(name: string): string {
  // 拡張子は保持しつつ、危険文字を除去
  const ext = path.extname(name).slice(0, 12);
  const base = path
    .basename(name, path.extname(name))
    .replace(/[^\w.\-ぁ-んァ-ン一-龠]/g, "_")
    .slice(0, 40);
  return `${base || "file"}${ext.replace(/[^\w.]/g, "")}`;
}

export type SaveResult =
  | {
      ok: true;
      key: string;
      filename: string;
      contentType: string;
      size: number;
      sha256: string; // 保存したバイト列の SHA-256（小文字16進）。重複検出に使用。
    }
  | { ok: false; error: string };

/**
 * FormData の File を保存し、保存キーを返す。
 * prefix 例: "records"（施工写真）, "requests"（依頼ファイル）。
 */
export async function saveUpload(
  file: File,
  prefix: string,
): Promise<SaveResult> {
  if (!file || typeof file === "string" || file.size === 0) {
    return { ok: false, error: "ファイルが選択されていません" };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024);
    return { ok: false, error: `ファイルサイズが上限(${mb}MB)を超えています` };
  }
  const filename = safeName(file.name || "file");
  const key = `${prefix}/${randomId()}__${filename}`;
  const contentType = file.type || "application/octet-stream";
  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  await storage.save(key, buffer, contentType);
  return { ok: true, key, filename, contentType, size: buffer.byteLength, sha256 };
}
