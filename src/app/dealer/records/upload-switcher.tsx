"use client";

import { useState } from "react";
import { SlaveUpload } from "./slave-upload";
import { MasterFileUpload } from "./master-upload";
import { Kess3SlaveUpload } from "./kess3-slave-upload";

// アップロード経路の切替。本部が許可した経路（Dealer.uploadTools）だけを出す。
//   AUTOTUNER   = AutoTunerスレーブ（自動復号・照合）
//   MASTER_BIN  = Kess3 Master等の生bin（自動照合・納品も生bin）
//   KESS3_SLAVE = Kess3 Slave（暗号化ファイル・本部手動対応）
// 1経路だけの店はタブを出さずそのフォームだけを表示する。
const CHANNELS = [
  { key: "AUTOTUNER", label: "AutoTuner（スレーブ）" },
  { key: "MASTER_BIN", label: "Kess3 Master等（生bin）" },
  { key: "KESS3_SLAVE", label: "Kess3 Slave" },
] as const;

type ChannelKey = (typeof CHANNELS)[number]["key"];

function ChannelForm({ channel }: { channel: ChannelKey }) {
  if (channel === "MASTER_BIN") return <MasterFileUpload />;
  if (channel === "KESS3_SLAVE") return <Kess3SlaveUpload />;
  return <SlaveUpload />;
}

export function UploadSwitcher({ tools }: { tools: string[] }) {
  const channels = CHANNELS.filter((c) => tools.includes(c.key));
  const [mode, setMode] = useState<ChannelKey>(channels[0]?.key ?? "AUTOTUNER");

  if (channels.length === 0) return null; // 経路未許可（本部の設定ミス）は何も出さない
  if (channels.length === 1) return <ChannelForm channel={channels[0].key} />;

  const active = channels.some((c) => c.key === mode) ? mode : channels[0].key;
  const tab = (isActive: boolean) =>
    `rounded-t-lg border border-b-0 px-3 py-1.5 text-xs font-bold ${
      isActive
        ? "border-line bg-surface text-ink"
        : "border-transparent bg-transparent text-ink-soft hover:text-ink"
    }`;

  return (
    <div>
      <div className="flex items-end gap-1 px-1">
        {channels.map((c) => (
          <button
            key={c.key}
            type="button"
            className={tab(active === c.key)}
            onClick={() => setMode(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <ChannelForm channel={active} />
    </div>
  );
}
