/*
 * mbFAST 最小サービスワーカー（PWA 対応）。
 * MVP ではアプリシェルの簡易キャッシュのみ。機微データ(API/ファイル)はキャッシュしない。
 */
const CACHE = "mbfast-shell-v1";
const SHELL = ["/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // GET 以外、認証/API/ファイル配信は常にネットワーク（キャッシュ禁止：機微情報のため）
  if (
    req.method !== "GET" ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/files/")
  ) {
    return;
  }

  // 静的アセットのみ cache-first
  if (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req)),
    );
  }
});
