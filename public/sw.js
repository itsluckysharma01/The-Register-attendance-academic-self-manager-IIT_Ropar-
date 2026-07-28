const CACHE_NAME = "the-register-v1";
const ASSETS = ["./index.html", "./manifest.json", "./app.js", "./style.css"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});

// This is what makes reminders arrive even when the site isn't open in a
// tab: the browser wakes this service worker up when a push arrives from
// the server, and it shows a real system notification.
self.addEventListener("push", (event) => {
  let payload = { title: "Attendance reminder", body: "" };
  try {
    payload = event.data.json();
  } catch (e) {
    if (event.data) payload.body = event.data.text();
  }
  event.waitUntil(self.registration.showNotification(payload.title, { body: payload.body }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow("./");
    })
  );
});
