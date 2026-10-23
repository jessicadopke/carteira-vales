---
name: leitura-gemini
description: Padrão calibrado de leitura de imagens com o Gemini nos apps da Jéssica (Ciclo em JS no navegador, Radar em Python) — modelos e reservas, espera e troca em 429/503/404, resposta em JSON com esquema fixo, raciocínio mínimo, limites de tempo, chave e privacidade, e como testar sem chamar o Google. Use em qualquer tarefa que mexa em js/gemini.js (Ciclo), radar/leitor_gemini.py (Radar), no prompt ou esquema de leitura, nos modelos do Gemini ou nos gabaritos de leitura.
---

# Leitura com o Gemini

Esta integração foi ajustada com testes reais (Radar: 39/39 nos gabaritos; Ciclo: cupons e cartões reais). Mude só o necessário e prove com os testes que já existem.

## Onde está

| App | Código | Configuração | Testes (sem chamar o Google) |
|---|---|---|---|
| Ciclo | `js/gemini.js` (navegador) | modelo escolhido em Ajustes; `DEFAULT_MODEL` e `FALLBACK_MODELS` no código | `tests/gemini/` (respostas salvas) + `node --test` |
| Radar | `radar/leitor_gemini.py` | `config.yaml` → `gemini.modelo`, `modelos_reserva`, `pausa_segundos`; chave no `.env` | `testes/unit` com respostas simuladas; `python -m radar avaliar` (gabaritos, **só no PC**, usa a chave real) |

## Regras que não mudam

- **API REST direta** (`generativelanguage.googleapis.com/v1beta/models/<modelo>:generateContent`), chave no cabeçalho `x-goog-api-key`. Sem SDK.
- **Chave:** plano gratuito do Google AI Studio da Jéssica. No Ciclo fica só no celular, fora do backup; no Radar, só no `.env` do PC. **Nunca** em arquivo versionado, log, teste ou issue. Agente na nuvem não tem a chave e não chama o Gemini de verdade.
- **Resposta sempre em JSON com esquema fixo:** `generationConfig` com `temperature: 0`, `responseMimeType: "application/json"` e `responseSchema`. Campo novo entra no esquema (com `nullable` quando puder faltar) e no prompt, e o código que lê trata a ausência.
- **Modelos com nome "-latest"** (`gemini-flash-latest`, reserva `gemini-flash-lite-latest`): nomes fixos de versão saem do ar (o `gemini-2.5-flash` passou a dar 404 em 22/10/2026). Não troque por versão fixa.
- **Erros:**
  - `429`, `500`, `503` (sem cota, sobrecarregado): o Radar espera 20 s e repete uma vez no mesmo modelo, depois passa para o reserva; o Ciclo passa logo para o reserva.
  - `404` (modelo não existe mais): passa para o reserva e não tenta esse modelo de novo.
  - Outros erros não trocam de modelo: viram erro registrado.
  - Uma imagem com erro nunca interrompe as outras (Radar) nem trava a tela (Ciclo: cai para o leitor do celular, Tesseract).
- **Ciclo (pessoa esperando com o celular na mão):** raciocínio mínimo (`thinkingLevel: "minimal"` nos Flash, `"low"` nos Pro; `thinkingBudget: 0` no 2.5), foto reduzida (~1600 px), reserva começa em paralelo se o principal não responder em ~12 s, **limite total de 30 s**, e a tela mostra o andamento e "Como foi lido" (modelos, tentativas, tempos).
- **Radar (lote agendado):** pausa entre imagens (`pausa_segundos`, plano gratuito tem limite por minuto), tempo por chamada de até 180 s; registra o modelo que leu cada imagem.
- **Datas:** o prompt informa a data de hoje e o ano a usar quando a imagem mostra só dia/mês; o Radar ainda corrige validade implausível (`normalizar.validade_plausivel`). Não remova isso: o modelo erra o ano.
- **Privacidade:** com o Gemini, a imagem vai ao Google (plano gratuito pode usar para treino). O Ciclo avisa isso em Ajustes; não envie nada além da imagem e do texto necessário.

## Mudando o prompt ou o esquema

1. Escreva primeiro o caso que falha como teste (resposta salva em `tests/gemini/` no Ciclo; resposta simulada em `testes/unit` no Radar).
2. Ajuste prompt/esquema e o código que interpreta a resposta.
3. Rode a suíte inteira. No Radar, deixe na issue o pedido para rodar `python -m radar avaliar` **no PC** (meta ≥ 90%; hoje 100%) com a etiqueta `só-no-pc`, porque só lá há chave e imagens dos gabaritos.
4. Mudou modelo padrão ou reserva: registre no `DECISOES.md` com o motivo (ex.: "404 desde DD/MM").
