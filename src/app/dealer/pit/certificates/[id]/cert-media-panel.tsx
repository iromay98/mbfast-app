"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { uploadCertMedia, toggleCertMediaPublic, removeCertMedia } from "@/lib/actions/pit-cert-media";

export type MediaRow = {
  id: string;
  kind: string;
  kindLabel: string;
  isPublicSafe: boolean;
  publicable: boolean;
};

export type KindOption = { key: string; label: string; help?: string; publicable: boolean };

/*
 * 証跡写真の管理（下書きのときだけ編集できる）。
 *
 * 公開の既定は「しない」。公開に回せるのは許可された種別だけで、
 * 選べない種別は理由を添えて出す（黙って落とすと、なぜ出ないのか分からない）。
 */
export function CertMediaPanel({
  certificateId,
  storeId,
  media,
  kinds,
  editable,
  maxCount,
}: {
  certificateId: string;
  storeId?: string;
  media: MediaRow[];
  kinds: KindOption[];
  editable: boolean;
  maxCount: number;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState(kinds[0]?.key ?? "after");
  const [wantPublic, setWantPublic] = useState(false);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const selected = kinds.find((k) => k.key === kind);
  const src = (id: string) => `/api/pit/cert-media/${id}${storeId ? `?storeId=${storeId}` : ""}`;

  const run = (fn: () => Promise<{ ok?: true; error?: string }>, message: string) =>
    startTransition(async () => {
      setError(null);
      setDone(null);
      const r = await fn();
      if (r.error) setError(r.error);
      else {
        setDone(message);
        router.refresh();
      }
    });

  const upload = (file: File) => {
    const fd = new FormData();
    fd.set("file", file);
    fd.set("kind", kind);
    // 許可されていない種別では公開フラグを送らない（サーバー側でも弾く）
    if (wantPublic && selected?.publicable) fd.set("wantPublic", "1");
    run(() => uploadCertMedia(certificateId, fd, storeId), "写真を追加しました");
  };

  return (
    <Card className="no-print">
      <h3 className="text-sm font-bold text-ink">証跡写真</h3>
      <p className="mt-1 text-[11px] text-ink-soft">
        施工の証拠として残す写真です。<span className="font-semibold text-ink">既定では公開しません</span>。
        公開に回せるのは施工前・施工後・製品ラベル・タイヤ側面だけで、
        ナンバープレート・診断機の画面・メーターは証跡専用です。
        {editable ? `（${media.length}/${maxCount}枚）` : "（発行済みのため変更できません）"}
      </p>

      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>}
      {done && <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">{done}</p>}

      {media.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {media.map((m) => (
            <div key={m.id} className="w-[104px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src(m.id)}
                alt={m.kindLabel}
                className="h-[78px] w-[104px] rounded-lg border border-line object-cover"
              />
              <p className="mt-0.5 truncate text-[10px] font-semibold text-ink">{m.kindLabel}</p>
              <p className="text-[10px] text-ink-soft">
                {m.isPublicSafe ? "公開可" : m.publicable ? "非公開" : "証跡専用"}
              </p>
              {editable && (
                <div className="mt-0.5 flex items-center gap-1.5">
                  {m.publicable && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => toggleCertMediaPublic(m.id, certificateId, !m.isPublicSafe, storeId),
                          m.isPublicSafe ? "公開をやめました" : "公開可にしました",
                        )
                      }
                      className="text-[10px] font-semibold text-ink-soft hover:underline"
                    >
                      {m.isPublicSafe ? "非公開に" : "公開可に"}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm("この写真を削除しますか？")) return;
                      run(() => removeCertMedia(m.id, certificateId, storeId), "削除しました");
                    }}
                    className="text-[10px] text-ink-soft hover:underline"
                  >
                    削除
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editable && media.length < maxCount && (
        <div className="mt-3 space-y-2">
          <label className="block text-[11px] font-semibold text-ink-soft">
            写真の種類
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                const next = kinds.find((k) => k.key === e.target.value);
                if (!next?.publicable) setWantPublic(false);
              }}
              className="mt-0.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink"
            >
              {kinds.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                  {k.publicable ? "" : "（証跡専用）"}
                </option>
              ))}
            </select>
          </label>
          {selected?.help && <p className="text-[10px] text-ink-soft">{selected.help}</p>}

          <label className="flex items-center gap-2 text-[11px] font-semibold text-ink">
            <input
              type="checkbox"
              checked={wantPublic}
              disabled={!selected?.publicable}
              onChange={(e) => setWantPublic(e.target.checked)}
              className="h-4 w-4 accent-gold-500 disabled:cursor-not-allowed"
            />
            この写真は公開してよい（ブログ・共有ページに出す）
            {!selected?.publicable && <span className="font-normal text-ink-soft">— この種類は公開できません</span>}
          </label>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              if (fileRef.current) fileRef.current.value = "";
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="rounded-lg bg-gold-500 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? "追加中…" : "📷 写真を追加"}
          </button>
          <p className="text-[10px] text-ink-soft">
            撮影情報（EXIF）は保存時に取り除きます。写真はこの証明書に紐づけて保管し、認可された経路だけで配信します。
          </p>
        </div>
      )}
    </Card>
  );
}
