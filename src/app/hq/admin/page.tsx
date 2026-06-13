import { requireHQ } from "@/lib/authz";
import { PageTitle, Card } from "@/components/ui";
import { ReextractPanel } from "./reextract-panel";

export default async function HQAdminPage() {
  await requireHQ();
  return (
    <div className="space-y-4">
      <PageTitle title="メンテナンス" subtitle="本店専用ツール" />
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
