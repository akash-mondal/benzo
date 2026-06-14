/* Cross-origin-isolation shim (gzhuang/coi-serviceworker, MIT). Re-fetches the
   document with COOP/COEP so crossOriginIsolated === true on static hosts,
   enabling SharedArrayBuffer + WASM threads for client-side proving. */
if (typeof window === "undefined") {
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener("fetch", (event) => {
    if (event.request.cache === "only-if-cached" && event.request.mode !== "same-origin") return;
    event.respondWith(
      fetch(event.request).then((r) => {
        if (r.status === 0) return r;
        const headers = new Headers(r.headers);
        headers.set("Cross-Origin-Embedder-Policy", "require-corp");
        headers.set("Cross-Origin-Opener-Policy", "same-origin");
        return new Response(r.body, { status: r.status, statusText: r.statusText, headers });
      }),
    );
  });
} else {
  (() => {
    if (window.crossOriginIsolated !== false || !window.isSecureContext) return;
    navigator.serviceWorker?.register(window.document.currentScript.src).then(
      (reg) => reg.addEventListener("updatefound", () => window.location.reload()),
      () => {},
    );
  })();
}
