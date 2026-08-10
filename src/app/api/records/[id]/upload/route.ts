import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { getSessionUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";
import { CHUNK_SIZE_BYTES, CHUNKED_MAX_BYTES } from "@/lib/upload-limits";

/*
 * 案件チャットの分割アップロード受け口。
 *
 * スマホ動画（数百MB〜）を Server Action 経由の一括送信で受けると
 * メモリに丸ごと載って 2GB RAM の VPS では危険なため、
 * クライアントが CHUNK_SIZE_BYTES ずつ送り、ここで一時領域に追記していく。
 * メモリ使用は常にチャンク1個分（5MB）で頭打ちになる。
 *
 *   POST ?op=init      {name,size,type} → {uploadId}（空き容量ガードあり）
 *   POST ?op=chunk&uploadId=&index=     body=チャンク生バイト → {receivedBytes}
 *   POST ?op=complete  {uploadId}       → {key,name,size,type}
 *
 * 完了後、クライアントは通常のメッセージ送信（postRecordMessage）に
 * uploadedKey として渡す。キーには recordId が含まれ、送信側で prefix を検証する。
 *
 * 安全策:
 * - すべての op で記録へのアクセス権を検証（本店=全件 / 代理店=自店のみ）
 * - uploadId は UUID。一時ファイルの持ち主(recordId)は .info サイドカーで検証
 * - チャンクは順番どおりに追記。ズレたら受信済みバイト数を返してクライアントが巻き戻す
 * - 未完了の一時ファイルは24時間で自動掃除（init のたびに実施）
 */

const TMP_PREFIX = "tmp-uploads";
const TMP_TTL_MS = 24 * 60 * 60 * 1000;
// ディスクを使い切らないための予約領域（残りがこれ未満になる受け入れは断る）
const DISK_RESERVE_BYTES = 3 * 1024 * 1024 * 1024;

type UploadInfo = { recordId: string; name: string; size: number; type: string };

async function authzRecord(recordId: string): Promise<boolean> {
  const user = await getSessionUser();
  if (!user) return false;
  const rec = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: { dealerId: true },
  });
  if (!rec) return false;
  if (user.role === "DEALER" && user.dealerId !== rec.dealerId) return false;
  return true;
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

// ファイル名はキーの一部になるのでパス・制御文字を除去（表示名はDB側で別途保持）
function safeName(name: string): string {
  const base = name.replace(/^.*[\\/]/, "").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim();
  return (base || "file").slice(0, 120);
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: recordId } = await ctx.params;
  if (!(await authzRecord(recordId))) return json(403, { error: "権限がありません" });

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
    // 未完了アップロードの掃除（失敗しても受付は続ける）
    await storage.cleanup(TMP_PREFIX, TMP_TTL_MS).catch(() => {});

    const uploadId = randomUUID();
    const info: UploadInfo = {
      recordId,
      name,
      size,
      type: String(body?.type ?? "application/octet-stream").slice(0, 100),
    };
    await storage.save(`${TMP_PREFIX}/${uploadId}.info`, Buffer.from(JSON.stringify(info)), "application/json");
    return json(200, { uploadId, chunkSize: CHUNK_SIZE_BYTES });
  }

  // chunk / complete は uploadId の持ち主(recordId)を検証してから進む
  const uploadId = String(request.nextUrl.searchParams.get("uploadId") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(uploadId)) return json(400, { error: "uploadIdが不正です" });
  const infoFile = await storage.read(`${TMP_PREFIX}/${uploadId}.info`);
  if (!infoFile) return json(404, { error: "アップロードが見つかりません（期限切れの可能性）" });
  const info = JSON.parse(infoFile.buffer.toString("utf8")) as UploadInfo;
  if (info.recordId !== recordId) return json(403, { error: "権限がありません" });
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
      // 抜けがある（クライアントが受信済み位置から送り直す）
      return json(409, { receivedBytes: cur });
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
    const key = `record-messages/${recordId}/${uploadId}_${info.name}`;
    await storage.move(tmpKey, key, info.type);
    await storage.delete(`${tmpKey}.info`);
    return json(200, { key, name: info.name, size: info.size, type: info.type });
  }

  return json(400, { error: "opが不正です" });
}
