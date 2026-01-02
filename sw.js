const VERSION = "v1.16";
const DB_NAME = "bangDB";
const BANG_STORE_NAME = "bangData";
const DB_VERSION = 4;
const BANGS_JSON_PATH = "/data/kagi.json";
const BANGS_TTL = 14 * 24 * 60 * 60 * 1000; // 2 weeks
const CACHED_AT_HEADER = "sw-cached-at";

self.addEventListener("install", (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(VERSION);

            await cache.addAll([
                "/",
                "/index.html",
                "/global.css",
                "/router.js",
                "/assets/favicon.png",
                "/assets/favicon.svg",
            ]);

            const res = await fetch(BANGS_JSON_PATH);
            const stamped = new Response(res.body, {
                headers: {
                    ...Object.fromEntries(res.headers),
                    [CACHED_AT_HEADER]: Date.now().toString(),
                },
            });

            await cache.put(BANGS_JSON_PATH, stamped);
        })(),
    );
});

async function loadBangs() {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(BANGS_JSON_PATH);

    // some code to auto update bangs every 2 weeks
    // since it’s called upon activation, and SW is activated after routing,
    // no performance loss should happen
    let response = cached;

    if (cached) {
        const cachedAt = Number(cached.headers.get(CACHED_AT_HEADER));
        if (!cachedAt || Date.now() - cachedAt > BANGS_TTL) {
            await cache.delete(BANGS_JSON_PATH);
            response = null;
        }
    }

    if (!response) {
        const res = await fetch(BANGS_JSON_PATH);
        response = new Response(res.body, {
            headers: {
                ...Object.fromEntries(res.headers),
                [CACHED_AT_HEADER]: Date.now().toString(),
            },
        });
        await cache.put(BANGS_JSON_PATH, response.clone());
    }

    const data = await response.json();

    try {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(BANG_STORE_NAME)) {
                    db.createObjectStore(BANG_STORE_NAME, { keyPath: "key" });
                }
            };

            request.onsuccess = (e) => {
                const db = e.target.result;

                const transaction = db.transaction(
                    BANG_STORE_NAME,
                    "readwrite",
                );
                const store = transaction.objectStore(BANG_STORE_NAME);

                Object.entries(data).forEach(([key, value]) => {
                    store.put({ key, value });
                });

                transaction.oncomplete = () => {
                    console.log(
                        `Loaded ${Object.keys(data).length} bangs into IndexedDB successfully.`,
                    );
                    db.close();
                    resolve();
                };

                transaction.onerror = () => reject(transaction.error);
            };
        });
    } catch (error) {
        console.error("Error loading bangs into DB", error);
    }
}

self.addEventListener("activate", (event) => {
    event.waitUntil(
        Promise.all([
            caches
                .keys()
                .then((keys) =>
                    Promise.all(
                        keys
                            .filter((key) => key !== VERSION)
                            .map((key) => caches.delete(key)),
                    ),
                ),
            loadBangs(),
        ]),
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
