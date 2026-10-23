// Backup no Google Drive (opcional). O app fala com um Apps Script da própria conta da usuária (veja apps-script/backup.gs).
// Aqui ficam só as funções que não dependem da tela, para poderem ser testadas.
(() => {
  "use strict";

  const DIA = 86400000;
  const MAX_BYTES = 20 * 1024 * 1024;
  const BACKUP_VERSION = 1;
  const ERROS = {
    segredo: "O código secreto não confere com o do script. Copie o código do app e rode “configurar” de novo no script.",
    tamanho: "O backup passou do limite de 20 MB do Drive.",
    formato: "O script não entendeu o pedido. Confira se colou a versão mais nova do script.",
    inesperado: "O script do Drive deu erro. Tente de novo em instantes.",
  };
  const pad = n => String(n).padStart(2, "0");

  // Mesmo formato do arquivo de backup local. Link e código do Drive (meta.drive) nunca entram:
  // do meta só vai o cofre. `estado.receipts` já vem em texto (data URL) e só entra com `comFotos`.
  function montarBackup(estado, comFotos) {
    return {
      app: "ciclo",
      version: BACKUP_VERSION,
      exportedAt: estado.exportedAt || new Date().toISOString(),
      cards: estado.cards,
      txs: estado.txs,
      meta: { vault: (estado.meta && estado.meta.vault) || null },
      receipts: comFotos ? (estado.receipts || []) : [],
    };
  }

  function nomeArquivo(data) {
    const d = data || new Date();
    return `ciclo-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  }

  // Salva se nunca salvou, se o último foi há mais de 7 dias ou se há 30 lançamentos novos ou mais.
  function precisaSalvar({ ligado, ultimo, novos, agora }) {
    if (!ligado) return false;
    if (!ultimo) return true;
    return (agora - ultimo) > 7 * DIA || novos >= 30;
  }

  function cabe(conteudo) {
    const bytes = typeof TextEncoder !== "undefined" ? new TextEncoder().encode(conteudo).length : String(conteudo).length;
    return bytes <= MAX_BYTES;
  }

  function gerarSegredo() {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const lim = 256 - (256 % abc.length);
    let out = "";
    while (out.length < 40) {
      for (const b of crypto.getRandomValues(new Uint8Array(48))) {
        if (b < lim && out.length < 40) out += abc[b % abc.length];
      }
    }
    return out;
  }

  // Chama o script. Devolve o JSON de sucesso; em qualquer falha lança Error com texto em português.
  async function chamar(config, corpo) {
    if (!config || !config.url || !config.secret) throw new Error("Falta o link do script ou o código secreto.");
    let resp, json;
    try {
      // Sem cabeçalho Content-Type: vira text/plain e o navegador não faz a pré-verificação (CORS).
      resp = await fetch(config.url, { method: "POST", body: JSON.stringify({ ...corpo, segredo: config.secret }), redirect: "follow" });
    } catch (e) {
      throw new Error("Sem conexão com o Drive. Confira a internet e o link do script.");
    }
    try { json = await resp.json(); }
    catch (e) { throw new Error("O link não respondeu como o script do Ciclo. Confira o link e se o acesso é “Qualquer pessoa”."); }
    if (!json || json.ok !== true) {
      const cod = json && json.erro;
      const err = new Error(ERROS[cod] || "O Drive recusou o pedido.");
      err.codigo = cod || "inesperado";
      throw err;
    }
    return json;
  }

  // Que lembrete mostrar no Início: "padrao" (regra de sempre do arquivo), "nenhum" (Drive em dia) ou "falhando".
  function lembrete({ drive, agora }) {
    if (!drive || !drive.ligado) return { tipo: "padrao" };
    const base = drive.ultimo || drive.ligadoEm || drive.ultimoErro || agora;
    const falhou = drive.ultimoErro && drive.ultimoErro > (drive.ultimo || 0);
    if (falhou && agora - base > 7 * DIA) return { tipo: "falhando", texto: "O backup no Drive não está funcionando." };
    return { tipo: "nenhum" };
  }

  window.Drive = { montarBackup, nomeArquivo, precisaSalvar, cabe, gerarSegredo, chamar, lembrete, MAX_BYTES };
})();
