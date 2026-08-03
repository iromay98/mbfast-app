/*
 * コードが読む環境変数が、docker-compose.prod.yml の environment: に載っているか検査する。
 *
 * なぜ必要か: compose の environment: は**許可リスト**で、ここに無い変数は
 * .env に書いてもコンテナに渡らない。しかもアプリは「未設定」として静かに動くだけなので、
 * 画面を見ても気づけない。実際に GBP_* が丸ごと抜けていて、本番では接続すらできなかった。
 *
 * 判定: src/ と scripts/ の process.env.X / process.env["X"] を集め、
 *       compose の environment: のキーに無いものを落とす。
 *
 * 対象外（EXEMPT）: ビルド時・ローカル専用・Node/Nextが自前で入れるもの。
 * 増やすときは**理由をコメントで書く**（黙って除外を増やすと検査が形骸化する）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const COMPOSE = join(ROOT, "docker-compose.prod.yml");

const EXEMPT = new Set([
  "NODE_ENV", // Nextが入れる
  "TZ", // composeで別に指定済み（app/postgres/caddy 各サービス）
  "npm_lifecycle_event", // npm が入れる
  "CI", // Actions が入れる
  "PORT", // Next の既定3000で運用。composeで固定しない
  "HOSTNAME", // Next/Docker が入れる
  "PWD", // シェル
  "HOME", // シェル
  // ローカル/CI専用のツールが読むもの（本番コンテナでは使わない）
  "PGDATA",
  "PGHOST",
  "PGPORT",
  "PGUSER",
  "PGPASSWORD",
  "PGDATABASE",
  "DOTENV_CONFIG_PATH",
  "NEXT_RUNTIME", // Next自身が入れる（instrumentation.ts が nodejs/edge を判定するため）
  // PII_ENC_KEYS（複数鍵・ローテ対応）が現行。PII_ENC_KEY は単一鍵の後方互換読みだけで、
  // 新規に設定することはない。現行の方は compose に載っている。
  "PII_ENC_KEY",
]);

function files(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === "generated" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx|mts|mjs)$/.test(e)) out.push(p);
  }
  return out;
}

// compose の environment: に並ぶキーを集める（サービスを問わず全部）
const composeSrc = readFileSync(COMPOSE, "utf-8");
const allowed = new Set<string>();
for (const m of composeSrc.matchAll(/^\s{6}([A-Z][A-Z0-9_]*):/gm)) allowed.add(m[1]);
// "${FOO:-}" のように参照しているだけのものも、composeが解決するので通っている扱い
for (const m of composeSrc.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)) allowed.add(m[1]);

const used = new Map<string, string[]>();
for (const f of [...files(join(ROOT, "src")), ...files(join(ROOT, "scripts"))]) {
  const rel = f.slice(ROOT.length + 1);
  // この検査自身は process.env の正規表現を文字列として持つので、自分を読むと誤検出する
  if (rel === join("scripts", "check-env-allowlist.mts")) continue;
  const src = readFileSync(f, "utf-8");
  for (const m of src.matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*"([A-Z][A-Z0-9_]*)"\s*\])/g)) {
    const key = m[1] ?? m[2];
    if (!key || EXEMPT.has(key)) continue;
    const list = used.get(key) ?? [];
    if (!list.includes(rel)) list.push(rel);
    used.set(key, list);
  }
}

const missing = [...used.entries()].filter(([k]) => !allowed.has(k)).sort();

console.log(`コードが読む環境変数: ${used.size}件 / composeの許可リスト: ${allowed.size}件`);
console.log("");
if (missing.length === 0) {
  console.log("全てcomposeのenvironment:に載っています（.envに書けばコンテナに届きます）");
  process.exit(0);
}
console.error("docker-compose.prod.yml の environment: に無い環境変数があります。");
console.error(".env に書いてもコンテナに渡らないため、静かに未設定として動作します。");
console.error("");
for (const [k, where] of missing) {
  console.error(`  ❌ ${k}`);
  for (const w of where.slice(0, 4)) console.error(`       ${w}`);
  if (where.length > 4) console.error(`       … 他${where.length - 4}ファイル`);
}
console.error("");
console.error("compose に追加するか、本番で使わないものは scripts/check-env-allowlist.mts の EXEMPT に理由付きで入れてください。");
process.exit(1);
