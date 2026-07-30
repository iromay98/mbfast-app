/*
 * Googleビジネスプロフィールのリフレッシュトークンを1回だけ取得する補助ツール。
 *
 *   GBP_CLIENT_ID=... GBP_CLIENT_SECRET=... npx tsx scripts/gbp-auth.mts
 *
 * ブラウザが使える端末（Mac等）で実行する。ローカルの 127.0.0.1:53682 で認可コードを受け取る。
 * OAuthクライアントは「デスクトップアプリ」で作るとループバックのリダイレクトが使える
 * （ウェブアプリの場合は http://127.0.0.1:53682/callback を承認済みURIに追加する）。
 *
 * 取得した refresh_token は画面に出すだけで、ファイルにもリポジトリにも書かない。
 * 各自で .env と docker-compose.prod.yml の environment に追記すること。
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { GBP_SCOPE } from "../src/server/pit/gbp/client";

const clientId = (process.env.GBP_CLIENT_ID ?? "").trim();
const clientSecret = (process.env.GBP_CLIENT_SECRET ?? "").trim();
if (!clientId || !clientSecret) {
  console.log("GBP_CLIENT_ID と GBP_CLIENT_SECRET を環境変数で渡してください");
  process.exit(1);
}

const PORT = 53682;
const redirectUri = `http://127.0.0.1:${PORT}/callback`;
const state = randomBytes(16).toString("hex");

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GBP_SCOPE,
    access_type: "offline", // refresh_token を得るために必須
    prompt: "consent", // 再認可でも必ず refresh_token を返させる
    state,
  });

console.log("次のURLをブラウザで開き、mbFASTのGoogleアカウントで許可してください:");
console.log("");
console.log(authUrl);
console.log("");

const code = await new Promise<string>((resolve, reject) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    if (url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    const err = url.searchParams.get("error");
    const got = url.searchParams.get("code");
    const gotState = url.searchParams.get("state");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (err || !got || gotState !== state) {
      res.end("<p>認可に失敗しました。ターミナルを確認してください。</p>");
      server.close();
      reject(new Error(err ?? "認可コードを受け取れませんでした（stateが一致しない可能性）"));
      return;
    }
    res.end("<p>認可できました。ターミナルに戻ってください。</p>");
    server.close();
    resolve(got);
  });
  server.listen(PORT, "127.0.0.1");
});

const res = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  }),
});
const json = (await res.json()) as { refresh_token?: string; scope?: string; error_description?: string };
if (!res.ok || !json.refresh_token) {
  console.log("✗ トークンを取得できませんでした:", json.error_description ?? res.status);
  console.log("  prompt=consent と access_type=offline が付いているか、承認済みリダイレクトURIを確認してください");
  process.exit(1);
}
console.log("✅ 取得できました。scope:", json.scope);
console.log("");
console.log("GBP_REFRESH_TOKEN=" + json.refresh_token);
console.log("");
console.log("この値は .env（とVPSの docker-compose.prod.yml の environment）に自分で追記してください。");
console.log("チャットや共有ドキュメントに貼らないこと。オフラインで2箇所に控えを取ってください。");
