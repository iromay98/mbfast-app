/*
 * 加盟店への登録完了メールの文面を検査・プレビューする（送信はしない）。
 *
 *   npm run check:store-mail
 *
 * 目的は「事故の防止」に絞る。文言そのものの良し悪しは目視で確認する。
 */

import { buildWelcomeEmail } from "../src/lib/mail/store-welcome";

const SAMPLE = {
  to: "info@blaze-garage.jp",
  storeName: "Blaze Garage",
  contactName: "山田 太郎",
  slug: "blaze-garage",
};

let failed = 0;
const check = (ok: boolean, label: string) => {
  console.log(`  ${ok ? "OK" : "NG"}  ${label}`);
  if (!ok) failed++;
};

for (const approved of [true, false]) {
  const { subject, text } = buildWelcomeEmail({ ...SAMPLE, approved });
  console.log("=".repeat(66));
  console.log(`approved=${approved}  件名: ${subject}`);
  console.log("=".repeat(66));
  console.log(text);
  console.log();

  // 事故検査
  check(subject.length > 0 && subject.length <= 60, "件名が1〜60文字");
  check(text.includes(SAMPLE.to), "ログインIDが本文にある");
  check(text.includes("/login"), "ログインURLがある");
  check(text.includes(SAMPLE.storeName), "店舗名がある");
  check(text.includes(SAMPLE.contactName), "担当者名がある");
  check(
    approved ? text.includes(`/mbpit/${SAMPLE.slug}/`) : !text.includes(`/mbpit/${SAMPLE.slug}/`),
    approved ? "承認済みなら店舗ページURLを載せる" : "未承認なら存在しない店舗ページURLを載せない",
  );

  // パスワードの平文が混ざっていないこと（「設定されたもの」という説明だけが許される）
  const pwLines = text.split("\n").filter((l) => l.includes("パスワード"));
  const leaked = pwLines.filter((l) => !/(設定されたもの|記載しておりません)/.test(l));
  check(leaked.length === 0, `パスワードの平文が無い${leaked.length ? ` — ${leaked.join(" / ")}` : ""}`);

  // 未定義値の混入（テンプレートの埋め忘れ）
  check(!/undefined|null|\[object/.test(text), "未定義値が混ざっていない");
  console.log();
}

if (failed > 0) {
  console.error(`\n${failed} 件失敗しました。`);
  process.exit(1);
}
console.log("すべて通りました。");
