const BANG_DB_NAME = "bangDB";
const BANG_DATA_NAME = "bangData";
const DEFAULT_BANG = localStorage.getItem("defaultBang") ?? "ddg";

function openBangDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(BANG_DB_NAME, 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function IDB_get(db, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(BANG_DATA_NAME, "readonly");
        const store = tx.objectStore(BANG_DATA_NAME);
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
    const foundBangs = query.match(/![a-zA-Z0-9._-]+/g) ?? [];
    let bang = null;
    let usedBangKey = null;

    // 1–2. resolve bang
    const db = await openBangDB();
    for (let i = 0; i < foundBangs.length; i++) {
        const key = foundBangs[i].slice(1).toLowerCase();
        const hit = await IDB_get(db, key);
        if (hit) {
            bang = hit;
            usedBangKey = key;
            break;
        }
    }

    if (!bang) {
        bang = await IDB_get(db, DEFAULT_BANG);
        usedBangKey = DEFAULT_BANG;
    }

    if (!bang) return null;

    // 3. subtract bang token from query
    let searchQuery = query;
    if (bang) {
        searchQuery = searchQuery
            .replace(new RegExp(`!${usedBangKey}(?=\\s|$)`), "")
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
        defaultBang = await IDB_get(db, DEFAULT_BANG);
        fmt = defaultBang.fmt ?? [];
    }

    let encodedQuery = encodeQuery(searchQuery, fmt);

    const template = defaultBang?.u ?? bang.u;
    return template.replace("{{{s}}}", encodedQuery);
}

if (query) {
    getRedirectURL(query).then((url) => {
        if (url) window.location.href = url;
    });
}

// IN CASE THERE IS NO QUERY
// AND USER ACTUALLY VISITED THE SEARCHTHRU PAGE

async function loadBangs(jsonPath, dbName) {
    try {
        const response = await fetch(jsonPath);
        if (!response.ok) throw new Error("Failed to fetch JSON");

        const data = await response.json();
        const request = indexedDB.open(dbName, 1);

        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(BANG_DATA_NAME)) {
                db.createObjectStore(BANG_DATA_NAME, { keyPath: "key" });
            }
        };

        const db = await new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        const transaction = db.transaction(BANG_DATA_NAME, "readwrite");
        const store = transaction.objectStore(BANG_DATA_NAME);

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

document.addEventListener("DOMContentLoaded", (event) => {
    // fires only if no query
    const loadDateStr = localStorage.getItem("load_date");
    if (
        !loadDateStr ||
        new Date(loadDateStr) < new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) // 2 weeks old
    ) {
        loadBangs("/data/kagi.json", BANG_DB_NAME);
    }
});
