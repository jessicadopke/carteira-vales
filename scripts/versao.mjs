// Atualiza a versão nos 3 arquivos que a guardam e confere a entrada do CHANGELOG.
//   node scripts/versao.mjs 1.11.0   → grava a versão nova
//   node scripts/versao.mjs --check  → só confere se tudo bate (usado no CI)
import { readFileSync, writeFileSync } from "node:fs";

const ARQUIVOS = {
  "js/app.js": /(const APP_VERSION = ")([^"]+)(")/,
  "sw.js": /(const VERSION = "ciclo-)([^"]+)(")/,
  "version.json": /("version": ")([^"]+)(")/,
};

const arg = process.argv[2];
if (!arg) {
  console.error("Uso: node scripts/versao.mjs X.Y.Z | --check");
  process.exit(2);
}

function versaoEm(arquivo) {
  const m = readFileSync(arquivo, "utf8").match(ARQUIVOS[arquivo]);
  if (!m) throw new Error(`Versão não encontrada em ${arquivo}`);
  return m[2];
}

function temChangelog(v) {
  return readFileSync("CHANGELOG.md", "utf8").includes(`\n## ${v} —`);
}

if (arg === "--check") {
  const versoes = Object.keys(ARQUIVOS).map((a) => [a, versaoEm(a)]);
  const unicas = new Set(versoes.map(([, v]) => v));
  if (unicas.size !== 1) {
    console.error("Versões diferentes:", Object.fromEntries(versoes));
    process.exit(1);
  }
  const [v] = unicas;
  if (!temChangelog(v)) {
    console.error(`CHANGELOG.md sem a entrada "## ${v} — …"`);
    process.exit(1);
  }
  console.log(`ok ${v}`);
  process.exit(0);
}

if (!/^\d+\.\d+\.\d+$/.test(arg)) {
  console.error(`"${arg}" não é X.Y.Z`);
  process.exit(2);
}
if (!temChangelog(arg)) {
  console.error(`Escreva primeiro a entrada "## ${arg} — DD/MM/AAAA" no CHANGELOG.md`);
  process.exit(1);
}
for (const [arquivo, re] of Object.entries(ARQUIVOS)) {
  const texto = readFileSync(arquivo, "utf8");
  writeFileSync(arquivo, texto.replace(re, `$1${arg}$3`));
}
console.log(`versão ${arg} gravada em ${Object.keys(ARQUIVOS).join(", ")}`);
