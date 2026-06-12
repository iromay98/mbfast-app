"use client";

import { useState } from "react";
import { useActionState } from "react";
import { Button, Card, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { ShakenScanner } from "@/components/shaken-scanner";
import { emptyFormState } from "@/lib/actions/form-state";
import { createServiceRecord } from "@/lib/actions/records";
import { workTypeLabels } from "@/lib/labels";
import type { ShakenRaw, ShakenVehicleInfo } from "@/lib/shaken/parse";

// 車検証スキャンで自動入力される項目（制御コンポーネント化する）
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

const emptyScan: ScanFields = {
  vin: "",
  carYear: "",
  registrationNumber: "",
  vehicleModelCode: "",
  engineModelCode: "",
  modelDesignationNumber: "",
  firstRegistration: "",
  inspectionExpiry: "",
};

export function RecordForm({ today }: { today: string }) {
  const [state, formAction, pending] = useActionState(
    createServiceRecord,
    emptyFormState,
  );
  const [scan, setScan] = useState<ScanFields>(emptyScan);
  const [rawJson, setRawJson] = useState("");
  const fe = state.fieldErrors ?? {};

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
      <form action={formAction} className="space-y-4">
        <ShakenScanner onParsed={onParsed} />

        <Field label="顧客名" hint={fe.customerName}>
          <Input name="customerName" placeholder="例: 柳田 様" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="メーカー *" hint={fe.carMaker}>
            <Input name="carMaker" placeholder="Audi" required />
          </Field>
          <Field label="車種 *" hint={fe.carModel}>
            <Input name="carModel" placeholder="S3 8V" required />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="車台番号(VIN) *" hint={fe.vin}>
            <Input
              name="vin"
              className="font-mono"
              autoCapitalize="characters"
              value={scan.vin}
              onChange={set("vin")}
              required
            />
          </Field>
          <Field label="年式" hint={fe.carYear}>
            <Input
              name="carYear"
              inputMode="numeric"
              placeholder="2018"
              value={scan.carYear}
              onChange={set("carYear")}
            />
          </Field>
        </div>

        {/* 車検証情報（スキャンで自動入力・手編集可） */}
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
              placeholder="DBA-GRS214"
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
              placeholder="2018-04"
              value={scan.firstRegistration}
              onChange={set("firstRegistration")}
            />
          </Field>
          <Field label="有効期限（YYYY-MM-DD）">
            <Input
              name="inspectionExpiry"
              placeholder="券面コードからは取得不可"
              value={scan.inspectionExpiry}
              onChange={set("inspectionExpiry")}
            />
          </Field>
        </div>

        {/* 代理店には ECU型式/TCU/SW番号/適用マップ など専門項目は出さない。 */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="施工種別 *" hint={fe.workType}>
            <Select name="workType" defaultValue="TUNING" required>
              {Object.entries(workTypeLabels).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="施工日 *" hint={fe.workedAt}>
            <Input type="date" name="workedAt" defaultValue={today} required />
          </Field>
        </div>

        <Field label="写真（カメラ/ギャラリーから複数可）" hint={fe.photos}>
          <input
            type="file"
            name="photos"
            accept="image/*"
            multiple
            className="block w-full text-sm text-ink file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-gold-500 file:px-4 file:text-sm file:font-semibold file:text-white"
          />
        </Field>

        <Field label="メモ">
          <Textarea name="note" rows={3} />
        </Field>

        {/* 車検証スキャンの生データ（監査・再解析用） */}
        <input type="hidden" name="shakenScanRaw" value={rawJson} />

        <FormError message={state.error} />
        <Button type="submit" disabled={pending}>
          {pending ? "登録中…" : "施工記録を登録"}
        </Button>
      </form>
    </Card>
  );
}
