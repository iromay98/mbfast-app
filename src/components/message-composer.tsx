"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { postRecordMessage } from "@/lib/actions/messages";
import { emptyFormState } from "@/lib/actions/form-state";
import { Button, FormError } from "@/components/ui";

type Slot = "slave" | "file" | "camera";

// 案件メッセージの投稿（テキスト＋任意の添付）。
// 本店は2系統の添付を選べる:
//   ・slaveFile … この車用 .slave に自動暗号化して送る（焼けるテストファイル）
//   ・file/cameraFile … 自由ファイル or その場でカメラ撮影（写真・動画）。暗号化しない。
// 代理店は自由ファイル/カメラのみ。
export function MessageComposer({
  recordId,
  canEncrypt = false,
}: {
  recordId: string;
  canEncrypt?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    postRecordMessage.bind(null, recordId),
    emptyFormState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const slaveRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [picked, setPicked] = useState<{ slot: Slot; name: string } | null>(null);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setPicked(null);
      router.refresh();
    }
  }, [state, router]);

  // 1通=添付1点。あるスロットで選んだら他スロットはクリア。
  const onPick = (slot: Slot, input: HTMLInputElement | null) => {
    const f = input?.files?.[0];
    if (!f) return;
    if (slot !== "slave" && slaveRef.current) slaveRef.current.value = "";
    if (slot !== "file" && fileRef.current) fileRef.current.value = "";
    if (slot !== "camera" && cameraRef.current) cameraRef.current.value = "";
    setPicked({ slot, name: f.name });
  };
  const clearPick = () => {
    if (slaveRef.current) slaveRef.current.value = "";
    if (fileRef.current) fileRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
    setPicked(null);
  };

  const trigger =
    "inline-flex items-center gap-1 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-surface-2";

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <textarea
        name="body"
        rows={2}
        placeholder="メッセージ（質問・別リクエストなど）"
        className="block w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
      />

      {/* 添付トリガー */}
      <div className="flex flex-wrap items-center gap-2">
        {canEncrypt && (
          <button type="button" className={`${trigger} border-gold-300 text-gold-700`} onClick={() => slaveRef.current?.click()}>
            🔧 slave（.slaveに変換）
          </button>
        )}
        <button type="button" className={trigger} onClick={() => fileRef.current?.click()}>
          📎 ファイル
        </button>
        <button type="button" className={trigger} onClick={() => cameraRef.current?.click()}>
          📷 撮影（写真・動画）
        </button>
        <Button type="submit" disabled={pending} className="ml-auto">
          {pending ? "送信中…" : "送信"}
        </Button>
      </div>

      {/* 隠しファイル入力（名前で系統を区別。空のものはサーバ側で無視） */}
      {canEncrypt && (
        <input
          ref={slaveRef}
          type="file"
          name="slaveFile"
          accept=".bin,application/octet-stream"
          className="hidden"
          onChange={() => onPick("slave", slaveRef.current)}
        />
      )}
      <input
        ref={fileRef}
        type="file"
        name="file"
        className="hidden"
        onChange={() => onPick("file", fileRef.current)}
      />
      <input
        ref={cameraRef}
        type="file"
        name="cameraFile"
        accept="image/*,video/*"
        capture="environment"
        className="hidden"
        onChange={() => onPick("camera", cameraRef.current)}
      />

      {/* 選択中の添付 */}
      {picked && (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs">
          <span className="font-semibold text-ink">
            {picked.slot === "slave" ? "🔧 " : picked.slot === "camera" ? "📷 " : "📎 "}
            {picked.name}
          </span>
          {picked.slot === "slave" && (
            <span className="text-gold-700">→ .slave に変換して送信</span>
          )}
          <button type="button" onClick={clearPick} className="ml-auto text-ink-soft hover:text-red-600">
            ✕ 取消
          </button>
        </div>
      )}

      {/* slave のときファイル名に入れる内容（任意） */}
      {canEncrypt && picked?.slot === "slave" && (
        <label className="flex items-center gap-2 text-xs text-ink-soft">
          <span className="shrink-0">内容（任意）</span>
          <input
            type="text"
            name="content"
            placeholder="例: Stage1_Pops_AdBlue（ファイル名に入ります）"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 font-mono text-xs"
          />
        </label>
      )}

      <FormError message={state.error} />
    </form>
  );
}
