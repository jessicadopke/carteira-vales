# Ciclo · backlog

> **A partir de 22/10/2026 o andamento fica nas [issues](https://github.com/jessicadopke/ciclo/issues) e no quadro [Meus Apps](https://github.com/users/jessicadopke/projects/1).** Os itens abaixo foram migrados para issues; este arquivo fica como registro e não recebe itens novos.

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
| B-20 | Backup automático no Google Drive (Apps Script) | ✨ | M |
| B-17 | Exportar o extrato em planilha (CSV) | ✨ | P |
| B-18 | Apagar o artefato antigo do Claude | 🔧 | P |
| B-19 | Gráficos de gastos por período | ✨ | M |
| B-21 | Aviso do dia do crédito | ✨ | M |
| B-22 | Recorte automático da foto do cupom | ✨ | M |
| B-06 | Dividir o `app.js` em módulos | 🔧 | G |
| B-23 | Sincronizar com uma Planilha Google (dois celulares) | ✨ | G |

### B-20 · Backup automático no Google Drive (Apps Script)
Hoje o backup é um arquivo baixado no celular, que precisa ser guardado à mão. Se o celular for perdido ou formatado sem backup recente, os dados vão junto. É a primeira etapa para tirar os dados só do celular; a segunda é o B-23.
- **Como:** um Apps Script na conta Google da Jessica, publicado como App da Web ("Executar como: eu"), recebe o backup do app e grava numa pasta "Ciclo – backups" do Drive dela. O app continua rodando no celular; o script só é chamado ao salvar ou restaurar.
- **Configuração (Jessica, uma vez):** criar o script em script.google.com com o código pronto, publicar, autorizar e colar no Ciclo (Ajustes) o link do script. O app gera um código secreto que vai junto em cada envio; o link e o código ficam só no celular, fora do backup.
- **No app:** botões **Salvar no Drive** e **Restaurar do Drive** em Ajustes, com a lista dos backups (data e tamanho). Com o Drive ligado, o app salva sozinho ao ser aberto quando o último backup tiver mais de 7 dias ou houver 30 lançamentos novos, e o lembrete de backup some.
- **Fotos dos cupons:** o backup sem fotos é o padrão (pequeno). Com fotos, só se couber no limite do Apps Script; senão o app avisa.
- **Segurança:** o cofre já vai criptografado no backup. Quem tiver o link e o código secreto lê e grava os backups; por isso eles não saem do celular.
- **Pronto quando:** o backup automático aparecer no Drive e for restaurado noutro navegador com todos os dados.

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

### B-06 · Dividir o `app.js` em módulos
São 2.300 linhas num arquivo só, com um estado global único.
- Separar em módulos ES, sem etapa de montagem: armazenamento, períodos, cofre, cartões, cupom e conferência, pagamento dividido, backup, telas e atualização.
- Nada muda para quem usa. O service worker passa a guardar os arquivos novos.
- Os testes do B-05 (`node --test`) estão prontos e cobrem a leitura e a escolha do cartão; a parte de telas ainda não tem testes.

### B-23 · Sincronizar com uma Planilha Google (dois celulares)
Segunda etapa depois do B-20: os dados passam a ficar também numa Planilha Google da Jessica, sempre atualizada, e outro celular pode usar a mesma carteira.
- **Depende de:** B-20 (o mesmo Apps Script ganha as funções de sincronizar). Recomendado depois do B-06, porque mexe no armazenamento do app inteiro.
- **Cópia no celular continua sendo a principal:** o app grava primeiro no celular (rápido e sem internet) e envia as mudanças ao Apps Script. Sem internet, as mudanças ficam numa fila e são enviadas quando a conexão voltar.
- **Planilha:** uma aba para cartões e outra para lançamentos, uma linha por registro, com data da última mudança. A Planilha é para consultar, filtrar e fazer gráficos; editar à mão não é o caminho (o app pode sobrescrever).
- **Dois celulares:** cada aparelho busca as mudanças do outro ao abrir e de tempos em tempos. Lançamentos feitos ao mesmo tempo nos dois não podem se perder; para o mesmo cartão editado nos dois, vale a mudança mais recente.
- **Cofre:** as senhas continuam criptografadas no celular antes de sair; a Planilha guarda só o texto cifrado, e a senha mestra é a mesma nos dois aparelhos.
- **Fotos dos cupons:** vão como arquivos numa pasta do Drive, ligados ao lançamento, ou continuam só no celular (decidir antes de começar).
- **Pronto quando:** um lançamento feito num celular aparecer no outro e na Planilha, lançamentos feitos offline forem enviados ao voltar a internet, e lançamentos simultâneos nos dois aparelhos não se perderem.

## Ideias

Ainda sem prioridade. Cada uma precisa ser conversada antes de virar item.

- **Atualizar o saldo por print do app do emissor:** compartilhar com o Ciclo o print do extrato do app da VR, Alelo etc., e o Gemini lê o saldo e os últimos lançamentos. Os emissores não têm API para o dono do cartão.
