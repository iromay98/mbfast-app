import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import {
  normalizeChassis,
  parseShakenQr,
  vehicleFeatureEnabled,
  vehicleKeyFromChassis,
} from "@/server/pit/vehicle";

// マイカーページの「認証」: 車検証QR（車台番号）の現物を持っていること自体が
// オーナー性の実用的な証明。読み取れたら vehicleKey を cookie に保存して以後スキャン不要。
// 車台番号の平文はDBにもcookieにも保存しない。
export async function POST(request: NextRequest) {
  if (!vehicleFeatureEnabled()) {
    return Response.json({ error: "この機能は現在準備中です" }, { status: 503 });
  }
  let qr = "";
  try {
    const body = (await request.json()) as { qr?: string };
    qr = String(body.qr ?? "").trim();
  } catch {
    return Response.json({ error: "不正なリクエストです" }, { status: 400 });
  }
  if (!qr) return Response.json({ error: "QRまたは車台番号を入力してください" }, { status: 400 });

  const chassis = qr.includes("/") ? parseShakenQr(qr).chassis : normalizeChassis(qr);
  if (!chassis || chassis.length < 6) {
    return Response.json({ error: "車台番号を読み取れませんでした" }, { status: 400 });
  }

  const vehicleKey = vehicleKeyFromChassis(chassis);
  const vehicle = await prisma.pitVehicle.findUnique({
    where: { vehicleKey },
    select: { id: true },
  });
  if (!vehicle) {
    return Response.json(
      { error: "この車両の施工記録はまだ登録されていません（施工店での次回作業時に登録されます）" },
      { status: 404 },
    );
  }

  (await cookies()).set("mycar_key", vehicleKey, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 180 * 24 * 3600,
    path: "/",
  });
  return Response.json({ ok: true });
}
