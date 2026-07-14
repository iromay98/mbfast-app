"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/components/ui";
import {
  analyzeStockBin,
  analyzeStockBinAi,
  createBaseFileFromBin,
  createVariantWithFile,
  deleteVariant,
  replaceVariantFile,
  listStockVariants,
  registerHqCustomerForBase,
} from "@/lib/actions/catalog";
import { MANUFACTURERS, isMercedes } from "@/lib/catalog/manufacturers";
import {
  fuelKindOf,
  optionTagsFor,
  popsAllowed,
  type FuelKind,
} from "@/lib/catalog/options";
import { ModUploadForm } from "./mod-upload-form";
import { RegisteredVariants, type StockVariantRow } from "./registered-variants";
import { ChoiceSelect, TOOL_OPTIONS, METHOD_OPTIONS } from "./catalog-grid";

type Analyzed = {
  ecu: string | null;
  sw: string | null;
  cal: string | null;
  hw: string | null;
  displacement: string | null;
  fuel: string | null;
  existing?: {
    id: string;
    manufacturer: string;
    model: string;
    fuel: string | null;
    cal: string | null;
    sw: string | null;
    variants: StockVariantRow[];
    canSlave: boolean;
  } | null;
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
  const [aiPending, startAi] = useTransition();
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
  const [analyzed, setAnalyzed] = useState<Analyzed | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 純正登録完了後の mod アップ画面用
  const [created, setCreated] = useState<{
    id: string;
    recordId?: string;
    existing?: boolean; // 既にストック済みの純正へ mod 追加するモード
    variants?: StockVariantRow[]; // 登録済みバリエーション
    canSlave?: boolean; // .slave 化できるか（取込元の車固有IDあり）
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
    unit: "ECU",
    tool: "AT",
    method: "",
    driver: "",
    driverBorrowed: false,
    customerName: "",
    workedAt: "",
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
      // 既にストック済みの純正なら、いつものバリエーション登録画面へ自動切替
      //（メーカー・車種の再入力や二重登録は不要）
      if (r.existing) {
        setCreated({
          id: r.existing.id,
          existing: true,
          variants: r.existing.variants,
          canSlave: r.existing.canSlave,
          manufacturer: r.existing.manufacturer,
          model: r.existing.model,
          fuelKind: fuelKindOf(r.existing.fuel),
          cal: r.existing.cal ?? "",
          sw: r.existing.sw ?? "",
        });
        setAddedMods([]);
        return;
      }
      // 抽出値を既定として流し込む（編集可）。
      // ベンツは Cal/SW/HW の自動認識が誤検出するため流し込まない（手入力のみ）。
      setF((s) => {
        const benz = isMercedes(s.manufacturer);
        return {
          ...s,
          ecu: s.ecu || r.ecu || "",
          displacement: s.displacement || r.displacement || "",
          cal: benz ? s.cal : s.cal || r.cal || "",
          sw: benz ? s.sw : s.sw || r.sw || "",
          hw: benz ? s.hw : s.hw || r.hw || "",
        };
      });
    });
  };

  // Opusで メーカー・車種・世代・グレード・HW/SW/Cal をまとめて推定→フォームに自動入力
  const aiAnalyze = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setAiMsg("先にファイルを選択してください");
      return;
    }
    setAiMsg(null);
    const fd = new FormData();
    fd.set("file", file);
    startAi(async () => {
      const r = await analyzeStockBinAi(fd);
      if (r.error) {
        setAiMsg(r.error);
        return;
      }
      setAnalyzed({
        ecu: r.ecu ?? null,
        sw: r.sw ?? null,
        cal: r.cal ?? null,
        hw: r.hw ?? null,
        displacement: r.displacement ?? null,
        fuel: r.fuel ?? null,
      });
      // AIの推定値で空欄を埋める（既存の入力は尊重）
      setF((s) => ({
        ...s,
        manufacturer: s.manufacturer || r.manufacturer || "",
        model: s.model || r.model || "",
        generation: s.generation || r.generation || "",
        grade: s.grade || r.grade || "",
        ecu: s.ecu || r.ecu || "",
        displacement: s.displacement || r.displacement || "",
        cal: s.cal || r.cal || "",
        sw: s.sw || r.sw || "",
        hw: s.hw || r.hw || "",
      }));
      const conf = r.confidence != null ? `（確信度${Math.round(r.confidence * 100)}%）` : "";
      setAiMsg(`AIが認識しました${conf}。内容を確認・修正してください。`);
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
    fd.set("unit", f.unit === "TCU" ? "TCU" : "ECU");
    fd.set("tool", f.tool || "AT");
    if (f.method.trim()) fd.set("method", f.method.trim());
    if (f.driver.trim()) fd.set("driver", f.driver.trim());
    if (f.driverBorrowed) fd.set("driverBorrowed", "true");
    if (f.customerName.trim()) fd.set("customerName", f.customerName.trim());
    if (f.workedAt.trim()) fd.set("workedAt", f.workedAt.trim());
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
        const data = res?.data as
          | {
              id?: string;
              recordId?: string;
              existing?: boolean;
              manufacturer?: string;
              model?: string;
              fuel?: string | null;
              cal?: string | null;
              sw?: string | null;
              variants?: StockVariantRow[];
              canSlave?: boolean;
            }
          | undefined;
        const id = data?.id ?? "";
        setCreated(
          data?.existing
            ? {
                id,
                recordId: data.recordId,
                existing: true,
                variants: data.variants,
                canSlave: data.canSlave,
                manufacturer: data.manufacturer ?? ctx.manufacturer,
                model: data.model ?? ctx.model,
                fuelKind: fuelKindOf(data.fuel ?? null),
                cal: data.cal ?? "",
                sw: data.sw ?? "",
              }
            : { id, recordId: data?.recordId, ...ctx },
        );
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
      await refreshVariants();
      router.refresh();
    });
  };

  // 登録済みバリエーションを最新化（追加/差し替え/削除の後）
  const refreshVariants = async () => {
    if (!created) return;
    const { variants } = await listStockVariants(created.id);
    setCreated((c) => (c ? { ...c, variants } : c));
  };

  // 1件を差し替え（新しいbinをアップ→版を重ねる）
  const replaceVariant = (variantId: string, file: File) => {
    setMsg(null);
    startSubmit(async () => {
      const fd = new FormData();
      fd.set("file", file);
      const r = await replaceVariantFile(variantId, fd);
      if (r?.error) {
        setMsg(r.error);
        return;
      }
      await refreshVariants();
      router.refresh();
    });
  };

  // 1件を削除（アーカイブ・後で復元可）
  const removeVariant = (variantId: string) => {
    setMsg(null);
    startSubmit(async () => {
      const r = await deleteVariant(variantId);
      if (r?.error) {
        setMsg(r.error);
        return;
      }
      await refreshVariants();
      router.refresh();
    });
  };

  // 純正＋mod の登録を終えて閉じる
  const finish = () => {
    setCreated(null);
    setAddedMods([]);
    setF({ manufacturer: "", model: "", generation: "", grade: "", unit: "ECU", tool: "AT", method: "", driver: "", driverBorrowed: false, customerName: "", workedAt: "", engineCode: "", displacement: "", ecu: "", mcu: "", cal: "", sw: "", hw: "" });
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

          {/* 2) 自動解析の結果（先読み）＋ AIで自動認識 */}
          {analyzing && <p className="text-xs text-ink-soft">解析中… ECU識別子を読み取っています</p>}
          {fileName && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={aiAnalyze}
                disabled={aiPending}
                title="Opusでメーカー・車種・世代・グレード・HW/SW/Cal を推定してフォームに入力します"
                className="inline-flex items-center gap-1 rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-50"
              >
                {aiPending ? "AI認識中…" : "🤖 AIで自動認識（メーカー・車種・Cal等）"}
              </button>
              {aiMsg && <span className="text-xs font-semibold text-sky-700">{aiMsg}</span>}
            </div>
          )}
          {analyzed && (
            <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-soft">
              <span className="font-semibold text-ink">検出:</span>{" "}
              ECU <b className="font-mono text-ink">{analyzed.ecu || "—"}</b> ／ SW{" "}
              <b className="font-mono text-ink">{analyzed.sw || "—"}</b> ／ Cal{" "}
              <b className="font-mono text-ink">{analyzed.cal || "—"}</b>
              {analyzed.fuel ? <> ／ 燃料 {analyzed.fuel}</> : null}
              <div className="mt-0.5">
                自動入力後は内容を確認・修正してください（AIの推定を含みます）。
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
                onChange={(e) => {
                  const v = e.target.value;
                  // ベンツは自動Cal認識が誤検出するため、選択時に自動値をクリア（手入力のみ）
                  setF((s) =>
                    isMercedes(v)
                      ? { ...s, manufacturer: v, cal: "", sw: "", hw: "" }
                      : { ...s, manufacturer: v },
                  );
                }}
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

          {/* 対象ユニット（ECU/TCU）＋ 本店施工の顧客別管理（任意） */}
          <div className="rounded-lg border border-line bg-surface-2 p-3 space-y-2">
            <div className="flex items-center gap-3 text-xs text-ink-soft">
              <span className="font-semibold">対象ユニット</span>
              {(["ECU", "TCU"] as const).map((u) => (
                <label key={u} className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={f.unit === u}
                    onChange={() => setF((s) => ({ ...s, unit: u }))}
                    className={`h-4 w-4 ${u === "TCU" ? "accent-sky-500" : "accent-gold-500"}`}
                  />
                  {u === "ECU" ? "ECU（エンジン）" : "TCU（ミッション）"}
                </label>
              ))}
              <span className="text-[11px] text-ink-soft">※ 表示・ファイル名に入ります（取り違え防止）</span>
            </div>
            {/* 読み取りツール・方式・Driver（ファイル名/本店管理に使用） */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-ink-soft">
              <span className="font-semibold" title="読み取りツール。ファイル名のトークンに入ります（例 PG3_OBD_ori.bin）">ツール</span>
              <ChoiceSelect
                value={f.tool}
                options={TOOL_OPTIONS}
                onSave={(v) => setF((s) => ({ ...s, tool: v }))}
                addPrompt="ツール名（ファイル名に入る短い表記。例: KTAG）"
              />
              <span className="font-semibold">Method</span>
              <ChoiceSelect
                value={f.method}
                options={METHOD_OPTIONS}
                onSave={(v) => setF((s) => ({ ...s, method: v }))}
                addPrompt="読み方式（例: BDM）"
              />
              <span className="font-semibold" title="ECM Titanium 等の使用Driver（本店のみ）">Driver</span>
              <input
                className={`${inp} w-40 font-mono text-xs`}
                placeholder="Driver名（任意）"
                value={f.driver}
                onChange={set("driver")}
              />
              <label className="inline-flex items-center gap-1" title="他のDriverを流用（名前を()で表示）">
                <input
                  type="checkbox"
                  checked={f.driverBorrowed}
                  onChange={(e) => setF((s) => ({ ...s, driverBorrowed: e.target.checked }))}
                  className="h-3.5 w-3.5 accent-gold-500"
                />
                流用
              </label>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-ink-soft">顧客名（任意・入力すると本店名義の施工案件を作成）</span>
                <input className={`${inp} w-full`} placeholder="例: 柳田 太郎" value={f.customerName} onChange={set("customerName")} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-ink-soft">施工日（任意・未入力は当日）</span>
                <input type="date" className={`${inp} w-full`} value={f.workedAt} onChange={set("workedAt")} />
              </label>
            </div>
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
            {created.existing ? (
              <>✅ この純正は<b>既にストック済み</b>です：<b>{created.manufacturer} {created.model}</b></>
            ) : (
              <>✅ 純正を登録しました：<b>{created.manufacturer} {created.model}</b></>
            )}
            <div className="mt-0.5 text-xs text-green-700">
              {created.existing
                ? "そのままバリエーション（mod）を追加できます。ステージ・バブリングを選んでアップしてください。"
                : "続けて mod（チューニング済みファイル）をアップしてください。ステージ・バブリングを選んで何件でも追加できます。"}
            </div>
            {created.recordId && (
              <a
                href={`/hq/records/${created.recordId}`}
                className="mt-1 inline-block text-xs font-semibold text-green-800 underline"
              >
                → 本店名義の施工案件を作成しました（開く）
              </a>
            )}
          </div>

          {/* 重複（既存ストック）でも顧客登録できる。従来はここで登録できず取りこぼしていた。 */}
          {created.existing && !created.recordId && (
            <HqCustomerRegister
              baseFileId={created.id}
              onRegistered={(recordId) =>
                setCreated((c) => (c ? { ...c, recordId } : c))
              }
            />
          )}

          {/* 登録済みバリエーション（テーブル：オプション列＋状態＋差し替え/削除＋DL） */}
          <RegisteredVariants
            variants={created.variants ?? []}
            optionCols={optionTagsFor(created.fuelKind, created.manufacturer)}
            showPops={popsAllowed(created.fuelKind)}
            busy={submitting}
            canSlave={created.canSlave ?? false}
            onReplace={replaceVariant}
            onDelete={removeVariant}
          />

          <ModUploadForm
            manufacturer={created.manufacturer}
            fuelKind={created.fuelKind}
            baseCal={created.cal}
            baseSw={created.sw}
            registered={created.variants ?? []}
            onAddFile={addMod}
          />

          {addedMods.length > 0 && (
            <div className="rounded-lg border border-line">
              <div className="border-b border-line px-3 py-1.5 text-xs font-semibold text-ink-soft">
                追加した mod（{addedMods.length}）— 即・配布可で登録済み（照合した代理店がその場でDLできます）。
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

// 既存ストック（重複アップ）でも顧客名・施工日を登録できるボックス。
// 登録すると本店名義の施工案件が作成され、リンクが出る。
function HqCustomerRegister({
  baseFileId,
  onRegistered,
}: {
  baseFileId: string;
  onRegistered: (recordId: string) => void;
}) {
  const [customerName, setCustomerName] = useState("");
  const [workedAt, setWorkedAt] = useState("");
  const [unit, setUnit] = useState<"ECU" | "TCU">("ECU");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const fd = new FormData();
      fd.set("customerName", customerName.trim());
      if (workedAt.trim()) fd.set("workedAt", workedAt.trim());
      fd.set("unit", unit);
      const r = await registerHqCustomerForBase(baseFileId, fd);
      if (r.error) setError(r.error);
      else if (r.recordId) onRegistered(r.recordId);
    });

  const inp = "rounded-lg border border-line bg-surface px-2 py-1.5 text-sm";
  return (
    <div className="rounded-lg border border-gold-200 bg-gold-50 p-3">
      <p className="text-xs font-semibold text-ink">
        この施工の顧客を登録（本店名義の施工案件を作成）
      </p>
      <p className="mt-0.5 text-[11px] text-ink-soft">
        重複ファイルでも顧客登録できます。登録すると本店の施工記録として履歴に残ります。
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="顧客名 *"
          className={`${inp} w-40`}
        />
        <input
          type="date"
          value={workedAt}
          onChange={(e) => setWorkedAt(e.target.value)}
          title="施工日（未入力は今日）"
          className={inp}
        />
        <div className="flex items-center gap-2 text-xs text-ink-soft">
          <label className="inline-flex items-center gap-1">
            <input
              type="radio"
              checked={unit === "ECU"}
              onChange={() => setUnit("ECU")}
              className="h-3.5 w-3.5 accent-gold-500"
            />
            ECU
          </label>
          <label className="inline-flex items-center gap-1">
            <input
              type="radio"
              checked={unit === "TCU"}
              onChange={() => setUnit("TCU")}
              className="h-3.5 w-3.5 accent-sky-500"
            />
            TCU
          </label>
        </div>
        <button
          type="button"
          disabled={pending || !customerName.trim()}
          onClick={submit}
          className="rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "登録中…" : "顧客を登録"}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
