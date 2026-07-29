/*
 * 店舗間で顧客情報が見えないことを実DBで検証する。
 *
 * 「他店の顧客が見えない」はレビューで明示された要件。画面やアクションのコードを読んで
 * 確かめるのではなく、参照層（src/server/pit/customer-repo.ts）に他店IDを渡して
 * 実際に取れないことを確かめる。
 *
 * 使い方: npx tsx scripts/check-store-isolation.mts （ローカルDBに一時データを作り、最後に消す）
 */
process.env.SERVER_SECRET ??= "isolation-test-hmac-secret";
process.env.PII_ENC_KEYS ??= "k1:isolation-test-aes-key-0123456789abcdef";

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/lib/db";
import {
  listStoreCustomers,
  getStoreCustomer,
  listStoreVehicles,
  getStoreVehicle,
  linkVehicleToCustomer,
  endStoreVehicleLink,
} from "../src/server/pit/customer-repo";
import { registerVehicle, loadVehicleForEdit, updateVehicleInfo } from "../src/server/pit/vehicle-register";
import {
  saveCertificateDraft,
  issueCertificate,
  setShareRevoked,
  voidAndClone,
  listStoreCertificates,
  getStoreCertificate,
  getSharedCertificate,
} from "../src/server/pit/certificate";
import { missingLegalFields, exportStoreRecordsCsv, retentionSummary } from "../src/server/pit/legal-record";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const ok = (label: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failed++;
};

const PREFIX = "zz-isolation-test";
const VIN = "TEST99-987654";

async function cleanup() {
  const stores = await prisma.pitStore.findMany({ where: { slug: { startsWith: PREFIX } }, select: { id: true } });
  const ids = stores.map((s) => s.id);
  if (ids.length) {
    const customers = await prisma.pitCustomer.findMany({ where: { storeId: { in: ids } }, select: { id: true } });
    // 証明書 → 紐づけ → 顧客 → 店舗 の順に消す（外部キーの向き）
    await prisma.pitCertificate.deleteMany({ where: { storeId: { in: ids } } });
    await prisma.pitVehicleEditLog.deleteMany({ where: { storeId: { in: ids } } });
    await prisma.pitVehicleCustomer.deleteMany({ where: { customerId: { in: customers.map((c) => c.id) } } });
    await prisma.pitCustomer.deleteMany({ where: { storeId: { in: ids } } });
    await prisma.pitStore.deleteMany({ where: { id: { in: ids } } });
  }
  const { vehicleKeyFromChassis } = await import("../src/server/pit/vehicle");
  await prisma.pitVehicle.deleteMany({ where: { vehicleKey: vehicleKeyFromChassis(VIN) } });
}

async function main() {
  await cleanup();

  const storeA = await prisma.pitStore.create({
    data: { displayName: "検証店A", slug: `${PREFIX}-a`, wpCategoryId: -1, facilityType: "certified" },
    select: { id: true },
  });
  const storeB = await prisma.pitStore.create({
    data: { displayName: "検証店B", slug: `${PREFIX}-b`, wpCategoryId: -2 },
    select: { id: true },
  });
  const custA = await prisma.pitCustomer.create({
    data: { storeId: storeA.id, name: "Ａ店の顧客", address: "大阪府堺市北区1-1", tel: "090-0000-0001" },
    select: { id: true },
  });
  const custB = await prisma.pitCustomer.create({
    data: { storeId: storeB.id, name: "Ｂ店の顧客", address: "東京都渋谷区1-1" },
    select: { id: true },
  });

  // ── 顧客一覧・単票 ──
  const listA = await listStoreCustomers(storeA.id);
  ok(
    "自店の顧客だけが一覧に出る",
    listA.length === 1 && listA[0].id === custA.id,
    listA.map((c) => c.name).join(","),
  );
  ok("他店の顧客IDを渡しても取得できない", (await getStoreCustomer(storeA.id, custB.id)) === null);
  ok("自店の顧客は取得できる", (await getStoreCustomer(storeA.id, custA.id))?.id === custA.id);

  // ── 車両（同じ車が両店に来ても、見えるのは自店の紐づけだけ） ──
  const reg = await registerVehicle({ vin: VIN, registrationNumber: "大阪 300 あ 12-34", vehicleName: "検証車" });
  ok("車両を登録できる", !!reg.vehicle, reg.error ?? "");
  if (!reg.vehicle) throw new Error("車両登録に失敗したため以降の検証を中止");
  const vehicleId = reg.vehicle.id;

  const stored = await prisma.pitVehicle.findUnique({
    where: { id: vehicleId },
    select: { vinEnc: true, regNumberEnc: true, chassisLast3: true },
  });
  ok("車台番号は平文で保存されていない", !!stored?.vinEnc && !stored.vinEnc.includes(VIN), stored?.vinEnc?.slice(0, 12));
  ok("登録番号も暗号化されている", !!stored?.regNumberEnc && !stored.regNumberEnc.includes("12-34"));
  ok("表示用は下3桁のみ", stored?.chassisLast3 === "654", String(stored?.chassisLast3));

  ok("他店の顧客に紐づけようとすると拒否される", !!(await linkVehicleToCustomer({ storeId: storeB.id, vehicleId, customerId: custA.id })).error);
  ok("自店の顧客には紐づけられる", !!(await linkVehicleToCustomer({ storeId: storeA.id, vehicleId, customerId: custA.id })).ok);

  const vehiclesB = await listStoreVehicles(storeB.id);
  ok("他店が登録した車両は一覧に出ない", vehiclesB.length === 0, String(vehiclesB.length));
  ok("他店の車両IDを渡しても取得できない", (await getStoreVehicle(storeB.id, vehicleId)) === null);

  const vehiclesA = await listStoreVehicles(storeA.id);
  ok(
    "自店の車両は顧客名つきで見える",
    vehiclesA.length === 1 && vehiclesA[0].customerName === "Ａ店の顧客" && vehiclesA[0].chassisLast3 === "654",
    JSON.stringify(vehiclesA.map((v) => v.customerName)),
  );
  ok("一覧に暗号文・平文の車台番号を載せない", !JSON.stringify(vehiclesA).includes(VIN));

  // 同じ車がB店にも来た場合（車両は共有、紐づけは店ごと）
  await linkVehicleToCustomer({ storeId: storeB.id, vehicleId, customerId: custB.id });
  const afterA = await listStoreVehicles(storeA.id);
  const afterB = await listStoreVehicles(storeB.id);
  ok(
    "同じ車でも各店は自店の顧客の紐づけしか見えない",
    afterA.length === 1 &&
      afterA[0].customerName === "Ａ店の顧客" &&
      afterB.length === 1 &&
      afterB[0].customerName === "Ｂ店の顧客",
  );

  // ── 車両情報の修正（上書き・履歴が残る） ──
  const beforeEdit = await loadVehicleForEdit(vehicleId, { actorUserId: "test", actorRole: "dealer" });
  ok("修正画面は現在値を復号して返す", beforeEdit?.vin === VIN && beforeEdit?.registrationNumber === "大阪 300 あ 12-34", `${beforeEdit?.vin} / ${beforeEdit?.registrationNumber}`);

  const edited = await updateVehicleInfo(
    vehicleId,
    storeA.id,
    {
      vehicleName: "検証車（修正後）",
      maker: "スズキ",
      modelCode: "3BA-ZC33S",
      firstRegistered: "2019-05",
      inspectionExpiry: "2027-05-20",
      registrationNumber: "大阪 300 あ 99-99",
    },
    { actorUserId: "test-user" },
  );
  ok("修正で上書きできる（登録時の「空欄だけ埋める」と違う）", !!edited.ok && (edited.changed ?? []).includes("vehicleName"), (edited.changed ?? []).join(","));
  const afterEdit = await loadVehicleForEdit(vehicleId, { actorUserId: "test", actorRole: "dealer" });
  ok("登録番号を入れ替えられる", afterEdit?.registrationNumber === "大阪 300 あ 99-99", afterEdit?.registrationNumber);
  ok("車台番号は修正で変わらない（一意キーのため）", afterEdit?.vin === VIN, afterEdit?.vin);

  const editLog = await prisma.pitVehicleEditLog.findFirst({
    where: { vehicleId, storeId: storeA.id },
    orderBy: { at: "desc" },
  });
  ok("修正履歴が残る", !!editLog && editLog.actorUserId === "test-user");
  ok(
    "履歴に登録番号の値そのものは残さない（ログに個人情報を増やさない）",
    !JSON.stringify(editLog?.changes ?? {}).includes("99-99"),
    JSON.stringify(editLog?.changes ?? {}).slice(0, 90),
  );
  const cleared = await updateVehicleInfo(
    vehicleId,
    storeA.id,
    {
      vehicleName: "検証車",
      maker: "スズキ",
      modelCode: "3BA-ZC33S",
      firstRegistered: "2019-05",
      inspectionExpiry: "2027-05-20",
      registrationNumber: "",
    },
    { actorUserId: "test-user" },
  );
  ok("空欄で保存すると登録番号を消せる", !!cleared.ok && (cleared.changed ?? []).includes("registrationNumber"));
  ok(
    "消したあとは登録番号が空",
    (await loadVehicleForEdit(vehicleId, { actorUserId: "test", actorRole: "dealer" }))?.registrationNumber === "",
  );
  // 証明書のためにナンバーを戻す
  await updateVehicleInfo(
    vehicleId,
    storeA.id,
    {
      vehicleName: "検証車",
      maker: "スズキ",
      modelCode: "3BA-ZC33S",
      firstRegistered: "2019-05",
      inspectionExpiry: "2027-05-20",
      registrationNumber: "大阪 300 あ 12-34",
    },
    { actorUserId: "test-user" },
  );

  // ── 証明書（他店の証明書は見えない・発行後は変更できない） ──
  const ctxA = { id: storeA.id, slug: `${PREFIX}-a`, facilityType: "certified", certificationNo: "近運整第9999号" };
  const ctxB = { id: storeB.id, slug: `${PREFIX}-b`, facilityType: "general", certificationNo: "" };
  const coreInput = {
    vehicleId,
    customerId: custA.id,
    certificateType: "coating",
    serviceDate: "2026-07-20",
    odometerKm: "52300",
    staffName: "山本",
    staffLicenseNo: "1級-12345",
    workSummary: "ボディ全面のガラスコーティングを施工。",
    totalAmount: "128000",
    restorationCostEstimate: "128000",
    requireVerifyLast3: true,
    warrantyUntil: "",
    moduleValues: { product_name: "テスト製品", maker: "テストメーカー", lot_no: "L-2026-07" },
    blogPostId: "",
  };
  const draft = await saveCertificateDraft(ctxA, coreInput);
  ok("証明書の下書きを作れる", !!draft.ok, draft.error ?? (draft.fieldErrors ?? []).map((e) => e.message).join(","));
  const certId = draft.certificateId!;

  ok("他店の証明書は一覧に出ない", (await listStoreCertificates(storeB.id)).length === 0);
  ok("他店の証明書IDを渡しても取得できない", (await getStoreCertificate(storeB.id, certId)) === null);
  ok("他店は発行できない", !!(await issueCertificate(ctxB, certId)).error);
  ok(
    "モジュール必須の欠けは弾く（ロット番号なし）",
    !!(await saveCertificateDraft(ctxA, { ...coreInput, moduleValues: { product_name: "P", maker: "M" } }, certId))
      .fieldErrors?.length,
  );

  // 下書きは共有ページから見えない
  const draftRow = await prisma.pitCertificate.findUnique({
    where: { id: certId },
    select: { shareToken: true },
  });
  ok("下書きは共有リンクで開けない", (await getSharedCertificate(draftRow!.shareToken)).state === "notfound");

  const issued = await issueCertificate(ctxA, certId, { warrantyUntil: "" });
  ok("自店は発行できる", !!issued.ok, issued.error ?? "");
  const token = issued.shareToken!;
  ok("発行済みの証明書は編集できない", !!(await saveCertificateDraft(ctxA, coreInput, certId)).error);
  ok("二重発行はできない", !!(await issueCertificate(ctxA, certId)).error);

  const issuedRow = await prisma.pitCertificate.findUnique({
    where: { id: certId },
    select: { payloadHash: true, retentionUntil: true, retentionReason: true, verifyLast3: true },
  });
  ok("発行でハッシュが確定する", (issuedRow?.payloadHash ?? "").length === 64);
  ok(
    "認証工場の証明書は法定記録簿として2年保持",
    issuedRow?.retentionReason === "legal_record" && issuedRow?.retentionUntil !== null,
    String(issuedRow?.retentionUntil?.toISOString().slice(0, 10)),
  );

  // 共有リンク: 下3桁照合あり
  ok("照合を設定したら下3桁が必要", (await getSharedCertificate(token)).state === "needs_verify");
  ok("誤った下3桁では開けない", (await getSharedCertificate(token, "000")).state === "needs_verify");
  const shared = await getSharedCertificate(token, issuedRow!.verifyLast3);
  ok("正しい下3桁なら開ける", shared.state === "ok");
  ok(
    "共有ページのデータに平文の車台番号は含まれない（復号は別経路）",
    shared.state === "ok" && !JSON.stringify(shared.cert).includes(VIN),
  );

  // 共有停止
  await setShareRevoked(storeA.id, certId, true);
  ok("共有を停止すると開けない", (await getSharedCertificate(token, issuedRow!.verifyLast3)).state === "revoked");
  ok("他店は共有停止を操作できない", !!(await setShareRevoked(storeB.id, certId, false)).error);
  await setShareRevoked(storeA.id, certId, false);

  // 訂正（元は無効化され、内容を引き継いだ下書きができる）
  ok("他店は訂正できない", !!(await voidAndClone(ctxB, certId, "誤り")).error);
  const revised = await voidAndClone(ctxA, certId, "走行距離の入力誤り");
  ok("訂正で新しい下書きができる", !!revised.ok && !!revised.certificateId);
  const original = await prisma.pitCertificate.findUnique({
    where: { id: certId },
    select: { status: true, voidReason: true, shareRevoked: true },
  });
  ok(
    "元の証明書は無効化され共有も止まる",
    original?.status === "voided" && original.shareRevoked === true && !!original.voidReason,
  );
  const clone = await prisma.pitCertificate.findUnique({
    where: { id: revised.certificateId! },
    select: { status: true, replacesId: true, details: { select: { fieldKey: true } } },
  });
  ok(
    "訂正版は下書きで、元をreplacesIdで指し、内容を引き継ぐ",
    clone?.status === "draft" && clone.replacesId === certId && clone.details.length > 0,
  );

  // ── 法定記録簿モード（認証工場は記載事項が欠けたら発行させない） ──
  const legalMissing = missingLegalFields({
    facilityType: "certified",
    certificationNo: "",
    hasVin: true,
    hasRegistrationNumber: false,
    customerName: "",
    customerAddress: "",
    serviceDate: new Date(),
    staffName: "山本",
    workSummary: "施工",
  });
  ok(
    "認証工場で氏名・住所・認証番号が欠けていれば不足として挙げる",
    ["依頼者氏名", "依頼者住所", "認証番号"].every((k) => legalMissing.includes(k)),
    legalMissing.join("・"),
  );
  ok(
    "一般事業場は法定必須の対象外（証明書のみ）",
    missingLegalFields({
      facilityType: "general",
      certificationNo: "",
      hasVin: false,
      hasRegistrationNumber: false,
      customerName: "",
      customerAddress: "",
      serviceDate: null,
      staffName: "",
      workSummary: "",
    }).length === 0,
  );
  ok(
    "車台番号があれば登録番号が無くても車両特定できる",
    missingLegalFields({
      facilityType: "certified",
      certificationNo: "近運整第9999号",
      hasVin: true,
      hasRegistrationNumber: false,
      customerName: "顧客",
      customerAddress: "住所",
      serviceDate: new Date(),
      staffName: "担当",
      workSummary: "作業",
    }).length === 0,
  );

  // 住所を空にした顧客では認証工場の発行が止まること（実DBで確認）
  await prisma.pitCustomer.update({ where: { id: custA.id }, data: { address: "" } });
  const draft2 = await saveCertificateDraft(ctxA, { ...coreInput, serviceDate: "2026-07-21" });
  const blocked = await issueCertificate(ctxA, draft2.certificateId!);
  ok(
    "認証工場は記載事項が欠けたまま発行できない",
    !!blocked.error && blocked.error.includes("法定記録簿"),
    blocked.error ?? "（発行できてしまった）",
  );
  await prisma.pitCustomer.update({ where: { id: custA.id }, data: { address: "大阪府堺市北区1-1" } });
  ok("住所を入れれば発行できる", !!(await issueCertificate(ctxA, draft2.certificateId!)).ok);

  // ── 記録の一括エクスポート（退会しても持ち出せる） ──
  const exported = await exportStoreRecordsCsv(storeA.id, {
    actorUserId: "test-user",
    actorRole: "hq",
    purpose: "検証",
  });
  ok("発行済み・無効化済みの記録がCSVに出る", exported.count >= 1, `${exported.count}件`);
  ok("CSVにExcel向けのBOMが付いている", exported.csv.charCodeAt(0) === 0xfeff);
  ok("CSVに法定記載事項の列がある", exported.csv.includes("依頼者住所") && exported.csv.includes("認証番号"));
  ok("CSVに復号した車台番号が入る（記録簿の記載事項）", exported.csv.includes(VIN), VIN);
  ok("CSVに保存期限が入る", exported.csv.includes("保存期限"));
  const otherStoreCsv = await exportStoreRecordsCsv(storeB.id, {
    actorUserId: "test-user",
    actorRole: "hq",
    purpose: "検証",
  });
  ok("他店のCSVに自店の記録が混ざらない", !otherStoreCsv.csv.includes("Ａ店の顧客"), `${otherStoreCsv.count}件`);
  const summary = await retentionSummary(storeA.id);
  ok("退会前の確認用に件数と保存期限が出る", summary.total >= 1 && summary.keepUntil !== null, JSON.stringify(summary));
  ok(
    "エクスポートの復号が監査ログに残る",
    (await prisma.pitPiiAccessLog.count({ where: { purpose: "検証" } })) >= 2,
  );

  // 紐づけ解除は自店のものだけ
  ok(
    "他店の紐づけは解除できない",
    !!(await endStoreVehicleLink({ storeId: storeA.id, vehicleId, customerId: custB.id })).error,
  );
  ok("自店の紐づけは解除できる", !!(await endStoreVehicleLink({ storeId: storeA.id, vehicleId, customerId: custA.id })).ok);
  ok("解除後は自店から辿れない", (await getStoreVehicle(storeA.id, vehicleId)) === null);
  ok("他店の紐づけは残る", (await listStoreVehicles(storeB.id)).length === 1);
  ok(
    "車両そのものは残る（履歴は車に紐づくため消さない）",
    (await prisma.pitVehicle.count({ where: { id: vehicleId } })) === 1,
  );

  // ── 本部の代行と加盟店の固定（acting-store の分岐が構造として正しいこと） ──
  const actingSrc = readFileSync(join(root, "src/server/pit/acting-store.ts"), "utf8");
  ok(
    "加盟店は引数のstoreIdを使わず dealerId から解決している",
    /dealerId: user\.dealerId/.test(actingSrc) && actingSrc.includes("加盟店は自店のみ（引数は見ない）"),
  );
  ok("本部だけが storeId で店舗を指定できる", /user\.role === "HQ_ADMIN"[\s\S]{0,400}storeId/.test(actingSrc));
  // 画面・アクションが直接 ownPitStore/prisma で権限判定していないこと（代行の穴を作らない）
  const certActions = readFileSync(join(root, "src/lib/actions/pit-certificates.ts"), "utf8");
  const vehActions = readFileSync(join(root, "src/lib/actions/pit-vehicles.ts"), "utf8");
  ok(
    "車両・証明書のアクションは acting-store を通す",
    certActions.includes("actingPitStore") &&
      vehActions.includes("actingPitStore") &&
      !certActions.includes("ownPitStore") &&
      !vehActions.includes("ownPitStore"),
  );

  // ── 構造: 画面から顧客テーブルを直接引かない（storeId条件の付け忘れを防ぐ） ──
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return e.name === "api" ? [] : walk(p);
      return /\.tsx?$/.test(e.name) ? [p] : [];
    });
  const direct = walk(join(root, "src/app"))
    .filter((p) => /prisma\.pitCustomer|prisma\.pitVehicleCustomer/.test(readFileSync(p, "utf8")))
    .map((p) => relative(root, p));
  ok("画面から顧客テーブルを直接引いていない（参照層を通す）", direct.length === 0, direct.join(","));
}

try {
  await main();
} catch (e) {
  console.error("❌ 検証中に例外", e);
  failed++;
} finally {
  await cleanup();
  await prisma.$disconnect();
}

console.log(failed === 0 ? "\n全チェック合格" : `\n${failed}件のチェックに失敗`);
process.exit(failed === 0 ? 0 : 1);
