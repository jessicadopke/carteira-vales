// Guarda o app no celular para abrir sem internet.
// Ao publicar uma versão nova, mude VERSION para o celular baixar os arquivos atualizados.
const VERSION = "ciclo-1.10.0";
const FILES = [
  "./",
  "index.html",
  "styles.css",
  "fonts/outfit-latin.woff2",
  "manifest.webmanifest",
  "js/app.js",
  "js/issuers.js",
  "js/match.js",
  "js/receipt.js",
  "js/gemini.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "vendor/tesseract/tesseract.min.js",
  "vendor/tesseract/worker.min.js",
  "vendor/tesseract/tesseract-core-simd-lstm.wasm.js",
  "vendor/tesseract/tesseract-core-lstm.wasm.js",
  "vendor/tesseract/lang/por.traineddata.gz",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Leitor de cupom e ícones: arquivos grandes que não mudam, sempre da cópia guardada.
// Página, estilos e código: da internet quando houver (assim as atualizações chegam), senão da cópia guardada.
self.addEventListener("fetch", e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (/\/(vendor|icons|fonts)\//.test(url.pathname)) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
    return;
  }
  const key = req.mode === "navigate" ? "index.html" : req;
  e.respondWith(
    fetch(req, { cache: "no-cache" })
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(key, copy)); }
        return res;
      })
      .catch(() => caches.match(key, { ignoreSearch: true }))
  );
});
