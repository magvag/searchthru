const VERSION = "v1.14";
const DB_NAME = "bangDB";
const BANG_STORE_NAME = "bangData";
const DB_VERSION = 4;

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(VERSION).then((cache) => {
            return cache.addAll([
                "/",
                "/index.html",
                "global.css",
                "/router.js",
                "/loader.js",
                "/assets/favicon.png",
                "/assets/favicon.svg",
                "/data/kagi.json",
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

async function loadBangs(jsonPath, dbName) {
    try {
        const response = await fetch(jsonPath);
        if (!response.ok) throw new Error("Failed to fetch JSON");

        const data = await response.json();
        const request = indexedDB.open(dbName, DB_VERSION);

        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(BANG_STORE_NAME)) {
                db.createObjectStore(BANG_STORE_NAME, { keyPath: "key" });
            }
        };

        const transaction = db.transaction(BANG_STORE_NAME, "readwrite");
        const store = transaction.objectStore(BANG_STORE_NAME);

        Object.entries(data).forEach(([key, value]) => {
            store.put({ key, value });
        });

        await new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });

        localStorage.setItem("load_date", new Date().toISOString());
        console.log("JSON loaded into IndexedDB successfully.");
    } catch (error) {
        console.error("Error loading JSON:", error);
    }
}

self.addEventListener("activate", (event) => {
    event.waitUntil(loadBangs("data/bangs.json", DB_NAME));
    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    event.respondWith(
        caches.match(event.request).then((cached) => {
            return cached || fetch(event.request);
        }),
    );
});
