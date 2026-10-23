# Spec #2 · B-20 · Backup automático no Google Drive (Apps Script)

Nota: o corpo da issue não pôde ser lido pelas ferramentas; esta spec parte do texto de B-20 no `BACKLOG.md` (mesma descrição). Se o corpo da issue divergir, vale o da issue.

## Objetivo

A Jéssica liga o Drive uma vez em Ajustes, e o Ciclo passa a guardar sozinho uma cópia dos dados numa pasta "Ciclo – backups" do Google Drive dela. Se o celular for perdido ou formatado, ela restaura tudo do Drive. O arquivo de backup é o mesmo de hoje; só muda para onde vai.

## Contrato app ↔ Apps Script (fixo; o desenvolvedor segue)

Apps Script publicado como App da Web ("Executar como: eu"; acesso: "Qualquer pessoa"). O app chama com `fetch(url, { method: "POST", body: JSON.stringify(corpo) })` **sem** cabeçalho `Content-Type` customizado (vira `text/plain`, evita pré-verificação CORS) e `redirect: "follow"`. O código secreto vai no **corpo**, nunca na URL. Resposta sempre JSON `{ ok: true, ... }` ou `{ ok: false, erro: "segredo" | "tamanho" | "formato" | "inesperado" }`.

| `acao` | Corpo extra | Resposta |
|---|---|---|
| `salvar` | `nome` (`ciclo-AAAA-MM-DD-HHMM.json`), `conteudo` (texto do backup) | `{ ok, id, nome, tamanho, data }` |
| `listar` | — | `{ ok, itens: [{ id, nome, tamanho, data }] }` (mais novo primeiro, máx. 30) |
| `ler` | `id` | `{ ok, conteudo }` |

O script: confere o segredo (guardado em Propriedades do script, ver abaixo) com comparação simples; cria a pasta "Ciclo – backups" se não existir; só lê/grava dentro dessa pasta; mantém só os 30 mais novos (apaga os mais velhos da pasta, nunca arquivos fora dela); recusa `conteudo` acima de 20 MB (`tamanho`).

## Critérios de aceite

1. `apps-script/backup.gs` existe, sem segredo nem URL reais, com instruções em comentário no topo (passo a passo em português simples) e função `configurar()` que a Jéssica roda uma vez para gravar o segredo nas Propriedades do script (ela edita só uma linha local no editor, sem commitar). Prova: revisão do verificador + teste 2.
2. Teste automático do contrato do script: `tests/drive-script.test.js` carrega `apps-script/backup.gs` num `vm` com `DriveApp`, `PropertiesService` e `ContentService` falsos e confere: segredo errado → `erro: "segredo"`; `salvar` cria a pasta uma vez e grava o arquivo; `listar` ordena do mais novo; `ler` devolve o conteúdo; passa de 30 arquivos → apaga os mais velhos; acima de 20 MB → `erro: "tamanho"`; JSON inválido → `erro: "formato"`.
3. Novo `js/drive.js` (objeto `Drive` global, como `GeminiReader`) com funções puras e testáveis: `montarBackup(estado, comFotos)` (mesmo formato de hoje, `version` inalterada), `nomeArquivo(data)`, `precisaSalvar({ ligado, ultimo, novos, agora })` (verdadeiro se nunca salvou, último > 7 dias ou ≥ 30 lançamentos novos), `chamar(config, corpo)` e `gerarSegredo()` (32+ caracteres aleatórios via `crypto.getRandomValues`). Prova: `tests/drive.test.js` cobre `precisaSalvar` (nunca, 6 dias, 8 dias, 29 vs 30 lançamentos, desligado), `nomeArquivo`, `gerarSegredo` (tamanho, dois valores diferentes), `chamar` com `fetch` falso (monta corpo com o segredo, trata `ok:false`, rede fora, resposta não-JSON).
4. A geração do backup em `app.js` passa a usar `Drive.montarBackup` e o arquivo local (Fazer backup) continua idêntico ao atual. Prova: teste compara a saída com um estado fictício contra o formato atual (`app`, `version`, `exportedAt`, `cards`, `txs`, `meta.vault`, `receipts`).
5. Ajustes ganha o item **Backup no Drive**: tela de configuração com campo do link do script, o código secreto gerado pelo app (botão "Copiar código"; botão "Gerar outro"), explicação curta dos passos e botão **Testar conexão** (chama `listar`; mostra "Conectado" ou o erro em português). Link e segredo ficam em `S.meta.drive = { url, secret, ligado }`, **fora do backup** (já fora, pois o backup só leva `meta.vault`). Prova: teste confere que `montarBackup` não contém `drive`, `url` nem `secret` mesmo com `meta.drive` preenchido.
6. Com o Drive configurado, Ajustes mostra **Salvar no Drive** (salva agora; toast "Backup salvo no Drive.") e **Restaurar do Drive** (lista com data e tamanho; ao escolher, reaproveita o fluxo e a confirmação atuais de `importFile`, que passa a aceitar objeto já lido). Atualiza `S.meta.lastBackup` ao salvar. Prova: teste de `Drive.chamar` + conferência manual (abaixo).
7. Salvamento automático ao abrir o app, em segundo plano, sem travar a tela: só se `Drive.precisaSalvar`, online e Drive ligado. Falha é silenciosa (sem toast de erro; tenta de novo na próxima abertura) e marca `S.meta.drive.ultimoErro`. Prova: teste de `precisaSalvar` e de `chamar` com falha.
8. Com o Drive ligado e o último salvamento no prazo, o lembrete de backup do Início (`backupWarn`) some. Se o Drive estiver ligado mas houver falha de mais de 7 dias, o lembrete aparece com texto "O backup no Drive não está funcionando." e botão que abre a tela do Drive. Prova: função pura `Drive.lembrete(estado)` testada nos 4 casos (sem Drive/com Drive ok/com Drive falhando/sem backup nenhum).
9. Fotos: o backup do Drive é sem fotos por padrão. Opção "Incluir fotos" (desligada); se o conteúdo passar de 20 MB, o app não envia e avisa "Com as fotos o backup passa do limite do Drive. Salve sem fotos ou apague fotos antigas em Ajustes → Fotos." Prova: teste do limite em `Drive.montarBackup`/`Drive.cabe(conteudo)`.
10. `js/drive.js` está no `index.html` e em `FILES` do `sw.js`; `apps-script/` **não** entra em `FILES` (não é usado pelo app). `node scripts/versao.mjs --check` e `node --test` passam; entrada MINOR no CHANGELOG (o publicador cuida da versão).
11. Textos em português simples; 360 px, tema claro e escuro sem quebra.
12. README: seção curta "Backup automático no Drive" com o passo a passo e o aviso de segurança; atualizar a linha "Backup e restauração".

## Arquivos afetados

- `apps-script/backup.gs` (novo): `doPost` com `salvar`/`listar`/`ler`, `configurar()`, pasta, limite 30 e 20 MB.
- `js/drive.js` (novo): lógica do Drive descrita no critério 3 e 8.
- `js/app.js`: usa `Drive.montarBackup` em `backupSheet`; telas "Backup no Drive" em Ajustes (menu perto da linha 573), salvar/restaurar, salvamento automático na abertura, `backupWarn` (linha ~477); `importFile` aceita dados já lidos.
- `index.html`: `<script src="js/drive.js" defer>` após `gemini.js`.
- `sw.js`: `"js/drive.js"` na lista `FILES`.
- `styles.css`: só se a tela nova precisar.
- `tests/drive.test.js`, `tests/drive-script.test.js` (novos); `tests/carregar.js` passa a expor `Drive`.
- `README.md`, `CHANGELOG.md` (entrada da versão), `DECISOES.md` (decisões novas abaixo, quando viram definitivas).

## Fora do escopo

- Sincronização entre aparelhos e migração dos dados para fora do celular (isso é o B-23).
- Criptografar o arquivo inteiro (o cofre já vai criptografado dentro dele).
- Backup de chave do Gemini, link e segredo (continuam só no celular).
- Mudar o formato do arquivo de backup ou `BACKUP_VERSION`.
- Restaurar parcialmente ou mesclar; restaurar continua substituindo tudo, com confirmação.
- Fazer a Jéssica publicar ou autorizar o script: é passo manual dela.

## Decisões em aberto

1. Acesso do App da Web: "Qualquer pessoa" (necessário para o `fetch` do celular sem login Google), protegido pelo código secreto longo. Alternativa: "Somente eu" não funciona com `fetch` sem cookie. Recomendada: "Qualquer pessoa" + segredo. *Com padrão.*
2. Retenção: 30 backups mais novos. Alternativa: guardar todos. Recomendada: 30, por não encher o Drive. *Com padrão.*
3. Frequência: 7 dias ou 30 lançamentos (do BACKLOG). *Com padrão.*
4. Limite de 20 MB por envio (margem sobre o limite do Apps Script). *Com padrão.*
5. Segredo no corpo do POST, comparado direto no script (sem hash), pois o código do script é a única cópia além do celular. *Com padrão.*

Nenhum cai nas regras de bloqueio. Nenhuma mexe em decisão registrada: "sem servidor próprio" continua valendo (o Apps Script roda na conta dela); porém esta feature **leva dados do celular para o Google Drive dela por escolha dela**, o que o texto de `DECISOES.md`/"Onde ficam seus dados" (`aboutSheet`) diz que não acontece. O desenvolvedor atualiza esse texto ("Nada é enviado... a menos que você ligue o Drive") e registra a decisão nova no `DECISOES.md` (data + #2).

## Precisa de arquiteto?

Não. O formato do backup, o IndexedDB e a estrutura de módulos (um arquivo novo `js/drive.js`, como `gemini.js`) não mudam; o contrato com o Apps Script está fixado nesta spec e só campos novos entram em `S.meta` (que já aceita campos livres).

## Teste no celular / no PC (só a Jéssica)

Etiqueta `teste-no-celular` na issue, com este roteiro:
1. No PC: script.google.com → novo projeto → colar `apps-script/backup.gs` → rodar `configurar()` com o código copiado do Ciclo → Implantar como App da Web (executar como eu, acesso qualquer pessoa) → autorizar → copiar o link.
2. No celular: Ajustes → Backup no Drive → colar link → Testar conexão (deve dizer "Conectado").
3. Salvar no Drive; conferir no Drive a pasta "Ciclo – backups" com o arquivo.
4. Abrir o app com último backup > 7 dias (ou 30 lançamentos novos): salva sozinho; lembrete do Início some.
5. Restaurar do Drive noutro navegador (ou após limpar dados) e conferir cartões, lançamentos e cofre (senha mestra abre).
6. Salvar com fotos: aviso quando passar do limite.
7. Modo avião: abrir o app não mostra erro nem trava.
