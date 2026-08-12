// VehiclePageOption（語彙マスタ）の読み取り。サーバー側専用。
import { prisma } from "../db";
import { FALLBACK_OPTION_DEFS, type OptionDef } from "./options";

export async function loadOptionDefs(includeDisabled = false): Promise<OptionDef[]> {
  try {
    const rows = await prisma.vehiclePageOption.findMany({
      where: includeDisabled ? undefined : { enabled: true },
      orderBy: { displayOrder: "asc" },
    });
    if (rows.length === 0) return FALLBACK_OPTION_DEFS;
    return rows.map((r) => ({
      key: r.key,
      jp: r.labelJa,
      en: r.labelEn,
      short: r.shortLabel ?? undefined,
      derivedFrom: r.derivedFrom ?? undefined,
    }));
  } catch {
    // 未マイグレーション等でテーブルが無い場合も動くようにする
    return FALLBACK_OPTION_DEFS;
  }
}
