"use client";

/*
 * 施工証明書の体裁・記載範囲と、AI記事の公開前確認の設定フォーム。
 * 加盟店（/dealer/pit/store）と本部（/hq/pit の店舗ごと）で同じものを使う
 * ＝どちらから設定しても同じ結果になる（画面ごとに項目がズレない）。
 *
 * 本部が使うときだけ storeId を渡す。加盟店は渡さない（サーバー側で自店に固定される）。
 */

import { useState, useTransition } from "react";
import { updateCertSettings } from "@/lib/actions/pit-cert-settings";

export type CertSettingsValue = {
  certBrandName: string;
  certShowCustomerName: boolean;
  certShowCustomerAddress: boolean;
  certShowCustomerTel: boolean;
  certShowAmount: boolean;
  postReviewRequired: boolean;
};

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2.5 py-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0"
      />
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function CertSettingsEditor({
  storeId,
  storeName,
  legalFacility,
  initial,
}: {
  /** 本部のみ渡す（加盟店は undefined） */
  storeId?: string;
  storeName: string;
  /** 認証工場・指定工場（法定記録簿モード）か。氏名・住所のOFFが効かない旨を出す */
  legalFacility: boolean;
  initial: CertSettingsValue;
}) {
  const [v, setV] = useState<CertSettingsValue>(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [legalNote, setLegalNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const set = <K extends keyof CertSettingsValue>(k: K, val: CertSettingsValue[K]) =>
    setV((prev) => ({ ...prev, [k]: val }));

  const save = () =>
    start(async () => {
      setMsg(null);
      setErr(null);
      setLegalNote(null);
      const r = await updateCertSettings({ storeId, ...v });
      if (r.error) setErr(r.error);
      else {
        setMsg("保存しました");
        if (r.noticeLegal) setLegalNote(r.noticeLegal);
      }
    });

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-semibold" htmlFor="certBrandName">
          証明書に出すブランド名
        </label>
        <p className="mt-0.5 text-xs text-muted">
          証明書の左上に印字されます。<strong>会社名ではなくブランド名</strong>（お客様に見せている名前）を入れてください。
          空欄なら店舗名「{storeName}」を使います。右下の「mbPIT VERIFIED」の証紙は共通で入ります。
        </p>
        <input
          id="certBrandName"
          type="text"
          value={v.certBrandName}
          onChange={(e) => set("certBrandName", e.target.value)}
          maxLength={40}
          placeholder={storeName}
          className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
        />
      </div>

      <div className="rounded-lg border border-line p-3">
        <p className="text-sm font-bold">証明書に載せる内容</p>
        <p className="mt-0.5 text-xs text-muted">
          お客様へ渡す証明書・共有ページの表示を切り替えます。
          <strong>外しても記録は消えません</strong>（保存義務があるため控えとしては残り、CSVエクスポートにも出ます）。
        </p>
        <div className="mt-1 divide-y divide-line">
          <Toggle
            label="依頼者の氏名または名称"
            checked={v.certShowCustomerName}
            onChange={(x) => set("certShowCustomerName", x)}
          />
          <Toggle
            label="依頼者の住所"
            checked={v.certShowCustomerAddress}
            onChange={(x) => set("certShowCustomerAddress", x)}
          />
          <Toggle
            label="依頼者の連絡先"
            checked={v.certShowCustomerTel}
            onChange={(x) => set("certShowCustomerTel", x)}
          />
          <Toggle
            label="施工金額・再施工費用の目安"
            checked={v.certShowAmount}
            onChange={(x) => set("certShowAmount", x)}
          />
        </div>
        {legalFacility && (
          <p className="mt-2 rounded-md bg-gold-50 px-2.5 py-2 text-xs text-ink">
            この店舗は<strong>認証工場・指定工場</strong>の設定です。法定記録簿として出す証明書では、
            依頼者の氏名・住所は法令上の必須記載事項のため、OFFにしても表示されます
            （記載が欠けると記録として成立しないため）。それ以外の証明書では設定どおり非表示になります。
          </p>
        )}
        <p className="mt-2 text-xs text-muted">
          なお公開ブログには、この設定に関係なく氏名・住所・連絡先・金額・車台番号は
          <strong>一切出ません</strong>（別の仕組みで固定されています）。
        </p>
      </div>

      <div className="rounded-lg border border-line p-3">
        <p className="text-sm font-bold">AI記事の公開前確認</p>
        <Toggle
          label="公開する前に内容を確認する"
          hint="ONにすると、AIが書いた記事をブログに公開せずいったん止めます。投稿一覧で本文を読んでから「公開する」を押すと公開されます。OFFなら今までどおり、書けたらそのまま公開します。"
          checked={v.postReviewRequired}
          onChange={(x) => set("postReviewRequired", x)}
        />
      </div>

      {err && <p className="text-sm font-semibold text-red-600">{err}</p>}
      {msg && <p className="text-sm font-semibold text-green-700">{msg}</p>}
      {legalNote && (
        <p className="rounded-md bg-gold-50 px-2.5 py-2 text-xs text-ink">{legalNote}</p>
      )}

      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
      >
        {pending ? "保存中…" : "この設定を保存"}
      </button>
    </div>
  );
}
