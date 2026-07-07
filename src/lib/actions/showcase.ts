"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireHQ } from "@/lib/authz";
import { type FormState } from "@/lib/actions/form-state";
import { resolveEmbed } from "@/lib/showcase/embed";

// フォームの複数URL（改行 or 複数フィールド）→ 保存用の埋め込み配列 {kind,url}
function parseEmbedsFromForm(formData: FormData): { kind: string; url: string; title?: string }[] {
  const raw =
    formData.getAll("embedUrl").flatMap((v) => String(v).split(/\r?\n/)) ??
    [];
  const out: { kind: string; url: string; title?: string }[] = [];
  const seen = new Set<string>();
  for (const line of raw) {
    const url = line.trim();
    if (!url || seen.has(url)) continue;
    const e = resolveEmbed(url);
    if (e) {
      seen.add(url);
      out.push({ kind: e.kind, url: e.url });
    }
  }
  return out;
}

// 施工記録から事例を作成（本店のみ）。車両情報は記録/照合純正からコピー。
export async function createShowcaseFromRecord(
  recordId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireHQ();

  const record = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: {
      carMaker: true,
      carModel: true,
      matchedBaseFile: {
        select: { manufacturer: true, model: true, generation: true, grade: true },
      },
    },
  });
  if (!record) return { error: "施工記録が見つかりません" };

  const carMaker = record.matchedBaseFile?.manufacturer ?? record.carMaker ?? "";
  const carModel = record.matchedBaseFile?.model ?? record.carModel ?? "";
  if (!carMaker || !carModel) {
    return { error: "車両情報（メーカー・車種）が未確定のため事例化できません。先に記録を確定してください。" };
  }

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "タイトルを入力してください", fieldErrors: { title: "必須" } };

  const comment = String(formData.get("comment") ?? "").trim() || null;
  const stage = String(formData.get("stage") ?? "").trim() || null;
  const contentLabel = String(formData.get("contentLabel") ?? "").trim() || null;
  const coverImage = String(formData.get("coverImage") ?? "").trim() || null;
  const visibility = formData.get("visibility") === "DEALER" ? "DEALER" : "PUBLIC";
  const embeds = parseEmbedsFromForm(formData);

  await prisma.showcase.create({
    data: {
      title,
      comment,
      carMaker,
      carModel,
      generation: record.matchedBaseFile?.generation ?? null,
      grade: record.matchedBaseFile?.grade ?? null,
      stage,
      contentLabel,
      coverImage,
      visibility,
      embeds,
      createdFromRecordId: recordId,
      publishedById: user.id,
    },
  });

  revalidatePath("/hq/showcase");
  revalidatePath("/dealer/showcase");
  revalidatePath("/showcase");
  revalidatePath(`/hq/records/${recordId}`);
  return { ok: true };
}

// 事例を削除（本店のみ）
export async function deleteShowcase(id: string): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  await prisma.showcase.delete({ where: { id } });
  revalidatePath("/hq/showcase");
  revalidatePath("/dealer/showcase");
  revalidatePath("/showcase");
  return { ok: true };
}

// 公開範囲の切替（本店のみ）
export async function setShowcaseVisibility(
  id: string,
  visibility: "PUBLIC" | "DEALER",
): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  await prisma.showcase.update({
    where: { id },
    data: { visibility: visibility === "DEALER" ? "DEALER" : "PUBLIC" },
  });
  revalidatePath("/hq/showcase");
  revalidatePath("/dealer/showcase");
  revalidatePath("/showcase");
  return { ok: true };
}
