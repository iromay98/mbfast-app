import { retryDecrypt } from "@/lib/actions/records";
import { Button } from "@/components/ui";

// FAILED の施工記録を再解析する（代理店=自店のみ / 本店=可。authz はアクション側で強制）。
export function RetryDecryptButton({ recordId }: { recordId: string }) {
  const action = retryDecrypt.bind(null, recordId);
  return (
    <form action={action}>
      <Button type="submit" variant="secondary">
        再解析する
      </Button>
    </form>
  );
}
