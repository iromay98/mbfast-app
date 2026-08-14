"use client";

// 購入導線の全体設定（送料・端末価格・為替）。価格表画面から開く。
// ここの値が、車両ページの「お申し込み」の金額計算に使われる。

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { OVERSEAS_REGIONS } from "@/lib/vehicle-pages/delivery";
import { updateShopSetting } from "@/lib/actions/vehicle-pages";

export type ShopSettingRow = {
  shippingDomesticJpy: number;
  shippingOverseasJpy: Record<string, number>;
  deviceAtOneJpy: number | null;
  deviceIxiJpy: number | null;
  mailInBaseFeeJpy: number | null;
  usdRate: number | null;
};

export function ShopSettings({ setting }: { setting: ShopSettingRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const [domestic, setDomestic] = useState(String(setting.shippingDomesticJpy || ""));
  const [overseas, setOverseas] = useState<Record<string, string>>(
    Object.fromEntries(OVERSEAS_REGIONS.map((r) => [r.key, String(setting.shippingOverseasJpy[r.key] ?? "")])),
  );
  const [atOne, setAtOne] = useState(String(setting.deviceAtOneJpy ?? ""));
  const [ixi, setIxi] = useState(String(setting.deviceIxiJpy ?? ""));
  const [mailIn, setMailIn] = useState(String(setting.mailInBaseFeeJpy ?? ""));
  const [rate, setRate] = useState(String(setting.usdRate ?? ""));

  const num = (v: string): number | null => {
    const n = Number(v.replace(/[^0-9]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-ink-soft underline underline-offset-2 hover:text-ink"
      >
        購入導線の設定（送料・端末価格）を編集
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">購入導線の設定</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-soft hover:underline">
          閉じる
        </button>
      </div>
      <p className="mb-3 text-[11px] text-ink-soft">
        車両ページの「お申し込み」で使う金額です。端末は買い切り・全額前払いの前提。全ブランド共通。
      </p>

      <div className="space-y-3">
        <Section title="端末価格（買い切り・税込）">
          <Field label="AT One">
            <MoneyInput value={atOne} onChange={setAtOne} />
          </Field>
          <Field label="IXI Flasher">
            <MoneyInput value={ixi} onChange={setIxi} />
          </Field>
        </Section>

        <Section title="送料（税込）">
          <Field label="国内一律">
            <MoneyInput value={domestic} onChange={setDomestic} />
          </Field>
          {OVERSEAS_REGIONS.map((r) => (
            <Field key={r.key} label={r.ja}>
              <MoneyInput
                value={overseas[r.key] ?? ""}
                onChange={(v) => setOverseas((o) => ({ ...o, [r.key]: v }))}
              />
            </Field>
          ))}
        </Section>

        <Section title="その他">
          <Field label="ECU郵送の基本工賃">
            <MoneyInput value={mailIn} onChange={setMailIn} />
          </Field>
          <Field label="為替（1USD=◯円）">
            <MoneyInput value={rate} onChange={setRate} placeholder="例: 150" />
          </Field>
        </Section>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await updateShopSetting({
                shippingDomesticJpy: num(domestic) ?? 0,
                shippingOverseasJpy: Object.fromEntries(
                  OVERSEAS_REGIONS.map((x) => [x.key, num(overseas[x.key] ?? "") ?? 0]).filter(([, v]) => (v as number) > 0),
                ) as Record<string, number>,
                deviceAtOneJpy: num(atOne),
                deviceIxiJpy: num(ixi),
                mailInBaseFeeJpy: num(mailIn),
                usdRate: num(rate),
              });
              setMsg(r.error ?? "保存しました");
              router.refresh();
            })
          }
        >
          {pending ? "保存中…" : "保存"}
        </Button>
        {msg && <span className="text-xs text-ink-soft">{msg}</span>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-line bg-surface-2 p-2">
      <p className="mb-1.5 text-[11px] font-semibold">{title}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

function MoneyInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      value={value}
      inputMode="numeric"
      placeholder={placeholder ?? "未設定"}
      onChange={(e) => onChange(e.target.value)}
      className="w-28 rounded border border-line px-2 py-1 text-right text-sm tabular-nums"
    />
  );
}
