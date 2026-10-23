// Exportação do extrato em planilha (CSV): separador ";", vírgula decimal, UTF-8 com BOM.
// Lógica pura (sem tela), para abrir direto no Excel e no Google Planilhas.
(function () {
  const COLUNAS = ["Data", "Loja", "Categoria", "Cartão", "Titular", "Emissor", "Tipo", "Valor", "Saldo no cupom", "Forma de pagamento"];
  const OUTRAS = { credito: "Cartão de crédito", debito: "Cartão de débito", pix: "Pix", dinheiro: "Dinheiro", outro: "Outra forma" };

  const num = n => (typeof n === "number" && isFinite(n) ? n.toFixed(2).replace(".", ",") : "");
  const dia = iso => (iso || "").split("-").reverse().join("/");

  // Texto: protege fórmulas (=, +, -, @, tab, CR no início), aspas, ";" e quebras de linha.
  function campo(v) {
    let s = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function pagamento(t) {
    if (!t.groupId) return "";
    const outras = (t.otherPay || []).map(o => `${OUTRAS[o.kind] || "Outra forma"} ${num(o.amount)}`);
    return [`Compra dividida, total ${num(t.purchaseTotal)}`].concat(outras).join("; ");
  }

  // txs já filtradas e ordenadas; cards: lista de cartões. Devolve o texto com BOM.
  function montar(txs, cards) {
    const porId = {};
    for (const c of cards || []) porId[c.id] = c;
    const linhas = [COLUNAS.map(campo).join(";")];
    for (const t of txs) {
      const c = porId[t.cardId] || {};
      const credito = t.kind === "credit";
      const valor = typeof t.amount === "number" ? (credito ? t.amount : -t.amount) : null;
      linhas.push([
        dia(t.date), t.desc, t.cat, c.name, c.holder, c.issuer, credito ? "Crédito" : "Gasto",
      ].map(campo).concat(num(valor), num(t.reportedBalance), campo(pagamento(t))).join(";"));
    }
    return "﻿" + linhas.join("\r\n") + "\r\n";
  }

  window.Csv = { montar, COLUNAS };
})();
