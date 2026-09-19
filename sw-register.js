// Service workers only run on https:// or localhost; anywhere else (file://,
// plain http) this quietly does nothing and the app still works online.
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(function () {});
}
