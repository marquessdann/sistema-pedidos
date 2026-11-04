/* Della Pedidos — service worker (gerado no build). Guarda as telas do sistema para abrir sem internet. */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const APP_CACHE = 'della-app-' + VERSION;
const IMAGE_CACHE = 'della-product-images';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('della-app-') && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // fotos dos produtos: guardadas no aparelho pela sincronização
  if (url.pathname.startsWith('/api/files/products/')) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then((cache) =>
        cache.match(url.pathname).then((hit) => hit || fetch(req)),
      ),
    );
    return;
  }
  if (url.pathname.startsWith('/api/')) return; // dados sempre do servidor (o app trata a falta de internet)

  // páginas: tenta a internet (sinal fraco: espera no máximo 4s) e cai na versão guardada
  if (req.mode === 'navigate') {
    event.respondWith(
      withTimeout(fetch(req), 4000).catch(() =>
        caches.open(APP_CACHE).then((cache) => cache.match('/index.html')).then((r) => r || Response.error()),
      ),
    );
    return;
  }

  // arquivos do sistema (js, css, logotipo): versão guardada primeiro
  event.respondWith(
    caches.open(APP_CACHE).then((cache) =>
      cache.match(url.pathname).then((hit) => hit || fetch(req)),
    ),
  );
});
