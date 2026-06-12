import { requireDealer } from "@/lib/authz";
import { PageTitle, LinkButton } from "@/components/ui";
import { RequestForm } from "../request-form";

export default async function NewRequestPage() {
  await requireDealer();
  return (
    <div>
      <PageTitle
        title="本店への作業依頼"
        action={
          <LinkButton href="/dealer/requests" variant="secondary">
            一覧へ戻る
          </LinkButton>
        }
      />
      <RequestForm />
    </div>
  );
}
