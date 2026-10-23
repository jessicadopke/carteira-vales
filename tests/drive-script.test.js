// Contrato do Apps Script (apps-script/backup.gs) com DriveApp, PropertiesService e ContentService falsos.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const codigo = fs.readFileSync(path.join(__dirname, "..", "apps-script", "backup.gs"), "utf8");

function ambiente(segredo = "SEGREDO-FICTICIO-1234", fonte = codigo) {
  let seq = 0, relogio = Date.UTC(2026, 0, 1);
  const pastas = [];
  const arquivosForaDaPasta = [{ id: "fora", lixo: false }];
  const iter = lista => { let i = 0; return { hasNext: () => i < lista.length, next: () => lista[i++] }; };
  const criarPasta = nome => {
    const arquivos = [];
    const p = {
      nome, arquivos,
      getFiles: () => iter(arquivos.filter(a => !a.lixo)),
      createFile: (n, conteudo) => {
        const a = { id: "id" + (++seq), n, conteudo, lixo: false, criado: new Date(relogio += 60000),
          getId() { return this.id; }, getName() { return this.n; }, getSize() { return this.conteudo.length; },
          getDateCreated() { return this.criado; }, getBlob() { return { getDataAsString: () => this.conteudo }; },
          setTrashed(v) { this.lixo = v; } };
        arquivos.push(a);
        return a;
      },
    };
    pastas.push(p);
    return p;
  };
  const props = { SEGREDO: segredo };
  const ctx = {
    DriveApp: { getFoldersByName: n => iter(pastas.filter(p => p.nome === n)), createFolder: criarPasta },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: t => ({ t, setMimeType() { return this; }, getContent() { return this.t; } }) },
  };
  vm.createContext(ctx);
  vm.runInContext(fonte, ctx, { filename: "backup.gs" });
  const chamar = (corpo, segredoEnviado = segredo) => {
    const bruto = typeof corpo === "string" ? corpo : JSON.stringify({ ...corpo, segredo: segredoEnviado });
    return JSON.parse(ctx.doPost({ postData: { contents: bruto } }).getContent());
  };
  return { chamar, pastas, props, ctx, arquivosForaDaPasta };
}
const nome = i => `ciclo-2026-02-${String((i % 28) + 1).padStart(2, "0")}-${String(1000 + i).slice(-4)}.json`;

test("segredo errado ou ausente: erro \"segredo\" e nada é criado", () => {
  const { chamar, pastas } = ambiente();
  assert.deepEqual(chamar({ acao: "listar" }, "outro"), { ok: false, erro: "segredo" });
  assert.deepEqual(chamar({ acao: "salvar", nome: nome(1), conteudo: "{}" }, ""), { ok: false, erro: "segredo" });
  assert.equal(pastas.length, 0);
});

test("script sem configurar() rodado recusa tudo", () => {
  const { chamar, props } = ambiente();
  delete props.SEGREDO;
  assert.equal(chamar({ acao: "listar" }, "").erro, "segredo");
});

test("configurar() recusa o texto de exemplo e grava um código válido", () => {
  const { ctx, props } = ambiente();
  delete props.SEGREDO;
  assert.throws(() => ctx.configurar(), /Troque o texto/);
  const c2 = ambiente("x", codigo.replace("COLE-AQUI-O-CODIGO", "codigo-ficticio-de-teste-123"));
  delete c2.props.SEGREDO;
  c2.ctx.configurar();
  assert.equal(c2.props.SEGREDO, "codigo-ficticio-de-teste-123");
});

test("o arquivo do repositório não traz segredo nem link reais", () => {
  assert.ok(codigo.includes('SEGREDO_LOCAL = "COLE-AQUI-O-CODIGO"'));
  assert.ok(!/script\.google\.com\/macros\/s\//.test(codigo));
});

test("salvar cria a pasta uma só vez e grava o arquivo; ler devolve o conteúdo", () => {
  const { chamar, pastas } = ambiente();
  const a = chamar({ acao: "salvar", nome: nome(1), conteudo: '{"x":1}' });
  const b = chamar({ acao: "salvar", nome: nome(2), conteudo: '{"x":2}' });
  assert.equal(a.ok, true);
  assert.equal(a.nome, nome(1));
  assert.equal(a.tamanho, 7);
  assert.ok(a.id && a.data);
  assert.equal(pastas.length, 1);
  assert.equal(pastas[0].nome, "Ciclo – backups");
  assert.equal(pastas[0].arquivos.length, 2);
  assert.deepEqual(chamar({ acao: "ler", id: b.id }), { ok: true, conteudo: '{"x":2}' });
});

test("ler só abre arquivo da pasta de backups", () => {
  const { chamar } = ambiente();
  chamar({ acao: "salvar", nome: nome(1), conteudo: "{}" });
  assert.equal(chamar({ acao: "ler", id: "fora" }).ok, false);
});

test("listar ordena do mais novo e devolve no máximo 30", () => {
  const { chamar } = ambiente();
  for (let i = 1; i <= 3; i++) chamar({ acao: "salvar", nome: nome(i), conteudo: "{}" });
  const l = chamar({ acao: "listar" });
  assert.equal(l.ok, true);
  assert.deepEqual(l.itens.map(x => x.nome), [nome(3), nome(2), nome(1)]);
  assert.deepEqual(Object.keys(l.itens[0]), ["id", "nome", "tamanho", "data"]);
});

test("passou de 30 arquivos: apaga os mais velhos, só dentro da pasta", () => {
  const { chamar, pastas } = ambiente();
  for (let i = 1; i <= 33; i++) chamar({ acao: "salvar", nome: nome(i), conteudo: "{}" });
  const vivos = pastas[0].arquivos.filter(a => !a.lixo);
  assert.equal(vivos.length, 30);
  assert.deepEqual(pastas[0].arquivos.filter(a => a.lixo).map(a => a.n), [nome(1), nome(2), nome(3)]);
  assert.equal(chamar({ acao: "listar" }).itens.length, 30);
});

test("acima de 20 MB: erro \"tamanho\" e nada é gravado", () => {
  const { chamar, pastas } = ambiente();
  const r = chamar({ acao: "salvar", nome: nome(1), conteudo: "a".repeat(20 * 1048576 + 1) });
  assert.deepEqual(r, { ok: false, erro: "tamanho" });
  assert.equal(pastas.length ? pastas[0].arquivos.length : 0, 0);
});

test("JSON inválido, ação desconhecida e nome fora do padrão: erro \"formato\"", () => {
  const { chamar } = ambiente();
  assert.deepEqual(chamar("isto não é json"), { ok: false, erro: "formato" });
  assert.deepEqual(chamar({ acao: "apagar" }), { ok: false, erro: "formato" });
  assert.deepEqual(chamar({ acao: "salvar", nome: "../x.json", conteudo: "{}" }), { ok: false, erro: "formato" });
  assert.deepEqual(chamar({ acao: "salvar", nome: nome(1) }), { ok: false, erro: "formato" });
});

test("falha do Drive vira erro \"inesperado\"", () => {
  const { chamar, ctx } = ambiente();
  ctx.DriveApp.getFoldersByName = () => { throw new Error("falhou"); };
  assert.deepEqual(chamar({ acao: "listar" }), { ok: false, erro: "inesperado" });
});
