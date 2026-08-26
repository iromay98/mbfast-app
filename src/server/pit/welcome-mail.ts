import nodemailer from "nodemailer";

/*
 * mbPIT 店舗開設の案内メール（代理店へ）。
 *
 * ブランド分離: 件名・本文・差出人表示は **mbPIT** のみ。mbFAST の名前は書かない
 * （mbPIT は別ブランドとして運用しているため。本文の文言を直すときも守ること）。
 *
 * 送信は「あれば送る」の保険的扱い＝失敗しても店舗開設（DB/WP）は成功扱いにする。
 * 環境変数: SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS（通知メールと共用）
 *           PIT_MAIL_FROM … mbPIT差出人（例 mbpit@mbfasttuning.com。未設定なら SMTP_FROM → SMTP_USER）
 */

export function pitMailEnabled(): boolean {
  return !!process.env.SMTP_HOST && !!(process.env.PIT_MAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER);
}

export type WelcomeMailInput = {
  to: string;
  storeName: string;
  storePageUrl: string;
  loginEmail: string | null; // 既存のログインアカウント（無ければ null＝別途発行の案内）
};

export function renderWelcomeMail(input: WelcomeMailInput): { subject: string; text: string } {
  const portal = (process.env.AUTH_URL ?? "https://portal.mbfasttuning.com").replace(/\/+$/, "");
  const login = input.loginEmail
    ? `ログイン: ${portal}/login （メール: ${input.loginEmail}。パスワードはお手元のものをそのままお使いください）`
    : `ログイン情報は別途ご案内します。`;
  const text = [
    `${input.storeName} ご担当者様`,
    "",
    "mbPIT（施工記録ポータル）に貴店のページを開設しました。",
    "",
    `店舗ページ: ${input.storePageUrl}`,
    login,
    "",
    "■ できること",
    "・作業の写真と数行のメモを投稿するだけで、施工記録の記事が自動で作成・公開されます",
    "・記事は貴店の店舗ページにまとまり、検索やAI検索の入口になります",
    "・お客様へ施工証明書を発行できます",
    "",
    "■ 最初にお願いしたいこと",
    "・アプリの「店舗情報を編集」から所在地・営業時間・連絡先をご記入ください（店舗ページに反映されます）",
    "・得意ジャンルは初期値として「チューニング（エンジン・駆動系）」を設定しています。追加のご希望はご連絡ください",
    "",
    "ご不明点はこのメールにご返信ください。",
    "",
    "— mbPIT 運営事務局",
  ].join("\n");
  return { subject: `[mbPIT] ${input.storeName} の店舗ページを開設しました`, text };
}

export async function sendPitWelcomeMail(input: WelcomeMailInput): Promise<boolean> {
  if (!pitMailEnabled()) return false;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
  });
  const from = process.env.PIT_MAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER;
  const { subject, text } = renderWelcomeMail(input);
  await transporter.sendMail({ from: `"mbPIT" <${from}>`, to: input.to, subject, text });
  return true;
}
