import { Card, Badge, LinkButton } from "@/components/ui";
import {
  requestStatusLabels,
  requestStatusColors,
  formatDateTime,
} from "@/lib/labels";

type RequestForInfo = {
  id: string;
  title: string;
  status: keyof typeof requestStatusLabels;
  carInfo: string | null;
  vin: string | null;
  ecuType: string | null;
  requestNote: string | null;
  hqNote: string | null;
  inputFilePath: string | null;
  resultFilePath: string | null;
  createdAt: Date;
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

export function RequestInfo({ request }: { request: RequestForInfo }) {
  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-2 flex items-start justify-between gap-2">
          <h2 className="text-base font-bold text-ink">{request.title}</h2>
          <Badge color={requestStatusColors[request.status]}>
            {requestStatusLabels[request.status]}
          </Badge>
        </div>
        <dl className="divide-y divide-line">
          {request.dealer && <Row label="依頼元代理店" value={request.dealer.name} />}
          <Row label="車両情報" value={request.carInfo} />
          <Row
            label="車台番号(VIN)"
            value={request.vin ? <span className="font-mono">{request.vin}</span> : null}
          />
          <Row label="ECU型式" value={request.ecuType} />
          <Row label="依頼日時" value={formatDateTime(request.createdAt)} />
        </dl>
      </Card>

      {request.requestNote && (
        <Card>
          <h3 className="mb-1 text-sm font-bold text-ink">依頼内容</h3>
          <p className="whitespace-pre-wrap text-sm text-ink">{request.requestNote}</p>
        </Card>
      )}

      {request.hqNote && (
        <Card>
          <h3 className="mb-1 text-sm font-bold text-ink">本店からのコメント</h3>
          <p className="whitespace-pre-wrap text-sm text-ink">{request.hqNote}</p>
        </Card>
      )}

      {/* ファイル */}
      <Card>
        <h3 className="mb-2 text-sm font-bold text-ink">ファイル</h3>
        <div className="flex flex-wrap gap-2">
          {request.inputFilePath ? (
            <LinkButton
              href={`/api/requests/${request.id}/input`}
              variant="secondary"
            >
              ⬇ 入力ファイル
            </LinkButton>
          ) : (
            <span className="text-sm text-ink-soft">入力ファイルなし</span>
          )}
          {request.resultFilePath ? (
            <LinkButton href={`/api/requests/${request.id}/result`}>
              ⬇ 成果ファイル
            </LinkButton>
          ) : (
            <span className="text-sm text-ink-soft">成果ファイル未納品</span>
          )}
        </div>
      </Card>
    </div>
  );
}
