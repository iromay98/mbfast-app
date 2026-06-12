"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/components/ui";
import { createBaseFileManual } from "@/lib/actions/catalog";

export function ManualStockForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [f, setF] = useState({ manufacturer: "", model: "", ecu: "", mcu: "", stockHash: "" });
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));
  const ready = f.manufacturer.trim() && f.model.trim() && f.ecu.trim();
  const inp = "rounded-lg border border-line bg-surface px-2 py-1.5 text-sm";

  const submit = () => {
    const fd = new FormData();
    fd.set("manufacturer", f.manufacturer.trim());
    fd.set("model", f.model.trim());
    fd.set("ecu", f.ecu.trim());
    if (f.mcu.trim()) fd.set("mcu", f.mcu.trim());
    if (f.stockHash.trim()) fd.set("stockHash", f.stockHash.trim());
    const file = fileRef.current?.files?.[0];
    if (file) fd.set("file", file);
    startTransition(async () => {
      const res = await createBaseFileManual(fd);
      if (res?.error) {
        setMsg(res.error);
      } else {
        setMsg(null);
        setF({ manufacturer: "", model: "", ecu: "", mcu: "", stockHash: "" });
        setFileName("");
        if (fileRef.current) fileRef.current.value = "";
        setOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <div className="mb-4">
      <Button type="button" onClick={() => setOpen((o) => !o)}>
        {open ? "手動登録をとじる" : "＋ 純正を手動登録"}
      </Button>

      {open && (
        <Card className="mt-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <input className={inp} placeholder="メーカー *" value={f.manufacturer} onChange={set("manufacturer")} />
            <input className={inp} placeholder="車種 *" value={f.model} onChange={set("model")} />
            <input className={`${inp} font-mono`} placeholder="ECU *" value={f.ecu} onChange={set("ecu")} />
            <input className={inp} placeholder="MCU（任意）" value={f.mcu} onChange={set("mcu")} />
            <input
              className={`${inp} font-mono sm:col-span-2`}
              placeholder="stockHash（任意・原本を上げれば自動算出）"
              value={f.stockHash}
              onChange={set("stockHash")}
            />
          </div>

          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-surface-2"
            >
              原本ファイルを選択（任意）
            </button>
            <span className="text-xs text-ink-soft">{fileName || "未選択"}</span>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
            />
          </div>

          <p className="mt-2 text-xs text-ink-soft">
            ※ 原本を上げると SHA-256 を stockHash に確定します。手入力 stockHash
            は実機の復号hashと一致しないと自動照合に効かない場合があります。
          </p>

          {msg && <p className="mt-2 text-xs text-red-600">{msg}</p>}

          <div className="mt-3">
            <Button type="button" disabled={!ready || pending} onClick={submit}>
              {pending ? "登録中…" : "登録"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
