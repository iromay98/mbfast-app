"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/*
 * 一覧 → 詳細 → 戻る で、**さっき見ていた位置**に戻す。
 *
 * なぜ必要か: 一覧の「戻る」は Link での通常遷移なので、Next.js はページ先頭から描画する。
 * 依頼が増えると毎回スクロールし直しになり、下の方の案件を順に開けない。
 *
 * やり方: この一覧のスクロール位置を sessionStorage に控え、戻ってきたときに復元する。
 * - キーは pathname + 検索条件（絞り込みが違えば別の一覧＝別の位置として扱う）
 * - sessionStorage なのでタブを閉じれば消える（端末に残さない）
 * - 復元は一度だけ。読み込み直後に位置が確定するまで数フレームかかるので、
 *   高さが足りない間は次のフレームで再試行する（ここを省くと先頭に張り付く）
 */
export function RestoreScroll({ storageKey }: { storageKey: string }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const key = `mbfast:scroll:${storageKey}:${pathname}?${sp.toString()}`;

  useEffect(() => {
    // ── 復元 ──
    const saved = Number(sessionStorage.getItem(key) ?? "0");
    if (saved > 0) {
      let tries = 0;
      const tick = () => {
        // まだ中身が短くて目的の位置まで伸びていないなら、次のフレームで再試行
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, Math.min(saved, Math.max(max, 0)));
        if (max < saved && tries++ < 20) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    // ── 保存 ──
    // スクロール中に毎回書くと重いので、フレームに1回だけまとめる
    let queued = false;
    const save = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        sessionStorage.setItem(key, String(Math.round(window.scrollY)));
      });
    };
    window.addEventListener("scroll", save, { passive: true });
    // 詳細へ遷移する瞬間（クリック）も確実に控える
    window.addEventListener("pointerdown", save, { passive: true, capture: true });
    return () => {
      window.removeEventListener("scroll", save);
      window.removeEventListener("pointerdown", save, { capture: true });
    };
  }, [key]);

  return null;
}
