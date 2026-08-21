"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadInChunks } from "@/lib/chunked-upload";
import { CHUNKED_MAX_BYTES, CHUNKED_MAX_MB, CHUNKED_THRESHOLD_BYTES } from "@/lib/upload-limits";
import { FileDropZone } from "@/components/file-drop-zone";
import { GENRES, normalizeGenreSlug } from "@/lib/mbpit-genres";
import { ShakenQrScanner, chassisFromQrText } from "@/components/shaken-qr-scanner";
import { PlateMosaicEditor } from "@/components/plate-mosaic-editor";
import {
  detectPlates,
  drawWithBlur,
  preloadPlateModel,
  type PlateBox,
} from "@/lib/plate-detect";
import {
  draftKey,
  saveDraftText,
  loadDraftText,
  clearDraftText,
  saveDraftPhotos,
  loadDraftPhotos,
  clearDraftPhotos,
} from "@/lib/pit-draft";

// 写真1枚分のぼかし編集状態
type PhotoItem = {
  file: File;
  url: string; // objectURL（端末内のみ）
  boxes: PlateBox[];
  previewUrl: string | null; // ぼかし適用後のサムネイル
  detecting: boolean;
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// ぼかし適用後のサムネイル（240px）を生成
async function makePreview(item: PhotoItem): Promise<string> {
  const img = await loadImage(item.url);
  const scale = Math.min(1, 240 / img.naturalWidth);
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  const ctx = c.getContext("2d")!;
  ctx.scale(scale, scale);
  drawWithBlur(ctx, img, img.naturalWidth, img.naturalHeight, item.boxes);
  return c.toDataURL("image/jpeg", 0.8);
}

// ぼかし適用済みのフル解像度JPEGを書き出す（これだけがサーバーへ送られる）
async function exportMosaicked(item: PhotoItem): Promise<Blob> {
  const img = await loadImage(item.url);
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d")!;
  drawWithBlur(ctx, img, img.naturalWidth, img.naturalHeight, item.boxes);
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("export failed"))), "image/jpeg", 0.92),
  );
}

// 投稿成功時に返るゲーミフィケーション統計
type PitStats = {
  total: number;
  month: number;
  lastMonth: number;
  streakWeeks: number;
  badge: { name: string; emoji: string } | null;
  next: { name: string; remaining: number } | null;
  rank: number | null;
  storeCount: number;
};

// ゴールドのカウントアップ演出
function CountUp({ to }: { to: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (to <= 0) return;
    const steps = Math.min(to, 24);
    let i = 0;
    const iv = setInterval(() => {
      i++;
      if (i >= steps) {
        setN(to);
        clearInterval(iv);
      } else {
        setN(Math.round((to * i) / steps));
      }
    }, 45);
    return () => clearInterval(iv);
  }, [to]);
  return <>{n}</>;
}

// Web Speech API の最小型（TS標準libに無いため。Chrome/Edge/Android は webkitSpeechRecognition）
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((e: {
        resultIndex: number;
        results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } };
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

/*
 * 音声認識のエラーを日本語にする。黙って止まるのが一番困るので、必ず理由を出す。
 * no-speech / aborted は「異常ではない」ので、この関数はメッセージを返さない扱いにする。
 */
function speechErrorMessage(code: string | undefined): string | null {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "マイクの使用が許可されていません。ブラウザのアドレスバーの🔒からマイクを許可してください。";
    case "audio-capture":
      return "マイクが見つかりません。端末のマイクを確認してください。";
    case "network":
      return "音声認識サーバーに接続できませんでした（通信環境をご確認ください）。";
    case "no-speech":
    case "aborted":
      return null; // 無音・停止操作。エラー表示はしない
    default:
      return code ? `音声認識が停止しました（${code}）。もう一度お試しください。` : null;
  }
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    | (new () => SpeechRecognitionLike)
    | null;
}

/** メモの上限。textarea の maxLength と音声入力の打ち切り判定で同じ値を使う */
const MEMO_MAX = 1000;

// 送信中に順番に見せる進捗メッセージ（実際の処理段階に対応）
const LOADING_STEPS = [
  "音声メモと写真を確認しています…",
  "写真を最適化しています（WebP変換）…",
  "AIが記事を執筆しています…",
  "ブログに公開しています…",
];

// 公式8ジャンル（本部管理）。定義は src/config/mbpit-genres.json が単一の正
const CATEGORIES: { value: string; label: string }[] = GENRES.map((g) => ({
  value: g.slug,
  label: g.label,
}));

// 店舗の投稿フォーム。入力は最小限（写真・車種・カテゴリ・任意メモ）。
// 送信 → サーバーでAI記事化＋WordPress公開 → 完了画面で公開URLを表示。
// storeId: 本部が任意の店舗として投稿する場合のみ指定（代理店はセッションから解決されるので不要）
// staged*: 施工証明のスタンバイ下書きから来たときの引き継ぎ（車種・カテゴリの初期値と元ID）
export function PitPostForm({
  storeId,
  stagedPostId,
  initialVehicle,
  initialCategory,
}: {
  storeId?: string;
  stagedPostId?: string;
  initialVehicle?: string;
  initialCategory?: string;
} = {}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // 分割アップロードの進捗（%）。null=分割送信していない
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<
    | { kind: "published"; url: string; title: string; stats: PitStats | null; vehicleLinked: boolean }
    | { kind: "held"; message: string; reviewPostId?: string }
    | null
  >(null);
  const formRef = useRef<HTMLFormElement>(null);
  // 施工日の既定値（今日・端末ローカル）。未来日は選べない
  const todayStr = new Date().toLocaleDateString("sv-SE");

  // ── ナンバープレートぼかし（ブラウザ内処理・生画像はサーバーに送らない） ──
  const [photoItems, setPhotoItems] = useState<PhotoItem[]>([]);
  const [editorIdx, setEditorIdx] = useState<number | null>(null);
  const [modelReady, setModelReady] = useState<boolean | null>(null); // null=判定中

  useEffect(() => {
    // 投稿UI表示時に検出モデルを非同期プリロード（未設置ならmanualのみ）
    void preloadPlateModel().then((l) => setModelReady(!!l));
  }, []);

  const MAX_PHOTOS = 10;

  // 追加方式: 選んだ写真は既存リストに「追加」する（置き換えない）。
  // 既にかけたぼかしはそのまま維持され、あとから写真を足してもやり直し不要。
  const handleFiles = (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    // 同じ写真（名前＋サイズ一致）の二重追加は除外し、上限10枚まで
    const fresh = imgs
      .filter((f) => !photoItems.some((o) => o.file.name === f.name && o.file.size === f.size))
      .slice(0, Math.max(0, MAX_PHOTOS - photoItems.length));
    if (fresh.length === 0) return;
    const added: PhotoItem[] = fresh.map((f) => ({
      file: f,
      url: URL.createObjectURL(f),
      boxes: [],
      previewUrl: null,
      detecting: true,
    }));
    setPhotoItems((old) => [...old, ...added]);
    // 追加分だけ自動検出（モデルがあれば）→ サムネイル生成。位置はファイル同一性で引き直す
    for (const f of fresh) {
      void (async () => {
        let boxes: PlateBox[] = [];
        try {
          const url = URL.createObjectURL(f);
          const img = await loadImage(url);
          const det = await detectPlates(img, img.naturalWidth, img.naturalHeight);
          boxes = det ?? [];
          URL.revokeObjectURL(url);
        } catch {
          boxes = [];
        }
        setPhotoItems((items) => {
          const i = items.findIndex((it) => it.file === f);
          if (i < 0) return items;
          const next = [...items];
          next[i] = { ...next[i], boxes, detecting: false };
          void makePreview(next[i]).then((p) =>
            setPhotoItems((cur) => {
              const j = cur.findIndex((it) => it.file === f);
              if (j < 0) return cur;
              const n2 = [...cur];
              n2[j] = { ...n2[j], previewUrl: p };
              return n2;
            }),
          );
          return next;
        });
      })();
    }
  };

  // 1枚だけ削除（✕ボタン）
  const removePhoto = (idx: number) => {
    setPhotoItems((items) => {
      const target = items[idx];
      if (target) URL.revokeObjectURL(target.url);
      return items.filter((_, i) => i !== idx);
    });
  };

  const saveBoxes = (idx: number, boxes: PlateBox[]) => {
    setPhotoItems((items) => {
      const next = [...items];
      next[idx] = { ...next[idx], boxes };
      void makePreview(next[idx]).then((p) =>
        setPhotoItems((cur) => {
          const n2 = [...cur];
          if (n2[idx]) n2[idx] = { ...n2[idx], previewUrl: p };
          return n2;
        }),
      );
      return next;
    });
    setEditorIdx(null);
  };

  // ── 車検証QR（お薬手帳への車両紐づけ・任意） ──
  const [scanning, setScanning] = useState(false);
  const [qrText, setQrText] = useState<string | null>(null);
  const [chassisManual, setChassisManual] = useState("");
  const [showManualChassis, setShowManualChassis] = useState(false);
  const chassisValue = qrText ?? (chassisManual.trim() || "");
  const chassisDisplay = qrText ? chassisFromQrText(qrText) : chassisManual.trim() || null;
  const chassisLast3 = chassisDisplay ? chassisDisplay.replace(/[^0-9]/g, "").slice(-3) : null;

  // ── 下書き対象の入力（stateで持ち、localStorage/IndexedDBへ自動保存する） ──
  // 施工証明から来たときは車種・カテゴリを初期値に入れる（端末内の下書きがあればそちらが優先）
  const [vehicle, setVehicle] = useState(initialVehicle ?? "");
  // 旧5区分時代の値（polish/other等）が下書きや施工証明から来ても現行ジャンルに読み替える
  const initialGenre = initialCategory ? normalizeGenreSlug(initialCategory) : null;
  const [category, setCategory] = useState(
    initialGenre && CATEGORIES.some((c) => c.value === initialGenre)
      ? initialGenre
      : CATEGORIES[0].value,
  );
  const [workDate, setWorkDate] = useState(todayStr);
  const [videoUrl, setVideoUrl] = useState("");

  // ── 音声入力（Web Speech API・対応ブラウザのみマイクボタンを表示） ──
  const [memo, setMemo] = useState("");
  const [interim, setInterim] = useState("");
  const [recording, setRecording] = useState(false);
  const [speechOk, setSpeechOk] = useState(false);
  const [speechMsg, setSpeechMsg] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  /*
   * 「利用者がまだ録音を続けたいか」。continuous=true でも実際には無音や回線の都揃いで
   * onend が勝手に飛ぶ（＝録音が黙って止まる）ので、意図と実際の状態を分けて持つ。
   * これが true のまま onend が来たら、こちらから再開する。
   */
  const wantRecRef = useRef(false);
  // 再開の暴走止め。連続で失敗し続けるときは諦めてメッセージを出す
  const restartsRef = useRef(0);
  /*
   * memo の現在値。認識結果の追記は onresult（Reactの外）から来るので、
   * 上限判定に使う値をここから読む（setMemoの更新関数内で副作用を起こさないため）。
   */
  const memoRef = useRef("");
  useEffect(() => {
    memoRef.current = memo;
  }, [memo]);
  /*
   * このセッションの土台になる本文（＝録音開始時の本文）。
   * 認識結果は「土台＋今回の確定文の全部」で**置き換える**ので、
   * Androidが確定済みを再通知しても本文が増殖しない。
   */
  const baseRef = useRef("");
  // 再開待ちのタイマー。停止・離脱時に必ず止める（止め忘れると勝手に再開する）
  const restartTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setSpeechOk(getSpeechRecognition() !== null);
    return () => {
      // 画面を離れるときは再開させない（stopだけだとonendで再開してしまう）
      wantRecRef.current = false;
      if (restartTimerRef.current !== null) clearTimeout(restartTimerRef.current);
      recRef.current?.abort();
    };
  }, []);

  // ── 下書き（端末内保存）: 入力途中でアプリが閉じても消えないようにする ──
  const dkey = draftKey(storeId);
  const [restored, setRestored] = useState(false); // 復元しました表示
  const [draftStatus, setDraftStatus] = useState<string | null>(null); // 「保存しました」表示
  const draftReady = useRef(false); // 復元完了までは保存しない（空で上書きしないため）

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const t = loadDraftText(dkey);
      if (t && !cancelled) {
        setMemo(t.memo);
        setVehicle(t.vehicle);
        if (t.category) {
          const g = normalizeGenreSlug(t.category);
          if (CATEGORIES.some((c) => c.value === g)) setCategory(g);
        }
        if (t.workDate) setWorkDate(t.workDate);
        setVideoUrl(t.videoUrl);
        if (t.chassisManual) {
          setChassisManual(t.chassisManual);
          setShowManualChassis(true);
        }
      }
      // 写真（ぼかし枠つき）も復元。失敗しても文字の復元は生かす
      try {
        const ps = await loadDraftPhotos(dkey);
        if (ps.length > 0 && !cancelled) {
          const items: PhotoItem[] = ps.map((p) => ({
            file: p.file,
            url: URL.createObjectURL(p.file),
            boxes: p.boxes ?? [],
            previewUrl: null,
            detecting: false,
          }));
          setPhotoItems(items);
          items.forEach((it, i) => {
            void makePreview(it).then((prev) =>
              setPhotoItems((cur) => {
                if (!cur[i] || cur[i].file !== it.file) return cur;
                const n = [...cur];
                n[i] = { ...n[i], previewUrl: prev };
                return n;
              }),
            );
          });
        }
      } catch {
        /* 写真の復元は諦める */
      }
      if (!cancelled && (t || true)) setRestored(!!t);
      draftReady.current = true;
    })();
    return () => {
      cancelled = true;
    };
    // dkey が変わる（本部が店舗を切替）ときは再読込
  }, [dkey]);

  // 文字入力の自動保存（打つたびではなく600ms止まってから）
  useEffect(() => {
    if (!draftReady.current) return;
    const t = setTimeout(() => {
      saveDraftText(dkey, { memo, vehicle, category, workDate, videoUrl, chassisManual });
      const has = memo || vehicle || videoUrl || chassisManual;
      if (has) setDraftStatus(`自動保存 ${new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}`);
    }, 600);
    return () => clearTimeout(t);
  }, [dkey, memo, vehicle, category, workDate, videoUrl, chassisManual]);

  // 写真とぼかし枠の自動保存（枚数・枠が変わったとき）
  useEffect(() => {
    if (!draftReady.current) return;
    const t = setTimeout(() => {
      if (photoItems.length === 0) {
        void clearDraftPhotos(dkey);
        return;
      }
      void saveDraftPhotos(
        dkey,
        photoItems.map((p) => ({ file: p.file, boxes: p.boxes })),
      );
    }, 800);
    return () => clearTimeout(t);
  }, [dkey, photoItems]);

  // 明示的な下書き保存（自動保存に任せず、押したら確実に保存されたと分かるように）
  const [saving, setSaving] = useState(false);
  const saveDraftNow = async () => {
    setSaving(true);
    try {
      saveDraftText(dkey, { memo, vehicle, category, workDate, videoUrl, chassisManual });
      if (photoItems.length > 0) {
        await saveDraftPhotos(
          dkey,
          photoItems.map((p) => ({ file: p.file, boxes: p.boxes })),
        );
      } else {
        await clearDraftPhotos(dkey);
      }
      setDraftStatus(`✓ ${new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })} に保存しました`);
    } catch {
      setDraftStatus("保存に失敗しました（端末の空き容量をご確認ください）");
    } finally {
      setSaving(false);
    }
  };

  const discardDraft = () => {
    clearDraftText(dkey);
    void clearDraftPhotos(dkey);
    setMemo("");
    setVehicle("");
    setCategory(CATEGORIES[0].value);
    setWorkDate(todayStr);
    setVideoUrl("");
    setChassisManual("");
    setQrText(null);
    photoItems.forEach((it) => URL.revokeObjectURL(it.url));
    setPhotoItems([]);
    setRestored(false);
    setDraftStatus(null);
    formRef.current?.reset();
  };

  // 送信中の進捗メッセージを順送り
  const [loadStep, setLoadStep] = useState(0);
  useEffect(() => {
    if (!busy) return;
    setLoadStep(0);
    const iv = setInterval(() => setLoadStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1)), 12000);
    return () => clearInterval(iv);
  }, [busy]);

  // 認識インスタンスを1つ作って動かす。onendでの自動再開もここから呼ぶ
  const startRecognition = () => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "ja-JP";
    rec.continuous = true;
    rec.interimResults = true;
    /*
     * ここが重複バグの本体だった。
     *
     * Android Chrome は `resultIndex` を信用できず、**確定済みの結果をもう一度通知**してくる。
     * 「resultIndex から後ろの isFinal を本文に追記する」方式だと、同じ言葉が何度も足され、
     * 喋るほど増殖して最後は上限に当たって止まる（iPhoneでは起きにくい）。
     *
     * なので追記をやめ、**毎回 results 全体から作り直して置き換える**。
     *   本文 = 録音開始時の本文(baseRef) + このセッションの確定文の全部
     * 同じ結果が何度通知されても、組み立て直した文字列は同じなので増えない。
     */
    rec.onresult = (e) => {
      let interimText = "";
      let sessionFinal = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) sessionFinal += r[0].transcript;
        else interimText += r[0].transcript;
      }
      // 声が届いた＝生きているので、再開回数の数え直し
      if (sessionFinal || interimText) restartsRef.current = 0;

      const next = baseRef.current + sessionFinal;
      if (next.length > MEMO_MAX) {
        // 上限に達したら黙って切り捨てるのではなく、止めて理由を伝える
        wantRecRef.current = false;
        recRef.current?.stop();
        setSpeechMsg(`メモが上限（${MEMO_MAX}文字）に達したので録音を止めました。`);
        setMemo(next.slice(0, MEMO_MAX));
      } else {
        setMemo(next);
      }
      setInterim(interimText);
    };
    rec.onend = () => {
      setInterim("");
      recRef.current = null;
      /*
       * 利用者がまだ録音したいなら、勝手に終わった分はこちらで再開する。
       * 再開時は**このセッションの確定文が本文に入り切っている**ので、
       * 次のセッションの土台を今の本文にし直す（しないと次の結果で前半が消える）。
       */
      if (wantRecRef.current) {
        baseRef.current = memoRef.current;
        if (restartsRef.current++ < 20) {
          /*
           * すぐ start() すると、前のセッションが完全に終わっていないAndroidで
           * InvalidStateError になることがある。少し待ってから開始する。
           */
          restartTimerRef.current = window.setTimeout(() => {
            restartTimerRef.current = null;
            if (!wantRecRef.current) return;
            try {
              startRecognition();
            } catch {
              wantRecRef.current = false;
              setRecording(false);
              setSpeechMsg("音声認識を再開できませんでした。もう一度タップしてください。");
            }
          }, 300);
          return;
        }
        setSpeechMsg("音声認識が繰り返し中断されたため停止しました。もう一度タップしてください。");
      }
      wantRecRef.current = false;
      setRecording(false);
    };
    rec.onerror = (e) => {
      const msg = speechErrorMessage(e.error);
      if (msg) {
        // 許可が無い・マイクが無い等は再開しても同じなので、ここで打ち切る
        wantRecRef.current = false;
        setSpeechMsg(msg);
      }
      setInterim("");
      // 実際の停止処理は onend が続けて呼ばれるのでそこに任せる
    };
    recRef.current = rec;
    rec.start();
  };

  const toggleVoice = () => {
    if (recording) {
      // 停止は「もう続けない」を先に立てる（onendでの自動再開を止めるため）
      wantRecRef.current = false;
      if (restartTimerRef.current !== null) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      recRef.current?.stop();
      return;
    }
    if (!getSpeechRecognition()) return;
    setSpeechMsg(null);
    setInterim("");
    restartsRef.current = 0;
    // 今の本文を土台にして、そこへ今回の認識結果を足していく
    baseRef.current = memoRef.current;
    wantRecRef.current = true;
    setRecording(true);
    try {
      startRecognition();
    } catch {
      wantRecRef.current = false;
      setRecording(false);
      setSpeechMsg("音声認識を開始できませんでした。もう一度お試しください。");
    }
  };

  /*
   * 録音中に本文を手で直したとき。
   * 土台を「直した後の本文」にし、認識セッションを作り直す
   * （作り直さないと、次の通知で今回のセッションの確定文がもう一度足され、直した内容が戻る）。
   */
  const onMemoEdit = (v: string) => {
    setMemo(v);
    memoRef.current = v;
    if (!recording) return;
    baseRef.current = v;
    // 編集による作り直しは「失敗」ではないので、再開回数に数えない
    // （数えると連続入力で上限に達し、勝手に録音が止まる）
    restartsRef.current = 0;
    // abort → onend で自動再開される（stopだと最後の確定結果が飛んできて上書きされる）
    recRef.current?.abort();
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setDone(null);
    const form = new FormData(e.currentTarget);
    const photos = form.getAll("photos").filter((f) => f instanceof File && f.size > 0);
    if (photos.length === 0 && photoItems.length === 0) {
      setError("写真を1枚以上追加してください");
      return;
    }
    const videoF = form.get("video");
    if (videoF instanceof File && videoF.size > CHUNKED_MAX_BYTES) {
      setError(
        `動画は${CHUNKED_MAX_MB}MB以下にしてください（長い場合は短く切り出すか、YouTubeのURLを貼ってください）`,
      );
      return;
    }
    setBusy(true);

    /*
     * 大きい動画は本送信に載せず、先に5MBずつの分割アップロードで送り切る。
     * 一括送信だとサーバーのメモリに丸ごと載って落ちるうえ、スマホ回線では
     * 数分待った末に原因不明のエラーになりやすい。分割なら途中の切断でも
     * そのチャンクだけ再送で済む。
     */
    if (videoF instanceof File && videoF.size > CHUNKED_THRESHOLD_BYTES) {
      try {
        setUploadPct(0);
        const up = await uploadInChunks(videoF, "/api/pit/upload", setUploadPct);
        form.delete("video");
        form.set("uploadedVideoKey", up.key);
      } catch (err) {
        setUploadPct(null);
        setBusy(false);
        setError(err instanceof Error ? err.message : "動画の送信に失敗しました");
        return;
      }
      setUploadPct(null);
    }
    // ぼかし適用済み画像に差し替えてから送信（未加工のナンバーをサーバーに送らない）
    try {
      if (photoItems.length > 0) {
        form.delete("photos");
        for (const item of photoItems) {
          if (item.boxes.length > 0) {
            const blob = await exportMosaicked(item);
            form.append("photos", blob, item.file.name.replace(/\.[^.]+$/, "") + "-blur.jpg");
          } else {
            form.append("photos", item.file);
          }
        }
      }
    } catch {
      setBusy(false);
      setError("画像の処理に失敗しました。もう一度お試しください。");
      return;
    }
    try {
      if (storeId) form.set("storeId", storeId);
      const res = await fetch("/api/pit/posts", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        url?: string;
        title?: string;
        message?: string;
        postId?: string; // review: 完了画面から確認プレビューへ直行するため
        error?: string;
        stats?: PitStats | null;
        vehicleLinked?: boolean;
      };
      if (data.status === "published" && data.url) {
        setDone({
          kind: "published",
          url: data.url,
          title: data.title ?? "",
          stats: data.stats ?? null,
          vehicleLinked: !!data.vehicleLinked,
        });
        formRef.current?.reset();
        setMemo("");
        setVehicle("");
        setVideoUrl("");
        setQrText(null);
        setChassisManual("");
        photoItems.forEach((it) => URL.revokeObjectURL(it.url));
        setPhotoItems([]);
        // 公開できたので下書きは破棄（残すと二重投稿の元になる）
        clearDraftText(dkey);
        void clearDraftPhotos(dkey);
        setRestored(false);
        router.refresh();
      } else if (data.status === "review" || data.status === "held") {
        setDone({
          kind: "held",
          message: data.message ?? "本部確認となりました。",
          // 公開前確認: 完了画面から確認プレビューへ直行できるようにIDを持つ
          reviewPostId: data.status === "review" ? data.postId : undefined,
        });
        formRef.current?.reset();
        setMemo("");
        setVehicle("");
        setVideoUrl("");
        photoItems.forEach((it) => URL.revokeObjectURL(it.url));
        setPhotoItems([]);
        clearDraftText(dkey);
        void clearDraftPhotos(dkey);
        setRestored(false);
        router.refresh();
      } else {
        setError(data.error ?? "送信に失敗しました。時間をおいて再度お試しください。");
      }
    } catch {
      setError("通信エラーが発生しました。電波の良い場所で再度お試しください。");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="space-y-3 py-2 text-center">
        {done.kind === "published" ? (
          <>
            <p className="text-3xl">🎉</p>
            <p className="text-sm font-bold">記事を公開しました！</p>
            {done.title && <p className="text-xs text-ink-soft">{done.title}</p>}
            <a
              href={done.url}
              target="_blank"
              rel="noopener"
              className="inline-block rounded-full bg-gold-500 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-gold-600"
            >
              記事を見る
            </a>

            {/* ゴールド演出: +1記録 と カウントアップ */}
            {done.stats && (
              <div className="mx-auto mt-3 max-w-sm rounded-2xl border border-gold-200 bg-gold-50 p-4 text-center">
                <p className="text-[11px] font-extrabold tracking-widest text-gold-600">＋1 記録</p>
                <div className="mt-2 flex items-end justify-center gap-8">
                  <div>
                    <div className="text-3xl font-black text-gold-600">
                      <CountUp to={done.stats.total} />
                    </div>
                    <div className="text-[10px] font-semibold text-ink-soft">通算記録</div>
                  </div>
                  <div>
                    <div className="text-3xl font-black text-ink">
                      <CountUp to={done.stats.month} />
                    </div>
                    <div className="text-[10px] font-semibold text-ink-soft">今月</div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-[11px] font-bold">
                  {done.stats.streakWeeks > 0 && (
                    <span className="rounded-full bg-orange-100 px-2.5 py-1 text-orange-700">
                      🔥 {done.stats.streakWeeks}週連続投稿中
                    </span>
                  )}
                  {done.stats.badge && (
                    <span className="rounded-full bg-gold-100 px-2.5 py-1 text-gold-700">
                      {done.stats.badge.emoji} {done.stats.badge.name}店
                    </span>
                  )}
                  {done.vehicleLinked && (
                    <span className="rounded-full bg-sky-100 px-2.5 py-1 text-sky-700">
                      🚗 お薬手帳に記録
                    </span>
                  )}
                </div>
                {done.stats.next && (
                  <p className="mt-2 text-[10px] text-ink-soft">
                    次の称号「{done.stats.next.name}」まで あと{done.stats.next.remaining}件
                  </p>
                )}
                <p className="mt-1 text-[10px] text-ink-soft">
                  先月{done.stats.lastMonth}件 → 今月{done.stats.month}件
                  {done.stats.rank && done.stats.storeCount > 1
                    ? `（今月の投稿数: 加盟${done.stats.storeCount}店中 ${done.stats.rank}位）`
                    : ""}
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-3xl">{done.reviewPostId ? "📝" : "🕐"}</p>
            <p className="text-sm font-bold">
              {done.reviewPostId ? "記事ができました（公開前の確認待ち）" : "本部確認となりました"}
            </p>
            <p className="text-xs text-ink-soft">{done.message}</p>
            {/*
              公開前確認の店舗は、ここから確認プレビューへ直行できるようにする。
              以前は一覧から自分で該当投稿を探して「本文を読む」を押す必要があり、
              確認フローをONにした店舗ほど手間が増えていた。
              storeId がある＝本部の代理投稿なので、行き先は本部の一覧にする。
            */}
            {done.reviewPostId && (
              <a
                href={
                  storeId
                    ? "/hq/pit"
                    : `/dealer/pit?preview=${encodeURIComponent(done.reviewPostId)}`
                }
                className="inline-block rounded-full bg-gold-500 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-gold-600"
              >
                内容を確認して公開する
              </a>
            )}
          </>
        )}
        <div>
          <button type="button" onClick={() => setDone(null)} className="text-xs text-sky-700 underline">
            続けて投稿する
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* 送信中: フォームを隠して進捗を見せる（AI解析中スピナー） */}
      {busy && (
        <div className="space-y-3 py-10 text-center">
          <div className="mx-auto h-11 w-11 animate-spin rounded-full border-4 border-line border-t-gold-500" />
          {uploadPct === null ? (
            <>
              <p className="text-sm font-bold text-ink">AIが記事を作成中…</p>
              <p className="text-xs text-ink-soft">{LOADING_STEPS[loadStep]}</p>
              <p className="text-[11px] text-ink-soft">1〜3分ほどかかります。画面を閉じずにお待ちください。</p>
            </>
          ) : (
            // 動画は分割送信するので実測の進捗を出す（無反応に見えると閉じられてしまう）
            <>
              <p className="text-sm font-bold text-ink">動画を送信中… {uploadPct}%</p>
              <div className="mx-auto h-1.5 w-56 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-gold-500 transition-all"
                  style={{ width: `${uploadPct}%` }}
                />
              </div>
              <p className="text-[11px] text-ink-soft">
                電波が途切れても、その部分だけ送り直します。画面を閉じずにお待ちください。
              </p>
            </>
          )}
        </div>
      )}

      <form ref={formRef} onSubmit={submit} className={busy ? "hidden" : "space-y-4"}>
        {/* 施工証明から来たスタンバイ下書きの引き継ぎ（投稿成功時にサーバー側で片付ける） */}
        {stagedPostId && <input type="hidden" name="stagedPostId" value={stagedPostId} />}
        {stagedPostId && (
          <div className="rounded-xl border border-gold-300 bg-gold-50 px-3 py-2 text-xs leading-relaxed text-ink">
            🧾 施工証明からの下書きです。写真と一言を足して公開してください。
            <span className="mt-0.5 block text-[11px] text-ink-soft">
              公開ブログにはお客様の氏名・住所・車台番号・金額は載りません。
            </span>
          </div>
        )}
        {/* 下書き: 自動保存に加えて明示的な保存ボタンを置く（保存された確信が持てるように） */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={saveDraftNow}
            className="rounded-lg border-2 border-gold-500 bg-surface px-3 py-1.5 text-xs font-bold text-ink disabled:opacity-50"
          >
            {saving ? "保存中…" : "💾 下書きを保存"}
          </button>
          {draftStatus && <span className="text-[11px] font-semibold text-ink-soft">{draftStatus}</span>}
          <span className="ml-auto text-[10px] text-ink-soft">この端末に保存されます</span>
        </div>

        {/* 下書きの復元通知（自動保存なので、勝手に文字が入っている理由を明示する） */}
        {restored && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gold-300 bg-gold-50 px-3 py-2">
            <span className="text-xs font-semibold text-ink">
              📝 前回の下書きを復元しました
            </span>
            <button
              type="button"
              onClick={discardDraft}
              className="ml-auto text-xs font-semibold text-red-600 hover:underline"
            >
              下書きを破棄して最初から
            </button>
          </div>
        )}
        {/* ── 音声入力ゾーン（大きなマイクボタン） ── */}
        <div className="pt-1 text-center">
          <p className="text-sm font-extrabold text-ink">🎤 今日の作業を話してください</p>
          {speechOk ? (
            <>
              <div className="relative mx-auto mt-4 h-24 w-24">
                {recording && (
                  <span className="absolute inset-0 animate-ping rounded-full bg-red-400 opacity-60" />
                )}
                <button
                  type="button"
                  onClick={toggleVoice}
                  className={`relative h-24 w-24 rounded-full text-4xl text-white shadow-lg transition ${
                    recording
                      ? "bg-red-600"
                      : "bg-gradient-to-br from-gold-400 to-gold-600 hover:from-gold-500 hover:to-gold-700"
                  }`}
                  aria-label={recording ? "録音停止" : "音声入力を開始"}
                >
                  {recording ? "■" : "🎤"}
                </button>
              </div>
              {recording ? (
                <p className="mt-3 text-xs font-bold text-red-600">録音中… もう一度タップで停止</p>
              ) : (
                <>
                  <p className="mt-3 text-sm font-extrabold text-ink">タップして話す（30秒でOK）</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
                    例:「アルファードのコーティング施工。撥水がしっかり出る仕上がりです」
                  </p>
                </>
              )}
            </>
          ) : (
            <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
              このブラウザは音声認識に対応していません。
              <br />
              下の入力欄で<b>キーボードのマイク（音声入力）</b>が使えます。
            </p>
          )}
        </div>

        {/*
          確定した文字だけを入れる。
          以前は途中結果(interim)も value に混ぜていたため、録音中に一文字でも触ると
          途中結果が本文に確定してしまい、その後に来る確定結果と**二重に入っていた**。
          途中結果は下に別表示する（送信されない・編集対象にもならない）。
        */}
        <textarea
          name="memo"
          rows={4}
          maxLength={MEMO_MAX}
          value={memo}
          onChange={(e) => onMemoEdit(e.target.value)}
          placeholder="音声認識の結果がここに入ります。手入力・修正もOK（任意。空でもAIが写真から記事を作ります）"
          className={`w-full rounded-xl border-2 bg-surface px-3 py-2.5 text-sm leading-relaxed text-ink ${
            recording ? "border-red-400" : "border-gold-500"
          }`}
        />
        {/* 認識途中の文字（確定すると上の欄に入る） */}
        {interim && (
          <p className="-mt-1 px-1 text-sm leading-relaxed text-ink-soft">
            {interim}
            <span className="ml-1 text-[11px] text-red-500">認識中…</span>
          </p>
        )}
        {speechMsg && (
          <p className="-mt-1 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
            {speechMsg}
          </p>
        )}

        {/* ── 車種・施工内容 ── */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold">
              車種 <span className="text-red-600">必須</span>
            </label>
            <input
              name="vehicle"
              required
              value={vehicle}
              onChange={(e) => setVehicle(e.target.value)}
              placeholder="例: アルファード 30系"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold">
              施工内容 <span className="text-red-600">必須</span>
            </label>
            <select
              name="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold">施工日</label>
            <input
              name="workDate"
              type="date"
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
              max={todayStr}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            />
            <p className="mt-1 text-[11px] text-ink-soft">
              あとからまとめて投稿するときは実際に施工した日に変更してください（記事の作業日に使われます）。
            </p>
          </div>
        </div>

        {/* ── 写真 ── */}
        <div>
          <label className="mb-1 block text-xs font-semibold">
            写真（1〜10枚） <span className="text-red-600">必須</span>
          </label>
          <FileDropZone
            name="photos"
            multiple
            accept="image/*"
            clearAfterSelect
            prompt={photoItems.length > 0 ? "＋ 写真を追加する" : "写真をここにドラッグ＆ドロップ"}
            onFiles={handleFiles}
          />
          <p className="mt-1 text-[11px] text-ink-soft">
            {photoItems.length > 0 && (
              <b>
                {photoItems.length}枚選択中（あと{MAX_PHOTOS - photoItems.length}枚追加できます）。
              </b>
            )}{" "}
            お客様のお顔や書類が写り込んでいない写真を選んでください。
          </p>

          {/* ナンバーぼかし: 写真ごとに「タップしてぼかす」帯で状態を明示（未ぼかし=オレンジ/済み=緑） */}
          {photoItems.length > 0 && (
            <div className="mt-2 rounded-xl border border-gold-300 bg-gold-50/60 p-2.5">
              <p className="text-xs font-bold text-ink">🖌 ナンバープレートのぼかし</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-soft">
                ナンバーが写っている写真は、<b>写真をタップ → 隠したい場所を指でなぞる</b>だけでぼかせます。
                {modelReady === false && "（自動検出は準備中のため手動でお願いします）"}
              </p>
              <div className="mt-2 flex gap-2 overflow-x-auto p-1">
                {photoItems.map((item, i) => (
                  <div key={item.url} className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditorIdx(i)}
                      className="relative block overflow-hidden rounded-lg border border-line"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.previewUrl ?? item.url}
                        alt=""
                        className="h-24 w-24 object-cover"
                      />
                      <span
                        className={`absolute inset-x-0 bottom-0 py-1 text-center text-[10px] font-bold text-white ${
                          item.detecting
                            ? "bg-sky-600/90"
                            : item.boxes.length > 0
                              ? "bg-green-600/90"
                              : "bg-amber-500/95"
                        }`}
                      >
                        {item.detecting ? "検出中…" : item.boxes.length > 0 ? `✓ ぼかし${item.boxes.length}箇所` : "タップしてぼかす"}
                      </span>
                    </button>
                    {/* 1枚だけ削除 */}
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      aria-label="この写真を削除"
                      className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs font-bold text-white"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-ink-soft">
                ぼかしは送信前にこの端末内で合成されます（未加工の写真はサーバーに送られません）。もう一度タップすれば修正・解除もできます。
              </p>
            </div>
          )}
        </div>

        {/* ── 動画（任意）: バブリング等のサウンド系はここが効く。URL貼付けを主経路にする ── */}
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <label className="mb-1 block text-xs font-semibold">🎬 動画（任意）</label>
          <input
            name="videoUrl"
            type="url"
            inputMode="url"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="https://youtu.be/xxxxxxxxxxx"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink"
          />
          <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
            <b>おすすめ</b>: YouTubeに「限定公開」でアップしてURLを貼るだけ。記事に再生プレイヤーが埋め込まれます（TikTok・Instagram・VimeoのURLも可）。
            <br />
            ※ Googleフォト・iCloud・ドライブの共有リンクは記事に埋め込めません。
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] font-semibold text-ink-soft">
              動画ファイルを直接アップする（{CHUNKED_MAX_MB}MBまで）
            </summary>
            <div className="mt-2">
              <FileDropZone name="video" accept="video/*" prompt="🎬 動画ファイルを選ぶ" />
              <p className="mt-1 text-[11px] text-ink-soft">
                アップ後にサーバーで自動圧縮されます（720p）。大きい動画は自動で分割送信するので、
                電波が不安定でも途中から再開できます。URLを入れた場合はURL側が使われます。<b>動画にはぼかし加工が入りません</b> —
                ナンバーやお客様の映り込みがないかご確認ください。
              </p>
            </div>
          </details>
        </div>

        {/* ── 車検証QR（お薬手帳・任意） ── */}
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">🚗 車のお薬手帳に記録（任意）</p>
            {chassisLast3 && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
                ✓ 車台番号 下3桁 ***{chassisLast3}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
            車検証のQRを読み取ると、この記録がお客様のマイカーページ（施工履歴・施工証明書）に紐づきます。
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setScanning(true)}
              className="rounded-lg border border-gold-300 bg-white px-3 py-1.5 text-xs font-bold text-gold-700"
            >
              📄 車検証QRをスキャン
            </button>
            <button
              type="button"
              onClick={() => setShowManualChassis((v) => !v)}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-soft"
            >
              手入力
            </button>
          </div>
          {showManualChassis && (
            <input
              value={chassisManual}
              onChange={(e) => {
                setChassisManual(e.target.value);
                setQrText(null);
              }}
              placeholder="車台番号（例: ZC33S-123456）"
              className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            />
          )}
          <input type="hidden" name="chassisNo" value={chassisValue} />
        </div>

        {error && <p className="text-xs font-semibold text-red-600">{error}</p>}

        {/* 下まで書いたところで中断される場合に備え、送信ボタンの手前にも保存を置く */}
        <button
          type="button"
          disabled={saving}
          onClick={saveDraftNow}
          className="w-full rounded-xl border-2 border-gold-500 bg-surface py-2.5 text-sm font-bold text-ink disabled:opacity-50"
        >
          {saving ? "保存中…" : "💾 下書きを保存して後で続ける"}
        </button>

        <button
          type="submit"
          className="w-full rounded-full bg-gold-500 px-4 py-3.5 text-sm font-extrabold text-white shadow-sm hover:bg-gold-600"
        >
          AIにおまかせしてブログ公開 →
        </button>
      </form>

      {scanning && (
        <ShakenQrScanner
          onText={(text) => {
            if (chassisFromQrText(text)) {
              setQrText(text);
              setScanning(false);
              return true;
            }
            return false;
          }}
          onClose={() => setScanning(false)}
        />
      )}

      {editorIdx !== null && photoItems[editorIdx] && (
        <PlateMosaicEditor
          src={photoItems[editorIdx].url}
          initialBoxes={photoItems[editorIdx].boxes}
          onSave={(boxes) => saveBoxes(editorIdx, boxes)}
          onClose={() => setEditorIdx(null)}
        />
      )}
    </>
  );
}
