"use client";

import { useState, useTransition } from "react";
import { Badge, Button, Input, Select } from "@/components/ui";
import type { OptionDef } from "@/lib/vehicle-pages/options";
import {
  addVpageRelatedPost,
  pushPendingVpagesForBrand,
  resyncAllVpagesForBrand,
  pushVpage,
  removeVpageRelatedPost,
  seedVpagesForBrand,
  updateVpageEnPriceMode,
  updateVpageOption,
  updateVpageStatus,
} from "@/lib/actions/vehicle-pages";

export type VpageRow = {
  pageId: string;
  slug: string;
  status: string;
  enPriceMode: string;
  options: Record<string, boolean>;
  related: { id?: number; title: string; url: string }[];
  wpPageIdJp: number | null;
  wpPageIdEn: number | null;
  carName: string;
  grade: string | null;
  engine: string;
  stockOutput: string | null;
  stage1Gain: string | null;
};

type BrandData = {
  id: string;
  displayName: string;
  urlSlug: string;
  vehicleCount: number;
  seeded: number;
  pendingPush: number;
  liveCount: number;
  rows: VpageRow[];
};

const STATUS_LABEL: Record<string, string> = { hold: "保留", draft: "下書き", publish: "公開" };
const STATUS_TONE: Record<string, string> = {
  hold: "bg-surface-2 text-ink-soft",
  draft: "bg-amber-100 text-amber-800",
  publish: "bg-emerald-100 text-emerald-800",
};

export function VpageBoard({ brands, optionDefs }: { brands: BrandData[]; optionDefs: OptionDef[] }) {
  const [active, setActive] = useState(brands[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const current = brands.find((b) => b.id === active) ?? brands[0];
  if (!current) return null;

  const q = query.trim().toLowerCase();
  const rows = current.rows.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (!q) return true;
    return `${r.carName} ${r.grade ?? ""} ${r.slug} ${r.engine}`.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {brands.map((b) => {
          const on = b.id === current.id;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => setActive(b.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                on ? "bg-gold-500 text-white" : "border border-line bg-surface text-ink-soft hover:bg-surface-2"
              }`}
            >
              {b.displayName}
              <span className={`ml-1.5 text-[10px] ${on ? "text-white/80" : "text-ink-soft"}`}>
                {b.seeded}/{b.vehicleCount}
              </span>
            </button>
          );
        })}
      </div>

      <SeedBar brand={current} />
      <PendingPushBar brand={current} />
      <ResyncBar brand={current} />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="検索（車種・グレード・slug）"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-auto">
          <option value="all">すべて（{current.rows.length}）</option>
          <option value="hold">保留のみ</option>
          <option value="draft">下書きのみ</option>
          <option value="publish">公開のみ</option>
        </Select>
        <span className="text-xs text-ink-soft">{rows.length} 件表示</span>
      </div>

      <div className="space-y-2">
        {rows.map((r) => (
          <VpageCard key={r.pageId} row={r} brandUrlSlug={current.urlSlug} optionDefs={optionDefs} />
        ))}
        {rows.length === 0 && <p className="py-8 text-center text-sm text-ink-soft">該当なし</p>}
      </div>
    </div>
  );
}

function SeedBar({ brand }: { brand: BrandData }) {
  const [pending, start] = useTransition();
  const missing = brand.vehicleCount - brand.seeded;
  if (missing <= 0) return null;
  return (
    <div className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
      <span>ページ行が未作成の車両が {missing} 台あります（保留状態で作成されます）</span>
      <Button
        disabled={pending}
        onClick={() => start(async () => void (await seedVpagesForBrand(brand.id)))}
      >
        {pending ? "作成中…" : "行を用意する"}
      </Button>
    </div>
  );
}

/** デザインや表示ルールを変えた後に、そのブランドの公開ページを全部作り直す */
function ResyncBar({ brand }: { brand: BrandData }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  if (brand.liveCount === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
      <span className="text-ink-soft">
        {msg ?? `公開・下書き中の ${brand.liveCount} 台。デザインや表示ルールを変えた後は再反映してください`}
      </span>
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg("再反映中…（1台あたり数秒かかります）");
            const r = await resyncAllVpagesForBrand(brand.id);
            setMsg(r.error ?? `再反映しました（成功 ${r.synced ?? 0} 台 / 失敗 ${r.failed ?? 0} 台）`);
          })
        }
      >
        {pending ? "再反映中…" : "全ページを再反映"}
      </Button>
    </div>
  );
}

function PendingPushBar({ brand }: { brand: BrandData }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  if (brand.pendingPush <= 0 && !msg) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
      <span>
        {brand.pendingPush > 0
          ? `WPページが未作成のまま 下書き/公開 になっている車両が ${brand.pendingPush} 台あります`
          : msg}
      </span>
      {brand.pendingPush > 0 && (
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await pushPendingVpagesForBrand(brand.id);
              setMsg(r.error ?? `反映しました（成功 ${r.created ?? 0} 台 / 失敗 ${r.failed ?? 0} 台）`);
            })
          }
        >
          {pending ? "反映中…" : "まとめてWPへ反映"}
        </Button>
      )}
    </div>
  );
}

function VpageCard({ row, brandUrlSlug, optionDefs }: { row: VpageRow; brandUrlSlug: string; optionDefs: OptionDef[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [log, setLog] = useState<string | null>(null);
  const [relatedId, setRelatedId] = useState("");

  const jpUrl = `https://mbfasttuning.com/tuning/${brandUrlSlug}/${row.slug}/`;
  const enUrl = `https://mbfasttuning.com/en/tuning/${brandUrlSlug}/${row.slug}/`;

  return (
    <div className="rounded-lg border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${STATUS_TONE[row.status] ?? ""}`}>
          {STATUS_LABEL[row.status] ?? row.status}
        </span>
        <span className="flex-1 truncate text-sm font-semibold">
          {row.carName} {row.grade ?? ""}
        </span>
        <span className="hidden text-xs text-ink-soft sm:inline">
          {row.stockOutput ?? ""} {row.stage1Gain ? `(${row.stage1Gain})` : ""}
        </span>
        <span className="text-xs text-ink-soft">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-line px-3 py-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-ink-soft">/{row.slug}/</span>
            {row.wpPageIdJp ? (
              <a className="text-gold-600 underline" href={jpUrl} target="_blank" rel="noopener">
                JP:{row.wpPageIdJp}
              </a>
            ) : (
              <Badge>JP未作成</Badge>
            )}
            {row.wpPageIdEn ? (
              <a className="text-gold-600 underline" href={enUrl} target="_blank" rel="noopener">
                EN:{row.wpPageIdEn}
              </a>
            ) : (
              <Badge>EN未作成</Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-ink-soft">状態:</label>
            <Select
              value={row.status}
              disabled={pending}
              onChange={(e) =>
                start(async () => {
                  const r = await updateVpageStatus(row.pageId, e.target.value);
                  setLog(r.error ?? r.syncWarning ?? null);
                })
              }
              className="w-auto"
            >
              <option value="hold">保留（生成しない）</option>
              <option value="draft">下書き</option>
              <option value="publish">公開</option>
            </Select>
            <label className="ml-2 text-xs text-ink-soft">EN価格:</label>
            <Select
              value={row.enPriceMode}
              disabled={pending}
              onChange={(e) => start(async () => void (await updateVpageEnPriceMode(row.pageId, e.target.value)))}
              className="w-auto"
            >
              <option value="quote">非表示（見積CTA）</option>
              <option value="price">表示（EN価格レコード）</option>
            </Select>
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold text-ink-soft">
              対応オプション（タップで 未 → 〇 → — → 未）。<strong>全項目どのメーカーでも選べます</strong>。
              ページには<strong>〇か—にした項目だけ</strong>が出ます（「未」はページに出ません＝項目を足しただけでは出ません）
            </p>
            <div className="flex flex-wrap gap-1.5">
              {optionDefs.map((o) => {
                const val = row.options[o.key];
                const label = val === true ? "〇" : val === false ? "—" : "未";
                const tone =
                  val === true
                    ? "border-gold-500 bg-gold-500/10 text-gold-700"
                    : val === false
                      ? "border-line bg-surface-2 text-ink-soft"
                      : "border-dashed border-line text-ink-soft/60";
                return (
                  <button
                    key={o.key}
                    type="button"
                    disabled={pending}
                    title="タップで 未設定 → 〇 → — → 未設定"
                    onClick={() =>
                      start(async () => {
                        const next = val === undefined ? true : val === true ? false : null;
                        await updateVpageOption(row.pageId, o.key, next);
                      })
                    }
                    className={`rounded border px-2 py-1 text-[11px] ${tone}`}
                  >
                    {o.jp} {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold text-ink-soft">実績記事（同型式の施工記録）</p>
            <ul className="space-y-1">
              {row.related.map((r) => (
                <li key={r.id ?? r.url} className="flex items-center gap-2 text-xs">
                  <a className="flex-1 truncate text-gold-600 underline" href={r.url} target="_blank" rel="noopener">
                    {r.title}
                  </a>
                  {r.id != null && (
                    <button
                      type="button"
                      disabled={pending}
                      className="text-ink-soft hover:text-red-600"
                      onClick={() => start(async () => void (await removeVpageRelatedPost(row.pageId, r.id!)))}
                    >
                      削除
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-1 flex items-center gap-2">
              <Input
                placeholder="WP記事ID"
                value={relatedId}
                onChange={(e) => setRelatedId(e.target.value)}
                className="w-28"
              />
              <Button
                disabled={pending || !relatedId.trim()}
                onClick={() =>
                  start(async () => {
                    const res = await addVpageRelatedPost(row.pageId, Number(relatedId.trim()));
                    setLog(res.error ?? null);
                    if (!res.error) setRelatedId("");
                  })
                }
              >
                追加
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2 border-t border-line pt-2">
            <Button
              disabled={pending || row.status === "hold"}
              onClick={() =>
                start(async () => {
                  const res = await pushVpage(row.pageId);
                  setLog(res.error ?? res.events?.map((e) => e.message).join(" / ") ?? null);
                })
              }
            >
              {pending ? "反映中…" : "WPへ反映"}
            </Button>
            <span className="text-[11px] text-ink-soft">
              {row.status === "hold" ? "保留中は反映されません" : "作成 or マーカー区間の更新を行います"}
            </span>
          </div>
          {log && <p className="text-[11px] text-ink-soft">{log}</p>}
        </div>
      )}
    </div>
  );
}
