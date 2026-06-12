// 保存キー `prefix/<randomId>__<safeName>` から元のファイル名部分を取り出す
export function filenameFromKey(key: string): string {
  const base = key.split("/").pop() ?? key;
  const idx = base.indexOf("__");
  return idx >= 0 ? base.slice(idx + 2) : base;
}
