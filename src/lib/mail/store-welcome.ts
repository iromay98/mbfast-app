/*
 * 加盟店への登録完了メールの文面（純関数・外部依存なし）。
 *
 * 送信処理(src/server/notifications/store-email.ts)から切り離してあるのは、
 * nodemailer を読み込まずに文面だけを検査・プレビューできるようにするため。
 *   npm run check:store-mail
 *
 * パスワードは絶対に本文へ書かない（本人が設定した値であり、平文でメールに
 * 残すのは事故のもと）。伝えるのはログインIDと入口だけ。
 */

function baseUrl(): string {
  return (process.env.AUTH_URL ?? "https://portal.mbfasttuning.com").replace(/\/+$/, "");
}

/** 問い合わせ先（本文の末尾に出す） */
export function supportAddress(): string {
  return process.env.STORE_MAIL_SUPPORT ?? "sale@mbfasttuning.com";
}

export type WelcomeInput = {
  to: string;
  storeName: string;
  contactName: string;
  slug: string;
  /** WPカテゴリ作成まで完了して投稿可能か（false=本部の承認待ち） */
  approved: boolean;
};

/** 登録完了メールの本文を組み立てる（送信せずに中身を確認できるよう分離） */
export function buildWelcomeEmail(input: WelcomeInput): { subject: string; text: string } {
  const base = baseUrl();
  const subject = input.approved
    ? "【mbPIT】加盟店登録が完了しました"
    : "【mbPIT】加盟店登録を受け付けました（確認中）";

  const body = [
    `${input.storeName}`,
    `${input.contactName} 様`,
    "",
    "mbPITへのご登録ありがとうございます。",
    "",
    input.approved
      ? "登録が完了し、すぐに施工記録の投稿を始めていただけます。"
      : "登録を受け付けました。本部で確認のうえ、投稿機能を有効化します。有効化までしばらくお待ちください。",
    "",
    "───────────────",
    "■ ログイン情報",
    "───────────────",
    `ログインID: ${input.to}`,
    "パスワード: ご登録時にお客様が設定されたもの",
    "",
    "※ パスワードはセキュリティのためメールに記載しておりません。",
    `ログイン: ${base}/login`,
    "",
    ...(input.approved
      ? [
          "───────────────",
          "■ 店舗ページ",
          "───────────────",
          `https://mbfasttuning.com/mbpit/${input.slug}/`,
          "",
          "※ 投稿された施工記録がこのページに掲載されます。",
          "　 公開まで数分かかる場合があります。",
          "",
        ]
      : []),
    "───────────────",
    "■ まず行っていただきたいこと",
    "───────────────",
    "1. ログインし、店舗情報（住所・営業時間・連絡先・GoogleマップURL）を登録",
    "2. 対応ジャンルを選択（掲載ページの検索に使われます）",
    "3. 施工記録を1件投稿してみる（写真と作業内容だけで記事になります）",
    "",
    "───────────────",
    "■ スマートフォンでアプリのように使う",
    "───────────────",
    "ログイン後、ホーム画面に追加すると毎回アプリのように開けます。",
    "（アプリストアからのインストールは不要です）",
    "  iPhone : Safariの共有ボタン →「ホーム画面に追加」",
    "  Android: Chromeのメニュー（⋮）→「アプリをインストール」",
    "",
    "ご不明な点がありましたら、このメールにご返信いただくか、",
    `${supportAddress()} までお問い合わせください。`,
    "",
    "──────────────────────────────",
    "mbPIT（運営: 株式会社N's ／ mbFAST Tuning）",
    "東京都渋谷区宇田川町11-2 のこブランドハウス2F",
    `${base}`,
    "──────────────────────────────",
  ];

  return { subject, text: body.join("\n") };
}
