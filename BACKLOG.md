# Ciclo · backlog

O que falta fazer no app, em ordem de prioridade. Quando um item fica pronto, ele sai daqui e entra no [CHANGELOG](CHANGELOG.md) da versão em que foi publicado.

**Tipos:** 🐞 defeito · 🔧 manutenção (não muda o app para quem usa) · ✨ função nova · 🧪 validação.
**Tamanho:** P (até 1 hora), M (algumas horas), G (um dia ou mais).

*Atualizado em 22/10/2026, versão 1.10.0.*

## Agora

| # | Item | Tipo | Tam. |
|---|------|------|------|
| B-02 | Testar no celular as funções da 1.8.x a 1.10 | 🧪 | P |

### B-02 · Testar no celular as funções da 1.8.x a 1.10
Só a Jessica pode fazer, no celular. O resto foi testado no computador, com o Gemini simulado.
- [ ] "Ler cupom" abre a câmera traseira.
- [x] Gemini lê um cupom real; "Como foi lido" mostra o tempo (21 e 22/10/2026).
- [x] Cupom pago com cartão que não está na carteira: aparece o aviso e "Cadastrar agora" funciona (22/10/2026, cartão Volus; o final veio errado e foi corrigido na 1.10.0).
- [ ] Final do cartão certo num comprovante com número mascarado (1.10.0).
- [ ] Andamento da leitura com o Gemini e lista de modelos em Ajustes (1.10.0).
- [ ] Cadastro de cartão por foto (frente do cartão) e por print do app do emissor.
- [ ] Atualizar pelo app (Ajustes → Sobre o app).
- [ ] Instalar o app na tela inicial pelo Chrome (ainda não foi instalado).

## Próximas

| # | Item | Tipo | Tam. |
|---|------|------|------|
| B-17 | Exportar o extrato em planilha (CSV) | ✨ | P |
| B-18 | Apagar o artefato antigo do Claude | 🔧 | P |
| B-19 | Gráficos de gastos por período | ✨ | M |
| B-20 | Backup direto no Google Drive | ✨ | M |
| B-21 | Aviso do dia do crédito | ✨ | M |
| B-22 | Recorte automático da foto do cupom | ✨ | M |
| B-06 | Dividir o `app.js` em módulos | 🔧 | G |
| B-23 | Usar a carteira em dois celulares | ✨ | G |

### B-17 · Exportar o extrato em planilha (CSV)
Hoje os dados só saem pelo backup (arquivo JSON), que não abre numa planilha.
- Botão **Exportar planilha** no Extrato, que respeita os filtros da tela (cartão, titular, período e busca).
- Colunas: data, loja, categoria, cartão, titular, emissor, tipo (gasto ou crédito), valor, saldo impresso no cupom e forma de pagamento quando a compra foi dividida.
- Formato que o Excel e o Google Planilhas abrem direto: separador `;`, vírgula decimal e acentos em UTF-8 com BOM.
- **Pronto quando:** o arquivo abrir no Excel e no Google Planilhas com as colunas certas e os valores como números.

### B-18 · Apagar o artefato antigo do Claude
A versão antiga do app, feita como artefato do Claude, ficou guardada em `ciclo/_artefato-claude-antigo` e no link do artefato.
- **Depende de:** B-02 (app instalado e em uso no celular).
- Confirmar que nada daquela versão precisa ser recuperado. Então apagar a pasta, e o artefato no claude.ai se a Jessica quiser.
- **Pronto quando:** a pasta e o artefato tiverem sido removidos, com o OK da Jessica.

### B-19 · Gráficos de gastos por período
Hoje o período mostra só totais (saldo no início, créditos, gastos e saldo agora).
- No período de cada cartão, ou de todos: gastos por categoria, as lojas onde mais se gastou e gastos por titular.
- Comparar com o período anterior ("R$ 120 a mais em Mercado").
- Desenhar em SVG no próprio app, sem biblioteca de fora, para continuar funcionando sem internet.
- **Pronto quando:** os gráficos aparecerem no período, nos temas claro e escuro e numa tela de 360 px, com os totais batendo com o extrato.

### B-20 · Backup direto no Google Drive
Hoje o backup é um arquivo baixado no celular, que precisa ser guardado à mão.
- Botão **Salvar no Google Drive** e **Restaurar do Drive** em Ajustes, usando a pasta reservada do app no Drive (o app não vê os outros arquivos).
- Exige criar um projeto no Google Cloud com uma credencial OAuth para o site `jessicadopke.github.io`. Quem cria é a Jessica, com um passo a passo.
- Combinar com o lembrete de backup: com o Drive ligado, o app pode salvar sozinho, por exemplo uma vez por semana, quando for aberto.
- **Pronto quando:** um backup salvo no Drive for restaurado noutro navegador com todos os dados.

### B-21 · Aviso do dia do crédito
Avisar quando o crédito de um cartão estiver previsto.
- **Limite do PWA:** sem um servidor, o app não consegue mandar notificação num horário marcado com segurança. O Chrome do Android oferece uma sincronização periódica para apps instalados, mas ele decide quando roda.
- **Primeira parte:** no Início, destacar os créditos previstos para hoje e para os próximos dias, e pedir para confirmar o valor que entrou.
- **Segunda parte:** testar a notificação pela sincronização periódica no app instalado e ver se o aviso chega a tempo.
- **Pronto quando:** o Início mostrar os créditos do dia e, se a notificação for confiável, ela chegar no dia do crédito.

### B-22 · Recorte automático da foto do cupom
Foto torta ou com fundo atrapalha principalmente o leitor do celular (sem o Gemini).
- Detectar as bordas do papel, endireitar e recortar a foto antes de ler, no próprio celular.
- Mostrar o recorte para a pessoa ajustar os cantos, se precisar.
- Medir com os cupons de `tests/`: quantos campos o leitor acerta com e sem o recorte.
- **Pronto quando:** o recorte melhorar a leitura nos cupons de teste sem deixar a leitura mais lenta que ~2 s num celular comum.

### B-23 · Usar a carteira em dois celulares
Hoje tudo foi pensado para um celular só, e os dados ficam nele.
- **Depende de:** B-20 (Google Drive).
- Guardar a carteira no Drive e juntar as mudanças feitas em celulares diferentes, sem perder lançamentos quando os dois mexerem ao mesmo tempo.
- O cofre de senhas continua criptografado, com a mesma senha mestra nos dois aparelhos.
- **Pronto quando:** um lançamento feito num celular aparecer no outro, e lançamentos feitos ao mesmo tempo nos dois não se perderem.

### B-06 · Dividir o `app.js` em módulos
São 2.300 linhas num arquivo só, com um estado global único.
- Separar em módulos ES, sem etapa de montagem: armazenamento, períodos, cofre, cartões, cupom e conferência, pagamento dividido, backup, telas e atualização.
- Nada muda para quem usa. O service worker passa a guardar os arquivos novos.
- Os testes do B-05 (`node --test`) estão prontos e cobrem a leitura e a escolha do cartão; a parte de telas ainda não tem testes.

## Ideias

Ainda sem prioridade. Cada uma precisa ser conversada antes de virar item.

- **Atualizar o saldo por print do app do emissor:** compartilhar com o Ciclo o print do extrato do app da VR, Alelo etc., e o Gemini lê o saldo e os últimos lançamentos. Os emissores não têm API para o dono do cartão.
