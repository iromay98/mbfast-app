"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, EmptyState } from "@/components/ui";
import { saveVehicleWithCustomer, unlinkVehicle } from "@/lib/actions/pit-vehicles";
import type { VehicleFormInput } from "@/lib/actions/pit-vehicles";
import { VehicleEditPanel } from "./vehicle-edit-panel";
import { ShakenQrScanner } from "@/components/shaken-qr-scanner";
import { parseShakenQr, qrExpiryToInput } from "@/server/pit/shaken-qr";

export type VehicleRow = {
  vehicleId: string;
  customerId: string;
  customerName: string;
  vehicleName: string;
  maker: string;
  modelCode: string;
  chassisLast3: string;
  firstRegistered: string;
  inspectionExpiry: string; // "" | YYYY-MM-DD
  hasVin: boolean;
  hasRegNumber: boolean;
};

export type CustomerOption = { id: string; name: string; tel: string };

const input = "mt-0.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink";
const label = "block text-[11px] font-semibold text-ink-soft";

const EMPTY: VehicleFormInput = {
  vin: "",
  registrationNumber: "",
  vehicleName: "",
  maker: "",
  modelCode: "",
  firstRegistered: "",
  inspectionExpiry: "",
  customerId: "",
  customerName: "",
  customerKana: "",
  customerTel: "",
  customerAddress: "",
  customerEmail: "",
};

function daysLeft(ymd: string): number | null {
  if (!ymd) return null;
  return Math.ceil((new Date(`${ymd}T00:00:00+09:00`).getTime() - Date.now()) / 86_400_000);
}

/*
 * 車検証の読み取り → 確認・修正 → 登録。
 * 読み取り結果は必ず店舗が確認してから保存する（誤った車台番号は証明書を無価値にする）。
 * 車検証の画像はサーバーに保存されない（読み取り後に破棄）。その旨を画面にも明示する。
 */
export function VehiclesClient({
  vehicles,
  customers,
  ocrEnabled,
  setupError,
  legalRecordMode,
  /** 本部が代行入力するときの対象店舗（加盟店では undefined＝自店に固定される） */
  storeId,
  /** 画面の基点。加盟店 "/dealer/pit" / 本部 "/hq/pit" */
  basePath = "/dealer/pit",
  /** 顧客カルテから「車両を追加」で来たときの対象顧客（最初から選ばれた状態にする） */
  initialCustomerId,
}: {
  vehicles: VehicleRow[];
  customers: CustomerOption[];
  ocrEnabled: boolean;
  setupError: string | null;
  legalRecordMode: boolean;
  storeId?: string;
  basePath?: string;
  initialCustomerId?: string;
}) {
  const router = useRouter();
  /*
   * 入口を用途ごとに分ける。iPhoneでは accept に image/* を混ぜると
   * ファイル選択が写真ライブラリ寄りになりPDFを選びにくいため、**PDF専用の入口**を用意する。
   */
  const pdfRef = useRef<HTMLInputElement>(null); // PDFのみ（iPhoneでは「ファイル」が開く）
  const cameraRef = useRef<HTMLInputElement>(null); // 撮影（capture付き）
  const photoRef = useRef<HTMLInputElement>(null); // アルバムから写真
  // 顧客カルテから来たときは、その顧客を選んだ状態で始める（カルテ→車両追加を往復させない）
  const blank = (): VehicleFormInput => ({ ...EMPTY, customerId: initialCustomerId ?? "" });
  const [form, setForm] = useState<VehicleFormInput | null>(null);
  const [reading, setReading] = useState(false);
  const [scanning, setScanning] = useState(false);
  // QRで読み取った車台番号は確定扱い（写真OCRの値で上書きしない＝誤読で壊さない）
  const [qrVin, setQrVin] = useState<string | null>(null);
  // 複数QRから集めた値（1枚のQRに全部入っているとは限らない）
  type Scanned = { chassis: string | null; modelCode: string | null; expiry: string | null };
  const [scanned, setScanned] = useState<Scanned>({ chassis: null, modelCode: null, expiry: null });
  const scannedRef = useRef<Scanned>({ chassis: null, modelCode: null, expiry: null });

  /** 集めた値をフォームへ入れる（閉じたタイミング・揃ったタイミングの両方から呼ぶ） */
  const applyScanned = (v?: Scanned) => {
    const s = v ?? scannedRef.current;
    if (!s.chassis) return; // 車台番号が無ければ何もしない（手入力・写真へ）
    setQrVin(s.chassis);
    setForm((prev) => ({
      ...blank(),
      ...(prev ?? {}),
      vin: s.chassis!,
      modelCode: s.modelCode ?? prev?.modelCode ?? "",
      inspectionExpiry: s.expiry ?? prev?.inspectionExpiry ?? "",
    }));
    setError(null);
    setNotes([
      `QRから読み取りました（車台番号 ${s.chassis}${s.modelCode ? ` / 型式 ${s.modelCode}` : ""}）`,
      ...(s.modelCode ? [] : ["型式はQRから取れませんでした。写真の読み取りか手入力で入れてください"]),
      "氏名・住所はQRに入っていません。続けて「車検証を撮る」を押すと埋まります",
    ]);
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);
  // 修正パネル（入力ミスを直すための上書き編集）。UIは顧客カルテと共通。
  const [editVehicleId, setEditVehicleId] = useState<string | null>(null);

  const set = (patch: Partial<VehicleFormInput>) => setForm((f) => ({ ...(f ?? blank()), ...patch }));

  const read = async (file: File) => {
    setReading(true);
    setError(null);
    setNotes([]);
    setDone(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/pit/shaken-ocr", { method: "POST", body: fd });
      const body = (await res.json()) as {
        error?: string;
        fields?: Record<string, string>;
        warnings?: string[];
        /** text=PDFの文字を直接読んだ（誤読なし）／ai=画像PDF／photo=写真 */
        source?: "text" | "ai" | "photo";
      };
      if (!res.ok || !body.fields) {
        setError(body.error ?? "読み取れませんでした。手入力で進めてください");
        setForm((f) => f ?? blank()); // 失敗しても手入力を続けられるようにフォームは開く
        return;
      }
      const f = body.fields;
      /*
       * PDFの文字を直接読めた場合（source="text"）は、値が確定しているうえに
       * 車検証そのものの記載なのでQRより優先する。
       * 逆に写真OCR（誤読があり得る）ではQRの値を守る。
       */
      const pdfExact = body.source === "text";
      const vinMismatch = pdfExact && !!qrVin && !!f.vin && qrVin !== f.vin;
      setForm((prev) => ({
        ...blank(),
        ...(prev ?? {}),
        vin: pdfExact ? (f.vin ?? qrVin ?? "") : (qrVin ?? f.vin ?? ""),
        modelCode: pdfExact
          ? (f.modelCode ?? "")
          : qrVin && prev?.modelCode
            ? prev.modelCode
            : (f.modelCode ?? ""),
        registrationNumber: f.registrationNumber ?? "",
        maker: f.makerName ?? "",
        firstRegistered: f.firstRegistered ?? "",
        inspectionExpiry:
          (f.inspectionExpiry ?? "").length === 10 ? f.inspectionExpiry : (prev?.inspectionExpiry ?? ""),
        customerName: f.userName ?? "",
        customerAddress: f.userAddress ?? "",
      }));
      setNotes([
        // 経路を明示する（PDF直読みは誤読が起きないので、その旨を伝えて安心して確認できるようにする）
        ...(body.source === "text"
          ? ["✅ PDFの文字をそのまま読み取りました（画像認識ではないので誤読はありません）"]
          : body.source === "ai"
            ? ["このPDFは画像だったため画像認識で読み取りました。値をよく確認してください"]
            : []),
        ...(vinMismatch
          ? [
              `⚠ QRで読んだ車台番号（${qrVin}）とPDFの車台番号（${f.vin}）が違います。` +
                "別の車両のPDFを選んでいないか確認してください（PDFの値を入れています）",
            ]
          : []),
        ...(body.warnings ?? []).filter((w) => !(!pdfExact && qrVin && w.includes("車台番号"))),
        ...(!pdfExact && qrVin
          ? ["車台番号はQRで読み取った値を使っています（写真の読み取りでは上書きしません）"]
          : []),
      ]);
    } catch {
      setError("通信エラーが発生しました。手入力で進めてください");
      setForm((f) => f ?? blank());
    } finally {
      setReading(false);
      // 同じファイルを選び直せるように値をクリアする（3つの入口すべて）
      for (const r of [pdfRef, cameraRef, photoRef]) if (r.current) r.current.value = "";
    }
  };

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const r = await saveVehicleWithCustomer(form, storeId);
      if (r.error) setError(r.error);
      else {
        setDone(`${form.vehicleName || form.maker || "車両"}を登録しました`);
        setNotes(r.warnings ?? []);
        setForm(null);
        setQrVin(null);
        router.refresh();
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (v: VehicleRow) => {
    if (!window.confirm(`${v.customerName} 様と ${v.vehicleName || "この車両"} の紐づけを解除しますか？`)) return;
    setBusy(true);
    try {
      const r = await unlinkVehicle(v.vehicleId, v.customerId, storeId);
      if (r.error) setError(r.error);
      else router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (setupError) {
    return (
      <Card>
        <p className="text-sm font-bold text-ink">{setupError}</p>
        <p className="mt-1 text-xs text-ink-soft">
          車台番号は暗号化して保存するため、鍵の設定が済むまで車両の登録はできません。
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* 入口: 車検証を撮る／手入力 */}
      {!form && (
        <Card className="border-gold-300">
          <h3 className="text-sm font-bold text-ink">車検証を読み取って登録</h3>
          <p className="mt-1 text-xs text-ink-soft">
            <span className="font-semibold text-ink">いまの車検証（A6の電子車検証）は、車検証閲覧アプリのPDFがいちばん確実です</span>
            。券面には記載が省略されている項目が多く、写真やQRでは有効期間・住所などが取れません。
            PDFならICチップの中身なので、まとめて埋まります。
            <br />
            紙の旧車検証なら写真でも読めます。QRは車台番号・型式だけ誤読なく取れますが、氏名・住所は入っていません。
            読み取った内容は登録前に確認・修正できます。
            <br />
            <span className="font-semibold text-ink">車検証の画像もPDFも保存されません</span>（読み取り後に破棄します）。
          </p>
          {/* PDF専用（iPhoneで「ファイル」アプリが直接開くよう image/* を混ぜない） */}
          <input
            ref={pdfRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void read(f);
            }}
          />
          {/* アルバムに保存済みの写真から選ぶ */}
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void read(f);
            }}
          />
          {/* 撮影専用の入口は別に用意する（カメラをすぐ開きたいとき用） */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void read(f);
            }}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/*
              電子車検証では券面の記載が省略されているため、閲覧アプリのPDFを最優先で勧める。
              PDFはICチップの中身なので、有効期間・氏名・住所まで揃う。
            */}
            <button
              type="button"
              disabled={!ocrEnabled || reading}
              onClick={() => pdfRef.current?.click()}
              className="rounded-lg bg-gold-500 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {reading ? "読み取り中…" : "📄 車検証PDFを選ぶ（推奨）"}
            </button>
            {/* QRは文字認識ではないので車台番号・型式の誤読が起きない */}
            <button
              type="button"
              disabled={reading}
              onClick={() => {
                scannedRef.current = { chassis: null, modelCode: null, expiry: null };
                setScanned({ chassis: null, modelCode: null, expiry: null });
                setScanning(true);
              }}
              className="rounded-lg border border-gold-300 px-3 py-2.5 text-sm font-bold text-ink disabled:opacity-50"
            >
              🔎 QRを読む
            </button>
            <button
              type="button"
              disabled={!ocrEnabled || reading}
              onClick={() => cameraRef.current?.click()}
              className="rounded-lg border border-gold-300 px-3 py-2.5 text-sm font-bold text-ink disabled:opacity-50"
            >
              {reading ? "読み取り中…" : "📷 車検証を撮る"}
            </button>
            <button
              type="button"
              disabled={!ocrEnabled || reading}
              onClick={() => photoRef.current?.click()}
              className="rounded-lg border border-line px-3 py-2.5 text-sm font-semibold text-ink disabled:opacity-50"
            >
              🖼 写真を選ぶ
            </button>
            <button
              type="button"
              onClick={() => {
                setForm(blank());
                setNotes([]);
                setDone(null);
              }}
              className="rounded-lg border border-line px-3 py-2.5 text-sm font-semibold text-ink"
            >
              手入力で登録
            </button>
          </div>
          {!ocrEnabled && (
            <p className="mt-2 text-[11px] text-ink-soft">
              読み取り機能が未設定のため、いまは手入力のみご利用いただけます。
            </p>
          )}

          {/*
            PDFの取り方の案内。iPhoneはWebアプリを共有先に出せない（iOSがWeb Share Targetに
            非対応）ため、「ファイルに保存 → ここで選ぶ」の2手順を案内するのがいちばん確実。
            折りたたみにして、慣れた人の邪魔をしない。
          */}
          <details className="mt-3 rounded-lg border border-line bg-surface-2 p-2.5">
            <summary className="cursor-pointer text-xs font-bold text-ink">
              車検証PDFの取り方（iPhone / Android）
            </summary>
            <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-ink-soft">
              <p className="font-semibold text-ink">iPhone</p>
              <ol className="list-decimal space-y-0.5 pl-4">
                <li>「車検証閲覧アプリ」でICタグを読み取る</li>
                <li>PDFを表示して <span className="font-semibold text-ink">共有 → ファイルに保存</span></li>
                <li>保存先はどこでもOK（「このiPhone内」で十分）</li>
                <li>
                  この画面に戻って <span className="font-semibold text-ink">「📄 車検証PDFを選ぶ」</span>{" "}
                  → 保存したPDFを選ぶ
                </li>
              </ol>
              <p className="font-semibold text-ink">Android</p>
              <ol className="list-decimal space-y-0.5 pl-4">
                <li>同じくPDFを保存（ダウンロードでOK）</li>
                <li>「📄 車検証PDFを選ぶ」から選ぶ</li>
              </ol>
              <p>
                iPhoneでは、他のアプリの「共有」メニューにこのアプリを出すことができません（iOSの仕様）。
                お手数ですが一度保存してから選んでください。
              </p>
            </div>
          </details>
        </Card>
      )}

      {/*
        QRスキャナ（カメラ）。
        車検証にはQRが複数あり、車台番号・型式・有効期間が別のQRに分かれていることがある。
        店舗にどれを読むか選ばせず、映ったQRから取れた項目を**集めて合わせる**。
        車台番号と型式が揃ったら自動で閉じる（車台番号だけでも「これで進む」で閉じられる）。
      */}
      {scanning && (
        <ShakenQrScanner
          status={[
            `車台番号 ${scanned.chassis ? "✓" : "…"}`,
            `型式 ${scanned.modelCode ? "✓" : "…"}`,
            `有効期間 ${scanned.expiry ? "✓" : "—"}`,
          ].join(" / ")}
          hint={
            scanned.chassis
              ? "車台番号は取れました。他のQRも映すと型式・有効期間が埋まります（「閉じる」で先に進めます）"
              : "QRが複数あってもそのまま車検証全体を映してください。必要なQRを自動で探します。"
          }
          onClose={() => {
            setScanning(false);
            applyScanned();
          }}
          onText={(text) => {
            const parsed = parseShakenQr(text);
            // 取れた項目だけ足していく（読めなかったQRは無視して読み続ける）
            const next = {
              chassis: scanned.chassis ?? parsed.chassis,
              modelCode: scanned.modelCode ?? parsed.modelCode,
              expiry: scanned.expiry ?? (qrExpiryToInput(parsed.expiry) || null),
            };
            scannedRef.current = next;
            setScanned(next);
            // 車台番号と型式が揃えば十分（有効期間は様式によって入っていない）
            if (next.chassis && next.modelCode) {
              setScanning(false);
              applyScanned(next);
              return true;
            }
            return false;
          }}
        />
      )}

      {done && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{done}</p>}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
      {notes.length > 0 && (
        <ul className="rounded-lg bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-900">
          {notes.map((n) => (
            <li key={n} className="list-disc">
              {n}
            </li>
          ))}
        </ul>
      )}

      {/* 確認・修正フォーム */}
      {form && (
        <Card className="border-gold-300">
          <h3 className="mb-2 text-sm font-bold text-ink">内容を確認して登録</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className={`${label} sm:col-span-2`}>
              車台番号 <span className="text-red-600">必須</span>
              {qrVin && form.vin === qrVin && (
                <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                  QRで読み取り済み
                </span>
              )}
              <input
                value={form.vin}
                onChange={(e) => {
                  // 手で直したらQR確定を解除する（画面の表示と実態を合わせる）
                  if (qrVin && e.target.value !== qrVin) setQrVin(null);
                  set({ vin: e.target.value });
                }}
                placeholder="ZC33S-123456"
                className={input}
              />
            </label>
            <label className={label}>
              登録番号（ナンバー）
              <input
                value={form.registrationNumber}
                onChange={(e) => set({ registrationNumber: e.target.value })}
                placeholder="大阪 300 あ 12-34"
                className={input}
              />
            </label>
            <label className={label}>
              車名（車検証の「車名」欄）
              <input
                value={form.maker}
                onChange={(e) => set({ maker: e.target.value })}
                placeholder="トヨタ"
                className={input}
              />
            </label>
            <label className={label}>
              型式
              <input
                value={form.modelCode}
                onChange={(e) => set({ modelCode: e.target.value })}
                placeholder="3BA-ZC33S"
                className={input}
              />
            </label>
            <label className={label}>
              車種表示（記事・証明書に出る名前）
              <input
                value={form.vehicleName}
                onChange={(e) => set({ vehicleName: e.target.value })}
                placeholder="アルファード 30系"
                className={input}
              />
            </label>
            <label className={label}>
              初度登録年月
              <input
                value={form.firstRegistered}
                onChange={(e) => set({ firstRegistered: e.target.value })}
                type="month"
                className={input}
              />
            </label>
            <label className={label}>
              車検満了日
              <input
                value={form.inspectionExpiry}
                onChange={(e) => set({ inspectionExpiry: e.target.value })}
                type="date"
                className={input}
              />
            </label>
          </div>

          <h4 className="mt-4 text-sm font-bold text-ink">お客様（車検証の使用者）</h4>
          <p className="text-[11px] text-ink-soft">
            {legalRecordMode
              ? "認証工場は法定記録簿に依頼者の氏名・住所の記載が必要です。"
              : "氏名・住所は証明書と記録のみに使い、公開ブログには一切出ません。"}
          </p>
          <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {customers.length > 0 && (
              <label className={`${label} sm:col-span-2`}>
                既存のお客様から選ぶ
                <select
                  value={form.customerId}
                  onChange={(e) => {
                    const c = customers.find((x) => x.id === e.target.value);
                    set({ customerId: e.target.value, ...(c ? { customerName: c.name, customerTel: c.tel } : {}) });
                  }}
                  className={input}
                >
                  <option value="">新しいお客様として登録する</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} 様{c.tel ? `（${c.tel}）` : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className={label}>
              お名前 <span className="text-red-600">必須</span>
              <input
                value={form.customerName}
                onChange={(e) => set({ customerName: e.target.value })}
                placeholder="山田 太郎"
                className={input}
              />
            </label>
            <label className={label}>
              ふりがな
              <input
                value={form.customerKana}
                onChange={(e) => set({ customerKana: e.target.value })}
                placeholder="やまだ たろう"
                className={input}
              />
            </label>
            <label className={label}>
              電話番号
              <input
                value={form.customerTel}
                onChange={(e) => set({ customerTel: e.target.value })}
                inputMode="tel"
                placeholder="090-0000-0000"
                className={input}
              />
            </label>
            <label className={label}>
              メール
              <input
                value={form.customerEmail}
                onChange={(e) => set({ customerEmail: e.target.value })}
                inputMode="email"
                placeholder="example@example.jp"
                className={input}
              />
            </label>
            <label className={`${label} sm:col-span-2`}>
              住所{legalRecordMode && <span className="text-red-600"> 記録簿に必要</span>}
              <input
                value={form.customerAddress}
                onChange={(e) => set({ customerAddress: e.target.value })}
                placeholder="大阪府堺市北区…"
                className={input}
              />
            </label>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={save}
              className="rounded-lg bg-gold-500 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy ? "登録中…" : "この内容で登録"}
            </button>
            <button type="button" onClick={() => setForm(null)} className="text-sm text-ink-soft hover:underline">
              キャンセル
            </button>
          </div>
        </Card>
      )}

      {/* 修正パネル（車両登録画面と顧客カルテで同じものを使う） */}
      {editVehicleId && (
        <VehicleEditPanel
          key={editVehicleId}
          vehicleId={editVehicleId}
          storeId={storeId}
          onClose={() => setEditVehicleId(null)}
          onSaved={(m) => {
            setDone(m);
            setEditVehicleId(null);
            router.refresh();
          }}
        />
      )}

      {/* 登録済み車両 */}
      {vehicles.length === 0 ? (
        <EmptyState message="まだ車両の登録がありません。車検証を撮ると、証明書に必要な情報がまとめて入ります。" />
      ) : (
        <Card className="divide-y divide-line p-0">
          {vehicles.map((v) => {
            const left = daysLeft(v.inspectionExpiry);
            return (
              <div key={`${v.vehicleId}-${v.customerId}`} className="flex items-center gap-2 p-3">
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-semibold text-ink">
                      {v.vehicleName || v.maker || "車両"}
                    </span>
                    {v.chassisLast3 && (
                      <span className="shrink-0 text-[11px] text-ink-soft">車台下3桁 {v.chassisLast3}</span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-ink-soft">
                    {v.customerName} 様
                    {v.modelCode && <span className="ml-2">型式 {v.modelCode}</span>}
                    {v.firstRegistered && <span className="ml-2">初度 {v.firstRegistered}</span>}
                  </div>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  {left !== null && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        left <= 30
                          ? "bg-red-100 text-red-700"
                          : left <= 60
                            ? "bg-amber-100 text-amber-800"
                            : "bg-surface-2 text-ink-soft"
                      }`}
                    >
                      {left < 0 ? "車検切れ" : `車検あと${left}日`}
                    </span>
                  )}
                  <Link
                    href={`${basePath}/certificates/new?vehicleId=${v.vehicleId}${storeId ? `&storeId=${storeId}` : ""}`}
                    className="rounded-lg border border-gold-300 px-2 py-1 text-[11px] font-bold text-ink"
                  >
                    証明書
                  </Link>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setEditVehicleId(v.vehicleId)}
                    className="text-[11px] text-ink-soft hover:underline disabled:opacity-50"
                  >
                    修正
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => unlink(v)}
                    className="text-[11px] text-ink-soft hover:underline"
                  >
                    解除
                  </button>
                </div>
              </div>
            );
          })}
        </Card>
      )}
      <p className="text-[11px] text-ink-soft">
        車台番号と登録番号は暗号化して保存し、公開ブログには一切出しません。表示は下3桁のみです。
      </p>
    </div>
  );
}
