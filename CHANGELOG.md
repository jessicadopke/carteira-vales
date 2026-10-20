# Ciclo · histórico de versões

*Do crédito ao próximo crédito.* Até a versão 1.3.0 o app se chamava "Carteira de Vales".

O app segue o Versionamento Semântico (`MAJOR.MINOR.PATCH`):

- **MAJOR:** mudança que quebra a compatibilidade, por exemplo um formato de backup antigo que deixa de abrir.
- **MINOR:** função nova, compatível com os dados e backups já existentes.
- **PATCH:** só correção ou ajuste pequeno.

A versão em uso aparece em **Ajustes**, no rodapé.

## 1.7.0 — 20/10/2026

### Novo
- **Atualizar o app pelo próprio app:**
  - Em **Ajustes → Sobre o app**, o botão **Buscar atualização** mostra a versão instalada e verifica se há uma mais nova.
  - Quando há, aparece **Atualizar para a versão X**, que baixa a versão nova e reinicia o app.
- **Aviso automático:** ao abrir o app com internet (e de novo quando você volta a ele depois de algumas horas), o Início mostra "A versão X do Ciclo está disponível", com o botão **Atualizar**.
- **Recarregar o app:** baixa de novo todos os arquivos, para quando algo parecer desatualizado.
- Atualizar ou recarregar **não mexe** em cartões, extratos, fotos e senhas. Só a cópia offline do programa é trocada.
- Novo arquivo `version.json` na raiz do site, com a versão publicada.

## 1.6.2 — 20/10/2026

### Corrigido
- **Chave do Gemini recusada sem motivo:** ao colar uma chave válida, o app podia dizer "Essa chave não parece válida". A checagem de formato feita no próprio app era rígida demais e foi removida.
  - O app agora limpa sozinho o que costuma vir junto ao copiar: espaços, quebras de linha, aspas, caracteres invisíveis e um `GEMINI_API_KEY=` na frente.
  - Quem decide se a chave vale é o Google, no "Testar e salvar". Se ela estiver errada, aparece a mensagem dele.

## 1.6.1 — 20/10/2026

### Mudou
- **"Ler cupom" abre a câmera direto:** antes abria a galeria do celular. Agora vai para a câmera traseira, para fotografar o cupom na hora.
- **Foto já tirada:** para ler um cupom que já está na galeria, use o link "Ler cupom de uma foto da galeria", que aparece no botão **+** e na tela do cartão. Pela galeria dá para escolher várias fotos de uma vez.

## 1.6.0 — 20/10/2026

### Novo
- **Leitura de cupons com o Gemini (opcional):** em Ajustes → Leitura de cupons → Gemini, você cola uma chave de API do Google AI Studio e liga a função.
  - A foto vai para o Gemini, que devolve loja, CNPJ, data, total e cada forma de pagamento. Para cada vale, vêm também o emissor, o final do cartão e o saldo impresso.
  - Costuma acertar mais que o leitor do celular, principalmente em cupom térmico apagado.
  - **Reserva automática:** sem internet, com a chave recusada ou com o limite de uso atingido, o app avisa e lê a foto no próprio celular, como antes.
  - "Testar e salvar" confere a chave antes de guardar. O teste não gasta cota de leitura.
  - A tela de conferência mostra "Lido pelo Gemini" ou "Lido no celular". Em "Ver resposta do Gemini" dá para ver exatamente o que foi lido.

### Corrigido
- Numa compra paga com vários vales, o final do cartão impresso no comprovante de um vale podia fazer o app sugerir esse cartão também para os outros. Agora cada vale usa só as pistas dele.

### Privacidade
- Com o Gemini ligado, a foto do cupom sai do celular e vai para o Google. No plano gratuito, o Google pode usar o que é enviado para melhorar os produtos dele. Ativar o faturamento no AI Studio impede esse uso.
- A chave fica guardada só no celular, não entra no backup e é enviada ao Google no cabeçalho da requisição, nunca no endereço.
- Com o Gemini desligado (o padrão), nada muda: tudo continua só no celular.

## 1.5.0 — 16/10/2026

### Novo
- **Tema:** em Ajustes → Aparência → Tema dá para escolher Automático (segue o celular), Claro ou Escuro. A escolha vale para este celular e é aplicada antes de a tela aparecer, sem piscar.
- **README** no repositório, com o que o app faz, como instalar e como publicar uma versão nova.

### Mudou
- **Tudo passa a se chamar Ciclo:**
  - repositório `jessicadopke/ciclo`;
  - endereço https://jessicadopke.github.io/ciclo/;
  - banco de dados interno `ciclo`;
  - backups marcados como `ciclo`.
- **O endereço antigo** (`/carteira-vales/`) deixa de funcionar.

### Compatibilidade
- Se o banco antigo (`carteira-vales`) existir no celular, os dados são copiados para o novo na primeira abertura, e o app avisa "Seus dados foram trazidos da versão anterior".
- Backups feitos em versões anteriores continuam podendo ser restaurados.

### Removido
- Arquivos que sobraram no repositório: a fonte antiga (Plus Jakarta Sans) e os arquivos vazios usados para criar pastas.

## 1.4.0 — 16/10/2026

### Novo
- **Identidade visual "Ciclo":** o app passa a se chamar Ciclo, com a frase "do crédito ao próximo crédito".
  - **Símbolo:** um anel aberto (o período entre dois créditos) com um ponto âmbar marcando o dia em que o crédito cai.
  - **Cores:** petróleo como cor da marca, menta para os realces e âmbar como destaque pontual. No modo escuro, a menta vira a cor principal.
  - **Fonte:** Outfit, embutida no app (funciona offline).
  - **Ícone:** novo, também na versão para o recorte redondo do Android. A tela de abertura do app instalado fica em petróleo.
  - **Cartão de saldo:** ganha o anel e o ponto âmbar do símbolo.
- Os backups novos se chamam `ciclo-backup-AAAA-MM-DD.json`.

### Compatibilidade
- Os dados guardados no celular e os backups feitos nas versões anteriores continuam funcionando sem nenhuma ação.
- O endereço do app continua o mesmo.
- Num celular com o app já instalado, o ícone e o nome novos podem levar alguns dias para aparecer na tela inicial. Isso depende do Android. Desinstalar e instalar de novo resolve na hora, mas faça um backup antes.

## 1.3.0 — 16/10/2026

### Novo
- **Visual novo:** a fonte Plus Jakarta Sans vem embutida e funciona offline. As cores são neutras, com verde só como destaque, e os modos claro e escuro foram revisados.
- **Cartão de saldo:** no topo da tela inicial, com o total, os gastos do mês e os créditos recebidos.
- **Barra de abas embaixo:** Início, Extrato, Cofre e Ajustes, com um botão central **+** para lançar gasto, ler cupom, registrar crédito ou cadastrar cartão.
- **Aba Extrato:** todos os lançamentos, com busca por loja, categoria, cartão, titular, valor ou data, e o total de gastos e créditos do resultado.
- **Aba Cofre:** mostra o estado do cofre e quais cartões têm senhas guardadas.
- **Aba Ajustes:** backup, restauração, fotos, aparência, troca da senha mestra e versão. Substitui o antigo botão "Mais".
- **Esconder valores:** o botão de olho no topo desfoca todos os saldos e valores, para usar o app em público.
- **Transições:** troca de tela animada, janelas que sobem e descem com efeito de mola, resposta ao toque nos botões e entrada suave das listas. Quem desativa as animações no Android não vê os efeitos.
- **Cartões grandes:** degradê na cor do emissor, a mesma da sigla na lista.
- **Tela do cartão:** atalhos para Gasto, Ler cupom, Crédito e Corrigir.

### Corrigido
- O botão "Cancelar" das janelas deixava uma entrada sobrando no histórico, e o "voltar" do Android precisava ser tocado duas vezes.

## 1.2.0 — 16/10/2026

### Novo
- **Crédito com valor ou dia variáveis:** no cadastro do cartão, o valor do crédito pode ser "fixo" ou "varia", e o dia pode ser "fixo", "varia" ou "não controlar".
  - Com valor variável, o aviso de crédito pede o valor, já preenchido com o último recebido.
  - Com dia variável, cada período vai de um crédito registrado até o seguinte. O próximo crédito é previsto pela média de dias entre os créditos anteriores e aparece marcado como previsão.
- **Divisão do pagamento:** uma compra pode ser paga com vários vales e também com cartão de crédito, cartão de débito, Pix ou dinheiro.
  - Cada vale vira um lançamento, ligado aos outros como "parte de uma compra de R$ X".
  - As outras formas ficam registradas, mas não mexem no saldo dos vales.
  - A tela mostra quanto falta para fechar o total e o saldo de cada vale depois da compra.
- **Leitor de cupom:** lê todas as linhas de "Forma de pagamento" da NFC-e e preenche a divisão. Com vários comprovantes de vale na mesma foto, usa todos os saldos e finais impressos para identificar cada cartão.
- **Cupom sem saldo impresso:** a revisão mostra o saldo que o cartão terá depois de descontar o valor pago.
- **"Adicionar crédito"** tem a opção "é o crédito do benefício", que começa um novo período. Desmarque para estornos e devoluções.
- Número da versão no rodapé de **Mais**.

### Corrigido
- Não dá mais para voltar a períodos anteriores ao primeiro lançamento do cartão.
- A foto de um cupom usado por mais de um vale só é apagada quando todas as partes da compra são apagadas.

## 1.1.0 — 16/10/2026

### Novo
- Lista compacta de cartões, com busca e grupos por titular (pensada para 30 ou mais cartões).
- Aviso único para registrar vários créditos de uma vez.
- Seletor de cartão com busca e sugestões.
- Identificação do cartão no cupom pelo saldo impresso e pela loja onde o cartão já foi usado (CNPJ).
- Fotos de cupom menores (tons de cinza, cerca de 100 KB) e opção de apagar fotos antigas.

### Corrigido
- O app não trava mais quando fica aberto em duas abas ao mesmo tempo.

## 1.0.0 — 16/10/2026

- Primeira versão publicada: cartões de vários titulares, períodos pelo dia do crédito, leitura de cupom fiscal no próprio celular, cofre de senhas criptografado e backup.
