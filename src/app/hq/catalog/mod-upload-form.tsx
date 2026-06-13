"use client";

import { useRef, useState } from "react";
import { type FuelKind, optionTagsFor, popsAllowed, baselineStages } from "@/lib/catalog/options";

// mod(チューニング済み)ファイルのアップロード用フォーム。
// ステージ＝プルダウン（ベンツのみ Stage1.5）、バブリング＝なし/全モード/スポーツ。
// 未整備ストック・純正アップ後の両方で使う共通UI。
export function ModUploadForm({
  manufacturer,
  fuelKind,
  onAddFile,
}: {
  manufacturer: string;
  fuelKind: FuelKind;
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

  const toggleTag = (t: string) =>
    setTags((c) => (c.includes(t) ? c.filter((x) => x !== t) : [...c, t]));

  const submit = (file: File) => {
    const pops = showPops && popsMode !== "none";
    const fd = new FormData();
    fd.set("file", file);
    fd.set("stage", stage.trim());
    fd.set("popsAndBangs", pops ? "true" : "false");
    fd.set("popsSport", showPops && popsMode === "sport" ? "true" : "false");
    fd.set("optionTags", JSON.stringify(tags.filter((t) => availableTags.includes(t))));
    if (options.trim()) fd.set("options", options.trim());
    onAddFile(fd);
    setPopsMode("none");
    setOptions("");
    setTags([]);
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
