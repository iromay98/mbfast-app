"use client";

import { useRef, useState } from "react";

// 本店: チューニング後bin を、この記録の車固有ID で encrypt して焼ける .slave を取得。
// 代理店名(顧客名+日付)・車種・Cal はサーバ側で記録から自動付与（＝名前入力済み）。
export function HqEncryptForm({
  recordId,
  canEncrypt,
  showPops,
  optionTags,
  namePreview,
}: {
  recordId: string;
  canEncrypt: boolean;
  showPops: boolean;
  optionTags: string[];
  namePreview: string; // 例: 代理店名(顧客名+2026-06-10)
}) {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [drag, setDrag] = useState(false);
  const [stage, setStage] = useState("");
  const [popsMode, setPopsMode] = useState<"none" | "all" | "sport">("none");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setDone(null);
  };
  const toggle = (t: string) =>
    setSelected((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  const submit = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("チューニング後のbinを選択してください");
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("stage", stage.trim());
      fd.set("pops", popsMode);
      fd.set("optionTags", JSON.stringify(selected));
      const res = await fetch(`/api/records/${recordId}/encrypt`, { method: "POST", body: fd });
      if (!res.ok) {
        setError((await res.text()) || `エラー (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      // filename*（UTF-8厳密）を優先し、無ければ素の filename= にフォールバック
      const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
      const plain = cd.match(/filename="?([^"";]+)"?/i);
      const name = star
        ? decodeURIComponent(star[1])
        : plain
          ? plain[1]
          : "tuned.slave";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDone(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const inp = "rounded-lg border border-line bg-surface px-2 py-1.5 text-sm";

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft hover:bg-surface-2"
      >
        {open ? "とじる" : "＋ 本部で encrypt（チューニング後bin → .slave）"}
      </button>

      {open && (
        <div className="mt-2 space-y-3">
          {!canEncrypt && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              この記録には暗号化に必要な情報（復号時のID）が無いため encrypt できません。
              AutoTunerで復号済みのスレーブから登録された記録でのみ利用できます。
            </p>
          )}

          {/* 宛名は記録から自動（＝代理店同様に名前入力済み） */}
          <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-soft">
            <span className="font-semibold text-ink">ファイル名の宛名（自動）:</span>{" "}
            <span className="font-mono text-ink">{namePreview || "（代理店・顧客名 未設定）"}</span>
            <div className="mt-0.5">車種・Cal も記録から自動で付きます。</div>
          </div>

          {/* チューニング後bin（ドロップ可・クリック可） */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const file = e.dataTransfer.files?.[0];
              if (file) {
                if (fileRef.current) fileRef.current.files = e.dataTransfer.files;
                pick(file);
              }
            }}
            className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-5 text-center ${
              drag ? "border-gold-400 bg-gold-50" : "border-line bg-surface"
            } ${canEncrypt ? "" : "pointer-events-none opacity-50"}`}
          >
            <p className="text-sm font-semibold text-ink">チューニング後bin をドロップ、または</p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-lg bg-gold-500 px-3 py-1.5 text-sm font-semibold text-white"
            >
              ファイルを選択
            </button>
            <span className="text-xs text-ink-soft">{fileName || "未選択"}</span>
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          </div>

          {/* 内容（ファイル名に反映） */}
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-soft">ステージ</span>
              <input className={`${inp} w-40`} placeholder="例: Stage1" value={stage} onChange={(e) => setStage(e.target.value)} />
            </label>
            {showPops && (
              <div>
                <div className="mb-1 text-xs font-semibold text-ink-soft">バブリング</div>
                <div className="flex gap-1.5">
                  {([
                    ["none", "なし"],
                    ["all", "全モード"],
                    ["sport", "スポーツ"],
                  ] as const).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setPopsMode(v)}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                        popsMode === v
                          ? "border-gold-400 bg-gold-500 text-white"
                          : "border-line bg-white text-ink-soft hover:bg-surface-2"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {optionTags.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold text-ink-soft">オプション</div>
              <div className="flex flex-wrap gap-3">
                {optionTags.map((t) => (
                  <label key={t} className="inline-flex items-center gap-1.5 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={selected.includes(t)}
                      onChange={() => toggle(t)}
                      className="h-4 w-4 accent-gold-500"
                    />
                    {t}
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
          {done && (
            <p className="text-sm font-semibold text-green-700">
              ✅ encrypt 完了：{done} をダウンロードしました。
            </p>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={!canEncrypt || busy || !fileName}
            className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "encrypt中…" : "encrypt して .slave を取得"}
          </button>
        </div>
      )}
    </div>
  );
}
