import { requireHQ } from "@/lib/authz";
import { PageTitle, LinkButton } from "@/components/ui";
import { createDealer } from "@/lib/actions/dealers";
import { DealerForm } from "../dealer-form";

export default async function NewDealerPage() {
  await requireHQ();
  return (
    <div>
      <PageTitle
        title="代理店の新規登録"
        action={
          <LinkButton href="/hq/dealers" variant="secondary">
            一覧へ戻る
          </LinkButton>
        }
      />
      <DealerForm action={createDealer} submitLabel="登録する" />
    </div>
  );
}
