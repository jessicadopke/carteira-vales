const test = require("node:test");
const assert = require("node:assert/strict");
const { Csv } = require("./carregar");

const cards = [{ id: "c1", name: "VR Teste", holder: "Maria", issuer: "Emissor X" }];

test("cabeçalho, BOM, separador ; e vírgula decimal", () => {
  const out = Csv.montar([
    { cardId: "c1", date: "2026-03-05", desc: "Mercado", cat: "Mercado", kind: "debit", amount: 32.9, reportedBalance: 100.5 },
    { cardId: "c1", date: "2026-03-01", desc: "Crédito de março", kind: "credit", amount: 500 },
  ], cards);
  assert.equal(out.charCodeAt(0), 0xFEFF);
  const l = out.slice(1).split("\r\n");
  assert.equal(l[0], "Data;Loja;Categoria;Cartão;Titular;Emissor;Tipo;Valor;Saldo no cupom;Forma de pagamento");
  assert.equal(l[1], "05/03/2026;Mercado;Mercado;VR Teste;Maria;Emissor X;Gasto;-32,90;100,50;");
  assert.equal(l[2], "01/03/2026;Crédito de março;;VR Teste;Maria;Emissor X;Crédito;500,00;;");
});

test("protege aspas, ponto e vírgula, quebra de linha e fórmulas", () => {
  const out = Csv.montar([
    { cardId: "c1", date: "2026-03-05", desc: 'Loja "A"; B\nC', kind: "debit", amount: 1 },
    { cardId: "c1", date: "2026-03-05", desc: "=1+1", cat: "@x", kind: "debit", amount: 1 },
    { cardId: "c1", date: "2026-03-05", desc: "-2", cat: "+3", kind: "debit", amount: 1 },
  ], cards);
  assert.ok(out.includes('"Loja ""A""; B\nC"'));
  assert.ok(out.includes(";'=1+1;'@x;"));
  assert.ok(out.includes(";'-2;'+3;"));
});

test("compra dividida mostra a forma de pagamento", () => {
  const out = Csv.montar([
    { cardId: "c1", date: "2026-03-05", desc: "Loja", kind: "debit", amount: 30, groupId: "g", purchaseTotal: 50, otherPay: [{ kind: "pix", amount: 20 }] },
  ], cards);
  assert.ok(out.includes('"Compra dividida, total 50,00; Pix 20,00"'));
});

test("sem lançamentos gera só o cabeçalho", () => {
  assert.equal(Csv.montar([], cards).slice(1).split("\r\n").length, 2);
});
