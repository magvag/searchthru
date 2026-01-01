document.addEventListener("DOMContentLoaded", (event) => {
    // fires only if no query
    const loadDateStr = localStorage.getItem("load_date");
    if (
        !loadDateStr ||
        new Date(loadDateStr) < new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) // 2 weeks old
    ) {
        loadBangs("/data/kagi.json", DB_NAME);
    }
});
