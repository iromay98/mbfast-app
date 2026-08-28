"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  updateMyPitPost,
  deleteMyPitPost,
  approveMyPitPost,
  discardMyPitPost,
} from "@/lib/actions/pit-posts";

export type PostListRow = {
  id: string;
  vehicle: string;
  status: string;
  title: string | null;
  editNote: string;
  publishedUrl: string | null;
  createdAtLabel: string;
  /** 公開前確認（status="review"）で読む記事本文。それ以外では渡さない */
  bodyHtml?: string | null;
  /** Googleマップへ送信済みか（審査→公開はGoogle側で数分〜数時間かかる） */
  gbpPosted?: boolean;
  /** マップ送信が失敗したか（本部が対処するので店側の操作は不要） */
  gbpFailed?: boolean;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  published: { label: "公開済み", cls: "bg-green-100 text-green-800" },
  held: { label: "本部確認中", cls: "bg-amber-100 text-amber-800" },
  failed: { label: "失敗", cls: "bg-surface-2 text-ink-soft" },
  processing: { label: "処理中", cls: "bg-sky-100 text-sky-800" },
  deleted: { label: "削除済み", cls: "bg-surface-2 text-ink-soft" },
  // 施工証明から用意したスタンバイ下書き（まだ公開していない）
  draft: { label: "下書き（証明書から）", cls: "bg-gold-100 text-gold-800" },
  // AIが書き終えて、公開前の確認を待っている（店舗設定 postReviewRequired=ON のとき）
  review: { label: "内容の確認待ち", cls: "bg-violet-100 text-violet-800" },
};

// 公開後の記事の編集（タイトル・追記）と削除。
// 本文の全書き換えはさせない（画像や表のブロックを壊すため）＝「追記」で訂正・補足する方式。
export function PostList({
  posts,
  // 投稿完了画面の「内容を確認して公開する」から ?preview=<id> で飛んできたとき、
  // 該当投稿の本文を最初から開いておく（一覧から自分で探させない）
  initialPreviewId,
}: {
  posts: PostListRow[];
  initialPreviewId?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<PostListRow | null>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // 公開前確認: 本文を開いている投稿
  const [previewId, setPreviewId] = useState<string | null>(
    initialPreviewId && posts.some((p) => p.id === initialPreviewId && p.status === "review")
      ? initialPreviewId
      : null,
  );

  /* 公開前確認の記事をそのまま公開する（WordPressの下書き→公開に切り替える） */
  const approve = async (p: PostListRow) => {
    if (!confirm(`「${p.title ?? p.vehicle}」をブログに公開します。よろしいですか？`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await approveMyPitPost(p.id);
      if (r.error) setMsg(r.error);
      else router.refresh();
    } catch {
      setMsg("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  /* 公開せずに取り下げる（内容が違うとき用の出口） */
  const discard = async (p: PostListRow) => {
    if (!confirm(`「${p.title ?? p.vehicle}」を公開せずに取り下げます。よろしいですか？`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await discardMyPitPost(p.id);
      if (r.error) setMsg(r.error);
      else router.refresh();
    } catch {
      setMsg("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  const open = (p: PostListRow) => {
    setEditing(p);
    setTitle(p.title ?? "");
    setNote(p.editNote ?? "");
    setMsg(null);
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await updateMyPitPost(editing.id, { title, editNote: note });
      if (r.error) setMsg(r.error);
      else {
        setEditing(null);
        router.refresh();
      }
    } catch {
      setMsg("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: PostListRow) => {
    if (
      !window.confirm(
        `「${p.title ?? p.vehicle}」を削除しますか？\nブログから見えなくなります（本部側で元に戻すことは可能です）。`,
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await deleteMyPitPost(p.id);
      if (r.error) setMsg(r.error);
      else {
        setEditing(null);
        router.refresh();
      }
    } catch {
      setMsg("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  if (posts.length === 0) {
    return <p className="text-xs text-ink-soft">まだ投稿がありません。</p>;
  }

  return (
    <div className="divide-y divide-line">
      {posts.map((p) => {
        const st = STATUS[p.status] ?? { label: p.status, cls: "bg-surface-2" };
        const deleted = p.status === "deleted";
        const draft = p.status === "draft";
        const review = p.status === "review";
        return (
          <div key={p.id} className="py-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-ink-soft">{p.createdAtLabel}</span>
              <span className={`font-semibold ${deleted ? "text-ink-soft line-through" : ""}`}>
                {p.vehicle}
              </span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${st.cls}`}>
                {st.label}
              </span>
              {/* マップ反映の状態。「投稿したのにマップに出ない」を店が自己確認できるように。
                  送信済みでもGoogleの審査（数分〜数時間）を通るまで表示されない旨を添える */}
              {p.status === "published" && p.gbpPosted && (
                <span
                  className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800"
                  title="Googleマップへ送信済みです。Googleの審査を通ると表示されます（数分〜数時間）"
                >
                  🗺 マップ送信済み
                </span>
              )}
              {p.status === "published" && !p.gbpPosted && p.gbpFailed && (
                <span
                  className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-ink-soft"
                  title="Googleマップへの送信に失敗しました。運営が確認して対処します（ブログは公開されています）"
                >
                  🗺 マップ未反映
                </span>
              )}
              {p.publishedUrl && (
                <a
                  href={p.publishedUrl}
                  target="_blank"
                  rel="noopener"
                  className="max-w-[12rem] truncate text-sky-700 hover:underline"
                >
                  {p.title ?? "記事を見る"}
                </a>
              )}
              {review ? (
                <span className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => (previewId === p.id ? setPreviewId(null) : setPreviewId(p.id))}
                    className="font-semibold text-violet-700 hover:underline disabled:opacity-50"
                  >
                    {previewId === p.id ? "本文を閉じる" : "本文を読む"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => approve(p)}
                    className="rounded-lg bg-gold-500 px-3 py-1 font-bold text-white hover:bg-gold-600 disabled:opacity-50"
                  >
                    公開する
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => discard(p)}
                    className="text-red-600 hover:underline disabled:opacity-50"
                  >
                    取り下げ
                  </button>
                </span>
              ) : draft ? (
                <span className="ml-auto flex items-center gap-2">
                  <Link
                    href={`/dealer/pit?from=${p.id}`}
                    className="rounded-lg bg-gold-500 px-3 py-1 font-bold text-white hover:bg-gold-600"
                  >
                    投稿する →
                  </Link>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => remove(p)}
                    className="text-red-600 hover:underline disabled:opacity-50"
                  >
                    削除
                  </button>
                </span>
              ) : (
                !deleted && (
                  <span className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => (editing?.id === p.id ? setEditing(null) : open(p))}
                      className="font-semibold text-gold-700 hover:underline"
                    >
                      編集
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => remove(p)}
                      className="text-red-600 hover:underline disabled:opacity-50"
                    >
                      削除
                    </button>
                  </span>
                )
              )}
            </div>

            {/*
              公開前確認の本文プレビュー。AIが書いた本文をそのまま読めるようにする。
              本文は生成時に保存したもの（DB）。まだWordPressでは下書きなので公開URLでは読めない。
              表示は自前で組んだHTMLのみ（外部入力を埋め込まない）。
            */}
            {review && previewId === p.id && (
              <div className="mt-2 rounded-xl border-2 border-violet-400 bg-white p-3">
                <p className="mb-1.5 text-[11px] font-bold text-violet-800">
                  この内容で公開されます（まだ公開されていません）
                </p>
                {p.title && <p className="mb-2 text-sm font-bold text-ink">{p.title}</p>}
                {p.bodyHtml ? (
                  <div
                    className="mbpit-preview max-h-[60vh] overflow-y-auto text-[13px] leading-relaxed text-ink"
                    dangerouslySetInnerHTML={{ __html: p.bodyHtml }}
                  />
                ) : (
                  <p className="text-xs text-ink-soft">本文を読み込めませんでした。</p>
                )}
                <p className="mt-2 text-[11px] text-ink-soft">
                  直したいところがあれば「取り下げ」で捨てて、投稿し直してください。
                </p>
              </div>
            )}

            {editing?.id === p.id && (
              <div className="mt-2 rounded-xl border-2 border-gold-500 bg-surface-2 p-3">
                <label className="block text-[11px] font-semibold text-ink-soft">
                  タイトル
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={120}
                    className="mt-0.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink"
                  />
                </label>
                <label className="mt-2 block text-[11px] font-semibold text-ink-soft">
                  追記・訂正（記事の最後に「【追記】」として表示されます）
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    maxLength={600}
                    placeholder="例: 施工後1週間の状態を追記します。撥水は良好です。"
                    className="mt-0.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
                  />
                </label>
                <p className="mt-1 text-[10px] leading-relaxed text-ink-soft">
                  本文そのものの書き換えはできません（写真や表の並びを崩さないため）。大きく直したい場合は削除して撮り直し投稿がおすすめです。
                </p>
                {msg && <p className="mt-1 text-xs text-red-600">{msg}</p>}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={save}
                    className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {busy ? "反映中…" : "保存してブログに反映"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="text-sm text-ink-soft hover:underline"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {msg && !editing && <p className="pt-2 text-xs text-red-600">{msg}</p>}
    </div>
  );
}
