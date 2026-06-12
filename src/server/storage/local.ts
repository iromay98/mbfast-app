import { promises as fs } from "node:fs";
import path from "node:path";
import type { StorageProvider, StoredFile } from "./types";

/*
 * ローカルディスク実装。STORAGE_LOCAL_DIR 配下に保存する。
 * contentType はサイドカー(.meta)に保存して読み出し時に復元する。
 * パストラバーサル防止のため、解決後パスが baseDir 配下であることを必ず検証する。
 */
export class LocalDiskStorage implements StorageProvider {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir);
  }

  private resolve(key: string): string {
    const full = path.resolve(this.baseDir, key);
    if (full !== this.baseDir && !full.startsWith(this.baseDir + path.sep)) {
      throw new Error("不正なストレージキーです");
    }
    return full;
  }

  async save(key: string, data: Buffer, contentType: string): Promise<void> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
    await fs.writeFile(`${full}.meta`, contentType, "utf8");
  }

  async read(key: string): Promise<StoredFile | null> {
    const full = this.resolve(key);
    try {
      const buffer = await fs.readFile(full);
      let contentType = "application/octet-stream";
      try {
        contentType = (await fs.readFile(`${full}.meta`, "utf8")).trim() || contentType;
      } catch {
        // メタが無ければ既定値
      }
      return { buffer, contentType, size: buffer.byteLength };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const full = this.resolve(key);
    await fs.rm(full, { force: true });
    await fs.rm(`${full}.meta`, { force: true });
  }
}
