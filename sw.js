const VERSION = "v1";

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(VERSION).then((cache) => {
            return cache.addAll([
                "/",
                "/index.html",
                "/global.css",
                "/router.js",
            ]);
        }),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((key) => key !== VERSION)
                        .map((key) => caches.delete(key)),
                ),
            ),
    );
    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    event.respondWith(
        caches.match(event.request).then((cached) => {
            return cached || fetch(event.request);
        }),
    );
});
