/*
 * 施工動画の圧縮（サーバー側 ffmpeg）。
 *
 * なぜサーバー側か:
 * - ブラウザ内の動画圧縮（ffmpeg.wasm等）はスマホで数十MBの動画を扱うとメモリ不足・
 *   極端な遅さになり実用にならないため、受け取ってからサーバーで変換する。
 * - スマホの生動画は 1080p で毎分90MB前後ある。720p/H.264に落とすと1/8〜1/10になり、
 *   WordPress側の容量と再生の重さを同時に解決できる。
 *
 * 失敗時は必ず元データを返す（投稿自体は止めない）。ffmpeg未インストール環境でも動く。
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// これ以下は変換しない（すでに軽い＝再エンコードで画質を落とすだけ損）
const SKIP_UNDER_BYTES = 8 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 240_000;

let ffmpegAvailable: boolean | null = null;

async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  ffmpegAvailable = await new Promise<boolean>((resolve) => {
    const p = spawn("ffmpeg", ["-version"]);
    p.on("error", () => resolve(false));
    p.on("close", (code) => resolve(code === 0));
  });
  if (!ffmpegAvailable) console.warn("mbPIT: ffmpeg が見つからないため動画は無圧縮で公開します");
  return ffmpegAvailable;
}

export type VideoResult = {
  buffer: Buffer;
  mime: string;
  ext: string;
  compressed: boolean;
  originalBytes: number;
  bytes: number;
};

/**
 * 動画を720p/H.264(MP4)に圧縮する。返り値はWPへ上げるバッファ。
 * - 長辺1280pxに収める（縦動画も同様に短辺基準で潰れない）
 * - CRF28 veryfast: 施工動画の用途では十分な画質でサイズ優先
 * - faststart: ブラウザが先頭のメタデータだけで再生開始できる（体感が速い）
 */
export async function compressVideo(input: Buffer, mime: string): Promise<VideoResult> {
  const fallback: VideoResult = {
    buffer: input,
    mime: mime || "video/mp4",
    ext: { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" }[mime] ?? "mp4",
    compressed: false,
    originalBytes: input.length,
    bytes: input.length,
  };
  if (input.length <= SKIP_UNDER_BYTES) return fallback;
  if (!(await hasFfmpeg())) return fallback;

  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "mbpit-video-"));
    const src = join(dir, "in");
    const out = join(dir, "out.mp4");
    await writeFile(src, input);

    const args = [
      "-y",
      "-i",
      src,
      // 長辺1280に収める（拡大はしない）＋H.264が要求する偶数サイズに丸める
      "-vf",
      "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))',format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "28",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      out,
    ];

    const ok = await new Promise<boolean>((resolve) => {
      const p = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      p.stderr.on("data", (d: Buffer) => {
        stderr = (stderr + d.toString()).slice(-2000); // 失敗時の診断用に末尾だけ保持
      });
      const timer = setTimeout(() => {
        p.kill("SIGKILL");
        console.error("mbPIT: 動画圧縮がタイムアウトしました（無圧縮で続行）");
      }, FFMPEG_TIMEOUT_MS);
      p.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
      p.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) console.error(`mbPIT: 動画圧縮に失敗 (code=${code})`, stderr.slice(-500));
        resolve(code === 0);
      });
    });
    if (!ok) return fallback;

    const buf = await readFile(out);
    // 圧縮したのに大きくなった場合は元を使う（すでに最適化済みの動画など）
    if (buf.length >= input.length) return fallback;
    console.log(
      `mbPIT: 動画を圧縮 ${(input.length / 1024 / 1024).toFixed(1)}MB → ${(buf.length / 1024 / 1024).toFixed(1)}MB`,
    );
    return {
      buffer: buf,
      mime: "video/mp4",
      ext: "mp4",
      compressed: true,
      originalBytes: input.length,
      bytes: buf.length,
    };
  } catch (e) {
    console.error("mbPIT: 動画圧縮でエラー（無圧縮で続行）", e);
    return fallback;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
