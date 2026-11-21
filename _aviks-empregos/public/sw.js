// Service worker do app: guarda a "casca" (telas, logo e ícones) para abrir rápido no celular.
// Os dados (/api) e o login NUNCA ficam em cache: sempre vêm do servidor.
const VERSAO = 'aviks-empregos-v1';
const CASCA = ['/manifest.webmanifest', '/favicon.svg', '/marca/logo-horizontal-claro.svg', '/marca/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname === '/' || url.pathname === '/sair') return; // sempre rede
  // Arquivos estáticos: rede primeiro, cache se estiver sem internet.
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok && (url.pathname.startsWith('/marca/') || CASCA.includes(url.pathname))) {
          const copia = r.clone();
          caches.open(VERSAO).then((c) => c.put(e.request, copia));
        }
        return r;
      })
      .catch(() => caches.match(e.request)),
  );
});
