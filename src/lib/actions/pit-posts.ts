"use server";

/*
 * 公開済み記事の編集・削除（加盟店＝自店の投稿のみ／本部は全店）。
 *
 * 方針:
 * - タイトルはそのままWordPressへ反映
 * - 本文の全書き換えはさせない（画像ブロックやテーブルを壊すため）。代わりに
 *   「追記（訂正・補足）」をマーカーで囲んだブロックとして差し替える方式にし、
 *   何度編集しても増殖しないようにする
 * - 削除はWordPressのゴミ箱へ移動（完全削除しない＝誤操作から復元できる）
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/authz";
import { fetchPostContent, fetchPostDate, updatePost, trashPost, wpConfigured } from "@/server/pit/wordpress";

const NOTE_START = "<!-- mbpit:note -->";
const NOTE_END = "<!-- /mbpit:note -->";
const MAX_NOTE_LEN = 600;
const MAX_TITLE_LEN = 120;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 追記ブロックのHTML（見出し付きで「あとから足した情報」だと分かるようにする） */
function noteBlock(note: string): string {
  const body = escapeHtml(note.trim()).replace(/\r?\n+/g, "<br>");
  return (
    `${NOTE_START}\n<!-- wp:paragraph -->` +
    `<p><strong>【追記】</strong><br>${body}</p>` +
    `<!-- /wp:paragraph -->\n${NOTE_END}`
  );
}

/** 既存の追記ブロックを取り除く（差し替えのため） */
function stripNote(content: string): string {
  const s = content.indexOf(NOTE_START);
  if (s < 0) return content;
  const e = content.indexOf(NOTE_END, s);
  if (e < 0) return content;
  return (content.slice(0, s) + content.slice(e + NOTE_END.length)).replace(/\n{3,}/g, "\n\n");
}

// 対象投稿を取得し、操作権限（自店 or 本部）を確認する
async function loadOwnPost(postId: string) {
  const user = await requireUser();
  const post = await prisma.pitPost.findUnique({
    where: { id: postId },
    select: {
      id: true,
      storeId: true,
      status: true,
      title: true,
      editNote: true,
      wpPostId: true,
      publishedUrl: true,
      store: { select: { dealerId: true, footerHtml: true } },
    },
  });
  if (!post) return { error: "投稿が見つかりません" as const };
  if (user.role !== "HQ_ADMIN" && post.store.dealerId !== user.dealerId) {
    return { error: "この投稿を操作する権限がありません" as const };
  }
  return { post };
}

/** タイトル・追記の更新 → WordPressへ反映 */
export async function updateMyPitPost(
  postId: string,
  input: { title: string; editNote: string },
): Promise<{ ok?: true; error?: string }> {
  const r = await loadOwnPost(postId);
  if (!r.post) return { error: r.error };
  const post = r.post;

  const title = input.title.trim();
  const note = input.editNote.trim();
  if (!title) return { error: "タイトルを入力してください" };
  if (title.length > MAX_TITLE_LEN) return { error: `タイトルは${MAX_TITLE_LEN}文字以内にしてください` };
  if (note.length > MAX_NOTE_LEN) return { error: `追記は${MAX_NOTE_LEN}文字以内にしてください` };
  if (/<[a-zA-Z/!]/.test(title) || /<[a-zA-Z/!]/.test(note)) {
    return { error: "HTMLタグは使えません" };
  }

  // WordPressへの反映（公開済みのみ。未公開・保留はアプリ側の記録だけ更新する）
  if (post.status === "published" && post.wpPostId) {
    if (!wpConfigured()) return { error: "WordPress接続が未設定のため反映できません" };
    try {
      const current = await fetchPostContent(post.wpPostId);
      let content = stripNote(current.contentRaw);
      if (note) {
        // 店舗フッターの直前に入れる（フッターより後ろに追記が出ると不自然なため）
        const footer = post.store.footerHtml.trim();
        const at = footer ? content.indexOf(footer) : -1;
        content =
          at >= 0
            ? `${content.slice(0, at)}${noteBlock(note)}\n${content.slice(at)}`
            : `${content}\n${noteBlock(note)}`;
      }
      await updatePost(post.wpPostId, { title, content });
    } catch (e) {
      console.error("mbPIT: 記事の更新に失敗", e);
      return { error: "WordPressへの反映に失敗しました。時間をおいて再度お試しください" };
    }
  }

  await prisma.pitPost.update({ where: { id: post.id }, data: { title, editNote: note } });
  revalidatePath("/dealer/pit");
  revalidatePath("/dealer/pit/home");
  revalidatePath("/hq/pit");
  return { ok: true };
}

/** 記事の削除（WordPressはゴミ箱へ・アプリ側は deleted 表示） */
export async function deleteMyPitPost(postId: string): Promise<{ ok?: true; error?: string }> {
  const r = await loadOwnPost(postId);
  if (!r.post) return { error: r.error };
  const post = r.post;

  if (post.wpPostId) {
    if (!wpConfigured()) return { error: "WordPress接続が未設定のため削除できません" };
    try {
      await trashPost(post.wpPostId);
    } catch (e) {
      console.error("mbPIT: 記事の削除に失敗", e);
      return { error: "WordPress側の削除に失敗しました。時間をおいて再度お試しください" };
    }
  }
  // 記録は残す（実績カウントからは status で除外される）。復元が必要なら本部がWPのゴミ箱から戻せる
  await prisma.pitPost.update({
    where: { id: post.id },
    data: { status: "deleted", publishedUrl: null },
  });
  revalidatePath("/dealer/pit");
  revalidatePath("/dealer/pit/home");
  revalidatePath("/hq/pit");
  return { ok: true };
}

/**
 * 公開前確認（status="review"）の記事を公開する。
 *
 * パイプラインは確認ONのとき WordPress へ **下書き** で作って止めている。
 * ここで下書き→公開に切り替える（記事を作り直さない＝画像やブロックをそのまま活かす）。
 * 加盟店は自店のみ・本部は全店（loadOwnPost が権限を見る）。
 */
export async function approveMyPitPost(
  postId: string,
): Promise<{ ok?: true; url?: string; error?: string }> {
  const r = await loadOwnPost(postId);
  if (!r.post) return { error: r.error };
  const post = r.post;

  if (post.status !== "review") return { error: "確認待ちの投稿ではありません" };
  if (!post.wpPostId) return { error: "WordPressの記事が見つかりません" };
  if (!wpConfigured()) return { error: "WordPress接続が未設定のため公開できません" };

  try {
    /*
     * 下書き→公開でWPが日付を「公開した時刻」で引き直すことがあるため、
     * 下書きに付いている日付（＝施工日）を読んで status と一緒に再送して守る。
     * 読めなくても公開自体は止めない（日付が投稿時刻になるだけ）。
     */
    let date: string | undefined;
    try {
      date = (await fetchPostDate(post.wpPostId)) ?? undefined;
    } catch {
      date = undefined;
    }
    await updatePost(post.wpPostId, { status: "publish", ...(date ? { date } : {}) });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "公開に失敗しました" };
  }

  await prisma.pitPost.update({ where: { id: post.id }, data: { status: "published" } });
  revalidatePath("/dealer/pit");
  revalidatePath("/hq/pit");
  return { ok: true, url: post.publishedUrl ?? undefined };
}

/**
 * 公開前確認の記事を公開せずに取り下げる（WordPressの下書きはゴミ箱へ）。
 * 「AIが書いた内容が違う」ときに、公開せず捨てられる出口を必ず用意する。
 */
export async function discardMyPitPost(postId: string): Promise<{ ok?: true; error?: string }> {
  const r = await loadOwnPost(postId);
  if (!r.post) return { error: r.error };
  const post = r.post;

  if (post.status !== "review") return { error: "確認待ちの投稿ではありません" };
  if (post.wpPostId && wpConfigured()) {
    try {
      await trashPost(post.wpPostId);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "取り下げに失敗しました" };
    }
  }
  await prisma.pitPost.update({
    where: { id: post.id },
    data: { status: "deleted", errorMessage: "公開前確認で取り下げ" },
  });
  revalidatePath("/dealer/pit");
  return { ok: true };
}
