const SHELL_CACHE = "bbz-shell-v2";
const AUDIO_CACHE = "bbz-audio-v2";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./assets/css/style.css",
  "./assets/js/app.js",
  "./assets/js/audio-engine.js",
  "./assets/js/playlist.js",
  "./assets/js/storage.js",
  "./assets/js/constants.js",
  "./assets/js/manifest.js",
  "./app.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== SHELL_CACHE && key !== AUDIO_CACHE) {
            return caches.delete(key);
          }
          return null;
        }),
      ),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") {
    return;
  }

  if (url.pathname.startsWith("/assets/sounds/")) {
    event.respondWith(handleAudioRequest(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(
      (cached) => cached || fetch(event.request),
    ),
  );
});

async function handleAudioRequest(request) {
  const cache = await caches.open(AUDIO_CACHE);
  const cachedResponse = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      cache.put(request, response.clone());
      return response;
    })
    .catch(() => cachedResponse);

  return cachedResponse || fetchPromise;
}
