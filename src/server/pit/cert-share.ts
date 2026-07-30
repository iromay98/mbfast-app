import { headers } from "next/headers";
import { qrSvg } from "@/lib/qr-svg";

/*
 * 証明書に載せる検証用QR。
 * 共有URL（/cert/[token]）の絶対URLを入れる＝紙を受け取った第三者がその場で
 * 内容とハッシュを確認できる。未発行（下書き）にはQRを出さない。
 */
export async function publicOrigin(): Promise<string> {
  const fromEnv = (process.env.PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || "").trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : "";
}

export async function certVerifyQr(cert: {
  status: string;
  shareToken: string;
  shareRevoked: boolean;
}): Promise<{ verifyUrl?: string; verifyQrSvg?: string }> {
  if (cert.status !== "issued" || cert.shareRevoked) return {};
  const origin = await publicOrigin();
  if (!origin) return {};
  const verifyUrl = `${origin}/cert/${cert.shareToken}`;
  return { verifyUrl, verifyQrSvg: qrSvg(verifyUrl, 112) };
}
