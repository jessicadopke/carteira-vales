// Leitura de cupom com o Gemini (opcional). A foto vai para a API do Google; a resposta vem num formato fixo (JSON)
// e é convertida para o mesmo formato do leitor no celular (receipt.js), usado pela tela de conferência.
(() => {
  "use strict";

  const API = "https://generativelanguage.googleapis.com/v1beta";
  const DEFAULT_MODEL = "gemini-flash-latest";
  const FALLBACK_MODEL = "gemini-2.5-flash";
  const CATS = ["Mercado", "Restaurante", "Padaria", "Delivery", "Lanche", "Feira", "Outros"];

  // Formato da resposta pedido ao Gemini (subconjunto do OpenAPI aceito pela API)
  const SCHEMA = {
    type: "OBJECT",
    properties: {
      legivel: { type: "BOOLEAN", description: "false se a foto não for um comprovante de compra ou estiver ilegível" },
      estabelecimento: { type: "STRING", nullable: true },
      cnpj: { type: "STRING", nullable: true, description: "CNPJ do emitente, só dígitos" },
      data: { type: "STRING", nullable: true, description: "data da compra no formato AAAA-MM-DD" },
      valor_total: { type: "NUMBER", nullable: true, description: "valor total a pagar da nota, em reais" },
      pagamentos: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            forma: { type: "STRING", enum: ["vale", "credito", "debito", "pix", "dinheiro", "outro"] },
            valor: { type: "NUMBER", description: "valor pago desta forma, em reais" },
            emissor: { type: "STRING", nullable: true, description: "VR, Alelo, Pluxee, Sodexo, Ticket, Flash, Caju, iFood, Swile, Ben ou outro" },
            final_cartao: { type: "STRING", nullable: true, description: "4 últimos dígitos do cartão, se impressos" },
            saldo: { type: "NUMBER", nullable: true, description: "saldo do cartão de benefício impresso no comprovante, em reais" },
            saldo_momento: { type: "STRING", enum: ["apos_compra", "antes_compra", "desconhecido"] },
          },
          required: ["forma", "valor"],
        },
      },
      categoria: { type: "STRING", enum: CATS },
      observacoes: { type: "STRING", nullable: true },
    },
    required: ["legivel", "pagamentos"],
  };

  const PROMPT = `Você está lendo a foto de um comprovante de compra brasileiro: NFC-e, cupom fiscal, comprovante da maquininha (TEF) e/ou relatório de saldo do cartão impresso junto. A foto pode ter mais de um papel.
Extraia os dados no formato pedido. Regras:
- Valores em reais como número decimal (ex.: 87.43). Use null quando a informação não aparecer. Não invente.
- "pagamentos": uma linha para cada forma de pagamento usada na compra (seção "FORMA DE PAGAMENTO" da NFC-e e/ou comprovantes da maquininha). Não repita a mesma parte só porque aparece na NFC-e e no comprovante.
- forma "vale" para cartões de benefício: vale-alimentação, vale-refeição, voucher, multibenefício (VR, Alelo, Pluxee/Sodexo, Ticket, Flash, Caju, iFood Benefícios, Swile, Ben etc.). "credito"/"debito" só para cartões bancários comuns.
- "saldo": saldo disponível do cartão de benefício impresso no comprovante daquele pagamento (SALDO, SALDO DISPONIVEL, SALDO ATUAL). Nunca confunda com troco, total, desconto ou valor pago. "saldo_momento": "apos_compra" se o saldo já desconta esta compra (o normal), "antes_compra" se o comprovante diz que é o saldo anterior.
- "final_cartao": só os 4 últimos dígitos, se legíveis.
- "categoria": a que melhor descreve a loja.`;

  async function call(key, model, body, signal) {
    const res = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      let msg = "";
      try { msg = (await res.json()).error.message || ""; } catch (e) {}
      const err = new Error(msg || "HTTP " + res.status);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  // Explica o erro em português, para a tela de conferência e para o teste da chave.
  function explain(e) {
    if (e && e.name === "AbortError") return "A leitura foi interrompida.";
    if (!navigator.onLine) return "Sem internet.";
    const s = e && e.status;
    if (s === 400 && /API key|api_key|key not valid/i.test(e.message)) return "A chave de API não é válida.";
    if (s === 400) return "O Gemini não aceitou a foto.";
    if (s === 401 || s === 403) return "A chave de API foi recusada (confira a chave e as restrições dela no Google).";
    if (s === 404) return "O modelo do Gemini não foi encontrado.";
    if (s === 429) return "Limite de uso do Gemini atingido por agora. Tente mais tarde.";
    if (s >= 500) return "O Gemini está fora do ar no momento.";
    return "Não foi possível falar com o Gemini.";
  }

  const toB64 = blob => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  const cents = v => typeof v === "number" && isFinite(v) && v >= 0 ? Math.round(v * 100) : null;
  const ISSUER_NAMES = [
    [/alelo/i, "Alelo"], [/pluxee|sodexo/i, "Pluxee (Sodexo)"], [/ticket/i, "Ticket"], [/\bvr\b|vr ?benef/i, "VR"],
    [/flash/i, "Flash"], [/caju/i, "Caju"], [/ifood/i, "iFood Benefícios"], [/swile/i, "Swile"], [/\bben\b/i, "Ben"],
  ];
  const issuerOf = s => { if (!s) return null; for (const [re, n] of ISSUER_NAMES) if (re.test(s)) return n; return null; };

  // Converte a resposta do Gemini para o formato de ReceiptReader.parse()
  function toParsed(j) {
    const pays = (Array.isArray(j.pagamentos) ? j.pagamentos : [])
      .map(p => ({ kind: ["vale", "credito", "debito", "pix", "dinheiro", "outro"].includes(p.forma) ? p.forma : "outro", amount: cents(p.valor), issuer: issuerOf(p.emissor), last4: /^\d{4}$/.test(String(p.final_cartao || "")) ? String(p.final_cartao) : null, saldo: cents(p.saldo), moment: p.saldo_momento }))
      .filter(p => p.amount > 0);
    const vales = pays.filter(p => p.kind === "vale");
    // saldos impressos sempre como "depois da compra"
    const balances = vales.filter(p => p.saldo !== null).map(p => p.moment === "antes_compra" ? p.saldo - p.amount : p.saldo);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(j.data || "") ? j.data : null;
    const cnpj = String(j.cnpj || "").replace(/\D/g, "");
    const res = {
      source: "gemini",
      store: j.estabelecimento ? String(j.estabelecimento).slice(0, 60) : null,
      cnpj: cnpj.length === 14 ? cnpj : null,
      date,
      total: cents(j.valor_total),
      paid: vales.length ? vales.reduce((s, p) => s + p.amount, 0) : null,
      payments: pays.map(p => ({ kind: p.kind, amount: p.amount })),
      // pistas de cada vale, na mesma ordem dos pagamentos "vale"
      vales: vales.map(p => ({ amount: p.amount, issuer: p.issuer, last4: p.last4, saldo: p.saldo === null ? null : p.moment === "antes_compra" ? p.saldo - p.amount : p.saldo })),
      balances,
      balance: balances.length === 1 ? balances[0] : null,
      balanceMoment: "apos_compra",
      issuer: vales.length === 1 ? vales[0].issuer : null,
      last4: vales.length === 1 ? vales[0].last4 : null,
      last4s: vales.map(p => p.last4).filter(Boolean),
      category: CATS.includes(j.categoria) ? j.categoria : null,
      legible: j.legivel !== false,
      notes: j.observacoes || null,
      found: [],
    };
    if (res.date) res.found.push("data");
    if (res.paid !== null || res.total !== null) res.found.push("valor");
    if (balances.length) res.found.push("saldo");
    if (vales.some(p => p.issuer)) res.found.push("emissor");
    if (res.last4s.length) res.found.push("final do cartão");
    if (pays.some(p => p.kind !== "vale")) res.found.push("outras formas de pagamento");
    return res;
  }

  // Lê o cupom. cfg = { key, model }. Devolve { parsed, raw, model }.
  async function read(blob, cfg, signal) {
    const data = await toB64(blob);
    const body = {
      contents: [{ role: "user", parts: [{ text: PROMPT }, { inline_data: { mime_type: blob.type || "image/jpeg", data } }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA },
    };
    let model = cfg.model || DEFAULT_MODEL, out;
    try { out = await call(cfg.key, model, body, signal); }
    catch (e) {
      if (e.status === 404 && model !== FALLBACK_MODEL) { model = FALLBACK_MODEL; out = await call(cfg.key, model, body, signal); }
      else throw e;
    }
    const text = (((out.candidates || [])[0] || {}).content || {}).parts?.map(p => p.text || "").join("") || "";
    let json;
    try { json = JSON.parse(text); } catch (e) { const err = new Error("resposta fora do formato"); err.status = 0; err.raw = text; throw err; }
    return { parsed: toParsed(json), raw: JSON.stringify(json, null, 2), model };
  }

  // Confere se a chave funciona (lista os modelos; não gasta cota de geração).
  async function test(key, signal) {
    const res = await fetch(`${API}/models?pageSize=1`, { headers: { "x-goog-api-key": key }, signal });
    if (!res.ok) {
      let msg = ""; try { msg = (await res.json()).error.message || ""; } catch (e) {}
      const err = new Error(msg || "HTTP " + res.status); err.status = res.status; throw err;
    }
    return true;
  }

  window.GeminiReader = { read, test, toParsed, explain, DEFAULT_MODEL };
})();
