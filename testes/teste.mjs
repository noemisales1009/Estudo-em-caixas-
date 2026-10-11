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
const fake = { users: new Map(), rows: new Map(), down: false, fora: false, marca: "", autoconfirm: true, cap: 1000, n: 0, writes: 0, reads: 0, real: 0 };
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
const quem = (h) => { const t = (h.authorization || "").replace(/^Bearer /, ""); for (const u of fake.users.values()) if (u.tokens.has(t)) return u; return null; };
const chave = (r) => `${r.user_id}|${r.tipo}|${r.id}`;
function responder(method, url, h, body) {
  const p = url.pathname, q = url.searchParams, dados = body ? JSON.parse(body) : {};
  if (method === "OPTIONS") return { status: 204, headers: {} };
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
        if (!["estudo", "parte", "sessao"].includes(r.tipo) || typeof r.id !== "string" || !r.dados || typeof r.dados !== "object") return json(400, { code: "23514", message: "violates check constraint" });
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
      if (body === undefined && p.request.hasPostData) body = Buffer.from((await s("Fetch.getRequestPostData", { requestId: p.requestId })).postData, "utf8").toString();
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
  for (const pg of ["home", "agenda", "studies", "review", "backup"]) {
    await ev(L, `document.querySelector('nav [data-page=${pg}]').click()`);
    ok(`celular: tela ${pg} sem rolagem lateral`, await semTransbordo(L));
  }
  ok("celular: menu fica fixo embaixo, com ícones", await ev(L, "getComputedStyle(document.querySelector('.top nav')).position==='fixed' && getComputedStyle(document.querySelector('.top nav .icon')).display==='block'"));
  ok("celular: rótulos curtos no menu", (await ev(L, "[...document.querySelectorAll('nav button')].map(b=>b.innerText.trim()).join('|')")) === "Painel|Agenda|Estudos|Revisão|Ajuda");
  await ev(L, "document.querySelector('nav [data-page=home]').click()");
  await foto(L, "1-celular-claro-painel");
  await ev(L, "document.querySelector('nav [data-page=studies]').click()");
  await foto(L, "2-celular-claro-estudos");
  await ev(L, `document.querySelector('[data-action=open]').click()`);
  ok("ao abrir um estudo, 'Estudos' fica marcado no menu", await ev(L, "document.querySelector('nav [aria-current=page]').dataset.page==='studies'"));
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
  await ev(L, "document.querySelector('nav [data-page=home]').click()");
  await foto(L, "6-celular-escuro-painel");
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
  await foto(D, "7-computador-escuro-painel");
  await ev(D, "document.querySelector('nav [data-page=studies]').click()");
  await foto(D, "8-computador-escuro-estudos");
  await ev(D, "document.getElementById('themeButton').click()");
  await foto(D, "9-computador-claro-estudos");
  ok("computador: sem erros no console", D.erros.length === 0, D.erros.join(" | "));

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
  // edições simultâneas em coisas diferentes
  await ev(A, `(()=>{openCourse(${JSON.stringify(ja)});courseForm.elements.goal.value='Propósito mudado no celular';courseForm.requestSubmit();})()`);
  await ev(B, `(()=>{openCourse(${JSON.stringify(cb)});courseForm.elements.title.value='Renomeado no computador';courseForm.requestSubmit();})()`);
  await sinc(A); await sinc(B); await forcar(A); await forcar(B);
  const fim = (d) => ev(d, "JSON.stringify(state.courses.map(c=>[c.title,c.goal]))");
  ok("edições ao mesmo tempo em estudos diferentes: as duas ficam", (await fim(A)) === (await fim(B)) && /Propósito mudado no celular/.test(await fim(A)) && /Renomeado no computador/.test(await fim(A)), await fim(A));
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
