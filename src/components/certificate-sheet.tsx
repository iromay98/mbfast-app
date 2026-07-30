/*
 * 施工証明書の帳票（店舗の詳細画面・共有ページ・印刷/PDFで共通に使う）。
 *
 * - 法定様式そのものではない。項目を確実に載せることを優先し、レイアウトは差し替え可能にしている
 *   （帳票を作り直すときはこのファイルだけを置き換える）
 * - 値の受け渡しは props のみ。DBにも復号にも触らない（公開側に混ざる余地を作らない）
 * - **画面は黒地×金のカード／印刷は白地**。黒を印刷するとインクを食い、車検場・買取店へ
 *   出す紙として読みづらいため、print では色を反転させる（globals.css の @media print と .no-print）
 * - 車台番号は既定でマスク（下3桁）。全桁は「印刷用の紙」と、明示的に開いたときだけ出す
 *   ＝画面のスクリーンショットが流れても車台番号が漏れない
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
  /** 検証用QRに入れるURL（共有URLの絶対パス）。無ければQRを出さない */
  verifyUrl?: string;
  /** qrSvg() で作ったSVG文字列（サーバー側で生成して渡す） */
  verifyQrSvg?: string;
  /** 車台番号を全桁表示する（既定はマスク。印刷用の紙・本部画面で使う） */
  revealVin?: boolean;
};

/** 車台番号のマスク: 末尾3桁だけ残す（例 ****-***728） */
export function maskVin(vin: string, last3: string): string {
  const tail = (vin || "").slice(-3) || last3;
  if (!tail) return "";
  const head = vin ? vin.slice(0, -3).replace(/[^-]/g, "*") : "****-***";
  return `${head}${tail}`;
}

/*
 * 1行。任意項目(optional)が空のときは行そのものを出さない
 * ＝お客様に渡す紙に「—」だけの行を並べない。
 * 法定記録簿モードでは記載事項の欠けが分かるよう空でも必ず出す。
 */
function Row({
  label,
  value,
  optional,
  always,
  mono,
}: SheetRow & { optional?: boolean; always?: boolean; mono?: boolean }) {
  if (!value && optional && !always) return null;
  return (
    <tr className="align-top">
      <th className="cert-key w-[34%] py-1.5 pr-2 text-left text-[11px] font-normal">{label}</th>
      <td className={`cert-val py-1.5 text-[12.5px] font-semibold ${mono ? "font-mono" : ""}`}>
        {value || "—"}
      </td>
    </tr>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="cert-section mt-3 mb-0.5 text-[10px] font-bold tracking-[0.12em]">{children}</h2>;
}

export function CertificateSheet(p: CertificateSheetProps) {
  const vinText = p.revealVin ? p.vehicle.vin : maskVin(p.vehicle.vin, p.vehicle.chassisLast3);
  const vinLabel = vinText || (p.vehicle.chassisLast3 ? `下3桁 ${p.vehicle.chassisLast3}` : "");
  // 車種表示にメーカー名が入っていることが多い（車検証の読み取り由来）。二重に出さない
  const vehicleLabel =
    p.vehicle.maker && p.vehicle.name.includes(p.vehicle.maker)
      ? p.vehicle.name
      : [p.vehicle.maker, p.vehicle.name].filter(Boolean).join(" ");

  return (
    <div className="cert-sheet mx-auto w-full max-w-[560px]">
      {/* 見出し: ブランド／証明書番号 */}
      <header className="cert-head flex items-center justify-between gap-3 pb-3">
        <div>
          <p className="cert-brand font-serif text-[20px] font-medium tracking-[0.05em]">mbPIT</p>
          <p className="cert-sub mt-0.5 text-[10.5px]">施工証明書 / Certificate of work</p>
        </div>
        <div className="text-right">
          <p className="cert-no font-mono text-[11.5px]">No. {p.certificateNo || "（未発行）"}</p>
          <p className="cert-sub mt-0.5 text-[10.5px]">発行 {p.issuedLabel || "（未発行）"}</p>
          <p className="cert-sub mt-0.5 text-[10.5px]">
            {p.typeLabel}
            {p.legalRecord && <span className="cert-badge ml-1">法定記録簿</span>}
            {p.statusLabel && <span className="cert-badge ml-1">{p.statusLabel}</span>}
          </p>
        </div>
      </header>

      {p.voided && (
        <p className="cert-void mt-2 px-3 py-2 text-[12px] font-semibold">
          この証明書は {p.voided.at} に無効化されています（理由: {p.voided.reason}）。
        </p>
      )}

      <SectionTitle>車両</SectionTitle>
      <table className="w-full border-collapse">
        <tbody>
          <Row label="車両" value={vehicleLabel} />
          <Row label="型式" value={p.vehicle.modelCode} optional always={p.legalRecord} />
          <Row label="車台番号" value={vinLabel} mono />
          <Row label="登録番号" value={p.vehicle.registrationNumber} optional always={p.legalRecord} />
          <Row label="初度登録年月" value={p.vehicle.firstRegistered} optional />
          <Row label="施工時走行距離" value={p.service.odometerKm} optional always={p.legalRecord} />
        </tbody>
      </table>

      <SectionTitle>施工内容</SectionTitle>
      <table className="w-full border-collapse">
        <tbody>
          <Row label="施工日" value={p.service.dateLabel} />
          <Row label="作業概要" value={p.service.workSummary} />
          {p.details.map((d) => (
            <Row key={d.label} label={d.label} value={d.value} />
          ))}
          <Row label="施工金額" value={p.service.totalAmount} optional />
          <Row label="再施工費用の目安" value={p.service.restorationCostEstimate} optional />
        </tbody>
      </table>

      <SectionTitle>施工店</SectionTitle>
      <table className="w-full border-collapse">
        <tbody>
          <Row label="施工店" value={p.store.name} />
          <Row label="所在地" value={p.store.address} optional />
          <Row label="連絡先" value={p.store.tel} optional />
          <Row label="認証番号" value={p.store.certificationNo} optional always={p.legalRecord} />
          <Row label="担当者" value={p.service.staffName} optional always={p.legalRecord} />
          <Row label="資格番号" value={p.service.staffLicenseNo} optional />
        </tbody>
      </table>

      <SectionTitle>依頼者</SectionTitle>
      <table className="w-full border-collapse">
        <tbody>
          <Row label="氏名または名称" value={p.customer.name} />
          <Row label="住所" value={p.customer.address} optional always={p.legalRecord} />
          <Row label="連絡先" value={p.customer.tel} optional />
        </tbody>
      </table>

      {/* 改ざん検証ハッシュ */}
      <div className="cert-hash mt-3 px-3 py-2">
        <p className="cert-sub text-[10px]">改ざん検証ハッシュ (SHA-256)</p>
        <p className="cert-no mt-0.5 break-all font-mono text-[10.5px]">{p.payloadHash || "（未発行）"}</p>
      </div>

      {/* 検証QR＋証紙 */}
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {p.verifyQrSvg ? (
            <span
              className="cert-qr block shrink-0"
              // qrSvg() が組み立てた固定形式のSVG（外部入力を埋め込まない）
              dangerouslySetInnerHTML={{ __html: p.verifyQrSvg }}
            />
          ) : null}
          <p className="cert-sub text-[10.5px] leading-relaxed">
            {p.verifyQrSvg ? (
              <>
                スキャンでこの証明書のページへ
                <br />
                内容とハッシュを誰でも確認できます
              </>
            ) : (
              <>発行するとこの欄に検証用QRが入ります</>
            )}
          </p>
        </div>
        <div className="cert-seal flex h-[62px] w-[62px] shrink-0 flex-col items-center justify-center rounded-full">
          <span className="cert-brand font-serif text-[12.5px] font-medium">mbPIT</span>
          <span className="cert-seal-sub text-[7.5px] tracking-[0.1em]">VERIFIED</span>
        </div>
      </div>

      <footer className="cert-foot mt-3 pt-2 text-[9.5px] leading-relaxed">
        <p>
          本書は上記の施工内容を施工店が記録したものです。車検の合否・保険金の支払い・査定額を保証するものではありません。
          内容の訂正が必要な場合は、この証明書を無効化して新しい証明書を発行します。
        </p>
        {p.verifyUrl && <p className="mt-1 break-all">{p.verifyUrl}</p>}
      </footer>
    </div>
  );
}
