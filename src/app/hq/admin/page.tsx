import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageTitle, Card } from "@/components/ui";
import { ReextractPanel } from "./reextract-panel";
import { ArchivePanel, type ArchivedRecord, type ArchivedVariant } from "./archive-panel";
import { tuningContentLabel } from "@/lib/catalog/options";
import { swLabel } from "@/lib/catalog/sw";

function fmt(d: Date | null): string {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default async function HQAdminPage() {
  await requireHQ();

  // アーカイブ（ソフト削除）一覧
  const [delRecords, delVariants] = await Promise.all([
    prisma.serviceRecord.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      select: {
        id: true,
        carMaker: true,
        carModel: true,
        slaveName: true,
        customerName: true,
        deletedAt: true,
        dealer: { select: { name: true } },
      },
    }),
    prisma.tunedVariant.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      select: {
        id: true,
        stage: true,
        popsAndBangs: true,
        popsSport: true,
        optionTags: true,
        deletedAt: true,
        baseFile: {
          select: { manufacturer: true, model: true, calNumber: true, swNumber: true, swSeq: true },
        },
      },
    }),
  ]);

  const records: ArchivedRecord[] = delRecords.map((r) => ({
    id: r.id,
    title: `${r.carMaker ?? ""} ${r.carModel ?? ""}`.trim() || r.slaveName || r.id,
    sub: [r.dealer?.name, r.customerName, `削除 ${fmt(r.deletedAt)}`].filter(Boolean).join(" ・ "),
  }));

  const variants: ArchivedVariant[] = delVariants.map((v) => ({
    id: v.id,
    title:
      `${v.baseFile.manufacturer} ${v.baseFile.model} — ` +
      tuningContentLabel(v.stage, v.popsAndBangs, v.optionTags, v.popsSport),
    sub: [
      v.baseFile.calNumber ? `Cal ${v.baseFile.calNumber}` : null,
      v.baseFile.swNumber ? `SW ${swLabel(v.baseFile.swNumber, v.baseFile.swSeq)}` : null,
      `削除 ${fmt(v.deletedAt)}`,
    ]
      .filter(Boolean)
      .join(" ・ "),
  }));

  return (
    <div className="space-y-4">
      <PageTitle title="メンテナンス" subtitle="本店専用ツール" />

      <Card>
        <h3 className="mb-1 text-sm font-bold text-ink">
          アーカイブ（削除した記録・版の復元）
        </h3>
        <p className="mb-3 text-xs text-ink-soft">
          削除した施工記録・カタログの版はここにアーカイブされ、<b>いつでも「復元」</b>できます
          （ファイル・履歴も保持）。本当に消したいときだけ「完全削除」を使ってください。
        </p>
        <ArchivePanel records={records} variants={variants} />
      </Card>

      <Card>
        <h3 className="mb-1 text-sm font-bold text-ink">ECU識別子の再抽出（過去記録）</h3>
        <p className="mb-3 text-xs text-ink-soft">
          保存済みの復号ファイルから HW / SW / Cal を抽出し直します。
          <b>再アップロード・再復号は不要</b>で、AutoTuner のAPIも使いません。
          抽出ロジックを改善したあと、過去の記録へさかのぼって反映するために使います。
          まず「プレビュー」で変更点を確認してから「適用」してください。
          ※自動抽出で取れる項目は、手動入力した値も上書きされます。
        </p>
        <ReextractPanel />
      </Card>
    </div>
  );
}
