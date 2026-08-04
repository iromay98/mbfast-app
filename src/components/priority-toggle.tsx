"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleRequestPriority } from "@/lib/actions/requests";

/*
 * 依頼の「重要」を1タップで切り替える。本店専用。
 *
 * 一覧の行の中に置くため、**行のリンクへ伝播させない**（クリックで詳細へ飛ばない）。
 * 押した瞬間に見た目を反映してから通信する（一覧で連続して押すため）。
 * 失敗したら見た目を元に戻す＝押したのに変わっていない状態を残さない。
 */
export function PriorityToggle({
  requestId,
  priority,
  size = "sm",
}: {
  requestId: string;
  priority: boolean;
  size?: "sm" | "md";
}) {
  const [on, setOn] = useState(priority);
  const [pending, start] = useTransition();
  const router = useRouter();

  const click = (e: React.MouseEvent) => {
    // 行全体がLinkのことがあるので、ここで止める
    e.preventDefault();
    e.stopPropagation();
    const next = !on;
    setOn(next);
    start(async () => {
      const res = await toggleRequestPriority(requestId, next);
      if (res.error) {
        setOn(!next); // 戻す
        return;
      }
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={click}
      disabled={pending}
      aria-pressed={on}
      title={on ? "重要を外す" : "重要にする（一覧の最上位に固定）"}
      className={`shrink-0 rounded-full leading-none transition disabled:opacity-50 ${
        size === "md" ? "px-2.5 py-1.5 text-base" : "px-1.5 py-1 text-sm"
      } ${
        on
          ? "bg-rose-100 text-rose-600 hover:bg-rose-200"
          : "text-ink-soft hover:bg-surface-2 hover:text-rose-500"
      }`}
    >
      {on ? "★" : "☆"}
      <span className="sr-only">{on ? "重要" : "重要にする"}</span>
    </button>
  );
}
