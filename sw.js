const VERSION = "v1.17";
const DB_NAME = "bangDB";
const BANG_STORE_NAME = "bangData";
const CACHE_STORE_NAME = "bangCache";
const DB_VERSION = 5;
const BANGS_JSON_PATH = "/data/kagi.json";
const MONTH = 31 * 24 * 60 * 60 * 1000;

async function loadBangs() {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(BANGS_JSON_PATH);
    let response = cached;

    // If no cached version, fetch from network
    if (!response) {
        response = await fetch(BANGS_JSON_PATH);
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

                if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
                    db.createObjectStore(CACHE_STORE_NAME, { keyPath: "key" });
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
            await cache.put(BANGS_JSON_PATH, res);
            await loadBangs();
        })(),
    );
});

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

self.addEventListener("message", async (e) => {
    if (e.data?.type !== "UPDATE_DB") return;

    const cache = await caches.open(VERSION);
    const cached = await cache.match(BANGS_JSON_PATH);

    let expired = true;

    if (cached) {
        const lastModifiedHeader = cached.headers.get("Last-Modified");
        if (lastModifiedHeader) {
            const cachedDate = new Date(lastModifiedHeader).getTime();
            const now = Date.now();
            expired = now - cachedDate > MONTH;
        }
    }

    if (expired) {
        const res = await fetch(BANGS_JSON_PATH);
        await cache.put(BANGS_JSON_PATH, res);
        await loadBangs();

        e.source?.postMessage({ type: "UPDATED" });
    } else {
        e.source?.postMessage({ type: "UP_TO_DATE" });
    }
});
