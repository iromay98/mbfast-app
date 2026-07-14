"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateBaseFile } from "@/lib/actions/catalog";
import { ChoiceSelect, TOOL_OPTIONS, METHOD_OPTIONS } from "@/app/hq/catalog/catalog-grid";

// 記録ページから、照合先純正(BaseFile)の読み取りツール/方式を確認・修正する。
// GT86のようにAutoTuner以外(Powergate3/Kess3等)で読んだ車の
// ファイル名トークン（AT→PG3等）をその場で直せる。
export function BaseToolEdit({
  baseFileId,
  tool,
  method,
}: {
  baseFileId: string;
  tool: string;
  method: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = (patch: Record<string, string>) =>
    start(async () => {
      setError(null);
      const r = await updateBaseFile(baseFileId, patch);
      if (r?.error) setError(r.error);
      router.refresh();
    });

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className="text-xs font-semibold text-ink-soft"
        title="読み取りツール（ファイル名のトークン。例 PG3_OBD_ori.bin）。修正はカタログにも反映されます。"
      >
        ツール
      </span>
      <ChoiceSelect
        value={tool}
        options={TOOL_OPTIONS}
        onSave={(v) => save({ tool: v })}
        addPrompt="ツール名（ファイル名に入る短い表記。例: KTAG）"
        className={pending ? "opacity-50" : ""}
      />
      <span className="text-xs text-ink-soft">Method</span>
      <ChoiceSelect
        value={method}
        options={METHOD_OPTIONS}
        onSave={(v) => save({ method: v })}
        addPrompt="読み方式（例: BDM）"
        className={pending ? "opacity-50" : ""}
      />
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
