
const CACHE_NAME = "pocket-notebook-cache-v1";
const APP_SCOPE = self.registration.scope;

const APP_FILES = [
  new URL("./", APP_SCOPE).href,
  new URL("./index.html", APP_SCOPE).href,
  new URL("./manifest.json", APP_SCOPE).href,
  new URL("./pocket-notebook-192.png", APP_SCOPE).href,
  new URL("./pocket-notebook-512.png", APP_SCOPE).href
];

// Install
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

// Activate
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

// Background Push Notification
self.addEventListener("push", event => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = {};
  }

  const title = data.title || "Pocket Notebook";

  const options = {
    body: data.body || "আপনার নোটের রিমাইন্ডার এসেছে।",
    icon: "./pocket-notebook-192.png",
    badge: "./pocket-notebook-192.png",

    data: {
      noteId: data.noteId || null
    },

    tag: data.noteId
      ? "pocket-note-" + data.noteId
      : "pocket-notebook-reminder"
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification Click Handler
self.addEventListener("notificationclick", event => {
  event.notification.close();

  const noteId = event.notification.data?.noteId;

  event.waitUntil((async () => {
    // নোটের ID সহ অ্যাপের URL তৈরি
    const url = new URL("./", APP_SCOPE);

    if (noteId) {
      url.searchParams.set("reminderNote", noteId);
    }

    const targetUrl = url.href;

    // আগে থেকে খোলা Pocket Notebook খুঁজে বের করা
    const windowClients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });

    for (const client of windowClients) {
      if (client.url.startsWith(APP_SCOPE)) {

        // নির্দিষ্ট নোটের URL-এ অ্যাপকে নিয়ে যাওয়া
        try {
          await client.navigate(targetUrl);
        } catch (error) {
          // Navigate ব্যর্থ হলে পুরোনো পদ্ধতিতে মেসেজ পাঠানো
          client.postMessage({
            type: "OPEN_REMINDER_NOTE",
            noteId: noteId || null
          });
        }

        await client.focus();
        return;
      }
    }

    // অ্যাপ আগে থেকে খোলা না থাকলে নতুন করে খোলা
    await self.clients.openWindow(targetUrl);

  })());
});

// Fetch Handler
self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Supabase JS CDN caching
  if (
    url.hostname === "cdn.jsdelivr.net" &&
    url.pathname.includes("supabase-js")
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(request);

        const network = fetch(request)
          .then(response => {
            if (
              response &&
              (response.ok || response.type === "opaque")
            ) {
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

  // অন্য origin-এর request Service Worker পরিচালনা করবে না
  if (url.origin !== self.location.origin) return;

  // Navigation requests
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();

            caches.open(CACHE_NAME)
              .then(cache => cache.put(request, copy));
          }

          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);

          return (
            (await cache.match(request)) ||
            (await cache.match(
              new URL("./index.html", APP_SCOPE).href
            )) ||
            (await cache.match(
              new URL("./", APP_SCOPE).href
            ))
          );
        })
    );

    return;
  }

  // অন্যান্য ফাইলের Cache First
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();

          caches.open(CACHE_NAME)
            .then(cache => cache.put(request, copy));
        }

        return response;
      });
    })
  );
});
