"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card } from "@/components/ui";
import {
  archiveBaseFile,
  createVariantWithFile,
  setVariantStatus,
  updateVariant,
} from "@/lib/actions/catalog";
import { type FuelKind, fuelKindOf, optionTagsFor, popsAllowed } from "@/lib/catalog/options";

export type PendingVariant = {
  id: string;
  stage: string;
  options: string;
  popsAndBangs: boolean;
  status: "DRAFT" | "AVAILABLE" | "DISABLED";
  fileName: string;
};

export type PendingRow = {
  baseFileId: string;
  manufacturer: string;
  model: string;
  ecu: string;
  mcu: string;
  cal: string;
  generation: string;
  method: string;
  fuel: string;
  stockHashShort: string;
  source: "AUTO_CAPTURE" | "MANUAL";
  hasStock: boolean;
  capturedAtLabel: string;
  variants: PendingVariant[];
};

export function PendingList({ rows }: { rows: PendingRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok?: boolean; error?: string }>) {
    startTransition(async () => {
      const res = await fn();
      setMsg(res?.error ?? null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {(pending || msg) && (
        <div className="text-xs">
          {pending && <span className="text-ink-soft">保存中… </span>}
          {msg && <span className="text-red-600">{msg}</span>}
        </div>
      )}
      {rows.map((r) => (
        <PendingCard
          key={r.baseFileId}
          row={r}
          onAddFile={(fd) => run(() => createVariantWithFile(r.baseFileId, fd))}
          onArchive={() => run(() => archiveBaseFile(r.baseFileId))}
          onPublish={(variantId) => run(() => setVariantStatus(variantId, "AVAILABLE"))}
          onPatch={(variantId, patch) => run(() => updateVariant(variantId, patch))}
        />
      ))}
    </div>
  );
}

function PendingCard({
  row,
  onAddFile,
  onArchive,
  onPublish,
  onPatch,
}: {
  row: PendingRow;
  onAddFile: (fd: FormData) => void;
  onArchive: () => void;
  onPublish: (variantId: string) => void;
  onPatch: (variantId: string, patch: Record<string, unknown>) => void;
}) {
  const fuelKind = fuelKindOf(row.fuel);
  const showPops = popsAllowed(fuelKind);
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-ink">
              {row.manufacturer} {row.model}
            </span>
            <Badge color={row.source === "AUTO_CAPTURE" ? "blue" : "gray"}>
              {row.source === "AUTO_CAPTURE" ? "自動取込" : "手動"}
            </Badge>
            {row.fuel && (
              <Badge color={fuelKind === "diesel" ? "gray" : "gold"}>
                {fuelKind === "diesel" ? "ディーゼル" : fuelKind === "gasoline" ? "ガソリン" : row.fuel}
              </Badge>
            )}
          </div>
          {row.cal && (
            <div className="mt-1">
              <span className="rounded bg-gold-50 px-2 py-0.5 font-mono text-sm font-bold text-ink">
                Cal {row.cal}
              </span>
            </div>
          )}
          <div className="mt-0.5 text-xs text-ink-soft">
            <span className="font-mono">{row.ecu}</span>
            {row.generation ? `・世代 ${row.generation}` : ""}
            {row.method ? `・${row.method}` : ""}
            {row.mcu ? `・MCU ${row.mcu}` : ""}・取込 {row.capturedAtLabel}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-ink-soft">
            stockHash: {row.stockHashShort}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {row.hasStock && (
            <a
              href={`/api/catalog/base/${row.baseFileId}/stock`}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-surface-2"
            >
              原本DL
            </a>
          )}
          <button
            type="button"
            onClick={onArchive}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
          >
            却下
          </button>
        </div>
      </div>

      {/* 既に添付済み(DRAFT)の mod があれば、その場で配布可にできる */}
      {row.variants.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          {row.variants.map((v) => (
            <div key={v.id} className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-ink">{v.fileName || "(ファイル)"}</span>
              <input
                defaultValue={v.stage}
                placeholder="Stage"
                onBlur={(e) => {
                  if (e.target.value.trim() !== v.stage) onPatch(v.id, { stage: e.target.value.trim() });
                }}
                className="w-24 rounded border border-line px-1.5 py-1 text-xs"
              />
              <input
                defaultValue={v.options}
                placeholder="オプション"
                onBlur={(e) => {
                  if (e.target.value.trim() !== v.options) onPatch(v.id, { options: e.target.value.trim() });
                }}
                className="w-36 rounded border border-line px-1.5 py-1 text-xs"
              />
              {showPops && (
                <label className="flex items-center gap-1 text-xs text-ink-soft">
                  <input
                    type="checkbox"
                    defaultChecked={v.popsAndBangs}
                    onChange={(e) => onPatch(v.id, { popsAndBangs: e.target.checked })}
                    className="h-4 w-4 accent-gold-500"
                  />
                  Pops
                </label>
              )}
              <Badge color="gray">下書き</Badge>
              <Button type="button" onClick={() => onPublish(v.id)}>
                配布可にする
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 border-t border-line pt-3">
        <ModDropZone onAddFile={onAddFile} fuelKind={fuelKind} />
      </div>
    </Card>
  );
}

function ModDropZone({
  onAddFile,
  fuelKind,
}: {
  onAddFile: (fd: FormData) => void;
  fuelKind: FuelKind;
}) {
  const availableTags = optionTagsFor(fuelKind);
  const showPops = popsAllowed(fuelKind);
  const [drag, setDrag] = useState(false);
  const [stage, setStage] = useState("");
  const [options, setOptions] = useState("");
  const [pops, setPops] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const toggleTag = (tag: string) =>
    setTags((cur) => (cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]));

  const submit = (file: File) => {
    const fd = new FormData();
    fd.set("file", file);
    if (stage.trim()) fd.set("stage", stage.trim());
    if (options.trim()) fd.set("options", options.trim());
    fd.set("popsAndBangs", showPops && pops ? "true" : "false");
    fd.set("optionTags", JSON.stringify(tags.filter((t) => availableTags.includes(t))));
    onAddFile(fd);
    setStage("");
    setOptions("");
    setPops(false);
    setTags([]);
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          placeholder="ステージ（例 Stage1）"
          className="w-32 rounded border border-line px-2 py-1 text-xs"
        />
        {showPops && (
          <label className="flex items-center gap-1 text-xs text-ink-soft">
            <input type="checkbox" checked={pops} onChange={(e) => setPops(e.target.checked)} className="h-3.5 w-3.5 accent-gold-500" />
            Pops
          </label>
        )}
        {availableTags.map((tag) => (
          <label key={tag} className="flex items-center gap-1 text-xs text-ink-soft">
            <input
              type="checkbox"
              checked={tags.includes(tag)}
              onChange={() => toggleTag(tag)}
              className="h-3.5 w-3.5 accent-gold-500"
            />
            {tag}
          </label>
        ))}
        <input
          value={options}
          onChange={(e) => setOptions(e.target.value)}
          placeholder="自由記述（任意）"
          className="w-40 rounded border border-line px-2 py-1 text-xs"
        />
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) submit(f);
        }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-lg border border-dashed p-4 text-center text-xs ${
          drag ? "border-gold-400 bg-gold-50 text-ink" : "border-line text-ink-soft"
        }`}
      >
        mod ファイルをドラッグ&ドロップ（またはクリックして選択）
      </div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) submit(f);
        }}
      />
    </div>
  );
}
