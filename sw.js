const VERSION = "v1.21";

const DB_NAME = "bangDB";
const DB_SCHEMA = 5;
const BANG_STORE_NAME = "bangData";
const CACHE_STORE_NAME = "bangCache";
const BANG_JSON_PATH = "/data/kagi.json";

const DEFAULT_BANG = "_default";
const FALLBACK_BANG_RULES = { u: "https://duckduckgo.com/?q={{{s}}}" };

const MONTH = 31 * 24 * 60 * 60 * 1000;

const openDB = () =>
    new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_SCHEMA);

        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(BANG_STORE_NAME)) {
                db.createObjectStore(BANG_STORE_NAME, { keyPath: "key" });
            }
            if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
                db.createObjectStore(CACHE_STORE_NAME, { keyPath: "key" });
            }
        };

        request.onerror = () => reject(request.error);
        request.onsuccess = (e) => resolve(e.target.result);
    });

const getBangRulesFromDB = (db, bang) =>
    new Promise((resolve) => {
        if (db.objectStoreNames.contains(CACHE_STORE_NAME)) {
            const tx = db.transaction(CACHE_STORE_NAME, "readonly");
            const store = tx.objectStore(CACHE_STORE_NAME);
            const req = store.get(bang);

            req.onsuccess = () => {
                if (req.result?.value) {
                    resolve(req.result.value);
                    return;
                }
                tryBangData();
            };
            req.onerror = () => tryBangData();
        } else {
            tryBangData();
        }

        function tryBangData() {
            // if bang is private, do not check bangData
            if (bang.startsWith("_")) {
                resolve(null);
                return;
            }

            const tx = db.transaction(BANG_STORE_NAME, "readonly");
            const store = tx.objectStore(BANG_STORE_NAME);
            const req = store.get(bang);

            req.onsuccess = () => {
                const bangRules = req.result?.value;
                if (bangRules) {
                    const cacheTx = db.transaction(
                        CACHE_STORE_NAME,
                        "readwrite",
                    );
                    const cacheStore = cacheTx.objectStore(CACHE_STORE_NAME);
                    cacheStore.put({ key: bang, value: bangRules });
                }
                resolve(bangRules || null);
            };
            req.onerror = () => resolve(null);
        }
    });

async function getDefaultBang(db, searchQuery) {
    const bangRules = await getBangRulesFromDB(db, DEFAULT_BANG);
    if (bangRules) {
        return { searchQuery, bang: DEFAULT_BANG, bangRules };
    }
    return {
        searchQuery,
        bang: "ddg",
        bangRules: FALLBACK_BANG_RULES,
    };
}

async function getBang(db, query) {
    const foundBangs = query.match(/![^!\s]+/g) ?? [];
    let searchQuery = query;

    // fallback for incognito, while service workers starts loading DB
    if (!indexedDB.databases) {
        return { searchQuery, bang: "ddg", bangRules: FALLBACK_BANG_RULES };
    }

    const seen = new Set(); // to account for duplicated invalid bangs

    // order is important "query !g !gh" should redirect to Google
    for (let i = 0; i < foundBangs.length; i++) {
        const foundBang = foundBangs[i].slice(1);
        const key = foundBang.toLowerCase();

        if (seen.has(key)) continue; // saves 10ms per DB transaction
        seen.add(key);

        const bangRules = await getBangRulesFromDB(db, key);

        if (bangRules) {
            searchQuery = searchQuery
                .replace(new RegExp(`!${foundBang}(?=\\s|$)`), "")
                .trim();
            return { searchQuery, bang: key, bangRules };
        }
    }

    return getDefaultBang(db, searchQuery);
}

function parseSearchOperators(template) {
    const hasSearchOperator = template.startsWith("{{{s}}}");
    const siteMatch = template.match(/\+site:\(?https?:\/\/([^)+]+)\)?/);
    const siteOperator = siteMatch ? `https://${siteMatch[1]}` : null;

    return { hasSearchOperator, siteOperator };
}

async function getRedirectURL(searchQuery, bang, bangRules, db) {
    if (!bangRules) return null;

    const { hasSearchOperator, siteOperator } = parseSearchOperators(
        bangRules.u,
    );

    let fmt = bangRules.fmt ?? [];

    // with empty query, open homepage or search page
    if (!searchQuery) {
        const allowsBaseOpen =
            !fmt.length ||
            fmt.includes("open_base_path") ||
            fmt.includes("open_snap_domain");

        if (allowsBaseOpen) {
            const baseUrl = bangRules.ad
                ? "https://" + bangRules.ad // alternative domain
                : siteOperator; // or domain parsed from +site:***

            if (baseUrl) return baseUrl;

            // otherwise try to open homepage
            const stripped = bangRules.u.replace("{{{s}}}", "");
            try {
                return new URL(stripped).origin;
            } catch {}
        }

        // "{{{s}}}+filetype:pdf" → "+filetype:pdf"
        return bangRules.u.replace("{{{s}}}", "");
    }

    // "query !pdf" → "searchengine.com/?q=query+filetype:pdf"
    let defaultBangRules = null;
    if (hasSearchOperator) {
        searchQuery = bangRules.u.replace("{{{s}}}", searchQuery);
        const { searchQuery, defaultBang, defaultBangRules } =
            await getDefaultBang(db, searchQuery);
        fmt = defaultBangRules.fmt ?? [];
    }

    let encodedQuery = encodeQuery(searchQuery, fmt);

    const template = defaultBangRules?.u ?? bangRules.u;
    return template.replace("{{{s}}}", encodedQuery);
}

// encodeQuery function remains the same
function encodeQuery(query, fmt) {
    let encodeQuery = false;
    let spaceToPlus = false;

    if (
        !fmt.length ||
        (fmt.includes("url_encode_placeholder") &&
            fmt.includes("url_encode_space_to_plus"))
    ) {
        encodeQuery = true;
        spaceToPlus = true;
    } else if (fmt.includes("url_encode_placeholder")) {
        encodeQuery = true;
    }

    if (encodeQuery) {
        query = encodeURIComponent(query);
        if (spaceToPlus) {
            query = query.replace(/%20/g, "+");
        }
    }

    return query;
}

async function loadBangs() {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(BANG_JSON_PATH);
    let response = cached;

    // If no cached version, fetch from network
    if (!response) {
        response = await fetch(BANG_JSON_PATH);
    }

    const data = await response.json();

    try {
        const db = await openDB();
        const transaction = db.transaction(BANG_STORE_NAME, "readwrite");
        const store = transaction.objectStore(BANG_STORE_NAME);

        Object.entries(data).forEach(([key, value]) => {
            store.put({ key, value });
        });

        await new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });

        console.log(
            `Loaded ${Object.keys(data).length} bangs into IndexedDB successfully.`,
        );
        db.close();
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
                "/interface.js",
                "/ui/en.json",
                "/ui/ru.json",
                "/assets/favicon.png",
                "/assets/favicon.svg",
            ]);

            const res = await fetch(BANG_JSON_PATH);
            await cache.put(BANG_JSON_PATH, res);
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
        (async () => {
            if (event.request.mode === "navigate") {
                const url = new URL(event.request.url);
                const query = url.searchParams.get("q")?.trim() ?? "";

                if (query) {
                    let db;
                    try {
                        db = await openDB();
                        const { searchQuery, bang, bangRules } = await getBang(
                            db,
                            query,
                        );
                        const redirectUrl = await getRedirectURL(
                            searchQuery,
                            bang,
                            bangRules,
                            db,
                        );
                        if (redirectUrl) {
                            return Response.redirect(redirectUrl, 302);
                        }
                    } catch {
                    } finally {
                        db?.close();
                    }
                }

                const cachedIndex = await caches.match("/index.html");
                return cachedIndex || fetch("/index.html");
            }

            const cached = await caches.match(event.request);
            return cached || fetch(event.request);
        })(),
    );
});

self.addEventListener("message", async (e) => {
    const messageType = e.data?.type;
    if (messageType !== "UPDATE_DB" && messageType !== "LOAD_DB") return;

    const cache = await caches.open(VERSION);
    const cached = await cache.match(BANG_JSON_PATH);

    let expired = true;

    if (cached) {
        const lastModifiedHeader = cached.headers.get("Last-Modified");
        if (lastModifiedHeader) {
            const cachedDate = new Date(lastModifiedHeader).getTime();
            const now = Date.now();
            expired = now - cachedDate > MONTH;
        }
    }

    if (messageType === "LOAD_DB") {
        let db;
        try {
            db = await openDB();
            const tx = db.transaction(BANG_STORE_NAME, "readonly");
            const store = tx.objectStore(BANG_STORE_NAME);
            const count = await new Promise((resolve) => {
                const req = store.count();
                req.onsuccess = () => resolve(req.result || 0);
                req.onerror = () => resolve(0);
            });

            if (count === 0) {
                await loadBangs();
                e.source?.postMessage({ type: "UPDATED" });
                return;
            }
        } catch {
        } finally {
            db?.close();
        }

        e.source?.postMessage({ type: "UP_TO_DATE" });
        return;
    }

    if (expired) {
        const res = await fetch(BANG_JSON_PATH);
        await cache.put(BANG_JSON_PATH, res);
        await loadBangs();
        e.source?.postMessage({ type: "UPDATED" });
        return;
    }

    e.source?.postMessage({ type: "UP_TO_DATE" });
});
