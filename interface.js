// every homepage visit ask SW to update DB if neccessary
document.addEventListener("DOMContentLoaded", () => {
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
