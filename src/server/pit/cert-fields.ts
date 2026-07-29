/*
 * 施工証明書の項目定義（唯一の原本）。
 *
 * 法令は改正され、施工種別ごとの項目もヒアリングで変わるため、項目はコードに直書きせず
 * このファイルで定義する。UI（入力フォーム）・バリデーション・PDF出力はすべてここを参照する。
 * → 項目の追加・変更はこのファイルの編集だけで済み、DBスキーマの変更は不要
 *   （値は PitCertificateDetail の module + fieldKey + fieldValue に入る）。
 *
 * 表示可否は cert-visibility.ts が担当する（このファイルは「何を集めるか」だけを定義する）。
 *
 * 必須の考え方（重要）:
 *  施工種別ごとの細目は**すべて任意**にしている。証明書の本質は「その施工を、いつ、誰が、どの車に
 *  したか」であり、製品名やECU型番を必須にすると入力が止まって**記録そのものが生まれない**。
 *  細目は書ける店・書ける場面で埋めてもらい、足りないものは「注意」として伝えるだけにする。
 *  例外は法令で記載が要求される項目のみ（エーミングの場外実施＝場所・天候・理由、外注区分）。
 *  法定記録簿としての最低要件は legal-record.ts が発行時に見る（そこだけは欠けたら止める）。
 */

export type FieldType = "text" | "number" | "date" | "select" | "boolean" | "textarea";

/** 入力の主導線。写真OCRで埋められる項目は ocr を指定してカメラ導線を優先表示する */
export type InputHint = "keyboard" | "ocr" | "voice" | "choice";

export type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  unit?: string;
  options?: string[]; // type=select のときの選択肢
  hint?: InputHint;
  help?: string;
  /** 他フィールドの値によって必須になる場合の条件（法令要件の表現に使う） */
  requiredWhen?: { key: string; equals: string };
};

export type ModuleKey =
  | "coating"
  | "ecu"
  | "aiming"
  | "tire"
  | "repair_history"
  | "battery";

export type ModuleDef = {
  key: ModuleKey;
  label: string;
  /** 法定記録簿（特定整備）に関わるモジュールか。general事業場では項目を出さない */
  legalOnly?: boolean;
  fields: FieldDef[];
};

// ── 共通コア（全証明書で保持する項目） ───────────────────────────
// PitCertificate / PitVehicle / PitCustomer / PitStore の実カラムに対応する。
// ここは「証明書PDFに必ず出す項目」の一覧としても使う（受け入れ条件の検証用）。
export const CORE_FIELDS: {
  key: string;
  label: string;
  source: "vehicle" | "customer" | "store" | "certificate";
  /** 公開ブログへ出してよいか（false=証明書・記録簿のみ） */
  publicSafe: boolean;
  legalRequired?: boolean; // 法定記録簿モードで必須
}[] = [
  { key: "vin", label: "車台番号", source: "vehicle", publicSafe: false, legalRequired: true },
  { key: "registrationNumber", label: "登録番号", source: "vehicle", publicSafe: false, legalRequired: true },
  { key: "vehicleName", label: "車名", source: "vehicle", publicSafe: true },
  { key: "modelCode", label: "型式", source: "vehicle", publicSafe: true },
  { key: "firstRegisteredOn", label: "初度登録年月", source: "vehicle", publicSafe: true },
  { key: "odometerKm", label: "施工時走行距離", source: "certificate", publicSafe: false },
  { key: "customerName", label: "依頼者氏名", source: "customer", publicSafe: false, legalRequired: true },
  { key: "customerAddress", label: "依頼者住所", source: "customer", publicSafe: false, legalRequired: true },
  { key: "serviceDate", label: "施工日", source: "certificate", publicSafe: true, legalRequired: true },
  { key: "storeName", label: "施工店名", source: "store", publicSafe: true },
  { key: "storeAddress", label: "施工店住所", source: "store", publicSafe: true },
  { key: "certificationNo", label: "認証番号", source: "store", publicSafe: false, legalRequired: true },
  { key: "staffName", label: "担当者名", source: "certificate", publicSafe: false, legalRequired: true },
  { key: "staffLicenseNo", label: "資格番号", source: "certificate", publicSafe: false },
  { key: "workSummary", label: "作業概要", source: "certificate", publicSafe: true, legalRequired: true },
  { key: "totalAmount", label: "施工金額", source: "certificate", publicSafe: false },
  { key: "restorationCostEstimate", label: "再施工費用の目安", source: "certificate", publicSafe: false },
  { key: "certificateNo", label: "証明書番号", source: "certificate", publicSafe: false },
  { key: "issuedAt", label: "発行日時", source: "certificate", publicSafe: false },
  { key: "payloadHash", label: "ハッシュ値", source: "certificate", publicSafe: false },
];

// ── 施工種別モジュール ──────────────────────────────────────
// coating の項目はヒアリング中。このモジュールの fields を差し替えるだけで変更できる。
export const MODULES: ModuleDef[] = [
  {
    key: "coating",
    label: "コーティング・PPF",
    fields: [
      { key: "product_name", label: "製品名", type: "text", hint: "ocr", help: "製品ラベルの写真から読み取れます（任意）" },
      { key: "maker", label: "メーカー", type: "text" },
      { key: "lot_no", label: "ロット番号", type: "text", hint: "ocr", help: "写真から読み取れます。分かる場合だけで構いません" },
      { key: "area", label: "施工範囲", type: "text" },
      { key: "temperature", label: "施工環境（気温）", type: "number", unit: "℃" },
      { key: "humidity", label: "施工環境（湿度）", type: "number", unit: "%" },
      { key: "warranty_period", label: "保証期間", type: "text" },
      { key: "next_maintenance_on", label: "次回メンテナンス推奨日", type: "date" },
      { key: "maker_warranty_no", label: "メーカー保証書番号", type: "text" },
    ],
  },
  {
    key: "ecu",
    label: "ECUチューニング",
    fields: [
      // 施工方法で記録の意味が変わる。
      //  OBD        … 通常は純正データを読み出せる＝バックアップありと言える
      //  ECU直接    … 他社データが入っていてOBDから純正が読めない場合はこちらになる
      // ここが分かれていれば「純正に戻せるか」を後から判断できる。
      {
        key: "method",
        label: "施工方法",
        type: "select",
        options: ["OBD（車両側から）", "ECU直接（取り外し・ベンチ）", "その他"],
        hint: "choice",
        help: "OBDか、コンピューターを直接扱ったかで記録の意味が変わります",
      },
      {
        key: "stock_backup",
        label: "純正データのバックアップ",
        type: "select",
        options: [
          "取得済み",
          "取得できず（他社データが入っていた）",
          "取得しない（お客様の同意あり）",
          "未確認",
        ],
        hint: "choice",
      },
      {
        key: "backup_consent",
        label: "現データを残さないことへのお客様の同意",
        type: "select",
        options: ["同意あり", "同意なし"],
        hint: "choice",
        help: "バックアップを取らない場合は、同意を記録に残しておくと後の説明が楽になります",
      },
      { key: "backup_id", label: "バックアップ保管ID", type: "text", help: "社内の保管場所・ファイル名など" },
      { key: "ecu_model", label: "ECU型番", type: "text", help: "分かる場合だけで構いません" },
      { key: "power_before", label: "施工前出力", type: "number", unit: "ps" },
      { key: "power_after", label: "施工後出力", type: "number", unit: "ps" },
      { key: "revertible", label: "純正復帰の可否", type: "select", options: ["可", "不可", "未確認"], hint: "choice" },
      { key: "tool", label: "使用ツール", type: "text" },
    ],
  },
  {
    key: "aiming",
    label: "エーミング",
    legalOnly: true,
    fields: [
      { key: "target_device", label: "対象装置", type: "text", required: true },
      {
        key: "location_type",
        label: "実施場所",
        type: "select",
        options: ["電子制御装置点検整備作業場", "作業場以外（場外）"],
        required: true,
        hint: "choice",
      },
      {
        key: "outsourcing",
        label: "外注区分",
        type: "select",
        options: ["自社", "構内外注", "外注"],
        required: true,
        hint: "choice",
      },
      { key: "outsourcing_to", label: "外注先名", type: "text", requiredWhen: { key: "outsourcing", equals: "外注" } },
      // 法令要件: 作業場以外で実施した場合は場所・天候・その場所で行った理由の記載が必要
      { key: "offsite_place", label: "実施場所（場外の場合）", type: "text", requiredWhen: { key: "location_type", equals: "作業場以外（場外）" } },
      { key: "offsite_weather", label: "天候（場外の場合）", type: "text", requiredWhen: { key: "location_type", equals: "作業場以外（場外）" } },
      { key: "offsite_reason", label: "その場所で行った理由（場外の場合）", type: "textarea", requiredWhen: { key: "location_type", equals: "作業場以外（場外）" } },
      { key: "device", label: "使用機器", type: "text" },
    ],
  },
  {
    key: "tire",
    label: "タイヤ",
    fields: [
      { key: "brand", label: "銘柄", type: "text", hint: "ocr" },
      { key: "size", label: "サイズ", type: "text", hint: "ocr" },
      { key: "dot", label: "DOT（製造週）", type: "text", hint: "ocr", help: "タイヤ側面の刻印を撮影すると読み取ります（4桁・任意）" },
      { key: "position_fl", label: "装着位置 右前", type: "text" },
      { key: "position_fr", label: "装着位置 左前", type: "text" },
      { key: "position_rl", label: "装着位置 右後", type: "text" },
      { key: "position_rr", label: "装着位置 左後", type: "text" },
      { key: "tread_depth", label: "残溝", type: "number", unit: "mm" },
      { key: "pressure", label: "空気圧", type: "number", unit: "kPa" },
    ],
  },
  {
    key: "repair_history",
    label: "修復歴",
    fields: [
      { key: "has_history", label: "修復歴", type: "select", options: ["なし", "あり"], hint: "choice" },
      { key: "parts", label: "部位", type: "text", requiredWhen: { key: "has_history", equals: "あり" } },
      { key: "note", label: "備考", type: "textarea" },
    ],
  },
  {
    key: "battery",
    label: "駆動用バッテリー",
    fields: [
      { key: "soh", label: "SOH", type: "number", unit: "%", hint: "ocr" },
      { key: "device", label: "測定機器", type: "text" },
      { key: "method", label: "測定方法", type: "text" },
    ],
  },
];

export function moduleDef(key: string): ModuleDef | null {
  return MODULES.find((m) => m.key === key) ?? null;
}

/**
 * 入力値に対する必須チェック。requiredWhen（法令の条件付き必須）を解決する。
 * 例: エーミングの実施場所が「作業場以外（場外）」なら 天候・理由・場所が必須になる。
 */
export function validateModuleValues(
  moduleKey: string,
  values: Record<string, string>,
): { fieldKey: string; message: string }[] {
  const def = moduleDef(moduleKey);
  if (!def) return [{ fieldKey: "", message: "不明な施工種別です" }];
  const errors: { fieldKey: string; message: string }[] = [];
  for (const f of def.fields) {
    const v = (values[f.key] ?? "").trim();
    const conditionallyRequired =
      !!f.requiredWhen && (values[f.requiredWhen.key] ?? "").trim() === f.requiredWhen.equals;
    if ((f.required || conditionallyRequired) && !v) {
      errors.push({ fieldKey: f.key, message: `${f.label}は必須です` });
      continue;
    }
    if (v && f.type === "number" && !/^-?\d+(\.\d+)?$/.test(v)) {
      errors.push({ fieldKey: f.key, message: `${f.label}は数値で入力してください` });
    }
    if (v && f.type === "select" && f.options && !f.options.includes(v)) {
      errors.push({ fieldKey: f.key, message: `${f.label}の値が不正です` });
    }
  }
  return errors;
}

/**
 * 入力を弾かずに伝える注意。
 * 必須にはしない代わりに、記録として弱くなる組み合わせをここで知らせる。
 * （現場の判断を止めないが、後で困る点は残さず伝える）
 */
export function moduleAdvice(moduleKey: string, values: Record<string, string>): string[] {
  const v = (k: string) => (values[k] ?? "").trim();
  const advice: string[] = [];

  if (moduleKey === "ecu") {
    const method = v("method");
    const backup = v("stock_backup");
    // OBDで純正が読めないのは他社データが入っている典型。ECU直接なら取得できる場合がある
    if (method.startsWith("OBD") && backup.startsWith("取得できず")) {
      advice.push(
        "OBDでは他社データが入っていると純正データを取り出せません。純正へ戻す可能性があるなら、ECU直接での取得を検討してください",
      );
    }
    if (backup.startsWith("取得しない") && v("backup_consent") !== "同意あり") {
      advice.push("バックアップを取らない場合は、お客様の同意を「同意あり」にして記録に残しておくと後の説明が楽になります");
    }
    if (backup === "取得済み" && !v("backup_id")) {
      advice.push("バックアップの保管場所（保管ID）も入れておくと、純正復帰のときに探さずに済みます");
    }
    if (!method) advice.push("施工方法（OBD / ECU直接）を選ぶと、純正に戻せるかが後から分かります");
  }

  if (moduleKey === "coating" && !v("lot_no")) {
    advice.push("ロット番号は製品ラベルの写真から読み取れます（保証の照会で必要になることがあります）");
  }
  if (moduleKey === "tire" && !v("dot")) {
    advice.push("DOT（製造週）はタイヤ側面の写真から読み取れます");
  }

  return advice;
}

/** 事業場区分に応じて出すモジュール（general＝認証工場以外には特定整備の項目を出さない） */
export function modulesForFacility(facilityType: string): ModuleDef[] {
  const legalMode = facilityType === "certified" || facilityType === "designated";
  return MODULES.filter((m) => legalMode || !m.legalOnly);
}

/** 法定記録簿モードか（認証工場・指定工場のみ） */
export function isLegalRecordFacility(facilityType: string): boolean {
  return facilityType === "certified" || facilityType === "designated";
}
