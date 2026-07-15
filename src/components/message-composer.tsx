"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { postRecordMessage } from "@/lib/actions/messages";
import { emptyFormState } from "@/lib/actions/form-state";
import { Button, FormError } from "@/components/ui";
import { ProgressBar } from "@/components/slave-download-button";

type Slot = "slave" | "file" | "camera";

// 案件メッセージの投稿（テキスト＋任意の添付）。
// 本店は2系統の添付を選べる:
//   ・slaveFile … この車用 .slave に自動暗号化して送る（焼けるテストファイル）
//   ・file/cameraFile … 自由ファイル or その場でカメラ撮影（写真・動画）。暗号化しない。
// 代理店は自由ファイル/カメラのみ。
export function MessageComposer({
  recordId,
  canEncrypt = false,
  backupSupported = false,
}: {
  recordId: string;
  canEncrypt?: boolean;
  // このECUが backup(フル読み書き) 対応か。true のとき slave変換で bak(フル) を選べる。
  backupSupported?: boolean;
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
  const [encryptMode, setEncryptMode] = useState<"maps" | "backup">("maps");

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setPicked(null);
      setEncryptMode("maps");
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
          <button
            type="button"
            className={`${trigger} border-gold-300 text-gold-700`}
            onClick={() => {
              setEncryptMode("maps");
              slaveRef.current?.click();
            }}
          >
            🔧 slave（.slaveに変換）
          </button>
        )}
        {canEncrypt && (
          <button
            type="button"
            disabled={!backupSupported}
            title={
              backupSupported
                ? "フルバックアップbinを丸ごと暗号化して送信（マップスイッチ用・ファイル名に _bak）"
                : "このECUは backup(フル読み書き) に対応していません"
            }
            className={`${trigger} border-sky-300 text-sky-700 disabled:cursor-not-allowed disabled:opacity-40`}
            onClick={() => {
              setEncryptMode("backup");
              slaveRef.current?.click();
            }}
          >
            💾 bak（bakに変換）
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
          accept=".bin,.zip,application/octet-stream,application/zip"
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
            <span className={encryptMode === "backup" ? "text-sky-700" : "text-gold-700"}>
              {encryptMode === "backup"
                ? "→ bak（フル）を .slave に変換して送信"
                : "→ .slave に変換して送信"}
            </span>
          )}
          <button type="button" onClick={clearPick} className="ml-auto text-ink-soft hover:text-red-600">
            ✕ 取消
          </button>
        </div>
      )}

      {/* slave のとき: 変換の種類（マップ/bak）とファイル名に入れる内容（任意） */}
      {canEncrypt && picked?.slot === "slave" && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="shrink-0 font-semibold text-ink-soft">種類</span>
            {([
              ["maps", "マップのみ（通常）"],
              ["backup", "bak：フル（マップスイッチ用）"],
            ] as const).map(([v, label]) => {
              const disabled = v === "backup" && !backupSupported;
              return (
                <button
                  key={v}
                  type="button"
                  disabled={disabled}
                  onClick={() => setEncryptMode(v)}
                  title={
                    disabled
                      ? "このECUは backup(フル読み書き) に対応していません"
                      : v === "backup"
                        ? "フルバックアップbinを丸ごと暗号化（ファイル名に _bak が付きます）"
                        : undefined
                  }
                  className={`rounded-lg border px-2 py-1 font-semibold ${
                    encryptMode === v
                      ? v === "backup"
                        ? "border-sky-500 bg-sky-500 text-white"
                        : "border-gold-400 bg-gold-500 text-white"
                      : "border-line bg-white text-ink-soft hover:bg-surface-2"
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  {label}
                </button>
              );
            })}
            <input type="hidden" name="encryptMode" value={encryptMode} />
          </div>
          <label className="flex items-center gap-2 text-xs text-ink-soft">
            <span className="shrink-0">ファイル名（任意）</span>
            <input
              type="text"
              name="fileName"
              placeholder="例: RS3_st1_vmax（.slaveは自動付与・未入力は自動命名）"
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 font-mono text-xs"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-ink-soft">
            <span className="shrink-0">内容（任意）</span>
            <input
              type="text"
              name="content"
              placeholder="例: Stage1_Pops_AdBlue（自動命名のときファイル名に入ります）"
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 font-mono text-xs"
            />
          </label>
        </div>
      )}

      {/* 送信中の進捗（slave/bak はアップロード後に本部APIで暗号化するため時間がかかる） */}
      {pending && (
        <div className="space-y-1 rounded-lg border border-gold-200 bg-gold-50 px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-gold-800">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gold-500 border-t-transparent" />
            {picked?.slot === "slave"
              ? encryptMode === "backup"
                ? "アップロード中… → bak を暗号化しています（数十秒かかることがあります）"
                : "アップロード中… → .slave に暗号化しています（数十秒かかることがあります）"
              : "アップロード中…"}
          </div>
          <ProgressBar pct={null} />
        </div>
      )}

      <FormError message={state.error} />
    </form>
  );
}
