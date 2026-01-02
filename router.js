const DB_NAME = "bangDB";
const BANG_STORE_NAME = "bangData";
const CACHE_STORE_NAME = "bangCache";
const DB_SCHEMA = 5;
const DEFAULT_BANG_KEY = localStorage.getItem("defaultBang") ?? "ddg"; // bangKey is !this
const FALLBACK_BANG = { u: "https://duckduckgo.com/?q={{{s}}}" }; // bang is all the redirect rules

async function getBangFromDB(bangKey) {
    return new Promise((resolve, reject) => {
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

        request.onsuccess = (e) => {
            const db = e.target.result;

            // is there a cache hit?
            if (db.objectStoreNames.contains(CACHE_STORE_NAME)) {
                const tx = db.transaction(CACHE_STORE_NAME, "readonly");
                const store = tx.objectStore(CACHE_STORE_NAME);
                const req = store.get(bangKey);

                req.onsuccess = () => {
                    if (req.result?.value) {
                        db.close();
                        resolve(req.result.value);
                        return;
                    }
                    // not in cache
                    tryBangData();
                };
                req.onerror = () => tryBangData();
            } else {
                // no cache store
                tryBangData();
            }

            // if no cache hit, full search thru 13k bangs
            function tryBangData() {
                const tx = db.transaction(BANG_STORE_NAME, "readonly");
                const store = tx.objectStore(BANG_STORE_NAME);
                const req = store.get(bangKey);

                req.onsuccess = () => {
                    const bang = req.result?.value;
                    if (bang) {
                        // and add to cache
                        const cacheTx = db.transaction(
                            CACHE_STORE_NAME,
                            "readwrite",
                        );
                        const cacheStore =
                            cacheTx.objectStore(CACHE_STORE_NAME);
                        cacheStore.put({ key: bangKey, value: bang });
                    }
                    db.close();
                    resolve(bang || null);
                };
                req.onerror = () => {
                    db.close();
                    resolve(null);
                };
            }
        };
    });
}

async function getBang(query) {
    const foundBangKeys = query.match(/![a-zA-Z0-9._-]+/g) ?? [];
    let searchQuery = query;

    if (!indexedDB.databases) {
        return { searchQuery, bangKey: "ddg", bang: FALLBACK_BANG };
    }

    if (foundBangKeys.length === 0 && DEFAULT_BANG_KEY === "ddg") {
        return { searchQuery, bangKey: "ddg", bang: FALLBACK_BANG };
    }

    // order is important "query !g !gh" should redirect to Google
    for (let i = 0; i < foundBangKeys.length; i++) {
        const key = foundBangKeys[i].slice(1).toLowerCase();
        const bang = await getBangFromDB(key);

        if (bang) {
            searchQuery = searchQuery
                .replace(new RegExp(`!${key}(?=\\s|$)`), "")
                .trim();
            return { searchQuery, bangKey: key, bang };
        }
    }

    // no bang in query → use default one
    const defaultBang = await getBangFromDB(DEFAULT_BANG_KEY);
    return {
        searchQuery,
        bangKey: DEFAULT_BANG_KEY,
        bang: defaultBang || FALLBACK_BANG, // just in case something breaks, go go duckduckgo
    };
}

async function getRedirectURL(searchQuery, bangKey, bang) {
    if (!bang) return null;

    // search operators like "{{{s}}}+site:justice.gov" or "+filetype:pdf"
    let hasSearchOperator = false;
    let siteOperator = null; // site operator URL

    if (bang.u.startsWith("{{{s}}}")) {
        hasSearchOperator = true;
    }

    const siteMatch = bang.u.match(/\+site:\(?https?:\/\/([^)+]+)\)?/);
    if (siteMatch) {
        siteOperator = `https://${siteMatch[1]}`;
    }

    let fmt = bang.fmt ?? [];

    // with empty query, open homepage or search page
    if (!searchQuery) {
        const allowsBaseOpen =
            !fmt.length ||
            fmt.includes("open_base_path") ||
            fmt.includes("open_snap_domain");

        if (allowsBaseOpen) {
            if (bang.ad) return "https://" + bang.ad; // .ad is an alternative domain to redirect
            if (siteOperator) return siteOperator; // "!doj" → justice.gov

            try {
                return new URL(bang.u.replace("{{{s}}}", "")).origin;
            } catch {
                // case of "!pdf", just do "+filetype:pdf" searchQuery in selected search engine
            }
        }

        return bang.u.replace("{{{s}}}+", ""); // search page
    }

    // "query !pdf" → searchengine.com/?q=query+filetype:pdf
    let defaultBang = null;
    if (hasSearchOperator) {
        searchQuery = bang.u.replace("{{{s}}}", searchQuery);
        try {
            if (DEFAULT_BANG_KEY === "ddg") {
                defaultBang = FALLBACK_BANG;
            } else {
                defaultBang = await getBangFromDB(DEFAULT_BANG_KEY);
            }
        } catch {
            defaultBang = FALLBACK_BANG;
        }
        fmt = defaultBang.fmt ?? [];
    }

    let encodedQuery = encodeQuery(searchQuery, fmt);

    const template = defaultBang?.u ?? bang.u;
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

const url = new URL(window.location.href);
const query = url.searchParams.get("q")?.trim() ?? "";

if (query) {
    getBang(query)
        .then(({ searchQuery, bangKey, bang }) => {
            return getRedirectURL(searchQuery, bangKey, bang);
        })
        .then((searchUrl) => {
            if (searchUrl) window.location.replace(searchUrl);
        });
} else {
    document.documentElement.style.visibility = "visible"; // best way to avoid white flashbang is to assume document is hidden until disproven
}
