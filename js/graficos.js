// Gráficos de gastos por período: agrupa por categoria, loja e titular, compara com o período anterior
// e desenha barras horizontais em SVG. Lógica pura (sem tela nem banco), no molde de csv.js.
(function () {
  const MAX_LOJAS = 5;

  // Só gasto de verdade: a mesma conta do "Gastos" do período e do Extrato (sem crédito, estorno ou ajuste).
  const ehGasto = t => t && t.kind === "debit" && t.source !== "ajuste" && typeof t.amount === "number";

  function chaveLoja(t) {
    if (t.storeKey) return t.storeKey;
    const M = window.Match;
    return M && M.descKey ? M.descKey(t.desc || "") : "loja:" + String(t.desc || "").toLowerCase();
  }

  function agrupar(lista, chaveDe, rotuloDe) {
    const m = new Map();
    for (const t of lista) {
      const k = chaveDe(t);
      let g = m.get(k);
      if (!g) { g = { chave: k, rotulo: rotuloDe(t), total: 0, _data: "" }; m.set(k, g); }
      g.total += t.amount;
      // rótulo = descrição do lançamento mais recente do grupo
      if ((t.date || "") >= g._data) { g._data = t.date || ""; g.rotulo = rotuloDe(t); }
    }
    return [...m.values()]
      .sort((a, b) => b.total - a.total || String(a.rotulo).localeCompare(String(b.rotulo), "pt-BR"))
      .map(({ chave, rotulo, total }) => ({ chave, rotulo, total }));
  }

  // Devolve { total, categorias, lojas, titulares }; cada visão é { itens, todos, total }.
  // `todos` é a lista completa (usada na comparação); `itens` é o que se desenha (lojas: 5 + "Outras lojas").
  function somarGastos(txs, cartoes) {
    const porId = {};
    for (const c of cartoes || []) porId[c.id] = c;
    const gastos = (txs || []).filter(ehGasto);
    const total = gastos.reduce((s, t) => s + t.amount, 0);

    const cat = agrupar(gastos, t => t.cat || "Sem categoria", t => t.cat || "Sem categoria");
    const lojas = agrupar(gastos, chaveLoja, t => t.desc || "Sem nome");
    const tit = agrupar(gastos, t => ((porId[t.cardId] || {}).holder || "").trim() || "Sem titular", t => ((porId[t.cardId] || {}).holder || "").trim() || "Sem titular");

    let lojasItens = lojas;
    if (lojas.length > MAX_LOJAS) {
      const resto = lojas.slice(MAX_LOJAS);
      lojasItens = lojas.slice(0, MAX_LOJAS).concat({ chave: "outras", rotulo: "Outras lojas", total: resto.reduce((s, x) => s + x.total, 0), chaves: resto.map(x => x.chave) });
    }
    const visao = (itens, todos) => ({ itens, todos: todos || itens, total });
    return { total, categorias: visao(cat), lojas: visao(lojasItens, lojas), titulares: visao(tit) };
  }

  // Separa os lançamentos do período mostrado e do anterior, cada cartão com o seu período.
  // periodoDe(cartao, deslocamento) devolve { startISO, endISO } (0 = atual, -1 = anterior...).
  function selecionar(txs, cartoes, deslocamento, periodoDe) {
    const atual = [], anterior = [];
    for (const c of cartoes || []) {
      const pa = periodoDe(c, deslocamento), pp = periodoDe(c, deslocamento - 1);
      for (const t of txs || []) {
        if (t.cardId !== c.id) continue;
        const d = t.date || "";
        if (d >= pa.startISO && d < pa.endISO) atual.push(t);
        else if (d >= pp.startISO && d < pp.endISO) anterior.push(t);
      }
    }
    return { atual, anterior };
  }

  // Compara uma visão do período atual com a do anterior.
  // Devolve { semAnterior, igual, maior: { rotulo, dif } | null, difs: { chave: dif } } (dif = atual - anterior).
  function comparar(atual, anterior) {
    const ant = anterior || { total: 0, todos: [] };
    const semAnterior = !ant.total;
    const lista = v => (v && (v.todos || v.itens)) || [];
    const a = new Map(lista(atual).map(x => [x.chave, x]));
    const p = new Map(lista(ant).map(x => [x.chave, x]));
    const difs = {};
    let maior = null;
    for (const k of new Set([...a.keys(), ...p.keys()])) {
      const dif = (a.get(k) ? a.get(k).total : 0) - (p.get(k) ? p.get(k).total : 0);
      difs[k] = dif;
      if (dif !== 0 && (!maior || Math.abs(dif) > Math.abs(maior.dif))) maior = { rotulo: (a.get(k) || p.get(k)).rotulo, dif };
    }
    // diferença de cada item desenhado (a linha "Outras lojas" soma as lojas que ela junta)
    for (const it of (atual && atual.itens) || []) {
      if (it.chaves) difs[it.chave] = it.chaves.reduce((s, k) => s + (difs[k] || 0), 0);
    }
    return { semAnterior, igual: !semAnterior && !maior, maior, difs };
  }

  function frase(comp, brl) {
    if (!comp || comp.semAnterior) return "Sem período anterior para comparar.";
    if (!comp.maior) return "Gastos iguais ao período anterior.";
    const { rotulo, dif } = comp.maior;
    return `${brl(Math.abs(dif))} ${dif > 0 ? "a mais" : "a menos"} em ${rotulo}`;
  }

  // Barras horizontais: rótulo e valor em cima, barra em SVG embaixo, diferença para o período anterior.
  // Só variáveis de cor do tema. `esc` protege todo texto vindo do usuário.
  function desenhar(visao, brl, esc, comp) {
    const itens = (visao && visao.itens) || [];
    if (!itens.length || !visao.total) return `<p class="hint gf-vazio">Sem gastos neste período.</p>`;
    const max = Math.max(...itens.map(i => i.total));
    const linhas = itens.map(i => {
      const pct = max > 0 ? Math.round(Math.max(0, i.total) / max * 1000) / 10 : 0;
      const valor = brl(i.total);
      let dif = "";
      if (comp && !comp.semAnterior && comp.difs && typeof comp.difs[i.chave] === "number") {
        const d = comp.difs[i.chave];
        dif = d === 0
          ? `<span class="gf-dif">= igual ao anterior</span>`
          : `<span class="gf-dif ${d > 0 ? "mais" : "menos"}"><span class="gv">${d > 0 ? "▲" : "▼"} ${esc(brl(Math.abs(d)))}</span> ${d > 0 ? "a mais" : "a menos"}</span>`;
      }
      return `<div class="gf-row">
        <div class="gf-top"><span class="gf-lab">${esc(i.rotulo)}</span><span class="gf-val num gv">${esc(valor)}</span></div>
        <svg class="gf-bar" viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label="${esc(i.rotulo + ": " + valor)}"><rect x="0" y="0" width="100" height="8" style="fill:var(--sunk)"/><rect class="gf-fill" x="0" y="0" width="${pct}" height="8" style="fill:var(--accent)"/></svg>
        ${dif}</div>`;
    }).join("");
    return `<div class="gf-rows">${linhas}</div>`;
  }

  window.Graficos = { somarGastos, selecionar, comparar, frase, desenhar, MAX_LOJAS };
})();
