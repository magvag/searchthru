const VERSION = "v1.15";
const DB_NAME = "bangDB";
const BANG_STORE_NAME = "bangData";
const DB_VERSION = 4;
const BANGS_JSON_PATH = "/data/kagi.json";

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(VERSION).then((cache) => {
            return cache.addAll([
                "/",
                "/index.html",
                "global.css",
                "/router.js",
                "/assets/favicon.png",
                "/assets/favicon.svg",
                BANGS_JSON_PATH,
            ]);
        }),
    );
});

async function loadBangs() {
    try {
        const cached = await caches.match(BANGS_JSON_PATH);
        const response = cached || (await fetch(BANGS_JSON_PATH));
        if (!response.ok) throw new Error("Failed to fetch JSON");

        const data = await response.json();

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
                    localStorage.setItem("load_date", new Date().toISOString());
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
