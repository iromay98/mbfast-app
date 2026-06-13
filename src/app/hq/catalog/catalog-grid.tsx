"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card } from "@/components/ui";
import {
  createVariant,
  deleteVariant,
  duplicateVariant,
  replaceVariantFile,
  restoreVariantVersion,
  setVariantStatus,
  updateBaseFile,
  updateVariant,
} from "@/lib/actions/catalog";
import { type FuelKind, optionTagsFor, popsAllowed } from "@/lib/catalog/options";
import { swLabel } from "@/lib/catalog/sw";

export type CatalogVersion = {
  id: string;
  version: number;
  fileName: string;
  fileHash: string;
  replacedAtLabel: string;
};

export type CatalogRow = {
  id: string;
  baseFileId: string;
  manufacturer: string;
  model: string;
  generation: string;
  engineCode: string;
  displacement: string;
  ecu: string;
  mcu: string;
  cal: string;
  sw: string;
  swSeq: number;
  fuel: string;
  stockHash: string;
  hasStock: boolean;
  stage: string;
  popsAndBangs: boolean;
  popsSport: boolean;
  optionTags: string[];
  options: string;
  note: string;
  status: "DRAFT" | "AVAILABLE" | "DISABLED";
  fileName: string;
  fileHash: string;
  fileSize: number | null;
  updatedAtLabel: string;
  versions: CatalogVersion[];
};

// 階層: Cal(大) → ステージ(中) → バブリング(小)
export type PopsGroup = { pops: boolean; rows: CatalogRow[] };
export type StageGroup = { stage: string; label: string; pops: PopsGroup[] };
export type CalGroup = {
  baseFileId: string;
  manufacturer: string;
  model: string;
  generation: string;
  engineCode: string;
  displacement: string;
  ecu: string;
  cal: string;
  sw: string;
  swSeq: number;
  fuelKind: FuelKind;
  hasStock: boolean;
  count: number;
  stages: StageGroup[];
};

const STATUS_LABEL: Record<CatalogRow["status"], string> = {
  DRAFT: "下書き",
  AVAILABLE: "配布可",
  DISABLED: "無効",
};

const editInput =
  "min-w-0 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-line focus:border-gold-400 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-gold-200";

function EditCell({
  value,
  onSave,
  mono,
  placeholder,
  className,
}: {
  value: string;
  onSave: (v: string) => void;
  mono?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [v, setV] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setV(value);
  }
  return (
    <input
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== value) onSave(v.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setV(value);
          e.currentTarget.blur();
        }
      }}
      className={`${editInput} ${mono ? "font-mono text-xs" : ""} ${className ?? ""}`}
    />
  );
}

export function CatalogGrid({ groups }: { groups: CalGroup[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  // 既定は閉じる（行が長くなり管理しづらいため）。展開した baseFileId だけを保持。
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showNew, setShowNew] = useState(false);

  function run(fn: () => Promise<{ ok?: boolean; error?: string }>) {
    startTransition(async () => {
      const res = await fn();
      setMsg(res?.error ?? null);
      router.refresh();
    });
  }

  const toggleCollapse = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button type="button" onClick={() => setShowNew((s) => !s)}>
          {showNew ? "追加をとじる" : "＋ 新規ベースを追加"}
        </Button>
        {pending && <span className="text-xs text-ink-soft">保存中…</span>}
        {msg && <span className="text-xs text-red-600">{msg}</span>}
      </div>

      {showNew && (
        <NewRowForm
          onCreate={(input) =>
            startTransition(async () => {
              const res = await createVariant(input);
              if (res?.error) setMsg(res.error);
              else {
                setMsg(null);
                setShowNew(false);
                router.refresh();
              }
            })
          }
        />
      )}

      {groups.length === 0 && (
        <Card>
          <p className="py-6 text-center text-sm text-ink-soft">
            まだ項目がありません。未整備ストックに mod を登録するか「新規ベースを追加」してください。
          </p>
        </Card>
      )}

      {groups.map((g) => (
        <CalGroupCard
          key={g.baseFileId}
          group={g}
          open={expanded.has(g.baseFileId)}
          onToggleOpen={() => toggleCollapse(g.baseFileId)}
          onPatchBase={(p) => run(() => updateBaseFile(g.baseFileId, p))}
          onAddVariant={(stage, pops) =>
            run(() =>
              createVariant({
                baseFileId: g.baseFileId,
                stage: stage || undefined,
                popsAndBangs: pops,
              }),
            )
          }
          onPatchVariant={(id, p) => run(() => updateVariant(id, p))}
          onDuplicate={(id) => run(() => duplicateVariant(id))}
          onDelete={(id) => run(() => deleteVariant(id))}
          onStatus={(id, s) => run(() => setVariantStatus(id, s))}
          onUpload={(id, f) => {
            const fd = new FormData();
            fd.set("file", f);
            run(() => replaceVariantFile(id, fd));
          }}
          onRestore={(id, versionId) => run(() => restoreVariantVersion(id, versionId))}
        />
      ))}
    </div>
  );
}

function CalGroupCard({
  group,
  open,
  onToggleOpen,
  onPatchBase,
  onAddVariant,
  onPatchVariant,
  onDuplicate,
  onDelete,
  onStatus,
  onUpload,
  onRestore,
}: {
  group: CalGroup;
  open: boolean;
  onToggleOpen: () => void;
  onPatchBase: (p: Record<string, unknown>) => void;
  onAddVariant: (stage: string, pops: boolean) => void;
  onPatchVariant: (id: string, p: Record<string, unknown>) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onStatus: (id: string, s: string) => void;
  onUpload: (id: string, f: File) => void;
  onRestore: (id: string, versionId: string) => void;
}) {
  const g = group;
  const tags = optionTagsFor(g.fuelKind);
  const showPops = popsAllowed(g.fuelKind); // ディーゼルは false（バブリングなし）
  const [adding, setAdding] = useState(false);
  const [newStage, setNewStage] = useState("");
  const [newPops, setNewPops] = useState(false);
  return (
    <Card className="p-0">
      {/* 大グループ見出し（Cal） */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface-2 p-3">
        <button type="button" onClick={onToggleOpen} className="text-sm text-ink-soft">
          {open ? "▼" : "▶"}
        </button>
        {/* メーカー・ECU は slave 由来で固定（編集不可）。グレード(車種)のみ編集可。 */}
        <span className="text-sm font-semibold text-ink">{g.manufacturer}</span>
        <EditCell value={g.model} onSave={(v) => onPatchBase({ model: v })} className="w-24 font-semibold" />
        {g.generation && <span className="text-xs text-ink-soft">({g.generation})</span>}
        {(g.displacement || g.engineCode) && (
          <span className="text-xs text-ink-soft">
            {[g.displacement, g.engineCode].filter(Boolean).join(" ")}
          </span>
        )}
        <span className="font-mono text-xs text-ink-soft">{g.ecu}</span>
        <span className="rounded bg-gold-50 px-2 py-0.5 font-mono text-sm font-bold text-ink">
          Cal {g.cal || "—"}
        </span>
        {g.sw && (
          <span
            className="rounded bg-surface-2 px-2 py-0.5 font-mono text-xs font-semibold text-ink-soft"
            title={g.swSeq > 0 ? "同一SW・別内容のため枝番で区別" : undefined}
          >
            SW {swLabel(g.sw, g.swSeq)}
          </span>
        )}
        <span className="text-xs text-ink-soft">{g.count}件</span>
        <div className="ml-auto flex items-center gap-2">
          {g.hasStock && (
            <a
              href={`/api/catalog/base/${g.baseFileId}/stock`}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-surface"
            >
              原本DL
            </a>
          )}
          <button
            type="button"
            onClick={() => setAdding((s) => !s)}
            className="rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-semibold text-white"
          >
            {adding ? "とじる" : "＋版を追加"}
          </button>
        </div>
      </div>

      {/* 版の追加：ステージとバブ有無は登録時に決定（以後固定） */}
      {adding && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-gold-50 p-3">
          <span className="text-xs text-ink-soft">ステージ</span>
          <input
            value={newStage}
            onChange={(e) => setNewStage(e.target.value)}
            placeholder="空=チューニングなし / Stage1 …"
            className="w-48 rounded border border-line bg-surface px-2 py-1 text-sm"
          />
          {showPops && (
            <label className="flex items-center gap-1 text-xs text-ink-soft">
              <input
                type="checkbox"
                checked={newPops}
                onChange={(e) => setNewPops(e.target.checked)}
                className="h-3.5 w-3.5 accent-gold-500"
              />
              バブリングあり
            </label>
          )}
          <button
            type="button"
            onClick={() => {
              onAddVariant(newStage.trim(), showPops ? newPops : false);
              setNewStage("");
              setNewPops(false);
              setAdding(false);
            }}
            className="rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-semibold text-white"
          >
            追加
          </button>
          <span className="text-[11px] text-ink-soft">
            ※ ステージ・バブ有無は登録後は固定（変更不可）
          </span>
        </div>
      )}

      {open && (
        <div className="divide-y divide-line">
          {g.stages.map((sg) => (
            <div key={sg.stage} className="p-3">
              {/* 中グループ（ステージ） */}
              <div className="mb-2 text-sm font-bold text-ink">
                {sg.label}
                <span className="ml-2 text-xs font-normal text-ink-soft">
                  {sg.pops.reduce((n, p) => n + p.rows.length, 0)}件
                </span>
              </div>
              <div className="space-y-2 pl-3">
                {showPops ? (
                  // ガソリン/不明: バブリングあり/なし の小グループを表示
                  sg.pops.map((pg) => (
                    <div key={String(pg.pops)}>
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-xs font-semibold text-ink-soft">
                          {pg.pops ? "バブリングあり" : "バブリングなし"}
                        </span>
                        <button
                          type="button"
                          onClick={() => onAddVariant(sg.stage, pg.pops)}
                          title={`${sg.label}・${pg.pops ? "バブリングあり" : "バブリングなし"} に版を追加`}
                          className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-soft hover:bg-surface-2"
                        >
                          ＋追加
                        </button>
                        {pg.rows.length === 0 && (
                          <span className="text-[11px] text-ink-soft">（未登録）</span>
                        )}
                      </div>
                      <div className="space-y-2 pl-2">
                        {pg.rows.map((r) => (
                          <LeafRow
                            key={r.id}
                            row={r}
                            tags={tags}
                            showPops={showPops}
                            onPatch={(p) => onPatchVariant(r.id, p)}
                            onDuplicate={() => onDuplicate(r.id)}
                            onDelete={() => onDelete(r.id)}
                            onStatus={(s) => onStatus(r.id, s)}
                            onUpload={(f) => onUpload(r.id, f)}
                            onRestore={(versionId) => onRestore(r.id, versionId)}
                          />
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  // ディーゼル: バブリングなし。フラット表示＋ステージへ直接追加。
                  <div>
                    <div className="mb-1">
                      <button
                        type="button"
                        onClick={() => onAddVariant(sg.stage, false)}
                        title={`${sg.label} に版を追加`}
                        className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-soft hover:bg-surface-2"
                      >
                        ＋追加
                      </button>
                    </div>
                    <div className="space-y-2 pl-2">
                      {sg.pops
                        .flatMap((pg) => pg.rows)
                        .map((r) => (
                          <LeafRow
                            key={r.id}
                            row={r}
                            tags={tags}
                            showPops={false}
                            onPatch={(p) => onPatchVariant(r.id, p)}
                            onDuplicate={() => onDuplicate(r.id)}
                            onDelete={() => onDelete(r.id)}
                            onStatus={(s) => onStatus(r.id, s)}
                            onUpload={(f) => onUpload(r.id, f)}
                            onRestore={(versionId) => onRestore(r.id, versionId)}
                          />
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function LeafRow({
  row,
  tags,
  showPops,
  onPatch,
  onDuplicate,
  onDelete,
  onStatus,
  onUpload,
  onRestore,
}: {
  row: CatalogRow;
  tags: string[];
  showPops: boolean;
  onPatch: (p: Record<string, unknown>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onStatus: (s: string) => void;
  onUpload: (f: File) => void;
  onRestore: (versionId: string) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const handle = (files: FileList | null) => {
    const f = files?.[0];
    if (f) onUpload(f);
  };
  const dim = row.status === "DISABLED" ? "opacity-60" : "";
  return (
    <div>
      {/* 1行コンパクト表示。行全体がドロップ対象。 */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          handle(e.dataTransfer.files);
        }}
        className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded border px-2 py-1 ${
          drag ? "border-gold-400 bg-gold-50" : "border-line"
        } ${dim}`}
      >
        {/* ステージは固定表示（登録時に決定）。うっかり変更防止のため編集不可。 */}
        <span
          className="w-16 shrink-0 truncate text-[11px] font-medium text-ink"
          title="ステージは固定です（登録時に決定）"
        >
          {row.stage || "—"}
        </span>
        {/* バブリング有無は固定表示（登録時に決定）。ディーゼルは非表示。 */}
        {showPops && (
          <label
            className="flex items-center gap-0.5 text-[11px] text-ink-soft"
            title="バブリング有無は固定です（登録時に決定）"
          >
            <input
              type="checkbox"
              checked={row.popsAndBangs}
              readOnly
              disabled
              className="h-3 w-3 cursor-not-allowed accent-gold-500"
            />
            Pops{row.popsAndBangs ? (row.popsSport ? "(スポーツ)" : "(全)") : ""}
          </label>
        )}
        {tags.map((tag) => (
          <label key={tag} className="flex items-center gap-0.5 text-[11px] text-ink-soft">
            <input
              type="checkbox"
              checked={row.optionTags.includes(tag)}
              onChange={(e) => {
                const next = e.target.checked
                  ? [...row.optionTags, tag]
                  : row.optionTags.filter((t) => t !== tag);
                onPatch({ optionTags: next });
              }}
              className="h-3 w-3 accent-gold-500"
            />
            {tag}
          </label>
        ))}
        <select
          value={row.status}
          onChange={(e) => onStatus(e.target.value)}
          className="rounded border border-line bg-surface px-1 py-0.5 text-[11px]"
        >
          {(["DRAFT", "AVAILABLE", "DISABLED"] as const).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <span className="text-line">|</span>
        {row.fileName ? (
          <a
            href={`/api/catalog/variants/${row.id}/file`}
            title={row.fileHash}
            className="max-w-[180px] truncate font-mono text-[11px] text-gold-700 underline"
          >
            {row.fileName}
          </a>
        ) : (
          <span className="text-[11px] text-ink-soft">未登録</span>
        )}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded bg-gold-500 px-1.5 py-0.5 text-[11px] font-semibold text-white"
        >
          {row.fileName ? "差替" : "UP"}
        </button>
        {row.versions.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHistory((s) => !s)}
            className="text-[11px] text-ink-soft underline"
          >
            履歴({row.versions.length})
          </button>
        )}
        <button
          type="button"
          onClick={onDuplicate}
          title="この版を複製（下書きで作成）"
          className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-soft hover:bg-surface-2"
        >
          複製
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm("この版をアーカイブします（メンテナンスから復元できます）。")) onDelete();
          }}
          title="この版をアーカイブ（後で復元可）"
          className="rounded border border-red-200 px-1.5 py-0.5 text-[11px] text-red-600 hover:bg-red-50"
        >
          削除
        </button>
        <EditCell
          value={row.options}
          onSave={(v) => onPatch({ options: v })}
          placeholder="メモ"
          className="w-24"
        />
        <span className="ml-auto whitespace-nowrap text-[11px] text-ink-soft">
          {row.updatedAtLabel}
        </span>
        <input ref={inputRef} type="file" className="hidden" onChange={(e) => handle(e.target.files)} />
      </div>

      {showHistory && (
        <div className="mt-1 pl-2">
          <VersionHistory row={row} onRestore={onRestore} />
        </div>
      )}
    </div>
  );
}

function VersionHistory({
  row,
  onRestore,
}: {
  row: CatalogRow;
  onRestore: (versionId: string) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-ink">バージョン履歴</p>
      <div className="space-y-1">
        {row.versions.map((v) => {
          const isCurrent = v.fileHash === row.fileHash;
          return (
            <div key={v.id} className="flex items-center gap-3 text-xs">
              <span className="w-10 shrink-0 font-mono text-ink-soft">v{v.version}</span>
              <a
                href={`/api/catalog/versions/${v.id}/file`}
                className="truncate font-mono text-gold-700 underline"
              >
                {v.fileName || "(no name)"}
              </a>
              <span className="shrink-0 text-ink-soft">{v.replacedAtLabel}</span>
              {isCurrent ? (
                <Badge color="green">現行</Badge>
              ) : (
                <button
                  type="button"
                  onClick={() => onRestore(v.id)}
                  className="shrink-0 rounded border border-line px-2 py-0.5 text-ink-soft hover:bg-surface"
                >
                  この版に戻す
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NewRowForm({
  onCreate,
}: {
  onCreate: (input: {
    manufacturer: string;
    model: string;
    ecu: string;
    stage?: string;
    options?: string;
  }) => void;
}) {
  const [f, setF] = useState({ manufacturer: "", model: "", ecu: "", stage: "", options: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));
  const ready = f.manufacturer.trim() && f.model.trim() && f.ecu.trim();
  const inp = "rounded-lg border border-line bg-surface px-2 py-1.5 text-sm";
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="grid gap-2 sm:grid-cols-5">
        <input className={inp} placeholder="メーカー *" value={f.manufacturer} onChange={set("manufacturer")} />
        <input className={inp} placeholder="車種 *" value={f.model} onChange={set("model")} />
        <input className={`${inp} font-mono`} placeholder="ECU *" value={f.ecu} onChange={set("ecu")} />
        <input className={inp} placeholder="ステージ" value={f.stage} onChange={set("stage")} />
        <input className={inp} placeholder="オプション" value={f.options} onChange={set("options")} />
      </div>
      <div className="mt-2">
        <Button
          type="button"
          disabled={!ready}
          onClick={() =>
            onCreate({
              manufacturer: f.manufacturer.trim(),
              model: f.model.trim(),
              ecu: f.ecu.trim(),
              stage: f.stage.trim() || undefined,
              options: f.options.trim() || undefined,
            })
          }
        >
          追加
        </Button>
      </div>
    </div>
  );
}
