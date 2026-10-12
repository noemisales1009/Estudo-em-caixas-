// Como rodar:  npm run dev   (ou: node servidor.mjs)
// Abre o app neste computador, em http://localhost:5173, para testar antes de publicar.
// Não instala nada e só atende este computador. Depois de mexer no index.html, recarregue a página.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const RAIZ = import.meta.dirname;
const PORTA = Number(process.env.PORT) || 5173;
// Só o que faz parte do app publicado é servido; o resto da pasta responde "não encontrado".
const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
};

const server = http.createServer((req, res) => {
  let caminho = "";
  try {
    caminho = decodeURIComponent(new URL(req.url, "http://x").pathname);
  } catch (e) {}
  const arq = path.join(RAIZ, caminho === "/" ? "index.html" : caminho),
    tipo = TIPOS[path.extname(arq)];
  if (!tipo || !arq.startsWith(RAIZ + path.sep) || caminho.includes("/.")) {
    res.writeHead(404);
    return res.end();
  }
  fs.readFile(arq, (erro, dados) => {
    if (erro) {
      res.writeHead(404);
      return res.end();
    }
    // Sem guardar cópia no navegador: recarregar a página sempre mostra a versão mais nova.
    res.writeHead(200, { "Content-Type": tipo, "Cache-Control": "no-store" });
    res.end(dados);
  });
});
server.on("error", (e) => {
  console.error(
    e.code === "EADDRINUSE"
      ? `A porta ${PORTA} já está em uso. Feche o outro terminal que está rodando o app e tente de novo.`
      : "Não foi possível iniciar: " + e.message,
  );
  process.exit(1);
});
server.listen(PORTA, "localhost", () => {
  console.log(`\nEstudo em Caixas rodando em  http://localhost:${PORTA}/`);
  console.log("Para parar, aperte Ctrl+C.\n");
});
