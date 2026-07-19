"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { upsertPitStore, resolvePitHeld } from "@/lib/actions/pit";

export type StoreRow = {
  id: string;
  dealerId: string;
  dealerName: string;
  displayName: string;
  slug: string;
  wpCategoryId: number;
  footerHtml: string;
  active: boolean;
};
export type PostRow = {
  id: string;
  storeName: string;
  vehicle: string;
  category: string;
  status: string;
  title: string | null;
  publishedUrl: string | null;
  guardResult: string | null;
  errorMessage: string | null;
  createdAtLabel: string;
};
export type DealerOption = { id: string; name: string };

const CATEGORY_LABELS: Record<string, string> = {
  ecu: "ECUチューニング",
  coating: "コーティング",
  polish: "磨き",
  maintenance: "メンテナンス",
  other: "その他",
};
const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  published: { label: "公開済み", cls: "bg-green-100 text-green-800" },
  held: { label: "保留（要確認）", cls: "bg-red-100 text-red-800" },
  failed: { label: "失敗/対応済み", cls: "bg-surface-2 text-ink-soft" },
  processing: { label: "処理中", cls: "bg-sky-100 text-sky-800" },
};

// 初期5店のWordPressカテゴリID（登録フォームの参考表示用・確定値）
const KNOWN_CATEGORIES = [
  { name: "CharismGarage", id: 547, slug: "charism-garage" },
  { name: "On's", id: 549, slug: "ons-mbpit" },
  { name: "Anubis Garage", id: 551, slug: "anubis-garage" },
  { name: "プレジャー", id: 553, slug: "pleasure" },
  { name: "Glanzcoat", id: 555, slug: "glanzcoat-mbpit" },
];

export function PitAdmin({
  stores,
  posts,
  dealers,
  monthly,
}: {
  stores: StoreRow[];
  posts: PostRow[];
  dealers: DealerOption[];
  monthly: { store: string; ym: string; count: number }[];
}) {
  const held = posts.filter((p) => p.status === "held");
  return (
    <div className="space-y-4">
      {held.length > 0 && <HeldQueue posts={held} />}
      <StoreMaster stores={stores} dealers={dealers} />
      <TestPublish stores={stores} />
      <PostLog posts={posts} />
      {monthly.length > 0 && <MonthlyStats monthly={monthly} />}
    </div>
  );
}

// ── 保留（ガード該当）キュー ──
function HeldQueue({ posts }: { posts: PostRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Card className="border-red-200 bg-red-50">
      <h3 className="mb-2 text-sm font-semibold text-red-800">⚠ 自動公開を保留した投稿（{posts.length}件）</h3>
      <div className="space-y-2">
        {posts.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white p-2 text-xs">
            <span className="font-semibold">{p.storeName}</span>
            <span>{p.vehicle}</span>
            <span className="text-ink-soft">{p.guardResult}</span>
            <span className="ml-auto text-ink-soft">{p.createdAtLabel}</span>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await resolvePitHeld(p.id, "dismissed");
                  router.refresh();
                })
              }
              className="rounded border border-line px-2 py-1 font-semibold hover:bg-surface-2 disabled:opacity-50"
            >
              確認済みにする
            </button>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-red-700">
        排ガス規制デバイス無効化に該当する内容は自動公開しません（既存方針）。公開が必要な場合はWordPressで手動対応してください。
      </p>
    </Card>
  );
}

// ── 店舗マスタ ──
function StoreMaster({ stores, dealers }: { stores: StoreRow[]; dealers: DealerOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<Partial<StoreRow> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const save = () => {
    if (!editing) return;
    start(async () => {
      const r = await upsertPitStore({
        id: editing.id,
        dealerId: editing.dealerId ?? "",
        displayName: editing.displayName ?? "",
        slug: editing.slug ?? "",
        wpCategoryId: Number(editing.wpCategoryId ?? 0),
        footerHtml: editing.footerHtml ?? "",
        active: editing.active ?? true,
      });
      setMsg(r.error ?? null);
      if (!r.error) setEditing(null);
      router.refresh();
    });
  };

  return (
    <Card>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold">店舗マスタ</h3>
        <button
          type="button"
          onClick={() => setEditing({ active: true })}
          className="ml-auto rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-semibold text-white"
        >
          ＋ 店舗を追加
        </button>
      </div>

      <table className="w-full text-xs">
        <thead className="text-left text-[11px] text-ink-soft">
          <tr>
            <th className="py-1">表示名</th>
            <th>代理店</th>
            <th>slug</th>
            <th>WPカテゴリID</th>
            <th>フッター</th>
            <th>状態</th>
            <th></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {stores.map((s) => (
            <tr key={s.id}>
              <td className="py-1.5 font-semibold">{s.displayName}</td>
              <td>{s.dealerName}</td>
              <td className="font-mono">{s.slug}</td>
              <td className="font-mono">{s.wpCategoryId}</td>
              <td>{s.footerHtml.trim() ? "設定済み" : <span className="text-red-600">未設定</span>}</td>
              <td>{s.active ? "有効" : "停止"}</td>
              <td className="text-right">
                <button type="button" onClick={() => setEditing(s)} className="text-sky-700 hover:underline">
                  編集
                </button>
              </td>
            </tr>
          ))}
          {stores.length === 0 && (
            <tr>
              <td colSpan={7} className="py-4 text-center text-ink-soft">
                店舗が未登録です。「＋ 店舗を追加」から既存の代理店を紐づけてください。
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing && (
        <div className="mt-3 rounded-lg border border-line bg-surface-2 p-3">
          <h4 className="mb-2 text-xs font-semibold">{editing.id ? "店舗を編集" : "店舗を追加"}</h4>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="block text-[11px] text-ink-soft">
              代理店
              <select
                value={editing.dealerId ?? ""}
                onChange={(e) => setEditing({ ...editing, dealerId: e.target.value })}
                className="mt-0.5 w-full rounded border border-line bg-surface px-2 py-1 text-xs"
              >
                <option value="">選択してください</option>
                {dealers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[11px] text-ink-soft">
              表示名（記事タイトル・フッターに使用）
              <input
                value={editing.displayName ?? ""}
                onChange={(e) => setEditing({ ...editing, displayName: e.target.value })}
                className="mt-0.5 w-full rounded border border-line bg-surface px-2 py-1 text-xs"
              />
            </label>
            <label className="block text-[11px] text-ink-soft">
              slug（記事slug末尾に付与・WPカテゴリslugと揃える）
              <input
                value={editing.slug ?? ""}
                onChange={(e) => setEditing({ ...editing, slug: e.target.value })}
                placeholder="glanzcoat-mbpit"
                className="mt-0.5 w-full rounded border border-line bg-surface px-2 py-1 text-xs font-mono"
              />
            </label>
            <label className="block text-[11px] text-ink-soft">
              WordPressカテゴリID
              <input
                value={editing.wpCategoryId ?? ""}
                inputMode="numeric"
                onChange={(e) => setEditing({ ...editing, wpCategoryId: Number(e.target.value) })}
                className="mt-0.5 w-full rounded border border-line bg-surface px-2 py-1 text-xs font-mono"
              />
            </label>
            <label className="block text-[11px] text-ink-soft md:col-span-2">
              フッターHTML（店舗紹介＋問い合わせCTA。記事末尾に結合）
              <textarea
                value={editing.footerHtml ?? ""}
                rows={4}
                onChange={(e) => setEditing({ ...editing, footerHtml: e.target.value })}
                className="mt-0.5 w-full rounded border border-line bg-surface px-2 py-1 text-xs font-mono"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={editing.active ?? true}
                onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
              />
              有効（投稿を受け付ける）
            </label>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={save}
              className="rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              保存
            </button>
            <button type="button" onClick={() => setEditing(null)} className="text-xs text-ink-soft hover:underline">
              キャンセル
            </button>
            {msg && <span className="text-xs text-red-600">{msg}</span>}
          </div>
          <div className="mt-2 text-[11px] text-ink-soft">
            確定済みカテゴリID: {KNOWN_CATEGORIES.map((k) => `${k.name}=${k.id}(${k.slug})`).join(" / ")}（親: mbPIT施工記録=545）
          </div>
        </div>
      )}
    </Card>
  );
}

// ── テスト投稿（本店が任意の店舗として実公開して品質確認する） ──
function TestPublish({ stores }: { stores: StoreRow[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setResult(null);
    setUrl(null);
    try {
      const res = await fetch("/api/pit/test", { method: "POST", body: form });
      const data = (await res.json()) as { status?: string; url?: string; error?: string; reasons?: string[] };
      if (data.status === "published" && data.url) {
        setResult("公開しました");
        setUrl(data.url);
      } else if (data.status === "held") {
        setResult(`保留になりました: ${(data.reasons ?? []).join("・")}`);
      } else {
        setResult(`エラー: ${data.error ?? "不明"}`);
      }
    } catch {
      setResult("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">テスト投稿（実際に公開されます）</h3>
        <button type="button" onClick={() => setOpen(!open)} className="ml-auto text-xs text-sky-700 hover:underline">
          {open ? "閉じる" : "開く"}
        </button>
      </div>
      {open && (
        <form onSubmit={submit} className="mt-2 grid gap-2 md:grid-cols-2">
          <label className="block text-[11px] text-ink-soft">
            店舗
            <select name="storeId" required className="mt-0.5 w-full rounded border border-line bg-surface px-2 py-1 text-xs">
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[11px] text-ink-soft">
            車種
            <input name="vehicle" required placeholder="アルファード 30系" className="mt-0.5 w-full rounded border border-line bg-surface px-2 py-1 text-xs" />
          </label>
          <label className="block text-[11px] text-ink-soft">
            カテゴリ
            <select name="category" className="mt-0.5 w-full rounded border border-line bg-surface px-2 py-1 text-xs">
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[11px] text-ink-soft">
            写真（1〜10枚）
            <input name="photos" type="file" accept="image/*" multiple required className="mt-0.5 w-full text-xs" />
          </label>
          <label className="block text-[11px] text-ink-soft md:col-span-2">
            メモ（任意）
            <textarea name="memo" rows={2} className="mt-0.5 w-full rounded border border-line bg-surface px-2 py-1 text-xs" />
          </label>
          <div className="flex items-center gap-2 md:col-span-2">
            <button
              type="submit"
              disabled={busy || stores.length === 0}
              className="rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? "生成・公開中…（数分かかることがあります）" : "記事を生成して公開"}
            </button>
            {result && <span className="text-xs">{result}</span>}
            {url && (
              <a href={url} target="_blank" rel="noopener" className="text-xs font-semibold text-sky-700 underline">
                記事を開く
              </a>
            )}
          </div>
        </form>
      )}
    </Card>
  );
}

// ── 公開ログ ──
function PostLog({ posts }: { posts: PostRow[] }) {
  return (
    <Card>
      <h3 className="mb-2 text-sm font-semibold">投稿ログ（直近{posts.length}件）</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-[11px] text-ink-soft">
            <tr>
              <th className="py-1">日時</th>
              <th>店舗</th>
              <th>車種</th>
              <th>内容</th>
              <th>状態</th>
              <th>記事</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {posts.map((p) => {
              const st = STATUS_LABELS[p.status] ?? { label: p.status, cls: "bg-surface-2" };
              return (
                <tr key={p.id}>
                  <td className="whitespace-nowrap py-1.5">{p.createdAtLabel}</td>
                  <td className="whitespace-nowrap">{p.storeName}</td>
                  <td>{p.vehicle}</td>
                  <td className="whitespace-nowrap">{CATEGORY_LABELS[p.category] ?? p.category}</td>
                  <td>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${st.cls}`} title={p.errorMessage ?? p.guardResult ?? ""}>
                      {st.label}
                    </span>
                  </td>
                  <td className="max-w-[16rem] truncate">
                    {p.publishedUrl ? (
                      <a href={p.publishedUrl} target="_blank" rel="noopener" className="text-sky-700 hover:underline">
                        {p.title ?? p.publishedUrl}
                      </a>
                    ) : (
                      <span className="text-ink-soft">{p.errorMessage ?? "—"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {posts.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-ink-soft">
                  まだ投稿がありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── 月次集計 ──
function MonthlyStats({ monthly }: { monthly: { store: string; ym: string; count: number }[] }) {
  return (
    <Card>
      <h3 className="mb-2 text-sm font-semibold">月次公開数</h3>
      <table className="text-xs">
        <tbody className="divide-y divide-line">
          {monthly.map((m, i) => (
            <tr key={i}>
              <td className="py-1 pr-4 font-mono">{m.ym}</td>
              <td className="pr-4">{m.store}</td>
              <td className="font-semibold">{m.count} 件</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
