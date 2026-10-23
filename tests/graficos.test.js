const test = require("node:test");
const assert = require("node:assert/strict");
const { Graficos: G } = require("./carregar");

// Dados fictícios, valores em centavos.
const cartoes = [
  { id: "a", name: "VR Exemplo", holder: "Ana" },
  { id: "b", name: "VA Exemplo", holder: "Bia" },
  { id: "c", name: "Sem titular", holder: "" },
];
const d = (cardId, date, desc, cat, amount, extra = {}) => ({ cardId, date, desc, cat, amount, kind: "debit", ...extra });
const brl = c => "R$ " + (c / 100).toFixed(2).replace(".", ",");
const esc = s => String(s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const soma = v => v.todos.reduce((s, x) => s + x.total, 0);

test("categoria vazia vira Sem categoria e a ordem é decrescente", () => {
  const r = G.somarGastos([d("a", "2026-03-02", "Mercado Exemplo", "", 1000), d("a", "2026-03-03", "Padaria", "Padaria", 3000), d("a", "2026-03-04", "Mercado Exemplo", "", 500)], cartoes);
  assert.deepEqual(r.categorias.itens.map(i => [i.rotulo, i.total]), [["Padaria", 3000], ["Sem categoria", 1500]]);
  assert.equal(r.total, 4500);
});

test("loja agrupa por storeKey, ou pelo descKey sem ele; rótulo é o mais recente", () => {
  const r = G.somarGastos([
    d("a", "2026-03-02", "MERCADO EXEMPLO 01", "Mercado", 1000, { storeKey: "loja:mercadoexemplo" }),
    d("a", "2026-03-09", "Mercado Exemplo", "Mercado", 500, { storeKey: "loja:mercadoexemplo" }),
    d("b", "2026-03-05", "Padaria Boa", "Padaria", 200),
    d("b", "2026-03-06", "padaria boa", "Padaria", 300),
  ], cartoes);
  assert.equal(r.lojas.itens.length, 2);
  assert.deepEqual(r.lojas.itens.map(i => [i.rotulo, i.total]), [["Mercado Exemplo", 1500], ["padaria boa", 500]]);
});

test("7 lojas viram 5 + Outras lojas; com 5 ou menos não aparece", () => {
  const sete = [7, 6, 5, 4, 3, 2, 1].map(n => d("a", "2026-03-02", "Loja " + n, "Outros", n * 100));
  const r = G.somarGastos(sete, cartoes);
  assert.equal(r.lojas.itens.length, 6);
  assert.deepEqual(r.lojas.itens[5], { chave: "outras", rotulo: "Outras lojas", total: 300, chaves: r.lojas.itens[5].chaves });
  assert.equal(r.lojas.itens[5].chaves.length, 2);
  assert.equal(r.lojas.todos.length, 7);
  const cinco = G.somarGastos(sete.slice(0, 5), cartoes);
  assert.equal(cinco.lojas.itens.length, 5);
  assert.ok(!cinco.lojas.itens.some(i => i.rotulo === "Outras lojas"));
});

test("titular: do cartão; vazio ou cartão desconhecido vira Sem titular", () => {
  const r = G.somarGastos([d("a", "2026-03-02", "X", "Outros", 100), d("c", "2026-03-02", "Y", "Outros", 200), d("zz", "2026-03-02", "Z", "Outros", 50)], cartoes);
  assert.deepEqual(r.titulares.itens.map(i => [i.rotulo, i.total]), [["Sem titular", 250], ["Ana", 100]]);
});

test("totais batem: crédito, estorno e ajuste ficam de fora", () => {
  const txs = [
    d("a", "2026-03-02", "Mercado Exemplo", "Mercado", 1234),
    d("b", "2026-03-03", "Padaria", "Padaria", 800),
    d("a", "2026-03-04", "Crédito", "", 50000, { kind: "credit" }),
    d("a", "2026-03-05", "Estorno", "Mercado", 300, { kind: "credit" }),
    d("a", "2026-03-06", "Ajuste", "", 999, { source: "ajuste" }),
  ];
  const r = G.somarGastos(txs, cartoes);
  const manual = 1234 + 800;
  assert.equal(r.total, manual);
  assert.equal(soma(r.categorias), manual);
  assert.equal(soma(r.lojas), manual);
  assert.equal(soma(r.titulares), manual);
  assert.equal(r.lojas.itens.reduce((s, i) => s + i.total, 0), manual);
});

const visao = (txs) => G.somarGastos(txs, cartoes).categorias;

test("comparação: maior variação para mais, para menos, item novo e item que sumiu", () => {
  const ant = visao([d("a", "2026-02-02", "x", "Mercado", 10000), d("a", "2026-02-03", "x", "Restaurante", 6000), d("a", "2026-02-04", "x", "Farmácia", 1000)]);
  let atual = visao([d("a", "2026-03-02", "x", "Mercado", 22000), d("a", "2026-03-03", "x", "Restaurante", 5500), d("a", "2026-03-04", "x", "Farmácia", 1000)]);
  let c = G.comparar(atual, ant);
  assert.equal(G.frase(c, brl), "R$ 120,00 a mais em Mercado");
  assert.equal(c.difs.Restaurante, -500);

  atual = visao([d("a", "2026-03-02", "x", "Mercado", 10000), d("a", "2026-03-03", "x", "Restaurante", 1500), d("a", "2026-03-04", "x", "Farmácia", 1000)]);
  assert.equal(G.frase(G.comparar(atual, ant), brl), "R$ 45,00 a menos em Restaurante");

  // item novo (sem anterior) e item que sumiu
  atual = visao([d("a", "2026-03-02", "x", "Mercado", 10000), d("a", "2026-03-03", "x", "Pet", 9000), d("a", "2026-03-04", "x", "Farmácia", 1000)]);
  c = G.comparar(atual, ant);
  assert.equal(c.difs.Pet, 9000);
  assert.equal(c.difs.Restaurante, -6000);
  assert.equal(G.frase(c, brl), "R$ 90,00 a mais em Pet");
  const sumiu = visao([d("a", "2026-03-02", "x", "Mercado", 10000)]);
  assert.equal(G.frase(G.comparar(sumiu, ant), brl), "R$ 60,00 a menos em Restaurante");
});

test("comparação: anterior vazio e tudo igual", () => {
  const atual = visao([d("a", "2026-03-02", "x", "Mercado", 10000)]);
  const c = G.comparar(atual, visao([]));
  assert.equal(c.semAnterior, true);
  assert.equal(G.frase(c, brl), "Sem período anterior para comparar.");
  assert.ok(!G.desenhar(atual, brl, esc, c).includes("a mais"));
  const igual = G.comparar(atual, visao([d("a", "2026-02-02", "x", "Mercado", 10000)]));
  assert.equal(G.frase(igual, brl), "Gastos iguais ao período anterior.");
});

test("Outras lojas soma a diferença das lojas que junta", () => {
  const mk = (mes, v) => [7, 6, 5, 4, 3, 2, 1].map(n => d("a", mes + "-02", "Loja " + n, "Outros", n * v));
  const atual = G.somarGastos(mk("2026-03", 100), cartoes).lojas;
  const ant = G.somarGastos(mk("2026-02", 50), cartoes).lojas;
  const c = G.comparar(atual, ant);
  assert.equal(c.difs.outras, 150);
});

test("seleção: cada cartão com o seu período e o deslocamento", () => {
  const cs = [{ id: "fixo", creditDay: 5 }, { id: "var" }, { id: "cal" }];
  // versão simples: fixo vai do dia 5 ao dia 5; var e cal usam o mês
  const periodoDe = (c, n) => {
    const m = 3 + n; // março = 3
    const iso = (mm, dd) => `2026-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    return c.id === "fixo" ? { startISO: iso(m, 5), endISO: iso(m + 1, 5) } : { startISO: iso(m, 1), endISO: iso(m + 1, 1) };
  };
  const txs = [
    d("fixo", "2026-03-04", "a", "x", 1), d("fixo", "2026-03-06", "b", "x", 2), d("fixo", "2026-02-10", "c", "x", 4),
    d("var", "2026-03-04", "d", "x", 8), d("var", "2026-02-28", "e", "x", 16),
    d("cal", "2026-03-31", "f", "x", 32), d("cal", "2026-01-31", "g", "x", 64),
  ];
  const s0 = G.selecionar(txs, cs, 0, periodoDe);
  assert.deepEqual(s0.atual.map(t => t.desc).sort(), ["b", "d", "f"]);
  assert.deepEqual(s0.anterior.map(t => t.desc).sort(), ["a", "c", "e"]);
  const s1 = G.selecionar(txs, cs, -1, periodoDe);
  assert.deepEqual(s1.atual.map(t => t.desc).sort(), ["a", "c", "e"]);
  assert.deepEqual(s1.anterior.map(t => t.desc).sort(), ["g"]);
});

test("desenho: svg, uma barra por item, largura proporcional e zero", () => {
  const r = G.somarGastos([d("a", "2026-03-02", "A", "Mercado", 10000), d("a", "2026-03-02", "B", "Padaria", 2500), d("a", "2026-03-02", "C", "Zero", 0)], cartoes);
  const html = G.desenhar(r.categorias, brl, esc);
  assert.ok(html.includes("<svg"));
  const larguras = [...html.matchAll(/class="gf-fill"[^>]*width="([\d.]+)"/g)].map(m => Number(m[1]));
  assert.deepEqual(larguras, [100, 25, 0]);
  assert.ok(html.includes('aria-label="Mercado: R$ 100,00"'));
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(html));
  assert.ok(html.includes("var(--accent)"));
});

test("desenho: nomes de usuário saem escapados", () => {
  const r = G.somarGastos([d("a", "2026-03-02", '<script>alert(1)</script> "x"', "<b>Cat</b>", 100)], cartoes);
  for (const v of [r.lojas, r.categorias]) {
    const html = G.desenhar(v, brl, esc);
    assert.ok(!html.includes("<script>") && !html.includes("<b>"));
    assert.ok(!/aria-label="[^"]*"[^>]*"[^>]*role/.test(html));
  }
  assert.ok(G.desenhar(r.lojas, brl, esc).includes("&lt;script&gt;"));
});

test("estado vazio: texto, sem svg", () => {
  const html = G.desenhar(G.somarGastos([], cartoes).categorias, brl, esc);
  assert.ok(html.includes("Sem gastos neste período."));
  assert.ok(!html.includes("<svg"));
});

test("todo valor exibido passa pela função de formatação", () => {
  const ant = visao([d("a", "2026-02-02", "x", "Mercado", 100)]);
  const atual = visao([d("a", "2026-03-02", "x", "Mercado", 700)]);
  const chamadas = [];
  const f = c => { chamadas.push(c); return "[" + c + "]"; };
  const html = G.desenhar(atual, f, esc, G.comparar(atual, ant));
  assert.deepEqual(chamadas, [700, 600]);
  assert.ok(html.includes("[700]") && html.includes("[600]"));
  assert.ok(!/R\$|\d{3}/.test(html.replace(/\[\d+\]/g, "").replace(/viewBox="[^"]*"|width="[^"]*"|height="[^"]*"/g, "")));
});
