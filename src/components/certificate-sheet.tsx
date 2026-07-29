/*
 * 施工証明書の帳票（店舗の詳細画面・共有ページ・印刷/PDFで共通に使う）。
 *
 * - 法定様式そのものではない。項目を確実に載せることを優先し、レイアウトは差し替え可能にしている
 *   （帳票を作り直すときはこのファイルだけを置き換える）
 * - 値の受け渡しは props のみ。DBにも復号にも触らない（公開側に混ざる余地を作らない）
 * - 印刷時は画面のナビ等を消す（globals.css の @media print と .no-print）
 */

export type SheetRow = { label: string; value: string };

export type CertificateSheetProps = {
  certificateNo: string;
  typeLabel: string;
  statusLabel: string;
  legalRecord: boolean;
  issuedLabel: string;
  vehicle: {
    name: string;
    maker: string;
    modelCode: string;
    firstRegistered: string;
    /** 復号済みの車台番号。取得できない場合は空（下3桁のみ表示にフォールバック） */
    vin: string;
    registrationNumber: string;
    chassisLast3: string;
  };
  customer: { name: string; address: string; tel: string };
  store: { name: string; address: string; tel: string; certificationNo: string };
  service: {
    dateLabel: string;
    odometerKm: string;
    staffName: string;
    staffLicenseNo: string;
    workSummary: string;
    totalAmount: string;
    restorationCostEstimate: string;
  };
  details: SheetRow[];
  payloadHash: string;
  voided?: { at: string; reason: string } | null;
};

function Row({ label, value }: SheetRow) {
  return (
    <tr className="align-top">
      <th className="w-[38%] border border-neutral-300 bg-neutral-50 px-2 py-1.5 text-left text-[11px] font-semibold text-neutral-700">
        {label}
      </th>
      <td className="border border-neutral-300 px-2 py-1.5 text-[12px] font-semibold text-neutral-900">
        {value || "—"}
      </td>
    </tr>
  );
}

export function CertificateSheet(p: CertificateSheetProps) {
  const vinLabel = p.vehicle.vin || (p.vehicle.chassisLast3 ? `下3桁 ${p.vehicle.chassisLast3}` : "");

  return (
    <div className="cert-sheet mx-auto max-w-[760px] bg-white p-5 text-neutral-900">
      <header className="border-b-2 border-neutral-900 pb-2">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-lg font-bold tracking-tight">施工証明書</h1>
          <span className="text-[11px] font-semibold text-neutral-600">mbPIT</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-neutral-600">
          <span>証明書番号: {p.certificateNo || "（未発行）"}</span>
          <span>発行: {p.issuedLabel || "（未発行）"}</span>
          <span>種別: {p.typeLabel}</span>
          {p.legalRecord && <span className="font-semibold text-neutral-900">法定記録簿として記載</span>}
          {p.statusLabel && <span>状態: {p.statusLabel}</span>}
        </div>
      </header>

      {p.voided && (
        <p className="mt-3 border border-red-300 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-800">
          この証明書は {p.voided.at} に無効化されています（理由: {p.voided.reason}）。
        </p>
      )}

      <section className="mt-4">
        <h2 className="mb-1 text-[12px] font-bold">車両</h2>
        <table className="w-full border-collapse">
          <tbody>
            <Row label="車名・車種" value={[p.vehicle.maker, p.vehicle.name].filter(Boolean).join(" ")} />
            <Row label="型式" value={p.vehicle.modelCode} />
            <Row label="車台番号" value={vinLabel} />
            <Row label="登録番号" value={p.vehicle.registrationNumber} />
            <Row label="初度登録年月" value={p.vehicle.firstRegistered} />
            <Row label="施工時走行距離" value={p.service.odometerKm} />
          </tbody>
        </table>
      </section>

      <section className="mt-4">
        <h2 className="mb-1 text-[12px] font-bold">依頼者</h2>
        <table className="w-full border-collapse">
          <tbody>
            <Row label="氏名または名称" value={p.customer.name} />
            <Row label="住所" value={p.customer.address} />
            <Row label="連絡先" value={p.customer.tel} />
          </tbody>
        </table>
      </section>

      <section className="mt-4">
        <h2 className="mb-1 text-[12px] font-bold">施工内容</h2>
        <table className="w-full border-collapse">
          <tbody>
            <Row label="施工日" value={p.service.dateLabel} />
            <Row label="作業概要" value={p.service.workSummary} />
            {p.details.map((d) => (
              <Row key={d.label} label={d.label} value={d.value} />
            ))}
            <Row label="施工金額" value={p.service.totalAmount} />
            <Row label="再施工費用の目安" value={p.service.restorationCostEstimate} />
          </tbody>
        </table>
      </section>

      <section className="mt-4">
        <h2 className="mb-1 text-[12px] font-bold">施工者</h2>
        <table className="w-full border-collapse">
          <tbody>
            <Row label="施工店" value={p.store.name} />
            <Row label="所在地" value={p.store.address} />
            <Row label="連絡先" value={p.store.tel} />
            <Row label="認証番号" value={p.store.certificationNo} />
            <Row label="担当者" value={p.service.staffName} />
            <Row label="資格番号" value={p.service.staffLicenseNo} />
          </tbody>
        </table>
      </section>

      <footer className="mt-4 border-t border-neutral-300 pt-2 text-[10px] leading-relaxed text-neutral-600">
        <p className="break-all">
          記録ハッシュ: {p.payloadHash || "（未発行）"}
        </p>
        <p className="mt-1">
          本書は上記の施工内容を施工店が記録したものです。車検の合否・保険金の支払い・査定額を保証するものではありません。
          内容の訂正が必要な場合は、この証明書を無効化して新しい証明書を発行します。
        </p>
      </footer>
    </div>
  );
}
