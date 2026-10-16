# Histórico de versões

O app segue o Versionamento Semântico (`MAJOR.MINOR.PATCH`):

- **MAJOR:** mudança que quebra a compatibilidade, por exemplo um formato de backup antigo que deixa de abrir.
- **MINOR:** função nova, compatível com os dados e backups já existentes.
- **PATCH:** só correção ou ajuste pequeno.

A versão em uso aparece em **Mais**, no rodapé.

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
