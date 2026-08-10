/*
 * アップロード上限（クライアント側の事前検査用）。
 *
 * 実際の上限はサーバー側が権威（storage の MAX_UPLOAD_BYTES・env で上書き可）。
 * ここはフォームが「送信する前に」弾いて分かりやすいエラーを出すための値で、
 * サーバー既定と同じ 200MB に揃えている。上限を変えるときは
 * next.config.ts の serverActions.bodySizeLimit / proxyClientMaxBodySize と
 * docker-compose.prod.yml の MAX_UPLOAD_BYTES 既定も一緒に見直すこと
 * （サーバー上限の方が小さいと、事前検査を通ったのに送信で失敗する）。
 */
export const MAX_UPLOAD_MB = 200;
export const MAX_UPLOAD_BYTES_CLIENT = MAX_UPLOAD_MB * 1024 * 1024;

/*
 * 分割アップロード（案件チャットの大容量動画用）。
 * クライアントは CHUNK_SIZE_BYTES ずつ順番に送り、サーバーは一時領域に追記していく。
 * メモリはチャンク分しか使わないので上限を大きく取れるが、
 * - RecordMessage.fileSize が Int(32bit) のため 2GiB 以上は保存できない
 * - VPSのディスク空きにも限りがある（サーバー側で空き容量ガードあり）
 * ことから 2000MB を上限にしている。
 */
export const CHUNK_SIZE_BYTES = 5 * 1024 * 1024; // 5MB/チャンク
export const CHUNKED_MAX_MB = 2000;
export const CHUNKED_MAX_BYTES = CHUNKED_MAX_MB * 1024 * 1024;
/** これを超えるファイルは通常送信ではなく分割アップロードに切り替える */
export const CHUNKED_THRESHOLD_BYTES = 20 * 1024 * 1024;
