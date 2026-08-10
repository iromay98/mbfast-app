import { promises as fs, createReadStream } from "node:fs";
import { Readable } from "node:stream";
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

  private async readMeta(full: string): Promise<string> {
    try {
      return (await fs.readFile(`${full}.meta`, "utf8")).trim() || "application/octet-stream";
    } catch {
      return "application/octet-stream";
    }
  }

  async stat(key: string): Promise<{ size: number; contentType: string } | null> {
    const full = this.resolve(key);
    try {
      const st = await fs.stat(full);
      if (!st.isFile()) return null;
      return { size: st.size, contentType: await this.readMeta(full) };
    } catch {
      return null;
    }
  }

  async stream(
    key: string,
  ): Promise<{ stream: ReadableStream<Uint8Array>; size: number; contentType: string } | null> {
    const st = await this.stat(key);
    if (!st) return null;
    const nodeStream = createReadStream(this.resolve(key));
    return {
      stream: Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>,
      size: st.size,
      contentType: st.contentType,
    };
  }

  async append(key: string, data: Buffer): Promise<void> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.appendFile(full, data);
  }

  async truncate(key: string, size: number): Promise<void> {
    await fs.truncate(this.resolve(key), size);
  }

  async move(fromKey: string, toKey: string, contentType: string): Promise<void> {
    const from = this.resolve(fromKey);
    const to = this.resolve(toKey);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
    await fs.writeFile(`${to}.meta`, contentType, "utf8");
    await fs.rm(`${from}.meta`, { force: true });
  }

  async cleanup(prefix: string, olderThanMs: number): Promise<void> {
    const dir = this.resolve(prefix);
    const cutoff = Date.now() - olderThanMs;
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return; // ディレクトリが無ければ何もしない
    }
    for (const name of names) {
      const p = path.join(dir, name);
      try {
        const st = await fs.stat(p);
        if (st.isFile() && st.mtimeMs < cutoff) await fs.rm(p, { force: true });
      } catch {
        // 掃除失敗は無視（次回にまた試す）
      }
    }
  }

  async freeBytes(): Promise<number | null> {
    try {
      const s = await fs.statfs(this.baseDir);
      return Number(s.bavail) * Number(s.bsize);
    } catch {
      return null;
    }
  }
}
