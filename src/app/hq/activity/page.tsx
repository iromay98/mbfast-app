import { requireHQ } from "@/lib/authz";
import { PageTitle } from "@/components/ui";
import { ActivityFeed, getActivity } from "@/components/activity-feed";

export default async function HQActivityPage() {
  await requireHQ();
  const items = await getActivity(null);
  return (
    <div>
      <PageTitle
        title="ダウンロード・リクエスト ログ"
        subtitle="全代理店の最近の履歴（最新200件）"
      />
      <ActivityFeed items={items} showDealer />
    </div>
  );
}
