"use client";

import { useMemo, useState } from "react";
import { ShowcaseEmbeds } from "@/components/showcase-embed";

export type ShowcaseEntry = {
  id: string;
  title: string;
  comment: string | null;
  carMaker: string;
  carModel: string;
  generation: string | null;
  grade: string | null;
  stage: string | null;
  contentLabel: string | null;
  embeds: unknown;
  coverImage: string | null;
  visibility: "PUBLIC" | "DEALER";
  publishedAtLabel: string;
};

function vehicleTitle(e: ShowcaseEntry): string {
  const gen = e.generation ? `(${e.generation})` : "";
  return `${e.carMaker} ${e.carModel}${gen}${e.grade ? ` ${e.grade}` : ""}`.trim();
}

// 車両でドリルダウンして事例を閲覧。メーカー → 車種 → 事例カード。
export function ShowcaseGallery({
  entries,
  showVisibilityBadge = false,
}: {
  entries: ShowcaseEntry[];
  showVisibilityBadge?: boolean;
}) {
  const [maker, setMaker] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);

  const makers = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.carMaker, (m.get(e.carMaker) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries]);

  const models = useMemo(() => {
    if (!maker) return [];
    const m = new Map<string, number>();
    for (const e of entries) {
      if (e.carMaker !== maker) continue;
      m.set(e.carModel, (m.get(e.carModel) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries, maker]);

  const shown = useMemo(
    () =>
      entries.filter(
        (e) => (!maker || e.carMaker === maker) && (!model || e.carModel === model),
      ),
    [entries, maker, model],
  );

  if (entries.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-ink-soft">
        まだ施工事例がありません。
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {/* パンくず */}
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <button
          type="button"
          onClick={() => {
            setMaker(null);
            setModel(null);
          }}
          className={`rounded-lg px-2.5 py-1 font-semibold ${
            !maker ? "bg-gold-500 text-white" : "text-gold-700 hover:bg-surface-2"
          }`}
        >
          すべての車両
        </button>
        {maker && (
          <>
            <span className="text-ink-soft">/</span>
            <button
              type="button"
              onClick={() => setModel(null)}
              className={`rounded-lg px-2.5 py-1 font-semibold ${
                !model ? "bg-gold-500 text-white" : "text-gold-700 hover:bg-surface-2"
              }`}
            >
              {maker}
            </button>
          </>
        )}
        {model && (
          <>
            <span className="text-ink-soft">/</span>
            <span className="rounded-lg bg-gold-500 px-2.5 py-1 font-semibold text-white">{model}</span>
          </>
        )}
      </div>

      {/* 選択チップ：メーカー→車種 */}
      {!maker ? (
        <div className="flex flex-wrap gap-2">
          {makers.map(([name, n]) => (
            <button
              key={name}
              type="button"
              onClick={() => setMaker(name)}
              className="rounded-full border border-line bg-white px-3.5 py-1.5 text-sm font-semibold text-ink hover:border-gold-300 hover:bg-gold-50"
            >
              {name}
              <span className="ml-1.5 text-xs text-ink-soft">{n}</span>
            </button>
          ))}
        </div>
      ) : !model ? (
        <div className="flex flex-wrap gap-2">
          {models.map(([name, n]) => (
            <button
              key={name}
              type="button"
              onClick={() => setModel(name)}
              className="rounded-full border border-line bg-white px-3.5 py-1.5 text-sm font-semibold text-ink hover:border-gold-300 hover:bg-gold-50"
            >
              {name}
              <span className="ml-1.5 text-xs text-ink-soft">{n}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* 事例カード */}
      <div className="grid gap-4 sm:grid-cols-2">
        {shown.map((e) => (
          <article key={e.id} className="overflow-hidden rounded-xl border border-line bg-surface">
            {e.coverImage && (
              // 自社撮影のみ想定。外部URLをそのまま表示。
              // eslint-disable-next-line @next/next/no-img-element
              <img src={e.coverImage} alt="" className="h-40 w-full object-cover" loading="lazy" />
            )}
            <div className="space-y-3 p-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold text-ink">{e.title}</h3>
                  {showVisibilityBadge && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        e.visibility === "PUBLIC"
                          ? "bg-green-100 text-green-700"
                          : "bg-sky-100 text-sky-700"
                      }`}
                    >
                      {e.visibility === "PUBLIC" ? "一般公開" : "代理店限定"}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                  <span className="font-semibold text-ink-soft">{vehicleTitle(e)}</span>
                  {(e.contentLabel || e.stage) && (
                    <span className="rounded bg-gold-50 px-1.5 py-0.5 font-semibold text-gold-700">
                      {e.contentLabel || e.stage}
                    </span>
                  )}
                  <span className="ml-auto">{e.publishedAtLabel}</span>
                </div>
              </div>

              {e.comment && (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{e.comment}</p>
              )}

              <ShowcaseEmbeds embeds={e.embeds} />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
