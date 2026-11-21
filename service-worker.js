
const CACHE_NAME = "pocket-notebook-cache-v1";
const APP_SCOPE = self.registration.scope;

const APP_FILES = [
  new URL("./", APP_SCOPE).href,
  new URL("./index.html", APP_SCOPE).href,
  new URL("./manifest.json", APP_SCOPE).href,
  new URL("./pocket-notebook-192.png", APP_SCOPE).href,
  new URL("./pocket-notebook-512.png", APP_SCOPE).href
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key =>
            key.startsWith("pocket-notebook-cache-") &&
            key !== CACHE_NAME
          )
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Notification click handler
self.addEventListener("notificationclick", event => {
  event.notification.close();

  const noteId = event.notification.data?.noteId;

  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });

    for (const client of windowClients) {
      if (client.url.startsWith(APP_SCOPE)) {
        await client.focus();

        client.postMessage({
          type: "OPEN_REMINDER_NOTE",
          noteId: noteId || null
        });

        return;
      }
    }

    const url = new URL("./", APP_SCOPE);
    if (noteId) {
      url.searchParams.set("reminderNote", noteId);
    }

    await self.clients.openWindow(url.href);
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (
    url.hostname === "cdn.jsdelivr.net" &&
    url.pathname.includes("supabase-js")
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(request);

        const network = fetch(request)
          .then(response => {
            if (response && (response.ok || response.type === "opaque")) {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => cached);

        return cached || network;
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      }).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return (
          (await cache.match(request)) ||
          (await cache.match(new URL("./index.html", APP_SCOPE).href)) ||
          (await cache.match(new URL("./", APP_SCOPE).href))
        );
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
