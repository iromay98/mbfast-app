/*
 * Airtable価格Base のブランド定義（テーブルID＋フィールド名）。**マッピングの唯一の原本**。
 *
 * 経緯: 2026-07にAirtable→アプリへ取り込むために作った定義。取込完了後にスクリプトを削除したが、
 * 代理店が自分のサイトにAirtableの埋め込みを貼っているため、**アプリ→Airtableへ書き戻す**
 * （本部で変更した新料金をAirtable側にも反映する）用途で必要になったので復元した。
 *
 * 注意（フィールド名の罠。ここを間違えると代理店の表示価格を壊す）:
 *  - 半角カナ混じりの名前が多い（例 ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)）。表記を勝手に直さない
 *  - McLaren の "Status" は中身が **Stage1ゲイン**（フィールド名が誤っている）
 *  - Ford の "Stage1" は **価格列**（他ブランドではゲイン）
 *  - 三菱ふそうは価格1列だけの特殊構成
 *  - Porsche の Powergate3 は multipleSelects 型
 * これらは docs/price-sync/REPORT-STEP-B-mapping.md（承認済み）に準拠している。
 */

type PriceKey = { key: string; label: string; field: string };
type BrandDef = {
  id: string;
  slug: string;
  displayName: string;
  prefix: string; // CSSプレフィックス（新設）
  wpPageId: number;
  tableId: string;
  carField: string;
  gradeField?: string;
  engineFields?: string[]; // 連結（改行畳み）
  stockField?: string;
  gainField?: string;
  laborField?: string;
  shopsField?: string;
  ecuField?: string;
  notesFields?: string[];
  makerField?: string; // cdj: seriesGroup に使う
  priceKeys: PriceKey[];
  remoteFields?: Partial<Record<"autoTuner" | "powerGate3" | "flasher" | "atOne", string>>;
};

const DEFS: BrandDef[] = [
  {
    id: "toyota", slug: "toyota", displayName: "Toyota", prefix: "toyota-", wpPageId: 9686, tableId: "tblVmbYwEgVImRQZ0",
    carField: "車種", engineFields: ["型式(排気量)"], stockField: "純正", gainField: "Stage1", laborField: "工賃", notesFields: ["備考"],
    priceKeys: [
      { key: "limiterCut", label: "リミッター解除のみ", field: "リミッター解除のみ" },
      { key: "babble", label: "バブリングのみ", field: "バブリングのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
      { key: "limiterOpt", label: "リミッター解除OP", field: "リミッター解除オプション" },
    ],
    remoteFields: { autoTuner: "AutoTuner", powerGate3: "Powergate3(ﾘﾓｰﾄﾂｰﾙ)", flasher: "IXI Flasher(ﾘﾓｰﾄﾂｰﾙ)" },
  },
  {
    id: "nissan", slug: "nissan", displayName: "Nissan", prefix: "nissan-", wpPageId: 9682, tableId: "tbl6jDMSlIhO9Y5ZO",
    carField: "車種", gradeField: "グレード", stockField: "純正馬力", gainField: "Stage1", laborField: "工賃",
    priceKeys: [
      { key: "babble", label: "バブリングのみ", field: "バブリングのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
    ],
    remoteFields: { autoTuner: "AutoTuner", powerGate3: "Powergate3(ﾘﾓｰﾄﾂｰﾙ)", flasher: "IXI Flasher(ﾘﾓｰﾄﾂｰﾙ)" },
  },
  {
    id: "lexus", slug: "lexus", displayName: "Lexus", prefix: "lexus-", wpPageId: 9673, tableId: "tbloU5637QIhFSzX1",
    carField: "車種", engineFields: ["ｴﾝｼﾞﾝ"], stockField: "純正", gainField: "Stage1", laborField: "工賃", shopsField: "取扱店", notesFields: ["備考"],
    priceKeys: [
      { key: "limiterCut", label: "リミッター解除のみ", field: "ﾘﾐｯﾀｰｶｯﾄのみ" },
      { key: "babble", label: "バブリングのみ", field: "ﾊﾞﾌﾞﾘﾝｸﾞのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
      { key: "limiterOpt", label: "リミッター解除OP", field: "ﾘﾐｯﾀｰｶｯﾄｵﾌﾟｼｮﾝ" },
    ],
    remoteFields: { autoTuner: "AutoTuner", powerGate3: "Powergate3(ﾘﾓｰﾄﾂｰﾙ)", flasher: "IXI Flasher(ﾘﾓｰﾄﾂｰﾙ)" },
  },
  {
    id: "honda", slug: "honda", displayName: "Honda", prefix: "honda-", wpPageId: 3463, tableId: "tbluuL2YLvwUIhUJK",
    carField: "Chassis", engineFields: ["エンジン型式"], stockField: "純正", gainField: "ECUﾁｭｰﾆﾝｸﾞ(Stage1)", laborField: "工賃", notesFields: ["備考"],
    priceKeys: [
      { key: "babble", label: "バブリングのみ", field: "バブリングのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
      { key: "limiterOpt", label: "リミッター解除OP", field: "リミッター解除オプション" },
    ],
    remoteFields: { autoTuner: "AutoTuner" },
  },
  {
    id: "mitsubishi_fuso", slug: "mitsubishi-fuso", displayName: "三菱ふそう", prefix: "fuso-", wpPageId: 14874, tableId: "tblCupM6TfN2xrJJn",
    carField: "Name", stockField: "純正", gainField: "チューニング",
    priceKeys: [{ key: "tuning", label: "チューニング価格", field: "価格" }],
  },
  {
    id: "porsche", slug: "porsche", displayName: "Porsche", prefix: "porsche-", wpPageId: 9684, tableId: "tbltkJRcPIMrELbf3",
    carField: "車種", gradeField: "グレード", engineFields: ["エンジン"], stockField: "純正", gainField: "Stage1", laborField: "ECU脱着等工賃",
    priceKeys: [
      { key: "babble", label: "バブリングのみ", field: "バブリングのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
    ],
    remoteFields: { autoTuner: "AutoTuner", powerGate3: "Powergate3(ﾘﾓｰﾄﾂｰﾙ)", flasher: "IXI Flasher(ﾘﾓｰﾄﾂｰﾙ)" },
  },
  {
    id: "mini", slug: "mini", displayName: "MINI", prefix: "mini-", wpPageId: 14154, tableId: "tblW32x8z5MvrfQli",
    carField: "グレード", engineFields: ["エンジン"], stockField: "純正", gainField: "Stage1", laborField: "ECU脱着等工賃", ecuField: "ECU",
    priceKeys: [
      { key: "babble", label: "バブリングのみ", field: "ﾊﾞﾌﾞﾘﾝｸﾞのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
    ],
    remoteFields: { autoTuner: "AutoTuner" },
  },
  {
    id: "ferrari", slug: "ferrari", displayName: "Ferrari", prefix: "ferrari-", wpPageId: 9616, tableId: "tblXUYU8JD8D20wko",
    carField: "車種", stockField: "純正", gainField: "Stage1", laborField: "脱着工賃",
    priceKeys: [
      { key: "babble", label: "バブリングのみ", field: "バブリングのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
      { key: "o2opf", label: "O2/OPFカット", field: "O2／OPFカット" },
      { key: "stage2", label: "Stage2", field: "Stage2" },
      { key: "mapswitch", label: "MapSwitch", field: "MapSwitch" },
    ],
    remoteFields: { autoTuner: "AutoTuner" },
  },
  {
    id: "maserati", slug: "maserati", displayName: "Maserati", prefix: "maserati-", wpPageId: 9675, tableId: "tblLvZlUSwJGM2780",
    carField: "車種", gradeField: "グレード", engineFields: ["エンジン"], stockField: "純正", gainField: "Stage1", laborField: "ECU脱着殻割り工賃", shopsField: "取扱店",
    priceKeys: [
      { key: "babble", label: "バブリングのみ", field: "ﾊﾞﾌﾞﾘﾝｸﾞのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
    ],
    remoteFields: { autoTuner: "AutoTuner(ECU/TCU)" },
  },
  {
    id: "mclaren", slug: "mclaren", displayName: "McLaren", prefix: "mclaren-", wpPageId: 15852, tableId: "tbl2we0zItdoK0Zxd",
    carField: "車種", engineFields: ["エンジン"], stockField: "純正", gainField: "Status" /* 中身はStage1ゲイン */, laborField: "工賃",
    priceKeys: [
      { key: "babble", label: "バブリングのみ", field: "ﾊﾞﾌﾞﾘﾝｸﾞのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
    ],
  },
  {
    id: "landrover", slug: "landrover", displayName: "Land Rover", prefix: "landrover-", wpPageId: 9671, tableId: "tbleCUvbnT7Fg4GQN",
    carField: "車種", engineFields: ["エンジン"], stockField: "純正", gainField: "ECUﾁｭｰﾆﾝｸﾞ(Stage1)", ecuField: "ECU/TCU",
    priceKeys: [
      { key: "babble", label: "バブリングのみ", field: "ﾊﾞﾌﾞﾘﾝｸﾞのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
      { key: "tcu", label: "TCUチューニング", field: "TCUﾁｭｰﾆﾝｸﾞ" },
    ],
    remoteFields: { autoTuner: "AutoTuner", atOne: "AT One(ﾘﾓｰﾄﾂｰﾙ)", powerGate3: "Powergate3(ﾘﾓｰﾄﾂｰﾙ)", flasher: "IXI Flasher(ﾘﾓｰﾄﾂｰﾙ)" },
  },
  {
    id: "jaguar", slug: "jaguar", displayName: "Jaguar", prefix: "jaguar-", wpPageId: 9666, tableId: "tblM8I4O109pTqobC",
    carField: "車種", engineFields: ["エンジン"], stockField: "純正", gainField: "ECUﾁｭｰﾆﾝｸﾞ(Stage1)",
    priceKeys: [
      { key: "babble", label: "バブリングのみ", field: "ﾊﾞﾌﾞﾘﾝｸﾞのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
      { key: "tcu", label: "TCUチューニング", field: "TCUﾁｭｰﾆﾝｸﾞ" },
    ],
    remoteFields: { autoTuner: "AutoTuner(ECU/TCU)", powerGate3: "Powergate3(ﾘﾓｰﾄﾂｰﾙ)", flasher: "IXI Flasher" },
  },
  {
    id: "chevrolet", slug: "chevrolet", displayName: "Chevrolet", prefix: "chevrolet-", wpPageId: 13721, tableId: "tblMLHJmVHQG5n1WC",
    carField: "モデル", engineFields: ["エンジン"], gainField: "チューニング", ecuField: "ECU/TCU",
    priceKeys: [
      { key: "babble", label: "バブリングのみ", field: "バブリングのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
      { key: "tcu", label: "TCUチューニング", field: "TCUﾁｭｰﾆﾝｸﾞ" },
    ],
    remoteFields: { autoTuner: "AutoTuner" },
  },
  {
    id: "ford", slug: "ford", displayName: "Ford", prefix: "ford-", wpPageId: 13593, tableId: "tblPv8kuGv4NGLuW8",
    carField: "モデル", engineFields: ["エンジン"], stockField: "純正", gainField: "チューニング", ecuField: "ECU",
    priceKeys: [
      { key: "babble", label: "バブリングのみ", field: "ﾊﾞﾌﾞﾘﾝｸﾞのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "Stage1" }, // Fordのみ Stage1 が価格列
    ],
    remoteFields: { autoTuner: "AutoTuner" },
  },
  {
    id: "chrysler_dodge_jeep", slug: "chrysler-dodge-jeep", displayName: "Chrysler / Dodge / Jeep", prefix: "cdj-", wpPageId: 11024, tableId: "tblm50ZQMYtxXU8qs",
    carField: "車種", engineFields: ["エンジン"], stockField: "純正", gainField: "チューニング", laborField: "ECU脱着・殻割り工賃", notesFields: ["備考"], makerField: "メーカー",
    priceKeys: [
      { key: "babble", label: "バブリングのみ", field: "ﾊﾞﾌﾞﾘﾝｸﾞのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
    ],
    remoteFields: { autoTuner: "AutoTuner" },
  },
];

export type { PriceKey, BrandDef };
export const AIRTABLE_DEFS = DEFS;
