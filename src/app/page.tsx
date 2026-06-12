import { redirect } from "next/navigation";
import { requireUser } from "@/lib/authz";

export default async function RootPage() {
  const user = await requireUser();
  redirect(user.role === "HQ_ADMIN" ? "/hq" : "/dealer");
}
