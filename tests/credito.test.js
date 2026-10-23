// Aviso do dia do crédito (credito.js): quem recebe hoje/amanhã/em poucos dias, agenda e texto. Cartões fictícios.
const test = require("node:test");
const assert = require("node:assert/strict");
const { Credito, Drive } = require("./carregar");

const D = (y, m, d) => new Date(y, m - 1, d);
const fixo = (id, creditDay, extra) => ({ id, name: "Cartão " + id, dayMode: "fixed", creditDay, monthlyCredit: 50000, ...extra });
const datas = lista => lista.map(p => [p.cardId, p.data, p.faltam]);

test("dia fixo: crédito hoje, amanhã e em 3 dias entram; em 4 dias não", () => {
  const cards = [fixo("A", 20), fixo("B", 21), fixo("C", 23), fixo("D", 24)];
  const r = Credito.proximos(cards, D(2026, 10, 20));
  assert.deepEqual(datas(r), [["A", "2026-10-20", 0], ["B", "2026-10-21", 1], ["C", "2026-10-23", 3]]);
  assert.ok(r.every(p => p.estimado === false));
});

test("janela personalizada: 7 dias", () => {
  assert.equal(Credito.proximos([fixo("D", 27)], D(2026, 10, 20), 7).length, 1);
});

test("cartão sem dia de crédito fica de fora", () => {
  const cards = [{ id: "N", name: "Cartão N", dayMode: "none" }, { id: "S", name: "Cartão S" }, { id: "Z", name: "Cartão Z", dayMode: "fixed" }];
  assert.deepEqual(Credito.proximos(cards, D(2026, 10, 20)), []);
});

test("creditDay 31 em fevereiro", () => {
  const r = Credito.proximos([fixo("A", 31)], D(2027, 2, 26));
  assert.deepEqual(datas(r), [["A", "2027-02-28", 2]]);
  const bissexto = Credito.proximos([fixo("A", 31)], D(2028, 2, 28));
  assert.deepEqual(datas(bissexto), [["A", "2028-02-29", 1]]);
});

test("virada de dezembro para janeiro", () => {
  const r = Credito.proximos([fixo("A", 2)], D(2026, 12, 30));
  assert.deepEqual(datas(r), [["A", "2027-01-02", 3]]);
});

test("variável: previsão em 2 dias aparece como estimada", () => {
  const c = { id: "V", name: "Cartão V", dayMode: "variable", lastCreditDate: "2026-09-23" };
  const r = Credito.proximos([c], D(2026, 10, 21));
  assert.deepEqual(datas(r), [["V", "2026-10-23", 2]]);
  assert.equal(r[0].estimado, true);
});

test("variável vencido não duplica", () => {
  const c = { id: "V", name: "Cartão V", dayMode: "variable", lastCreditDate: "2026-09-23" };
  assert.deepEqual(Credito.proximos([c], D(2026, 10, 23)), []);
  assert.deepEqual(Credito.proximos([c], D(2026, 10, 25)), []);
});

test("crédito já registrado some do aviso", () => {
  const dia = D(2026, 10, 20);
  assert.deepEqual(Credito.proximos([fixo("A", 20, { lastCreditMonth: "2026-10" })], dia), []);
  const tx = { cardId: "B", kind: "credit", benefit: true, amount: 50000, date: "2026-10-20" };
  assert.deepEqual(Credito.proximos([fixo("B", 20)], dia, 3, [tx]), []);
  const outro = { cardId: "X", kind: "credit", benefit: true, amount: 50000, date: "2026-10-20" };
  assert.equal(Credito.proximos([fixo("B", 20)], dia, 3, [outro]).length, 1);
});

test("rotulo: hoje, amanhã, em 3 dias", () => {
  assert.equal(Credito.rotulo(0), "hoje");
  assert.equal(Credito.rotulo(1), "amanhã");
  assert.equal(Credito.rotulo(3), "em 3 dias");
});

test("agenda tem só data e contagem", () => {
  const cards = [fixo("A", 20), fixo("B", 20), fixo("C", 25)];
  const ag = Credito.montarAgenda(cards, D(2026, 10, 19));
  assert.deepEqual(ag, [{ data: "2026-10-20", n: 2 }, { data: "2026-10-25", n: 1 }]);
  for (const a of ag) assert.deepEqual(Object.keys(a), ["data", "n"]);
  assert.ok(!/Cartão|50000/.test(JSON.stringify(ag)));
});

test("agenda cobre 14 dias", () => {
  const ag = Credito.montarAgenda([fixo("A", 2)], D(2026, 10, 20));
  assert.deepEqual(ag, [{ data: "2026-11-02", n: 1 }]);
  assert.deepEqual(Credito.montarAgenda([fixo("A", 5)], D(2026, 10, 20)), []);
});

test("avisoDeHoje: texto genérico quando hoje tem crédito, senão null", () => {
  const ag = [{ data: "2026-10-23", n: 1 }];
  const t = Credito.avisoDeHoje(ag, D(2026, 10, 23));
  assert.equal(t, "Hoje é dia de crédito. Abra o Ciclo para confirmar o valor.");
  assert.equal(Credito.avisoDeHoje(ag, D(2026, 10, 24)), null);
  assert.equal(Credito.avisoDeHoje([{ data: "2026-10-23", n: 0 }], D(2026, 10, 23)), null);
});

test("avisoDeHoje: agenda vazia, ausente ou corrompida devolve null", () => {
  const h = D(2026, 10, 23);
  for (const ag of [[], undefined, null, "lixo", 42, {}, [null], [{}], [{ data: 5 }]]) assert.equal(Credito.avisoDeHoje(ag, h), null);
});

test("o backup não leva avisoCredito", () => {
  const meta = { vault: { salt: "x" }, avisoCredito: { ligado: true, datas: [{ data: "2026-10-23", n: 1 }] } };
  const b = Drive.montarBackup({ cards: [], txs: [], meta, receipts: [] }, false);
  assert.deepEqual(Object.keys(b.meta), ["vault"]);
  assert.ok(!JSON.stringify(b).includes("avisoCredito"));
});
