"use client";

import { useEffect } from "react";
import { markAnnouncementRead } from "@/lib/actions/announcements";

// 詳細表示時に一度だけ既読化する（描画中の書き込みを避けるためクライアントから実行）。
export function MarkRead({ announcementId }: { announcementId: string }) {
  useEffect(() => {
    markAnnouncementRead(announcementId).catch(() => {});
  }, [announcementId]);
  return null;
}
