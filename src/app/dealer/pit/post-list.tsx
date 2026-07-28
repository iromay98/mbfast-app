"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateMyPitPost, deleteMyPitPost } from "@/lib/actions/pit-posts";

export type PostListRow = {
  id: string;
  vehicle: string;
  status: string;
  title: string | null;
  editNote: string;
  publishedUrl: string | null;
  createdAtLabel: string;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  published: { label: "公開済み", cls: "bg-green-100 text-green-800" },
  held: { label: "本部確認中", cls: "bg-amber-100 text-amber-800" },
  failed: { label: "失敗", cls: "bg-surface-2 text-ink-soft" },
  processing: { label: "処理中", cls: "bg-sky-100 text-sky-800" },
  deleted: { label: "削除済み", cls: "bg-surface-2 text-ink-soft" },
};

// 公開後の記事の編集（タイトル・追記）と削除。
// 本文の全書き換えはさせない（画像や表のブロックを壊すため）＝「追記」で訂正・補足する方式。
export function PostList({ posts }: { posts: PostListRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<PostListRow | null>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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
              {!deleted && (
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
              )}
            </div>

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
