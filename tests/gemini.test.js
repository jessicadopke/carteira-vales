// Leitura com o Gemini (gemini.js): respostas salvas do Gemini, convertidas sem chamar o Google.
const test = require("node:test");
const assert = require("node:assert/strict");
const { GeminiReader, Issuers, respostaGemini } = require("./carregar");

test("final do cartão vem do número impresso, não dos primeiros dígitos (defeito da 1.9.0)", () => {
  const p = GeminiReader.toParsed(respostaGemini("volus-final-errado.json"));
  assert.equal(p.last4, "4821");
  assert.equal(p.issuer, "Volus");
  assert.equal(p.type, "alimentacao");
  assert.equal(p.holder, "Fulana de Tal");
  assert.equal(p.balance, 120840);
  assert.equal(p.paid, 31707);
});

test("emissor pelo texto do comprovante quando o Gemini não preenche; 'CONSUMIDOR' não é titular", () => {
  const p = GeminiReader.toParsed(respostaGemini("vr-sem-emissor.json"));
  assert.equal(p.issuer, "VR");
  assert.equal(p.holder, null);
  assert.equal(p.type, null);
  assert.equal(p.last4, "7310");
});

test("dois vales: pistas separadas, saldo anterior convertido e emissor fora da lista guardado", () => {
  const p = GeminiReader.toParsed(respostaGemini("dois-vales-saldo-anterior.json"));
  assert.equal(p.paid, 13000);
  assert.deepEqual(p.payments.map(x => x.kind), ["vale", "vale", "pix"]);
  assert.equal(p.vales[0].issuer, "Alelo");
  assert.equal(p.vales[1].issuer, null);
  assert.equal(p.vales[1].issuerRaw, "Mega Benefícios");
  assert.equal(p.vales[1].saldo, 30000, "350,00 antes da compra de 50,00");
  assert.deepEqual(p.balances, [12000, 30000]);
});

test("emissores: nome solto (Gemini) e texto impresso (cupom)", () => {
  assert.equal(Issuers.fromName("iFood"), "iFood Benefícios");
  assert.equal(Issuers.fromName("Sodexo"), "Pluxee (Sodexo)");
  assert.equal(Issuers.fromName("Up Brasil"), "Up Brasil");
  assert.equal(Issuers.fromPrint("POLICARD REFEICAO"), "Up Brasil");
  assert.equal(Issuers.fromPrint("CIELO DEBITO"), null);
  assert.ok(Issuers.NAMES.includes("Outro"));
});

test("status de cada tentativa em poucas palavras", () => {
  assert.equal(GeminiReader.shortStatus(429), "sem cota agora");
  assert.equal(GeminiReader.shortStatus(404), "não encontrado");
  assert.equal(GeminiReader.shortStatus(503), "sobrecarregado");
});
