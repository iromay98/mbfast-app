"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  STORE_META_FIELDS,
  validateStoreInfo,
  type StoreInfo,
  type StoreMetaField,
} from "@/server/pit/store-meta";
import { PREFECTURES, splitArea } from "@/lib/jp-geo";
import {
  previewStoreInfo,
  commitStoreInfo,
  runStoreSync,
  previewMyStoreInfo,
  commitMyStoreInfo,
  type StorePreview,
} from "@/lib/actions/pit";

// エリア（都道府県＋市区町村）の2段プルダウン。保存値は従来どおり1文字列（例: 大阪府堺市北区）
// なのでWP連携（mbpit_area）の契約は変わらない。市区町村一覧が取得できない環境では手入力に落ちる。
function AreaSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { pref, city } = splitArea(value);
  const [cities, setCities] = useState<string[] | null>(null); // null=未取得
  const [cityFailed, setCityFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCities(null);
    setCityFailed(false);
    if (!pref) return;
    void fetch(`/api/cities?pref=${encodeURIComponent(pref)}`)
      .then((r) => r.json())
      .then((d: { cities?: string[] }) => {
        if (cancelled) return;
        if (d.cities && d.cities.length > 0) setCities(d.cities);
        else setCityFailed(true);
      })
      .catch(() => {
        if (!cancelled) setCityFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [pref]);

  const sel = "mt-0.5 w-full rounded border border-line bg-surface px-2 py-1.5 text-xs font-semibold text-ink";
  return (
    <div className="grid grid-cols-2 gap-1.5">
      <select value={pref} onChange={(e) => onChange(e.target.value)} className={sel}>
        <option value="">都道府県を選択</option>
        {PREFECTURES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      {!pref ? (
        <select disabled className={sel}>
          <option>市区町村</option>
        </select>
      ) : cityFailed ? (
        // 一覧が取れない環境（オフライン等）では手入力にフォールバック
        <input
          value={city}
          placeholder="市区町村を入力"
          onChange={(e) => onChange(`${pref}${e.target.value}`)}
          className={sel}
        />
      ) : (
        <select
          value={city}
          onChange={(e) => onChange(`${pref}${e.target.value}`)}
          disabled={cities === null}
          className={sel}
        >
          <option value="">{cities === null ? "読み込み中…" : "市区町村を選択"}</option>
          {/* 現在値が一覧に無い場合（旧表記など）も選択肢として残す */}
          {city && cities !== null && !cities.includes(city) && <option value={city}>{city}</option>}
          {(cities ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/*
 * 所在地の入力。保存値は従来どおり**1つの文字列**（例: 大阪府堺市北区長曽根町3-1-2 mbFASTビル）
 * なのでWP連携（mbpit_address）の契約は変わらない。
 *
 * 変えたのは入力のさせ方。
 * - 「都道府県＋市区町村」はエリアで既に選んでいるので、**読み取り専用の見出しとして出す**。
 *   以前は所在地の欄にも自動入力していて、同じものを2回入れている見た目になっていた。
 * - 町域（区の下の町・大字）は手入力させずプルダウンから選ぶ（表記ゆれを防ぐ）。
 *   一覧が取れない場合は手入力に落ちる（入力自体は止めない）。
 * - 手で書くのは**番地・建物名だけ**。
 */
function AddressFields({
  area,
  value,
  onChange,
}: {
  area: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { pref, city } = splitArea(area);
  const prefix = `${pref}${city}`;
  const [towns, setTowns] = useState<string[] | null>(null);
  const [townFailed, setTownFailed] = useState(false);

  // 保存値から「エリアの後ろ」を取り出す。エリアで始まっていない旧データはそのまま扱う
  const rest = value.startsWith(prefix) && prefix ? value.slice(prefix.length) : value;
  // 取得済みの町域一覧のうち、残り部分の先頭に一致するものを「選択中の町域」とみなす
  const town = (towns ?? []).find((t) => rest.startsWith(t)) ?? "";
  const banchi = town ? rest.slice(town.length) : rest;

  useEffect(() => {
    let cancelled = false;
    setTowns(null);
    setTownFailed(false);
    if (!pref || !city) return;
    void fetch(`/api/towns?pref=${encodeURIComponent(pref)}&city=${encodeURIComponent(city)}`)
      .then((r) => r.json())
      .then((d: { towns?: string[] }) => {
        if (cancelled) return;
        if (d.towns && d.towns.length > 0) setTowns(d.towns);
        else setTownFailed(true);
      })
      .catch(() => {
        if (!cancelled) setTownFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [pref, city]);

  const compose = (t: string, b: string) => onChange(`${prefix}${t}${b}`);
  const cls = "mt-0.5 w-full rounded border border-line bg-surface px-2 py-1 text-xs font-semibold text-ink";

  return (
    <div className="mt-0.5 space-y-1.5">
      {prefix ? (
        <p className="rounded border border-line bg-surface-2 px-2 py-1 text-xs font-semibold text-ink-soft">
          {prefix}
          <span className="ml-1 text-[10px] font-normal">（エリアで選択済み）</span>
        </p>
      ) : (
        <p className="text-[11px] text-amber-700">先に「エリア」で都道府県と市区町村を選んでください。</p>
      )}
      {/*
        町域一覧が取れない（オフライン・API不調）ときは町域と番地を分けられないので、
        1つの手入力に落とす。分けられないまま2つの欄を出すと、どちらに何を書くのか
        わからなくなるため。
      */}
      {townFailed || !prefix ? (
        <input
          value={rest}
          placeholder="町域・番地・建物名（例: 長曽根町3-1-2 mbFASTビル1F）"
          onChange={(e) => onChange(`${prefix}${e.target.value}`)}
          className={cls}
        />
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2">
          <select
            value={town}
            disabled={towns === null}
            onChange={(e) => compose(e.target.value, banchi)}
            className={cls}
          >
            <option value="">{towns === null ? "読み込み中…" : "町域を選択"}</option>
            {(towns ?? []).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            value={banchi}
            placeholder="番地・建物名（例: 3-1-2 mbFASTビル1F）"
            onChange={(e) => compose(town, e.target.value)}
            className={cls}
          />
        </div>
      )}
    </div>
  );
}

export type StoreInfoTarget = {
  id: string;
  displayName: string;
  slug: string;
  active: boolean;
  info: StoreInfo;
  contactPerson: string;
  internalNote: string;
};

// 店舗情報（HP表示内容）の編集フォーム。
// 保存 → 差分プレビュー（WP現在値→新値・反映先URL・送信ペイロード）→ 確定で即時同期。
// フォーム項目は STORE_META_FIELDS（マッピング定義）から生成 = 定義と画面が絶対にズレない。
// scope="hq": 本部（任意店舗・アプリ専用項目・dry-run/再同期あり）
// scope="self": 加盟店（自分の店舗のみ・9項目だけ・slug/店舗名は変更不可）
export function StoreInfoEditor({
  store,
  onClose,
  scope = "hq",
}: {
  store: StoreInfoTarget;
  onClose?: () => void;
  scope?: "hq" | "self";
}) {
  const isHq = scope === "hq";
  const router = useRouter();
  const [info, setInfo] = useState<StoreInfo>(store.info);
  const [contactPerson, setContactPerson] = useState(store.contactPerson);
  const [internalNote, setInternalNote] = useState(store.internalNote);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<StorePreview | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const set = (field: StoreMetaField, v: string) => setInfo((old) => ({ ...old, [field]: v }));

  // 郵便番号 → エリア・所在地の自動入力（zipcloudをサーバー経由で検索）
  const [zip, setZip] = useState("");
  const [zipBusy, setZipBusy] = useState(false);
  const [zipMsg, setZipMsg] = useState<string | null>(null);
  const doZipLookup = async () => {
    setZipBusy(true);
    setZipMsg(null);
    try {
      const res = await fetch(`/api/zip?code=${encodeURIComponent(zip)}`);
      const d = (await res.json()) as { prefecture?: string; city?: string; town?: string; error?: string };
      if (!res.ok || !d.prefecture) {
        setZipMsg(d.error ?? "住所が見つかりませんでした");
        return;
      }
      /*
       * エリア（都道府県＋市区町村）と、所在地の町域までを埋める。
       * 所在地は「エリア＋町域」までを入れ、**番地から先だけを残す**。
       * 以前は入力済みなら何もしなかったため、市区町村を直したのに所在地が古いまま、
       * という食い違いが起きていた。番地・建物名（既に手で書いた分）は消さない。
       */
      const nextArea = `${d.prefecture}${d.city ?? ""}`;
      setInfo((old) => {
        // 旧値から番地以降を取り出す。旧エリア＋町域で始まっていればその後ろが番地
        const oldHead = `${old.area}`;
        const tail = oldHead && old.address.startsWith(oldHead)
          ? old.address.slice(oldHead.length).replace(new RegExp(`^${d.town ?? ""}`), "")
          : "";
        return {
          ...old,
          area: nextArea,
          address: `${nextArea}${d.town ?? ""}${tail}`,
        };
      });
      setZipMsg("✓ エリアと町域まで入れました（番地・建物名だけご入力ください）");
    } catch {
      setZipMsg("検索に失敗しました。手入力してください");
    } finally {
      setZipBusy(false);
    }
  };

  const doPreview = async () => {
    const errs = validateStoreInfo(info);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setBusy(true);
    setResult(null);
    try {
      const p = isHq ? await previewStoreInfo(store.id, info) : await previewMyStoreInfo(info);
      if (p.error) {
        setErrors(p.fieldErrors ?? {});
        setResult(`エラー: ${p.error}`);
      } else {
        setPreview(p);
      }
    } catch {
      setResult("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  const doCommit = async () => {
    setBusy(true);
    try {
      const r = isHq
        ? await commitStoreInfo(store.id, info, { contactPerson, internalNote })
        : await commitMyStoreInfo(info);
      setPreview(null);
      if (r.error) setResult(`エラー: ${r.error}`);
      else if (r.sync?.status === "success") setResult("✓ 保存し、WordPressへ反映しました");
      else if (r.sync?.status === "skipped") setResult("✓ 保存しました（WP側と同一内容のため送信なし）");
      else if (r.sync?.status === "blocked") setResult(`✓ 保存しました（同期対象外: ${r.sync?.error ?? ""}）`);
      else setResult(`保存しましたが同期に失敗しました: ${r.sync?.error ?? "不明"} — 下の「再同期」で再試行できます`);
      router.refresh();
    } catch {
      setResult("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  const doDryRun = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await runStoreSync(store.id, true);
      setResult(
        r.status === "dry-run"
          ? `dry-run: 差分 ${r.diffs?.length ?? 0} 項目（WPは変更していません）`
          : `dry-run不可: ${r.error ?? r.status}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const doResync = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await runStoreSync(store.id, false);
      setResult(r.status === "success" ? "✓ 再同期しました" : `再同期失敗: ${r.error ?? r.status}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-gold-300 bg-surface-2 p-3">
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-xs font-semibold">
          店舗情報（HP表示）: {store.displayName} <span className="font-mono text-ink-soft">/mbpit/{store.slug}/</span>
        </h4>
        {onClose && (
          <button type="button" onClick={onClose} className="ml-auto text-xs text-ink-soft hover:underline">
            閉じる
          </button>
        )}
      </div>
      {!store.active && (
        <p className="mb-2 text-[11px] text-amber-700">この店舗は停止中のため、保存してもWordPressへは同期されません。</p>
      )}
      {/* 郵便番号 → エリア・所在地の自動入力（表記統一のため。エリア絞り込みの基盤になる） */}
      <div className="mb-2 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-2">
        <label className="block text-[11px] text-ink-soft">
          郵便番号（ハイフン不要）
          <input
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            inputMode="numeric"
            maxLength={8}
            placeholder="5300001"
            className="mt-0.5 block w-32 rounded border border-line bg-surface px-2 py-1 font-mono text-xs font-semibold text-ink"
          />
        </label>
        <button
          type="button"
          disabled={busy || zipBusy}
          onClick={doZipLookup}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:bg-surface-2 disabled:opacity-50"
        >
          {zipBusy ? "検索中…" : "住所を自動入力"}
        </button>
        {zipMsg && <span className="text-[11px] text-ink-soft">{zipMsg}</span>}
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {STORE_META_FIELDS.map(({ field, label, maxLen, placeholder }) => (
          <label key={field} className={`block text-[11px] text-ink-soft ${field === "intro" ? "md:col-span-2" : ""}`}>
            {label}
            {field === "area" ? (
              <AreaSelect value={info.area} onChange={(v) => set("area", v)} />
            ) : field === "address" ? (
              <AddressFields
                area={info.area}
                value={info.address}
                onChange={(v) => set("address", v)}
              />
            ) : field === "intro" ? (
              <textarea
                value={info[field]}
                rows={3}
                maxLength={maxLen}
                onChange={(e) => set(field, e.target.value)}
                className="mt-0.5 w-full rounded border border-line bg-surface px-2 py-1 text-xs font-semibold text-ink"
              />
            ) : (
              <input
                value={info[field]}
                maxLength={maxLen}
                placeholder={placeholder}
                onChange={(e) => set(field, e.target.value)}
                className="mt-0.5 w-full rounded border border-line bg-surface px-2 py-1 text-xs font-semibold text-ink"
              />
            )}
            {errors[field] && <span className="mt-0.5 block text-red-600">{errors[field]}</span>}
          </label>
        ))}
        {isHq && (
          <>
            <label className="block text-[11px] text-ink-soft">
              担当者名（アプリ内のみ・WPへ送信しない）
              <input
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
                className="mt-0.5 w-full rounded border border-line bg-surface px-2 py-1 text-xs font-semibold text-ink"
              />
            </label>
            <label className="block text-[11px] text-ink-soft">
              社内メモ（アプリ内のみ・WPへ送信しない）
              <textarea
                value={internalNote}
                rows={2}
                onChange={(e) => setInternalNote(e.target.value)}
                className="mt-0.5 w-full rounded border border-line bg-surface px-2 py-1 text-xs font-semibold text-ink"
              />
            </label>
          </>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={doPreview}
          className="rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          保存（差分プレビュー）
        </button>
        {isHq && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={doDryRun}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:bg-surface disabled:opacity-50"
            >
              dry-run（保存済みデータで差分確認）
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={doResync}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:bg-surface disabled:opacity-50"
            >
              再同期
            </button>
          </>
        )}
        {result && <span className="text-xs">{result}</span>}
      </div>

      {/* 差分プレビュー（確定するまでWP・DBとも未変更） */}
      {preview && (
        <div className="mt-3 rounded-lg border border-line bg-surface p-3">
          <h5 className="text-xs font-bold">変更内容の確認 — {store.displayName}</h5>
          {preview.willSync === false && (
            <p className="mt-1 text-[11px] text-amber-700">{preview.syncBlockReason}</p>
          )}
          {(preview.diffs?.length ?? 0) === 0 ? (
            <p className="mt-1 text-xs text-ink-soft">WordPress側との差分はありません（保存のみ行います）。</p>
          ) : (
            <table className="mt-2 w-full text-xs">
              <thead className="text-left text-[11px] text-ink-soft">
                <tr><th className="py-1">項目</th><th>現在（WP）</th><th>変更後</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {preview.diffs!.map((d) => (
                  <tr key={d.metaKey}>
                    <td className="py-1 font-semibold">{d.label}</td>
                    <td className="text-ink-soft">{d.oldValue || "（未設定）"}</td>
                    <td>{d.newValue || <span className="text-red-600">（削除 → 表示から消えます）</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-[11px] text-ink-soft">
            反映先: {preview.targets?.map((t) => (
              <a key={t.url} href={t.url} target="_blank" rel="noopener" className="mr-2 text-sky-700 hover:underline">
                {t.label}
              </a>
            ))}
            （店舗ページ・ポータルカード・記事下カードに反映）
          </p>
          <details className="mt-1 text-[11px] text-ink-soft">
            <summary className="cursor-pointer">送信ペイロード（dry-run表示）</summary>
            <pre className="mt-1 overflow-x-auto rounded bg-surface-2 p-2 text-[10px]">{JSON.stringify(preview.payload, null, 2)}</pre>
          </details>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={doCommit}
              className="rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? "反映中…" : "確定して反映"}
            </button>
            <button type="button" onClick={() => setPreview(null)} className="text-xs text-ink-soft hover:underline">
              戻る
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
