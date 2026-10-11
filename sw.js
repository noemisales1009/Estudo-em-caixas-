// Guarda uma cópia do app no aparelho, para ele abrir sem internet.
// Com internet, a página vem sempre do servidor (e a cópia é atualizada); a cópia guardada só
// entra quando a rede falha ou demora. Os estudos não passam por aqui: ficam no próprio app.
const CACHE = "estudo-em-caixas-v1";
const PAGINA = new URL("./", location).href;
const ARQUIVOS = [
  "manifest.webmanifest",
  "icones/icone-192.png",
  "icones/icone-512.png",
  "icones/icone-cheio-512.png",
].map((a) => new URL(a, location).href);
const CDN = "https://cdn.jsdelivr.net/npm/@supabase/";

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([PAGINA, ...ARQUIVOS])));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

// A página avisa qual versão da biblioteca do Supabase ela usa; fica guardada só essa.
async function guardarBiblioteca(url) {
  const cache = await caches.open(CACHE);
  for (const k of await cache.keys())
    if (k.url.startsWith(CDN) && k.url !== url) await cache.delete(k);
  if (!(await cache.match(url))) await cache.add(new Request(url, { mode: "cors" }));
}
self.addEventListener("message", (e) => {
  const url = e.data?.biblioteca;
  if (typeof url === "string" && url.startsWith(CDN))
    e.waitUntil(guardarBiblioteca(url).catch(() => {}));
});

// Tenta a rede e guarda o que vier. Havendo cópia, ela entra se a rede falhar, se o servidor
// responder com erro ou se a resposta demorar mais que 4 s.
async function daRede(e, chave) {
  const cache = await caches.open(CACHE),
    guardado = await cache.match(chave),
    rede = fetch(e.request).then(async (r) => {
      if (r.ok) await cache.put(chave, r.clone());
      return r.ok || !guardado ? r : guardado;
    });
  if (!guardado) return rede;
  e.waitUntil(rede.catch(() => {}));
  return Promise.race([rede, new Promise((f) => setTimeout(f, 4000, guardado))]).catch(
    () => guardado,
  );
}
self.addEventListener("fetch", (e) => {
  const url = e.request.url.split(/[?#]/)[0];
  if (e.request.method !== "GET") return;
  if (url.startsWith(CDN))
    e.respondWith(caches.match(e.request.url).then((r) => r || fetch(e.request)));
  else if (e.request.mode === "navigate" && (url === PAGINA || url === PAGINA + "index.html"))
    e.respondWith(daRede(e, PAGINA));
  else if (ARQUIVOS.includes(url)) e.respondWith(daRede(e, url));
});
