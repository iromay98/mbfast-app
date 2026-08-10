"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { postRecordMessage } from "@/lib/actions/messages";
import { emptyFormState } from "@/lib/actions/form-state";
import {
  MAX_UPLOAD_MB,
  MAX_UPLOAD_BYTES_CLIENT,
  CHUNK_SIZE_BYTES,
  CHUNKED_MAX_MB,
  CHUNKED_MAX_BYTES,
  CHUNKED_THRESHOLD_BYTES,
} from "@/lib/upload-limits";
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
  ecuSides = [],
  primarySide = "左",
}: {
  recordId: string;
  canEncrypt?: boolean;
  // このECUが backup(フル読み書き) 対応か。true のとき slave変換で bak(フル) を選べる。
  backupSupported?: boolean;
  // 左右ECU車: 2基目側の一覧（bak変換の宛先選択に使う）。空なら従来どおり。
  ecuSides?: { id: string; side: string }[];
  primarySide?: string;
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
  const [picked, setPicked] = useState<{ slot: Slot; name: string; sizeMb: number } | null>(null);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [encryptMode, setEncryptMode] = useState<"maps" | "backup">("maps");
  // 分割アップロード（大容量動画）: 進捗% と、完了済みファイルのキー参照
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [uploaded, setUploaded] = useState<{ key: string; name: string } | null>(null);
  const uploading = uploadPct !== null && uploaded === null;

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setPicked(null);
      setEncryptMode("maps");
      setUploaded(null);
      setUploadPct(null);
      router.refresh();
    }
  }, [state, router]);

  // 分割アップロードが完了したら、キー参照つきで本送信（hidden inputがDOMに載ってから）
  useEffect(() => {
    if (uploaded) formRef.current?.requestSubmit();
  }, [uploaded]);

  // 1通=添付1点。あるスロットで選んだら他スロットはクリア。
  const onPick = (slot: Slot, input: HTMLInputElement | null) => {
    const f = input?.files?.[0];
    if (!f) return;
    // 上限超過は送信前にここで弾く（送信してから失敗すると、スマホ回線で数分待った
    // 挙げ句に原因不明のエラーになる。動画で実際に起きた）。
    // 自由添付は分割アップロードで送るため上限が大きい。slave変換は従来経路のまま。
    const limit = slot === "slave" ? MAX_UPLOAD_BYTES_CLIENT : CHUNKED_MAX_BYTES;
    const limitMb = slot === "slave" ? MAX_UPLOAD_MB : CHUNKED_MAX_MB;
    if (f.size > limit) {
      if (input) input.value = "";
      setSizeError(
        `「${f.name}」は ${Math.round(f.size / 1024 / 1024)}MB あり、上限 ${limitMb}MB を超えています。` +
          `動画は短く分けて撮るか、画質を下げて撮り直してください`,
      );
      return;
    }
    setSizeError(null);
    setUploaded(null);
    setUploadPct(null);
    if (slot !== "slave" && slaveRef.current) slaveRef.current.value = "";
    if (slot !== "file" && fileRef.current) fileRef.current.value = "";
    if (slot !== "camera" && cameraRef.current) cameraRef.current.value = "";
    setPicked({ slot, name: f.name, sizeMb: f.size / 1024 / 1024 });
  };
  const clearPick = () => {
    if (slaveRef.current) slaveRef.current.value = "";
    if (fileRef.current) fileRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
    setPicked(null);
    setSizeError(null);
    setUploaded(null);
    setUploadPct(null);
  };

  /*
   * 大容量ファイル（CHUNKED_THRESHOLD_BYTES 超）は Server Action に載せず、
   * 5MBずつの分割アップロードで先に送り切る。進捗%を表示し、チャンク単位で
   * 自動リトライ（最大4回・指数バックオフ）。完了したらキー参照で本送信する。
   */
  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    if (uploaded) return; // 分割アップロード完了後の本送信 → そのまま通す
    const input =
      picked?.slot === "file" ? fileRef.current : picked?.slot === "camera" ? cameraRef.current : null;
    const f = input?.files?.[0];
    if (!f || f.size <= CHUNKED_THRESHOLD_BYTES) return; // 小さいファイルは従来どおり
    e.preventDefault();
    setSizeError(null);
    setUploadPct(0);
    try {
      const initRes = await fetch(`/api/records/${recordId}/upload?op=init`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: f.name, size: f.size, type: f.type || "application/octet-stream" }),
      });
      const init = (await initRes.json().catch(() => ({}))) as { uploadId?: string; error?: string };
      if (!initRes.ok || !init.uploadId) throw new Error(init.error ?? "アップロードを開始できませんでした");

      const totalChunks = Math.ceil(f.size / CHUNK_SIZE_BYTES);
      let index = 0;
      while (index < totalChunks) {
        const blob = f.slice(index * CHUNK_SIZE_BYTES, Math.min((index + 1) * CHUNK_SIZE_BYTES, f.size));
        let attempt = 0;
        for (;;) {
          try {
            const r = await fetch(
              `/api/records/${recordId}/upload?op=chunk&uploadId=${init.uploadId}&index=${index}`,
              { method: "POST", body: blob },
            );
            const j = (await r.json().catch(() => ({}))) as { receivedBytes?: number; error?: string };
            if (r.ok) break;
            if (r.status === 409 && typeof j.receivedBytes === "number") {
              // サーバーの受信済み位置と食い違い → その位置のチャンクからやり直す
              index = Math.floor(j.receivedBytes / CHUNK_SIZE_BYTES) - 1;
              break;
            }
            throw new Error(j.error ?? `送信に失敗しました (${r.status})`);
          } catch (err) {
            attempt++;
            if (attempt >= 4) throw err instanceof Error ? err : new Error("送信に失敗しました");
            await new Promise((res) => setTimeout(res, 1000 * 2 ** (attempt - 1))); // 1s/2s/4s
          }
        }
        index++;
        setUploadPct(Math.min(99, Math.round((Math.min(index * CHUNK_SIZE_BYTES, f.size) / f.size) * 100)));
      }

      const compRes = await fetch(`/api/records/${recordId}/upload?op=complete&uploadId=${init.uploadId}`, {
        method: "POST",
      });
      const comp = (await compRes.json().catch(() => ({}))) as { key?: string; error?: string };
      if (!compRes.ok || !comp.key) throw new Error(comp.error ?? "アップロードの確定に失敗しました");

      // 本体は送信済みなので、Server Actionへはキー参照だけ渡す（巨大ファイルを二重送信しない）
      if (fileRef.current) fileRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
      setUploadPct(100);
      setUploaded({ key: comp.key, name: f.name }); // → useEffect が requestSubmit する
    } catch (err) {
      setUploadPct(null);
      setSizeError(
        `${err instanceof Error ? err.message : "アップロードに失敗しました"}（電波の良い場所でもう一度お試しください）`,
      );
    }
  };

  const trigger =
    "inline-flex items-center gap-1 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-surface-2";

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} className="space-y-2">
      {/* 分割アップロード完了後のキー参照（本体はもうサーバーにある） */}
      {uploaded && (
        <>
          <input type="hidden" name="uploadedKey" value={uploaded.key} />
          <input type="hidden" name="uploadedName" value={uploaded.name} />
        </>
      )}
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
        <Button type="submit" disabled={pending || uploading} className="ml-auto">
          {uploading ? `送信中… ${uploadPct}%` : pending ? "送信中…" : "送信"}
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
            <span className="ml-1 font-normal text-ink-soft">
              （{picked.sizeMb >= 1 ? Math.round(picked.sizeMb) : picked.sizeMb.toFixed(1)}MB
              {picked.sizeMb > 30 ? "・送信に時間がかかることがあります" : ""}）
            </span>
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
            {encryptMode === "backup" && ecuSides.length > 0 && (
              <select
                name="encryptSide"
                className="rounded-lg border border-line bg-white px-2 py-1 text-xs font-semibold"
                title="左右ECU車: bakをどちらのECU用に暗号化するか"
              >
                <option value="">{primarySide}（メイン）</option>
                {ecuSides.map((sd) => (
                  <option key={sd.id} value={sd.id}>
                    {sd.side}
                  </option>
                ))}
              </select>
            )}
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

      {/* 分割アップロードの進捗（大容量動画。チャンクごとに自動リトライ） */}
      {uploading && (
        <div className="space-y-1 rounded-lg border border-gold-200 bg-gold-50 px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-gold-800">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gold-500 border-t-transparent" />
            アップロード中… {uploadPct}%（画面を閉じずにお待ちください。電波が切れても自動で再開します）
          </div>
          <ProgressBar pct={uploadPct} />
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

      <FormError message={sizeError ?? state.error} />
    </form>
  );
}
