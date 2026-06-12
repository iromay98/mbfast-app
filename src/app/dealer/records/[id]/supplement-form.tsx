"use client";

import { useState } from "react";
import { useActionState } from "react";
import { Button, Card, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { ShakenScanner } from "@/components/shaken-scanner";
import { emptyFormState, type FormState } from "@/lib/actions/form-state";
import { workTypeLabels } from "@/lib/labels";
import type { ShakenRaw, ShakenVehicleInfo } from "@/lib/shaken/parse";

type Defaults = {
  vin?: string | null;
  workType?: keyof typeof workTypeLabels | null;
  softwareNumber?: string | null;
  appliedMap?: string | null;
  tcuType?: string | null;
  carYear?: number | null;
  note?: string | null;
  registrationNumber?: string | null;
  vehicleModelCode?: string | null;
  engineModelCode?: string | null;
  modelDesignationNumber?: string | null;
  firstRegistration?: string | null;
  inspectionExpiry?: string | null;
  hwNumber?: string | null;
  swNumber?: string | null;
  calNumber?: string | null;
  customerName?: string | null;
};

// 車検証スキャンで自動入力する項目
type ScanFields = {
  vin: string;
  carYear: string;
  registrationNumber: string;
  vehicleModelCode: string;
  engineModelCode: string;
  modelDesignationNumber: string;
  firstRegistration: string;
  inspectionExpiry: string;
};

export function SupplementForm({
  action,
  defaults,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults: Defaults;
}) {
  const [state, formAction, pending] = useActionState(action, emptyFormState);
  const fe = state.fieldErrors ?? {};

  const [scan, setScan] = useState<ScanFields>({
    vin: defaults.vin ?? "",
    carYear: defaults.carYear != null ? String(defaults.carYear) : "",
    registrationNumber: defaults.registrationNumber ?? "",
    vehicleModelCode: defaults.vehicleModelCode ?? "",
    engineModelCode: defaults.engineModelCode ?? "",
    modelDesignationNumber: defaults.modelDesignationNumber ?? "",
    firstRegistration: defaults.firstRegistration ?? "",
    inspectionExpiry: defaults.inspectionExpiry ?? "",
  });
  const [rawJson, setRawJson] = useState("");

  const set = (k: keyof ScanFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setScan((s) => ({ ...s, [k]: e.target.value }));

  const onParsed = (info: ShakenVehicleInfo, raw: ShakenRaw) => {
    setScan((s) => ({
      vin: info.vin ?? s.vin,
      carYear: info.carYear ? String(info.carYear) : s.carYear,
      registrationNumber: info.registrationNumber ?? s.registrationNumber,
      vehicleModelCode: info.vehicleModelCode ?? s.vehicleModelCode,
      engineModelCode: info.engineModelCode ?? s.engineModelCode,
      modelDesignationNumber: info.modelDesignationNumber ?? s.modelDesignationNumber,
      firstRegistration: info.firstRegistration ?? s.firstRegistration,
      inspectionExpiry: info.inspectionExpiry ?? s.inspectionExpiry,
    }));
    setRawJson(JSON.stringify(raw));
  };

  return (
    <Card>
      <h3 className="mb-1 text-sm font-bold text-ink">補足情報の入力</h3>
      <p className="mb-3 text-xs text-ink-soft">
        車検証QRの読み取り、または自動で埋まらない項目（VIN・施工種別・写真など）を追記できます。
      </p>
      <form action={formAction} className="space-y-4">
        <ShakenScanner onParsed={onParsed} />

        <Field label="顧客名">
          <Input name="customerName" placeholder="例: 柳田 様" defaultValue={defaults.customerName ?? ""} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="車台番号(VIN)" hint={fe.vin}>
            <Input
              name="vin"
              className="font-mono"
              autoCapitalize="characters"
              value={scan.vin}
              onChange={set("vin")}
            />
          </Field>
          <Field label="施工種別" hint={fe.workType}>
            <Select name="workType" defaultValue={defaults.workType ?? ""}>
              <option value="">未選択</option>
              {Object.entries(workTypeLabels).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* 車検証情報 */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ナンバー（登録番号）">
            <Input
              name="registrationNumber"
              placeholder="品川 330 さ 1001"
              value={scan.registrationNumber}
              onChange={set("registrationNumber")}
            />
          </Field>
          <Field label="型式">
            <Input
              name="vehicleModelCode"
              className="font-mono"
              value={scan.vehicleModelCode}
              onChange={set("vehicleModelCode")}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="原動機型式">
            <Input
              name="engineModelCode"
              className="font-mono"
              value={scan.engineModelCode}
              onChange={set("engineModelCode")}
            />
          </Field>
          <Field label="型式指定番号・類別区分番号">
            <Input
              name="modelDesignationNumber"
              className="font-mono"
              value={scan.modelDesignationNumber}
              onChange={set("modelDesignationNumber")}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="初度登録（YYYY-MM）">
            <Input
              name="firstRegistration"
              value={scan.firstRegistration}
              onChange={set("firstRegistration")}
            />
          </Field>
          <Field label="有効期限（YYYY-MM-DD）">
            <Input
              name="inspectionExpiry"
              value={scan.inspectionExpiry}
              onChange={set("inspectionExpiry")}
            />
          </Field>
        </div>

        {/* 代理店には ECU 識別子(Cal/HW/SW)・SW番号・適用マップ・TCU型式 など専門項目は出さない。 */}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="年式">
            <Input
              name="carYear"
              inputMode="numeric"
              value={scan.carYear}
              onChange={set("carYear")}
            />
          </Field>
        </div>

        <Field label="写真を追加（カメラ/ギャラリー・複数可）" hint={fe.photos}>
          <input
            type="file"
            name="photos"
            accept="image/*"
            multiple
            className="block w-full text-sm text-ink file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-gold-500 file:px-4 file:text-sm file:font-semibold file:text-white"
          />
        </Field>

        <Field label="メモ">
          <Textarea name="note" rows={3} defaultValue={defaults.note ?? ""} />
        </Field>

        <input type="hidden" name="shakenScanRaw" value={rawJson} />

        <FormError message={state.error} />
        {state.ok && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">保存しました。</p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "保存中…" : "補足を保存"}
        </Button>
      </form>
    </Card>
  );
}
