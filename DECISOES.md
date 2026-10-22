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
