/*
 * ファイルストレージ抽象化レイヤー。
 * MVP は VPS ローカルディスク（Web 公開ディレクトリの外）。
 * 将来 S3 互換へ差し替えられるよう、このインターフェースに依存させる。
 *
 * 重要: 保存キーは推測困難なランダム値。直接 URL で配信せず、
 * 必ず認可付きのルートハンドラ経由でのみ読み出す。
 */

export type StoredFile = {
  buffer: Buffer;
  contentType: string;
  size: number;
};

export interface StorageProvider {
  /** バイト列を保存する。key は呼び出し側が払い出した一意キー。 */
  save(key: string, data: Buffer, contentType: string): Promise<void>;
  /** 保存済みファイルを読み出す。存在しなければ null。 */
  read(key: string): Promise<StoredFile | null>;
  /** 削除（存在しなくてもエラーにしない）。 */
  delete(key: string): Promise<void>;

  // ── 大容量ファイル対応（分割アップロード・ストリーミング配信）。
  //    全部メモリに載せる read/save では動画サイズで死ぬため、以下を使う。

  /** サイズとcontentTypeだけ取得（本体は読まない）。存在しなければ null。 */
  stat(key: string): Promise<{ size: number; contentType: string } | null>;
  /** ストリーミング読み出し（配信用。メモリにファイル全体を載せない）。 */
  stream(key: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number; contentType: string } | null>;
  /** 末尾に追記（無ければ作成）。分割アップロードのチャンク受け用。 */
  append(key: string, data: Buffer): Promise<void>;
  /** 指定サイズに切り詰める（チャンク再送時の巻き戻し用）。 */
  truncate(key: string, size: number): Promise<void>;
  /** キーの移動（一時領域→本置き場。contentTypeも確定させる）。 */
  move(fromKey: string, toKey: string, contentType: string): Promise<void>;
  /** prefix配下で古いものを削除（未完了アップロードの掃除）。 */
  cleanup(prefix: string, olderThanMs: number): Promise<void>;
  /** ストレージの空きバイト数（取得できない実装は null）。 */
  freeBytes(): Promise<number | null>;
}
