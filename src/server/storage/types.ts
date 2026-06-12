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
}
