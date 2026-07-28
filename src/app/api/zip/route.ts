import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/authz";

// 郵便番号 → 住所（都道府県・市区町村・町域）。
// zipcloud（日本郵便データベースの無料検索API・キー不要）をサーバー経由で呼ぶ。
// ブラウザから直接呼ばずここを経由する理由: CORS回避＋ログイン必須にして開放プロキシ化を防ぐ。
// 将来 zipcloud が不安になったら、日本郵便の ken_all.csv を自前DBに取り込んでここだけ差し替える。
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "ログインしてください" }, { status: 401 });

  const code = (new URL(request.url).searchParams.get("code") ?? "").replace(/[^0-9]/g, "");
  if (!/^\d{7}$/.test(code)) {
    return Response.json({ error: "郵便番号は7桁の数字で入力してください" }, { status: 400 });
  }

  try {
    const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${code}`, {
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as {
      status: number;
      results: { address1: string; address2: string; address3: string }[] | null;
    };
    const r = data.results?.[0];
    if (!r) return Response.json({ error: "該当する住所が見つかりません" }, { status: 404 });
    return Response.json({
      prefecture: r.address1, // 例: 大阪府
      city: r.address2, // 例: 堺市北区
      town: r.address3, // 例: 長曽根町
    });
  } catch {
    return Response.json({ error: "住所検索サービスに接続できませんでした。手入力してください" }, { status: 502 });
  }
}
