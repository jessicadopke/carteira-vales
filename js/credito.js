// Aviso do dia do crédito: quais cartões recebem crédito hoje ou nos próximos dias, e o texto do aviso.
// Funções puras (recebem cartões, lançamentos e a data de hoje; não mexem na tela), para testar com `node --test`
// e para o service worker usar. Repete as regras de dia do crédito do app.js (mkDate, estimateNext).
(() => {
  "use strict";

  const pad = n => String(n).padStart(2, "0");
  const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const monthKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const fromISO = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  // Dia 31 em mês curto cai no último dia do mês (igual ao app).
  const mkDate = (y, m, d) => new Date(y, m, Math.min(d, new Date(y, m + 1, 0).getDate()));
  const dayModeOf = c => c.dayMode || (c.creditDay ? "fixed" : "none");
  const isBenefitCredit = t => t.kind === "credit" && (t.benefit || /^Crédito de /.test(t.desc || ""));

  // Previsão do próximo crédito de dia variável (mesma conta do app).
  function estimateNext(card, txs) {
    const ds = new Set(txs.filter(t => t.cardId === card.id && isBenefitCredit(t)).map(t => t.date));
    if (card.lastCreditDate) ds.add(card.lastCreditDate);
    const sorted = [...ds].sort();
    if (!sorted.length) return null;
    const recent = sorted.slice(-6).map(fromISO);
    const gaps = recent.slice(1).map((d, i) => Math.round((d - recent[i]) / 86400000)).filter(g => g >= 5);
    const avg = gaps.length ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : 30;
    return addDays(recent[recent.length - 1], Math.min(45, Math.max(7, avg)));
  }

  // Créditos de hoje até hoje + `dias` (padrão 3), em ordem de data: [{cardId, data, faltam, estimado}].
  // Dia variável: só previsão ainda no futuro (a que já venceu continua no aviso "já caiu?" do app).
  function proximos(cards, hoje, dias, txs) {
    const h0 = midnight(hoje), n = dias == null ? 3 : dias, lista = txs || [];
    const out = [];
    for (const c of cards || []) {
      const mode = dayModeOf(c);
      let datas = [];
      let estimado = false;
      if (mode === "fixed" && Number(c.creditDay) > 0) {
        for (let k = 0; k <= Math.ceil(n / 28) + 1; k++) datas.push(mkDate(h0.getFullYear(), h0.getMonth() + k, Number(c.creditDay)));
      } else if (mode === "variable") {
        const est = estimateNext(c, lista);
        if (est) { datas = [est]; estimado = true; }
      }
      for (const d of datas) {
        const faltam = Math.round((d - h0) / 86400000);
        if (faltam < 0 || faltam > n) continue;
        if (!estimado) {
          // crédito deste período já registrado: não avisa
          if (c.lastCreditMonth === monthKey(d)) continue;
          if (lista.some(t => t.cardId === c.id && isBenefitCredit(t) && t.date >= isoDay(d))) continue;
        } else if (faltam === 0) continue;
        out.push({ cardId: c.id, data: isoDay(d), faltam, estimado });
      }
    }
    return out.sort((a, b) => a.data.localeCompare(b.data));
  }

  function rotulo(faltam) {
    if (faltam <= 0) return "hoje";
    if (faltam === 1) return "amanhã";
    return `em ${faltam} dias`;
  }

  // Agenda dos próximos 14 dias para o service worker: só data e quantidade de cartões (sem nome, valor ou final).
  function montarAgenda(cards, hoje, txs) {
    const porDia = {};
    for (const p of proximos(cards, hoje, 13, txs)) porDia[p.data] = (porDia[p.data] || 0) + 1;
    return Object.keys(porDia).sort().map(data => ({ data, n: porDia[data] }));
  }

  // Texto da notificação de hoje, ou null. Sem dados pessoais: aparece na tela bloqueada.
  function avisoDeHoje(agenda, hoje) {
    try {
      if (!Array.isArray(agenda)) return null;
      const iso = isoDay(hoje);
      const dia = agenda.find(a => a && a.data === iso);
      if (!dia || !(dia.n > 0)) return null;
      return "Hoje é dia de crédito. Abra o Ciclo para confirmar o valor.";
    } catch (e) { return null; }
  }

  const root = typeof window !== "undefined" ? window : self;
  root.Credito = { proximos, rotulo, montarAgenda, avisoDeHoje };
})();
