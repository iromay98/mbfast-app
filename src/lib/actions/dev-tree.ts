"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSessionUser, requireHQ } from "@/lib/authz";
import { storage } from "@/server/storage";
import { notify } from "@/server/notifications";
import { createHash } from "node:crypto";

// 実車開発モード（開発ツリー）のサーバーアクション。
// 本部: ツリー構築（ノード追加・分岐設定・開始位置）。代理店: 良い/ダメ報告で次ノードへ。

function paths(recordId: string): string[] {
  return [`/hq/records/${recordId}`, `/dealer/records/${recordId}`];
}
function reval(recordId: string): void {
  for (const p of paths(recordId)) revalidatePath(p);
}

// ── 本部: 開発モードON/OFF ──
export async function setDevMode(recordId: string, on: boolean): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const rec = await prisma.serviceRecord.findUnique({ where: { id: recordId }, select: { id: true } });
  if (!rec) return { error: "記録が見つかりません" };
  await prisma.serviceRecord.update({ where: { id: recordId }, data: { devMode: on } });
  reval(recordId);
  return { ok: true };
}

// ── 本部: ノード追加（modのbinをアップロード） ──
export async function addDevNode(
  recordId: string,
  formData: FormData,
): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const rec = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: { id: true, devCurrentNodeId: true },
  });
  if (!rec) return { error: "記録が見つかりません" };

  const label = String(formData.get("label") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!label) return { error: "ラベルを入力してください（例: ①ベース仕様）" };

  const file = formData.get("file");
  let filePath: string | null = null;
  let fileName: string | null = null;
  let fileHash: string | null = null;
  if (file instanceof File && file.size > 0) {
    const buf = Buffer.from(await file.arrayBuffer());
    fileHash = createHash("sha256").update(buf).digest("hex");
    filePath = `records/dev/${recordId}/${Date.now()}-${fileHash.slice(0, 8)}.bin`;
    fileName = file.name;
    await storage.save(filePath, buf, "application/octet-stream");
  }

  const last = await prisma.devNode.findFirst({
    where: { recordId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const node = await prisma.devNode.create({
    data: {
      recordId,
      label,
      note: note || null,
      filePath,
      fileName,
      fileHash,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
  // 最初のノードは自動的に開始位置にする
  if (!rec.devCurrentNodeId) {
    await prisma.serviceRecord.update({ where: { id: recordId }, data: { devCurrentNodeId: node.id } });
  }
  reval(recordId);
  return { ok: true };
}

// ── 本部: 過去のバリエーション版からノード追加（ファイルはコピーして独立させる） ──
export async function addDevNodeFromVersion(
  recordId: string,
  versionId: string,
  label: string,
  note: string,
): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const rec = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: { id: true, matchedBaseFileId: true, devCurrentNodeId: true },
  });
  if (!rec) return { error: "記録が見つかりません" };
  if (!rec.matchedBaseFileId) return { error: "この記録はストックに紐づいていません" };

  const ver = await prisma.tunedVariantVersion.findUnique({
    where: { id: versionId },
    select: {
      id: true,
      fileRef: true,
      fileHash: true,
      fileName: true,
      version: true,
      label: true,
      variant: { select: { baseFileId: true } },
    },
  });
  if (!ver || ver.variant.baseFileId !== rec.matchedBaseFileId) {
    return { error: "この車に適合しないファイルです" };
  }
  const src = await storage.read(ver.fileRef);
  if (!src) return { error: "元ファイルが見つかりません" };

  // カタログ側の削除・差し替えの影響を受けないよう、実体をコピーして持つ
  const filePath = `records/dev/${recordId}/${Date.now()}-${ver.fileHash.slice(0, 8)}.bin`;
  await storage.save(filePath, src.buffer, "application/octet-stream");

  const finalLabel = label.trim() || `v${ver.version}${ver.label ? `(${ver.label})` : ""}`;
  const last = await prisma.devNode.findFirst({
    where: { recordId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const node = await prisma.devNode.create({
    data: {
      recordId,
      label: finalLabel,
      note: note.trim() || null,
      filePath,
      fileName: ver.fileName ?? `v${ver.version}.bin`,
      fileHash: ver.fileHash,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
  if (!rec.devCurrentNodeId) {
    await prisma.serviceRecord.update({ where: { id: recordId }, data: { devCurrentNodeId: node.id } });
  }
  reval(recordId);
  return { ok: true };
}

// ── 本部: 案件のやり取り（チャット添付）からノード追加 ──
// 変換済み .slave はそのまま配信用として保持（fileIsSlave=true・DL時に再暗号化しない）。
// 生bin添付なら通常ノードと同じ扱い（DL時にslave化）。
export async function addDevNodeFromMessage(
  recordId: string,
  messageId: string,
  label: string,
  note: string,
): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const rec = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: { id: true, devCurrentNodeId: true },
  });
  if (!rec) return { error: "記録が見つかりません" };

  const msg = await prisma.recordMessage.findUnique({
    where: { id: messageId },
    select: { id: true, serviceRecordId: true, filePath: true, fileName: true, deletedAt: true },
  });
  if (!msg || msg.serviceRecordId !== recordId) return { error: "メッセージが不正です" };
  if (!msg.filePath || msg.deletedAt) return { error: "このメッセージにファイルがありません" };

  const src = await storage.read(msg.filePath);
  if (!src) return { error: "ファイルの実体が見つかりません" };

  const isSlave = (msg.fileName ?? "").toLowerCase().endsWith(".slave");
  const hash = createHash("sha256").update(src.buffer).digest("hex");
  const filePath = `records/dev/${recordId}/${Date.now()}-${hash.slice(0, 8)}${isSlave ? ".slave" : ".bin"}`;
  await storage.save(filePath, src.buffer, "application/octet-stream");

  const finalLabel = label.trim() || (msg.fileName ?? "チャット添付").replace(/\.[^.]+$/, "");
  const last = await prisma.devNode.findFirst({
    where: { recordId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const node = await prisma.devNode.create({
    data: {
      recordId,
      label: finalLabel,
      note: note.trim() || null,
      filePath,
      fileName: msg.fileName,
      fileHash: hash,
      fileIsSlave: isSlave,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
  if (!rec.devCurrentNodeId) {
    await prisma.serviceRecord.update({ where: { id: recordId }, data: { devCurrentNodeId: node.id } });
  }
  reval(recordId);
  return { ok: true };
}

// ── 本部: ノード編集（ラベル・メモ・分岐先） ──
export async function updateDevNode(
  nodeId: string,
  patch: { label?: string; note?: string; okNextId?: string | null; ngNextId?: string | null },
): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const node = await prisma.devNode.findUnique({ where: { id: nodeId }, select: { id: true, recordId: true } });
  if (!node) return { error: "ノードが見つかりません" };

  const data: Record<string, unknown> = {};
  if (patch.label !== undefined) {
    const v = patch.label.trim();
    if (!v) return { error: "ラベルは空にできません" };
    data.label = v;
  }
  if (patch.note !== undefined) data.note = patch.note.trim() || null;

  for (const key of ["okNextId", "ngNextId"] as const) {
    const v = patch[key];
    if (v === undefined) continue;
    if (v === null || v === "") {
      data[key] = null;
      continue;
    }
    if (v === nodeId) return { error: "自分自身を次のノードにはできません" };
    const target = await prisma.devNode.findUnique({ where: { id: v }, select: { recordId: true } });
    if (!target || target.recordId !== node.recordId) return { error: "分岐先が不正です" };
    data[key] = v;
  }

  await prisma.devNode.update({ where: { id: nodeId }, data });
  reval(node.recordId);
  return { ok: true };
}

// ── 本部: ノード削除（他ノードからの参照と開始位置を掃除） ──
export async function deleteDevNode(nodeId: string): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const node = await prisma.devNode.findUnique({ where: { id: nodeId }, select: { id: true, recordId: true, filePath: true } });
  if (!node) return { error: "ノードが見つかりません" };

  await prisma.$transaction([
    prisma.devNode.updateMany({ where: { recordId: node.recordId, okNextId: nodeId }, data: { okNextId: null } }),
    prisma.devNode.updateMany({ where: { recordId: node.recordId, ngNextId: nodeId }, data: { ngNextId: null } }),
    prisma.serviceRecord.updateMany({ where: { id: node.recordId, devCurrentNodeId: nodeId }, data: { devCurrentNodeId: null } }),
    prisma.devNode.delete({ where: { id: nodeId } }),
  ]);
  if (node.filePath) await storage.delete(node.filePath).catch(() => {});
  reval(node.recordId);
  return { ok: true };
}

// ── 本部: 開始位置（現在ノード）を設定 ──
export async function setDevCurrent(recordId: string, nodeId: string): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const node = await prisma.devNode.findUnique({ where: { id: nodeId }, select: { recordId: true } });
  if (!node || node.recordId !== recordId) return { error: "ノードが不正です" };
  await prisma.serviceRecord.update({ where: { id: recordId }, data: { devCurrentNodeId: nodeId } });
  reval(recordId);
  return { ok: true };
}

// ── 代理店: 結果報告（良い/ダメ）→ 次ノードへ ──
export async function reportDevResult(
  recordId: string,
  result: "ok" | "ng",
  comment: string,
): Promise<{ ok?: true; nextLabel?: string | null; error?: string }> {
  const user = await getSessionUser();
  if (!user) return { error: "ログインしてください" };

  const rec = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: { id: true, dealerId: true, devMode: true, devCurrentNodeId: true },
  });
  if (!rec) return { error: "記録が見つかりません" };
  const isHQ = user.role === "HQ_ADMIN";
  if (!isHQ && user.dealerId !== rec.dealerId) return { error: "権限がありません" };
  if (!rec.devMode || !rec.devCurrentNodeId) return { error: "開発モードが有効ではありません" };

  const node = await prisma.devNode.findUnique({
    where: { id: rec.devCurrentNodeId },
    select: { id: true, recordId: true, label: true, okNextId: true, ngNextId: true },
  });
  if (!node || node.recordId !== recordId) return { error: "現在のノードが見つかりません" };

  const nextId = result === "ok" ? node.okNextId : node.ngNextId;
  const next = nextId
    ? await prisma.devNode.findUnique({ where: { id: nextId }, select: { id: true, label: true } })
    : null;

  const trimmed = comment.trim();
  await prisma.$transaction([
    prisma.devTrial.create({
      data: { recordId, nodeId: node.id, result, comment: trimmed || null, byUserId: user.id },
    }),
    ...(next
      ? [prisma.serviceRecord.update({ where: { id: recordId }, data: { devCurrentNodeId: next.id } })]
      : []),
    // チャットにも自動投稿して、開発のやり取りが案件のタイムラインに残るようにする
    prisma.recordMessage.create({
      data: {
        serviceRecordId: recordId,
        authorId: user.id,
        authorRole: user.role,
        body:
          `【開発】${node.label}: ${result === "ok" ? "✅ 良好" : "❌ ダメ"}` +
          (trimmed ? ` — ${trimmed}` : "") +
          (next ? `\n→ 次の候補「${next.label}」がDL可能になりました` : "\n→ 次の候補がありません（本部の対応待ち）"),
      },
    }),
  ]);

  await notify({
    type: "DEV_RESULT",
    title: next ? "開発ツリー: 結果報告" : "開発ツリー: 終端に到達（要対応）",
    message: `${node.label} → ${result === "ok" ? "良好" : "ダメ"}${trimmed ? `（${trimmed}）` : ""}`,
    dealerId: null, // 本部宛て
    link: `/hq/records/${recordId}`,
  });

  reval(recordId);
  return { ok: true, nextLabel: next?.label ?? null };
}
