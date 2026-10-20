// Leitura de cupom fiscal no próprio aparelho: OCR (Tesseract) + interpretação do texto.
(() => {
  "use strict";

  // ---------- OCR ----------
  const abs = p => new URL(p, location.href).href;
  let workerPromise = null;
  let progressCb = null;

  function getWorker() {
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker("por", 1, {
        workerPath: abs("vendor/tesseract/worker.min.js"),
        corePath: abs("vendor/tesseract/"),
        langPath: abs("vendor/tesseract/lang"),
        gzip: true,
        logger: m => { if (progressCb && typeof m.progress === "number") progressCb(m.status, m.progress); },
      }).then(async w => {
        await w.setParameters({ tessedit_pageseg_mode: "4", preserve_interword_spaces: "1" });
        return w;
      }).catch(e => { workerPromise = null; throw e; });
    }
    return workerPromise;
  }

  // Cupom térmico: tons de cinza, contraste esticado e binarização (Otsu).
  async function prepare(blob) {
    const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
    // Resolução bastante para o texto do cupom, sem pesar: uma foto de celular (12 MP ou mais) vira no
    // máximo ~3,5 MP. Acima disso o OCR fica bem mais lento sem ler melhor.
    let scale = 1;
    if (bmp.width < 1100) scale = 1100 / bmp.width;
    scale = Math.min(scale, 2400 / Math.max(bmp.width, bmp.height), Math.sqrt(3.5e6 / (bmp.width * bmp.height)));
    const cv = document.createElement("canvas");
    cv.width = Math.round(bmp.width * scale);
    cv.height = Math.round(bmp.height * scale);
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
    const img = ctx.getImageData(0, 0, cv.width, cv.height);
    const px = img.data;
    const gray = new Uint8Array(cv.width * cv.height);
    const hist = new Array(256).fill(0);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      const g = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000 | 0;
      gray[j] = g; hist[g]++;
    }
    // contraste: corta 1% de cada ponta
    const total = gray.length;
    let lo = 0, hi = 255, acc = 0;
    while (lo < 255 && (acc += hist[lo]) < total * 0.01) lo++;
    acc = 0;
    while (hi > 0 && (acc += hist[hi]) < total * 0.01) hi--;
    const range = Math.max(1, hi - lo);
    const h2 = new Array(256).fill(0);
    for (let j = 0; j < total; j++) {
      const v = Math.max(0, Math.min(255, ((gray[j] - lo) * 255 / range) | 0));
      gray[j] = v; h2[v]++;
    }
    // limiar de Otsu
    let sum = 0; for (let t = 0; t < 256; t++) sum += t * h2[t];
    let sumB = 0, wB = 0, best = 0, thr = 128;
    for (let t = 0; t < 256; t++) {
      wB += h2[t]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += t * h2[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = t; }
    }
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      const v = gray[j] > thr ? 255 : 0;
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  // Carrega o leitor antes de a foto chegar (por exemplo, enquanto a câmera está aberta).
  const warm = () => { getWorker().catch(() => {}); };

  async function readText(blob, onProgress) {
    progressCb = onProgress || null;
    try {
      onProgress && onProgress("preparando a foto", 0);
      const canvas = await prepare(blob);
      const worker = await getWorker();
      const { data } = await worker.recognize(canvas);
      return data.text || "";
    } finally { progressCb = null; }
  }

  // ---------- interpretação ----------
  const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  // Valor em reais: 1.234,56 · 45,90 · 45.90 · R$ 45, 90 (espaço por erro de OCR)
  const MONEY = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)\s?[,.]\s?(\d{2})(?!\d)/g;
  function amounts(line) {
    // OCR costuma trocar 0 por O dentro de números
    const fixed = line.replace(/(\d)[Oo](?=\d|\b)/g, (_, d) => d + "0").replace(/[Oo](?=\d)/g, "0");
    const out = [];
    for (const m of fixed.matchAll(MONEY)) {
      // ignora datas (12.10.2026) e horas
      const after = fixed.slice(m.index + m[0].length, m.index + m[0].length + 1);
      if (/[.\/:]/.test(after) && /\d/.test(fixed[m.index + m[0].length + 1] || "")) continue;
      out.push(Number(m[1].replace(/\./g, "")) * 100 + Number(m[2]));
    }
    return out;
  }

  const ISSUER_RULES = [
    [/\bALELO\b/, "Alelo"],
    [/\bPLUXEE\b|\bSODEXO\b/, "Pluxee (Sodexo)"],
    [/\bTICKET\b/, "Ticket"],
    [/\bVR\b|\bVR ?BENEF|\bVR ?REFEI|\bVR ?ALIMENT/, "VR"],
    [/\bFLASH\b/, "Flash"],
    [/\bCAJU\b/, "Caju"],
    [/\bIFOOD ?BENEF|\bIFOOD ?(?:CARD|REFEI|ALIMENT)/, "iFood Benefícios"],
    [/\bSWILE\b/, "Swile"],
    [/\bBEN ?(?:VISA|BENEF)/, "Ben"],
  ];
  const BENEFIT_WORDS = /VALE ?ALIMENT|VALE ?REFEI|VOUCHER|\bALIMENTACAO\b|\bREFEICAO\b|\bBENEFICIO|ALELO|PLUXEE|SODEXO|TICKET|\bVR\b|FLASH|CAJU|SWILE|\bVA\b|\bVR\b|\bVOUCH/;
  const CAT_RULES = [
    [/SUPERMERC|MERCADO|ATACAD|ASSAI|CARREFOUR|HIPER|MERCEARIA|HORTIFRUTI|EMPORIO/, "Mercado"],
    [/PADARIA|PANIFIC|CONFEITAR/, "Padaria"],
    [/IFOOD\.COM|RAPPI|DELIVERY|ENTREGA/, "Delivery"],
    [/FEIRA|SACOLAO|VERDURAO/, "Feira"],
    [/LANCHONETE|LANCHES|PASTELARIA|SORVET|CAFETERIA|\bCAFE\b|BURGER|ACAI/, "Lanche"],
    [/RESTAURANTE|CHURRASC|PIZZ|GRILL|BISTRO|COZINHA|SELF ?SERVICE|BUFFET|REFEICOES/, "Restaurante"],
  ];
  const HEADER_SKIP = /CNPJ|CPF|INSCR|\bIE\b|\bI\.E\b|DOCUMENTO|DANFE|NFC|NOTA FISCAL|CUPOM|EXTRATO|CONSUMIDOR|ENDERECO|\bRUA\b|\bAV\b|AVENIDA|FONE|TEL\b|CEP|ESTABELEC|VIA ?(?:CLIENTE|ESTAB)|COMPROVANTE|^\W*$/;

  function parse(text) {
    const raw = String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const lines = raw.map(norm);
    const res = { store: null, cnpj: null, date: null, total: null, paid: null, balance: null, balanceMoment: "desconhecido", issuer: null, last4: null, category: null, found: [] };

    // Data (primeira data válida que não está no futuro)
    const today = new Date();
    for (const l of lines) {
      const m = l.match(/\b(\d{2})[\/.-](\d{2})[\/.-](\d{4}|\d{2})\b/);
      if (!m) continue;
      let [, d, mo, y] = m; if (y.length === 2) y = "20" + y;
      const dt = new Date(+y, +mo - 1, +d);
      if (dt.getMonth() !== +mo - 1 || dt > new Date(today.getTime() + 86400000) || +y < 2015) continue;
      res.date = `${y}-${mo}-${d}`; break;
    }

    // Saldo do cartão de benefício
    const balCands = [];
    lines.forEach((l, i) => {
      if (!/SALDO/.test(l) || /TROCO/.test(l)) return;
      let vals = amounts(l);
      if (!vals.length && lines[i + 1] && !/SALDO/.test(lines[i + 1])) vals = amounts(lines[i + 1]);
      if (!vals.length) return;
      const before = /ANTERIOR|ANTES/.test(l);
      const strong = /DISPON|ATUAL|APOS|RESTANTE|FINAL|DISP\b|SALDO\s*[:R$\d]/.test(l);
      balCands.push({ v: vals[vals.length - 1], before, score: (before ? 1 : strong ? 3 : 2) });
    });
    if (balCands.length) {
      balCands.sort((a, b) => b.score - a.score);
      res.balance = balCands[0].v;
      res.balanceMoment = balCands[0].before ? "antes_compra" : "apos_compra";
    }

    // Total da nota
    for (const re of [/VALOR\s*A\s*PAGAR/, /VALOR\s*TOTAL/, /^TOTAL\b|\bTOTAL\s*R?\$|\bTOTAL\s*:/]) {
      const i = lines.findIndex(l => re.test(l) && !/SALDO|TROCO|DESCONTO|ITENS|QTD|TRIBUT|IMPOSTO/.test(l));
      if (i >= 0) {
        let v = amounts(lines[i]);
        if (!v.length && lines[i + 1]) v = amounts(lines[i + 1]);
        if (v.length) { res.total = v[v.length - 1]; break; }
      }
    }

    // Valor pago com o cartão de benefício: linha da forma de pagamento ou "VALOR" do comprovante TEF
    let paid = null;
    lines.forEach((l, i) => {
      if (paid !== null || /SALDO|TROCO/.test(l)) return;
      if (BENEFIT_WORDS.test(l)) {
        const v = amounts(l);
        if (v.length) paid = v[v.length - 1];
        else if (lines[i + 1] && !/SALDO/.test(lines[i + 1]) && /^\W*(?:R\$)?\s*\d/.test(lines[i + 1])) { const n = amounts(lines[i + 1]); if (n.length) paid = n[0]; }
      }
    });
    if (paid === null) {
      const i = lines.findIndex(l => /\bVALOR\b(?!\s*TOTAL)(?!\s*A\s*PAGAR)|VALOR APROVADO|VENDA\b/.test(l) && !/SALDO|TROCO|TRIBUT|IMPOSTO|DESCONTO/.test(l));
      if (i >= 0) { const v = amounts(lines[i]); if (v.length) paid = v[v.length - 1]; }
    }
    res.paid = paid !== null ? paid : res.total;

    // Todas as formas de pagamento da NFC-e (pode haver vários vales, cartão, Pix e dinheiro na mesma compra).
    // Com o cabeçalho "FORMA DE PAGAMENTO", lê só as linhas logo abaixo dele; sem ele, procura no cupom todo.
    const PAY_RULES = [
      [/VALE ?ALIMENT|VALE ?REFEI|VOUCHER|\bALIMENTACAO\b|\bREFEICAO\b|BENEFICIO|ALELO|PLUXEE|SODEXO|TICKET|\bVR\b|FLASH|CAJU|SWILE|\bVA\b/, "vale"],
      [/\bPIX\b/, "pix"],
      [/DINHEIRO|ESPECIE/, "dinheiro"],
      [/CREDITO/, "credito"],
      [/DEBITO/, "debito"],
    ];
    const head = lines.findIndex(l => /FORMAS? (DE )?PAGAMENTO|FORMA PAGTO|MEIO DE PAGAMENTO/.test(l));
    const scope = head >= 0 ? lines.slice(head + 1, head + 10) : lines;
    const payments = [];
    for (const l of scope) {
      if (head >= 0 && /TROCO|CONSULTE|CHAVE|PROTOCOLO|TRIBUT/.test(l)) break;
      if (/SALDO|TROCO|TOTAL|DESCONTO|APROVAD|VIA |SUBTOTAL/.test(l)) continue;
      const v = amounts(l);
      if (!v.length) continue;
      const rule = PAY_RULES.find(([re]) => re.test(l));
      if (!rule) { if (head >= 0 && /[A-Z]{3}/.test(l)) payments.push({ kind: "outro", amount: v[v.length - 1], label: raw[lines.indexOf(l)] }); continue; }
      payments.push({ kind: rule[1], amount: v[v.length - 1], label: raw[lines.indexOf(l)] });
    }
    // Sem a seção da NFC-e, mantém só um pagamento por tipo para não contar duas vezes o mesmo valor do comprovante.
    res.payments = head >= 0 ? payments : payments.filter((p, i) => payments.findIndex(q => q.kind === p.kind && q.amount === p.amount) === i);
    const vales = res.payments.filter(p => p.kind === "vale");
    if (vales.length > 1) res.paid = vales.reduce((s, p) => s + p.amount, 0);
    // Todos os saldos impressos (um por comprovante de vale) e todos os finais de cartão
    res.balances = balCands.map(b => b.before && res.paid ? null : b.v).filter(v => v !== null);

    // Emissor e final do cartão
    const all = lines.join("\n");
    // CNPJ da loja (o primeiro do cupom é o do emitente): serve para lembrar qual cartão é usado em cada loja
    const cn = all.match(/CNPJ[^\d\n]{0,8}(\d{2}\.?\d{3}\.?\d{3}\s?\/?\s?\d{4}\s?-?\s?\d{2})/);
    if (cn) { const digits = cn[1].replace(/\D/g, ""); if (digits.length === 14) res.cnpj = digits; }
    for (const [re, name] of ISSUER_RULES) if (re.test(all)) { res.issuer = name; break; }
    const l4 = all.match(/(?:[*X]{4}[\s.-]*){1,3}(\d{4})\b|\*{2,}\s*(\d{4})\b|FINAL\s*:?\s*(\d{4})\b|CARTAO\s*:?\s*[*X\d\s]{6,}?(\d{4})\b/);
    if (l4) res.last4 = l4[1] || l4[2] || l4[3] || l4[4];
    res.last4s = [...all.matchAll(/(?:[*X]{4}[\s.-]*){1,3}(\d{4})\b|\*{2,}\s*(\d{4})\b|FINAL\s*:?\s*(\d{4})\b/g)].map(m => m[1] || m[2] || m[3]);

    // Estabelecimento: primeira linha de cabeçalho com nome
    for (let i = 0; i < Math.min(lines.length, 8); i++) {
      const l = lines[i];
      if (HEADER_SKIP.test(l) || !/[A-Z]{3}/.test(l) || l.replace(/[^A-Z]/g, "").length < 4) continue;
      res.store = raw[i].replace(/\s{2,}/g, " ").replace(/[^\p{L}\p{N}&.,' -]/gu, "").trim().slice(0, 60);
      if (res.store === res.store.toUpperCase()) res.store = res.store.toLowerCase().replace(/(^|\s)\p{L}/gu, s => s.toUpperCase()).replace(/\b(Ltda|Me|Epp|Eireli|S\.?a)\b\.?/gi, m => m.toUpperCase());
      break;
    }

    for (const [re, cat] of CAT_RULES) if (re.test(all)) { res.category = cat; break; }

    if (res.date) res.found.push("data");
    if (res.paid !== null) res.found.push("valor");
    if (res.balance !== null) res.found.push("saldo");
    if (res.issuer) res.found.push("emissor");
    if (res.last4) res.found.push("final do cartão");
    return res;
  }

  // ---------- cadastro de cartão por foto (leitor do celular) ----------
  // Foto do cartão ou print do app do emissor. Guarda só os 4 últimos dígitos do número.
  const CARD_WORDS = /ALELO|PLUXEE|SODEXO|TICKET|FLASH|CAJU|SWILE|IFOOD|BENEF|VALE|REFEI|ALIMENT|VOUCHER|CARTAO|VALIDADE|VALID|THRU|SALDO|MASTERCARD|VISA|ELO|DEBITO|CREDITO|DISPON|EXTRATO|APP/;
  function parseCard(text) {
    const raw = String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const lines = raw.map(norm);
    const all = lines.join("\n");
    const res = { source: "celular", kind: /SALDO|DISPON|EXTRATO/.test(all) ? "app" : "cartao", issuer: null, type: null, holder: null, last4: null, balance: null };
    for (const [re, name] of ISSUER_RULES) if (re.test(all)) { res.issuer = name; break; }
    if (/MULTI|FLEX|BENEFICIO/.test(all)) res.type = "flex";
    else if (/REFEI|RESTAURANTE/.test(all)) res.type = "refeicao";
    else if (/ALIMENT|MERCADO/.test(all)) res.type = "alimentacao";
    // número do cartão: 13 a 19 dígitos (com espaços) ou mascarado (**** 1234) → só o final
    const digits = all.replace(/[ .-](?=\d)/g, "");
    const full = digits.match(/\d{13,19}/);
    const masked = all.match(/(?:[*X•]{2,}[\s.-]*){1,3}(\d{4})\b|FINAL\s*:?\s*(\d{4})\b/);
    if (masked) res.last4 = masked[1] || masked[2];
    else if (full) res.last4 = full[0].slice(-4);
    // saldo (print do app)
    lines.forEach((l, i) => {
      if (res.balance !== null || !/SALDO|DISPON/.test(l)) return;
      let v = amounts(l);
      if (!v.length && lines[i + 1]) v = amounts(lines[i + 1]);
      if (v.length) res.balance = v[0];
    });
    // titular: linha só com letras, 2 a 5 palavras, que não seja marca/rótulo
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (CARD_WORDS.test(l) || /\d/.test(l)) continue;
      const words = l.split(/\s+/).filter(w => /^[A-Z]{2,}$/.test(w));
      if (words.length >= 2 && words.length <= 5 && words.join(" ").length >= 6) {
        res.holder = words.map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(" ").replace(/\b(De|Da|Do|Dos|Das|E)\b/g, m => m.toLowerCase());
        break;
      }
    }
    return res;
  }

  window.ReceiptReader = { warm, readText, parse, parseCard, prepare };
})();
