"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/components/ui";
import {
  analyzeStockBin,
  createBaseFileFromBin,
  createVariantWithFile,
} from "@/lib/actions/catalog";
import { MANUFACTURERS } from "@/lib/catalog/manufacturers";
import { fuelKindOf, type FuelKind } from "@/lib/catalog/options";
import { ModUploadForm } from "./mod-upload-form";

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
  // 純正登録完了後の mod アップ画面用
  const [created, setCreated] = useState<{
    id: string;
    manufacturer: string;
    model: string;
    fuelKind: FuelKind;
    cal: string;
    sw: string;
  } | null>(null);
  const [addedMods, setAddedMods] = useState<string[]>([]);

  const [f, setF] = useState({
    manufacturer: "",
    model: "",
    generation: "",
    grade: "",
    engineCode: "",
    displacement: "",
    ecu: "",
    mcu: "",
    cal: "",
    sw: "",
    hw: "",
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
      // 抽出値を既定として流し込む（編集可・自動認識しない項目は手入力できる）
      setF((s) => ({
        ...s,
        ecu: s.ecu || r.ecu || "",
        displacement: s.displacement || r.displacement || "",
        cal: s.cal || r.cal || "",
        sw: s.sw || r.sw || "",
        hw: s.hw || r.hw || "",
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
    if (f.grade.trim()) fd.set("grade", f.grade.trim());
    if (f.engineCode.trim()) fd.set("engineCode", f.engineCode.trim());
    if (f.displacement.trim()) fd.set("displacement", f.displacement.trim());
    if (f.ecu.trim()) fd.set("ecu", f.ecu.trim());
    if (f.mcu.trim()) fd.set("mcu", f.mcu.trim());
    if (f.cal.trim()) fd.set("calNumber", f.cal.trim());
    if (f.sw.trim()) fd.set("swNumber", f.sw.trim());
    if (f.hw.trim()) fd.set("hwNumber", f.hw.trim());
    if (analyzed?.fuel) fd.set("fuel", analyzed.fuel);
    const ctx = {
      manufacturer: f.manufacturer.trim(),
      model: f.model.trim(),
      fuelKind: fuelKindOf(analyzed?.fuel ?? null),
      cal: f.cal.trim() || analyzed?.cal || "",
      sw: f.sw.trim() || analyzed?.sw || "",
    };
    startSubmit(async () => {
      const res = await createBaseFileFromBin(fd);
      if (res?.error) {
        setMsg(res.error);
      } else {
        setMsg(null);
        // 純正登録完了 → そのまま mod アップ画面へ
        const id = (res?.data as { id?: string } | undefined)?.id ?? "";
        setCreated({ id, ...ctx });
        setAddedMods([]);
        setFileName("");
        setAnalyzed(null);
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      }
    });
  };

  // mod を1件アップ（純正登録後の画面から）
  const addMod = (modFd: FormData) => {
    if (!created) return;
    setMsg(null);
    startSubmit(async () => {
      const r = await createVariantWithFile(created.id, modFd);
      if (r?.error) {
        setMsg(r.error);
        return;
      }
      const file = modFd.get("file");
      const stage = String(modFd.get("stage") ?? "").trim() || "チューニングなし";
      const pops =
        modFd.get("popsAndBangs") === "true"
          ? modFd.get("popsSport") === "true"
            ? "・バブリング(スポーツ)"
            : "・バブリング(全モード)"
          : "";
      setAddedMods((m) => [
        ...m,
        `${stage}${pops}（${file instanceof File ? file.name : "file"}）`,
      ]);
      router.refresh();
    });
  };

  // 純正＋mod の登録を終えて閉じる
  const finish = () => {
    setCreated(null);
    setAddedMods([]);
    setF({ manufacturer: "", model: "", generation: "", grade: "", engineCode: "", displacement: "", ecu: "", mcu: "", cal: "", sw: "", hw: "" });
    setMsg(null);
    setOpen(false);
    router.refresh();
  };

  return (
    <div>
      <Button type="button" onClick={() => (open ? finish() : setOpen(true))}>
        {open ? "とじる" : "＋ 純正bin をアップして車両を追加"}
      </Button>

      {open && !created && (
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
              <input className={`${inp} w-full`} placeholder="例: 8V / W222" value={f.generation} onChange={set("generation")} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-soft">グレード（任意）</span>
              <input className={`${inp} w-full`} placeholder="例: S550 / RS3" value={f.grade} onChange={set("grade")} />
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
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-soft">Cal（自動・手入力可）</span>
              <input className={`${inp} w-full font-mono`} placeholder="自動検出／手入力" value={f.cal} onChange={set("cal")} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-soft">SW（自動・手入力可）</span>
              <input className={`${inp} w-full font-mono`} placeholder="自動検出／手入力" value={f.sw} onChange={set("sw")} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-soft">HW（自動・手入力可）</span>
              <input className={`${inp} w-full font-mono`} placeholder="自動検出／手入力" value={f.hw} onChange={set("hw")} />
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

      {/* 純正登録完了 → そのまま mod(ステージ/バブリング等)をアップ */}
      {open && created && (
        <Card className="mt-2 space-y-3">
          <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
            ✅ 純正を登録しました：<b>{created.manufacturer} {created.model}</b>
            <div className="mt-0.5 text-xs text-green-700">
              続けて mod（チューニング済みファイル）をアップしてください。ステージ・バブリングを選んで何件でも追加できます。
            </div>
          </div>

          <ModUploadForm
            manufacturer={created.manufacturer}
            fuelKind={created.fuelKind}
            baseCal={created.cal}
            baseSw={created.sw}
            onAddFile={addMod}
          />

          {addedMods.length > 0 && (
            <div className="rounded-lg border border-line">
              <div className="border-b border-line px-3 py-1.5 text-xs font-semibold text-ink-soft">
                追加した mod（{addedMods.length}）— 下書きで登録。配布可にするにはカタログで切替。
              </div>
              <ul className="divide-y divide-line">
                {addedMods.map((m, i) => (
                  <li key={i} className="px-3 py-1.5 text-xs text-ink">
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {msg && <p className="text-xs text-red-600">{msg}</p>}

          <div className="flex items-center gap-2">
            {submitting && <span className="text-xs text-ink-soft">アップ中…</span>}
            <Button type="button" onClick={finish}>
              完了
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
