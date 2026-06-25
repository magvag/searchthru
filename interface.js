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

    const tablist = document.querySelector(".browser-selector[role='tablist']");
    if (tablist) {
        const tabs = Array.from(tablist.querySelectorAll('a[role="tab"]'));
        const panels = tabs.map((tab) =>
            document.getElementById(tab.getAttribute("aria-controls")),
        );

        const activate = (tab) => {
            tabs.forEach((t, i) => {
                const active = t === tab;
                t.classList.toggle("active", active);
                t.setAttribute("aria-selected", String(active));
                t.setAttribute("tabindex", active ? "0" : "-1");
                if (panels[i]) panels[i].hidden = !active;
            });
        };

        tabs.forEach((tab) => {
            tab.addEventListener("click", (e) => {
                e.preventDefault();
                activate(tab);
                tab.focus();
            });
        });

        tablist.addEventListener("keydown", (e) => {
            const current = tabs.indexOf(document.activeElement);
            if (current === -1) return;
            let next = -1;
            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                next = (current + 1) % tabs.length;
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                next = (current - 1 + tabs.length) % tabs.length;
            } else if (e.key === "Home") {
                next = 0;
            } else if (e.key === "End") {
                next = tabs.length - 1;
            }
            if (next !== -1) {
                e.preventDefault();
                activate(tabs[next]);
                tabs[next].focus();
            }
        });

        const ua = navigator.userAgent;
        let initial = tabs[0];
        if (/Firefox/i.test(ua)) {
            initial =
                tabs.find(
                    (t) => t.getAttribute("aria-controls") === "firefox",
                ) || initial;
        } else if (
            /Safari/i.test(ua) &&
            !/Chrome|Chromium|Edg|OPR|YaBrowser/i.test(ua)
        ) {
            initial =
                tabs.find(
                    (t) => t.getAttribute("aria-controls") === "safari",
                ) || initial;
        }
        activate(initial);
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

    document.querySelectorAll("a.interactive.copy").forEach((link) => {
        link.addEventListener("click", (e) => {
            e.preventDefault();
            navigator.clipboard.writeText(link.href).then(() => {
                link.classList.add("copied");
                setTimeout(() => link.classList.remove("copied"), 2000);
            });
        });
    });

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
