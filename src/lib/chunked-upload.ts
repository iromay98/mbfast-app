import { CHUNK_SIZE_BYTES } from "@/lib/upload-limits";

/*
 * 分割アップロードのクライアント側処理（共通）。
 *
 * 案件チャットと mbPIT 施工記録の両方で同じ手順を踏むため、ここに切り出す。
 * 大きいファイルを一括で送ると、スマホ回線では数分待った挙げ句に原因不明の
 * エラーになる（実際に動画で起きた）。5MBずつ送り、失敗したチャンクだけを
 * 指数バックオフで再試行することで、途中の一瞬の切断で全部やり直しにならない。
 *
 * endpoint は op を受け付ける受け口のパス（クエリ無し）を渡す。
 *   例: `/api/pit/upload` / `/api/records/${id}/upload`
 */

export type ChunkedResult = { key: string; name: string; size: number; type: string };

const MAX_ATTEMPTS = 4;

export async function uploadInChunks(
  file: File,
  endpoint: string,
  onProgress?: (pct: number) => void,
): Promise<ChunkedResult> {
  const initRes = await fetch(`${endpoint}?op=init`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, type: file.type || "application/octet-stream" }),
  });
  const init = (await initRes.json().catch(() => ({}))) as { uploadId?: string; error?: string };
  if (!initRes.ok || !init.uploadId) throw new Error(init.error ?? "アップロードを開始できませんでした");

  const totalChunks = Math.ceil(file.size / CHUNK_SIZE_BYTES);
  let index = 0;
  while (index < totalChunks) {
    const blob = file.slice(index * CHUNK_SIZE_BYTES, Math.min((index + 1) * CHUNK_SIZE_BYTES, file.size));
    let attempt = 0;
    for (;;) {
      try {
        const r = await fetch(`${endpoint}?op=chunk&uploadId=${init.uploadId}&index=${index}`, {
          method: "POST",
          body: blob,
        });
        const j = (await r.json().catch(() => ({}))) as { receivedBytes?: number; error?: string };
        if (r.ok) break;
        if (r.status === 409 && typeof j.receivedBytes === "number") {
          // サーバーの受信済み位置と食い違い → その位置から送り直す
          index = Math.max(0, Math.floor(j.receivedBytes / CHUNK_SIZE_BYTES)) - 1;
          break;
        }
        // 4xx（容量不足・上限超過など）は再試行しても直らないので即中断
        if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) {
          throw new Error(j.error ?? `送信に失敗しました（${r.status}）`);
        }
        throw new Error(j.error ?? `送信に失敗しました（${r.status}）`);
      } catch (e) {
        attempt++;
        if (attempt >= MAX_ATTEMPTS) throw e instanceof Error ? e : new Error("送信に失敗しました");
        await new Promise((res) => setTimeout(res, 500 * 2 ** (attempt - 1)));
      }
    }
    index++;
    onProgress?.(Math.min(99, Math.round((index / totalChunks) * 100)));
  }

  const compRes = await fetch(`${endpoint}?op=complete&uploadId=${init.uploadId}`, { method: "POST" });
  const comp = (await compRes.json().catch(() => ({}))) as Partial<ChunkedResult> & { error?: string };
  if (!compRes.ok || !comp.key) throw new Error(comp.error ?? "アップロードを完了できませんでした");
  onProgress?.(100);
  return { key: comp.key, name: comp.name ?? file.name, size: comp.size ?? file.size, type: comp.type ?? "" };
}
