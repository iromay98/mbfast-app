import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/authz";
import { readShakenPdf } from "@/server/pit/shaken-ocr";

/*
 * Web Share Target: **Androidの共有シート**から車検証PDFを直接受け取る。
 *
 * 使い方（利用者側）: 車検証閲覧アプリでPDFを表示 → 共有 → mbFAST を選ぶ
 *   → この経路でPDFが届き、車両登録の画面が値入りで開く。
 *
 * **iPhoneでは動きません。** iOS(WebKit)はWeb Share Target APIに非対応で、
 * Webアプリを共有先に出す手段がありません（ネイティブアプリのShare Extensionが必要）。
 * iPhoneでは従来どおり「ファイルに保存 → アプリでPDFを選ぶ」を案内する。
 * 前提: ホーム画面に追加（PWAインストール）済みのAndroid Chrome。
 *
 * 値の受け渡し:
 *   PDFはここで読み取って**捨てる**（保存しない）。読み取った項目だけを
 *   httpOnly の短命クッキーに入れて車両登録画面へ渡す（DBには何も書かない）。
 *   氏名・住所を含むため maxAge を5分にし、パスも登録画面に限定する。
 */
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024;
export const SHARED_COOKIE = "mbfast_shared_shaken";
const TARGET = "/dealer/pit/vehicles";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  // 未ログインならログインへ。共有の内容は捨てる（保存しない）
  if (!user) return redirect(`/login?next=${encodeURIComponent(TARGET)}`);

  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    file = null;
  }
  if (!file) return redirect(`${TARGET}?shared=error`);
  if (file.size > MAX_BYTES) return redirect(`${TARGET}?shared=toobig`);

  // PDF以外（画像など）が共有されたら、画面のファイル選択へ誘導する
  const head = Buffer.from(await file.slice(0, 5).arrayBuffer()).toString("latin1");
  if (head !== "%PDF-" && file.type !== "application/pdf") {
    return redirect(`${TARGET}?shared=notpdf`);
  }

  const { result } = await readShakenPdf(Buffer.from(await file.arrayBuffer()));
  if (!result) return redirect(`${TARGET}?shared=unreadable`);

  const jar = await cookies();
  jar.set(SHARED_COOKIE, JSON.stringify(result.fields), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: TARGET,
    maxAge: 300, // 5分で自動失効（氏名・住所を含むため長く残さない）
  });
  return redirect(`${TARGET}?shared=1`);
}

function redirect(to: string) {
  // 303: POSTの後にGETで開かせる（共有シートからの遷移で再POSTさせない）
  return new Response(null, { status: 303, headers: { Location: to, "cache-control": "no-store" } });
}
