/*
 * 加盟店“本人”へのメール送信。
 *
 * これまでメールは本部への通知転送(email.ts)しか無く、登録した店舗には
 * 1通も届いていなかった。自分でパスワードを決める方式のため画面には
 * 認証情報が出ず、店側は「登録できたのか分からない」状態になっていた。
 *
 * 方針:
 * - パスワードは絶対に本文へ書かない（本人が設定した値であり、メールに
 *   平文で残すのは事故のもと）。ログインIDと入口だけを伝える。
 * - SMTP_HOST が無ければ no-op。ただし本番で未設定のまま気づかないのを
 *   避けるため、送れなかったことを警告ログに残す。
 * - 送信失敗で登録処理を止めない（店舗の登録自体は成立させる）。
 */

import { getTransporter, smtpEnabled } from "@/server/notifications/email";
import { buildWelcomeEmail, supportAddress, type WelcomeInput } from "@/lib/mail/store-welcome";

export { buildWelcomeEmail, type WelcomeInput };

/** 送信元。加盟店から見て自然な差出人にする（本部の通知用とは別に指定可能） */
function fromAddress(): string | undefined {
  return process.env.STORE_MAIL_FROM ?? process.env.SMTP_FROM ?? process.env.SMTP_USER;
}

/** 登録完了メールを加盟店本人へ送る。失敗しても例外は投げない */
export async function sendStoreWelcomeEmail(input: WelcomeInput): Promise<{ sent: boolean; error?: string }> {
  if (!smtpEnabled()) {
    console.warn(
      `mbPIT: SMTP未設定のため加盟店への登録完了メールを送信できませんでした（宛先: ${input.to} / 店舗: ${input.storeName}）。` +
        " SMTP_HOST を設定してください。",
    );
    return { sent: false, error: "SMTP未設定" };
  }
  const { subject, text } = buildWelcomeEmail(input);
  try {
    await getTransporter().sendMail({
      from: fromAddress(),
      to: input.to,
      replyTo: supportAddress(),
      subject,
      text,
    });
    return { sent: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`mbPIT: 加盟店への登録完了メール送信に失敗しました（宛先: ${input.to}）`, e);
    return { sent: false, error: msg };
  }
}
