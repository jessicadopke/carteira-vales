// Backup do Ciclo no Google Drive (Google Apps Script).
//
// COMO LIGAR (uma vez só, no computador):
//  1. No Ciclo, abra Ajustes > Backup no Drive e toque em "Copiar código".
//  2. Entre em https://script.google.com com a sua conta Google e crie um "Novo projeto".
//  3. Apague o que estiver no editor e cole este arquivo inteiro.
//  4. Na linha "const SEGREDO_LOCAL" logo abaixo, troque o texto pelo código copiado.
//     Essa troca fica só no seu editor: NÃO coloque o código real neste arquivo do repositório.
//  5. No topo, escolha a função "configurar" e toque em "Executar". Autorize quando o Google pedir.
//     (Depois disso pode apagar o código da linha do passo 4: ele já ficou guardado no script.)
//  6. Toque em "Implantar" > "Nova implantação" > tipo "App da Web".
//     Executar como: "Eu". Quem pode acessar: "Qualquer pessoa". Toque em "Implantar".
//  7. Copie o link do App da Web e cole no Ciclo, em Ajustes > Backup no Drive. Toque em "Testar conexão".
//
// SEGURANÇA: quem tiver o link E o código consegue ler e gravar os backups. Não compartilhe os dois.
// O script só mexe na pasta "Ciclo – backups" do seu Drive e guarda os 30 backups mais novos.

const SEGREDO_LOCAL = "COLE-AQUI-O-CODIGO";
const NOME_PASTA = "Ciclo – backups";
const MAX_ARQUIVOS = 30;
const MAX_BYTES = 20 * 1024 * 1024;
const PADRAO_NOME = /^ciclo-\d{4}-\d{2}-\d{2}-\d{4}\.json$/;

// Roda uma vez, à mão, para guardar o código nas Propriedades do script.
function configurar() {
  if (!SEGREDO_LOCAL || SEGREDO_LOCAL === "COLE-AQUI-O-CODIGO" || SEGREDO_LOCAL.length < 16) {
    throw new Error("Troque o texto de SEGREDO_LOCAL pelo código copiado do Ciclo.");
  }
  PropertiesService.getScriptProperties().setProperty("SEGREDO", SEGREDO_LOCAL);
}

function responder_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function pasta_() {
  const it = DriveApp.getFoldersByName(NOME_PASTA);
  return it.hasNext() ? it.next() : DriveApp.createFolder(NOME_PASTA);
}

function itens_(pasta) {
  const lista = [];
  const it = pasta.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    lista.push({ arq: f, id: f.getId(), nome: f.getName(), tamanho: f.getSize(), quando: f.getDateCreated().getTime() });
  }
  lista.sort((a, b) => b.quando - a.quando);
  return lista;
}

function resumo_(x) {
  return { id: x.id, nome: x.nome, tamanho: x.tamanho, data: new Date(x.quando).toISOString() };
}

function doPost(e) {
  try {
    let corpo;
    try { corpo = JSON.parse(e && e.postData && e.postData.contents); } catch (err) { return responder_({ ok: false, erro: "formato" }); }
    if (!corpo || typeof corpo !== "object") return responder_({ ok: false, erro: "formato" });
    const segredo = PropertiesService.getScriptProperties().getProperty("SEGREDO");
    if (!segredo || corpo.segredo !== segredo) return responder_({ ok: false, erro: "segredo" });

    if (corpo.acao === "salvar") {
      if (typeof corpo.nome !== "string" || !PADRAO_NOME.test(corpo.nome) || typeof corpo.conteudo !== "string") return responder_({ ok: false, erro: "formato" });
      if (corpo.conteudo.length > MAX_BYTES) return responder_({ ok: false, erro: "tamanho" });
      const pasta = pasta_();
      const arq = pasta.createFile(corpo.nome, corpo.conteudo, "application/json");
      const todos = itens_(pasta);
      for (const velho of todos.slice(MAX_ARQUIVOS)) velho.arq.setTrashed(true);
      const novo = todos.find(x => x.id === arq.getId());
      return responder_({ ok: true, id: arq.getId(), nome: arq.getName(), tamanho: arq.getSize(), data: novo ? new Date(novo.quando).toISOString() : new Date().toISOString() });
    }
    if (corpo.acao === "listar") {
      return responder_({ ok: true, itens: itens_(pasta_()).slice(0, MAX_ARQUIVOS).map(resumo_) });
    }
    if (corpo.acao === "ler") {
      if (typeof corpo.id !== "string") return responder_({ ok: false, erro: "formato" });
      // Só lê arquivos que estão na pasta de backups.
      const achado = itens_(pasta_()).find(x => x.id === corpo.id);
      if (!achado) return responder_({ ok: false, erro: "formato" });
      return responder_({ ok: true, conteudo: achado.arq.getBlob().getDataAsString() });
    }
    return responder_({ ok: false, erro: "formato" });
  } catch (err) {
    return responder_({ ok: false, erro: "inesperado" });
  }
}
