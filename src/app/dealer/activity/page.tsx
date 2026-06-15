import { requireDealer } from "@/lib/authz";
import { PageTitle } from "@/components/ui";
import { ActivityFeed, getActivity } from "@/components/activity-feed";

export default async function DealerActivityPage() {
  const user = await requireDealer();
  const items = await getActivity(user.dealerId);
  return (
    <div>
      <PageTitle title="ダウンロード・リクエスト履歴" subtitle="自店の最近の履歴" />
      <ActivityFeed items={items} showDealer={false} />
    </div>
  );
}
