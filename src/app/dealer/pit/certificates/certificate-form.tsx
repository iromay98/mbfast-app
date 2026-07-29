"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { saveCertificate } from "@/lib/actions/pit-certificates";
import type { CertificateCoreInput } from "@/server/pit/certificate";

export type VehicleOption = {
  vehicleId: string;
  customerId: string;
  label: string; // 「スイフトスポーツ（検証 太郎 様・下3桁 888）」
  customerName: string;
};

export type FieldOption = {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  unit?: string;
  options?: string[];
  hint?: string;
  help?: string;
};

export type TypeOption = { key: string; label: string; fields: FieldOption[] };

const input = "mt-0.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink";
const label = "block text-[11px] font-semibold text-ink-soft";

/*
 * 証明書の作成・編集フォーム。
 * 共通コア（施工日・走行距離・担当者・作業概要・金額）＋施工種別モジュールの項目を1画面で入れる。
 * 発行は保存後に詳細画面で行う（発行すると内容が固定されるため、確認の一手間を挟む）。
 */
export function CertificateForm({
  vehicles,
  types,
  legalRecordMode,
  initial,
  certificateId,
}: {
  vehicles: VehicleOption[];
  types: TypeOption[];
  legalRecordMode: boolean;
  initial?: Partial<CertificateCoreInput>;
  certificateId?: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<CertificateCoreInput>({
    vehicleId: initial?.vehicleId ?? vehicles[0]?.vehicleId ?? "",
    customerId: initial?.customerId ?? vehicles[0]?.customerId ?? "",
    certificateType: initial?.certificateType ?? types[0]?.key ?? "general",
    serviceDate: initial?.serviceDate ?? new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
    odometerKm: initial?.odometerKm ?? "",
    staffName: initial?.staffName ?? "",
    staffLicenseNo: initial?.staffLicenseNo ?? "",
    workSummary: initial?.workSummary ?? "",
    totalAmount: initial?.totalAmount ?? "",
    restorationCostEstimate: initial?.restorationCostEstimate ?? "",
    requireVerifyLast3: initial?.requireVerifyLast3 ?? false,
    warrantyUntil: initial?.warrantyUntil ?? "",
    moduleValues: initial?.moduleValues ?? {},
    blogPostId: initial?.blogPostId ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<string[]>([]);

  const set = (patch: Partial<CertificateCoreInput>) => setForm((f) => ({ ...f, ...patch }));
  const setModule = (key: string, value: string) =>
    setForm((f) => ({ ...f, moduleValues: { ...f.moduleValues, [key]: value } }));

  const active = types.find((t) => t.key === form.certificateType);

  const save = async () => {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    setWarnings([]);
    try {
      const r = await saveCertificate(form, certificateId);
      if (r.error) {
        setError(r.error);
        setFieldErrors(Object.fromEntries((r.fieldErrors ?? []).map((e) => [e.fieldKey, e.message])));
        return;
      }
      // 発行前の確認をしてもらうため詳細画面へ送る
      router.push(`/dealer/pit/certificates/${r.certificateId}${r.warnings?.length ? "?saved=1" : ""}`);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
      {warnings.length > 0 && (
        <ul className="rounded-lg bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-900">
          {warnings.map((w) => (
            <li key={w} className="list-disc">
              {w}
            </li>
          ))}
        </ul>
      )}

      <Card>
        <h3 className="mb-2 text-sm font-bold text-ink">対象</h3>
        <div className="grid grid-cols-1 gap-2">
          <label className={label}>
            車両とお客様 <span className="text-red-600">必須</span>
            <select
              value={form.vehicleId}
              onChange={(e) => {
                const v = vehicles.find((x) => x.vehicleId === e.target.value);
                set({ vehicleId: e.target.value, customerId: v?.customerId ?? "" });
              }}
              className={input}
            >
              {vehicles.map((v) => (
                <option key={`${v.vehicleId}-${v.customerId}`} value={v.vehicleId}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            施工種別 <span className="text-red-600">必須</span>
            <select
              value={form.certificateType}
              onChange={(e) => set({ certificateType: e.target.value })}
              className={input}
            >
              {types.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <Card>
        <h3 className="mb-2 text-sm font-bold text-ink">共通項目</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className={label}>
            施工日 <span className="text-red-600">必須</span>
            <input
              type="date"
              value={form.serviceDate}
              onChange={(e) => set({ serviceDate: e.target.value })}
              className={input}
            />
          </label>
          <label className={label}>
            施工時走行距離（km）
            <input
              inputMode="numeric"
              value={form.odometerKm}
              onChange={(e) => set({ odometerKm: e.target.value })}
              placeholder="52300"
              className={input}
            />
          </label>
          <label className={label}>
            担当者名 <span className="text-red-600">必須</span>
            <input
              value={form.staffName}
              onChange={(e) => set({ staffName: e.target.value })}
              placeholder="山本"
              className={input}
            />
          </label>
          <label className={label}>
            資格番号{legalRecordMode && <span className="text-ink-soft">（整備士資格）</span>}
            <input
              value={form.staffLicenseNo}
              onChange={(e) => set({ staffLicenseNo: e.target.value })}
              className={input}
            />
          </label>
          <label className={`${label} sm:col-span-2`}>
            作業概要 <span className="text-red-600">必須</span>
            <textarea
              value={form.workSummary}
              onChange={(e) => set({ workSummary: e.target.value })}
              rows={3}
              placeholder="ボディ全面のガラスコーティングを施工。下地処理として鉄粉除去と1工程の研磨を実施。"
              className={input}
            />
          </label>
          <label className={label}>
            施工金額（円）
            <input
              inputMode="numeric"
              value={form.totalAmount}
              onChange={(e) => set({ totalAmount: e.target.value })}
              placeholder="128000"
              className={input}
            />
          </label>
          <label className={label}>
            再施工費用の目安（円）
            <input
              inputMode="numeric"
              value={form.restorationCostEstimate}
              onChange={(e) => set({ restorationCostEstimate: e.target.value })}
              placeholder="128000"
              className={input}
            />
          </label>
          <label className={label}>
            保証満了日（保証がある施工のみ）
            <input
              type="date"
              value={form.warrantyUntil}
              onChange={(e) => set({ warrantyUntil: e.target.value })}
              className={input}
            />
          </label>
        </div>
        <p className="mt-1 text-[11px] text-ink-soft">
          金額・走行距離・お客様の氏名住所は証明書と記録にだけ使い、公開ブログには一切出ません。
        </p>
      </Card>

      {active && active.fields.length > 0 && (
        <Card>
          <h3 className="mb-2 text-sm font-bold text-ink">{active.label}の項目</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {active.fields.map((f) => (
              <label key={f.key} className={`${label} ${f.type === "textarea" ? "sm:col-span-2" : ""}`}>
                {f.label}
                {f.required && <span className="text-red-600"> 必須</span>}
                {f.unit && <span className="text-ink-soft">（{f.unit}）</span>}
                {f.type === "select" ? (
                  <select
                    value={form.moduleValues[f.key] ?? ""}
                    onChange={(e) => setModule(f.key, e.target.value)}
                    className={input}
                  >
                    <option value="">選択してください</option>
                    {(f.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : f.type === "textarea" ? (
                  <textarea
                    value={form.moduleValues[f.key] ?? ""}
                    onChange={(e) => setModule(f.key, e.target.value)}
                    rows={2}
                    className={input}
                  />
                ) : (
                  <input
                    type={f.type === "date" ? "date" : "text"}
                    inputMode={f.type === "number" ? "numeric" : undefined}
                    value={form.moduleValues[f.key] ?? ""}
                    onChange={(e) => setModule(f.key, e.target.value)}
                    className={input}
                  />
                )}
                {f.help && <span className="mt-0.5 block text-[10px] font-normal text-ink-soft">{f.help}</span>}
                {fieldErrors[f.key] && (
                  <span className="mt-0.5 block text-[10px] font-semibold text-red-600">{fieldErrors[f.key]}</span>
                )}
              </label>
            ))}
          </div>
          {active.fields.some((f) => f.hint === "ocr") && (
            <p className="mt-2 text-[11px] text-ink-soft">
              製品ラベルやタイヤ刻印の写真からの読み取りは次の更新で追加します。いまは手入力でお願いします。
            </p>
          )}
        </Card>
      )}

      <Card>
        <label className="flex items-start gap-2 text-xs font-semibold text-ink">
          <input
            type="checkbox"
            checked={form.requireVerifyLast3}
            onChange={(e) => set({ requireVerifyLast3: e.target.checked })}
            className="mt-0.5"
          />
          <span>
            共有リンクを開くときに車台番号の下3桁を聞く
            <span className="mt-0.5 block font-normal text-ink-soft">
              リンクが第三者に転送された場合の備えです。お客様には下3桁をお伝えください。
            </span>
          </span>
        </label>
      </Card>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy || vehicles.length === 0}
          onClick={save}
          className="rounded-lg bg-gold-500 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? "保存中…" : "保存して内容を確認"}
        </button>
        <button type="button" onClick={() => router.back()} className="text-sm text-ink-soft hover:underline">
          キャンセル
        </button>
      </div>
      <p className="text-[11px] text-ink-soft">保存した時点では下書きです。次の画面で内容を確認してから発行します。</p>
    </div>
  );
}
