const DB_NAME = "bangDB";
const BANG_STORE_NAME = "bangData";
const CACHE_STORE_NAME = "bangCache";
const DB_VERSION = 4;
const DEFAULT_BANG_KEY = localStorage.getItem("defaultBang") ?? "ddg";
const FALLBACK_BANG_VALUE = { u: "https://duckduckgo.com/?q={{{s}}}" };

function openBangDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function IDB_get(db, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(BANG_STORE_NAME, "readonly");
        const store = tx.objectStore(BANG_STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result?.value ?? null);
        req.onerror = () => reject(req.error);
    });
}

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

async function getRedirectURL(query) {
    const foundBangKeys = query.match(/![a-zA-Z0-9._-]+/g) ?? [];
    let bang = null;
    let bangKey = null;

    // 1–2. resolve bang
    const db = await openBangDB();
    for (let i = 0; i < foundBangKeys.length; i++) {
        const key = foundBangKeys[i].slice(1).toLowerCase();
        const hit = await IDB_get(db, key);
        if (hit) {
            bang = hit;
            bangKey = key;
            break;
        }
    }

    if (!bang) {
        bang = await IDB_get(db, DEFAULT_BANG_KEY);
        bangKey = DEFAULT_BANG_KEY;
    }

    if (!bang) return null;

    // 3. subtract bang token from query
    let searchQuery = query;
    if (bang) {
        searchQuery = searchQuery
            .replace(new RegExp(`!${bangKey}(?=\\s|$)`), "")
            .trim();
    }
    searchQuery = searchQuery.trim();

    // 3.1 detect operators
    let hasSearchOperator = false;
    let siteOperator = null;

    if (bang.u.startsWith("{{{s}}}")) {
        hasSearchOperator = true;
    }

    const siteMatch = bang.u.match(/\+site:\(?https?:\/\/([^)+]+)\)?/);
    if (siteMatch) {
        siteOperator = `https://${siteMatch[1]}`;
    }

    let fmt = bang.fmt ?? [];

    // 4. empty query behavior
    if (!searchQuery) {
        const allowsBaseOpen =
            !fmt.length ||
            fmt.includes("open_base_path") ||
            fmt.includes("open_snap_domain");

        if (allowsBaseOpen) {
            if (bang.ad) return "https://" + bang.ad;
            if (siteOperator) return siteOperator;

            try {
                return new URL(bang.u.replace("{{{s}}}", "")).origin;
            } catch {
                return bang.u.replace("{{{s}}}", "");
            }
        }

        return bang.u.replace("{{{s}}}", "");
    }

    // 5. search operator case
    let defaultBang = bang;
    if (hasSearchOperator) {
        searchQuery = bang.u.replace("{{{s}}}", searchQuery);
        defaultBang = await IDB_get(db, DEFAULT_BANG_KEY);
        fmt = defaultBang.fmt ?? [];
    }

    let encodedQuery = encodeQuery(searchQuery, fmt);

    const template = defaultBang?.u ?? bang.u;
    return template.replace("{{{s}}}", encodedQuery);
}

const url = new URL(window.location.href);
const query = url.searchParams.get("q")?.trim() ?? "";

if (query) {
    getRedirectURL(query).then((searchUrl) => {
        if (searchUrl) window.location.replace(searchUrl);
    });
} else {
    document.documentElement.style.visibility = "visible";
}
