import nodemailer from "nodemailer";
import type { NotificationPayload } from "@/server/notifications";

/*
 * メール通知（保険チャネル）。
 * プッシュ通知の受信環境が整うまでの「当分の保険」として、全通知を本部の
 * 通知用アドレス(NOTIFY_EMAIL_TO)へも転送する。宛先が代理店の通知も本部へ送る
 * （本部が全体の動きを見逃さないため。代理店個別へのメール送信はしない）。
 *
 * 環境変数（未設定なら no-op）:
 *   SMTP_HOST / SMTP_PORT(既定587) / SMTP_USER / SMTP_PASS
 *   SMTP_FROM        送信元（既定 SMTP_USER）
 *   NOTIFY_EMAIL_TO  通知の宛先（例 saraya@ns-inc.jp。カンマ区切りで複数可）
 */

export function emailNotifyEnabled(): boolean {
  return !!process.env.SMTP_HOST && !!process.env.NOTIFY_EMAIL_TO;
}

/** SMTPが設定されているか。本部宛て通知(NOTIFY_EMAIL_TO)とは別に、
 *  加盟店本人への送信(store-email.ts)はこちらだけを条件にする。 */
export function smtpEnabled(): boolean {
  return !!process.env.SMTP_HOST;
}

let transporter: nodemailer.Transporter | null = null;
export function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465, // 465=SMTPS / 587=STARTTLS
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
        : undefined,
    });
  }
  return transporter;
}

export async function sendNotificationEmail(payload: NotificationPayload): Promise<void> {
  if (!emailNotifyEnabled()) return;
  const base = (process.env.AUTH_URL ?? "https://portal.mbfasttuning.com").replace(/\/+$/, "");
  const link = payload.link
    ? payload.link.startsWith("http")
      ? payload.link
      : `${base}${payload.link}`
    : null;
  const target = payload.dealerId == null ? "本店宛て" : `代理店宛て (${payload.dealerId})`;

  await getTransporter().sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to: process.env.NOTIFY_EMAIL_TO,
    subject: `[mbFAST] ${payload.title}`,
    text: [
      payload.message,
      "",
      `種別: ${payload.type} / ${target}`,
      ...(link ? [`リンク: ${link}`] : []),
      "",
      "— mbFAST ポータル自動通知（プッシュ通知の保険用メール）",
    ].join("\n"),
  });
}
