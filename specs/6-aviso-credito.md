# Spec #6 · B-21 · Aviso do dia do crédito

## Objetivo
Quando o crédito de um cartão estiver para cair, o Início mostra isso em destaque ("Hoje cai o crédito do cartão X", "Amanhã…", "Em 3 dias…") e pergunta quanto entrou, para ela confirmar o valor sem procurar. Como extra opcional, em Ajustes, o app instalado tenta avisar por notificação no dia, sem garantia de que chegue (o Chrome decide quando roda).

## Contexto do código (já existe)
- `js/app.js` (IIFE, não é carregável nos testes): `creditInfo(card)` devolve `{next, calDays, estimated, overdue, period}` (dia fixo: `period.end`; dia variável: previsão por `estimateNext`). `expectedAmount(card)` dá o valor esperado. `pendingCredits(cards)` lista os créditos "que já deveriam ter caído" (só no período vigente, ou atrasados quando variável). `renderCreditNotices`/`renderNotices` desenham o aviso no Início; o botão `credit-confirm` abre `creditSheet(card)` (valor e data editáveis) e `credit-batch` abre `creditBatchSheet()`. `S.skipped` guarda "Ainda não veio"/"Depois" só na sessão.
- Lacuna: hoje o aviso só aparece quando o crédito já está pendente; não há aviso "hoje/amanhã/próximos dias" antes. Pelo mesmo motivo a lógica está presa no `app.js` e sem teste.
- `sw.js` só faz cache; não tem `push`, `periodicsync` nem `notificationclick`.

## Parte 1: Início (obrigatória)

### Critérios de aceite
1. Função pura `Credito.proximos(cards, hoje, dias)` (novo `js/credito.js`) devolve, para cada cartão com dia de crédito (fixo ou variável com previsão), `{cardId, data, faltam}` para créditos de hoje até hoje + `dias` (padrão 3), em ordem de data. Teste: `tests/credito.test.js`, "dia fixo: crédito hoje, amanhã e em 3 dias entram; em 4 dias não".
2. Cartão sem dia de crédito (`dayMode` "none" ou sem `creditDay`) não aparece. Teste: "cartão sem dia de crédito fica de fora".
3. Dia 31 em mês curto e virada de mês/ano: o dia cai no último dia do mês (mesma regra de `mkDate` do app). Teste: "creditDay 31 em fevereiro", "virada de dezembro para janeiro".
4. Dia variável: usa a data prevista (`estimateNext`); previsão ainda no futuro dentro da janela aparece marcada como "previsto" (texto com "~"); previsão já vencida continua no fluxo atual de `pendingCredits` (não duplica). Teste: "variável: previsão em 2 dias aparece como estimada" e "variável vencido não duplica".
5. Cartão cujo crédito do período já foi registrado (`lastCreditMonth === period.key` ou há crédito de benefício no período) não aparece como "hoje". Teste: "crédito já registrado some do aviso".
6. No Início, acima dos avisos atuais, aparece o bloco "Créditos previstos": uma linha por cartão (nome, titular, "hoje" / "amanhã" / "em N dias", valor esperado com "valor varia" quando `amountMode` é variável) e, para o que cai hoje ou já passou, o botão "Confirmar valor" que abre o `creditSheet` já preenchido. Mais de um cartão no mesmo dia: o botão do bloco abre `creditBatchSheet`. Conferência manual (ver abaixo) + teste da função de texto `Credito.rotulo(faltam)` : "hoje", "amanhã", "em 3 dias".
7. Respeita o filtro de titular (`visibleCards()`) e o botão de esconder valores (valores mascarados como no resto do Início). Conferência manual.
8. "Ainda não veio" / "Depois" continuam funcionando e escondem o bloco daquele cartão na sessão (`S.skipped`). Conferência manual.
9. Sem cartões previstos na janela, o bloco não aparece (nada de espaço vazio).
10. Dados reais não entram no repositório: os testes usam cartões fictícios ("Cartão A", valores redondos). Revisão do diff.
11. `js/credito.js` entra no `index.html` (antes de `app.js`), na lista `FILES` do `sw.js` e em `tests/carregar.js`; `README.md` (Estrutura do projeto) ganha uma linha. Teste: `node scripts/versao.mjs --check` e `node --test` passam; app abre offline.

## Parte 2: notificação por sincronização periódica (experimento, opcional)

Sem promessa de confiabilidade. O texto em Ajustes deve dizer isso com clareza.

### Critérios de aceite
12. Em Ajustes, novo item "Aviso de crédito (experimento)", desligado por padrão, só visível quando `"periodicSync" in registration` e o app está instalado (`matchMedia("(display-mode: standalone)")`); caso contrário mostra "Seu aparelho ou navegador não permite este aviso. O quadro do Início continua funcionando.". Texto: "O Android decide quando o app roda em segundo plano; o aviso pode atrasar ou não chegar. Confie no quadro do Início." Conferência manual.
13. Ao ligar: pede `Notification.requestPermission()` (só por gesto do toque) e `registration.periodicSync.register("ciclo-credito", {minInterval: 12 h})`. Se a permissão for negada, o interruptor volta a desligado com mensagem em português simples. Ao desligar: `unregister`. O estado fica em `S.meta.avisoCredito = {ligado, datas}` (campo novo em `meta`, **fora do backup e do Drive**, como a chave do Gemini). Teste: `Credito.montarAgenda(cards, hoje)` e o filtro de meta do backup (`Drive.montarBackup` não inclui `avisoCredito`) em `tests/credito.test.js`/`tests/drive.test.js`.
14. O service worker não calcula nada: o app, sempre que abre ou muda cartão/crédito, grava em `meta.avisoCredito.datas` a agenda dos próximos 14 dias como lista de `{data: "AAAA-MM-DD", n: <nº de cartões>}` (sem nome, sem valor, sem final de cartão). Teste: "agenda tem só data e contagem" (compara chaves do objeto).
15. `sw.js` ganha `periodicsync` (tag `ciclo-credito`): lê a agenda do IndexedDB (`ciclo`, store `meta`, chave `main`, somente leitura, sem mudar a versão do banco), e se hoje tem `n > 0` e ainda não avisou hoje, mostra a notificação com tag `ciclo-credito-AAAA-MM-DD` (a tag evita repetir). Texto sem dados pessoais, pois aparece na tela bloqueada: "Hoje é dia de crédito. Abra o Ciclo para confirmar o valor." Teste: função pura `Credito.avisoDeHoje(agenda, hoje)` devolve texto ou `null`; o SW a chama (carregar com `importScripts("js/credito.js")` e incluir em `FILES`).
16. `notificationclick` abre/foca o app (`clients.openWindow("./")`). Conferência manual.
17. Falha em qualquer etapa (sem suporte, sem permissão, erro de IndexedDB no SW) não quebra o app nem o quadro do Início; erros só no console. Teste: `Credito.avisoDeHoje` com agenda vazia/ausente/corrompida devolve `null`.

## Arquivos afetados
- `js/credito.js` (novo): `proximos`, `rotulo`, `montarAgenda`, `avisoDeHoje`; sem DOM, carregável no Node e no SW (`window`/`self`). Recebe `cards`, `txs` e `hoje` como argumentos; reaproveita a regra de período de `app.js` (mover ou espelhar `periodAt`/`estimateNext` mínimos; preferir expor em `credito.js` e `app.js` passar a usar, sem mudar o comportamento existente, que `tests/cartao.test.js` e os demais testes devem continuar provando).
- `js/app.js`: bloco "Créditos previstos" no `renderHome`; item em `renderAjustes`; ações `credito-aviso-ligar/desligar`; gravar agenda após `render()` quando o aviso estiver ligado.
- `sw.js`: `periodicsync`, `notificationclick`, `importScripts`; `credito.js` na lista `FILES`; nova `VERSION` pelo script de versão.
- `index.html`: `<script src="js/credito.js" defer>` antes de `app.js`.
- `styles.css`: estilo do bloco (reaproveitar `.notice`/cores âmbar de dia do crédito; 360 px, claro e escuro).
- `tests/carregar.js`, `tests/credito.test.js` (novo), possivelmente `tests/drive.test.js`.
- `README.md` (estrutura), `CHANGELOG.md`, versão nova (minor) via `node scripts/versao.mjs X.Y.Z`.
- `manifest.webmanifest`: sem mudança prevista.

## Fora do escopo
- Notificação com o app fechado de forma confiável, push com servidor, alarmes agendados, qualquer serviço próprio ou de terceiros.
- Nome do cartão, valor ou final na notificação.
- Mudar como o dia do crédito é calculado ou cadastrado; registrar o crédito automaticamente (sempre ela confirma).
- iOS e navegadores que não sejam Chrome/Android.
- Aviso de saldo baixo ou de outros eventos.

## Decisões em aberto
1. **Janela do bloco "próximos dias".** Opções: só hoje; hoje + 3 dias; 7 dias. Recomendada: hoje + 3 dias (cobre o fim de semana sem poluir o Início). *Com padrão.*
2. **Onde fica o bloco.** Opções: acima de tudo; junto dos avisos de crédito atuais. Recomendada: logo abaixo da barra de titulares, junto dos avisos de crédito (mesma região, mesmo estilo). *Com padrão.*
3. **Texto da notificação.** Opções: genérico, sem nomes; com nome do cartão. Recomendada: genérico (aparece na tela bloqueada, e o repositório e a família são sensíveis a esses dados). *Com padrão.*
4. **Como o SW sabe a agenda.** Opções: SW lê `meta.avisoCredito` do IndexedDB existente; SW recalcula tudo; app grava em Cache Storage. Recomendada: ler `meta` (campo novo, sem store nova, sem mudar versão do banco). *Com padrão.*
5. **Intervalo mínimo do periodic sync.** Opções: 12 h; 24 h. Recomendada: 12 h (o Chrome já espaça mais; dá duas chances ao dia). *Com padrão.*
6. **Versão.** Recomendada: minor (nova função). O publicador decide o número. *Com padrão.*

Nenhuma decisão cai em regra de bloqueio do `CLAUDE.md` (não muda decisão registrada no `DECISOES.md`; a notificação é local, sem servidor, conta ou custo). Se a Jéssica aprovar a decisão 4, registrar no `DECISOES.md` que o aviso é "experimento, sem garantia, só no aparelho".

## Precisa de arquiteto?
Não. Não muda o formato dos dados nem cria armazenamento: só um campo novo em `meta` (já existente, fora do backup) e um módulo novo pequeno e sem estado. O SW passa a ler o IndexedDB do app em modo leitura, o que é um contrato interno, não entre sistemas. Se o desenvolvedor achar que precisa de store nova ou de mexer na versão do banco, parar e pedir arquiteto.

## Teste no celular / no PC
No PC (verificador, 360 px, claro e escuro): bloco aparece com cartões fictícios com crédito hoje, amanhã e em 3 dias; botão abre o registro com valor preenchido; filtro de titular, olho e "Depois" funcionam; lista de Ajustes mostra "não suportado" no navegador do PC se for o caso.
Só a Jéssica, no celular (etiqueta `teste-no-celular`):
- Instalar o app, abrir Início num dia com crédito previsto e conferir o bloco e o botão "Confirmar valor".
- Ligar o aviso em Ajustes, aceitar a permissão, fechar o app e esperar 1 a 3 dias: anotar se a notificação chegou, em que horário, e se tocar nela abre o app. Negar a permissão deve desligar o interruptor com mensagem clara.
- Resultado serve para decidir se o experimento vira recurso fixo ou é removido (nova issue).
