"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/components/ui";
import { analyzeStockBin, createBaseFileFromBin } from "@/lib/actions/catalog";
import { MANUFACTURERS } from "@/lib/catalog/manufacturers";

type Analyzed = {
  ecu: string | null;
  sw: string | null;
  cal: string | null;
  hw: string | null;
  displacement: string | null;
  fuel: string | null;
};

// 純正(原本)bin をアップして車両(BaseFile)を追加。ファイル先 → 自動解析(ECU等) → メーカー/車種入力。
export function StockUploadForm({
  makerOptions,
  modelOptions,
}: {
  makerOptions: string[];
  modelOptions: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [drag, setDrag] = useState(false);
  const [analyzing, startAnalyze] = useTransition();
  const [submitting, startSubmit] = useTransition();
  const [analyzed, setAnalyzed] = useState<Analyzed | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [f, setF] = useState({
    manufacturer: "",
    model: "",
    generation: "",
    engineCode: "",
    displacement: "",
    ecu: "",
    mcu: "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  // メーカー候補: カノニカル + 既存DB値（重複排除）
  const makerList = Array.from(new Set([...MANUFACTURERS, ...makerOptions])).sort((a, b) =>
    a.localeCompare(b),
  );

  const inp = "rounded-lg border border-line bg-surface px-2 py-1.5 text-sm";
  const ready = !!fileName && f.manufacturer.trim() && f.model.trim();

  // ファイル選択時に自動解析（ECU/SW/Cal/排気量を先読み）
  const onPick = (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setMsg(null);
    setAnalyzed(null);
    const fd = new FormData();
    fd.set("file", file);
    startAnalyze(async () => {
      const r = await analyzeStockBin(fd);
      if (r.error) {
        setMsg(r.error);
        return;
      }
      setAnalyzed(r);
      // 抽出値を既定として流し込む（編集可）
      setF((s) => ({
        ...s,
        ecu: s.ecu || r.ecu || "",
        displacement: s.displacement || r.displacement || "",
      }));
    });
  };

  const submit = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setMsg("原本ファイルを選択してください");
      return;
    }
    const fd = new FormData();
    fd.set("file", file);
    fd.set("manufacturer", f.manufacturer.trim());
    fd.set("model", f.model.trim());
    if (f.generation.trim()) fd.set("generation", f.generation.trim());
    if (f.engineCode.trim()) fd.set("engineCode", f.engineCode.trim());
    if (f.displacement.trim()) fd.set("displacement", f.displacement.trim());
    if (f.ecu.trim()) fd.set("ecu", f.ecu.trim());
    if (f.mcu.trim()) fd.set("mcu", f.mcu.trim());
    if (analyzed?.fuel) fd.set("fuel", analyzed.fuel);
    startSubmit(async () => {
      const res = await createBaseFileFromBin(fd);
      if (res?.error) {
        setMsg(res.error);
      } else {
        setMsg(null);
        setF({ manufacturer: "", model: "", generation: "", engineCode: "", displacement: "", ecu: "", mcu: "" });
        setFileName("");
        setAnalyzed(null);
        if (fileRef.current) fileRef.current.value = "";
        setOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <div>
      <Button type="button" onClick={() => setOpen((o) => !o)}>
        {open ? "とじる" : "＋ 純正bin をアップして車両を追加"}
      </Button>

      {open && (
        <Card className="mt-2 space-y-3">
          {/* 1) ファイル（ドロップ可・クリック可） */}
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
                // ドロップしたファイルを input にも反映
                if (fileRef.current) fileRef.current.files = e.dataTransfer.files;
                onPick(file);
              }
            }}
            className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-center ${
              drag ? "border-gold-400 bg-gold-50" : "border-line bg-surface"
            }`}
          >
            <p className="text-sm font-semibold text-ink">
              純正(原本)bin をここにドロップ、または
            </p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-lg bg-gold-500 px-3 py-1.5 text-sm font-semibold text-white"
            >
              ファイルを選択
            </button>
            <span className="text-xs text-ink-soft">{fileName || "未選択"}</span>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => onPick(e.target.files?.[0])}
            />
          </div>

          {/* 2) 自動解析の結果（先読み） */}
          {analyzing && <p className="text-xs text-ink-soft">解析中… ECU識別子を読み取っています</p>}
          {analyzed && (
            <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-soft">
              <span className="font-semibold text-ink">自動検出:</span>{" "}
              ECU <b className="font-mono text-ink">{analyzed.ecu || "—"}</b> ／ SW{" "}
              <b className="font-mono text-ink">{analyzed.sw || "—"}</b> ／ Cal{" "}
              <b className="font-mono text-ink">{analyzed.cal || "—"}</b>
              {analyzed.fuel ? <> ／ 燃料 {analyzed.fuel}</> : null}
              <div className="mt-0.5">
                メーカー・車種はファイルから判別できないため入力してください。
              </div>
            </div>
          )}

          {/* 3) メーカー/車種（必須）＋任意項目 */}
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-soft">メーカー *</span>
              <input
                className={`${inp} w-full`}
                list="maker-options"
                placeholder="例: Audi"
                value={f.manufacturer}
                onChange={set("manufacturer")}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-soft">車種 *</span>
              <input
                className={`${inp} w-full`}
                list="model-options"
                placeholder="例: RS3"
                value={f.model}
                onChange={set("model")}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-soft">世代（任意）</span>
              <input className={`${inp} w-full`} placeholder="例: 8V" value={f.generation} onChange={set("generation")} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-soft">エンジン型式（任意）</span>
              <input className={`${inp} w-full`} placeholder="例: CZGB" value={f.engineCode} onChange={set("engineCode")} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-soft">排気量（任意）</span>
              <input className={`${inp} w-full`} placeholder="例: 2.5L" value={f.displacement} onChange={set("displacement")} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-soft">ECU（自動・上書き可）</span>
              <input className={`${inp} w-full font-mono`} placeholder="自動検出" value={f.ecu} onChange={set("ecu")} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-soft">MCU（任意）</span>
              <input className={`${inp} w-full font-mono`} placeholder="例: TC1797" value={f.mcu} onChange={set("mcu")} />
            </label>
          </div>

          <datalist id="maker-options">
            {makerList.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <datalist id="model-options">
            {modelOptions.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>

          {msg && <p className="text-xs text-red-600">{msg}</p>}

          <Button type="button" disabled={!ready || analyzing || submitting} onClick={submit}>
            {submitting ? "登録中…" : "この純正データを登録"}
          </Button>
        </Card>
      )}
    </div>
  );
}
