import { Card, Badge, LinkButton } from "@/components/ui";
import {
  workTypeLabels,
  recordStatusLabels,
  recordStatusColors,
  formatDate,
} from "@/lib/labels";

type EngineInfo = {
  name?: string;
  version?: string | null;
  year_from?: number;
  year_to?: number | null;
  power?: number | null;
  torque?: number | null;
  fuel?: string;
} | null;

type RecordForDetail = {
  id: string;
  status: keyof typeof recordStatusLabels;
  vin: string | null;
  carMaker: string | null;
  carModel: string | null;
  carYear: number | null;
  ecuType: string | null;
  ecuManufacturer: string | null;
  mcu: string | null;
  method: string | null;
  tcuType: string | null;
  softwareNumber: string | null;
  workType: keyof typeof workTypeLabels | null;
  appliedMap: string | null;
  customerName: string | null;
  hwNumber: string | null;
  swNumber: string | null;
  calNumber: string | null;
  registrationNumber: string | null;
  vehicleModelCode: string | null;
  engineModelCode: string | null;
  modelDesignationNumber: string | null;
  firstRegistration: string | null;
  inspectionExpiry: string | null;
  workedAt: Date;
  note: string | null;
  photoPaths: string[];
  slaveName: string | null;
  slaveFilePath: string | null;
  decryptedFilePath: string | null;
  decryptError: string | null;
  engineInfo: unknown;
  dealer?: { name: string } | null;
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-2">
      <dt className="shrink-0 text-sm text-ink-soft">{label}</dt>
      <dd className="text-right text-sm font-medium text-ink">{value || "—"}</dd>
    </div>
  );
}

export function RecordDetail({
  record,
  hideTechnical = false,
  dealerControl,
  customerNameControl,
  swDisplay,
}: {
  record: RecordForDetail;
  // 代理店向けは true。ECU/Cal/HW/SW・読み方式・TCU・エンジン情報・復号ファイル等を一切出さない。
  hideTechnical?: boolean;
  // 本店向け: 施工代理店をその場で変更するUI（プルダウン）。指定時は店名の代わりに表示。
  dealerControl?: React.ReactNode;
  // 本店向け: 顧客名をその場で変更するUI。指定時は顧客名の代わりに表示。
  customerNameControl?: React.ReactNode;
  // 本店向け: SW番号の表示上書き（同一SW・別内容の枝番付きラベル等）。
  swDisplay?: string;
}) {
  const engine = (record.engineInfo as EngineInfo) ?? null;
  const title =
    record.carMaker || record.carModel
      ? `${record.carMaker ?? ""} ${record.carModel ?? ""}`.trim()
      : record.slaveName || "（解析中…）";

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-base font-bold text-ink">
            {title}
            {record.carYear ? `（${record.carYear}）` : ""}
          </h2>
          <Badge color={recordStatusColors[record.status]}>
            {recordStatusLabels[record.status]}
          </Badge>
        </div>

        {!hideTechnical && record.status === "FAILED" && record.decryptError && (
          <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            復号エラー: {record.decryptError}
          </p>
        )}

        <dl className="divide-y divide-line">
          {dealerControl ? (
            <Row label="施工代理店" value={dealerControl} />
          ) : (
            record.dealer && <Row label="施工代理店" value={record.dealer.name} />
          )}
          <Row label="顧客名" value={customerNameControl ?? record.customerName} />
          <Row label="施工日" value={formatDate(record.workedAt)} />
          <Row
            label="車台番号(VIN)"
            value={record.vin ? <span className="font-mono">{record.vin}</span> : null}
          />
          <Row
            label="施工種別"
            value={record.workType ? workTypeLabels[record.workType] : null}
          />
          {!hideTechnical && (
            <>
              <Row
                label="ECU型式 / メーカー / MCU"
                value={
                  record.ecuType || record.ecuManufacturer || record.mcu
                    ? [record.ecuType, record.ecuManufacturer, record.mcu]
                        .map((v) => v || "—")
                        .join(" / ")
                    : null
                }
              />
              <Row label="読み方式(method)" value={record.method} />
              <Row label="TCU型式" value={record.tcuType} />
              <Row label="SW番号" value={record.softwareNumber} />
              <Row label="適用マップ" value={record.appliedMap} />
            </>
          )}
        </dl>
      </Card>

      {!hideTechnical && (record.calNumber || record.swNumber || record.hwNumber) && (
        <Card>
          <h3 className="mb-1 text-sm font-bold text-ink">ECU識別子（自動抽出）</h3>
          {record.calNumber && (
            <div className="mb-2 rounded-lg bg-gold-50 px-3 py-2">
              <div className="text-xs text-ink-soft">Cal番号</div>
              <div className="font-mono text-base font-bold text-ink">{record.calNumber}</div>
            </div>
          )}
          <dl className="divide-y divide-line">
            <Row
              label="SW番号"
              value={
                swDisplay ?? record.swNumber ? (
                  <span className="font-mono">{swDisplay ?? record.swNumber}</span>
                ) : null
              }
            />
            <Row
              label="HW番号"
              value={record.hwNumber ? <span className="font-mono">{record.hwNumber}</span> : null}
            />
          </dl>
        </Card>
      )}

      {(record.registrationNumber ||
        record.vehicleModelCode ||
        record.engineModelCode ||
        record.modelDesignationNumber ||
        record.firstRegistration ||
        record.inspectionExpiry) && (
        <Card>
          <h3 className="mb-1 text-sm font-bold text-ink">車検証情報</h3>
          <dl className="divide-y divide-line">
            <Row label="ナンバー（登録番号）" value={record.registrationNumber} />
            <Row
              label="型式"
              value={
                record.vehicleModelCode ? (
                  <span className="font-mono">{record.vehicleModelCode}</span>
                ) : null
              }
            />
            <Row
              label="原動機型式"
              value={
                record.engineModelCode ? (
                  <span className="font-mono">{record.engineModelCode}</span>
                ) : null
              }
            />
            <Row label="型式指定番号・類別区分番号" value={record.modelDesignationNumber} />
            <Row label="初度登録" value={record.firstRegistration} />
            <Row label="有効期限" value={record.inspectionExpiry} />
          </dl>
        </Card>
      )}

      {!hideTechnical && engine && (engine.name || engine.power || engine.fuel) && (
        <Card>
          <h3 className="mb-1 text-sm font-bold text-ink">エンジン情報（自動取得）</h3>
          <dl className="divide-y divide-line">
            <Row label="エンジン名" value={engine.name} />
            <Row label="出力" value={engine.power ? `${engine.power} hp` : null} />
            <Row label="トルク" value={engine.torque ? `${engine.torque} Nm` : null} />
            <Row label="燃料" value={engine.fuel} />
            <Row
              label="年式"
              value={
                engine.year_from
                  ? `${engine.year_from}${engine.year_to ? `–${engine.year_to}` : "–"}`
                  : null
              }
            />
          </dl>
        </Card>
      )}

      {record.note && (
        <Card>
          <h3 className="mb-1 text-sm font-bold text-ink">メモ</h3>
          <p className="whitespace-pre-wrap text-sm text-ink">{record.note}</p>
        </Card>
      )}

      {(record.slaveFilePath || (!hideTechnical && record.decryptedFilePath)) && (
        <Card>
          <h3 className="mb-2 text-sm font-bold text-ink">ファイル</h3>
          <div className="flex flex-wrap gap-2">
            {record.slaveFilePath && (
              <LinkButton href={`/api/records/${record.id}/files/slave`} variant="secondary">
                ⬇ slave
              </LinkButton>
            )}
            {/* 復号(decrypt)した純正binは本店のみ。代理店には一切出さない。 */}
            {!hideTechnical &&
              (record.decryptedFilePath ? (
                <LinkButton href={`/api/records/${record.id}/files/decrypted`}>
                  ⬇ bin
                </LinkButton>
              ) : (
                <span className="self-center text-sm text-ink-soft">bin 未生成</span>
              ))}
          </div>
        </Card>
      )}

      {record.photoPaths.length > 0 && (
        <Card>
          <h3 className="mb-2 text-sm font-bold text-ink">
            写真（{record.photoPaths.length}）
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {record.photoPaths.map((_, i) => (
              <a
                key={i}
                href={`/api/records/${record.id}/photos/${i}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block aspect-square overflow-hidden rounded-lg border border-line bg-surface-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/records/${record.id}/photos/${i}`}
                  alt={`施工写真 ${i + 1}`}
                  className="h-full w-full object-cover"
                />
              </a>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
