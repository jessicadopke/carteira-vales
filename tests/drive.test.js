// Backup no Drive (drive.js): regras puras e chamada ao script com fetch falso. Dados fictícios.
const test = require("node:test");
const assert = require("node:assert/strict");
const { Drive } = require("./carregar");

const DIA = 86400000;
const agora = Date.UTC(2026, 9, 23, 12);

test("precisaSalvar: nunca salvou, 6 e 8 dias, 29 e 30 lançamentos, desligado", () => {
  assert.equal(Drive.precisaSalvar({ ligado: true, ultimo: null, novos: 0, agora }), true);
  assert.equal(Drive.precisaSalvar({ ligado: true, ultimo: agora - 6 * DIA, novos: 0, agora }), false);
  assert.equal(Drive.precisaSalvar({ ligado: true, ultimo: agora - 8 * DIA, novos: 0, agora }), true);
  assert.equal(Drive.precisaSalvar({ ligado: true, ultimo: agora - DIA, novos: 29, agora }), false);
  assert.equal(Drive.precisaSalvar({ ligado: true, ultimo: agora - DIA, novos: 30, agora }), true);
  assert.equal(Drive.precisaSalvar({ ligado: false, ultimo: null, novos: 99, agora }), false);
});

test("nomeArquivo: ciclo-AAAA-MM-DD-HHMM.json", () => {
  assert.equal(Drive.nomeArquivo(new Date(2026, 0, 5, 9, 7)), "ciclo-2026-01-05-0907.json");
});

test("gerarSegredo: 32+ caracteres e diferente a cada vez", () => {
  const a = Drive.gerarSegredo(), b = Drive.gerarSegredo();
  assert.ok(a.length >= 32);
  assert.notEqual(a, b);
});

const estado = {
  cards: [{ id: "c1", name: "Cartão teste" }],
  txs: [{ id: "t1", cardId: "c1", amount: 1000 }],
  meta: { vault: { salt: "x" }, lastBackup: 5, gemini: { key: "AIzaFICTICIA" }, drive: { url: "https://exemplo.invalid/exec", secret: "SEGREDO-FICTICIO", ligado: true } },
  receipts: [{ id: "r1", createdAt: 1, data: "data:image/jpeg;base64,AAAA" }],
  exportedAt: "2026-10-23T12:00:00.000Z",
};

test("montarBackup: mesmo formato do arquivo local, sem fotos por padrão", () => {
  const b = Drive.montarBackup(estado, false);
  assert.deepEqual(Object.keys(b), ["app", "version", "exportedAt", "cards", "txs", "meta", "receipts"]);
  assert.equal(b.app, "ciclo");
  assert.equal(b.version, 1);
  assert.equal(b.exportedAt, "2026-10-23T12:00:00.000Z");
  assert.deepEqual(b.cards, estado.cards);
  assert.deepEqual(b.txs, estado.txs);
  assert.deepEqual(b.meta, { vault: { salt: "x" } });
  assert.deepEqual(b.receipts, []);
  assert.equal(Drive.montarBackup(estado, true).receipts.length, 1);
});

test("montarBackup: não leva drive, link, código nem chave do Gemini", () => {
  const txt = JSON.stringify(Drive.montarBackup(estado, true));
  for (const proibido of ["drive", "url", "secret", "SEGREDO-FICTICIO", "exemplo.invalid", "AIzaFICTICIA", "gemini"]) assert.ok(!txt.includes(proibido), proibido);
});

test("cabe: limite de 20 MB", () => {
  assert.equal(Drive.cabe("a".repeat(20 * 1048576)), true);
  assert.equal(Drive.cabe("a".repeat(20 * 1048576 + 1)), false);
  assert.equal(Drive.cabe("é".repeat(11 * 1048576)), false); // 2 bytes cada
});

const cfg = { url: "https://exemplo.invalid/exec", secret: "SEGREDO-FICTICIO" };
async function comFetch(fake, fn) {
  const antes = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await fn(); } finally { globalThis.fetch = antes; }
}

test("chamar: monta o corpo com o segredo, sem cabeçalho e sem segredo na URL", async () => {
  let visto;
  const r = await comFetch(async (url, op) => { visto = { url, op }; return { json: async () => ({ ok: true, itens: [] }) }; },
    () => Drive.chamar(cfg, { acao: "listar" }));
  assert.deepEqual(r, { ok: true, itens: [] });
  assert.equal(visto.url, cfg.url);
  assert.ok(!visto.url.includes("SEGREDO"));
  assert.equal(visto.op.method, "POST");
  assert.equal(visto.op.redirect, "follow");
  assert.equal(visto.op.headers, undefined);
  assert.deepEqual(JSON.parse(visto.op.body), { acao: "listar", segredo: "SEGREDO-FICTICIO" });
});

test("chamar: ok:false vira erro em português com o código", async () => {
  await assert.rejects(
    comFetch(async () => ({ json: async () => ({ ok: false, erro: "segredo" }) }), () => Drive.chamar(cfg, { acao: "listar" })),
    e => e.codigo === "segredo" && /código secreto/.test(e.message));
});

test("chamar: rede fora e resposta que não é JSON", async () => {
  await assert.rejects(comFetch(async () => { throw new TypeError("Failed to fetch"); }, () => Drive.chamar(cfg, {})), /Sem conexão/);
  await assert.rejects(comFetch(async () => ({ json: async () => { throw new SyntaxError("x"); } }), () => Drive.chamar(cfg, {})), /não respondeu como o script/);
});

test("chamar: sem link ou sem código não chama a rede", async () => {
  let chamou = false;
  await assert.rejects(comFetch(async () => { chamou = true; }, () => Drive.chamar({ url: "", secret: "" }, {})), /Falta/);
  assert.equal(chamou, false);
});

test("lembrete: sem Drive, Drive em dia, Drive falhando, sem backup nenhum", () => {
  assert.equal(Drive.lembrete({ drive: null, agora }).tipo, "padrao");
  assert.equal(Drive.lembrete({ drive: { ligado: true, ultimo: agora - DIA }, agora }).tipo, "nenhum");
  const f = Drive.lembrete({ drive: { ligado: true, ultimo: agora - 9 * DIA, ultimoErro: agora - 1000 }, agora });
  assert.equal(f.tipo, "falhando");
  assert.equal(f.texto, "O backup no Drive não está funcionando.");
  // falhou há pouco tempo: ainda não incomoda
  assert.equal(Drive.lembrete({ drive: { ligado: true, ultimo: agora - 2 * DIA, ultimoErro: agora - 1000 }, agora }).tipo, "nenhum");
  // ligado mas nunca salvou, sem erro: espera o salvamento automático
  assert.equal(Drive.lembrete({ drive: { ligado: true, ligadoEm: agora - DIA }, agora }).tipo, "nenhum");
  // nunca salvou e falha há mais de 7 dias
  assert.equal(Drive.lembrete({ drive: { ligado: true, ligadoEm: agora - 9 * DIA, ultimoErro: agora - 1000 }, agora }).tipo, "falhando");
  // desligado: vale o lembrete de arquivo, mesmo sem backup nenhum
  assert.equal(Drive.lembrete({ drive: { ligado: false }, agora }).tipo, "padrao");
});
