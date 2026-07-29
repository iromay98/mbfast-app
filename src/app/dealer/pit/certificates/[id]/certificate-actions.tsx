"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import {
  publishCertificate,
  toggleCertificateShare,
  reviseCertificate,
} from "@/lib/actions/pit-certificates";

/*
 * 証明書の操作（発行・共有・訂正・印刷）。
 * 発行は内容を固定する操作なので確認を挟む。訂正は元を無効化して新しい下書きを作る。
 */
export function CertificateActions({
  certificateId,
  status,
  shareUrl,
  shareRevoked,
  warrantyUntil,
  warnings,
}: {
  certificateId: string;
  status: string;
  shareUrl: string | null;
  shareRevoked: boolean;
  warrantyUntil: string;
  warnings: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [warranty, setWarranty] = useState(warrantyUntil);
  const [revising, setRevising] = useState(false);
  const [reason, setReason] = useState("");

  const fullUrl = shareUrl ? `${typeof window === "undefined" ? "" : window.location.origin}${shareUrl}` : "";

  const issue = async () => {
    if (!window.confirm("発行すると内容は変更できなくなります（訂正は再発行になります）。発行しますか？")) return;
    setBusy(true);
    setError(null);
    try {
      const r = await publishCertificate(certificateId, warranty);
      if (r.error) setError(r.error);
      else router.refresh();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  const share = async (revoked: boolean) => {
    setBusy(true);
    try {
      const r = await toggleCertificateShare(certificateId, revoked);
      if (r.error) setError(r.error);
      else router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const revise = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await reviseCertificate(certificateId, reason);
      if (r.error) setError(r.error);
      else router.push(`/dealer/pit/certificates/${r.certificateId}/edit`);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("コピーできませんでした。URLを長押しして選択してください");
    }
  };

  return (
    <div className="no-print space-y-3">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
      {warnings.length > 0 && (
        <ul className="rounded-lg bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-900">
          {warnings.map((w) => (
            <li key={w} className="list-disc">
              {w}
            </li>
          ))}
        </ul>
      )}

      {(status === "draft" || status === "failed") && (
        <Card className="border-gold-300">
          <h3 className="text-sm font-bold text-ink">内容を確認して発行</h3>
          <p className="mt-1 text-xs text-ink-soft">
            発行すると証明書番号とハッシュが確定し、内容は変更できなくなります。
          </p>
          <label className="mt-2 block text-[11px] font-semibold text-ink-soft">
            保証満了日（保証がある施工のみ・保存期間の判定に使います）
            <input
              type="date"
              value={warranty}
              onChange={(e) => setWarranty(e.target.value)}
              className="mt-0.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink"
            />
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={issue}
              className="rounded-lg bg-gold-500 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy ? "発行中…" : "この内容で発行"}
            </button>
            <Link
              href={`/dealer/pit/certificates/${certificateId}/edit`}
              className="rounded-lg border border-line px-3 py-2.5 text-sm font-semibold text-ink"
            >
              内容を修正
            </Link>
          </div>
        </Card>
      )}

      {status === "issued" && (
        <Card>
          <h3 className="text-sm font-bold text-ink">お客様へ渡す</h3>
          {shareRevoked ? (
            <p className="mt-1 text-xs font-semibold text-red-600">
              共有リンクは停止中です。お客様は閲覧できません。
            </p>
          ) : (
            <>
              <p className="mt-1 break-all rounded-lg bg-surface-2 px-3 py-2 text-[11px] font-semibold text-ink">
                {fullUrl}
              </p>
              <p className="mt-1 text-[11px] text-ink-soft">
                LINE・メールでこのURLを送ってください。ログインは不要です。
              </p>
            </>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!shareRevoked && (
              <button
                type="button"
                onClick={copy}
                className="rounded-lg bg-gold-500 px-4 py-2.5 text-sm font-bold text-white"
              >
                {copied ? "コピーしました" : "URLをコピー"}
              </button>
            )}
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-lg border border-line px-3 py-2.5 text-sm font-semibold text-ink"
            >
              印刷 / PDFで保存
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => share(!shareRevoked)}
              className="text-sm text-ink-soft hover:underline"
            >
              {shareRevoked ? "共有を再開" : "共有を停止"}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-ink-soft">
            印刷ダイアログで「PDFとして保存」を選ぶと控えが作れます。紙で交付する場合はそのまま印刷してください。
          </p>
        </Card>
      )}

      {(status === "issued" || status === "voided") && (
        <Card>
          <h3 className="text-sm font-bold text-ink">内容を訂正する</h3>
          <p className="mt-1 text-xs text-ink-soft">
            発行済みの証明書は書き換えません。この証明書を無効にして、内容を引き継いだ新しい証明書を作ります。
          </p>
          {revising ? (
            <>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="訂正の理由（例: 走行距離の入力誤り）"
                className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy || !reason.trim()}
                  onClick={revise}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  無効化して訂正版を作る
                </button>
                <button type="button" onClick={() => setRevising(false)} className="text-sm text-ink-soft hover:underline">
                  やめる
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setRevising(true)}
              className="mt-2 text-sm font-semibold text-red-600 hover:underline"
            >
              訂正する
            </button>
          )}
        </Card>
      )}
    </div>
  );
}
