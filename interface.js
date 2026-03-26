const DEFAULT_LANG = "en";
const LANG_STORAGE_KEY = "lang";
const DEFAULT_BANG = "_default";

const DB_NAME = "bangDB";
const DB_SCHEMA = 5;
const BANG_STORE_NAME = "bangData";
const CACHE_STORE_NAME = "bangCache";

const getStoredLang = () => {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (stored && stored.trim()) {
        return stored.trim();
    }
    localStorage.setItem(LANG_STORAGE_KEY, DEFAULT_LANG);
    return DEFAULT_LANG;
};

const loadStrings = async (lang) => {
    const response = await fetch(`./ui/${lang}.json`, { cache: "no-cache" });
    if (!response.ok) {
        throw new Error(`Failed to load /ui/${lang}.json`);
    }
    return response.json();
};

const getDefaultBangValue = () => {
    const raw = localStorage.getItem("defaultBang") || "";
    return raw.replace(/^!+/, "");
};

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

const getBangRulesByKey = async (key) => {
    const db = await openDB();
    return new Promise((resolve) => {
        const tx = db.transaction(BANG_STORE_NAME, "readonly");
        const store = tx.objectStore(BANG_STORE_NAME);
        const req = store.get(key);

        req.onsuccess = () => {
            db.close();
            resolve(req.result?.value || null);
        };
        req.onerror = () => {
            db.close();
            resolve(null);
        };
    });
};

const setDefaultBangCache = async (key) => {
    const bangRules = await getBangRulesByKey(key);
    const db = await openDB();
    const tx = db.transaction(CACHE_STORE_NAME, "readwrite");
    const store = tx.objectStore(CACHE_STORE_NAME);

    if (bangRules) {
        store.put({ key: DEFAULT_BANG, value: bangRules });
    } else {
        store.delete(DEFAULT_BANG);
    }

    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
};

const clearDefaultBangCache = async () => {
    const db = await openDB();
    const tx = db.transaction(CACHE_STORE_NAME, "readwrite");
    const store = tx.objectStore(CACHE_STORE_NAME);
    store.delete(DEFAULT_BANG);
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
};

const getNestedValue = (source, path) => {
    return path.split(".").reduce((acc, key) => acc?.[key], source);
};

const applyTranslations = (strings, lang) => {
    document.documentElement.lang = lang;
    const nodes = document.querySelectorAll("[data-i18n]");
    nodes.forEach((node) => {
        if (node.querySelector("[data-i18n]")) {
            return;
        }
        const key = node.getAttribute("data-i18n");
        const value = getNestedValue(strings, key);
        if (typeof value === "string") {
            node.innerHTML = value;
        }
    });
};

const setLanguage = async (lang) => {
    let strings;
    try {
        strings = await loadStrings(lang);
    } catch (error) {
        if (lang !== DEFAULT_LANG) {
            localStorage.setItem(LANG_STORAGE_KEY, DEFAULT_LANG);
            strings = await loadStrings(DEFAULT_LANG);
            lang = DEFAULT_LANG;
        } else {
            console.error(error);
            strings = {};
        }
    }
    localStorage.setItem(LANG_STORAGE_KEY, lang);
    applyTranslations(strings, lang);
};

document.addEventListener("DOMContentLoaded", async () => {
    const lang = getStoredLang();
    await setLanguage(lang);

    const langSelect = document.getElementById("language");
    if (langSelect) {
        langSelect.value = lang;
        langSelect.addEventListener("change", () => {
            const next = langSelect.value || DEFAULT_LANG;
            setLanguage(next);
        });
    }

    const tabs = document.querySelectorAll('.browser-selector a[href^="#"]');
    const panels = Array.from(tabs)
        .map((tab) => document.querySelector(tab.getAttribute("href")))
        .filter(Boolean);

    const setActiveTab = (tab) => {
        tabs.forEach((item) => item.classList.remove("active"));
        tab.classList.add("active");
        const targetId = tab.getAttribute("href");
        panels.forEach((panel) => {
            panel.style.display = `#${panel.id}` === targetId ? "" : "none";
        });
        if (targetId) {
            history.replaceState(null, "", targetId);
        }
    };

    if (tabs.length) {
        const activeTab = Array.from(tabs).find((tab) =>
            tab.classList.contains("active"),
        );
        const hashTab = Array.from(tabs).find(
            (tab) => tab.getAttribute("href") === location.hash,
        );
        const initial = activeTab || hashTab || tabs[0];
        if (initial) setActiveTab(initial);

        tabs.forEach((tab) => {
            tab.addEventListener("click", (event) => {
                event.preventDefault();
                setActiveTab(tab);
            });
        });
    }

    const input = document.getElementById("defaultBang");
    if (input) {
        input.value = getDefaultBangValue();
        input.addEventListener("input", async () => {
            const value = input.value.trim();
            if (!value) {
                localStorage.removeItem("defaultBang");
                await clearDefaultBangCache();
                return;
            }
            const normalized = value.replace(/^!+/, "").trim();
            if (!normalized) {
                localStorage.removeItem("defaultBang");
                await clearDefaultBangCache();
                return;
            }
            if (value.startsWith("!")) {
                input.value = normalized;
            }
            localStorage.setItem("defaultBang", normalized);
            await setDefaultBangCache(normalized.toLowerCase());
        });
    }

    const defaultBangValue = getDefaultBangValue();
    if (defaultBangValue) {
        setDefaultBangCache(defaultBangValue.toLowerCase());
    } else {
        clearDefaultBangCache();
    }

    const url = new URL(window.location.href);
    const query = url.searchParams.get("q")?.trim() ?? "";

    if (!query) {
        let dbEmpty = true;
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
            dbEmpty = count === 0;
        } catch {
            dbEmpty = true;
        } finally {
            db?.close();
        }

        navigator.serviceWorker.ready.then((reg) => {
            reg.active?.postMessage({
                type: dbEmpty ? "LOAD_DB" : "UPDATE_DB",
            });
        });
    }
});

navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type === "UPDATED") {
        console.log("BangDB was updated");
    }

    if (e.data?.type === "UP_TO_DATE") {
        console.log("BangDB is already up to date");
    }
});
