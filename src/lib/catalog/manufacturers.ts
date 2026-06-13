// 自動車メーカーの正規（カノニカル）一覧。
// 目的: スペル揺れ（audi / Audi / AUDI）で同一メーカーが重複登録されるのを防ぐ。
// 入力補助(datalist)の候補に使い、保存時は normalizeManufacturer で表記を寄せる。

export const MANUFACTURERS: string[] = [
  "Abarth",
  "Alfa Romeo",
  "Alpina",
  "Alpine",
  "Aston Martin",
  "Audi",
  "Bentley",
  "BMW",
  "Cadillac",
  "Chevrolet",
  "Chrysler",
  "Citroën",
  "Cupra",
  "Dodge",
  "Ferrari",
  "Fiat",
  "Ford",
  "Honda",
  "Hyundai",
  "Jaguar",
  "Jeep",
  "Kia",
  "Lamborghini",
  "Lancia",
  "Land Rover",
  "Lexus",
  "Lotus",
  "Maserati",
  "Mazda",
  "McLaren",
  "Mercedes-Benz",
  "Mercedes-AMG",
  "MINI",
  "Mitsubishi",
  "Nissan",
  "Opel",
  "Peugeot",
  "Porsche",
  "Renault",
  "Rolls-Royce",
  "SEAT",
  "Škoda",
  "Smart",
  "Subaru",
  "Suzuki",
  "Tesla",
  "Toyota",
  "Vauxhall",
  "Volkswagen",
  "Volvo",
];

// 比較用キー（大小・空白・記号差を吸収）。
function key(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\s_\-.]/g, "")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/é|è/g, "e")
    .replace(/š/g, "s");
}

const CANON_BY_KEY = new Map(MANUFACTURERS.map((m) => [key(m), m]));
// よくある別名・略称も正規名へ寄せる。
const ALIASES: Record<string, string> = {
  vw: "Volkswagen",
  benz: "Mercedes-Benz",
  mercedes: "Mercedes-Benz",
  amg: "Mercedes-AMG",
  chevy: "Chevrolet",
  landrover: "Land Rover",
  rangerover: "Land Rover",
  alfaromeo: "Alfa Romeo",
  astonmartin: "Aston Martin",
  rollsroyce: "Rolls-Royce",
};

/**
 * 入力メーカー名を正規表記に寄せる。
 * 1) カノニカル一覧/別名にキー一致すれば正規名を返す（表記揺れ吸収）。
 * 2) 既存DBメーカー一覧(existing)にキー一致すれば既存表記を返す（新規揺れ防止）。
 * 3) どれにも一致しなければトリムした入力をそのまま返す（新メーカーは追加可）。
 */
export function normalizeManufacturer(input: string, existing: string[] = []): string {
  const raw = input.trim();
  if (!raw) return raw;
  const k = key(raw);
  if (ALIASES[k]) return ALIASES[k];
  const canon = CANON_BY_KEY.get(k);
  if (canon) return canon;
  const hit = existing.find((m) => key(m) === k);
  if (hit) return hit;
  return raw;
}
