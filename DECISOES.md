# Ciclo · decisões

Decisões já tomadas sobre o app. Agentes: não mude nenhuma delas sem a Jéssica (é bloqueio, veja o `CLAUDE.md`). Decisões novas entram no fim, com data e issue.

| Data | Decisão | Motivo |
|---|---|---|
| até 10/2026 | Só Android (Chrome). | É onde a família usa. |
| até 10/2026 | App instalável (PWA) publicado no GitHub Pages, não artefato do Claude. | Funciona offline, vira ícone, não depende do Claude. |
| até 10/2026 | Dados só no aparelho (IndexedDB) + backup em arquivo. Sem servidor próprio. | Privacidade e custo zero. |
| até 10/2026 | Leitura de cupom no próprio aparelho (Tesseract) é o padrão; Gemini é opcional, com a chave da Jéssica guardada só no celular e fora do backup. | Funciona sem internet e sem mandar fotos ao Google por padrão. |
| até 10/2026 | Visual limpo e profissional, com transições. | Pedido da Jéssica. |
| 19/10/2026 | Nome **Ciclo** ("do crédito ao próximo crédito"). Identidade: petróleo `#0e4f5c`, menta `#7fe0d0`, âmbar `#ffb547` (dia do crédito), fonte Outfit embutida, símbolo de anel aberto com ponto âmbar. | Escolha da Jéssica. |
| 19/10/2026 | Versionamento semântico, CHANGELOG e release no GitHub a cada versão; o app avisa versão nova comparando com `version.json`. | Pedido da Jéssica. |
| 20/10/2026 | Cadastro de cartão por foto guarda só os 4 últimos dígitos e não guarda a imagem. | Segurança. |
| 22/10/2026 | O repositório é público: nenhum final de cartão, saldo ou cupom real em arquivo versionado. | Um commit chegou a ter um final real e foi corrigido. |
| 22/10/2026 | Andamento pelas issues e pelo quadro "Meus Apps"; agentes trabalham sozinhos e só param nos bloqueios do `CLAUDE.md`; publicar em `main` só com o merge da Jéssica. | Automatizar sem perder o controle do que chega ao celular. |
| 23/10/2026 (#2) | Backup no Drive por Apps Script publicado como App da Web com acesso "Qualquer pessoa", protegido por código secreto longo gerado pelo app. "Somente eu" não funciona com `fetch` sem login. | Único jeito de o celular gravar no Drive dela sem servidor próprio. |
| 23/10/2026 (#2) | O backup no Drive é uma exceção opcional a "dados só no aparelho": só sai do celular se ela ligar, e vai para o Drive dela. | Proteção contra perda ou formatação do celular. |
| 23/10/2026 (#2) | Drive guarda os 30 backups mais novos; salva sozinho a cada 7 dias ou 30 lançamentos novos; limite de 20 MB por envio; backup do Drive sem fotos por padrão. | Não encher o Drive e ficar dentro do limite do Apps Script. |
| 23/10/2026 (#2) | Código secreto vai no corpo do POST e é comparado direto no script, sem hash. Link e código ficam só no celular, fora do backup. | O código do script é a única cópia além do celular. |
| 23/10/2026 (#5) | Gráficos de gastos: em "todos os cartões" (aba Extrato) vale o período de cada cartão com o mesmo deslocamento, somados; painel na aba Extrato (sem aba nova); 5 lojas + "Outras lojas"; barras numa cor só (`--accent`), diferença em `--bad`/`--good` sempre com texto e seta; aba "Titulares" só aparece com 2 ou mais titulares. | Total bate com o "Gastos" de cada cartão e cabe em 360 px. |
