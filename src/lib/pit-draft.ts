"use client";

/*
 * mbPIT 投稿フォームの下書き保存（端末内のみ・サーバーには送らない）。
 *
 * - 文字入力（音声書き起こし・車種・施工日・動画URL等）は localStorage
 * - 写真は容量が大きく localStorage に入らないため IndexedDB に File のまま保存
 *   （ぼかし枠も一緒に保存するので、復元後もぼかしをやり直す必要がない）
 * - 公開が成功したら破棄。どの処理も失敗してもフォームを壊さない（下書きは付加機能）
 */

export type DraftText = {
  memo: string;
  vehicle: string;
  category: string;
  workDate: string;
  videoUrl: string;
  chassisManual: string;
  savedAt: number;
};

export type DraftPhoto = { file: File; boxes: { x: number; y: number; w: number; h: number }[] };

const TEXT_PREFIX = "mbpit.draft.";
const DB_NAME = "mbpit-draft";
const STORE = "photos";
const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 2週間で自動失効（古い下書きの復元は混乱を招く）

export function draftKey(storeId?: string): string {
  return `${TEXT_PREFIX}${storeId ?? "self"}`;
}

export function saveDraftText(key: string, d: Omit<DraftText, "savedAt">): void {
  try {
    const empty = !d.memo && !d.vehicle && !d.videoUrl && !d.chassisManual;
    if (empty) return; // 何も書いていない状態を下書きにはしない
    localStorage.setItem(key, JSON.stringify({ ...d, savedAt: Date.now() } satisfies DraftText));
  } catch {
    // 容量超過・プライベートブラウズ等は黙って諦める
  }
}

export function loadDraftText(key: string): DraftText | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as DraftText;
    if (!d || typeof d.savedAt !== "number" || Date.now() - d.savedAt > DRAFT_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

export function clearDraftText(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}

// ── 写真（IndexedDB） ────────────────────────────────
function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveDraftPhotos(key: string, photos: DraftPhoto[]): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      // Fileはそのまま保存できる（Blob対応）。boxesは構造化複製で保存される
      tx.objectStore(STORE).put({ photos, savedAt: Date.now() }, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}

export async function loadDraftPhotos(key: string): Promise<DraftPhoto[]> {
  const db = await openDb();
  if (!db) return [];
  try {
    return await new Promise<DraftPhoto[]>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const v = req.result as { photos?: DraftPhoto[]; savedAt?: number } | undefined;
        if (!v?.photos || !v.savedAt || Date.now() - v.savedAt > DRAFT_TTL_MS) return resolve([]);
        // File以外が入っていたら捨てる（別バージョンの残骸対策）
        resolve(v.photos.filter((p) => p?.file instanceof File));
      };
      req.onerror = () => resolve([]);
    });
  } finally {
    db.close();
  }
}

export async function clearDraftPhotos(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}
