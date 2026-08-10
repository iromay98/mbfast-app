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
