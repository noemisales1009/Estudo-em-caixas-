// Como rodar (precisa de Node 22+ e do Google Chrome):  node testes/teste.mjs
// Testa o app num Chrome sem janela. Toda chamada ao Supabase é respondida por um servidor de
// mentira aqui dentro: nada chega ao projeto real (o endereço real é trocado e, por garantia, barrado).
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const APP = process.argv[2] || path.join(import.meta.dirname, "..", "index.html");
const OUT = path.resolve(process.argv[3] || path.join(os.tmpdir(), "estudo-em-caixas-teste"));
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const REAL = "cbijxuiqmiodzfthuuqn.supabase.co";
const FAKE = "teste-local.supabase.co";
fs.mkdirSync(path.join(OUT, "perfil"), { recursive: true });

let falhas = 0;
const ok = (nome, cond, extra = "") => {
  if (!cond) falhas++;
  console.log((cond ? "ok    " : "FALHA ") + nome + (extra !== "" ? "  -> " + extra : ""));
};
const pausa = (ms) => new Promise((f) => setTimeout(f, ms));

// ---------- Supabase de mentira ----------
const fake = { users: new Map(), rows: new Map(), files: new Map(), down: false, fora: false, marca: "", autoconfirm: true, cap: 1000, n: 0, writes: 0, reads: 0, real: 0 };
const iso = new Date().toISOString();
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const json = (status, body, headers = {}) => ({ status, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const jsonb = (d) => Object.fromEntries(Object.entries(d).sort(([a], [b]) => a.length - b.length || (a < b ? -1 : 1)));
const pub = (u) => ({
  id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: u.confirmed ? iso : null, phone: "",
  app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {},
  identities: [{ identity_id: u.id, id: u.id, user_id: u.id, identity_data: { email: u.email, sub: u.id }, provider: "email", created_at: iso, updated_at: iso, email: u.email }],
  created_at: iso, updated_at: iso, is_anonymous: false,
});
function sessao(u) {
  const now = Math.floor(Date.now() / 1000);
  const token = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: u.id, email: u.email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600, n: ++fake.n })}.assinatura`;
  u.tokens.add(token);
  return { access_token: token, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: `r-${u.id}-${fake.n}`, user: pub(u) };
}
// Um PDF de verdade, pequeno, com duas folhas, para o leitor do app abrir.
const PDF = (() => {
  const fluxo = "BT /F1 24 Tf 40 100 Td (Folha de teste) Tj ET";
  const folha = "<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 5 0 R/Resources<</Font<</F1 6 0 R>>>>>>";
  const objetos = ["<</Type/Catalog/Pages 2 0 R>>", "<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>", folha, folha, `<</Length ${fluxo.length}>>\nstream\n${fluxo}\nendstream`, "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>"];
  let s = "%PDF-1.4\n";
  const onde = objetos.map((o, i) => { const p = s.length; s += `${i + 1} 0 obj\n${o}\nendobj\n`; return p; });
  const xref = s.length;
  s += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${onde.map((p) => String(p).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<</Size ${objetos.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(s, "latin1");
})();
const quem = (h) => { const t = (h.authorization || "").replace(/^Bearer /, ""); for (const u of fake.users.values()) if (u.tokens.has(t)) return u; return null; };
const chave = (r) => `${r.user_id}|${r.tipo}|${r.id}`;
function responder(method, url, h, body) {
  const p = url.pathname, q = url.searchParams;
  if (method === "OPTIONS") return { status: 204, headers: {} };
  // Arquivos (Storage): cada conta só mexe na pasta que leva o próprio id, como nas regras do schema.sql.
  const arq = p.match(/^\/storage\/v1\/object\/(sign\/)?eec-arquivos(?:\/(.*))?$/);
  if (arq) {
    const u = quem(h), caminho = decodeURIComponent(arq[2] || ""), meu = (c) => c.startsWith(u.id + "/");
    // O link temporário dispensa a conta: quem tem o link baixa o arquivo (aqui, sempre o PDF de teste).
    if (method === "GET" && arq[1]) return fake.files.has(caminho) && q.get("token") === "t" ? { status: 200, headers: { "Content-Type": "application/pdf" }, body: PDF } : json(400, { statusCode: "404", error: "not_found", message: "Object not found" });
    if (!u) return json(400, { statusCode: "403", error: "Unauthorized", message: "invalid JWT" });
    if (method === "POST" && !arq[1]) {
      if (!meu(caminho)) return json(400, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
      if (body && !body.includes("application/pdf")) return json(400, { statusCode: "415", error: "invalid_mime_type", message: "mime type not supported" });
      fake.files.set(caminho, (body || "").length);
      return json(200, { Id: "arquivo-" + fake.files.size, Key: "eec-arquivos/" + caminho });
    }
    if (method === "POST") return meu(caminho) && fake.files.has(caminho) ? json(200, { signedURL: "/object/sign/eec-arquivos/" + caminho + "?token=t" }) : json(400, { statusCode: "404", error: "not_found", message: "Object not found" });
    if (method === "DELETE") return json(200, (JSON.parse(body || "{}").prefixes || []).filter((c) => meu(c) && fake.files.delete(c)).map((name) => ({ name })));
  }
  const dados = body ? JSON.parse(body) : {};
  if (p === "/auth/v1/signup") {
    if (fake.users.has(dados.email)) return fake.autoconfirm ? json(422, { code: 422, error_code: "user_already_exists", msg: "User already registered" }) : json(200, { ...pub(fake.users.get(dados.email)), identities: [] });
    if ((dados.password || "").length < 6) return json(422, { code: 422, error_code: "weak_password", msg: "Password should be at least 6 characters." });
    const u = { id: `00000000-0000-4000-8000-${String(fake.users.size + 1).padStart(12, "0")}`, email: dados.email, password: dados.password, confirmed: fake.autoconfirm, tokens: new Set() };
    fake.users.set(u.email, u);
    return json(200, fake.autoconfirm ? sessao(u) : pub(u));
  }
  if (p === "/auth/v1/token") {
    if (q.get("grant_type") === "password") {
      const u = fake.users.get(dados.email);
      if (!u || u.password !== dados.password) return json(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
      if (!u.confirmed) return json(400, { code: 400, error_code: "email_not_confirmed", msg: "Email not confirmed" });
      return json(200, sessao(u));
    }
    const u = [...fake.users.values()].find((x) => (dados.refresh_token || "").startsWith(`r-${x.id}-`));
    return u ? json(200, sessao(u)) : json(400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
  }
  if (p === "/auth/v1/logout") return { status: 204, headers: {} };
  if (p === "/auth/v1/recover") return json(200, {});
  if (p === "/auth/v1/user") {
    const u = quem(h);
    if (!u) return json(401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
    if (method === "PUT" && dados.password) u.password = dados.password;
    return json(200, pub(u));
  }
  if (p === "/rest/v1/eec_itens") {
    const u = quem(h);
    if (!u) return json(401, { code: "42501", message: "permission denied for table eec_itens" });
    const casa = (r) => ["user_id", "tipo", "id"].every((c) => {
      const f = q.get(c);
      if (f === null) return true;
      if (f.startsWith("eq.")) return r[c] === f.slice(3);
      if (f.startsWith("in.(")) return f.slice(4, -1).split(",").map((s) => s.replace(/^"|"$/g, "")).includes(r[c]);
      throw Error("filtro não previsto no teste: " + f);
    });
    const meus = [...fake.rows.values()].filter((r) => r.user_id === u.id);
    if (method === "GET") {
      fake.reads++;
      const todos = meus.filter(casa).sort((a, b) => (a.tipo + "|" + a.id < b.tipo + "|" + b.id ? -1 : 1));
      const off = +(q.get("offset") || 0), lim = Math.min(+(q.get("limit") || 1e9), fake.cap), pag = todos.slice(off, off + lim);
      return json(200, pag.map(({ tipo, id, dados }) => ({ tipo, id, dados })), { "Content-Range": (pag.length ? `${off}-${off + pag.length - 1}` : "*") + "/" + todos.length });
    }
    if (method === "POST") {
      fake.writes++;
      if (q.get("on_conflict") !== "user_id,tipo,id") return json(400, { code: "PGRST", message: "on_conflict inesperado: " + q.get("on_conflict") });
      for (const r of dados) {
        if (r.user_id !== u.id) return json(403, { code: "42501", message: "new row violates row-level security policy" });
        // fake.semIdeia imita a tabela de antes da página Ideias, que ainda recusa o tipo 'ideia'.
        if (!["estudo", "parte", "sessao", ...(fake.semIdeia ? [] : ["ideia"])].includes(r.tipo) || typeof r.id !== "string" || !r.dados || typeof r.dados !== "object") return json(400, { code: "23514", message: "violates check constraint" });
      }
      for (const r of dados) fake.rows.set(chave(r), { user_id: r.user_id, tipo: r.tipo, id: r.id, dados: jsonb(r.dados) });
      return { status: 201, headers: {} };
    }
    if (method === "DELETE") {
      fake.writes++;
      for (const r of meus.filter(casa)) fake.rows.delete(chave(r));
      return { status: 204, headers: {} };
    }
  }
  return json(404, { message: "rota não prevista no teste: " + method + " " + p });
}
const linhas = (email) => [...fake.rows.values()].filter((r) => r.user_id === fake.users.get(email)?.id);
const nomes = (email, tipo) => linhas(email).filter((r) => r.tipo === tipo).map((r) => r.dados.title).sort();

// ---------- Servidor do app ----------
const RAIZ = path.dirname(path.resolve(APP));
const TIPOS = { ".js": "text/javascript", ".webmanifest": "application/manifest+json", ".png": "image/png" };
const server = http.createServer((req, res) => {
  if (fake.fora) return req.socket.destroy(); // site fora do ar
  const caminho = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (caminho !== "/" && caminho !== "/index.html") {
    const arq = path.join(RAIZ, caminho);
    if (!TIPOS[path.extname(arq)] || !arq.startsWith(RAIZ + path.sep) || !fs.existsSync(arq)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(arq)], "Cache-Control": "no-store" });
    return res.end(fs.readFileSync(arq));
  }
  let html = fs.readFileSync(APP, "utf8");
  if (req.url.includes("modo=local"))
    html = html.replace(/const SUPABASE_URL = "[^"]*"/, 'const SUPABASE_URL = ""').replace(/const SUPABASE_KEY =\s*"[^"]*"/, 'const SUPABASE_KEY = ""');
  if (fake.marca) html = html.replace("</head>", `<meta name="teste-versao" content="${fake.marca}" /></head>`);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html.replaceAll(REAL, FAKE));
});
await new Promise((f) => server.listen(0, "127.0.0.1", f));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// ---------- Chrome ----------
const porta = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${porta}`, `--user-data-dir=${path.join(OUT, "perfil")}`, "--disable-web-security", "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
process.on("exit", () => chrome.kill());
let wsUrl;
for (let i = 0; i < 120 && !wsUrl; i++) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${porta}/json/version`)).json()).webSocketDebuggerUrl; } catch { await pausa(250); }
}
const ws = new WebSocket(wsUrl);
await new Promise((f, r) => { ws.onopen = f; ws.onerror = r; });
let seq = 0;
const espera = new Map(), ouvintes = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id) { const p = espera.get(d.id); espera.delete(d.id); d.error ? p.reject(Error(d.error.message)) : p.resolve(d.result); }
  // Um pedido interrompido no meio (página recarregada, internet cortada) já não aceita resposta.
  else Promise.resolve(ouvintes.get(d.sessionId || "")?.(d.method, d.params)).catch((e) => { if (!/Invalid InterceptionId/.test(e.message)) throw e; });
};
const cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++seq; espera.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId })); });

async function aba(nome, contexto, { width = 390, height = 780, mobile = true, dark = false } = {}) {
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank", browserContextId: contexto });
  const { sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true });
  const d = { nome, contexto, sessionId, targetId, erros: [], avisos: [], dialogos: [], aceitar: true, carregou: null };
  const s = (method, params) => cdp(method, params, sessionId);
  d.s = s;
  ouvintes.set(sessionId, async (method, p) => {
    if (method === "Runtime.exceptionThrown") d.erros.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text);
    if (method === "Runtime.consoleAPICalled" && (p.type === "error" || p.type === "warning")) (p.type === "error" ? d.erros : d.avisos).push(p.args.map((a) => a.value ?? a.description).join(" "));
    if (method === "Log.entryAdded" && p.entry.level === "error" && !/Failed to load resource/.test(p.entry.text)) d.erros.push(p.entry.text);
    if (method === "Page.javascriptDialogOpening") { d.dialogos.push(p.message); await s("Page.handleJavaScriptDialog", { accept: d.aceitar }); }
    if (method === "Page.loadEventFired") d.carregou?.();
    if (method === "Fetch.requestPaused") {
      const url = new URL(p.request.url);
      if (url.host !== FAKE) { fake.real++; return s("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" }); }
      if (fake.down) return s("Fetch.failRequest", { requestId: p.requestId, errorReason: "InternetDisconnected" });
      let body = p.request.postData;
      if (body === undefined && p.request.hasPostData) {
        // O corpo de um envio de arquivo vem em base64; se o Chrome não o entregar, segue sem ele.
        const c = await s("Fetch.getRequestPostData", { requestId: p.requestId }).catch(() => ({ postData: "" }));
        body = Buffer.from(c.postData, c.base64Encoded ? "base64" : "utf8").toString(c.base64Encoded ? "latin1" : "utf8");
      }
      const h = Object.fromEntries(Object.entries(p.request.headers).map(([k, v]) => [k.toLowerCase(), v]));
      let r;
      try { r = responder(p.request.method, url, h, body); } catch (e) { r = json(500, { message: String(e.message) }); d.erros.push("servidor de teste: " + e.message); }
      await s("Fetch.fulfillRequest", {
        requestId: p.requestId, responseCode: r.status,
        responseHeaders: Object.entries({ "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Content-Range", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*", ...r.headers }).map(([name, value]) => ({ name, value })),
        body: Buffer.from(r.body || "").toString("base64"),
      });
    }
  });
  await s("Page.enable"); await s("Runtime.enable"); await s("Log.enable");
  await s("Fetch.enable", { patterns: [{ urlPattern: "*supabase.co*" }] });
  await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile });
  if (mobile) await s("Emulation.setTouchEmulationEnabled", { enabled: true });
  await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
  await s("Page.addScriptToEvaluateOnNewDocument", { source: "window.__csp=[];document.addEventListener('securitypolicyviolation',e=>__csp.push(e.violatedDirective+' '+e.blockedURI));" });
  return d;
}
const aparelho = async (nome, opts) => aba(nome, (await cdp("Target.createBrowserContext")).browserContextId, opts);
async function ev(d, expr) {
  const r = await d.s("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(`[${d.nome}] ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}\n   em: ${expr.slice(0, 200)}`);
  return r.result.value;
}
async function ate(d, expr, ms = 8000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) { if (await ev(d, `Promise.resolve((${expr})).then(Boolean)`).catch(() => false)) return true; await pausa(60); }
  return false;
}
// Tira (ou devolve) a internet do aparelho inteiro: a página, o serviço que guarda o app, a nuvem e o site.
async function internet(d, ligada) {
  fake.down = fake.fora = !ligada;
  const rede = { offline: !ligada, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
  const { targetInfos } = await cdp("Target.getTargets");
  for (const t of targetInfos.filter((t) => t.type === "service_worker" && t.browserContextId === d.contexto)) {
    const { sessionId } = await cdp("Target.attachToTarget", { targetId: t.targetId, flatten: true });
    await cdp("Network.enable", {}, sessionId);
    await cdp("Network.emulateNetworkConditions", rede, sessionId);
  }
  await d.s("Network.enable");
  await d.s("Network.emulateNetworkConditions", rede);
}
async function abrir(d, caminho = "") {
  const p = new Promise((f) => (d.carregou = f));
  await d.s("Page.navigate", { url: BASE + caminho });
  await p;
  await ate(d, "document.getElementById('main').innerHTML.length > 50");
}
async function foto(d, nome) {
  await pausa(150);
  const { data } = await d.s("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, nome + ".png"), Buffer.from(data, "base64"));
}
const texto = (d) => ev(d, "document.getElementById('main').innerText");
const sinc = (d) => ate(d, "syncState === 'ok' && !syncing && !unsent()");
const forcar = async (d) => { await ev(d, "retry()"); await pausa(80); return sinc(d); };
const entrar = async (d, email, senha, modo = "in") => {
  if (modo !== "in") await ev(d, `document.querySelector('[data-action=authMode][data-mode=${modo}]').click()`);
  await ate(d, "sb");
  await ev(d, `(()=>{const f=document.getElementById('authForm');f.elements.email.value=${JSON.stringify(email)};f.elements.password.value=${JSON.stringify(senha)};f.requestSubmit();})()`);
};
const novoEstudo = (d, titulo, extra = {}) => ev(d, `(()=>{document.querySelector('[data-action=newCourse]').click();const v=${JSON.stringify({ title: titulo, goal: "Propósito de " + titulo, ...extra })};for(const k in v){if(k==='days')courseForm.querySelectorAll('[name=days]').forEach(c=>c.checked=v.days.includes(+c.value));else courseForm.elements[k].value=v[k];}courseForm.requestSubmit();return state.courses.find(c=>c.title===v.title)?.id;})()`);
const novaParte = (d, curso, titulo) => ev(d, `(()=>{openPart(${JSON.stringify(curso)});partForm.elements.title.value=${JSON.stringify(titulo)};partForm.elements.application.value='Usar ${titulo}';partForm.requestSubmit();return state.parts.find(p=>p.title===${JSON.stringify(titulo)})?.id;})()`);
const novaIdeia = (d, titulo, extra = {}) => ev(d, `(()=>{openIdea();const v=${JSON.stringify({ title: titulo, ...extra })};for(const k in v)ideaForm.elements[k].value=v[k];ideaForm.requestSubmit();return state.ideas.find(i=>i.title===v.title)?.id;})()`);
const titulos = (d, lista = "courses") => ev(d, `state.${lista}.map(x=>x.title)`);
const semTransbordo = (d) => ev(d, "document.documentElement.scrollWidth <= window.innerWidth + 1");

try {
  // ================= 1. Modo local (sem nuvem): nada do que existia pode quebrar =================
  console.log("\n— Modo local, celular —");
  const L = await aparelho("local");
  await abrir(L, "?modo=local");
  ok("abre sem tela de login e sem botão de conta", await ev(L, "!locked() && document.getElementById('accountButton').hidden && !!document.querySelector('.hero')"));
  ok("rodapé continua dizendo que não há sincronização", /não há sincronização/.test(await ev(L, "document.getElementById('footerNote').textContent")));
  const c1 = await novoEstudo(L, "JavaScript", { box: "season", days: [1, 3], startTime: "19:00", endTime: "20:00" });
  const p1 = await novaParte(L, c1, "Aula 1");
  await novaParte(L, c1, "Aula 2");
  await ev(L, `(()=>{openSession(${JSON.stringify(c1)});sessionForm.elements.minutes.value=30;sessionForm.elements.learned.value='variáveis';sessionForm.elements.nextStep.value='aula 2';sessionForm.requestSubmit();openCompletion(${JSON.stringify(p1)});completionForm.elements.learned.value='entendi';completionForm.requestSubmit();})()`);
  ok("cria estudo, partes, sessão e conclui parte", await ev(L, "state.courses.length===1 && state.parts.length===2 && state.sessions.length===1 && state.parts[0].done"));
  ok("novos itens ganham data de criação", await ev(L, "state.courses.every(c=>c.created>1e12) && state.parts.every(p=>p.created>1e12)"));
  for (const pg of ["studies", "ideas", "agenda", "review", "backup"]) {
    await ev(L, `document.querySelector('nav [data-page=${pg}]').click()`);
    ok(`celular: tela ${pg} sem rolagem lateral`, await semTransbordo(L));
  }
  ok("celular: menu fica fixo embaixo, com ícones", await ev(L, "getComputedStyle(document.querySelector('.top nav')).position==='fixed' && getComputedStyle(document.querySelector('.top nav .icon')).display==='block'"));
  ok("celular: rótulos curtos no menu", (await ev(L, "[...document.querySelectorAll('nav button')].map(b=>b.innerText.trim()).join('|')")) === "Estante|Ideias|Agenda|Revisão|Ajuda");
  // ideias: estudos que ainda não começaram, guardados sem prazo e sem horário
  await ev(L, "document.querySelector('nav [data-page=ideas]').click()");
  const i1 = await novaIdeia(L, "Violão", { note: "Tocar uma música inteira" });
  const i2 = await novaIdeia(L, "Astronomia", { box: "sand" });
  ok("ideia guardada na lista dela, só com nome, anotação e caixa: sem prazo e sem horário", await ev(L, `(()=>{const i=findIdea(${JSON.stringify(i1)});return Object.keys(i).sort().join()==='box,created,id,image,note,title' && i.box==='' && i.image==='' && i.note==='Tocar uma música inteira' && state.courses.length===1 && !ideaDialog.open})()`));
  const figura = await ev(L, "(()=>{const c=document.createElement('canvas');c.width=c.height=40;c.getContext('2d').fillRect(0,0,40,40);return c.toDataURL('image/jpeg',.8)})()");
  await ev(L, `(()=>{openIdea(${JSON.stringify(i1)});showImage(${JSON.stringify(figura)});ideaForm.requestSubmit();})()`);
  ok("imagem da ideia: fica guardada com ela e aparece na frente da caixinha fechada", await ev(L, `findIdea(${JSON.stringify(i1)}).image===${JSON.stringify(figura)} && courseImage==='' && document.querySelectorAll('article.box.shut image').length===1 && !document.getElementById('ideaPreview').hidden`));
  ok("página Ideias: uma caixinha fechada por ideia, com a etiqueta 'Sem data' pendurada, e a de nova ideia", await ev(L, "page==='ideas' && document.querySelectorAll('.shelf').length===1 && document.querySelectorAll('article.box.shut .carton').length===2 && document.querySelectorAll('.box.add').length===1 && document.querySelectorAll('article.box .carton .k-tag').length===2 && !document.querySelector('.box.add .k-tag') && [...document.querySelectorAll('article.box:first-child .carton text')].map(t=>t.textContent).join(' ')==='Sem data' && /Violão[^]*Tocar uma música inteira[^]*Areia[^]*Astronomia/.test(document.querySelector('.boxes').innerText)"), await ev(L, "document.querySelector('.boxes')?.innerText"));
  ok("celular: página de ideias sem rolagem lateral", await semTransbordo(L));
  await foto(L, "2b-celular-claro-ideias");
  ok("ideia fica fora da estante e da agenda, e entra no relatório como ideia", await ev(L, "(()=>{page='studies';render();const n=document.querySelectorAll('article.box').length;page='ideas';render();return n===1 && agenda().every(r=>r.title==='JavaScript') && /Ideias para começar um dia[^]*Violão — Tocar uma música inteira/.test(reportBody()) && !/Astronomia ·/.test(reportBody())})()"));
  ok("dados com ideias passam na conferência; ideia com caixa que não existe, não", await ev(L, "(()=>{validate(JSON.parse(JSON.stringify(state)));try{validate({...state,ideas:[{...state.ideas[0],box:'outra'}]});return false}catch(e){return true}})()"));
  ok("dados de antes das ideias abrem; e ideia da primeira versão (um estudo na situação 'idea') vira ideia", await ev(L, "(()=>{const velho=JSON.parse(JSON.stringify(state));delete velho.ideas;velho.courses.push({...velho.courses[0],id:'velha',title:'Ideia velha',status:'idea',box:'',goal:'nota antiga'});const d=validate(upgrade(velho));return d.courses.length===1 && d.ideas.length===1 && d.ideas[0].id==='velha' && d.ideas[0].note==='nota antiga' && d.ideas[0].box===''})()"));
  await ev(L, `document.querySelector('[data-action=editIdea][data-id=${JSON.stringify(i1)}]').click()`);
  ok("tocar na ideia: a caixinha abre e só depois aparece o formulário dela, com Começar e Excluir", (await ev(L, "!ideaDialog.open && document.querySelectorAll('.box.shut.opening').length===1")) && (await ate(L, "ideaDialog.open && ideaForm.elements.title.value==='Violão' && !document.getElementById('ideaActions').hidden")));
  await ev(L, "document.querySelector('#ideaDialog [data-close]').click()");
  ok("fechar o formulário sem mexer: a caixinha volta a fechar", await ate(L, "!ideaDialog.open && !document.querySelector('.box.opening') && document.querySelectorAll('article.box.shut').length===2"));
  await ev(L, `document.querySelector('[data-action=editIdea][data-id=${JSON.stringify(i1)}]').click()`);
  await ate(L, "ideaDialog.open");
  await foto(L, "2c-celular-claro-ideia-aberta");
  await ev(L, "document.querySelector('[data-action=startIdea]').click()");
  ok("Começar: abre o formulário do estudo já preenchido, em andamento e valendo desde hoje", await ev(L, "!ideaDialog.open && courseDialog.open && document.getElementById('courseHeading').textContent==='Começar estudo' && courseForm.elements.title.value==='Violão' && courseForm.elements.goal.value==='Tocar uma música inteira' && courseForm.elements.status.value==='active' && courseForm.elements.box.value==='sustain' && courseForm.elements.scheduleStart.value===today() && courseImage===ideaImage && courseImage.length>100"));
  await ev(L, "courseDialog.close()");
  ok("desistir de começar: continua sendo ideia", await ev(L, `!!findIdea(${JSON.stringify(i1)}) && state.ideas.length===2 && state.courses.length===1`));
  await ev(L, `(()=>{openIdea(${JSON.stringify(i1)});document.querySelector('[data-action=startIdea]').click();courseForm.elements.box.value='sand';courseForm.requestSubmit();})()`);
  ok("começar de verdade: a ideia sai da lista de ideias, vira estudo e vai para a estante", await ev(L, `(()=>{const c=state.courses.find(c=>c.title==='Violão');return c.status==='active' && c.box==='sand' && c.goal==='Tocar uma música inteira' && c.image===${JSON.stringify(figura)} && !findIdea(${JSON.stringify(i1)}) && state.ideas.length===1 && page==='studies' && document.querySelectorAll('.shelf.sand article.box').length===1})()`));
  L.dialogos.length = 0;
  await ev(L, `(()=>{openIdea(${JSON.stringify(i2)});document.querySelector('[data-action=deleteIdea]').click();})()`);
  ok("excluir ideia: pergunta antes e apaga", L.dialogos.some((m) => /Excluir esta ideia/.test(m)) && (await ev(L, "!ideaDialog.open && state.ideas.length===0 && state.courses.length===2")));
  await ev(L, `(()=>{selected=state.courses.find(c=>c.title==='Violão').id;page='detail';render();document.querySelector('[data-action=deleteCourse]').click();})()`);
  await ev(L, "document.querySelector('nav [data-page=studies]').click()");
  await foto(L, "2-celular-claro-estante");
  ok("estante: uma prateleira por caixa, e em cada uma a caixinha de novo estudo", await ev(L, "document.querySelectorAll('.shelf').length===3 && document.querySelectorAll('.shelf .box.add .carton').length===3"));
  ok("estudo em andamento aparece como caixinha aberta", await ev(L, "document.querySelectorAll('.shelf.season article.box:not(.shut) .carton').length===1 && !document.querySelector('.box.shut')"));
  await ev(L, `document.querySelector('[data-action=open]').click()`);
  ok("ao abrir um estudo, 'Estante' fica marcado no menu", await ev(L, "document.querySelector('nav [aria-current=page]').dataset.page==='studies'"));
  await foto(L, "3-celular-claro-estudo");
  await ev(L, "document.querySelector('[data-action=newPart]').click()");
  ok("celular: formulário abre como folha colada embaixo, na largura toda", await ev(L, "(()=>{const r=partDialog.getBoundingClientRect();return Math.abs(r.bottom-innerHeight)<2 && Math.abs(r.width-innerWidth)<2})()"));
  ok("celular: campos com letra de 16px (evita zoom do iPhone)", await ev(L, "getComputedStyle(partForm.elements.title).fontSize==='16px'"));
  await foto(L, "4-celular-claro-formulario");
  await ev(L, "partDialog.close()");
  // tema
  ok("começa no claro quando o sistema está no claro", await ev(L, "document.documentElement.dataset.theme==='light'"));
  const fundoClaro = await ev(L, "getComputedStyle(document.body).backgroundColor");
  await ev(L, "document.getElementById('themeButton').click()");
  const fundoEscuro = await ev(L, "getComputedStyle(document.body).backgroundColor");
  ok("botão troca para o modo escuro", (await ev(L, "document.documentElement.dataset.theme")) === "dark" && fundoClaro !== fundoEscuro, `${fundoClaro} -> ${fundoEscuro}`);
  ok("no escuro, cartões e campos deixam de ser brancos", await ev(L, "![...document.querySelectorAll('.card,.panel,.stat,button,header')].some(e=>getComputedStyle(e).backgroundColor==='rgb(255, 255, 255)')"));
  await foto(L, "5-celular-escuro-estudo");
  // material, imagem e caixinha fechada
  const jpg = await ev(L, "(()=>{const c=document.createElement('canvas');c.width=c.height=40;c.getContext('2d').fillRect(0,0,40,40);return c.toDataURL('image/jpeg',.8)})()");
  await ev(L, `(()=>{openCourse(${JSON.stringify(c1)});courseForm.elements.material.value=' Livro de JS ';showImage(${JSON.stringify(jpg)});courseForm.requestSubmit();})()`);
  ok("estudo guarda o nome do material e a imagem", await ev(L, `state.courses[0].material==='Livro de JS' && state.courses[0].image===${JSON.stringify(jpg)}`));
  ok("a imagem vai para a etiqueta da caixinha e para a tela do estudo", await ev(L, "!!document.querySelector('img.cover') && /Material: Livro de JS/.test(document.querySelector('.linkrow').textContent)"));
  ok("imagem fora do padrão é recusada na importação", await ev(L, "(()=>{try{validate({...state,courses:[{...state.courses[0],image:'data:text/html;base64,AAAA'}]});return false}catch(e){return true}})()"));
  await ev(L, "document.querySelector('[data-action=finishCourse]').click()");
  ok("concluir o estudo fecha a caixinha na estante", await ev(L, "page==='studies' && state.courses[0].status==='finished' && document.querySelectorAll('.box.shut image').length===1"));
  await foto(L, "6-celular-escuro-estante");
  await ev(L, "document.querySelector('.box.shut [data-action=open]').click()");
  ok("tocar na caixinha fechada: ela abre e só depois mostra o estudo", (await ev(L, "page==='studies' && !!document.querySelector('.box.shut.opening')")) && (await ate(L, "page==='detail'")));
  await ev(L, "document.querySelector('[data-action=reopenCourse]').click()");
  ok("reabrir a caixa devolve o estudo ao andamento", await ev(L, "state.courses[0].status==='active'"));
  await abrir(L, "?modo=local");
  ok("tema escolhido e dados continuam depois de recarregar", await ev(L, "document.documentElement.dataset.theme==='dark' && state.courses.length===1 && state.parts.length===2 && state.sessions.length===1"));
  ok("cor da barra do navegador acompanha o tema", (await ev(L, "document.querySelector('meta[name=theme-color]').content")) === "#1b221f");
  ok("modo local: sem erros no console", L.erros.length === 0, L.erros.join(" | "));
  ok("modo local: trava do navegador (CSP) não barrou nada do app", (await ev(L, "__csp.length")) === 0, await ev(L, "__csp.join(' | ')"));
  ok("CSP está ativa: barra conexão com endereço estranho", await ev(L, "fetch('https://example.com/').then(()=>false,()=>true)") && (await ev(L, "__csp.some(v=>v.includes('connect-src'))")));

  console.log("\n— Modo local, computador, sistema no escuro —");
  const D = await aparelho("desktop", { width: 1280, height: 800, mobile: false, dark: true });
  await ev(D, "0");
  await D.s("Page.addScriptToEvaluateOnNewDocument", { source: `if(!localStorage.getItem('estudo-em-caixas-v1'))localStorage.setItem('estudo-em-caixas-v1', ${JSON.stringify(JSON.stringify({ app: "estudo-em-caixas", version: 1, reminders: false, notified: {}, sessions: [], courses: [{ id: "a", title: "Antigo 1", box: "sustain", status: "active", goal: "g", project: "", url: "", deadline: "", scheduleStart: "2026-01-01", days: [], startTime: "", endTime: "", nextStep: "voltar à aula 3" }, { id: "b", title: "Antigo 2", box: "sand", status: "active", goal: "g", project: "", url: "", deadline: "", scheduleStart: "2026-01-01", days: [], startTime: "", endTime: "", nextStep: "" }], parts: [{ id: "z", course: "a", title: "Parte Z", application: "x", evidence: "", url: "", learned: "", deadline: "", reviewDate: "", completed: "", done: false, estimate: null }, { id: "y", course: "a", title: "Parte Y", application: "x", evidence: "", url: "", learned: "", deadline: "", reviewDate: "", completed: "", done: false, estimate: 20 }] }))});` });
  await abrir(D, "?modo=local");
  ok("segue o sistema: abre no escuro sem ninguém escolher", await ev(D, "document.documentElement.dataset.theme==='dark'"));
  ok("dados no formato antigo abrem e mantêm a ordem", JSON.stringify(await titulos(D, "parts")) === '["Parte Z","Parte Y"]' && (await ev(D, "state.parts.map(p=>p.created).join()")) === "1,2");
  ok("computador: menu no topo, só texto", await ev(D, "getComputedStyle(document.querySelector('.top nav')).position!=='fixed' && getComputedStyle(document.querySelector('.top nav .icon')).display==='none' && document.querySelector('nav [data-page=agenda]').innerText.trim()==='Minha agenda'"));
  await foto(D, "7-computador-escuro-estante");
  await ev(D, "document.querySelector('nav [data-page=studies]').click()");
  await foto(D, "8-computador-escuro-estudos");
  await ev(D, "document.getElementById('themeButton').click()");
  await foto(D, "9-computador-claro-estudos");
  ok("computador: cabem na fileira tantas caixinhas quantas a largura da estante permite, e sem seta à toa", await ev(D, "(()=>{page='studies';render();const b=document.querySelector('.boxes');return +getComputedStyle(b).getPropertyValue('--per')===Math.floor((b.clientWidth-12)/168) && b.scrollWidth<=b.clientWidth && [...document.querySelectorAll('.slide')].every(s=>s.hidden)})()"));
  ok("computador: sem erros no console", D.erros.length === 0, D.erros.join(" | "));

  // prateleira com mais estudos do que cabem na tela: a fileira segue para a direita e desliza
  console.log("\n— Prateleira que desliza, celular —");
  const S = await aparelho("prateleira");
  await abrir(S, "?modo=local");
  const fileira = "document.querySelector('.shelf.sustain .boxes')", seta = (lado) => `document.querySelector('.shelf.sustain .slide${lado}')`;
  // Seta que funciona, seta apagada (não há mais para onde ir) e setas longe de qualquer caixinha.
  const pode = (s) => `(!${s}.hidden && !${s}.disabled)`, apagada = (s) => `(!${s}.hidden && ${s}.disabled)`;
  const livres = "[...document.querySelectorAll('.slide:not([hidden])')].every(s=>{const a=s.getBoundingClientRect();return [...s.parentNode.querySelectorAll('.carton')].every(c=>{const b=c.getBoundingClientRect();return a.right<=b.left||a.left>=b.right||a.bottom<=b.top})})";
  await novoEstudo(S, "Um");
  ok("prateleira com um estudo: cabe tudo, nenhuma seta", await ev(S, `${fileira}.scrollWidth<=${fileira}.clientWidth && ${seta("")}.hidden && ${seta(".next")}.hidden`));
  for (const t of ["Dois", "Três", "Quatro"]) await novoEstudo(S, t);
  ok("os estudos seguem para a direita, numa fileira só, duas caixinhas por vez", await ev(S, `(()=>{const b=${fileira},k=[...b.children];return k.length===5 && k.every(x=>x.offsetTop===k[0].offsetTop) && b.offsetHeight===323 && Math.abs(k[0].offsetWidth-(b.clientWidth-12)/2)<1 && b.scrollWidth>b.clientWidth*2})()`));
  ok("estudo novo: a prateleira desliza até a caixinha dele", await ev(S, `(()=>{const r=[...document.querySelectorAll('.cardlink')].find(b=>b.innerText==='Quatro').closest('.box').getBoundingClientRect(),v=${fileira}.getBoundingClientRect();return r.left>=v.left && r.right<=v.right+1})()`));
  ok("redesenhar a tela não devolve a prateleira ao começo", await ev(S, `(()=>{const x=${fileira}.scrollLeft;render();return x>0 && ${fileira}.scrollLeft===x})()`));
  await ev(S, `${fileira}.scrollLeft=0`);
  ok("no começo da prateleira: a seta da direita funciona e a da esquerda fica apagada", await ate(S, `${apagada(seta(""))} && ${pode(seta(".next"))}`));
  ok("as setas ficam no canto da prateleira, sem cobrir nenhuma caixinha", await ev(S, `document.querySelectorAll('.slide:not([hidden])').length===2 && ${livres}`));
  await foto(S, "9b-celular-prateleira-comeco");
  await ev(S, `${seta(".next")}.click()`);
  ok("a seta desliza uma fileira inteira e a da esquerda passa a funcionar", await ate(S, `Math.abs(${fileira}.scrollLeft-(${fileira}.clientWidth-12))<2 && ${pode(seta(""))}`), await ev(S, `${fileira}.scrollLeft`));
  await foto(S, "9c-celular-prateleira-meio");
  await ev(S, `${seta(".next")}.click()`);
  ok("no fim da prateleira: a caixinha de novo estudo, e a seta da direita apagada", await ate(S, `${apagada(seta(".next"))} && ${pode(seta(""))} && ${fileira}.lastElementChild.getBoundingClientRect().right<=${fileira}.getBoundingClientRect().right+1`));
  await ev(S, `${seta("")}.click()`);
  ok("a seta da esquerda volta uma fileira, e a da direita volta a funcionar", await ate(S, `Math.abs(${fileira}.scrollLeft-(${fileira}.clientWidth-12)/2)<2 && ${pode(seta(".next"))}`), await ev(S, `${fileira}.scrollLeft`));
  ok("prateleira que desliza não faz a página rolar para o lado", await semTransbordo(S));
  // a prateleira da página Ideias desliza do mesmo jeito
  await ev(S, "document.querySelector('nav [data-page=ideas]').click()");
  for (const t of ["Ideia A", "Ideia B", "Ideia C"]) await novaIdeia(S, t);
  ok("ideias: fileira só, e a prateleira desliza até a ideia nova", await ev(S, `(()=>{const b=document.querySelector('.boxes'),k=[...b.children],r=k[2].getBoundingClientRect(),v=b.getBoundingClientRect();return page==='ideas' && k.length===4 && k.every(x=>x.offsetTop===k[0].offsetTop) && b.scrollLeft>0 && r.left>=v.left && r.right<=v.right+1})()`));
  await ev(S, "document.querySelector('.boxes').scrollLeft=0");
  ok("ideias: no começo, a seta da direita funciona, e nenhuma cobre caixinha ou etiqueta", (await ate(S, `${apagada("document.querySelector('.slide')")} && ${pode("document.querySelector('.slide.next')")}`)) && (await ev(S, livres)));
  await foto(S, "9d-celular-ideias-desliza");
  await ev(S, "document.querySelector('.slide.next').click()");
  ok("ideias: a seta leva até a caixinha de nova ideia, no fim", await ate(S, "document.querySelector('.slide.next').disabled && !document.querySelector('.slide').disabled && document.querySelector('.box.add').getBoundingClientRect().right<=document.querySelector('.boxes').getBoundingClientRect().right+1"));
  ok("ideias: a página não rola para o lado", await semTransbordo(S));
  ok("prateleira: sem erros no console", S.erros.length === 0, S.erros.join(" | "));

  // ================= 2. Nuvem =================
  console.log("\n— Nuvem: login —");
  const A = await aparelho("A");
  await abrir(A, "?modo=local");
  const ja = await novoEstudo(A, "Estudo antes da conta");
  await novaParte(A, ja, "Parte antiga");
  await abrir(A);
  ok("com a nuvem ligada, abre na tela de login", await ev(A, "locked() && !!document.getElementById('authForm') && getComputedStyle(document.querySelector('.top nav')).display==='none' && document.getElementById('accountButton').hidden"));
  ok("tela de login não mostra os estudos guardados no aparelho", !/Estudo antes da conta/.test(await texto(A)));
  await foto(A, "10-celular-login");
  ok("biblioteca do Supabase carrega do CDN com o hash de integridade conferido", await ate(A, "sb"));
  await entrar(A, "ana@teste.com", "senha-errada");
  ok("senha errada: mensagem clara e sem detalhe técnico", await ate(A, "document.getElementById('authError').textContent==='E-mail ou senha incorretos.'"), await ev(A, "document.getElementById('authError').textContent"));
  fake.autoconfirm = false;
  await entrar(A, "ana@teste.com", "segredo1", "up");
  ok("criar conta com confirmação por e-mail: avisa do link e volta para Entrar", await ate(A, "/link de confirmação/.test(document.querySelector('.login .note')?.textContent) && authMode==='in'"));
  ok("e-mail digitado continua no campo", (await ev(A, "document.querySelector('#authForm [name=email]').value")) === "ana@teste.com");
  await entrar(A, "ana@teste.com", "segredo1");
  ok("antes de confirmar o e-mail: pede para confirmar", await ate(A, "/Confirme seu e-mail/.test(document.getElementById('authError').textContent)"));
  await entrar(A, "ana@teste.com", "outra-senha", "up");
  ok("cadastrar e-mail que já existe não revela que ele existe", await ate(A, "/ainda não tinha conta/.test(document.querySelector('.login .note')?.textContent)"));
  fake.users.get("ana@teste.com").confirmed = true;
  await entrar(A, "ana@teste.com", "segredo1");
  ok("entra e mostra o app", await ate(A, "user && !locked() && !!document.querySelector('.hero')"));
  ok("primeira sincronização termina", await sinc(A));
  ok("estudos que já estavam no aparelho sobem para a conta", JSON.stringify(nomes("ana@teste.com", "estudo")) === '["Estudo antes da conta"]' && JSON.stringify(nomes("ana@teste.com", "parte")) === '["Parte antiga"]');
  ok("botão de conta mostra 'Sincronizado'", (await ev(A, "document.getElementById('accountLabel').textContent")) === "Sincronizado" && (await ev(A, "!document.getElementById('accountButton').hidden")));
  await foto(A, "11-celular-logado");

  console.log("\n— Nuvem: dois aparelhos —");
  const B = await aparelho("B", { width: 1280, height: 800, mobile: false });
  await abrir(B);
  await entrar(B, "ana@teste.com", "segredo1");
  ok("segundo aparelho entra e recebe os estudos", (await ate(B, "user && !locked()")) && (await sinc(B)) && JSON.stringify(await titulos(B)) === '["Estudo antes da conta"]' && JSON.stringify(await titulos(B, "parts")) === '["Parte antiga"]');
  const escritas0 = fake.writes;
  await forcar(A); await forcar(B);
  ok("sincronizar sem mudança não grava nada na nuvem", fake.writes === escritas0, `${fake.writes - escritas0} gravações`);
  const cb = await novoEstudo(B, "Criado no computador", { box: "sand" });
  await novaParte(B, ja, "Parte nova do computador");
  ok("computador envia sozinho depois de salvar", await sinc(B));
  await forcar(A);
  ok("celular recebe o estudo e a parte, na ordem de criação", JSON.stringify(await titulos(A)) === '["Estudo antes da conta","Criado no computador"]' && JSON.stringify(await titulos(A, "parts")) === '["Parte antiga","Parte nova do computador"]');
  // ideia: guardada num aparelho, começada no outro
  const ideia = await novaIdeia(A, "Ideia do celular");
  await sinc(A); await forcar(B);
  ok("ideia vai para a conta com o tipo próprio ('ideia') e chega ao outro aparelho", JSON.stringify(nomes("ana@teste.com", "ideia")) === '["Ideia do celular"]' && !nomes("ana@teste.com", "estudo").includes("Ideia do celular") && (await ev(B, `!!findIdea(${JSON.stringify(ideia)}) && state.ideas.length===1`)));
  await ev(A, `openIdea(${JSON.stringify(ideia)})`);
  await ev(B, `(()=>{openIdea(${JSON.stringify(ideia)});document.querySelector('[data-action=startIdea]').click();courseForm.elements.goal.value='Começar de verdade';courseForm.requestSubmit();})()`);
  await sinc(B); await forcar(A);
  ok("começada no computador: na nuvem sai das ideias e entra nos estudos; no celular também, e o formulário da ideia fecha", nomes("ana@teste.com", "ideia").length === 0 && nomes("ana@teste.com", "estudo").includes("Ideia do celular") && (await ev(A, "state.courses.some(c=>c.title==='Ideia do celular' && c.status==='active') && state.ideas.length===0 && !ideaDialog.open")));
  await ev(B, `(()=>{selected=state.courses.find(c=>c.title==='Ideia do celular').id;page='detail';render();document.querySelector('[data-action=deleteCourse]').click();})()`);
  await sinc(B); await forcar(A);
  // tabela do Supabase ainda com a regra antiga (schema.sql novo ainda não rodado)
  fake.semIdeia = true;
  const cedo = await novaIdeia(A, "Antes do schema");
  ok("tabela ainda sem o tipo 'ideia': avisa 'Não sincronizou' e a ideia fica guardada no aparelho", (await ate(A, "syncState==='error'")) && nomes("ana@teste.com", "ideia").length === 0 && (await ev(A, `!!findIdea(${JSON.stringify(cedo)}) && unsent() && document.getElementById('accountLabel').textContent==='Não sincronizou'`)));
  fake.semIdeia = false;
  ok("depois de rodar o schema.sql: a ideia sobe na tentativa seguinte", (await forcar(A)) && JSON.stringify(nomes("ana@teste.com", "ideia")) === '["Antes do schema"]');
  // ideia guardada pela primeira versão da página: estudo na situação "idea", no aparelho e na base
  const velha = await ev(A, `(()=>{const c={...state.courses[0],id:'velha',title:'Ideia velha',status:'idea',box:'',goal:'nota antiga',created:5},s=JSON.parse(localStorage.getItem(KEY)),n=JSON.parse(localStorage.getItem(CLOUD_KEY));s.ideas.length=0;delete s.ideas;s.courses.push(c);delete n.base.ideas;n.base.courses.push(c);localStorage.setItem(KEY,JSON.stringify(s));localStorage.setItem(CLOUD_KEY,JSON.stringify(n));return c})()`);
  const ana = fake.users.get("ana@teste.com").id;
  fake.rows.delete(`${ana}|ideia|${cedo}`);
  fake.rows.set(`${ana}|estudo|velha`, { user_id: ana, tipo: "estudo", id: "velha", dados: jsonb(velha) });
  await abrir(A);
  await ate(A, "user"); await sinc(A);
  ok("ideia da primeira versão: abre como ideia e sobe para a conta com o tipo próprio", JSON.stringify(nomes("ana@teste.com", "ideia")) === '["Ideia velha"]' && (await ev(A, `state.ideas.length===1 && canon(state.ideas[0])===canon(${JSON.stringify({ id: "velha", title: "Ideia velha", note: "nota antiga", box: "", image: "", created: 5 })}) && state.courses.every(c=>c.id!=='velha') && document.getElementById('warning').hidden`)), await ev(A, "JSON.stringify(state.ideas)"));
  // a linha antiga (tipo 'estudo') é o schema.sql que troca de tipo ou apaga; o app só a ignora
  ok("a linha antiga dela na nuvem não atrapalha: o app não a lê como estudo nem a apaga", fake.rows.has(`${ana}|estudo|velha`) && (await forcar(A)) && (await ev(A, "state.courses.every(c=>c.id!=='velha')")));
  fake.rows.delete(`${ana}|estudo|velha`);
  await ev(A, "(()=>{openIdea('velha');document.querySelector('[data-action=deleteIdea]').click();})()");
  await sinc(A); await forcar(B);
  // edições simultâneas em coisas diferentes
  await ev(A, `(()=>{openCourse(${JSON.stringify(ja)});courseForm.elements.goal.value='Propósito mudado no celular';courseForm.requestSubmit();})()`);
  await ev(B, `(()=>{openCourse(${JSON.stringify(cb)});courseForm.elements.title.value='Renomeado no computador';courseForm.requestSubmit();})()`);
  await sinc(A); await sinc(B); await forcar(A); await forcar(B);
  const fim = (d) => ev(d, "JSON.stringify(state.courses.map(c=>[c.title,c.goal]))");
  ok("edições ao mesmo tempo em estudos diferentes: as duas ficam", (await fim(A)) === (await fim(B)) && /Propósito mudado no celular/.test(await fim(A)) && /Renomeado no computador/.test(await fim(A)), await fim(A));
  // PDF do estudo: o arquivo vai para o Storage, na pasta da conta
  const pdf = (d, nome) => ev(d, `(()=>{const t=new DataTransfer();t.items.add(new File(["%PDF-1.4 teste"],${JSON.stringify(nome)},{type:""}));pdfInput.files=t.files;pdfInput.dispatchEvent(new Event("change"));})()`);
  const espere = async (f, ms = 5000) => { for (const fim = Date.now() + ms; Date.now() < fim; await pausa(50)) if (f()) return true; return false; };
  const dono = await ev(A, "user.id");
  await ev(A, `openCourse(${JSON.stringify(ja)})`);
  await pdf(A, "apostila.pdf");
  ok("PDF escolhido sobe para a pasta da conta, marcado como PDF", (await ate(A, "!pdfBusy && coursePdf.path")) && fake.files.size === 1 && [...fake.files.keys()][0].startsWith(dono + "/"), [...fake.files.keys()].join());
  await ev(A, "courseForm.requestSubmit()");
  await sinc(A); await forcar(B);
  ok("o estudo guarda o caminho e o nome do PDF, e o outro aparelho recebe", await ev(B, `(()=>{const c=findCourse(${JSON.stringify(ja)});return c.pdfName==="apostila.pdf" && fake0===c.pdf})()`.replace("fake0", JSON.stringify([...fake.files.keys()][0]))));
  await ev(B, `(()=>{selected=${JSON.stringify(ja)};page="detail";render();window.open=()=>({location:{replace:(u)=>(window.__pdf=u)},close(){}});document.querySelector("[data-action=openPdf]").click();})()`);
  ok("abrir o PDF no outro aparelho pede um link temporário à conta", await ate(B, "(window.__pdf||'').includes('/object/sign/eec-arquivos/') && window.__pdf.endsWith('.pdf?token=t')"), await ev(B, "window.__pdf"));
  // leitor de PDF dentro do app
  await ev(B, "document.querySelector('[data-action=readPdf]').click()");
  ok("o leitor abre o PDF dentro do app e desenha a primeira folha", await ate(B, "readerDialog.open && reader?.doc?.numPages===2 && !readerCanvas.hidden && readerCanvas.width>200 && readerPage.textContent==='1 / 2'", 40000), await ev(B, "readerNote.textContent+' | '+readerPage.textContent"));
  ok("a folha tem tinta (não ficou em branco)", await ev(B, "(()=>{const c=readerCanvas,d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=0;i<d.length;i+=4)if(d[i]<90&&d[i+3]>200)return true;return false})()"));
  await foto(B, "10-computador-leitor-de-pdf");
  await ev(B, "document.querySelector('[data-action=readerNext]').click()");
  ok("passa para a folha seguinte", await ate(B, "readerPage.textContent==='2 / 2' && reader.task && !readerNote.hidden===false"));
  await ev(B, "readerDialog.close()");
  ok("ao fechar, o estudo guarda a folha em que a leitura parou", await ate(B, `!reader && findCourse(${JSON.stringify(ja)}).pdfPage===2`), await ev(B, `JSON.stringify([!!reader, findCourse(${JSON.stringify(ja)}).pdfPage, readerDialog.open])`));
  await sinc(B); await forcar(A);
  ok("e o outro aparelho recebe a folha", await ev(A, `findCourse(${JSON.stringify(ja)}).pdfPage===2`));
  // leitor no celular em pé: margens cortadas, pinça e dois toques
  await ev(A, `openReader(${JSON.stringify(ja)})`);
  ok("no celular o leitor abre na folha em que a leitura parou", await ate(A, "reader?.doc && reader.page===2 && !readerCanvas.hidden && readerPage.textContent==='2 / 2'", 40000), await ev(A, "readerNote.textContent+' | '+readerPage.textContent"));
  const medida = () => ev(A, "JSON.stringify({w:readerCanvas.clientWidth,h:readerCanvas.clientHeight,tela:readerBody.clientWidth,zoom:reader.zoom})").then(JSON.parse);
  const m1 = await medida();
  ok("celular em pé: as margens brancas são cortadas e o texto ocupa a largura da tela", m1.w > m1.tela - 16 && m1.w <= m1.tela && m1.w / m1.h > 3, JSON.stringify(m1));
  // dedos de mentira: cada ponto é [x, y] na tela
  await ev(A, "window.dedos=(tipo,pts,fim)=>{const ts=pts.map((p,i)=>new Touch({identifier:i,target:readerBody,clientX:p[0],clientY:p[1]}));readerBody.dispatchEvent(new TouchEvent(tipo,{touches:fim?[]:ts,changedTouches:ts,bubbles:true,cancelable:true}))}");
  await ev(A, "(()=>{dedos('touchstart',[[150,300]]);dedos('touchstart',[[150,300],[250,300]]);dedos('touchmove',[[100,300],[300,300]]);dedos('touchend',[[100,300],[300,300]],true);})()");
  ok("pinça com dois dedos amplia a folha (e ela é redesenhada no novo tamanho)", await ate(A, `Math.abs(reader.zoom-2)<0.01 && Math.abs(readerCanvas.clientWidth-${m1.w * 2})<4 && readerBody.scrollWidth>readerBody.clientWidth+50`), JSON.stringify(await medida()));
  const toques = "(async()=>{for(let i=0;i<2;i++){dedos('touchstart',[[200,300]]);dedos('touchend',[[200,300]],true);await new Promise(f=>setTimeout(f,60));}})()";
  await ev(A, toques);
  ok("dois toques com a folha ampliada voltam ao tamanho da tela", await ate(A, `reader.zoom===1 && Math.abs(readerCanvas.clientWidth-${m1.w})<3`), JSON.stringify(await medida()));
  await ev(A, toques);
  ok("dois toques no tamanho da tela ampliam", await ate(A, `Math.abs(reader.zoom-2.4)<0.01 && readerCanvas.clientWidth>${m1.w * 2}`), JSON.stringify(await medida()));
  await foto(A, "11-celular-leitor-ampliado");
  await ev(A, "(()=>{dedos('touchstart',[[300,300]]);dedos('touchend',[[100,300]],true);})()");
  ok("com a folha ampliada, arrastar o dedo não vira a folha", await ev(A, "reader.page===2"));
  await ev(A, "readerDialog.close()");
  await ate(A, "!reader");
  await ev(A, `openCourse(${JSON.stringify(ja)})`);
  await pdf(A, "outro.pdf");
  ok("trocar de PDF envia o novo", (await ate(A, "!pdfBusy && coursePdf.name==='outro.pdf'")) && fake.files.size === 2);
  await ev(A, "courseDialog.close()");
  ok("desistir do formulário descarta o PDF que tinha acabado de subir e mantém o do estudo", (await espere(() => fake.files.size === 1)) && (await ev(A, `fake0===findCourse(${JSON.stringify(ja)}).pdf`.replace("fake0", JSON.stringify([...fake.files.keys()][0])))));
  fake.down = true;
  await ev(A, `(()=>{openCourse(${JSON.stringify(ja)});document.getElementById("clearPdf").click();courseForm.requestSubmit();})()`);
  await pausa(300);
  ok("tirar o PDF sem internet: o pedido de apagar fica anotado no aparelho", fake.files.size === 1 && (await ev(A, `cloud.trash.length===1 && findCourse(${JSON.stringify(ja)}).pdf==="" && JSON.parse(localStorage.getItem(CLOUD_KEY)).trash.length===1`)));
  fake.down = false;
  await forcar(A);
  ok("a internet volta: o arquivo sai da conta", (await espere(() => fake.files.size === 0)) && (await ate(A, "cloud.trash.length===0")));
  await forcar(B);
  // exclusão
  await ev(B, `document.querySelector('nav [data-page=studies]').click()`);
  await ev(A, `(()=>{selected=${JSON.stringify(cb)};page='detail';render();openPart(${JSON.stringify(cb)});})()`);
  await ev(B, `(()=>{selected=${JSON.stringify(cb)};page='detail';render();document.querySelector('[data-action=deleteCourse]').click();})()`);
  await sinc(B); await forcar(A);
  ok("excluir no computador some do celular (e fecha o formulário que ficou órfão)", JSON.stringify(await titulos(A)) === '["Estudo antes da conta"]' && (await ev(A, "!partDialog.open && page==='studies'")), JSON.stringify(await titulos(A)));
  ok("nuvem ficou só com o que sobrou", JSON.stringify(nomes("ana@teste.com", "estudo")) === '["Estudo antes da conta"]');

  console.log("\n— Nuvem: sem internet —");
  fake.down = true;
  const t0 = Date.now();
  const off = await novoEstudo(A, "Feito sem internet");
  await novaParte(A, off, "Parte offline");
  ok("sem internet: salva no aparelho e avisa 'Sem conexão'", (await ate(A, "syncState==='offline'", 20000)) && (await ev(A, "unsent() && document.getElementById('accountLabel').textContent==='Sem conexão'")), await ev(A, "JSON.stringify({syncState,syncing,un:unsent(),rotulo:document.getElementById('accountLabel').textContent})") + " em " + (Date.now() - t0) + "ms");
  await abrir(A);
  ok("sem internet e recarregando: abre direto nos estudos, sem pedir login", await ev(A, "!locked() && state.courses.length===2 && !!document.querySelector('.hero')"));
  ok("nada foi para a nuvem ainda", nomes("ana@teste.com", "estudo").length === 1);
  await ev(B, `(()=>{openPart(${JSON.stringify(ja)});partForm.elements.title.value='Parte do computador, enquanto o celular estava fora';partForm.elements.application.value='x';partForm.requestSubmit();})()`);
  fake.down = false;
  await forcar(B);
  ok("internet volta: celular envia o que ficou guardado e recebe o que perdeu", (await ate(A, "user")) && (await forcar(A)) && nomes("ana@teste.com", "estudo").includes("Feito sem internet") && (await titulos(A, "parts")).length === 4, JSON.stringify(await titulos(A, "parts")));
  await forcar(B);
  ok("os dois aparelhos terminam iguais", (await ev(A, "JSON.stringify(COLS.map(k=>state[k].map(canon)))")) === (await ev(B, "JSON.stringify(COLS.map(k=>state[k].map(canon)))")));

  console.log("\n— Nuvem: sem internet com a sessão vencida —");
  // A sessão da conta vale 1 hora e a biblioteca renova sozinha; sem internet, a renovação não sai.
  await ev(A, "(()=>{const k='estudo-em-caixas-conta',s=JSON.parse(localStorage.getItem(k));s.expires_at=Math.floor(Date.now()/1000)-60;localStorage.setItem(k,JSON.stringify(s));})()");
  fake.down = true;
  const errosAntes = A.erros.length;
  await abrir(A);
  ok("abre direto nos estudos", await ev(A, "!locked() && !!document.querySelector('.hero')"));
  const vencida = await novoEstudo(A, "Feito com a sessão vencida");
  const situacao = () => ev(A, "JSON.stringify({syncState,authKnown,trancado:locked(),user:!!user,rotulo:document.getElementById('accountLabel').textContent})");
  // A biblioteca insiste por uns 25 s antes de desistir de renovar.
  ok("quando a renovação desiste, continua aberto e avisa 'Sem conexão'", (await ate(A, "syncState==='offline' || authKnown", 45000)) && (await ev(A, "syncState==='offline' && !locked() && !document.getElementById('authForm') && document.getElementById('accountLabel').textContent==='Sem conexão'")), await situacao());
  ok("o que foi feito nesse meio-tempo está guardado no aparelho", await ev(A, "JSON.parse(localStorage.getItem('estudo-em-caixas-v1')).courses.some(c=>c.title==='Feito com a sessão vencida')"));
  await ev(A, "retry()");
  await pausa(300);
  ok("tentar de novo ainda sem internet não derruba para o login", (await ate(A, "syncState==='offline'", 45000)) && (await ev(A, "!locked() && !authKnown")), await situacao());
  // O que a própria biblioteca escreve no console por não conseguir renovar não é defeito do app.
  A.erros.splice(errosAntes, Infinity, ...A.erros.slice(errosAntes).filter((m) => !/Failed to fetch|AuthRetryableFetchError/.test(m)));
  fake.down = false;
  const t2 = Date.now();
  await ev(A, "dispatchEvent(new Event('online'))");
  // Depois de falhar, a biblioteca espera até 1 minuto para tentar renovar de novo.
  ok("internet volta: renova a sessão e envia sozinho o que ficou guardado", (await ate(A, "user && syncState==='ok' && !unsent()", 100000)) && nomes("ana@teste.com", "estudo").includes("Feito com a sessão vencida"), `${Math.round((Date.now() - t2) / 1000)} s; ` + (await situacao()));
  await ev(A, `(()=>{selected=${JSON.stringify(vencida)};page='detail';render();document.querySelector('[data-action=deleteCourse]').click();})()`);
  await sinc(A); await forcar(B);

  console.log("\n— Nuvem: muitas linhas (paginação) —");
  fake.cap = 7;
  for (let i = 1; i <= 12; i++) await novaParte(B, ja, "Lote " + String(i).padStart(2, "0"));
  await sinc(B); await forcar(B);
  const total = linhas("ana@teste.com").length;
  await forcar(A); await forcar(B); await forcar(A);
  ok("servidor devolvendo 7 por vez: celular recebe tudo e nada é apagado", linhas("ana@teste.com").length === total && (await titulos(A, "parts")).length === 16 && total === 18, `${total} linhas na nuvem, ${(await titulos(A, "parts")).length} partes no celular`);
  fake.cap = 1000;

  console.log("\n— Nuvem: duas abas no mesmo navegador —");
  const A2 = await aba("A2", A.contexto);
  await abrir(A2);
  await ate(A2, "user"); await sinc(A2);
  await novoEstudo(A, "Criado na primeira aba");
  ok("a segunda aba enxerga na hora o que a primeira gravou", await ate(A2, "state.courses.some(c=>c.title==='Criado na primeira aba')"));
  await sinc(A); await forcar(A2);
  ok("e a segunda aba não desfaz nada na nuvem", nomes("ana@teste.com", "estudo").includes("Criado na primeira aba"));
  ok("A2: sem erros no console", A2.erros.length === 0, A2.erros.join(" | "));
  ok("A2: CSP não barrou nada do app", (await ev(A2, "__csp.length")) === 0);
  await cdp("Target.closeTarget", { targetId: A2.targetId });

  console.log("\n— Nuvem: proteção contra apagar por engano —");
  const antes = linhas("ana@teste.com").length;
  await ev(A, "localStorage.setItem('estudo-em-caixas-v1','{isso não é json')");
  await abrir(A);
  await ate(A, "user"); await sinc(A);
  ok("dados do aparelho corrompidos: nada é apagado da nuvem e tudo volta", linhas("ana@teste.com").length === antes && (await ev(A, "state.courses.length")) === 3, `${linhas("ana@teste.com").length}/${antes} linhas, ${await ev(A, "state.courses.length")} estudos`);
  await ev(A, "localStorage.removeItem('estudo-em-caixas-v1')");
  await abrir(A);
  await ate(A, "user"); await sinc(A);
  ok("dados do aparelho sumiram: idem", linhas("ana@teste.com").length === antes && (await ev(A, "state.courses.length")) === 3);

  console.log("\n— Nuvem: sair e trocar de conta —");
  await ev(A, "document.getElementById('accountButton').click()");
  ok("janela da conta mostra o e-mail e a situação", (await ev(A, "accountDialog.open && document.getElementById('accountEmail').textContent")) === "ana@teste.com" && /Tudo sincronizado/.test(await ev(A, "document.getElementById('accountStatus').textContent")));
  await foto(A, "12-celular-conta");
  A.dialogos.length = 0;
  await ev(A, "document.querySelector('[data-action=signOut]').click()");
  ok("sair: volta para o login e limpa o aparelho", (await ate(A, "locked() && !user && !!document.getElementById('authForm')")) && (await ev(A, "state.courses.length===0 && !cloud.owner && JSON.parse(localStorage.getItem('estudo-em-caixas-v1')).courses.length===0")), A.dialogos.join(" | "));
  ok("sair não apaga nada da nuvem", linhas("ana@teste.com").length === antes);
  fake.autoconfirm = true;
  await entrar(A, "bia@teste.com", "segredo2", "up");
  ok("outra pessoa cria conta no mesmo aparelho e começa vazia", (await ate(A, "user && !locked()")) && (await sinc(A)) && (await ev(A, "state.courses.length")) === 0 && linhas("bia@teste.com").length === 0);
  await novoEstudo(A, "Estudo da Bia");
  await sinc(A);
  ok("cada conta só tem o que é dela", JSON.stringify(nomes("bia@teste.com", "estudo")) === '["Estudo da Bia"]' && !nomes("ana@teste.com", "estudo").includes("Estudo da Bia") && linhas("ana@teste.com").length === antes);
  // sessão cai sozinha (token inválido) e outra conta entra por cima
  await ev(A, "localStorage.removeItem('estudo-em-caixas-conta')");
  await abrir(A);
  ok("sessão caiu: pede login de novo e avisa que os estudos estão guardados", (await ate(A, "locked() && authKnown")) && /Sua sessão terminou/.test(await texto(A)) && (await ev(A, "state.courses.length")) === 1);
  A.dialogos.length = 0; A.aceitar = false;
  await entrar(A, "ana@teste.com", "segredo1");
  ok("entrar com outra conta por cima: pergunta antes", (await ate(A, "false", 1200)) || A.dialogos.some((m) => /guarda os estudos de bia@teste.com/.test(m)), A.dialogos.join(" | "));
  ok("respondendo não: nada muda e continua no login", (await ate(A, "locked() && !user")) && (await ev(A, "state.courses[0].title")) === "Estudo da Bia" && nomes("ana@teste.com", "estudo").length === 3);
  A.aceitar = true;
  await entrar(A, "ana@teste.com", "segredo1");
  ok("respondendo sim: entra a Ana, com os estudos dela e sem os da Bia", (await ate(A, "user?.email==='ana@teste.com' && !locked()")) && (await sinc(A)) && (await ev(A, "state.courses.length")) === 3 && !(await titulos(A)).includes("Estudo da Bia") && !nomes("ana@teste.com", "estudo").includes("Estudo da Bia") && JSON.stringify(nomes("bia@teste.com", "estudo")) === '["Estudo da Bia"]');

  console.log("\n— Nuvem: nova senha pelo link do e-mail —");
  await ev(A, "onAuth('PASSWORD_RECOVERY', { user })");
  ok("link de recuperação abre a tela de nova senha", await ev(A, "locked() && authMode==='newpass' && !document.querySelector('#authForm [name=email]') && !!document.querySelector('#authForm [name=password]')"));
  await ev(A, "(()=>{const f=document.getElementById('authForm');f.elements.password.value='novasenha9';f.requestSubmit();})()");
  ok("salva a nova senha e volta para o app", (await ate(A, "!locked() && authMode==='in'")) && fake.users.get("ana@teste.com").password === "novasenha9");

  console.log("\n— Instalado no aparelho: abre e funciona sem internet —");
  const P = await aparelho("P");
  await abrir(P);
  ok("o app se registra para ficar guardado no aparelho", await ate(P, "navigator.serviceWorker.controller", 15000));
  const guardados = () => ev(P, "caches.open('estudo-em-caixas-v1').then(c=>c.keys()).then(k=>k.map(r=>r.url))");
  ok("guarda a página, os ícones e a biblioteca da nuvem", await ate(P, "caches.open('estudo-em-caixas-v1').then(c=>c.keys()).then(k=>k.map(r=>r.url)).then(k=>k.includes(location.origin+'/') && k.filter(u=>u.endsWith('.png')).length===3 && k.includes(SUPABASE_JS))", 15000), JSON.stringify(await guardados()));
  const manifesto = await P.s("Page.getAppManifest"), instalar = (await P.s("Page.getInstallabilityErrors")).installabilityErrors.map((e) => e.errorId).filter((e) => e !== "in-incognito");
  ok("o navegador aceita instalar como aplicativo", /manifest\.webmanifest$/.test(manifesto.url) && manifesto.errors.length === 0 && instalar.length === 0, JSON.stringify([manifesto.errors, instalar]));
  await entrar(P, "caio@teste.com", "segredo3", "up");
  ok("entra na conta", (await ate(P, "user && !locked()")) && (await sinc(P)));
  await novoEstudo(P, "Antes de ficar sem internet");
  await sinc(P);
  fake.marca = "nova";
  await abrir(P);
  ok("com internet, a versão nova do app chega na hora", (await ev(P, "document.querySelector('meta[name=teste-versao]')?.content")) === "nova");
  await ate(P, "user"); await sinc(P);
  await internet(P, false);
  await abrir(P);
  ok("sem internet nenhuma: abre do aparelho, direto nos estudos, na versão mais nova", await ev(P, "!navigator.onLine && !locked() && !!document.querySelector('.hero') && state.courses.length===1 && document.querySelector('meta[name=teste-versao]')?.content==='nova'"), await texto(P).then((t) => t.slice(0, 80)));
  ok("a biblioteca da nuvem também vem do aparelho", await ate(P, "sb", 10000));
  await novoEstudo(P, "Criado sem internet");
  ok("o que é feito sem internet fica guardado e o app avisa 'Sem conexão'", (await ate(P, "syncState==='offline'", 45000)) && (await ev(P, "unsent() && !locked() && document.getElementById('accountLabel').textContent==='Sem conexão'")));
  await abrir(P);
  ok("fechar e abrir de novo, ainda sem internet: continua tudo lá", await ev(P, "!locked() && state.courses.length===2 && !!document.querySelector('.hero')"));
  ok("nada chegou à nuvem enquanto isso", nomes("caio@teste.com", "estudo").length === 1);
  const errosP = P.erros.filter((m) => !/Failed to fetch|AuthRetryableFetchError|ERR_INTERNET_DISCONNECTED/.test(m));
  const t1 = Date.now();
  await internet(P, true);
  ok("a internet volta: sincroniza sozinho, sem ninguém tocar em nada", (await ate(P, "syncState==='ok' && !syncing && !unsent()", 90000)) && nomes("caio@teste.com", "estudo").includes("Criado sem internet"), `${Math.round((Date.now() - t1) / 1000)} s; na nuvem: ${JSON.stringify(nomes("caio@teste.com", "estudo"))}`);
  ok("P: sem erros no console", errosP.length === 0, errosP.join(" | "));
  ok("P: CSP não barrou nada do app", (await ev(P, "__csp.length")) === 0, await ev(P, "__csp.join(' | ')"));
  fake.marca = "";

  console.log("\n— Arquivo aberto direto do computador, sem internet (nem a biblioteca da nuvem carrega) —");
  await B.s("Network.enable");
  await B.s("Network.setBypassServiceWorker", { bypass: true });
  await B.s("Network.setBlockedURLs", { urls: ["*cdn.jsdelivr.net*"] });
  fake.down = true;
  await abrir(B);
  ok("abre direto nos estudos e avisa 'Sem conexão'", (await ate(B, "syncState==='offline'")) && (await ev(B, "!sb && !locked() && state.courses.length>0 && !!document.querySelector('.hero') && document.getElementById('accountLabel').textContent==='Sem conexão'")));
  await novoEstudo(B, "Feito sem a biblioteca");
  await B.s("Network.setBlockedURLs", { urls: [] });
  fake.down = false;
  await ev(B, "dispatchEvent(new Event('online'))");
  ok("a internet volta: carrega a biblioteca e sincroniza sozinho", (await ate(B, "user && syncState==='ok' && !unsent()", 30000)) && nomes("ana@teste.com", "estudo").includes("Feito sem a biblioteca"));

  console.log("\n— Fechamento —");
  for (const d of [A, B]) {
    ok(`${d.nome}: sem erros no console`, d.erros.length === 0, d.erros.join(" | "));
    ok(`${d.nome}: CSP não barrou nada do app`, (await ev(d, "__csp.length")) === 0, await ev(d, "__csp.join(' | ')"));
  }
  ok("nenhuma chamada tentou ir ao projeto real do Supabase", fake.real === 0, String(fake.real));
  console.log("avisos do app durante os testes:", JSON.stringify([...new Set([...A.avisos, ...B.avisos, ...A2.avisos])]));
} catch (e) {
  falhas++;
  console.log("\nERRO NO ROTEIRO DE TESTE: " + (e.stack || e));
} finally {
  ws.close();
  chrome.kill();
  server.close();
}
console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTUDO CERTO");
process.exit(falhas ? 1 : 0);
