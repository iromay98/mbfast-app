import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { requireDealer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";
import { CHUNK_SIZE_BYTES, CHUNKED_MAX_BYTES } from "@/lib/upload-limits";

/*
 * mbPIT 施工記録の動画の分割アップロード受け口。
 *
 * 施工動画はスマホで撮ると数百MBになる。Server Action で一括送信すると
 * メモリに丸ごと載り、2GB RAM のVPSでは投稿中にアプリごと落ちうる
 * （落ちれば投稿中の他の加盟店も巻き添えになる）。
 * そこで案件チャットと同じ方式で、クライアントが CHUNK_SIZE_BYTES ずつ送り、
 * ここで一時領域に追記していく。メモリ使用は常にチャンク1個分（5MB）で頭打ち。
 *
 *   POST ?op=init      {name,size,type} → {uploadId}（空き容量ガードあり）
 *   POST ?op=chunk&uploadId=&index=     body=チャンク生バイト → {receivedBytes}
 *   POST ?op=complete  {uploadId}       → {key,name,size,type}
 *
 * 完了後、クライアントは通常の投稿に uploadedVideoKey として渡す。
 * キーには storeId が含まれ、投稿側で prefix を検証する。
 *
 * 案件チャット側(/api/records/[id]/upload)とは持ち主の単位が違う
 * （あちら=recordId / こちら=storeId）ため別ルートにしてある。
 * 共通化すると認可の条件が入り組んで事故りやすい。
 */

const TMP_PREFIX = "tmp-uploads";
const TMP_TTL_MS = 24 * 60 * 60 * 1000;
// ディスクを使い切らないための予約領域（残りがこれ未満になる受け入れは断る）
const DISK_RESERVE_BYTES = 3 * 1024 * 1024 * 1024;

type UploadInfo = { storeId: string; name: string; size: number; type: string };

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

// ファイル名はキーの一部になるのでパス・制御文字を除去
function safeName(name: string): string {
  const base = name
    .replace(/^.*[\\/]/, "")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .trim();
  return (base || "video").slice(0, 120);
}

/** ログイン中の加盟店の店舗ID。他店のキーを作らせないため申告値は受け取らない */
async function ownStoreId(): Promise<string | null> {
  const user = await requireDealer();
  const store = await prisma.pitStore.findUnique({
    where: { dealerId: user.dealerId },
    select: { id: true, active: true },
  });
  if (!store || !store.active) return null;
  return store.id;
}

export async function POST(request: NextRequest) {
  let storeId: string | null;
  try {
    storeId = await ownStoreId();
  } catch {
    return json(403, { error: "権限がありません" });
  }
  if (!storeId) return json(403, { error: "権限がありません" });

  const op = request.nextUrl.searchParams.get("op");

  if (op === "init") {
    const body = (await request.json().catch(() => null)) as
      | { name?: string; size?: number; type?: string }
      | null;
    const size = Number(body?.size);
    const name = safeName(String(body?.name ?? ""));
    if (!Number.isInteger(size) || size <= 0) return json(400, { error: "サイズが不正です" });
    if (size > CHUNKED_MAX_BYTES) {
      return json(413, { error: `上限 ${Math.round(CHUNKED_MAX_BYTES / 1024 / 1024)}MB を超えています` });
    }
    const free = await storage.freeBytes();
    if (free !== null && free - size < DISK_RESERVE_BYTES) {
      return json(507, { error: "サーバーの空き容量が不足しています。本部に連絡してください" });
    }
    await storage.cleanup(TMP_PREFIX, TMP_TTL_MS).catch(() => {});

    const uploadId = randomUUID();
    const info: UploadInfo = {
      storeId,
      name,
      size,
      type: String(body?.type ?? "application/octet-stream").slice(0, 100),
    };
    await storage.save(`${TMP_PREFIX}/${uploadId}.info`, Buffer.from(JSON.stringify(info)), "application/json");
    return json(200, { uploadId, chunkSize: CHUNK_SIZE_BYTES });
  }

  // chunk / complete は uploadId の持ち主(storeId)を検証してから進む
  const uploadId = String(request.nextUrl.searchParams.get("uploadId") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(uploadId)) return json(400, { error: "uploadIdが不正です" });
  const infoFile = await storage.read(`${TMP_PREFIX}/${uploadId}.info`);
  if (!infoFile) return json(404, { error: "アップロードが見つかりません（期限切れの可能性）" });
  const info = JSON.parse(infoFile.buffer.toString("utf8")) as UploadInfo;
  if (info.storeId !== storeId) return json(403, { error: "権限がありません" });
  const tmpKey = `${TMP_PREFIX}/${uploadId}`;

  if (op === "chunk") {
    const index = Number(request.nextUrl.searchParams.get("index"));
    if (!Number.isInteger(index) || index < 0) return json(400, { error: "indexが不正です" });
    const data = Buffer.from(await request.arrayBuffer());
    if (data.byteLength === 0 || data.byteLength > CHUNK_SIZE_BYTES) {
      return json(400, { error: "チャンクサイズが不正です" });
    }
    const expected = index * CHUNK_SIZE_BYTES;
    const cur = (await storage.stat(tmpKey))?.size ?? 0;
    if (cur === expected + data.byteLength) {
      return json(200, { receivedBytes: cur }); // 同一チャンクの再送（冪等）
    }
    if (cur < expected) {
      return json(409, { receivedBytes: cur }); // 抜けあり→受信済み位置から送り直す
    }
    if (cur > expected) {
      // 途中まで書けた失敗チャンクの残骸 → チャンク境界まで巻き戻して受け直す
      await storage.truncate(tmpKey, expected);
    }
    await storage.append(tmpKey, data);
    if (expected + data.byteLength > info.size) {
      await storage.delete(tmpKey);
      await storage.delete(`${tmpKey}.info`);
      return json(400, { error: "申告サイズを超えました" });
    }
    return json(200, { receivedBytes: expected + data.byteLength });
  }

  if (op === "complete") {
    const st = await storage.stat(tmpKey);
    if (!st || st.size !== info.size) {
      return json(409, { error: "サイズが一致しません", receivedBytes: st?.size ?? 0 });
    }
    const key = `pit-videos/${storeId}/${uploadId}_${info.name}`;
    await storage.move(tmpKey, key, info.type);
    await storage.delete(`${tmpKey}.info`);
    return json(200, { key, name: info.name, size: info.size, type: info.type });
  }

  return json(400, { error: "opが不正です" });
}
