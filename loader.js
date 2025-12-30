async function loadBangs(jsonPath, dbName) {
    try {
        const response = await fetch(jsonPath);
        if (!response.ok) throw new Error("Failed to fetch JSON");

        const data = await response.json();
        const request = indexedDB.open(dbName, BANG_DB_VERSION);

        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(BANG_DATA_NAME)) {
                db.createObjectStore(BANG_DATA_NAME);
            }
        };

        const db = await new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        const tx = db.transaction(BANG_DATA_NAME, "readwrite");
        const store = tx.objectStore(BANG_DATA_NAME);

        for (const [key, value] of Object.entries(data)) {
            store.put(value, key);
        }

        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
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
        new Date(loadDateStr) < new Date(Date.now() - 14) // 2 weeks old * 24 * 60 * 60 * 1000
    ) {
        loadBangs("/data/kagi.json", BANG_DB_NAME);
    }
});
