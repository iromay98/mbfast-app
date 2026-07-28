"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import {
  upsertPitStore,
  resolvePitHeld,
  approvePitStore,
  suspendPitStore,
  ingestPitStoreInfo,
  roundtripCheck,
  type IngestRow,
  type RoundtripRow,
} from "@/lib/actions/pit";
import type { StoreInfo } from "@/server/pit/store-meta";
import { StoreInfoEditor } from "./store-info-editor";

export type StoreRow = {
  id: string;
  dealerId: string | null; // null = 本店直営（代理店に紐づかない）
  dealerName: string;
  displayName: string;
  slug: string;
  wpCategoryId: number;
  footerHtml: string;
  active: boolean;
  // 店舗マスター（店舗情報＋一覧表示用）
  info: StoreInfo;
  contactPerson: string;
  internalNote: string;
  postCount: number;
  lastSyncedLabel: string | null;
  syncBadge: "ok" | "failed" | "stale" | "none"; // stale = アプリ側が新しい（未同期）
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
  const pending = stores.filter((s) => !s.active);
  return (
    <div className="space-y-4">
      {held.length > 0 && <HeldQueue posts={held} />}
      {pending.length > 0 && <PendingStores stores={pending} />}
      <StoreMaster stores={stores} dealers={dealers} />
      <StoreInfoIngest />
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

// ── 承認待ちの店舗（招待リンクからの自己登録 or 停止中） ──
function PendingStores({ stores }: { stores: StoreRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Card className="border-gold-300 bg-gold-50/50">
      <h3 className="mb-2 text-sm font-semibold text-ink">⏳ 承認待ち・停止中の店舗（{stores.length}件）</h3>
      <div className="space-y-2">
        {stores.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface p-2 text-xs">
            <span className="font-semibold">{s.displayName}</span>
            <span className="font-mono text-ink-soft">{s.slug}</span>
            <span className="text-ink-soft">{s.dealerName}</span>
            {s.wpCategoryId <= 0 && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                WPカテゴリ未作成（承認時に自動作成）
              </span>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await approvePitStore(s.id);
                  setMsg(
                    r.error ??
                      `${s.displayName} を承認しました${r.createdCategoryId ? `（WPカテゴリID ${r.createdCategoryId} を自動作成）` : ""}`,
                  );
                  router.refresh();
                })
              }
              className="ml-auto rounded-lg bg-gold-500 px-3 py-1.5 font-semibold text-white disabled:opacity-50"
            >
              承認して有効化
            </button>
          </div>
        ))}
      </div>
      {msg && <p className="mt-2 text-xs text-ink">{msg}</p>}
      <p className="mt-2 text-[11px] text-ink-soft">
        承認するとブログ投稿が使えるようになります。承認前にWordPress側の店舗ページ（/mbpit/店舗slug/）の用意もお忘れなく。
      </p>
    </Card>
  );
}

// ── 店舗マスタ ──
function StoreMaster({ stores, dealers }: { stores: StoreRow[]; dealers: DealerOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<Partial<StoreRow> | null>(null);
  const [infoEditingId, setInfoEditingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const infoEditing = stores.find((s) => s.id === infoEditingId) ?? null;

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
      setMsg(
        r.error ??
          (r.createdCategoryId ? `保存しました（WPカテゴリID ${r.createdCategoryId} を自動作成）` : null),
      );
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
      <p className="mb-2 text-[11px] text-ink-soft">
        新規加盟店は公開ページ <span className="font-mono">/pit/join</span> から自分で登録できます（利用規約に同意→即投稿可能）。
        不適切な店舗は右の「停止」でワンタップ停止（ログインも失効）。既公開記事の削除はWordPress側で行ってください。
      </p>

      <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-[11px] text-ink-soft">
          <tr>
            <th className="py-1">表示名</th>
            <th>代理店</th>
            <th>slug</th>
            <th>エリア</th>
            <th>記録</th>
            <th>状態</th>
            <th>同期</th>
            <th></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {stores.map((s) => (
            <tr key={s.id}>
              <td className="py-1.5 font-semibold">{s.displayName}</td>
              <td>{s.dealerName}</td>
              <td className="font-mono">{s.slug}</td>
              <td>{s.info.area || <span className="text-ink-soft">—</span>}</td>
              <td>{s.postCount}件</td>
              <td>{s.active ? "有効" : "停止"}</td>
              <td className="whitespace-nowrap" title={s.lastSyncedLabel ?? "未同期"}>
                <SyncBadge badge={s.syncBadge} />
              </td>
              <td className="whitespace-nowrap text-right">
                <button
                  type="button"
                  onClick={() => setInfoEditingId(infoEditingId === s.id ? null : s.id)}
                  className="mr-2 text-gold-700 hover:underline"
                >
                  店舗情報
                </button>
                <button type="button" onClick={() => setEditing(s)} className="text-sky-700 hover:underline">
                  編集
                </button>
                {s.active && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (!window.confirm(`「${s.displayName}」を停止しますか？\n投稿できなくなり、mbPIT専用アカウントはログインもできなくなります。`)) return;
                      start(async () => {
                        const r = await suspendPitStore(s.id);
                        setMsg(r.error ?? `${s.displayName} を停止しました（再開は「承認して有効化」から）`);
                        router.refresh();
                      });
                    }}
                    className="ml-2 text-red-600 hover:underline disabled:opacity-50"
                  >
                    停止
                  </button>
                )}
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
      </div>

      {/* 保存成功時のメッセージ（編集フォームは閉じるのでここに出す） */}
      {!editing && msg && <p className="mt-2 text-xs text-green-700">{msg}</p>}

      {/* 店舗情報（HP表示内容）の編集（Step B/C: 差分プレビュー→確定で即時同期） */}
      {infoEditing && (
        <StoreInfoEditor
          key={infoEditing.id}
          store={{
            id: infoEditing.id,
            displayName: infoEditing.displayName,
            slug: infoEditing.slug,
            active: infoEditing.active,
            info: infoEditing.info,
            contactPerson: infoEditing.contactPerson,
            internalNote: infoEditing.internalNote,
          }}
          onClose={() => setInfoEditingId(null)}
        />
      )}

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
                <option value="">本店直営（代理店に紐づけない）</option>
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
              WordPressカテゴリID（空欄で保存すると親545配下に自動作成）
              <input
                value={editing.wpCategoryId || ""}
                inputMode="numeric"
                placeholder="空欄 = 自動作成"
                onChange={(e) => setEditing({ ...editing, wpCategoryId: Number(e.target.value) || 0 })}
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
            カテゴリIDを空欄にすると、保存時にWordPressへ親545配下のカテゴリ（名前=表示名・slug=slug）を自動作成します。
            確定済みカテゴリID: {KNOWN_CATEGORIES.map((k) => `${k.name}=${k.id}(${k.slug})`).join(" / ")}（親: mbPIT施工記録=545）
          </div>
        </div>
      )}
    </Card>
  );
}

// 同期状態バッジ: ok=同期済み / stale=アプリ側が新しい（未同期） / failed=直近同期が失敗
function SyncBadge({ badge }: { badge: StoreRow["syncBadge"] }) {
  const map = {
    ok: { label: "同期済み", cls: "bg-green-100 text-green-800" },
    stale: { label: "未同期", cls: "bg-amber-100 text-amber-800" },
    failed: { label: "失敗", cls: "bg-red-100 text-red-800" },
    none: { label: "—", cls: "bg-surface-2 text-ink-soft" },
  } as const;
  const m = map[badge];
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${m.cls}`}>{m.label}</span>;
}

// ── 店舗マスター Step A: WPの店舗情報（term meta）をアプリへ初期取込 ──
function StoreInfoIngest() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<IngestRow[] | null>(null);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [rt, setRt] = useState<RoundtripRow[] | null>(null);

  const runRoundtrip = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await roundtripCheck();
      if (r.error) setError(r.error);
      else setRt(r.rows ?? []);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!window.confirm("WordPressの現在の店舗情報（所在地・営業時間等）をアプリに取り込みます。アプリ側の店舗情報は上書きされます。実行しますか？")) return;
    setBusy(true);
    setError(null);
    try {
      const r = await ingestPitStoreInfo();
      if (r.error) setError(r.error);
      else {
        setRows(r.rows ?? []);
        setUnmatched(r.unmatchedTerms ?? []);
        router.refresh();
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">店舗情報の取込（WP→アプリ・初回のみ）</h3>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={runRoundtrip}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:bg-surface-2 disabled:opacity-50"
          >
            全店舗dry-run（差分チェック）
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={run}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:bg-surface-2 disabled:opacity-50"
          >
            {busy ? "実行中…" : "WPから取り込む"}
          </button>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-ink-soft">
        WordPress側で管理していた店舗情報（所在地・営業時間・TEL等の term meta）をアプリへ吸い上げます。
        取込後はアプリが原本になります（編集フォームと自動反映は次ステップで実装）。
      </p>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {rows && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-[11px] text-ink-soft">
              <tr>
                <th className="py-1">店舗</th>
                <th>term_id</th>
                <th>WPカテゴリslug</th>
                <th>短slug</th>
                <th>店舗ページID</th>
                <th>取込項目</th>
                <th>結果</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="py-1 font-semibold">{r.storeName}</td>
                  <td className="font-mono">{r.termId}</td>
                  <td className="font-mono">{r.categorySlug || "—"}</td>
                  <td className="font-mono">
                    {r.shortSlug}
                    {r.slugChanged && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-800">変更</span>}
                  </td>
                  <td className="font-mono">{r.wpPageId ?? "—"}</td>
                  <td>{r.filledFields}/9</td>
                  <td>{r.error ? <span className="text-red-600">{r.error}</span> : "✓ 取込済み"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {unmatched.length > 0 && (
            <p className="mt-2 text-[11px] text-amber-700">
              WP側にあるがアプリに店舗が無いカテゴリ: {unmatched.join(" / ")}
            </p>
          )}
        </div>
      )}
      {rt && (
        <div className="mt-2">
          <h4 className="text-xs font-semibold">ラウンドトリップ検証（dry-run・WP無変更）</h4>
          <div className="mt-1 space-y-0.5 text-xs">
            {rt.map((r, i) => (
              <div key={i}>
                {r.storeName}:{" "}
                {r.error ? (
                  <span className="text-red-600">{r.error}</span>
                ) : r.diffCount === 0 ? (
                  <span className="text-green-700">✓ 差分ゼロ（アプリ==WP）</span>
                ) : (
                  <span className="text-amber-700">差分 {r.diffCount} 項目（アプリ側が新しい）</span>
                )}
              </div>
            ))}
            {rt.length === 0 && <p className="text-ink-soft">対象店舗がありません。</p>}
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
