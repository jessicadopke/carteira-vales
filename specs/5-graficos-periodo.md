# #5 · B-19 · Gráficos de gastos por período

## Objetivo

A Jéssica quer ver, no período de um cartão (ou de todos os cartões), para onde o dinheiro foi: gastos por categoria, lojas onde mais se gastou e gastos por titular. Cada gráfico mostra também quanto mudou em relação ao período anterior (ex.: "R$ 120,00 a mais em Mercado"). Os gráficos são desenhados no próprio app, sem biblioteca, e funcionam offline. Os totais têm de bater com o extrato.

## Critérios de aceite

Convenções: valores em centavos inteiros (como no resto do app); só entram lançamentos `kind === "debit"` e `source !== "ajuste"` (a mesma conta de `periodStats().debits` e do "Gastos" do Extrato). Crédito, estorno e ajuste ficam fora.

1. **Agregação por categoria, loja e titular.** Dado um conjunto de gastos, o módulo devolve, para cada visão, uma lista `{ chave, rotulo, total }` em ordem decrescente de total, mais o total geral.
   - Categoria vazia vira "Sem categoria".
   - Loja é agrupada por `storeKey` do lançamento e, sem ele, por `Match.descKey(desc)`; o rótulo é o `desc` do lançamento mais recente do grupo. Mostra as 5 maiores e junta o resto em "Outras lojas" (não aparece se houver 5 ou menos).
   - Titular é o `holder` do cartão; vazio vira "Sem titular".
   - Teste: `tests/graficos.test.js` com lançamentos fictícios cobrindo cada regra (categoria vazia, mesma loja com `storeKey` e sem, 7 lojas -> 5 + "Outras lojas", cartão sem titular).
2. **Os totais batem com o extrato.** A soma de cada visão é igual ao total geral e igual ao "Gastos" do período (`periodStats(card, p).debits`) e ao "Gastos" da aba Extrato para os mesmos lançamentos. Lançamento de ajuste e crédito não entram.
   - Teste: em `graficos.test.js`, para um conjunto com débitos, créditos, estorno e ajuste, `soma(categorias) === soma(lojas) === soma(titulares) === total` e igual à conta manual dos débitos.
3. **Comparação com o período anterior.** Para cada item (categoria, loja, titular) calcula-se `atual - anterior`. O app mostra a frase do item que mais variou em módulo: "R$ 120,00 a mais em Mercado" / "R$ 45,00 a menos em Restaurante". Item que só existe em um dos períodos conta o outro como 0. Se não houver gasto no período anterior, a frase é "Sem período anterior para comparar." e nenhuma seta/diferença é mostrada. Diferença zero em tudo: "Gastos iguais ao período anterior."
   - Teste: `graficos.test.js` com período atual e anterior fictícios (maior variação para mais, para menos, item novo, item que sumiu, anterior vazio, tudo igual).
4. **Período certo.** Na tela do cartão, os gráficos usam o período mostrado (`S.periodOffset`) e o anterior é `periodShift(card, p, -1)`; ao tocar em ‹ ›, os gráficos mudam junto. No modo "todos os cartões" (aba Extrato), usa-se o período de cada cartão com o mesmo deslocamento, somando os cartões (veja Decisão 1). Cartão sem dia de crédito usa o mês do calendário, como já faz `periodAt`.
   - Teste: a função de seleção recebe `(txs, cartões, deslocamento)` e é testada em `graficos.test.js` com um cartão de dia fixo, um de dia variável e um sem crédito (os lançamentos do período e do anterior de cada um). Como `periodAt` está em `app.js` (que não carrega no Node), a seleção recebe uma função `periodoDe(cartao, deslocamento)` como parâmetro; o teste passa uma versão simples e o app passa a real.
5. **Desenho em SVG, sem biblioteca.** Barras horizontais (uma linha por item: rótulo, barra proporcional ao maior valor, valor em R$ e a diferença para o período anterior). O módulo devolve uma string SVG/HTML; todo texto vindo do usuário (loja, categoria, titular) passa por escape.
   - Teste: `graficos.test.js` confere que a saída tem um `<svg`, uma barra por item, largura proporcional (maior item = 100%, item zero = largura 0) e que `<script>` ou `"` em um nome de loja saem escapados.
6. **Estados vazios.** Período sem nenhum gasto: no lugar dos gráficos aparece "Sem gastos neste período." (sem gráfico vazio, sem erro).
   - Teste: `graficos.test.js` (lista vazia -> texto, sem `<svg`).
7. **Visual: 360 px, tema claro e escuro.** Só variáveis de cor do `styles.css` (sem cor fixa nova), texto legível sem cortar em 360 px (rótulo longo termina em reticências, o valor nunca é cortado), cada barra com `role="img"`/`aria-label` do tipo "Mercado: R$ 350,00". Cores das barras distinguíveis em claro e escuro.
   - Teste: `graficos.test.js` confere o `aria-label` e que o SVG usa `var(--...)` e não `#hex`. A conferência visual é manual (seção "Teste no celular / no PC").
8. **Privacidade.** Com o botão de olho ligado (valores escondidos), os valores e diferenças dos gráficos ficam escondidos como os demais; as barras continuam proporcionais.
   - Teste: manual (ver abaixo); o módulo recebe a função de formatação (`brl`) como parâmetro, então o teste de `graficos.test.js` confere que ela é usada em todo valor exibido.
9. **Offline e empacotamento.** `js/graficos.js` entra em `index.html` (script `defer`, antes de `app.js`), na lista `FILES` do `sw.js` e na lista de `tests/carregar.js`, e é exportado por `carregar.js`.
   - Teste: `node --test` passa; `node scripts/versao.mjs --check` continua batendo. Os testes existentes (`cartao`, `csv`, `drive`, `gemini`, `leitura`) continuam passando sem mudança.
10. **Dados reais.** Nenhum nome de loja, titular, valor ou cupom real em teste ou exemplo (usar "Mercado Exemplo", "Ana", "Bia" etc.).

## Arquivos afetados

- `js/graficos.js` (novo): módulo puro, sem tela nem IndexedDB, no mesmo molde de `js/csv.js` (IIFE que pendura `window.Graficos`). Funções: `somarGastos(txs, cartoes)`, `selecionar(txs, cartoes, deslocamento, periodoDe)`, `comparar(atual, anterior)`, `frase(comparacao, brl)`, `desenhar(visao, brl, esc)`.
- `js/app.js`:
  - Painel "Gastos do período" em `renderCard()`, abaixo do painel "Período" e antes do "Extrato do período"; usa `S.periodOffset`.
  - Painel equivalente na aba Extrato (`renderExtrato()`), para todos os cartões, com `‹ ›` próprios (`S.gfOffset`, zerado ao abrir a aba), respeitando o filtro de titular `S.person` quando ele estiver ativo. O painel fica fora de `#txArea`, para não ser redesenhado a cada letra da busca.
  - Três visões em abas simples ("Categorias", "Lojas", "Titulares") para caber em 360 px; a visão escolhida fica em `S.gfView`.
  - Nova ação `gf-view` no tratador de cliques (perto de `case "per"`).
  - Não muda nenhum formato salvo em IndexedDB nem no backup.
- `styles.css`: estilos das barras, abas e frase de comparação, só com variáveis existentes.
- `index.html`: `<script src="js/graficos.js" defer></script>` antes de `js/app.js`.
- `sw.js`: `"js/graficos.js"` em `FILES`.
- `tests/carregar.js`: incluir `js/graficos.js` no laço e exportar `Graficos`.
- `tests/graficos.test.js` (novo): testes dos critérios 1 a 8.
- `README.md`: linha de `js/graficos.js` na "Estrutura do projeto" e item "Gráficos de gastos" em "O que o app faz".
- `CHANGELOG.md` e versão: feitos pelo publicador, não pelo desenvolvedor do item.

## Fora do escopo

- Gráficos de pizza, linha ou evolução ao longo de vários meses; só o período atual contra o anterior.
- Exportar o gráfico como imagem ou incluir na planilha.
- Editar categoria ou loja a partir do gráfico; tocar numa barra para filtrar o extrato (pode virar issue nova).
- Orçamento/meta por categoria e alertas.
- Mudar as categorias existentes (`CATS`) ou como `storeKey` é gravado.
- Qualquer biblioteca externa ou fonte nova.

## Decisões em aberto

1. **Qual é "o período" quando se olha todos os cartões?** Cada cartão tem o seu período.
   - A (recomendada): usar o período de cada cartão com o mesmo deslocamento e somar; o rótulo diz "período de cada cartão". Motivo: o total bate com a soma dos extratos dos cartões, que é o que ela vê em cada um, e respeita o ciclo do benefício.
   - B: mês do calendário para todos. Mais simples de explicar, mas não bate com o "Gastos" de cada cartão.
   - *Com padrão*: seguir A.
2. **Onde aparece o gráfico de "todos".** A: painel na aba Extrato (recomendada: é onde ela já vê totais e o filtro por titular). B: tela nova ou aba nova na barra inferior (muda a navegação). *Com padrão*: seguir A.
3. **Quantas lojas mostrar.** A: 5 e "Outras lojas" (recomendada, cabe em 360 px). B: 10 com rolagem. *Com padrão*: seguir A.
4. **Cores das barras.** A: uma cor só (`--accent`) para categorias e lojas, e `--amber` para destacar a diferença (recomendada: legível nos dois temas e sem depender de distinguir muitas cores). B: uma cor por categoria. *Com padrão*: seguir A.
5. **Sinal da diferença.** "a mais" em `--bad` e "a menos" em `--good` (recomendada), sempre acompanhado do texto e da seta, nunca só pela cor. *Com padrão*.
6. **Titulares quando há só um.** Com um único titular, a visão "Titulares" mostra uma linha só; recomendada: esconder a aba "Titulares" nesse caso. *Com padrão*.

Nenhuma delas cai numa regra de bloqueio do `CLAUDE.md`: nenhuma muda decisão registrada no `DECISOES.md` (dados continuam só no aparelho, sem servidor, sem biblioteca externa).

## Precisa de arquiteto?

Não. Não muda armazenamento, formato de dados, backup, nem contrato entre sistemas. É um módulo novo puro de leitura, no molde de `csv.js`, sobre dados que já existem (`kind`, `amount`, `cat`, `desc`, `storeKey`, `cardId`, `holder`).

## Teste no celular / no PC

Só a Jéssica confere (etiqueta `teste-no-celular`), com os cartões dela:
- Abrir um cartão: ver os três gráficos, passar por ‹ › e conferir que o "Gastos" do painel Período é o mesmo total dos gráficos.
- Aba Extrato: o total dos gráficos é o "Gastos" do período; com filtro de titular, só aquele titular.
- A frase de comparação bate com o que ela espera (ex.: mais gasto em Mercado que no período anterior).
- Tema claro e escuro, em 360 px: nada cortado, barras visíveis e legíveis.
- Botão de olho: valores escondidos nos gráficos.
- Modo avião, com o app instalado: os gráficos continuam aparecendo.
- No PC (preview em 360 px, claro e escuro): conferência visual prévia pelo verificador.
