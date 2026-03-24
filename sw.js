const VERSION = "v1.20";

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
                const bang_rules = req.result?.value;
                if (bang_rules) {
                    const cacheTx = db.transaction(
                        CACHE_STORE_NAME,
                        "readwrite",
                    );
                    const cacheStore = cacheTx.objectStore(CACHE_STORE_NAME);
                    cacheStore.put({ key: bang, value: bang_rules });
                }
                resolve(bang_rules || null);
            };
            req.onerror = () => resolve(null);
        }
    });

async function getBang(db, query) {
    const foundBangKeys = query.match(/![^!\s]+/g) ?? [];
    let searchQuery = query;

    if (!indexedDB.databases) {
        return { searchQuery, bang: "ddg", bang_rules: FALLBACK_BANG_RULES };
    }

    const defaultBangRules = await getBangRulesFromDB(db, DEFAULT_BANG);

    if (foundBangKeys.length === 0 && !defaultBangRules) {
        return { searchQuery, bang: "ddg", bang_rules: FALLBACK_BANG_RULES };
    }

    // order is important "query !g !gh" should redirect to Google
    for (let i = 0; i < foundBangKeys.length; i++) {
        const key = foundBangKeys[i].slice(1).toLowerCase();
        const bang_rules = await getBangRulesFromDB(db, key);

        if (bang_rules) {
            searchQuery = searchQuery
                .replace(new RegExp(`!${key}(?=\\s|$)`), "")
                .trim();
            return { searchQuery, bang: key, bang_rules };
        }
    }

    // no bang_rules in query → use default one
    if (defaultBangRules) {
        return {
            searchQuery,
            bang: DEFAULT_BANG,
            bang_rules: defaultBangRules,
        };
    }

    return {
        searchQuery,
        bang: "ddg",
        bang_rules: FALLBACK_BANG_RULES, // just in case something breaks, go go duckduckgo
    };
}

async function getRedirectURL(searchQuery, bang, bang_rules, db) {
    if (!bang_rules) return null;

    // search operators like "{{{s}}}+site:justice.gov" or "+filetype:pdf"
    let hasSearchOperator = false;
    let siteOperator = null; // site operator URL

    if (bang_rules.u.startsWith("{{{s}}}")) {
        hasSearchOperator = true;
    }

    const siteMatch = bang_rules.u.match(/\+site:\(?https?:\/\/([^)+]+)\)?/);
    if (siteMatch) {
        siteOperator = `https://${siteMatch[1]}`;
    }

    let fmt = bang_rules.fmt ?? [];

    // with empty query, open homepage or search page
    if (!searchQuery) {
        const allowsBaseOpen =
            !fmt.length ||
            fmt.includes("open_base_path") ||
            fmt.includes("open_snap_domain");

        if (allowsBaseOpen) {
            if (bang_rules.ad) return "https://" + bang_rules.ad; // .ad is an alternative domain to redirect
            if (siteOperator) return siteOperator; // "!doj" → justice.gov

            try {
                return new URL(bang_rules.u.replace("{{{s}}}", "")).origin;
            } catch {
                // case of "!pdf", just do "+filetype:pdf" searchQuery in selected search engine
            }
        }

        return bang_rules.u.replace("{{{s}}}+", ""); // search page
    }

    // "query !pdf" → searchengine.com/?q=query+filetype:pdf
    let defaultBang = null;
    if (hasSearchOperator) {
        searchQuery = bang_rules.u.replace("{{{s}}}", searchQuery);
        try {
            defaultBang =
                (await getBangRulesFromDB(db, DEFAULT_BANG)) ||
                FALLBACK_BANG_RULES;
        } catch {
            defaultBang = FALLBACK_BANG_RULES;
        }
        fmt = defaultBang.fmt ?? [];
    }

    let encodedQuery = encodeQuery(searchQuery, fmt);

    const template = defaultBang?.u ?? bang_rules.u;
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
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_SCHEMA);

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
                        const { searchQuery, bang, bang_rules } = await getBang(
                            db,
                            query,
                        );
                        const redirectUrl = await getRedirectURL(
                            searchQuery,
                            bang,
                            bang_rules,
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
    if (e.data?.type !== "UPDATE_DB") return;

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

    if (expired) {
        const res = await fetch(BANG_JSON_PATH);
        await cache.put(BANG_JSON_PATH, res);
        await loadBangs();

        e.source?.postMessage({ type: "UPDATED" });
    } else {
        e.source?.postMessage({ type: "UP_TO_DATE" });
    }
});
