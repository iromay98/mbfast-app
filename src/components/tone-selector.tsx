"use client";
import { useState, useTransition } from "react";
import { setMyWritingTone } from "@/lib/actions/pit";

/*
 * 記事・Googleマップ投稿の文体を店舗が選ぶ。
 * 例文を見せて選ばせる（「です・ます」等の名前だけでは違いが伝わらないため）。
 */
const TONES = [
  { value: "polite", label: "ていねい（です・ます）", example: "アクセルオフ時の心地よいサウンドに仕上がりました。" },
  { value: "casual", label: "親しみやすい（話し言葉）", example: "アクセルを抜いた瞬間のサウンド、めちゃくちゃ良い感じに仕上がったよ。" },
  { value: "formal", label: "論説調（だ・である）", example: "アクセルオフ時のサウンドは狙いどおりの仕上がりである。" },
] as const;

export function ToneSelector({ current }: { current: string }) {
  const [tone, setTone] = useState(current);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-soft">
        ブログ記事とGoogleマップ投稿の文体です。どれを選んでも、内容の清書（誤変換の修正・場所や個人情報の除去）は必ず行われます。
      </p>
      {TONES.map((t) => (
        <label
          key={t.value}
          className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 ${
            tone === t.value ? "border-gold-500 bg-gold-500/5" : "border-line"
          }`}
        >
          <input
            type="radio"
            name="tone"
            checked={tone === t.value}
            disabled={pending}
            onChange={() => {
              setTone(t.value);
              start(async () => {
                const r = await setMyWritingTone(t.value);
                setMsg(r.error ?? "保存しました。次の投稿から反映されます");
              });
            }}
            className="mt-1"
          />
          <span>
            <span className="block text-sm font-bold text-ink">{t.label}</span>
            <span className="block text-xs text-ink-soft">例: {t.example}</span>
          </span>
        </label>
      ))}
      {msg && <p className="text-xs text-gold-600">{msg}</p>}
    </div>
  );
}
