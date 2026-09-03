"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireHQ } from "@/lib/authz";
import { dealerSchema, dealerAccountSchema } from "@/lib/validation/dealer";
import {
  type FormState,
  zodToFieldErrors,
} from "@/lib/actions/form-state";
import { notify } from "@/server/notifications";
import { planPitProvision, provisionPitForDealer } from "@/server/pit/provision";
import { normalizeStoreSlug } from "@/server/pit/store-slug";

function parseDealerForm(formData: FormData) {
  return dealerSchema.safeParse({
    name: formData.get("name"),
    address: formData.get("address"),
    lat: formData.get("lat"),
    lng: formData.get("lng"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    autotunerToolId: formData.get("autotunerToolId"),
    note: formData.get("note"),
    status: formData.get("status") ?? "ACTIVE",
    // 許可アップロード経路（チェックボックス複数）。レガシー fileFormat は経路から導出:
    // 生binのみ（AutoTunerなし）の店は従来のMASTER扱い、それ以外はSLAVE。
    uploadTools: formData.getAll("uploadTools").map(String),
    fileFormat:
      formData.getAll("uploadTools").map(String).includes("MASTER_BIN") &&
      !formData.getAll("uploadTools").map(String).includes("AUTOTUNER")
        ? "MASTER"
        : "SLAVE",
    ecuEnabled: formData.get("ecuEnabled"),
    // 契約（1年更新）。次回更新日は保存しない＝開始日から都度計算する
    contractStartedAt: formData.get("contractStartedAt"),
    contractEndedAt: formData.get("contractEndedAt"),
    contractRenewalMonths: formData.get("contractRenewalMonths"),
    contractNoticeDays: formData.get("contractNoticeDays"),
    contractNote: formData.get("contractNote"),
  });
}

// 新規代理店作成 → 詳細へリダイレクト
export async function createDealer(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireHQ();
  const parsed = parseDealerForm(formData);
  if (!parsed.success) {
    return { error: "入力内容を確認してください", fieldErrors: zodToFieldErrors(parsed.error) };
  }
  const dealer = await prisma.dealer.create({ data: parsed.data });

  /*
   * mbPIT 店舗の自動付与（更家さん決定・2026-08-26: 代理店には登録と同時に投稿機能を付ける）。
   * 失敗しても代理店登録自体は成功させ、詳細画面の「mbPIT」欄で理由を見て再実行できるようにする。
   * slug は任意入力（空なら店名から自動生成。日本語店名で作れなければ詳細画面で指定する）。
   */
  const pitSlug = String(formData.get("pitSlug") ?? "").trim();
  const skipPit = formData.get("pitSkip") === "on";
  let pitMessage = "";
  if (!skipPit) {
    try {
      const r = await provisionPitForDealer(dealer.id, { slug: pitSlug || undefined });
      pitMessage = r.ok ? `mbPIT店舗を開設 (/mbpit/${r.slug}/)` : `mbPIT開設は保留: ${[...r.issues, r.error ?? ""].filter(Boolean).join(" / ")}`;
    } catch (e) {
      pitMessage = `mbPIT開設でエラー: ${e instanceof Error ? e.message : String(e)}`;
    }
    await notify({
      type: "PIT_STORE_PROVISIONED",
      title: "代理店を登録しました",
      message: `${dealer.name}: ${pitMessage}`,
      link: `/hq/dealers/${dealer.id}`,
    });
  }
  revalidatePath("/hq/dealers");
  revalidatePath("/hq/pit");
  redirect(`/hq/dealers/${dealer.id}`);
}

// 代理店詳細の「mbPIT機能を付ける」。既存代理店の遡り付与（1件ずつ）。
export async function provisionDealerPit(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireHQ();
  const dealerId = String(formData.get("dealerId") ?? "");
  const slugInput = String(formData.get("slug") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const dryRun = formData.get("dryRun") === "on";
  if (!dealerId) return { error: "代理店IDがありません" };
  if (slugInput && !/^[a-zA-Z0-9-]+$/.test(normalizeStoreSlug(slugInput))) {
    return { error: "slugは英小文字・数字・ハイフンのみです", fieldErrors: { slug: "形式が不正" } };
  }
  try {
    if (dryRun) {
      const plan = await planPitProvision(dealerId, { slug: slugInput || undefined, displayName: displayName || undefined });
      return {
        ok: true,
        data: {
          dryRun: true,
          status: plan.status,
          slug: plan.slug,
          issues: plan.issues.join("\n"),
          notes: plan.notes.join("\n"),
        },
      };
    }
    const r = await provisionPitForDealer(dealerId, { slug: slugInput || undefined, displayName: displayName || undefined });
    revalidatePath(`/hq/dealers/${dealerId}`);
    revalidatePath("/hq/pit");
    if (!r.ok) {
      return { error: [...r.issues, r.error ?? ""].filter(Boolean).join(" / ") || "開設できませんでした" };
    }
    return {
      ok: true,
      data: {
        dryRun: false,
        status: r.status,
        slug: r.slug ?? "",
        pageUrl: r.pageUrl ?? "",
        mailSent: r.mailSent ? "yes" : "no",
        notes: r.notes.join("\n"),
      },
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "開設に失敗しました" };
  }
}

// 代理店更新
export async function updateDealer(
  dealerId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireHQ();
  const parsed = parseDealerForm(formData);
  if (!parsed.success) {
    return { error: "入力内容を確認してください", fieldErrors: zodToFieldErrors(parsed.error) };
  }
  await prisma.dealer.update({ where: { id: dealerId }, data: parsed.data });
  revalidatePath("/hq/dealers");
  revalidatePath(`/hq/dealers/${dealerId}`);
  return { ok: true };
}

// 有効 / 無効の切替
export async function toggleDealerStatus(dealerId: string): Promise<void> {
  await requireHQ();
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } });
  if (!dealer) return;
  await prisma.dealer.update({
    where: { id: dealerId },
    data: { status: dealer.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" },
  });
  revalidatePath("/hq/dealers");
  revalidatePath(`/hq/dealers/${dealerId}`);
}

// 代理店ログインアカウント発行（初期パスワードを生成して一度だけ返す）
function generatePassword(len = 10): string {
  // 紛らわしい文字を除いた読みやすいパスワード
  const chars = "abcdefghijkmnpqrstuvwxyz23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let out = "";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

export async function issueDealerAccount(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireHQ();
  const parsed = dealerAccountSchema.safeParse({
    dealerId: formData.get("dealerId"),
    name: formData.get("name"),
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return { error: "入力内容を確認してください", fieldErrors: zodToFieldErrors(parsed.error) };
  }
  const { dealerId, name, email } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "このメールアドレスは既に使用されています", fieldErrors: { email: "使用済み" } };
  }

  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: { email, name, passwordHash, role: "DEALER", dealerId },
  });

  await notify({
    type: "DEALER_ACCOUNT_ISSUED",
    title: "代理店アカウントを発行しました",
    message: `${name} (${email}) のログインアカウントを発行しました。`,
    dealerId,
  });

  revalidatePath(`/hq/dealers/${dealerId}`);
  // 初期パスワードは一度だけ画面に表示する
  return { ok: true, data: { email, password } };
}
