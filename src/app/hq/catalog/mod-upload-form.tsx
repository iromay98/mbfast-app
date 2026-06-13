"use client";

import { useRef, useState, useTransition } from "react";
import { type FuelKind, optionTagsFor, popsAllowed, baselineStages } from "@/lib/catalog/options";
import { analyzeStockBin } from "@/lib/actions/catalog";

const norm = (s?: string | null) => (s ?? "").trim().toUpperCase().replace(/\s+/g, "");

// mod(チューニング済み)ファイルのアップロード用フォーム。
// ステージ＝プルダウン（ベンツのみ Stage1.5）、バブリング＝なし/全モード/スポーツ。
// ファイル選択時に Cal を抽出し、純正の Cal と一致するかチェック（誤アップ防止）。
export function ModUploadForm({
  manufacturer,
  fuelKind,
  baseCal,
  baseSw,
  onAddFile,
}: {
  manufacturer: string;
  fuelKind: FuelKind;
  baseCal?: string;
  baseSw?: string;
  onAddFile: (fd: FormData) => void;
}) {
  const stageOptions = baselineStages(manufacturer);
  const availableTags = optionTagsFor(fuelKind);
  const showPops = popsAllowed(fuelKind);

  const [stage, setStage] = useState(stageOptions.includes("Stage1") ? "Stage1" : stageOptions[0] ?? "");
  const [popsMode, setPopsMode] = useState<"none" | "all" | "sport">("none");
  const [options, setOptions] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 選択中ファイル＋Cal照合
  const [picked, setPicked] = useState<File | null>(null);
  const [checking, startCheck] = useTransition();
  const [check, setCheck] = useState<{ cal: string | null; sw: string | null } | null>(null);

  const toggleTag = (t: string) =>
    setTags((c) => (c.includes(t) ? c.filter((x) => x !== t) : [...c, t]));

  const hasBaseId = !!(baseCal || baseSw);
  let verdict: "match" | "mismatch" | "unknown" = "unknown";
  if (check && hasBaseId) {
    const fc = norm(check.cal);
    const bc = norm(baseCal);
    const fs = norm(check.sw);
    const bs = norm(baseSw);
    if (bc && fc) verdict = fc === bc ? "match" : "mismatch";
    else if (bs && fs) verdict = fs === bs ? "match" : "mismatch";
    else verdict = "unknown";
  }

  const onPick = (file: File | undefined) => {
    if (!file) return;
    setPicked(file);
    setCheck(null);
    const fd = new FormData();
    fd.set("file", file);
    startCheck(async () => {
      const r = await analyzeStockBin(fd);
      if (!r.error) setCheck({ cal: r.cal, sw: r.sw });
    });
  };

  const upload = () => {
    if (!picked) return;
    const pops = showPops && popsMode !== "none";
    const fd = new FormData();
    fd.set("file", picked);
    fd.set("stage", stage.trim());
    fd.set("popsAndBangs", pops ? "true" : "false");
    fd.set("popsSport", showPops && popsMode === "sport" ? "true" : "false");
    fd.set("optionTags", JSON.stringify(tags.filter((t) => availableTags.includes(t))));
    if (options.trim()) fd.set("options", options.trim());
    if (verdict === "mismatch") fd.set("force", "true"); // 警告を見たうえで強行
    onAddFile(fd);
    // リセット
    setPicked(null);
    setCheck(null);
    setPopsMode("none");
    setOptions("");
    setTags([]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const clearPick = () => {
    setPicked(null);
    setCheck(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-soft">ステージ</span>
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          className="rounded border border-line bg-surface px-2 py-1 text-xs"
        >
          {stageOptions.map((s) => (
            <option key={s} value={s}>
              {s || "チューニングなし"}
            </option>
          ))}
        </select>
        {showPops && (
          <>
            <span className="ml-1 text-xs text-ink-soft">バブリング</span>
            <div className="flex gap-1">
              {([
                ["none", "なし"],
                ["all", "全モード"],
                ["sport", "スポーツ"],
              ] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setPopsMode(v)}
                  className={`rounded border px-2 py-1 text-xs font-semibold ${
                    popsMode === v
                      ? "border-gold-400 bg-gold-500 text-white"
                      : "border-line bg-white text-ink-soft hover:bg-surface-2"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
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

      {/* ファイル未選択 → ドロップゾーン */}
      {!picked ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            onPick(e.dataTransfer.files?.[0]);
          }}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer rounded-lg border border-dashed p-4 text-center text-xs ${
            drag ? "border-gold-400 bg-gold-50 text-ink" : "border-line text-ink-soft"
          }`}
        >
          mod ファイルをドラッグ&ドロップ（またはクリックして選択）
        </div>
      ) : (
        /* 選択済み → Cal照合を見せてからアップ */
        <div
          className={`rounded-lg border p-3 text-xs ${
            verdict === "mismatch"
              ? "border-red-300 bg-red-50"
              : verdict === "match"
                ? "border-green-300 bg-green-50"
                : "border-line bg-surface-2"
          }`}
        >
          <div className="font-medium text-ink">{picked.name}</div>
          {checking ? (
            <div className="mt-1 text-ink-soft">Cal を照合中…</div>
          ) : (
            <div className="mt-1 space-y-0.5">
              <div className="font-mono text-ink-soft">
                ファイル: Cal {check?.cal ?? "—"} ／ SW {check?.sw ?? "—"}
              </div>
              <div className="font-mono text-ink-soft">
                純正: Cal {baseCal || "—"} ／ SW {baseSw || "—"}
              </div>
              {verdict === "match" && (
                <div className="font-semibold text-green-700">✓ Cal一致</div>
              )}
              {verdict === "mismatch" && (
                <div className="font-semibold text-red-700">
                  ⚠ Cal が一致しません。別の純正用ファイルの可能性があります。
                </div>
              )}
              {verdict === "unknown" && (
                <div className="text-ink-soft">
                  （純正の Cal/SW が未登録のため照合できません）
                </div>
              )}
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={checking}
              onClick={upload}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${
                verdict === "mismatch" ? "bg-red-600" : "bg-gold-500"
              }`}
            >
              {verdict === "mismatch" ? "不一致のままアップ" : "この mod をアップ"}
            </button>
            <button
              type="button"
              onClick={clearPick}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-surface-2"
            >
              選び直す
            </button>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0])}
      />
    </div>
  );
}
