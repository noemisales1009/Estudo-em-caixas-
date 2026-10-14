// Gera o APK: compila o projeto Android (Gradle), alinha e assina com a chave desta pasta.
// Precisa do Java (JDK 21) e do Android SDK. Se JAVA_HOME e ANDROID_HOME não estiverem
// definidos, procura os dois em %LOCALAPPDATA%\Android (onde instala-android os deixa).
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const aqui = import.meta.dirname;
const local = path.join(process.env.LOCALAPPDATA || "", "Android");
const JAVA_HOME = process.env.JAVA_HOME || path.join(local, "jdk-21");
const ANDROID_HOME = process.env.ANDROID_HOME || path.join(local, "Sdk");
for (const [nome, pasta] of [
  ["Java", JAVA_HOME],
  ["Android SDK", ANDROID_HOME],
])
  if (!fs.existsSync(pasta)) {
    console.error(`${nome} não encontrado em ${pasta}. Veja apk/LEIA-ME.txt.`);
    process.exit(1);
  }
const env = { ...process.env, JAVA_HOME, ANDROID_HOME, ANDROID_SDK_ROOT: ANDROID_HOME };
const versao = fs.readdirSync(path.join(ANDROID_HOME, "build-tools")).sort().at(-1);
const ferramenta = (f) => path.join(ANDROID_HOME, "build-tools", versao, f);
const aspas = (a) => '"' + String(a).replace(/"/g, '\\"') + '"';
const rodar = (cmd, args, cwd = aqui) =>
  execSync([aspas(cmd), ...args.map(aspas)].join(" "), { cwd, env, stdio: "inherit" });

// A chave que assina o APK. É criada na primeira vez; guarde a chave e a senha: só ela consegue
// atualizar o app já instalado no celular. Com outra chave, é preciso desinstalar antes.
const chave = path.join(aqui, "chave-estudo-em-caixas.jks");
const senhaArquivo = path.join(aqui, "chave-senha.txt");
if (!fs.existsSync(chave)) {
  fs.writeFileSync(senhaArquivo, crypto.randomBytes(12).toString("base64url"));
  const senha = fs.readFileSync(senhaArquivo, "utf8").trim();
  rodar(path.join(JAVA_HOME, "bin", "keytool.exe"), [
    "-genkeypair", "-keystore", chave, "-alias", "estudoemcaixas",
    "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
    "-storepass", senha, "-keypass", senha,
    "-dname", "CN=Estudo em Caixas, O=Noemi Sales, C=BR",
  ]);
  console.log("Chave criada. Guarde apk/chave-estudo-em-caixas.jks e apk/chave-senha.txt.");
}
const senha = fs.readFileSync(senhaArquivo, "utf8").trim();

const android = path.join(aqui, "android");
fs.writeFileSync(
  path.join(android, "local.properties"),
  "sdk.dir=" + ANDROID_HOME.replace(/\\/g, "\\\\").replace(/:/g, "\\:") + "\n",
);
console.log("Compilando (a primeira vez baixa o Gradle e demora alguns minutos)...");
rodar(path.join(android, "gradlew.bat"), ["assembleRelease", "--no-daemon", "--quiet"], android);

const bruto = path.join(android, "app", "build", "outputs", "apk", "release", "app-release-unsigned.apk");
const alinhado = path.join(aqui, "alinhado.apk");
const pronto = path.join(aqui, "Estudo em Caixas.apk");
rodar(ferramenta("zipalign.exe"), ["-f", "-p", "4", bruto, alinhado]);
rodar(ferramenta("apksigner.bat"), [
  "sign", "--ks", chave, "--ks-key-alias", "estudoemcaixas",
  "--ks-pass", "pass:" + senha, "--key-pass", "pass:" + senha,
  "--out", pronto, alinhado,
]);
fs.rmSync(alinhado, { force: true });
rodar(ferramenta("apksigner.bat"), ["verify", "--print-certs", pronto]);
console.log(`\nAPK pronto: ${pronto} (${(fs.statSync(pronto).size / 1048576).toFixed(1)} MB)`);
