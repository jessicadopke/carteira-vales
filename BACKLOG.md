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
| B-06 | Dividir o `app.js` em módulos | 🔧 | G |

### B-06 · Dividir o `app.js` em módulos
São 2.300 linhas num arquivo só, com um estado global único.
- Separar em módulos ES, sem etapa de montagem: armazenamento, períodos, cofre, cartões, cupom e conferência, pagamento dividido, backup, telas e atualização.
- Nada muda para quem usa. O service worker passa a guardar os arquivos novos.
- Os testes do B-05 (`node --test`) estão prontos e cobrem a leitura e a escolha do cartão; a parte de telas ainda não tem testes.

## Ideias

Ainda sem prioridade. Cada uma precisa ser conversada antes de virar item.

- **Recorte automático do cupom:** detectar as bordas do papel e endireitar a foto antes de ler, para o leitor do celular errar menos.
- **Notificação do dia do crédito:** avisar no celular quando o crédito de um cartão estiver previsto. Depende de o app estar instalado e de permissão de notificações.
- **Gráficos por período:** gastos por categoria, por loja e por titular em cada ciclo de crédito.
- **Exportar o extrato em planilha (CSV)**, com filtro por cartão, titular e período.
- **Backup direto no Google Drive**, em vez de baixar o arquivo e subir à mão.
- **Uso em dois celulares:** sincronizar a carteira entre aparelhos, por exemplo pelo Drive. É grande, porque hoje tudo foi pensado para um celular só.
- **Apagar o artefato antigo** (`ciclo/_artefato-claude-antigo`) quando o app estiver instalado e em uso no celular.
