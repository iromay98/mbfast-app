"use client";

// マイカーページ入口: 車検証QRスキャン（またはナンバー手入力）→ cookie発行 → 履歴へ。
// 車検証QRの現物を持っていることが実質の認証（車検証は車内保管が原則）。

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShakenQrScanner, chassisFromQrText } from "@/components/shaken-qr-scanner";

export default function MycarEntry() {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const auth = async (qr: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mycar/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qr }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (data.ok) router.push("/mycar/history");
      else setError(data.error ?? "読み取りに失敗しました");
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#2A3342] bg-[#181D26] p-5">
        <p className="text-base font-extrabold leading-relaxed">
          車検証のQRをスキャンすると、
          <br />
          この車の施工履歴と証明書が見られます。
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-[#8B97A8]">
          どこの店で施工しても履歴がここに貯まっていく「クルマのお薬手帳」です。車台番号は暗号化され、平文では保存されません。
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => setScanning(true)}
          className="mt-4 w-full rounded-xl bg-[#E53935] py-3.5 text-sm font-extrabold text-white disabled:opacity-50"
        >
          📄 車検証のQRをスキャン
        </button>
      </div>

      <div className="rounded-2xl border border-[#2A3342] bg-[#181D26] p-5">
        <p className="text-xs font-bold text-[#8B97A8]">QRが読み取れない場合（車台番号を入力）</p>
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="例: ZC33S-123456"
          className="mt-2 w-full rounded-xl border border-[#2A3342] bg-[#1F2632] px-3 py-2.5 text-sm text-[#EDF1F7] placeholder:text-[#5b6673]"
        />
        <button
          type="button"
          disabled={busy || manual.trim().length < 6}
          onClick={() => auth(manual)}
          className="mt-2 w-full rounded-xl border border-[#2A3342] py-2.5 text-sm font-bold text-[#EDF1F7] disabled:opacity-40"
        >
          履歴を表示
        </button>
      </div>

      {error && <p className="text-center text-xs font-bold text-[#FF6659]">{error}</p>}
      {busy && <p className="text-center text-xs text-[#8B97A8]">確認中…</p>}

      {scanning && (
        <ShakenQrScanner
          onText={(text) => {
            if (chassisFromQrText(text)) {
              setScanning(false);
              void auth(text);
              return true;
            }
            return false;
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  );
}
