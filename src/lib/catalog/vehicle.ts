// 車両の表示名を組み立てる。例: "Mercedes S-class(W222) S550"
//   メーカー 車種(世代) グレード（空の要素は省略）
export function vehicleLabel(v: {
  manufacturer?: string | null;
  model?: string | null;
  generation?: string | null;
  grade?: string | null;
}): string {
  const head = [v.manufacturer, v.model].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
  const gen = (v.generation ?? "").trim();
  const grade = (v.grade ?? "").trim();
  return `${head}${gen ? `(${gen})` : ""}${grade ? ` ${grade}` : ""}`.trim();
}
