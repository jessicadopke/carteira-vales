# Ciclo

*Do crédito ao próximo crédito.*

Ciclo controla o saldo dos cartões de vale-alimentação, vale-refeição e multibenefício da família (VR, Alelo, Pluxee, Ticket, Flash, Caju e outros). É um app web instalável (PWA) para Android: abre pelo navegador, vira ícone na tela inicial e funciona sem internet.

**Abrir o app:** https://jessicadopke.github.io/ciclo/

## O que o app faz

- **Cartões de várias pessoas:** cada cartão tem titular, emissor e final. A tela inicial tem filtro por pessoa e, com muitos cartões, lista compacta com busca e grupos por titular.
- **Cadastro por foto:** uma foto da frente do cartão ou um print do app do emissor preenche emissor, tipo, titular, final e saldo. O app guarda só os 4 últimos dígitos e não guarda a imagem.
- **Cartão novo no cupom:** se o cupom foi pago com um cartão que não está na carteira, o app avisa e deixa cadastrar na hora, já com o saldo certo.
- **Crédito fixo ou variável:**
  - O valor e o dia do crédito podem ser fixos ou variar.
  - Cada período vai de um crédito até o seguinte.
  - O app mostra quanto dá para gastar por dia útil até o próximo crédito e avisa quando o crédito previsto ainda não foi registrado.
- **Cupom fiscal por foto:**
  - Por padrão, o texto é lido no próprio celular, sem internet (Tesseract).
  - Opcionalmente, a leitura pode ser feita pelo Gemini (veja abaixo), que acerta mais em cupom apagado.
  - O app encontra o valor pago, o saldo impresso, a data, a loja, o emissor e o final do cartão.
  - O cartão que pagou é identificado pelo final, pelo saldo impresso ou pela loja onde ele já foi usado.
- **Pagamento dividido:** uma compra pode usar vários vales e também crédito, débito, Pix ou dinheiro.
- **Extrato:** com busca e com os totais de gastos e créditos.
- **Cofre de senhas:** a senha do cartão e o login do app do emissor ficam criptografados (AES-256-GCM, chave derivada da senha mestra com PBKDF2). O cofre tranca sozinho.
- **Privacidade:** o botão de olho esconde os valores. O tema pode ser automático, claro ou escuro.
- **Backup e restauração:** por arquivo. As senhas continuam criptografadas dentro dele.

## Onde ficam os dados

Tudo fica **só no celular** (IndexedDB do navegador): cartões, extratos, fotos e senhas. Este site entrega apenas o programa, e nenhum dado pessoal passa por aqui. A única exceção é a leitura com o Gemini, se você ligar: aí as fotos de cupons e cartões vão para o Google. Por isso:

- **Faça backup** em **Ajustes → Fazer backup** e guarde o arquivo, por exemplo no Google Drive.
- Para trocar de celular, restaure o backup em **Ajustes → Restaurar backup**.
- Se esquecer a senha mestra do cofre, as senhas guardadas não podem ser recuperadas.

### Leitura com o Gemini (opcional)

1. Em https://aistudio.google.com/apikey, crie uma chave de API (o plano gratuito basta).
2. No app, abra **Ajustes → Leitura de fotos → Gemini**, cole a chave, marque "Usar o Gemini" e toque em **Testar e salvar**.
3. Recomendado: no Google Cloud Console (APIs e serviços → Credenciais), restrinja a chave a **sites** com o endereço `https://jessicadopke.github.io/*`. Assim, se a chave vazar, ela não funciona em outros sites.

Com o Gemini ligado, **a foto do cupom é enviada ao Google**. No plano gratuito, o Google pode usar esse conteúdo para melhorar os produtos dele; com o faturamento ativado no AI Studio, não. A chave fica só no celular e não entra no backup. Sem internet ou se o Gemini falhar, o app lê a foto no próprio celular.

## Instalar no Android

1. Abra https://jessicadopke.github.io/ciclo/ no **Chrome**.
2. Toque em **Instalar** no topo do app, ou no menu ⋮ do Chrome → **Instalar app**.
3. Abra uma vez com internet. Depois disso funciona offline, inclusive a leitura de cupons.

Tocando e segurando o ícone aparecem os atalhos **Ler cupom** e **Lançar gasto**.

## Dicas para a foto do cupom

- Fotografe o cupom reto, inteiro e com boa luz.
- Sempre confira o valor e o saldo com o papel antes de salvar.
- Em "Ver texto lido da foto" você vê o que o app conseguiu ler.
- As fotos são guardadas reduzidas e em tons de cinza. Em **Ajustes → Fotos dos cupons** dá para apagar as antigas sem perder os lançamentos.

## Estrutura do projeto

O app é HTML, CSS e JavaScript puros, sem etapa de build. O que está neste repositório é exatamente o que o GitHub Pages publica.

```
index.html            página do app
styles.css            visual (identidade Ciclo, temas claro e escuro)
manifest.webmanifest  nome, ícones e cores do app instalado
sw.js                 service worker: guarda o app para uso offline
js/app.js             telas, cartões, períodos, cofre, backup
js/receipt.js         leitura do cupom no celular (OCR) e interpretação do texto
js/gemini.js          leitura de cupons e cartões pelo Gemini (opcional)
js/issuers.js         emissores de cartão (nome, cor, sigla e como reconhecer): um emissor novo entra só aqui
js/match.js           qual cartão pagou o cupom e aviso de cartão que não está na carteira
tests/                testes automáticos da leitura de cupons e da escolha do cartão
fonts/                fonte Outfit, embutida
icons/                ícones do app (inclui a versão "maskable" do Android)
vendor/tesseract/     Tesseract.js 5.1.1 e o modelo de português, embutidos
CHANGELOG.md          histórico de versões
version.json          versão publicada (usada pelo aviso de atualização)
```

## Versões

O projeto segue o Versionamento Semântico (`MAJOR.MINOR.PATCH`). As mudanças de cada versão estão no [CHANGELOG](CHANGELOG.md), e a versão em uso aparece no rodapé de **Ajustes**.

Para publicar uma versão nova:

1. Atualize `APP_VERSION` em `js/app.js`, `VERSION` em `sw.js` e o número em `version.json`. Arquivo novo em `js/` também entra na lista `FILES` do `sw.js`.
2. Escreva a entrada nova no `CHANGELOG.md`.
3. Rode os testes (`node --test`, veja abaixo). Todos precisam passar.
4. Faça o commit e envie com a tag da versão:

   ```
   git commit -am "X.Y.Z: resumo"
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```

   O GitHub Pages publica em 1 ou 2 minutos.
5. Crie a *release* no GitHub a partir da tag `vX.Y.Z`, com as notas do CHANGELOG.

O login do GitHub no terminal é feito uma vez no computador (o Windows guarda a credencial).

No celular, o app compara a versão instalada com o `version.json` publicado. Quando há versão nova, ele avisa no Início ("A versão X está disponível · Atualizar"). Também dá para conferir em **Ajustes → Sobre o app → Buscar atualização**.

## Testes automáticos

Com o Node.js 18 ou mais novo, nesta pasta:

```
node --test
```

Os testes ficam em `tests/` e não precisam de instalação. Eles cobrem a leitura de cupons pelo leitor do celular (`tests/cupons/`, textos de cupons reais anonimizados), a conversão das respostas do Gemini (`tests/gemini/`, respostas salvas, sem chamar o Google) e a escolha do cartão. Quando um defeito de leitura for corrigido, acrescente o cupom ou a resposta que o mostrou.

## Testar no computador

Nesta pasta, rode:

```
python -m http.server 8765
```

Depois abra http://localhost:8765 no Chrome. O cofre e a instalação só funcionam em `localhost` ou em https.

## Créditos

- Leitura de texto: [Tesseract.js](https://github.com/naptha/tesseract.js) (licença Apache 2.0).
- Fonte: [Outfit](https://fonts.google.com/specimen/Outfit) (SIL Open Font License).
