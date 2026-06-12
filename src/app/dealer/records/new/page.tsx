import { requireDealer } from "@/lib/authz";
import { PageTitle, LinkButton } from "@/components/ui";
import { RecordForm } from "../record-form";

export default async function NewRecordPage() {
  await requireDealer();
  // 施工日のデフォルト＝今日（YYYY-MM-DD）
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
  }).format(new Date());

  return (
    <div>
      <PageTitle
        title="施工記録の登録"
        action={
          <LinkButton href="/dealer/records" variant="secondary">
            一覧へ戻る
          </LinkButton>
        }
      />
      <RecordForm today={today} />
    </div>
  );
}
