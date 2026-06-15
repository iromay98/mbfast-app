"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteAnnouncement, deleteAllAnnouncements } from "@/lib/actions/announcements";

export function DeleteAnnouncementButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("このお知らせを削除しますか？")) return;
        start(async () => {
          await deleteAnnouncement(id);
          router.refresh();
        });
      }}
      className="shrink-0 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
    >
      {pending ? "…" : "削除"}
    </button>
  );
}

export function DeleteAllAnnouncementsButton() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("お知らせを全件削除します。元に戻せません。よろしいですか？")) return;
        start(async () => {
          await deleteAllAnnouncements();
          router.refresh();
        });
      }}
      className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
    >
      {pending ? "削除中…" : "すべて削除"}
    </button>
  );
}
