# Ciclo · backlog

O que falta fazer no app, em ordem de prioridade. Quando um item fica pronto, ele sai daqui e entra no [CHANGELOG](CHANGELOG.md) da versão em que foi publicado.

**Tipos:** 🐞 defeito · 🔧 manutenção (não muda o app para quem usa) · ✨ função nova · 🧪 validação.
**Tamanho:** P (até 1 hora), M (algumas horas), G (um dia ou mais).

*Atualizado em 21/10/2026, versão 1.8.4.*

## Agora

| # | Item | Tipo | Tam. |
|---|------|------|------|
| B-01 | Descobrir por que o Gemini não foi usado no celular | 🐞 | P |
| B-02 | Testar no celular as funções da 1.8.x | 🧪 | P |
| B-03 | Ler o final do cartão no formato `************4321` | 🐞 | P |
| B-04 | Pôr o código no git e publicar por `git push` | 🔧 | M |

### B-01 · Descobrir por que o Gemini não foi usado no celular
Na 1.8.2, a leitura demorou e no fim o app usou o leitor do celular. A 1.8.3 mostra **Como foi lido** na conferência, com cada tentativa do Gemini (modelo, erro e tempo).
- **Causa (21/10/2026):** "Como foi lido" mostrou `gemini-flash-latest: tempo esgotado (30,6 s)`. O modelo da geração 3 ainda pensava com `thinkingLevel: low`, e no tempo esgotado o app não tentava outro modelo.
- **Correção na 1.8.4:** raciocínio `minimal` e um modelo de reserva em paralelo depois de 12 s.
- **Próximo passo:** ler um cupom na 1.8.4 e conferir o tempo em "Como foi lido".
- **Pronto quando:** a causa for conhecida e corrigida, ou explicada na tela do Gemini (por exemplo, sugerir outro modelo ou o faturamento).

### B-02 · Testar no celular as funções da 1.8.x
Até agora, tudo foi testado no computador, com o Gemini simulado e fotos geradas.
- [ ] "Ler cupom" abre a câmera traseira.
- [ ] Gemini lê um cupom real; "Como foi lido" mostra o tempo.
- [ ] Cupom pago com cartão que não está na carteira: aparece o aviso e "Cadastrar agora" funciona.
- [ ] Cadastro de cartão por foto (frente do cartão) e por print do app do emissor.
- [ ] Atualizar pelo app (Ajustes → Sobre o app).
- [ ] Instalar o app na tela inicial pelo Chrome (ainda não foi instalado).

### B-03 · Ler o final do cartão no formato `************4321`
No teste da 1.8.2, o leitor do celular não achou o final num comprovante com `CARTAO ************4321`. Sem o final, o app identifica o cartão só pelo saldo ou pelo emissor.
- **Pronto quando:** os formatos comuns de comprovante TEF forem reconhecidos, entre eles `************4321`, `**** **** **** 4321`, `XXXX4321` e `FINAL 4321`, mesmo com os erros típicos do OCR (`*` lido como `x` ou `+`).

### B-04 · Pôr o código no git e publicar por `git push`
Hoje a pasta local não tem git, e as versões sobem arquivo por arquivo pela página de upload do GitHub. Na 1.8.2, um envio não entrou e a release ficou apontando para o código incompleto.
- Iniciar o git na pasta `ciclo/app`, ligar ao repositório `jessicadopke/ciclo` e trazer o histórico de lá.
- Fazer o login do GitHub no terminal uma vez (quem faz é a Jessica).
- Atualizar a seção "Versões" do README com o passo a passo novo.
- **Pronto quando:** uma versão for publicada só com `git push` e a release criada a partir da tag.

## Próximas

| # | Item | Tipo | Tam. |
|---|------|------|------|
| B-05 | Testes automáticos da leitura de cupom | 🔧 | M |
| B-06 | Dividir o `app.js` em módulos | 🔧 | G |
| B-07 | Lista de emissores num lugar só | 🔧 | P |
| B-08 | Corrigir a release v1.8.2 | 🔧 | P |
| B-09 | Atualizar a descrição do repositório | 🔧 | P |
| B-10 | Mostrar o andamento da leitura com o Gemini | ✨ | P |
| B-11 | Escolher o modelo do Gemini por uma lista | ✨ | P |
| B-12 | Lembrete de backup | ✨ | P |

### B-05 · Testes automáticos da leitura de cupom
Hoje cada versão é testada à mão. Foi assim que a falha do aviso de cartão novo passou na 1.8.0.
- Separar em funções testáveis o que hoje fica dentro da tela de conferência: escolha do cartão provável (`rankCards`) e detecção de cartão novo.
- Juntar textos de cupons reais, anonimizados, com o resultado esperado para cada um: valor, saldo, emissor, final e formas de pagamento.
- Juntar respostas do Gemini salvas, para testar `toParsed` sem chamar o Google.
- Rodar com Node (`node --test`), sem instalar dependências.
- **Pronto quando:** os testes rodarem com um comando e cobrirem os casos dos defeitos já corrigidos (vários vales, cartão novo pelo final e pelo saldo, saldo antes ou depois da compra).

### B-06 · Dividir o `app.js` em módulos
São 2.300 linhas num arquivo só, com um estado global único.
- Separar em módulos ES, sem etapa de montagem: armazenamento, períodos, cofre, cartões, cupom e conferência, pagamento dividido, backup, telas e atualização.
- Nada muda para quem usa. O service worker passa a guardar os arquivos novos.
- **Depende de:** B-05, para mudar com segurança.

### B-07 · Lista de emissores num lugar só
Os nomes dos emissores (VR, Alelo, Pluxee, Ticket…) e as regras para reconhecê-los estão repetidos em `app.js`, `receipt.js` e `gemini.js`. Um emissor novo precisa entrar nos três.

### B-08 · Corrigir a release v1.8.2
A tag aponta para o commit dos arquivos `js`, um commit antes de `version.json`, `sw.js` e CHANGELOG.
- **Opção 1:** apagar a release e a tag v1.8.2 no GitHub e recriar no commit certo. A exclusão foi bloqueada para o Claude, então quem apaga é a Jessica.
- **Opção 2:** deixar como está e registrar a observação nas notas da release.

### B-09 · Atualizar a descrição do repositório
A descrição ainda fala só em "leitura de cupom fiscal no celular". Incluir a leitura com o Gemini e o cadastro de cartão por foto.

### B-10 · Mostrar o andamento da leitura com o Gemini
Com o Gemini, a tela mostra só "Lendo com o Gemini…", sem barra de progresso. Mostrar o modelo da tentativa atual e o tempo decorrido. Ao trocar de modelo, avisar (por exemplo, "gemini-flash-latest sem cota, tentando gemini-2.5-flash…").

### B-11 · Escolher o modelo do Gemini por uma lista
Hoje o modelo é um campo de texto em "Avançado". Trocar por uma lista dos modelos que a chave pode usar, buscada no Google pela mesma chamada do "Testar e salvar". Mostrar qual modelo leu os últimos cupons e quantos erros de cota houve.

### B-12 · Lembrete de backup
Os dados ficam só no celular. Avisar no Início quando o último backup tiver mais de 30 dias ou quando houver muitos lançamentos novos desde ele. O app já guarda a data do último backup.

## Ideias

Ainda sem prioridade. Cada uma precisa ser conversada antes de virar item.

- **Recorte automático do cupom:** detectar as bordas do papel e endireitar a foto antes de ler, para o leitor do celular errar menos.
- **Notificação do dia do crédito:** avisar no celular quando o crédito de um cartão estiver previsto. Depende de o app estar instalado e de permissão de notificações.
- **Gráficos por período:** gastos por categoria, por loja e por titular em cada ciclo de crédito.
- **Exportar o extrato em planilha (CSV)**, com filtro por cartão, titular e período.
- **Backup direto no Google Drive**, em vez de baixar o arquivo e subir à mão.
- **Uso em dois celulares:** sincronizar a carteira entre aparelhos, por exemplo pelo Drive. É grande, porque hoje tudo foi pensado para um celular só.
- **Revisão de acessibilidade:** contraste, tamanho das áreas de toque e leitor de tela.
- **Apagar o artefato antigo** (`ciclo/_artefato-claude-antigo`) quando o app estiver instalado e em uso no celular.
