/*
 * 認証情報がソースに混ざっていないことの検査（CIで回す）。
 *
 *   npm run check:no-secrets
 *
 * 秘密はすべて環境変数から読む方針なので、値そのものの形をした文字列がコードに
 * 現れたら失敗させる。process.env 経由の参照は当然許す。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const TARGET_DIRS = ["src", "scripts", "prisma"];
const SKIP_DIRS = new Set(["node_modules", ".next", "generated", ".git"]);

// 値の「形」で検出する（環境変数名そのものは許可）
const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "Google OAuth クライアントID", re: /[0-9]{6,}-[a-z0-9]{16,}\.apps\.googleusercontent\.com/ },
  { name: "Google クライアントシークレット", re: /GOCSPX-[A-Za-z0-9_-]{10,}/ },
  { name: "Google リフレッシュトークン", re: /['"]1\/\/[A-Za-z0-9_-]{30,}['"]/ },
  { name: "Google アクセストークン", re: /ya29\.[A-Za-z0-9._-]{20,}/ },
  { name: "Anthropic APIキー", re: /sk-ant-[A-Za-z0-9-]{20,}/ },
  { name: "WordPress アプリケーションパスワード", re: /['"](?:[a-zA-Z0-9]{4} ){5}[a-zA-Z0-9]{4}['"]/ },
];

const files: string[] = [];
function walk(dir: string) {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|mts|js|mjs|json|sql|md)$/.test(e)) files.push(p);
  }
}
for (const d of TARGET_DIRS) walk(join(root, d));

let failed = 0;
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const { name, re } of PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    // このファイル自身の検出パターンは対象外
    if (relative(root, f) === "scripts/check-no-secrets.mts") continue;
    failed++;
    console.log(`✗ ${relative(root, f)}: ${name} らしい値が含まれています`);
  }
}

// .env がコミットされていないこと（秘密の最大の流出経路）
try {
  const tracked = execFileSync("git", ["ls-files", ".env", ".env.*"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s && s !== ".env.example");
  if (tracked.length > 0) {
    failed++;
    console.log(`✗ .env がGitに入っています: ${tracked.join(" / ")}`);
  }
} catch {
  /* gitが無い環境ではスキップ */
}

// GBPクライアントが env 以外から秘密を読んでいないことも見る
const gbp = readFileSync(join(root, "src/server/pit/gbp/client.ts"), "utf8");
if (!/process\.env\.GBP_CLIENT_SECRET/.test(gbp)) {
  failed++;
  console.log("✗ GBPクライアントが GBP_CLIENT_SECRET を環境変数から読んでいません");
}
if (/client_secret\s*[:=]\s*['"][^'"]{5,}['"]/.test(gbp)) {
  failed++;
  console.log("✗ GBPクライアントに client_secret の直書きらしい記述があります");
}

console.log(
  failed === 0
    ? `✅ ${files.length}ファイルを確認: 認証情報の直書きはありません`
    : `❌ ${failed}件の疑いがあります`,
);
process.exit(failed === 0 ? 0 : 1);
