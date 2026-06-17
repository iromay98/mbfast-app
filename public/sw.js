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

// Web Push: 受信したら通知を表示
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "mbFAST", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "mbFAST";
  const options = {
    body: data.body || "",
    tag: data.tag || "mbfast",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// 通知クリック: 該当ページを開く（既に開いていればフォーカス）
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
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
