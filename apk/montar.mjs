// Monta a pasta www com o que o aplicativo embrulha: os mesmos arquivos que vão para o site
// (index.html, sw.js, manifest.webmanifest e a pasta icones). Nada é alterado; o app dentro do
// APK é o mesmo do navegador, com todas as funções.
import fs from "node:fs";
import path from "node:path";

const raiz = path.join(import.meta.dirname, "..");
const www = path.join(import.meta.dirname, "www");
fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(path.join(www, "icones"), { recursive: true });
for (const a of ["index.html", "sw.js", "manifest.webmanifest"])
  fs.copyFileSync(path.join(raiz, a), path.join(www, a));
for (const a of fs.readdirSync(path.join(raiz, "icones")))
  fs.copyFileSync(path.join(raiz, "icones", a), path.join(www, "icones", a));
console.log("www montada:", fs.readdirSync(www).join(", "));
