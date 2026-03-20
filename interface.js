const DEFAULT_LANG = "en";
const LANG_STORAGE_KEY = "lang";

const getStoredLang = () => {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (stored && stored.trim()) {
        return stored.trim();
    }
    localStorage.setItem(LANG_STORAGE_KEY, DEFAULT_LANG);
    return DEFAULT_LANG;
};

const loadStrings = async (lang) => {
    const response = await fetch(`/ui/${lang}.json`, { cache: "no-cache" });
    if (!response.ok) {
        throw new Error(`Failed to load /ui/${lang}.json`);
    }
    return response.json();
};

const isMobile = () =>
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

const isFirefox = () => /Firefox/i.test(navigator.userAgent);

const getInstructionKey = () => {
    if (isFirefox() && !isMobile()) {
        return "firefoxDesktop";
    }
    if (isFirefox() && isMobile()) {
        return "firefoxMobile";
    }
    return "chromeMobile";
};

const getDefaultBangValue = () => {
    const raw = localStorage.getItem("defaultBang") || "";
    return raw.replace(/^!+/, "");
};

const appendStep = (li, step) => {
    if (typeof step === "string") {
        li.textContent = step;
        return;
    }

    if (step && typeof step === "object") {
        if (typeof step.text === "string") {
            li.append(step.text);
        }
        if (step.link) {
            const anchor = document.createElement("a");
            if (typeof step.link === "string") {
                anchor.href = step.link;
                anchor.textContent = step.linkText || step.link;
            } else if (typeof step.link === "object") {
                anchor.href = step.link.href || "";
                anchor.textContent = step.link.text || step.link.href || "";
            }
            if (anchor.textContent) {
                li.append(anchor);
            }
        }
        if (typeof step.highlight === "string") {
            const span = document.createElement("span");
            span.textContent = step.highlight;
            li.append(span);
        }
        if (typeof step.textAfter === "string") {
            li.append(step.textAfter);
        }
    }
};

const renderHomepage = (strings) => {
    const body = document.body;
    body.replaceChildren();

    const title = document.createElement("h1");
    title.textContent = strings.title || "Search Thru!";
    body.append(title);

    const installHeading = document.createElement("h2");
    installHeading.textContent =
        strings.installation?.heading || "installation instructions";
    body.append(installHeading);

    const instructionKey = getInstructionKey();
    const steps =
        strings.installation?.[instructionKey]?.steps ||
        strings.installation?.chromeMobile?.steps ||
        strings.installation?.firefoxMobile?.steps ||
        [];

    const ol = document.createElement("ol");
    steps.forEach((step) => {
        const li = document.createElement("li");
        appendStep(li, step);
        ol.append(li);
    });
    body.append(ol);

    const settingsHeading = document.createElement("h2");
    settingsHeading.textContent = strings.settings?.heading || "settings";
    body.append(settingsHeading);

    const label = document.createElement("label");
    label.htmlFor = "defaultBang";
    label.textContent =
        strings.settings?.defaultBangLabel || "default engine bang";
    body.append(label);

    const input = document.createElement("input");
    input.id = "defaultBang";
    input.name = "defaultBang";
    input.type = "text";
    input.placeholder = strings.settings?.defaultBangPlaceholder || "ddg";
    input.value = getDefaultBangValue();
    input.addEventListener("input", () => {
        const value = input.value.trim();
        if (!value) {
            localStorage.removeItem("defaultBang");
            return;
        }
        const normalized = value.startsWith("!") ? value : `!${value}`;
        localStorage.setItem("defaultBang", normalized);
    });
    body.append(input);
};

document.addEventListener("DOMContentLoaded", async () => {
    const lang = getStoredLang();
    let strings;

    try {
        strings = await loadStrings(lang);
    } catch (error) {
        if (lang !== DEFAULT_LANG) {
            localStorage.setItem(LANG_STORAGE_KEY, DEFAULT_LANG);
            strings = await loadStrings(DEFAULT_LANG);
        } else {
            console.error(error);
            strings = {};
        }
    }

    renderHomepage(strings);
    document.documentElement.style.visibility = "visible";

    const url = new URL(window.location.href);
    const query = url.searchParams.get("q")?.trim() ?? "";

    if (!query) {
        navigator.serviceWorker.ready.then((reg) => {
            reg.active?.postMessage({ type: "UPDATE_DB" });
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
