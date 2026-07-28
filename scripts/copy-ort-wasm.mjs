// onnxruntime-web のWASMを public/ort/ へコピー（build前に自動実行）。
// リポジトリにバイナリを持たず、インストール済みバージョンと常に一致させる。
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
const src = "node_modules/onnxruntime-web/dist";
const dst = "public/ort";
if (existsSync(src)) {
  mkdirSync(dst, { recursive: true });
  for (const f of ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"]) {
    try { copyFileSync(join(src, f), join(dst, f)); } catch {}
  }
  console.log("ort wasm copied to public/ort/");
}
