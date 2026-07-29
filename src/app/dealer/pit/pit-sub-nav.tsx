import Link from "next/link";

/*
 * 顧客タブ配下（顧客カルテ・車両登録・施工証明書）の行き来。
 * 下タブは4つに絞っているため、この3画面はここでしか行き来できない。
 * 特に「保存した下書き」に戻れないと作った証明書が迷子になるので、常に出す。
 */
const ITEMS = [
  { href: "/dealer/pit/customers", label: "顧客カルテ" },
  { href: "/dealer/pit/vehicles", label: "車両" },
  { href: "/dealer/pit/certificates", label: "施工証明書" },
] as const;

export function PitSubNav({
  current,
  /** 未発行（下書き・発行失敗）の件数。0なら出さない */
  unissued = 0,
}: {
  current: "customers" | "vehicles" | "certificates";
  unissued?: number;
}) {
  const key = (href: string) => href.split("/").pop();
  return (
    <div className="mb-2 flex gap-1.5 overflow-x-auto">
      {ITEMS.map((it) => {
        const active = key(it.href) === current;
        const showBadge = it.href.endsWith("/certificates") && unissued > 0;
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${
              active ? "bg-ink text-white" : "border border-line bg-surface text-ink-soft"
            }`}
          >
            {it.label}
            {showBadge && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                未発行{unissued}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
