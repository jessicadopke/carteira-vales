(() => {
  "use strict";
  // ---------- constantes e utilidades ----------
  const TYPES = {
    alimentacao: { label: "Alimentação", color: "var(--t-alim)" },
    refeicao: { label: "Refeição", color: "var(--t-ref)" },
    flex: { label: "Multibenefício", color: "var(--t-flex)" },
    outro: { label: "Outro voucher", color: "var(--t-outro)" },
  };
  const ISSUERS = ["VR", "Alelo", "Pluxee (Sodexo)", "Ticket", "Flash", "Caju", "iFood Benefícios", "Swile", "Ben", "Outro"];
  // Cor e sigla de cada emissor (só para reconhecer o cartão de relance; não são logotipos)
  const ISSUER_STYLE = {
    "VR": { c: "#0a8f3c", s: "VR" }, "Alelo": { c: "#5b8f00", s: "AL" }, "Pluxee (Sodexo)": { c: "#2b2a8c", s: "PX" },
    "Ticket": { c: "#c8102e", s: "TK" }, "Flash": { c: "#d6246e", s: "FL" }, "Caju": { c: "#e4572e", s: "CJ" },
    "iFood Benefícios": { c: "#b8121f", s: "IF" }, "Swile": { c: "#5b3fd1", s: "SW" }, "Ben": { c: "#0f6fa8", s: "BN" }, "Outro": { c: "#55657a", s: "••" },
  };
  const issuerStyle = c => ISSUER_STYLE[c.issuer] || ISSUER_STYLE.Outro;
  const fold = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const MANY = 12; // a partir daqui os grupos por titular começam fechados
  const CATS = ["Mercado", "Restaurante", "Padaria", "Delivery", "Lanche", "Feira", "Outros"];
  const MONTHS = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  // Versão do app (SemVer: MAJOR.MINOR.PATCH). Ao mudar, atualize também CHANGELOG.md e VERSION em sw.js.
  const APP_VERSION = "1.5.0";
  const LOCK_MS = 5 * 60 * 1000;
  const BACKUP_VERSION = 1;

  const brl = c => (c < 0 ? "−" : "") + "R$ " + (Math.abs(c) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const pad = n => String(n).padStart(2, "0");
  const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const monthKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const todayISO = () => isoDay(new Date());
  const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const mkDate = (y, m, d) => new Date(y, m, Math.min(d, new Date(y, m + 1, 0).getDate()));
  const shortDate = d => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
  function parseMoney(str) {
    let s = String(str ?? "").replace(/[R$\s]/g, "");
    if (!s) return NaN;
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    const n = Number(s);
    return isFinite(n) ? Math.round(n * 100) : NaN;
  }
  const fmtInput = c => (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function fmtDay(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const diff = Math.round((midnight(new Date()) - dt) / 86400000);
    if (diff === 0) return "Hoje";
    if (diff === 1) return "Ontem";
    return dt.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short", year: dt.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
  }
  const delta = t => t.kind === "debit" ? -t.amount : t.amount;

  // ---------- crédito do benefício: fixo ou variável ----------
  // dayMode: "fixed" (todo dia X), "variable" (cai em dias diferentes) ou "none" (não controlar).
  // amountMode: "fixed" (mesmo valor todo mês) ou "variable" (valor muda).
  const dayModeOf = c => c.dayMode || (c.creditDay ? "fixed" : "none");
  const amountModeOf = c => c.amountMode || "fixed";
  const fromISO = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const isBenefitCredit = t => t.kind === "credit" && (t.benefit || /^Crédito de /.test(t.desc || ""));
  const benefitCredits = card => S.txs.filter(t => t.cardId === card.id && isBenefitCredit(t)).sort((a, b) => a.date.localeCompare(b.date));
  // Datas em que o crédito caiu (inclui a data do último crédito informada no cadastro).
  function creditDates(card) {
    const ds = new Set(benefitCredits(card).map(t => t.date));
    if (card.lastCreditDate) ds.add(card.lastCreditDate);
    return [...ds].sort();
  }
  // Valor esperado do próximo crédito: o fixo, ou o último recebido.
  function expectedAmount(card) {
    if (amountModeOf(card) === "fixed") return card.monthlyCredit || 0;
    const cs = benefitCredits(card);
    return cs.length ? cs[cs.length - 1].amount : (card.monthlyCredit || 0);
  }
  // Previsão do próximo crédito pelo intervalo médio entre os últimos créditos (sem histórico: 30 dias).
  function estimateNext(card) {
    const ds = creditDates(card);
    if (!ds.length) return null;
    const recent = ds.slice(-6).map(fromISO);
    const gaps = recent.slice(1).map((d, i) => Math.round((d - recent[i]) / 86400000)).filter(g => g >= 5);
    const avg = gaps.length ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : 30;
    const last = recent[recent.length - 1];
    return { date: addDays(last, Math.min(45, Math.max(7, avg))), last, avg, samples: gaps.length };
  }

  // ---------- períodos ----------
  // Dia fixo: um período vai do dia do crédito até a véspera do crédito seguinte.
  // Dia variável: um período vai de um crédito real até o próximo crédito registrado.
  // Sem dia de crédito, o período é o mês do calendário.
  function periodAt(card, date) {
    const d = midnight(date);
    if (dayModeOf(card) === "variable") {
      const ds = creditDates(card), iso = isoDay(d);
      let i = -1;
      ds.forEach((x, k) => { if (x <= iso) i = k; });
      if (i >= 0) {
        const start = fromISO(ds[i]);
        let end, open = false;
        if (ds[i + 1]) end = fromISO(ds[i + 1]);
        else { open = true; const est = estimateNext(card); end = est && est.date > d ? est.date : addDays(d, 1); }
        return { start, end, startISO: isoDay(start), endISO: open ? "9999-12-31" : isoDay(end), key: ds[i], open };
      }
      // antes do primeiro crédito conhecido: mês do calendário, até o primeiro crédito
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      let end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      if (ds[0] && fromISO(ds[0]) < end) end = fromISO(ds[0]);
      return { start, end, startISO: isoDay(start), endISO: isoDay(end), key: "cal:" + monthKey(start), calendar: true };
    }
    const day = Number(card.creditDay) || 1;
    let start = mkDate(d.getFullYear(), d.getMonth(), day);
    if (d < start) start = mkDate(d.getFullYear(), d.getMonth() - 1, day);
    const end = mkDate(start.getFullYear(), start.getMonth() + 1, day);
    return { start, end, startISO: isoDay(start), endISO: isoDay(end), key: monthKey(start), calendar: dayModeOf(card) === "none" };
  }
  function periodShift(card, p, n) {
    if (dayModeOf(card) !== "variable") {
      const day = Number(card.creditDay) || 1;
      return periodAt(card, mkDate(p.start.getFullYear(), p.start.getMonth() + n, day));
    }
    let q = p;
    for (let k = 0; k < Math.abs(n); k++) q = n < 0 ? periodAt(card, addDays(q.start, -1)) : periodAt(card, q.end);
    return q;
  }
  function periodLabel(card, p) {
    if (p.calendar && dayModeOf(card) !== "variable") return `${MONTHS[p.start.getMonth()]} ${p.start.getFullYear()}`;
    if (p.open) return `${shortDate(p.start)} – hoje`;
    const last = addDays(p.end, -1);
    return `${shortDate(p.start)} – ${shortDate(last)} ${last.getFullYear()}`;
  }
  function workdaysBetween(a, b) {
    let n = 0;
    for (let d = new Date(a); d < b; d.setDate(d.getDate() + 1)) { const w = d.getDay(); if (w !== 0 && w !== 6) n++; }
    return n;
  }
  function periodStats(card, p) {
    const txs = S.txs.filter(t => t.cardId === card.id);
    const bal = card.balance || 0;
    const after = iso => txs.filter(t => (t.date || "") >= iso).reduce((s, t) => s + delta(t), 0);
    const inP = txs.filter(t => t.date >= p.startISO && t.date < p.endISO);
    const isAdj = t => t.source === "ajuste";
    return {
      txs: inP,
      opening: bal - after(p.startISO),
      closing: bal - after(p.endISO),
      credits: inP.filter(t => t.kind === "credit" && !isAdj(t)).reduce((s, t) => s + t.amount, 0),
      debits: inP.filter(t => t.kind === "debit" && !isAdj(t)).reduce((s, t) => s + t.amount, 0),
      adjust: inP.filter(isAdj).reduce((s, t) => s + delta(t), 0),
    };
  }
  function creditInfo(card) {
    const mode = dayModeOf(card);
    const today = midnight(new Date());
    if (mode === "fixed") {
      const p = periodAt(card, today);
      return { period: p, next: p.end, workdays: workdaysBetween(today, p.end), calDays: Math.round((p.end - today) / 86400000), estimated: false, overdue: false };
    }
    if (mode === "variable") {
      const est = estimateNext(card);
      if (!est) return null;
      const overdue = est.date <= today;
      return { period: periodAt(card, today), next: est.date, workdays: overdue ? 0 : workdaysBetween(today, est.date), calDays: Math.round((est.date - today) / 86400000), estimated: true, overdue, est };
    }
    return null;
  }
  // Quanto dá para gastar por dia útil até o próximo crédito (null quando o crédito está atrasado ou não há previsão).
  function perDayOf(card, ci) {
    if (!ci || ci.overdue) return null;
    return Math.max(0, ci.workdays > 0 ? Math.floor((card.balance || 0) / ci.workdays) : card.balance || 0);
  }
  function creditWhen(ci) {
    if (!ci) return "";
    if (ci.overdue) return "crédito previsto: já deveria ter caído";
    return `crédito em ${ci.estimated ? "~" : ""}${ci.calDays} ${ci.calDays === 1 ? "dia" : "dias"}`;
  }

  // ---------- criptografia do cofre ----------
  const b64 = buf => { let s = ""; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const hasCrypto = !!(window.crypto && crypto.subtle);
  async function deriveKey(pass, saltB64) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: unb64(saltB64), iterations: 310000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function seal(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
    return { iv: b64(iv), ct: b64(ct) };
  }
  async function unseal(key, box) {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, key, unb64(box.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  // ---------- armazenamento no aparelho (IndexedDB) ----------
  const DB_NAME = "ciclo";
  const OLD_DB_NAME = "carteira-vales"; // nome usado até a 1.4.0
  const IDB = {
    db: null,
    open() {
      return new Promise((res, rej) => {
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => {
          const db = r.result;
          for (const s of ["cards", "txs", "receipts"]) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
          if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
        };
        r.onsuccess = () => {
          IDB.db = r.result;
          // Outra aba ou atualização precisa do banco: solta a conexão e recarrega, em vez de travar as duas.
          IDB.db.onversionchange = () => { IDB.db.close(); location.reload(); };
          res();
        };
        r.onerror = () => rej(r.error);
      });
    },
    req(store, mode, fn) {
      return new Promise((res, rej) => {
        const tx = IDB.db.transaction(store, mode);
        const r = fn(tx.objectStore(store));
        tx.oncomplete = () => res(r && r.result);
        tx.onerror = () => rej(tx.error);
        tx.onabort = () => rej(tx.error);
      });
    },
    all: s => IDB.req(s, "readonly", st => st.getAll()),
    get: (s, k) => IDB.req(s, "readonly", st => st.get(k)),
    put: (s, v, k) => IDB.req(s, "readwrite", st => k === undefined ? st.put(v) : st.put(v, k)),
    del: (s, k) => IDB.req(s, "readwrite", st => st.delete(k)),
    clear: s => IDB.req(s, "readwrite", st => st.clear()),
  };
  // Até a 1.4.0 o banco se chamava "carteira-vales". Se ele existir e o novo estiver vazio, copia tudo e apaga o antigo.
  async function migrateOldDb() {
    if (!indexedDB.databases) return false;
    const list = await indexedDB.databases().catch(() => []);
    if (!list.some(d => d.name === OLD_DB_NAME)) return false;
    const [cards, meta] = await Promise.all([IDB.all("cards"), IDB.get("meta", "main")]);
    if (cards.length || meta) return false;
    const old = await new Promise((res, rej) => { const r = indexedDB.open(OLD_DB_NAME); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const read = (s, k) => new Promise(res => {
      if (!old.objectStoreNames.contains(s)) return res(k ? undefined : []);
      const q = k ? old.transaction(s).objectStore(s).get(k) : old.transaction(s).objectStore(s).getAll();
      q.onsuccess = () => res(q.result); q.onerror = () => res(k ? undefined : []);
    });
    const data = { cards: await read("cards"), txs: await read("txs"), receipts: await read("receipts"), meta: await read("meta", "main") };
    old.close();
    for (const s of ["cards", "txs", "receipts"]) for (const v of data[s]) await IDB.put(s, v);
    if (data.meta) await IDB.put("meta", data.meta, "main");
    await new Promise(res => { const d = indexedDB.deleteDatabase(OLD_DB_NAME); d.onsuccess = d.onerror = d.onblocked = res; });
    return data.cards.length > 0;
  }
  const Store = {
    async put(k, obj) { await IDB.put(k, obj); upsert(k, obj); },
    async patch(k, id, part) {
      const cur = S[k].find(x => x.id === id);
      if (!cur) throw new Error("registro não encontrado");
      const obj = { ...cur, ...part };
      await IDB.put(k, obj); upsert(k, obj);
    },
    async remove(k, id) { await IDB.del(k, id); S[k] = S[k].filter(x => x.id !== id); },
    async setMeta(m) { await IDB.put("meta", m, "main"); S.meta = m; },
  };
  function upsert(k, obj) {
    const i = S[k].findIndex(x => x.id === obj.id);
    if (i >= 0) S[k][i] = obj; else S[k].push(obj);
  }

  // ---------- estado ----------
  const S = {
    cards: [], txs: [], meta: {}, loaded: false,
    view: { name: "home" }, tab: "home", person: null, periodOffset: 0, busy: false, skipped: new Set(), cardQuery: "", groups: {}, txQuery: "", txLimit: 100,
    key: null, plain: {}, plainSig: {}, reveal: new Set(), lockTimer: null, installEvt: null,
  };
  const $ = id => document.getElementById(id);

  function toast(msg) {
    const el = document.createElement("div");
    el.className = "toast"; el.setAttribute("role", "status"); el.textContent = msg;
    $("toastRoot").replaceChildren(el);
    setTimeout(() => el.remove(), 2800);
  }
  function explain(err) {
    if (err && err.name === "QuotaExceededError") return "O celular está sem espaço para o app. Apague fotos de cupons antigos ou libere espaço.";
    return "Não foi possível salvar. Tente de novo.";
  }

  const cardById = id => S.cards.find(c => c.id === id);
  const sortedCards = () => [...S.cards].sort((a, b) => (a.holder || "").localeCompare(b.holder || "", "pt-BR") || (a.createdAt || 0) - (b.createdAt || 0));
  const visibleCards = () => sortedCards().filter(c => S.person === null || (c.holder || "") === S.person);
  const holders = () => [...new Set(S.cards.map(c => c.holder || ""))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const txSort = (a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0);
  const lastTxDate = cardId => S.txs.filter(t => t.cardId === cardId).reduce((m, t) => (t.date > m ? t.date : m), "");

  // ---------- ações ----------
  async function run(fn, okMsg) {
    if (S.busy) return false;
    S.busy = true;
    try { await fn(); if (okMsg) toast(okMsg); return true; }
    catch (e) { console.error(e); toast(explain(e)); return false; }
    finally { S.busy = false; render(); }
  }
  // Grava lançamentos de um cartão e atualiza o saldo uma única vez.
  async function postTxs(card, list) {
    let bal = card.balance || 0;
    for (const t of list) {
      const tx = { id: uid(), cardId: card.id, cat: "", source: "manual", createdAt: Date.now(), ...t };
      await Store.put("txs", tx);
      bal += delta(tx);
    }
    await Store.patch("cards", card.id, { balance: bal });
    return bal;
  }
  async function deleteTx(tx) {
    const card = cardById(tx.cardId);
    await Store.remove("txs", tx.id);
    if (card) await Store.patch("cards", card.id, { balance: (card.balance || 0) - delta(tx) });
    // A foto pode ser compartilhada pelas partes de uma compra dividida: só apaga quando ninguém mais usa.
    if (tx.receiptId && !S.txs.some(t => t.receiptId === tx.receiptId)) await IDB.del("receipts", tx.receiptId);
  }
  async function deleteCard(card) {
    for (const t of S.txs.filter(t => t.cardId === card.id)) {
      await Store.remove("txs", t.id);
      if (t.receiptId) await IDB.del("receipts", t.receiptId);
    }
    await Store.remove("cards", card.id);
  }
  async function askPersist() {
    try { if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch (e) {}
  }

  // ---------- cofre ----------
  function touchVault() {
    if (!S.key) return;
    clearTimeout(S.lockTimer);
    S.lockTimer = setTimeout(() => lockVault("O cofre foi trancado por inatividade."), LOCK_MS);
  }
  function lockVault(msg) {
    if (!S.key) return;
    S.key = null; S.plain = {}; S.plainSig = {}; S.reveal.clear(); clearTimeout(S.lockTimer);
    if ($("scrim") && $("scrim").dataset.secret) closeSheet();
    render();
    if (msg) toast(msg);
  }
  async function decryptCards() {
    if (!S.key) return;
    let changed = false;
    for (const c of S.cards) {
      const sig = c.secret ? c.secret.ct : "";
      if (S.plainSig[c.id] === sig) continue;
      S.plainSig[c.id] = sig; changed = true;
      if (!c.secret) { delete S.plain[c.id]; continue; }
      try { S.plain[c.id] = await unseal(S.key, c.secret); } catch (e) { S.plain[c.id] = { error: true }; }
    }
    if (changed) render();
  }
  function renderTop() {
    $("lockBtn").hidden = !S.key;
    $("installBtn").hidden = !S.installEvt;
    const hide = !!S.meta.hideValues;
    document.body.classList.toggle("hide-values", hide);
    $("eyeBtn").setAttribute("aria-pressed", String(hide));
    $("eyeBtn").setAttribute("aria-label", hide ? "Mostrar valores" : "Esconder valores");
    $("tabbar").hidden = !S.loaded;
    const tab = S.view.name === "card" ? "home" : S.tab;
    document.querySelectorAll(".tab").forEach(t => t.toggleAttribute("aria-current", t.dataset.tab === tab));
    document.querySelectorAll(".tab[aria-current]").forEach(t => t.setAttribute("aria-current", "page"));
  }

  // ---------- renderização ----------
  function render() {
    const view = $("view");
    renderTop();
    if (!S.loaded) return;
    if (S.view.name === "card" && cardById(S.view.id)) view.innerHTML = renderCard(cardById(S.view.id));
    else {
      S.view = { name: "home" };
      view.innerHTML = S.tab === "extrato" ? renderExtrato() : S.tab === "cofre" ? renderCofre() : S.tab === "ajustes" ? renderAjustes() : renderHome();
    }
    if (S.cards.length) decryptCards();
  }
  // Troca de tela com transição: animação nativa do Chrome quando existe, senão entrada suave dos blocos.
  const reduceMotion = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function navigate(fn, dir = "fade") {
    const vt = !!document.startViewTransition && !reduceMotion();
    const apply = () => {
      fn(); window.scrollTo(0, 0);
      if (vt) return;
      const v = $("view"); v.classList.remove("enter"); void v.offsetWidth; v.classList.add("enter");
      clearTimeout(navigate.t); navigate.t = setTimeout(() => v.classList.remove("enter"), 700);
    };
    if (vt) { document.documentElement.dataset.nav = dir; document.startViewTransition(apply); }
    else apply();
  }

  // Cartões cujo crédito já deveria ter caído e ainda não foi registrado.
  function pendingCredits(cards) {
    return cards.map(c => ({ c, ci: creditInfo(c) })).filter(({ c, ci }) => {
      if (!ci || S.skipped.has(c.id)) return false;
      if (ci.estimated) return ci.overdue;
      if (amountModeOf(c) === "fixed" && !(c.monthlyCredit > 0)) return false;
      if (c.lastCreditMonth === ci.period.key) return false;
      return !benefitCredits(c).some(t => t.date >= ci.period.startISO);
    });
  }
  function renderNotices(list) {
    return list.map(({ c, ci }) => {
      const who = `<b>${esc(c.name)}</b>${c.holder ? ` (${esc(c.holder)})` : ""}`;
      const amt = amountModeOf(c) === "fixed" ? `, <span class="num">${brl(c.monthlyCredit)}</span>,` : "";
      const text = ci.estimated
        ? `O crédito do ${who} estava previsto para <span class="num">${shortDate(ci.next)}</span>. Já caiu?`
        : `O crédito de ${MONTHS[ci.period.start.getMonth()]} do ${who}${amt} já caiu?`;
      return `
      <div class="notice">
        <span>${text}</span>
        <span class="actions">
          <button class="btn small primary" data-act="credit-confirm" data-id="${c.id}">Registrar crédito</button>
          <button class="btn small ghost" data-act="credit-skip" data-id="${c.id}">Ainda não veio</button>
        </span>
      </div>`;
    }).join("");
  }
  // Data padrão do lançamento do crédito: o dia fixo do período, ou hoje quando o dia varia.
  const creditDateFor = (c, ci) => ci && !ci.estimated && ci.period.startISO <= todayISO() ? ci.period.startISO : todayISO();

  // Registro de um crédito do benefício com valor e data editáveis.
  function creditSheet(card) {
    const ci = creditInfo(card);
    const amt = expectedAmount(card);
    const variable = amountModeOf(card) === "variable";
    openSheet(`
      <h3>Registrar crédito · ${esc(card.name)}</h3>
      <form id="crForm" class="sform">
        <label class="field"><span>Valor que caiu</span><input id="crAmount" class="money num" inputmode="decimal" placeholder="0,00" value="${amt > 0 ? fmtInput(amt) : ""}" autofocus></label>
        ${variable ? `<span class="hint">O valor deste cartão varia. ${amt > 0 ? "Preenchi com o último crédito; confira no app do emissor." : "Confira o valor no app do emissor."}</span>` : ""}
        <label class="field"><span>Data em que caiu</span><input id="crDate" type="date" value="${creditDateFor(card, ci)}"></label>
        <div class="err" id="crErr"></div>
        <div class="btnrow"><button class="btn primary" type="submit">Registrar crédito</button><button class="btn" type="button" data-close>Cancelar</button></div>
      </form>`, () => {
      $("crAmount").select();
      $("crForm").addEventListener("submit", async e => {
        e.preventDefault();
        const v = parseMoney($("crAmount").value);
        const date = $("crDate").value || todayISO();
        if (!(v > 0)) { $("crErr").textContent = "Informe o valor do crédito, por exemplo 812,40."; return; }
        const ok = await run(() => registerCredit(card, v, date), "Crédito registrado.");
        if (ok) closeSheet();
      });
    });
  }
  async function registerCredit(card, amount, date) {
    const d = fromISO(date);
    await postTxs(card, [{ kind: "credit", amount, desc: `Crédito de ${MONTHS[d.getMonth()]}`, date, benefit: true }]);
    if (dayModeOf(card) === "fixed") await Store.patch("cards", card.id, { lastCreditMonth: periodAt(card, d).key });
  }

  function renderHome() {
    if (S.cards.length === 0) {
      return `
      <div class="hero-empty">
        <span class="label">Comece por aqui</span>
        <h2>Cadastre os cartões de benefício da família</h2>
        <p>Cadastre cada cartão com o titular, o emissor (VR, Alelo, Pluxee, Ticket, Flash, Caju…) e o saldo de hoje. Depois lance as compras à mão ou tire foto do cupom fiscal: o app lê o valor e, quando o comprovante traz o saldo do cartão, corrige o saldo daqui.</p>
        <p>Tudo fica guardado só neste celular. Faça backup de vez em quando em Ajustes.</p>
        <div class="btnrow"><button class="btn primary" data-act="new-card">+ Adicionar primeiro cartão</button><button class="btn" data-act="import">Restaurar backup</button></div>
      </div>`;
    }
    const people = holders();
    if (S.person !== null && !people.includes(S.person)) S.person = null;
    const cards = visibleCards();
    const total = cards.reduce((s, c) => s + (c.balance || 0), 0);
    const ids = new Set(cards.map(c => c.id));
    const mk = monthKey(new Date());
    const spent = S.txs.filter(t => ids.has(t.cardId) && t.kind === "debit" && t.source !== "ajuste" && (t.date || "").startsWith(mk)).reduce((s, t) => s + t.amount, 0);
    const recent = S.txs.filter(t => ids.has(t.cardId)).sort(txSort).slice(0, 15);
    const sumOf = h => S.cards.filter(c => (c.holder || "") === h).reduce((s, c) => s + (c.balance || 0), 0);
    const peopleBar = people.length > 1 ? `
      <div class="people" role="group" aria-label="Filtrar por titular">
        <button class="person" data-act="person" data-all="1" aria-pressed="${S.person === null}"><span class="n">Todos</span><span class="v num">${brl(S.cards.reduce((s, c) => s + (c.balance || 0), 0))}</span></button>
        ${people.map(h => `<button class="person" data-act="person" data-p="${esc(h)}" aria-pressed="${S.person === h}"><span class="n">${esc(h || "Sem titular")}</span><span class="v num">${brl(sumOf(h))}</span></button>`).join("")}
      </div>` : "";
    const backupWarn = S.txs.length >= 10 && (!S.meta.lastBackup || Date.now() - S.meta.lastBackup > 30 * 86400000)
      ? `<div class="notice info"><span>${S.meta.lastBackup ? "Seu último backup tem mais de 30 dias." : "Você ainda não fez backup."} Se o celular for perdido ou formatado, os dados vão junto.</span><span class="actions"><button class="btn small primary" data-act="backup">Fazer backup</button></span></div>` : "";
    const credited = S.txs.filter(t => ids.has(t.cardId) && isBenefitCredit(t) && (t.date || "").startsWith(mk)).reduce((s, t) => s + t.amount, 0);
    return `
      <section class="hero">
        <span class="label">Saldo disponível${S.person !== null ? " · " + esc(S.person || "sem titular") : ""}</span>
        <span class="big num">${brl(total)}</span>
        <span class="sub num">${cards.length} ${cards.length === 1 ? "cartão" : "cartões"}${people.length > 1 && S.person === null ? ` de ${people.length} pessoas` : ""}</span>
        <div class="hero-stats">
          <div><span class="k">Gasto em ${MONTHS[new Date().getMonth()]}</span><span class="v num">${brl(spent)}</span></div>
          <div><span class="k">Créditos recebidos</span><span class="v num">${brl(credited)}</span></div>
        </div>
      </section>
      ${peopleBar}
      ${renderCreditNotices(pendingCredits(cards))}
      ${backupWarn}
      ${renderCardToolbar()}
      <div id="cardArea">${renderCardArea()}</div>
      <div class="section-head"><h2>Últimos lançamentos</h2><button class="btn small ghost" data-act="tab" data-tab="extrato">Ver extrato</button></div>
      <section class="panel">
        ${renderTxList(recent, true)}
      </section>`;
  }

  // ---------- ícones ----------
  const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    gasto: svg('<path d="M7 17 17 7M9 7h8v8"/>'),
    credito: svg('<path d="M17 7 7 17M15 17H7V9"/>'),
    cupom: svg('<path d="M4 8a2 2 0 0 1 2-2h1.5l1.5-2h6l1.5 2H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><circle cx="12" cy="12.5" r="3.5"/>'),
    corrigir: svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
    cartao: svg('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/>'),
  };

  // ---------- aba Extrato ----------
  function renderExtrato() {
    if (!S.cards.length) return renderHome();
    return `
      <h1 class="page-title">Extrato</h1>
      <div class="toolbar"><input id="txSearch" class="search" type="search" placeholder="Buscar loja, categoria, cartão, titular ou valor" value="${esc(S.txQuery)}" autocomplete="off" aria-label="Buscar no extrato"></div>
      <div id="txArea">${renderTxArea()}</div>`;
  }
  function renderTxArea() {
    const words = fold(S.txQuery.trim()).split(/\s+/).filter(Boolean);
    const list = S.txs.filter(t => {
      if (!words.length) return true;
      const c = cardById(t.cardId);
      const hay = fold([t.desc, t.cat, c && c.name, c && c.holder, c && c.issuer, fmtInput(t.amount), (t.date || "").split("-").reverse().join("/"), t.kind === "credit" ? "credito" : "gasto"].join(" "));
      return words.every(w => hay.includes(w));
    }).sort(txSort);
    const spent = list.filter(t => t.kind === "debit" && t.source !== "ajuste").reduce((s, t) => s + t.amount, 0);
    const got = list.filter(isBenefitCredit).reduce((s, t) => s + t.amount, 0);
    const shown = list.slice(0, S.txLimit);
    return `
      <div class="tots">
        <div class="tot"><span class="k">Gastos</span><span class="v num">${brl(spent)}</span></div>
        <div class="tot"><span class="k">Créditos</span><span class="v num in">${brl(got)}</span></div>
      </div>
      <section class="panel">${list.length ? renderTxList(shown, true) : `<div class="empty">Nada encontrado para “${esc(S.txQuery)}”.</div>`}</section>
      ${list.length > shown.length ? `<button class="btn more" data-act="more-tx">Mostrar mais (${list.length - shown.length} restantes)</button>` : ""}`;
  }

  // ---------- aba Cofre ----------
  function renderCofre() {
    let state;
    if (!hasCrypto) state = `<div class="notice">O cofre só funciona com o app instalado ou aberto pelo endereço https.</div>`;
    else if (!S.meta.vault) state = `
      <div class="hero-empty">
        <span class="label">Cofre de senhas</span>
        <h2>Guarde as senhas dos cartões com segurança</h2>
        <p>A senha de cada cartão e o login do app do emissor ficam criptografados neste celular com uma senha mestra que só você sabe.</p>
        <div class="btnrow"><button class="btn primary" data-act="vault">Criar cofre</button></div>
      </div>`;
    else state = `
      <section class="panel">
        <div class="panel-head"><h2>${S.key ? "Cofre aberto" : "Cofre trancado"}</h2>${S.key ? `<button class="btn small" data-act="lock">Trancar</button>` : `<button class="btn small primary" data-act="vault">Abrir cofre</button>`}</div>
        <p class="hint">${S.key ? "O cofre tranca sozinho depois de 5 minutos sem uso ou quando você sai do app." : "Abra com a senha mestra para ver ou editar as senhas dos cartões."}</p>
      </section>`;
    const rows = sortedCards().map(c => `<button data-act="edit-secrets" data-id="${c.id}"><span class="t">${esc(c.name)}${c.holder ? ` · ${esc(c.holder)}` : ""}</span><span class="s">${c.secret ? "Senhas guardadas" : "Nenhuma senha guardada"}</span></button>`).join("");
    return `
      <h1 class="page-title">Cofre</h1>
      ${state}
      ${hasCrypto && S.meta.vault && S.cards.length ? `<div class="section-head"><h2>Cartões</h2></div><div class="menu">${rows}</div>` : ""}`;
  }

  // ---------- aba Ajustes ----------
  function renderAjustes() {
    const list = layoutNow() === "list";
    return `
      <h1 class="page-title">Ajustes</h1>
      <div class="section-head"><h2>Seus dados</h2></div>
      <div class="menu">
        <button data-act="m-backup"><span class="t">Fazer backup</span><span class="s">Arquivo com cartões, extratos e senhas (as senhas continuam criptografadas).</span></button>
        <button data-act="import"><span class="t">Restaurar backup</span><span class="s">Substitui os dados deste celular pelos do arquivo.</span></button>
        <button data-act="m-photos"><span class="t">Fotos dos cupons</span><span class="s">Espaço usado e limpeza de fotos antigas.</span></button>
        <button data-act="m-about"><span class="t">Onde ficam os dados</span><span class="s">Como não perder nada ao trocar de celular.</span></button>
      </div>
      <div class="section-head"><h2>Aparência</h2></div>
      <div class="menu">
        <button data-act="m-theme"><span class="t">Tema</span><span class="s">Agora: ${THEMES[themeNow()].toLowerCase()}. ${THEME_HINT[themeNow()]}</span></button>
        <button data-act="layout"><span class="t">Mostrar cartões ${list ? "como cartões" : "em lista"}</span><span class="s">Agora: ${list ? "lista compacta" : "cartões grandes"}.</span></button>
        <button data-act="eye"><span class="t">${S.meta.hideValues ? "Mostrar valores" : "Esconder valores"}</span><span class="s">O mesmo que o botão de olho no topo.</span></button>
      </div>
      ${hasCrypto && S.meta.vault ? `<div class="section-head"><h2>Cofre</h2></div><div class="menu"><button data-act="m-master"><span class="t">Trocar senha mestra</span><span class="s">Recriptografa todas as senhas guardadas.</span></button></div>` : ""}
      ${S.installEvt ? `<div class="menu"><button data-act="install"><span class="t">Instalar o app</span><span class="s">Ícone na tela inicial, tela cheia e uso sem internet.</span></button></div>` : ""}
      <p class="foot num">Ciclo · do crédito ao próximo crédito · versão ${APP_VERSION}</p>`;
  }

  // ---------- tema: automático (segue o celular), claro ou escuro ----------
  // Fica no localStorage para ser aplicado antes do primeiro desenho da tela (ver index.html).
  const THEMES = { auto: "Automático", light: "Claro", dark: "Escuro" };
  const THEME_HINT = { auto: "Segue o modo claro ou escuro do celular.", light: "Sempre claro, mesmo à noite.", dark: "Sempre escuro, cansa menos a vista." };
  const themeNow = () => { try { return localStorage.getItem("ciclo-tema") || "auto"; } catch (e) { return "auto"; } };
  function applyTheme(t) {
    try { if (t === "auto") localStorage.removeItem("ciclo-tema"); else localStorage.setItem("ciclo-tema", t); } catch (e) {}
    const root = document.documentElement;
    if (t === "auto") delete root.dataset.theme; else root.dataset.theme = t;
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
      const dark = t === "auto" ? /dark/.test(m.media) : t === "dark";
      m.content = dark ? "#081417" : "#f3f7f7";
    });
  }
  function themeSheet() {
    const cur = themeNow();
    openSheet(`
      <h3>Tema</h3>
      <div class="menu">
        ${Object.keys(THEMES).map(k => `<button data-t="${k}" aria-pressed="${k === cur}"><span class="t">${THEMES[k]}${k === cur ? " · em uso" : ""}</span><span class="s">${THEME_HINT[k]}</span></button>`).join("")}
      </div>`, sheet => {
      sheet.querySelectorAll("[data-t]").forEach(b => b.addEventListener("click", () => {
        const t = b.dataset.t;
        const go = () => { applyTheme(t); render(); };
        if (document.startViewTransition && !reduceMotion()) { document.documentElement.dataset.nav = "fade"; document.startViewTransition(go); } else go();
        closeSheet();
      }));
    });
  }

  // ---------- botão + ----------
  function actionSheet() {
    if (!S.cards.length) { cardSheet(null); return; }
    const cardId = S.view.name === "card" ? S.view.id : null;
    $("plusBtn").classList.add("open");
    openSheet(`
      <h3>Novo lançamento</h3>
      <div class="actions-grid">
        <button class="qa primary" data-q="gasto">${ICON.gasto}Gasto</button>
        <button class="qa" data-q="cupom">${ICON.cupom}Ler cupom</button>
        <button class="qa" data-q="credito">${ICON.credito}Crédito</button>
        <button class="qa" data-q="cartao">${ICON.cartao}Cartão</button>
      </div>`, sheet => {
      sheetCleanup = () => $("plusBtn").classList.remove("open");
      sheet.querySelectorAll("[data-q]").forEach(b => b.addEventListener("click", () => {
        const q = b.dataset.q;
        if (q === "cupom") { closeSheet(); S.scanCard = cardId; $("fileIn").click(); }
        else if (q === "gasto") txSheet(cardId, "debit");
        else if (q === "credito") txSheet(cardId, "credit");
        else cardSheet(null);
      }));
    });
  }
  function goTab(t) {
    if (t === S.tab && S.view.name !== "card") { window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" }); return; }
    navigate(() => { S.tab = t; S.view = { name: "home" }; render(); });
    const st = history.state || {};
    if (t !== "home") whenHistoryIdle(() => st.tab ? history.replaceState({ tab: t }, "") : history.pushState({ tab: t }, ""));
  }

  // ---------- lista de cartões: busca, grupos por titular, cartões ou lista ----------
  const layoutNow = () => S.meta.layout || (S.cards.length > 6 ? "list" : "grid");
  function renderCardToolbar() {
    if (S.cards.length < 4) return "";
    const list = layoutNow() === "list";
    return `
      <div class="toolbar">
        <input id="cardSearch" class="search" type="search" placeholder="Buscar cartão, titular, emissor ou final" value="${esc(S.cardQuery)}" autocomplete="off" aria-label="Buscar cartão">
        <button class="btn small" data-act="layout">${list ? "Ver como cartões" : "Ver em lista"}</button>
      </div>`;
  }
  function matchesQuery(c, q) {
    if (!q) return true;
    const hay = fold([c.name, c.holder, c.issuer, c.last4, (TYPES[c.type] || TYPES.outro).label].join(" "));
    return fold(q).split(/\s+/).filter(Boolean).every(w => hay.includes(w));
  }
  function groupOpen(h) {
    if (h in S.groups) return S.groups[h];
    return S.cards.length <= MANY;
  }
  function renderCardArea() {
    const q = S.cardQuery.trim();
    const cards = visibleCards().filter(c => matchesQuery(c, q));
    const list = layoutNow() === "list";
    const draw = cs => list
      ? `<div class="cardlist">${cs.map(renderRow).join("")}</div>`
      : `<section class="cards">${cs.map(c => renderTile(c, true)).join("")}</section>`;
    const addBtn = `<button class="btn" data-act="new-card">+ Adicionar cartão</button>`;
    if (!cards.length) return `<div class="empty">Nenhum cartão encontrado para “${esc(q)}”.</div><div class="btnrow">${addBtn}</div>`;
    const people = [...new Set(cards.map(c => c.holder || ""))];
    if (q || S.person !== null || people.length < 2) {
      return `${draw(cards)}<div class="btnrow">${addBtn}</div>`;
    }
    return people.map(h => {
      const cs = cards.filter(c => (c.holder || "") === h);
      const open = groupOpen(h);
      const sum = cs.reduce((s, c) => s + (c.balance || 0), 0);
      return `
        <section class="grp">
          <button class="grp-head" data-act="grp" data-h="${esc(h)}" aria-expanded="${open}">
            <span class="gname">${esc(h || "Sem titular")}</span>
            <span class="gmeta num">${cs.length} ${cs.length === 1 ? "cartão" : "cartões"} · ${brl(sum)}</span>
            <span class="chev" aria-hidden="true">${open ? "▴" : "▾"}</span>
          </button>
          ${open ? draw(cs) : ""}
        </section>`;
    }).join("") + `<div class="btnrow">${addBtn}</div>`;
  }
  function renderRow(c) {
    const st = issuerStyle(c);
    const ci = creditInfo(c);
    const pd = perDayOf(c, ci);
    const perDay = pd !== null ? `${brl(pd)}/dia útil` : ci && ci.overdue ? "aguardando crédito" : (TYPES[c.type] || TYPES.outro).label;
    return `
      <button class="cardrow" data-act="open-card" data-id="${c.id}">
        <span class="badge" style="background:${st.c}">${esc(st.s)}</span>
        <span class="rinfo"><span class="rname">${esc(c.name)}</span><span class="rsub num">${esc([c.holder, c.last4 ? "final " + c.last4 : ""].filter(Boolean).join(" · "))}${c.holder || c.last4 ? " · " : ""}${perDay}</span></span>
        <span class="rbal num">${brl(c.balance || 0)}</span>
      </button>`;
  }

  // ---------- avisos de crédito: um a um ou em lote ----------
  function renderCreditNotices(list) {
    if (list.length <= 1) return renderNotices(list);
    const total = list.reduce((s, { c }) => s + expectedAmount(c), 0);
    return `
      <div class="notice">
        <span><b>${list.length} cartões</b> têm crédito previsto neste período (<span class="num">${brl(total)}</span> no total). Já caíram?</span>
        <span class="actions">
          <button class="btn small primary" data-act="credit-batch">Revisar e registrar</button>
          <button class="btn small ghost" data-act="credit-later">Depois</button>
        </span>
      </div>`;
  }
  function creditBatchSheet() {
    const list = pendingCredits(visibleCards());
    if (!list.length) return;
    openSheet(`
      <h3>Registrar créditos</h3>
      <p class="hint">Desmarque os cartões cujo crédito ainda não caiu. Você pode ajustar o valor de cada um.</p>
      <div class="btnrow"><button class="btn small" type="button" id="cbAll">Marcar todos</button><button class="btn small" type="button" id="cbNone">Desmarcar todos</button></div>
      <form id="cbForm" class="sform">
        <div class="chklist">
          ${list.map(({ c, ci }) => `
            <label class="chkrow">
              <input type="checkbox" data-id="${c.id}" checked>
              <span class="rinfo"><span class="rname">${esc(c.name)}</span><span class="rsub">${esc(c.holder || "sem titular")} · ${ci.estimated ? `previsto ${shortDate(ci.next)}` : `${MONTHS[ci.period.start.getMonth()]}, dia ${esc(c.creditDay)}`}${amountModeOf(c) === "variable" ? " · valor varia" : ""}</span></span>
              <input class="num amt" inputmode="decimal" data-amt="${c.id}" value="${expectedAmount(c) > 0 ? fmtInput(expectedAmount(c)) : ""}" placeholder="valor" aria-label="Valor do crédito de ${esc(c.name)}">
            </label>`).join("")}
        </div>
        <div class="err" id="cbErr"></div>
        <div class="btnrow"><button class="btn primary" type="submit" id="cbGo">Registrar marcados</button><button class="btn" type="button" data-close>Cancelar</button></div>
      </form>`, sheet => {
      const boxes = [...sheet.querySelectorAll('input[type="checkbox"][data-id]')];
      const sync = () => { const n = boxes.filter(b => b.checked).length; $("cbGo").textContent = n ? `Registrar ${n} ${n === 1 ? "crédito" : "créditos"}` : "Nada marcado"; $("cbGo").disabled = !n; };
      boxes.forEach(b => b.addEventListener("change", sync));
      $("cbAll").addEventListener("click", () => { boxes.forEach(b => b.checked = true); sync(); });
      $("cbNone").addEventListener("click", () => { boxes.forEach(b => b.checked = false); sync(); });
      sync();
      $("cbForm").addEventListener("submit", async e => {
        e.preventDefault();
        const chosen = [];
        for (const b of boxes.filter(b => b.checked)) {
          const v = parseMoney(sheet.querySelector(`[data-amt="${b.dataset.id}"]`).value);
          if (!(v > 0)) { $("cbErr").textContent = "Há um valor de crédito inválido. Use o formato 800,00."; return; }
          chosen.push({ id: b.dataset.id, v });
        }
        $("cbGo").disabled = true;
        const ok = await run(async () => {
          for (const { id, v } of chosen) {
            const card = cardById(id); const ci = card && creditInfo(card);
            if (!ci) continue;
            await registerCredit(card, v, creditDateFor(card, ci));
          }
        }, `${chosen.length} ${chosen.length === 1 ? "crédito registrado" : "créditos registrados"}.`);
        if (ok) closeSheet(); else $("cbGo").disabled = false;
      });
    });
  }

  // ---------- seletor de cartão com busca ----------
  function pickLabel(c) {
    if (!c) return "Escolher cartão";
    const st = issuerStyle(c);
    return `<span class="badge sm" style="background:${st.c}">${esc(st.s)}</span><span class="rinfo"><span class="rname">${esc(c.name)}</span><span class="rsub num">${esc([c.holder, c.last4 ? "final " + c.last4 : ""].filter(Boolean).join(" · "))} · ${brl(c.balance || 0)}</span></span><span class="chev" aria-hidden="true">▾</span>`;
  }
  function cardPickerHTML(id, selId) {
    return `
      <input type="hidden" id="${id}" value="${esc(selId || "")}">
      <div class="picker">
        <button type="button" class="pick-btn" id="${id}Btn" aria-expanded="false">${pickLabel(cardById(selId))}</button>
        <div class="pick-panel" id="${id}Panel" hidden>
          <input class="search" id="${id}Q" type="search" placeholder="Buscar por nome, titular, emissor ou final" autocomplete="off" aria-label="Buscar cartão">
          <div class="pick-list" id="${id}List" role="listbox"></div>
        </div>
      </div>`;
  }
  // suggestions: [{card, reasons}] mostrados no topo da lista
  function wirePicker(id, suggestions = []) {
    const hidden = $(id), btn = $(id + "Btn"), panel = $(id + "Panel"), q = $(id + "Q"), listEl = $(id + "List");
    const item = (c, why) => `<button type="button" class="pick-item ${c.id === hidden.value ? "sel" : ""}" data-pick="${c.id}" role="option" aria-selected="${c.id === hidden.value}">${pickLabel(c).replace(/<span class="chev".*$/, "")}${why ? `<span class="why">${esc(why)}</span>` : ""}</button>`;
    const draw = () => {
      const term = q.value.trim();
      const cs = sortedCards().filter(c => matchesQuery(c, term));
      const all = typeof suggestions === "function" ? suggestions() : suggestions;
      const sug = term ? [] : all.filter(s => s.reasons.length).slice(0, 3);
      listEl.innerHTML =
        (sug.length ? `<div class="label pick-sec">Sugeridos</div>${sug.map(s => item(s.card, s.reasons.join(" · "))).join("")}<div class="label pick-sec">Todos os cartões</div>` : "") +
        (cs.length ? cs.map(c => item(c)).join("") : `<div class="empty">Nenhum cartão encontrado.</div>`);
    };
    btn.addEventListener("click", () => {
      const open = panel.hidden;
      panel.hidden = !open; btn.setAttribute("aria-expanded", String(open));
      if (open) { q.value = ""; draw(); q.focus(); }
    });
    q.addEventListener("input", draw);
    listEl.addEventListener("click", e => {
      const b = e.target.closest("[data-pick]"); if (!b) return;
      hidden.value = b.dataset.pick;
      btn.innerHTML = pickLabel(cardById(hidden.value));
      panel.hidden = true; btn.setAttribute("aria-expanded", "false");
      hidden.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function renderTile(c, clickable) {
    const t = TYPES[c.type] || TYPES.outro;
    const ci = creditInfo(c);
    let meta = `<span>${dayModeOf(c) === "variable" ? "Registre um crédito para prever o próximo" : "Sem dia de crédito definido"}</span>`;
    if (ci) {
      const pd = perDayOf(c, ci);
      meta = `<span>${pd !== null ? `${brl(pd)}/dia útil` : "aguardando crédito"}</span><span>${creditWhen(ci)}</span>`;
    }
    const attrs = clickable ? `data-act="open-card" data-id="${c.id}"` : `tabindex="-1" aria-disabled="true"`;
    return `
      <button class="cardtile ${clickable ? "" : "static"}" style="--tc:${issuerStyle(c).c}" ${attrs}>
        <div class="row">
          <div><div class="issuer">${esc(c.issuer || "")}${c.last4 ? ` · final ${esc(c.last4)}` : ""}</div><div class="name">${esc(c.name)}</div>${c.holder ? `<div class="holder">${esc(c.holder)}</div>` : ""}</div>
          <span class="chip">${esc(t.label)}</span>
        </div>
        <div>
          <div class="bal num">${brl(c.balance || 0)}</div>
          <div class="meta num">${meta}</div>
        </div>
      </button>`;
  }

  function renderTxList(list, showCard) {
    if (!list.length) return `<div class="empty">Nenhum lançamento ainda. Use “+ Gasto” ou “Ler cupom”.</div>`;
    const groups = [];
    for (const t of list) {
      const g = groups[groups.length - 1];
      if (g && g.date === t.date) g.items.push(t); else groups.push({ date: t.date, items: [t] });
    }
    return `<div class="txlist">${groups.map(g => `
      <div class="daygrp">
        <span class="label">${esc(fmtDay(g.date))}</span>
        ${g.items.map(t => {
          const c = cardById(t.cardId);
          const who = showCard && c ? [c.name, c.holder].filter(Boolean).join(" · ") : "";
          const part = t.groupId && t.purchaseTotal && t.purchaseTotal !== t.amount ? `parte de uma compra de ${brl(t.purchaseTotal)}` : "";
          const sub = [t.cat, t.source === "cupom" ? "via cupom" : "", part, who].filter(Boolean).join(" · ") || (t.kind === "credit" ? "Crédito" : "Gasto");
          const ic = t.source === "ajuste" ? "±" : t.kind === "credit" ? "+" : (t.cat || t.desc || "?").slice(0, 2);
          return `
          <div class="tx ${t.kind === "credit" ? "in" : ""}">
            <span class="ic">${esc(ic)}</span>
            <div class="d"><div class="t">${esc(t.desc || (t.kind === "credit" ? "Crédito" : "Compra"))}</div><div class="s">${esc(sub)}</div></div>
            <span class="a num ${t.kind === "credit" ? "in" : ""}">${t.kind === "credit" ? "+" : "−"}${brl(t.amount)}${typeof t.reportedBalance === "number" ? `<span class="rb">saldo no cupom ${brl(t.reportedBalance)}</span>` : ""}</span>
            <span class="acts">
              ${t.receiptId ? `<button class="mini" data-act="view-receipt" data-id="${t.id}" aria-label="Ver foto do cupom">foto</button>` : ""}
              <button class="mini x" aria-label="Apagar lançamento" data-act="del-tx" data-id="${t.id}">×</button>
            </span>
          </div>`;
        }).join("")}
      </div>`).join("")}</div>`;
  }

  function renderSecrets(c) {
    let body;
    if (!hasCrypto) body = `<p class="hint">O cofre precisa que o app seja aberto pelo endereço seguro (https) ou instalado. Neste modo ele fica desativado.</p>`;
    else if (!c.secret) body = `<p class="hint">Nenhuma senha guardada para este cartão.</p><div class="btnrow"><button class="btn small" data-act="edit-secrets" data-id="${c.id}">Guardar senhas</button></div>`;
    else if (!S.key) body = `<p class="hint">Senhas guardadas com criptografia. Abra o cofre com a senha mestra para ver.</p><div class="btnrow"><button class="btn small primary" data-act="vault">Abrir cofre</button></div>`;
    else {
      const p = S.plain[c.id];
      if (!p) body = `<div class="loading"><span class="spin"></span>Abrindo…</div>`;
      else if (p.error) body = `<p class="err">Não foi possível abrir as senhas deste cartão com a senha mestra atual.</p>`;
      else {
        const rows = [["pin", "Senha do cartão"], ["login", "Login do app do emissor"], ["appPass", "Senha do app"], ["notes", "Observações"]]
          .filter(([k]) => p[k]).map(([k, label]) => {
            const secret = k === "pin" || k === "appPass";
            const shown = !secret || S.reveal.has(c.id + k);
            return `<div class="srow"><div><div class="k">${label}</div><div class="val ${shown ? "" : "mask"}">${shown ? esc(p[k]) : "••••••"}</div></div>
              <div class="btnrow">${secret ? `<button class="btn small" data-act="reveal" data-id="${c.id}" data-k="${k}">${shown ? "Ocultar" : "Mostrar"}</button>` : ""}<button class="btn small" data-act="copy" data-id="${c.id}" data-k="${k}">Copiar</button></div></div>`;
          }).join("");
        body = `<div class="secrets">${rows || `<p class="hint">Nenhum campo preenchido.</p>`}</div><div class="btnrow"><button class="btn small" data-act="edit-secrets" data-id="${c.id}">Editar senhas</button></div>`;
      }
    }
    return `<section class="panel"><div class="panel-head"><h2>Senhas</h2><span class="label">criptografadas</span></div>${body}</section>`;
  }

  function renderCard(c) {
    const ci = creditInfo(c);
    const cur = periodAt(c, new Date());
    const p = periodShift(c, cur, S.periodOffset);
    const st = periodStats(c, p);
    const isCurrent = S.periodOffset === 0;
    const bal = c.balance || 0;
    let quick = "";
    if (isCurrent && ci) {
      const pd = perDayOf(c, ci);
      const elapsed = Math.round((midnight(new Date()) - p.start) / 86400000) + 1;
      const exp = expectedAmount(c);
      const pct = exp > 0 ? Math.max(0, Math.min(100, Math.round(bal / exp * 100))) : null;
      const amtLabel = amountModeOf(c) === "variable" ? (exp > 0 ? `valor varia · último ${brl(exp)}` : "valor varia") : (c.monthlyCredit ? brl(c.monthlyCredit) : "valor não informado");
      const estLabel = ci.estimated ? (ci.est.samples ? `previsão pela média de ${ci.est.avg} dias entre créditos` : "previsão: 30 dias após o último crédito") : "";
      quick = `
        <div class="stats">
          <div class="stat"><span class="h">Pode gastar por dia útil</span><span class="v num">${pd !== null ? brl(pd) : "—"}</span><span class="h">${pd !== null ? `${ci.workdays} dias úteis até o crédito${ci.estimated ? " (previsto)" : ""}` : "o crédito previsto ainda não foi registrado"}</span></div>
          <div class="stat"><span class="h">Próximo crédito${ci.estimated ? " (previsão)" : ""}</span><span class="v num">${ci.estimated ? "~" : ""}${shortDate(ci.next)}</span><span class="h num">${amtLabel}</span></div>
          <div class="stat"><span class="h">Gasto médio por dia</span><span class="v num">${brl(Math.round(st.debits / Math.max(1, elapsed)))}</span><span class="h">neste período</span></div>
        </div>
        ${estLabel ? `<p class="hint">${esc(estLabel)}. A previsão melhora a cada crédito registrado.</p>` : ""}
        ${pct !== null ? `<div class="pace"><div class="cap"><span>Saldo restante em relação ao ${amountModeOf(c) === "variable" ? "último crédito" : "crédito mensal"}</span><span class="num">${pct}%</span></div><div class="bar"><span style="width:${pct}%"></span></div></div>` : ""}`;
    } else if (isCurrent) {
      quick = dayModeOf(c) === "variable"
        ? `<p class="hint">Este cartão recebe o crédito em dias variados. Registre o próximo crédito em “Adicionar crédito” para o app separar os períodos e prever os seguintes.</p>`
        : `<p class="hint">Informe o dia do crédito em “Editar” (fixo ou variável) para o app calcular quanto dá para gastar por dia útil e separar os períodos pelo ciclo do benefício.</p>`;
    }
    const hasEarlier = S.txs.some(t => t.cardId === c.id && t.date < p.startISO);
    return `
      <div class="btnrow" style="justify-content:space-between">
        <button class="back" data-act="home">← Cartões</button>
        <button class="btn small" data-act="edit-card" data-id="${c.id}">Editar cartão</button>
      </div>
      <section class="cards" style="grid-template-columns:1fr">${renderTile(c, false)}</section>
      ${renderNotices(pendingCredits([c]))}
      <div class="actions-grid">
        <button class="qa primary" data-act="new-tx" data-id="${c.id}" data-kind="debit">${ICON.gasto}Gasto</button>
        <button class="qa" data-act="scan" data-id="${c.id}">${ICON.cupom}Ler cupom</button>
        <button class="qa" data-act="new-tx" data-id="${c.id}" data-kind="credit">${ICON.credito}Crédito</button>
        <button class="qa" data-act="adjust" data-id="${c.id}">${ICON.corrigir}Corrigir</button>
      </div>
      <section class="panel">
        <div class="panel-head">
          <h2>${isCurrent ? "Período atual" : "Período"}</h2>
          <div class="pernav">
            <button class="iconbtn" data-act="per" data-d="-1" aria-label="Período anterior" ${hasEarlier ? "" : "disabled"}>‹</button>
            <span class="p num">${esc(periodLabel(c, p))}</span>
            <button class="iconbtn" data-act="per" data-d="1" aria-label="Próximo período" ${isCurrent ? "disabled" : ""}>›</button>
          </div>
        </div>
        <div class="stats four">
          <div class="stat"><span class="h">Saldo no início</span><span class="v num">${brl(st.opening)}</span></div>
          <div class="stat"><span class="h">Créditos</span><span class="v num in">+${brl(st.credits)}</span></div>
          <div class="stat"><span class="h">Gastos</span><span class="v num">−${brl(st.debits)}</span></div>
          <div class="stat"><span class="h">${isCurrent ? "Saldo agora" : "Saldo no fim"}</span><span class="v num">${brl(isCurrent ? bal : st.closing)}</span>${st.adjust ? `<span class="h num">ajustes ${st.adjust > 0 ? "+" : ""}${brl(st.adjust)}</span>` : ""}</div>
        </div>
        ${quick}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Extrato do período</h2><span class="label num">${st.txs.length} lançamentos</span></div>
        ${renderTxList(st.txs.sort(txSort), false)}
      </section>
      ${renderSecrets(c)}
      <div class="btnrow"><button class="btn danger small" data-act="del-card" data-id="${c.id}">Excluir cartão</button></div>`;
  }

  // ---------- folhas (formulários) ----------
  let sheetCleanup = null;
  // Histórico: cada folha aberta e cada cartão aberto ganham uma entrada, para o "voltar" do Android funcionar.
  // Quando o próprio app chama history.back(), o popstate seguinte é só a confirmação disso.
  const hist = { pending: false, after: [] };
  function whenHistoryIdle(fn) { if (hist.pending) hist.after.push(fn); else fn(); }
  function goBack() { hist.pending = true; history.back(); }

  function openSheet(html, onMount, opts = {}) {
    closeSheet(true, true);
    const root = $("sheetRoot");
    root.innerHTML = `<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
    if (opts.secret) $("scrim").dataset.secret = "1";
    const sheet = root.querySelector(".sheet");
    // Toque fora fecha só janelas sem formulário, para não perder o que foi digitado.
    $("scrim").addEventListener("click", e => { if (e.target.id === "scrim" && !sheet.querySelector("form, #scanBody")) closeSheet(); });
    sheet.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => closeSheet()));
    onMount && onMount(sheet);
    const first = root.querySelector("[autofocus]");
    first && first.focus({ preventScroll: true });
    whenHistoryIdle(() => { if ($("scrim") && !(history.state && history.state.sheet)) history.pushState({ sheet: true }, ""); });
    return sheet;
  }
  // keepHistory: não mexe no histórico (o "voltar" já foi usado). instant: troca de folha, sem animação de saída.
  function closeSheet(keepHistory, instant) {
    if (sheetCleanup) { const f = sheetCleanup; sheetCleanup = null; f(); }
    const scrim = $("scrim");
    if (scrim) {
      if (instant || reduceMotion()) scrim.remove();
      else {
        // tira os ids antes da animação, para a próxima folha não confundir os campos
        scrim.removeAttribute("id");
        scrim.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
        scrim.classList.add("closing");
        setTimeout(() => scrim.remove(), 240);
      }
    }
    if (scrim && keepHistory !== true && !hist.pending && history.state && history.state.sheet) goBack();
  }
  // Botão "voltar" do Android fecha a folha aberta ou volta para a lista de cartões.
  window.addEventListener("popstate", () => {
    if (hist.pending) {
      hist.pending = false;
      const fns = hist.after.splice(0);
      fns.forEach(f => f());
      return;
    }
    if ($("scrim")) { closeSheet(true); return; }
    if (S.view.name === "card") { navigate(() => { S.view = { name: "home" }; render(); }, "back"); return; }
    if (S.tab !== "home" && !(history.state && history.state.tab)) navigate(() => { S.tab = "home"; render(); }, "back");
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && $("scrim")) closeSheet(); });

  function catButtons(cur) { return CATS.map(c => `<button type="button" data-cat="${c}" aria-pressed="${c === cur}">${c}</button>`).join(""); }
  function wireCats(sheet, state) {
    sheet.querySelectorAll(".cats button").forEach(b => b.addEventListener("click", () => {
      state.cat = state.cat === b.dataset.cat ? "" : b.dataset.cat;
      sheet.querySelectorAll(".cats button").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.cat === state.cat)));
    }));
  }
  const defaultCardId = () => S.view.name === "card" ? S.view.id : (visibleCards()[0] || sortedCards()[0]).id;

  function txSheet(cardId, kind = "debit") {
    const sel = cardId || defaultCardId();
    const state = { kind, cat: "" };
    openSheet(`
      <h3 id="txTitle"></h3>
      <div class="seg" role="group" aria-label="Tipo de lançamento">
        <button type="button" data-k="debit">Gasto</button><button type="button" data-k="credit">Crédito</button>
      </div>
      <form id="txForm" class="sform">
        <div id="debitFields" class="field"><span>Pago com vale</span>${splitHTML("ts")}</div>
        <div id="creditFields" class="sform">
          <label class="field"><span>Valor</span><input id="txAmount" class="money num" inputmode="decimal" placeholder="0,00" autocomplete="off"></label>
          <div class="field"><span>Cartão</span>${cardPickerHTML("txCard", sel)}</div>
        </div>
        <div class="field" id="catField"><span>Categoria</span><div class="cats">${catButtons("")}</div></div>
        <label class="check" id="benefitWrap"><input type="checkbox" id="txBenefit" checked> <span>É o crédito do benefício (começa um novo período). Desmarque para estorno ou devolução.</span></label>
        <label class="field"><span>Descrição (opcional)</span><input id="txDesc" maxlength="60" placeholder="Ex.: almoço no restaurante da esquina"></label>
        <label class="field"><span>Data</span><input id="txDate" type="date" value="${todayISO()}"></label>
        <div class="err" id="txErr"></div>
        <div class="btnrow"><button class="btn primary" type="submit">Salvar</button><button class="btn" type="button" data-close>Cancelar</button></div>
      </form>`, sheet => {
      const sync = () => {
        sheet.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.k === state.kind)));
        $("txTitle").textContent = state.kind === "debit" ? "Lançar gasto" : "Adicionar crédito";
        $("catField").hidden = state.kind !== "debit";
        $("benefitWrap").hidden = state.kind !== "credit";
        $("debitFields").hidden = state.kind !== "debit";
        $("creditFields").hidden = state.kind !== "credit";
      };
      sheet.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => {
        state.kind = b.dataset.k; sync();
        (state.kind === "debit" ? split.firstAmountInput() : $("txAmount")).focus();
      }));
      wireCats(sheet, state);
      wirePicker("txCard");
      const split = wireSplit("ts", { vale: [{ cardId: sel, amount: 0 }], other: [] });
      sync();
      (state.kind === "debit" ? split.firstAmountInput() : $("txAmount")).focus();
      $("txForm").addEventListener("submit", async e => {
        e.preventDefault();
        if (state.kind === "debit") {
          const chk = checkSplit(split.get());
          if (chk.err) { $("txErr").textContent = chk.err; return; }
          const date = $("txDate").value || todayISO();
          const warn = dupWarning(chk.parts, date);
          if (warn && !state.dupOk) { state.dupOk = true; $("txErr").textContent = warn; return; }
          let results = [];
          const desc = $("txDesc").value.trim() || state.cat || "Compra";
          const ok = await run(async () => { results = await savePurchase(chk.parts, chk.others, chk.total, { desc, cat: state.cat, date }); });
          if (ok) { toast(results.length === 1 ? `Gasto salvo. Saldo do ${results[0].card.name}: ${brl(results[0].bal)}` : `Gasto salvo em ${results.length} vales.`); closeSheet(); }
          return;
        }
        const amount = parseMoney($("txAmount").value);
        const card = cardById($("txCard").value);
        if (!(amount > 0)) { $("txErr").textContent = "Informe um valor maior que zero, por exemplo 32,90."; return; }
        if (!card) { $("txErr").textContent = "Escolha um cartão."; return; }
        const date = $("txDate").value || todayISO();
        const benefit = state.kind === "credit" && $("txBenefit").checked;
        let bal;
        const ok = await run(async () => {
          if (benefit) { await registerCredit(card, amount, date); bal = cardById(card.id).balance; return; }
          const desc = $("txDesc").value.trim() || (state.kind === "debit" ? (state.cat || "Compra") : "Crédito avulso");
          bal = await postTxs(card, [{ kind: state.kind, amount, desc, cat: state.kind === "debit" ? state.cat : "", date }]);
        });
        if (ok) { toast(state.kind === "debit" ? `Gasto salvo. Saldo do ${card.name}: ${brl(bal)}` : "Crédito salvo."); closeSheet(); }
      });
    });
  }

  function cardSheet(card) {
    const isNew = !card;
    const c = card || { name: "", holder: S.person || "", type: "refeicao", issuer: "VR", last4: "", monthlyCredit: 0, creditDay: "" };
    openSheet(`
      <h3>${isNew ? "Novo cartão" : "Editar cartão"}</h3>
      <form id="cardForm" class="sform">
        <div class="grid2">
          <label class="field"><span>Nome do cartão</span><input id="cName" maxlength="40" value="${esc(c.name)}" placeholder="Ex.: VR Refeição" autofocus></label>
          <label class="field"><span>Titular</span><input id="cHolder" maxlength="40" list="holderList" value="${esc(c.holder || "")}" placeholder="Ex.: Ana"><datalist id="holderList">${holders().filter(Boolean).map(h => `<option value="${esc(h)}">`).join("")}</datalist></label>
        </div>
        <div class="grid2">
          <label class="field"><span>Tipo</span><select id="cType">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${k === c.type ? "selected" : ""}>${v.label}</option>`).join("")}</select></label>
          <label class="field"><span>Emissor</span><select id="cIssuer">${ISSUERS.map(i => `<option ${i === c.issuer ? "selected" : ""}>${esc(i)}</option>`).join("")}</select></label>
        </div>
        <div class="grid2">
          <label class="field"><span>Final do cartão</span><input id="cLast4" inputmode="numeric" maxlength="4" value="${esc(c.last4 || "")}" placeholder="4 últimos dígitos"></label>
          ${isNew ? `<label class="field"><span>Saldo de hoje</span><input id="cBalance" class="num" inputmode="decimal" placeholder="0,00"></label>` : "<span></span>"}
        </div>
        <span class="hint">O final do cartão ajuda a reconhecer de quem é cada cupom fiscal.</span>
        <div class="grid2">
          <label class="field"><span>Valor do crédito</span><select id="cAmtMode"><option value="fixed" ${amountModeOf(c) === "fixed" ? "selected" : ""}>Fixo todo mês</option><option value="variable" ${amountModeOf(c) === "variable" ? "selected" : ""}>Varia</option></select></label>
          <label class="field" id="cCreditWrap"><span>Valor mensal</span><input id="cCredit" class="num" inputmode="decimal" placeholder="0,00" value="${c.monthlyCredit ? fmtInput(c.monthlyCredit) : ""}"></label>
        </div>
        <div class="grid2">
          <label class="field"><span>Dia do crédito</span><select id="cDayMode"><option value="fixed" ${dayModeOf(c) === "fixed" ? "selected" : ""}>Dia fixo</option><option value="variable" ${dayModeOf(c) === "variable" ? "selected" : ""}>Varia</option><option value="none" ${dayModeOf(c) === "none" ? "selected" : ""}>Não controlar</option></select></label>
          <label class="field" id="cDayWrap"><span>Dia do mês</span><input id="cDay" type="number" min="1" max="31" inputmode="numeric" placeholder="ex.: 5" value="${esc(c.creditDay || "")}"></label>
          <label class="field" id="cLastWrap"><span>Último crédito caiu em</span><input id="cLast" type="date" value="${esc(c.lastCreditDate || "")}"></label>
        </div>
        <span class="hint" id="cHint"></span>
        <div class="err" id="cErr"></div>
        <div class="btnrow"><button class="btn primary" type="submit">${isNew ? "Adicionar cartão" : "Salvar alterações"}</button><button class="btn" type="button" data-close>Cancelar</button></div>
      </form>`, () => {
      const syncModes = () => {
        const am = $("cAmtMode").value, dm = $("cDayMode").value;
        $("cCreditWrap").querySelector("span").textContent = am === "fixed" ? "Valor mensal" : "Valor aproximado (opcional)";
        $("cDayWrap").hidden = dm !== "fixed";
        $("cLastWrap").hidden = dm !== "variable";
        $("cHint").textContent = dm === "fixed"
          ? "Cada período vai do dia do crédito até a véspera do próximo."
          : dm === "variable"
            ? "Os períodos vão de um crédito registrado até o seguinte, e o app prevê o próximo pela média entre os créditos. Informe quando caiu o último para começar."
            : "Sem controle de crédito: os períodos são os meses do calendário e não há aviso de crédito.";
        if (am === "variable") $("cHint").textContent += " Como o valor varia, o app pergunta o valor a cada crédito.";
      };
      $("cAmtMode").addEventListener("change", syncModes);
      $("cDayMode").addEventListener("change", syncModes);
      syncModes();
      $("cardForm").addEventListener("submit", async e => {
        e.preventDefault();
        const name = $("cName").value.trim();
        const amountMode = $("cAmtMode").value, dayMode = $("cDayMode").value;
        const credit = $("cCredit").value.trim() ? parseMoney($("cCredit").value) : 0;
        const dayRaw = $("cDay").value.trim();
        const day = dayMode === "fixed" && dayRaw ? Math.round(Number(dayRaw)) : "";
        const lastCreditDate = dayMode === "variable" ? $("cLast").value : "";
        const last4 = $("cLast4").value.trim();
        if (!name) { $("cErr").textContent = "Dê um nome ao cartão."; return; }
        if (last4 && !/^\d{4}$/.test(last4)) { $("cErr").textContent = "O final do cartão deve ter 4 números."; return; }
        if (isNaN(credit) || credit < 0) { $("cErr").textContent = "Valor do crédito inválido. Use o formato 800,00."; return; }
        if (dayMode === "fixed" && !(day >= 1 && day <= 31)) { $("cErr").textContent = "Informe o dia do crédito, entre 1 e 31."; return; }
        if (lastCreditDate && lastCreditDate > todayISO()) { $("cErr").textContent = "A data do último crédito não pode ser no futuro."; return; }
        const fields = { name, holder: $("cHolder").value.trim(), type: $("cType").value, issuer: $("cIssuer").value, last4, monthlyCredit: credit, creditDay: day, dayMode, amountMode, lastCreditDate };
        if (isNew) {
          const bal = $("cBalance").value.trim() ? parseMoney($("cBalance").value) : 0;
          if (isNaN(bal) || bal < 0) { $("cErr").textContent = "Saldo inválido. Use o formato 450,75."; return; }
          const newCard = { id: uid(), ...fields, balance: 0, createdAt: Date.now(), secret: null };
          // O saldo informado já inclui o crédito do período atual.
          if (day) newCard.lastCreditMonth = periodAt(newCard, new Date()).key;
          const ok = await run(async () => {
            await Store.put("cards", newCard);
            if (bal > 0) await postTxs(newCard, [{ kind: "credit", amount: bal, desc: "Saldo inicial", source: "ajuste", date: todayISO() }]);
          }, "Cartão adicionado.");
          if (ok) { askPersist(); closeSheet(); openCard(newCard.id); }
        } else {
          const ok = await run(() => Store.patch("cards", card.id, fields), "Cartão atualizado.");
          if (ok) closeSheet();
        }
      });
    });
  }

  function adjustSheet(card) {
    openSheet(`
      <h3>Corrigir saldo</h3>
      <p class="hint">Use quando o saldo do app do ${esc(card.issuer || "emissor")} for diferente do daqui. A diferença entra no extrato como “Ajuste de saldo”.</p>
      <form id="adjForm" class="sform">
        <label class="field"><span>Saldo real hoje</span><input id="adjVal" class="money num" inputmode="decimal" value="${fmtInput(card.balance || 0)}" autofocus></label>
        <div class="err" id="adjErr"></div>
        <div class="btnrow"><button class="btn primary" type="submit">Salvar saldo</button><button class="btn" type="button" data-close>Cancelar</button></div>
      </form>`, () => {
      $("adjVal").select();
      $("adjForm").addEventListener("submit", async e => {
        e.preventDefault();
        const v = parseMoney($("adjVal").value);
        if (isNaN(v) || v < 0) { $("adjErr").textContent = "Digite o saldo no formato 123,45."; return; }
        const diff = v - (card.balance || 0);
        if (diff === 0) { closeSheet(); return; }
        const ok = await run(() => postTxs(card, [{ kind: diff > 0 ? "credit" : "debit", amount: Math.abs(diff), desc: "Ajuste de saldo", source: "ajuste", date: todayISO() }]), "Saldo corrigido.");
        if (ok) closeSheet();
      });
    });
  }

  function confirmSheet(title, html, label, action) {
    openSheet(`
      <h3>${esc(title)}</h3>
      <p>${html}</p>
      <div class="btnrow"><button class="btn dangerfill" id="cfOk">${esc(label)}</button><button class="btn" data-close>Cancelar</button></div>`, () => {
      $("cfOk").addEventListener("click", async () => { const ok = await action(); if (ok) closeSheet(); });
    });
  }

  // ---------- cofre: criar, abrir, editar ----------
  function vaultSheet(then) {
    if (!hasCrypto) { toast("O cofre só funciona com o app instalado ou aberto pelo endereço https."); return; }
    if (!S.meta.vault) {
      openSheet(`
        <h3>Criar cofre de senhas</h3>
        <p class="hint">As senhas dos cartões são criptografadas neste celular com a sua senha mestra. Ninguém consegue ler sem ela, nem você: se esquecer a senha mestra, as senhas guardadas não podem ser recuperadas.</p>
        <form id="vForm" class="sform">
          <label class="field"><span>Senha mestra</span><input id="v1" type="password" autocomplete="new-password" autofocus></label>
          <label class="field"><span>Repita a senha mestra</span><input id="v2" type="password" autocomplete="new-password"></label>
          <div class="err" id="vErr"></div>
          <div class="btnrow"><button class="btn primary" type="submit" id="vBtn">Criar cofre</button><button class="btn" type="button" data-close>Cancelar</button></div>
        </form>`, () => {
        $("vForm").addEventListener("submit", async e => {
          e.preventDefault();
          const a = $("v1").value, b = $("v2").value;
          if (a.length < 8) { $("vErr").textContent = "Use pelo menos 8 caracteres."; return; }
          if (a !== b) { $("vErr").textContent = "As duas senhas não são iguais."; return; }
          $("vBtn").disabled = true;
          const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
          const key = await deriveKey(a, salt);
          const check = await seal(key, { ok: "ciclo" });
          const ok = await run(() => Store.setMeta({ ...S.meta, vault: { salt, ...check } }), "Cofre criado e aberto.");
          if (ok) { S.key = key; touchVault(); closeSheet(); render(); then && then(); }
          else $("vBtn").disabled = false;
        });
      }, { secret: true });
      return;
    }
    openSheet(`
      <h3>Abrir cofre</h3>
      <form id="uForm" class="sform">
        <label class="field"><span>Senha mestra</span><input id="u1" type="password" autocomplete="current-password" autofocus></label>
        <div class="err" id="uErr"></div>
        <div class="btnrow"><button class="btn primary" type="submit" id="uBtn">Abrir</button><button class="btn" type="button" data-close>Cancelar</button></div>
        <span class="hint">O cofre tranca sozinho depois de 5 minutos sem uso ou quando você sai do app.</span>
      </form>`, () => {
      $("uForm").addEventListener("submit", async e => {
        e.preventDefault();
        $("uBtn").disabled = true; $("uErr").textContent = "";
        try {
          const key = await deriveKey($("u1").value, S.meta.vault.salt);
          await unseal(key, S.meta.vault);
          S.key = key; touchVault(); closeSheet(); render(); then && then();
        } catch (err) {
          $("uErr").textContent = "Senha mestra incorreta.";
          $("uBtn").disabled = false; $("u1").select();
        }
      });
    }, { secret: true });
  }

  function secretsSheet(card) {
    if (!S.key) { vaultSheet(() => secretsSheet(cardById(card.id))); return; }
    const p = S.plain[card.id] && !S.plain[card.id].error ? S.plain[card.id] : {};
    openSheet(`
      <h3>Senhas · ${esc(card.name)}</h3>
      <form id="sForm" class="sform" autocomplete="off">
        <label class="field"><span>Senha do cartão</span><input id="sPin" type="password" inputmode="numeric" autocomplete="new-password" value="${esc(p.pin || "")}" autofocus></label>
        <div class="grid2">
          <label class="field"><span>Login do app do emissor</span><input id="sLogin" autocomplete="off" value="${esc(p.login || "")}" placeholder="CPF ou e-mail"></label>
          <label class="field"><span>Senha do app</span><input id="sApp" type="password" autocomplete="new-password" value="${esc(p.appPass || "")}"></label>
        </div>
        <label class="field"><span>Observações</span><input id="sNotes" maxlength="120" autocomplete="off" value="${esc(p.notes || "")}"></label>
        <label class="check"><input type="checkbox" id="sShow"> Mostrar o que estou digitando</label>
        <div class="err" id="sErr"></div>
        <div class="btnrow">
          <button class="btn primary" type="submit">Salvar senhas</button>
          <button class="btn" type="button" data-close>Cancelar</button>
          ${card.secret ? `<button class="btn danger" type="button" id="sDel">Apagar senhas</button>` : ""}
        </div>
      </form>`, () => {
      $("sShow").addEventListener("change", e => { ["sPin", "sApp"].forEach(id => $(id).type = e.target.checked ? "text" : "password"); });
      $("sDel") && $("sDel").addEventListener("click", async () => {
        const ok = await run(() => Store.patch("cards", card.id, { secret: null }), "Senhas apagadas.");
        if (ok) closeSheet();
      });
      $("sForm").addEventListener("submit", async e => {
        e.preventDefault();
        if (!S.key) { $("sErr").textContent = "O cofre trancou. Abra de novo para salvar."; return; }
        const data = { pin: $("sPin").value, login: $("sLogin").value.trim(), appPass: $("sApp").value, notes: $("sNotes").value.trim() };
        const empty = !data.pin && !data.login && !data.appPass && !data.notes;
        const box = empty ? null : await seal(S.key, data);
        const ok = await run(() => Store.patch("cards", card.id, { secret: box }), "Senhas salvas no cofre.");
        if (ok) closeSheet();
      });
    }, { secret: true });
  }

  function changeMasterSheet() {
    if (!S.meta.vault) { vaultSheet(); return; }
    openSheet(`
      <h3>Trocar senha mestra</h3>
      <form id="mForm" class="sform">
        <label class="field"><span>Senha mestra atual</span><input id="m0" type="password" autocomplete="current-password" autofocus></label>
        <label class="field"><span>Nova senha mestra</span><input id="m1" type="password" autocomplete="new-password"></label>
        <label class="field"><span>Repita a nova senha</span><input id="m2" type="password" autocomplete="new-password"></label>
        <div class="err" id="mErr"></div>
        <div class="btnrow"><button class="btn primary" type="submit" id="mBtn">Trocar</button><button class="btn" type="button" data-close>Cancelar</button></div>
      </form>`, () => {
      $("mForm").addEventListener("submit", async e => {
        e.preventDefault();
        const a = $("m1").value;
        if (a.length < 8) { $("mErr").textContent = "Use pelo menos 8 caracteres."; return; }
        if (a !== $("m2").value) { $("mErr").textContent = "As duas senhas novas não são iguais."; return; }
        $("mBtn").disabled = true;
        let oldKey;
        try { oldKey = await deriveKey($("m0").value, S.meta.vault.salt); await unseal(oldKey, S.meta.vault); }
        catch (err) { $("mErr").textContent = "Senha mestra atual incorreta."; $("mBtn").disabled = false; return; }
        const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
        const newKey = await deriveKey(a, salt);
        const ok = await run(async () => {
          for (const c of S.cards.filter(c => c.secret)) {
            const plain = await unseal(oldKey, c.secret);
            await Store.patch("cards", c.id, { secret: await seal(newKey, plain) });
          }
          await Store.setMeta({ ...S.meta, vault: { salt, ...(await seal(newKey, { ok: "ciclo" })) } });
        }, "Senha mestra trocada.");
        if (ok) { S.key = newKey; S.plainSig = {}; touchVault(); closeSheet(); render(); }
        else $("mBtn").disabled = false;
      });
    }, { secret: true });
  }

  // ---------- cupom fiscal ----------
  // Foto guardada: lado maior ≤ 1280 px, tons de cinza, JPEG leve (~60–150 KB), ainda legível para conferir o cupom.
  async function shrink(file, max = 1280, q = 0.6) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
      const ctx = cv.getContext("2d");
      ctx.filter = "grayscale(1) contrast(1.15)";
      ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
      return (await new Promise(r => cv.toBlob(r, "image/jpeg", q))) || file;
    } catch (e) { return file; }
  }

  const scanQueue = [];
  function startScan(files, cardId) {
    const list = [...files].filter(f => /^image\//.test(f.type) || !f.type);
    if (!list.length) { toast("Escolha uma foto do cupom."); return; }
    list.forEach(f => scanQueue.push({ file: f, cardId }));
    if (!$("scrim")) nextScan();
  }
  function nextScan() { const job = scanQueue.shift(); if (job) scanOne(job.file, job.cardId); }

  async function scanOne(file, presetCardId) {
    const url = URL.createObjectURL(file);
    let alive = true;
    const remaining = scanQueue.length;
    const sheet = openSheet(`
      <h3>Ler cupom${remaining ? ` <span class="hint num">(mais ${remaining} na fila)</span>` : ""}</h3>
      <img class="receipt-img" src="${url}" alt="Foto do cupom">
      <div id="scanBody">
        <div class="loading"><span class="spin"></span><span id="scanStatus">Preparando…</span></div>
        <div class="progress" style="margin-top:10px"><span id="scanBar"></span></div>
        <div class="btnrow" style="margin-top:12px"><button class="btn" id="scanStop">Preencher à mão</button></div>
      </div>`);
    sheetCleanup = () => { alive = false; URL.revokeObjectURL(url); scanQueue.length = 0; };
    const stored = shrink(file);
    $("scanStop").addEventListener("click", async () => { alive = false; reviewForm(sheet, await stored, presetCardId, null, "Preencha os dados do cupom.", ""); });
    const labels = { "preparando a foto": "Preparando a foto…", "loading tesseract core": "Carregando o leitor…", "initializing tesseract": "Carregando o leitor…", "loading language traineddata": "Carregando o português…", "initializing api": "Carregando o leitor…", "recognizing text": "Lendo o texto do cupom…" };
    try {
      const text = await ReceiptReader.readText(file, (status, p) => {
        if (!alive || !$("scanStatus")) return;
        $("scanStatus").textContent = labels[status] || "Lendo…";
        $("scanBar").style.width = Math.round((status === "recognizing text" ? 0.3 + p * 0.7 : p * 0.3) * 100) + "%";
      });
      if (!alive || !$("scanBody")) return;
      const parsed = ReceiptReader.parse(text);
      const empty = !parsed.found.length;
      reviewForm(sheet, await stored, presetCardId, parsed, empty ? "Não encontrei valores nesta foto. Confira se o cupom está inteiro, reto e bem iluminado, ou preencha à mão." : null, text);
    } catch (e) {
      console.error(e);
      if (!alive || !$("scanBody")) return;
      reviewForm(sheet, await stored, presetCardId, null, "Não foi possível ler a foto. Preencha os dados do cupom.", "");
    }
  }

  // Chave da loja: CNPJ do cupom ou, sem ele, o nome normalizado.
  const storeKeyOf = d => d && d.cnpj ? "cnpj:" + d.cnpj : d && d.store ? "loja:" + fold(d.store).replace(/[^a-z0-9]/g, "").slice(0, 24) : null;
  const descKey = s => "loja:" + fold(s).replace(/[^a-z0-9]/g, "").slice(0, 24);

  // Pontua cada cartão como provável pagador do cupom. Sinais, do mais forte ao mais fraco:
  // final do cartão, saldo impresso que fecha com o saldo daqui, loja onde o cartão já foi usado, emissor, tipo.
  function rankCards(d, amount, saldos, presetCardId) {
    const saldoList = (Array.isArray(saldos) ? saldos : [saldos]).filter(s => s !== null && s >= 0);
    const finals = new Set([...(d && d.last4s) || [], ...(d && d.last4 ? [d.last4] : [])]);
    const key = storeKeyOf(d);
    const nameKey = d && d.store ? descKey(d.store) : null;
    const used = {};
    if (key || nameKey) for (const t of S.txs) {
      if (t.kind !== "debit") continue;
      if ((key && t.storeKey === key) || (nameKey && descKey(t.desc || "") === nameKey)) used[t.cardId] = (used[t.cardId] || 0) + 1;
    }
    return S.cards.map(c => {
      let score = 0; const reasons = [];
      if (c.last4 && finals.has(c.last4)) { score += 100; reasons.push("final " + c.last4); }
      const bal = c.balance || 0;
      if (amount > 0 && saldoList.some(s => Math.abs(bal - amount - s) <= 1)) { score += 90; reasons.push("o saldo do cupom fecha com este cartão"); }
      else if (saldoList.some(s => Math.abs(bal - s) <= 1)) { score += 50; reasons.push("saldo igual ao do cupom"); }
      if (used[c.id]) { score += Math.min(45, 15 * used[c.id]); reasons.push(used[c.id] === 1 ? "já usado nesta loja" : `usado ${used[c.id]} vezes nesta loja`); }
      if (d && d.issuer && c.issuer === d.issuer) { score += 20; reasons.push(d.issuer); }
      if (d && d.category) {
        if (d.category === "Mercado" && c.type === "alimentacao") score += 5;
        if (["Restaurante", "Lanche", "Padaria", "Delivery"].includes(d.category) && c.type === "refeicao") score += 5;
      }
      if (c.id === presetCardId) score += 30;
      return { card: c, score, reasons };
    }).sort((a, b) => b.score - a.score || (a.card.createdAt || 0) - (b.card.createdAt || 0));
  }

  // ---------- divisão do pagamento: vários vales + crédito, débito, Pix, dinheiro ----------
  const OTHER_KINDS = { credito: "Cartão de crédito", debito: "Cartão de débito", pix: "Pix", dinheiro: "Dinheiro", outro: "Outra forma" };
  let splitSeq = 0;
  function splitHTML(p) {
    return `
      <div class="split" id="${p}Split">
        <div class="split-rows" id="${p}Rows"></div>
        <div class="btnrow"><button type="button" class="btn small" id="${p}AddVale">+ Outro vale</button><button type="button" class="btn small" id="${p}AddOther">+ Crédito, débito, Pix ou dinheiro</button></div>
        <label class="field" id="${p}TotalWrap"><span>Total da compra</span><input id="${p}Total" class="num" inputmode="decimal" placeholder="soma das formas de pagamento"></label>
        <div class="split-status num" id="${p}Status" role="status"></div>
      </div>`;
  }
  // init: { vale: [{cardId, amount}], other: [{kind, amount}], total, suggest(amount) => ranking }
  function wireSplit(p, init) {
    const rowsEl = $(p + "Rows"), totalEl = $(p + "Total");
    const listeners = [];
    if (init.total > 0) totalEl.value = fmtInput(init.total);
    const valeRows = () => [...rowsEl.querySelectorAll('.split-row[data-kind="vale"]')];
    const otherRows = () => [...rowsEl.querySelectorAll('.split-row[data-kind="other"]')];
    function addVale(cardId, amount, focus) {
      const id = p + "C" + (++splitSeq);
      const row = document.createElement("div");
      row.className = "split-row"; row.dataset.kind = "vale"; row.dataset.pid = id;
      row.innerHTML = `
        <div class="split-main">${cardPickerHTML(id, cardId || "")}</div>
        <div class="split-side"><input class="num amt money" inputmode="decimal" placeholder="0,00" value="${amount > 0 ? fmtInput(amount) : ""}" aria-label="Valor pago com este vale"><button type="button" class="mini x" data-rm aria-label="Remover esta forma de pagamento">×</button></div>
        <div class="split-after hint num"></div>`;
      rowsEl.appendChild(row);
      wirePicker(id, () => init.suggest ? init.suggest(parseMoney(row.querySelector(".amt").value) || 0) : []);
      if (focus) row.querySelector(".amt").focus();
      update();
    }
    function addOther(kind, amount, focus) {
      const row = document.createElement("div");
      row.className = "split-row"; row.dataset.kind = "other";
      row.innerHTML = `
        <div class="split-main"><select class="okind" aria-label="Forma de pagamento">${Object.entries(OTHER_KINDS).map(([k, v]) => `<option value="${k}" ${k === kind ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div class="split-side"><input class="num amt" inputmode="decimal" placeholder="0,00" value="${amount > 0 ? fmtInput(amount) : ""}" aria-label="Valor pago desta forma"><button type="button" class="mini x" data-rm aria-label="Remover esta forma de pagamento">×</button></div>
        <div class="split-after hint">Não mexe no saldo de nenhum vale.</div>`;
      rowsEl.appendChild(row);
      if (focus) row.querySelector(".amt").focus();
      update();
    }
    const amt = row => { const v = row.querySelector(".amt").value.trim(); return v ? parseMoney(v) : 0; };
    function get() {
      const t = totalEl.value.trim();
      return {
        vale: valeRows().map(r => ({ cardId: $(r.dataset.pid).value, amount: amt(r) })),
        other: otherRows().map(r => ({ kind: r.querySelector(".okind").value, amount: amt(r) })),
        total: t ? parseMoney(t) : null,
      };
    }
    function update() {
      const vr = valeRows();
      vr.forEach(r => {
        r.querySelector("[data-rm]").hidden = vr.length === 1;
        const c = cardById($(r.dataset.pid).value), a = amt(r), out = r.querySelector(".split-after");
        if (!c) { out.textContent = "Escolha o cartão que pagou esta parte."; return; }
        if (!(a > 0)) { out.textContent = `Saldo atual: ${brl(c.balance || 0)}`; return; }
        const after = (c.balance || 0) - a;
        out.textContent = `Saldo do ${c.name} depois desta compra: ${brl(after)}${after < 0 ? " (ficaria negativo, confira)" : ""}`;
      });
      const sp = get();
      const vs = sp.vale.reduce((s, r) => s + (r.amount > 0 ? r.amount : 0), 0);
      const os = sp.other.reduce((s, r) => s + (r.amount > 0 ? r.amount : 0), 0);
      const st = $(p + "Status");
      const multi = vr.length > 1 || otherRows().length > 0;
      $(p + "TotalWrap").hidden = !multi && !(sp.total > 0);
      if (!multi) { st.textContent = ""; return; }
      let txt = `Vales: ${brl(vs)}${os ? ` · outras formas: ${brl(os)}` : ""}`;
      if (sp.total > 0) {
        const diff = sp.total - vs - os;
        txt += diff === 0 ? " · confere com o total" : diff > 0 ? ` · faltam ${brl(diff)} para o total` : ` · ${brl(-diff)} a mais que o total`;
        st.classList.toggle("bad", diff !== 0);
      } else st.classList.remove("bad");
      st.textContent = txt;
    }
    rowsEl.addEventListener("input", () => { update(); listeners.forEach(f => f()); });
    rowsEl.addEventListener("change", () => { update(); listeners.forEach(f => f()); });
    rowsEl.addEventListener("click", e => {
      const rm = e.target.closest("[data-rm]"); if (!rm) return;
      rm.closest(".split-row").remove(); update(); listeners.forEach(f => f());
    });
    totalEl.addEventListener("input", () => { update(); listeners.forEach(f => f()); });
    $(p + "AddVale").addEventListener("click", () => addVale("", 0, true));
    $(p + "AddOther").addEventListener("click", () => addOther("pix", 0, true));
    (init.vale.length ? init.vale : [{ cardId: "", amount: 0 }]).forEach(v => addVale(v.cardId, v.amount));
    (init.other || []).forEach(o => addOther(o.kind, o.amount));
    return { get, onChange: f => listeners.push(f), firstAmountInput: () => valeRows()[0].querySelector(".amt") };
  }
  // Confere a divisão e devolve as partes pagas com vale, ou uma mensagem de erro.
  function checkSplit(sp, allowEmpty) {
    if (sp.vale.some(r => isNaN(r.amount) || r.amount < 0) || sp.other.some(r => isNaN(r.amount) || r.amount < 0)) return { err: "Há um valor inválido. Use o formato 32,90." };
    if (sp.total !== null && (isNaN(sp.total) || sp.total < 0)) return { err: "Total da compra inválido. Use o formato 120,50." };
    const parts = sp.vale.filter(r => r.amount > 0);
    if (parts.some(r => !cardById(r.cardId))) return { err: "Escolha o cartão de cada vale usado." };
    const ids = parts.map(r => r.cardId);
    if (new Set(ids).size !== ids.length) return { err: "O mesmo cartão aparece duas vezes. Some os valores numa linha só." };
    if (!parts.length && !allowEmpty) return { err: "Informe quanto foi pago com vale, por exemplo 32,90." };
    const others = sp.other.filter(r => r.amount > 0);
    const sum = parts.reduce((s, r) => s + r.amount, 0) + others.reduce((s, r) => s + r.amount, 0);
    if (sp.total > 0 && sp.total !== sum) return { err: `As formas de pagamento somam ${brl(sum)}, mas o total é ${brl(sp.total)}. Ajuste os valores ou o total.` };
    return { parts, others, total: sp.total > 0 ? sp.total : sum };
  }
  // Grava uma compra (dividida ou não): um gasto por vale, todos ligados pela mesma compra.
  async function savePurchase(parts, others, total, base, extraFor) {
    const split = parts.length > 1 || others.length > 0;
    const purchase = split ? { groupId: uid(), purchaseTotal: total, otherPay: others.map(o => ({ kind: o.kind, amount: o.amount })) } : {};
    const results = [];
    for (const r of parts) {
      const card = cardById(r.cardId);
      const list = [{ kind: "debit", amount: r.amount, ...base, ...purchase }, ...(extraFor ? extraFor(card, r) : [])];
      results.push({ card, bal: await postTxs(card, list) });
    }
    return results;
  }
  function dupWarning(parts, date) {
    for (const r of parts) {
      const dup = S.txs.find(t => t.cardId === r.cardId && t.kind === "debit" && t.amount === r.amount && t.date === date);
      if (dup) return `Já existe um gasto de ${brl(r.amount)} no ${cardById(r.cardId).name} em ${fmtDay(date).toLowerCase()} (“${dup.desc}”). Toque em Salvar de novo se for outra compra.`;
    }
    return null;
  }

  function reviewForm(sheet, blob, presetCardId, d, msg, rawText) {
    if (!sheet.querySelector("#scanBody")) return;
    d = d || {};
    // Saldos impressos (um por comprovante de vale), já como "saldo depois da compra"
    let saldos = d.balances && d.balances.length ? d.balances.slice() : typeof d.balance === "number" ? [d.balance] : [];
    if (saldos.length === 1 && d.balanceMoment === "antes_compra" && d.paid > 0) saldos = [saldos[0] - d.paid];
    // Partes pagas com vale e com outras formas, lidas da NFC-e
    const pays = d.payments || [];
    let valeAmts = pays.filter(p => p.kind === "vale").map(p => p.amount);
    if (!valeAmts.length && d.paid > 0) valeAmts = [d.paid];
    const others = pays.filter(p => p.kind !== "vale").map(p => ({ kind: p.kind, amount: p.amount }));
    // Escolhe um cartão para cada parte, sem repetir, do mais provável para o menos provável
    const taken = new Set();
    const parts = (valeAmts.length ? valeAmts : [0]).map((a, i) => {
      const r = rankCards(d, a, saldos, presetCardId).filter(x => !taken.has(x.card.id));
      const pick = r[0] && r[0].score > 0 ? r[0] : null;
      if (pick) taken.add(pick.card.id);
      const confident = pick && pick.score >= 50 && (!r[1] || pick.score - r[1].score >= 20);
      return { amount: a, pick, confident, cardId: pick ? pick.card.id : i === 0 ? (presetCardId || defaultCardId()) : "" };
    });
    const suggestLine = parts.map((pt, i) => pt.pick && pt.pick.reasons.length
      ? `<span>${parts.length > 1 ? `Vale ${i + 1} (${brl(pt.amount)}): ` : "Cartão "}${pt.confident ? "identificado" : "provável"}: <b>${esc(pt.pick.card.name)}</b>${pt.pick.card.holder ? ` (${esc(pt.pick.card.holder)})` : ""} · ${esc(pt.pick.reasons.join(", "))}${pt.confident ? "" : " (confira o cartão)"}</span>`
      : S.cards.length > 1 ? `<span>${parts.length > 1 ? `Vale ${i + 1}: n` : "N"}ão consegui identificar o cartão pelo cupom. Escolha abaixo.</span>` : "").join("");
    const date = d.date || todayISO();
    const state = { cat: d.category || "", dupOk: false };
    const payLine = pays.length > 1 ? `<span>Pagamento: ${esc(pays.map(p => `${p.kind === "vale" ? "vale" : OTHER_KINDS[p.kind] || p.kind} ${brl(p.amount)}`).join(" + "))}</span>` : "";
    const summary = d.found && d.found.length ? `
      <div class="found">
        <span><b>Encontrado no cupom:</b> ${esc(d.found.join(", "))}${d.issuer ? ` · ${esc(d.issuer)}` : ""}${d.last4 ? ` final ${esc(d.last4)}` : ""}</span>
        ${payLine}
        <span>${saldos.length ? `Saldo${saldos.length > 1 ? "s" : ""} do vale impresso${saldos.length > 1 ? "s" : ""}: <b class="num">${saldos.map(brl).join(" · ")}</b>${d.balanceMoment === "antes_compra" ? " (já descontada esta compra)" : ""}` : "O cupom não mostra o saldo do cartão: o saldo daqui será descontado pelo valor pago."}</span>
        ${suggestLine}
        <span class="hint">Confira os valores com o papel antes de salvar.</span>
      </div>` : (suggestLine ? `<div class="found">${suggestLine}</div>` : "");
    sheet.querySelector("#scanBody").outerHTML = `
      ${msg ? `<div class="notice">${esc(msg)}</div>` : ""}
      ${summary}
      <form id="rForm" class="sform">
        <div class="field"><span>Pago com vale</span>${splitHTML("rs")}</div>
        <div class="grid2">
          <label class="field"><span>Estabelecimento</span><input id="rDesc" maxlength="60" value="${esc(d.store || "")}"></label>
          <label class="field"><span>Data</span><input id="rDate" type="date" value="${date}"></label>
        </div>
        <div class="field"><span>Categoria</span><div class="cats">${catButtons(state.cat)}</div></div>
        <div id="rSaldoBox">
          <label class="field"><span>Saldo do vale impresso no cupom (se houver)</span><input id="rSaldo" class="num" inputmode="decimal" placeholder="não informado" value="${saldos.length === 1 && saldos[0] >= 0 ? fmtInput(saldos[0]) : ""}"></label>
          <label class="check" id="rUseWrap"><input type="checkbox" id="rUse"> <span id="rUseTxt"></span></label>
        </div>
        ${rawText ? `<details class="raw"><summary>Ver texto lido da foto</summary><pre></pre></details>` : ""}
        <div class="err" id="rErr"></div>
        <div class="btnrow">
          <button class="btn primary" type="submit" id="rSave">Salvar</button>
          <button class="btn" type="button" id="rSkip">${scanQueue.length ? "Pular este cupom" : "Cancelar"}</button>
        </div>
      </form>`;
    const pre = sheet.querySelector("details.raw pre");
    if (pre) pre.textContent = rawText;
    wireCats(sheet, state);
    const split = wireSplit("rs", {
      vale: parts.map(pt => ({ cardId: pt.cardId, amount: pt.amount })),
      other: others,
      total: pays.length > 1 && d.total > 0 ? d.total : null,
      suggest: a => rankCards(d, a, saldos, presetCardId),
    });
    // Conciliação pelo saldo impresso: só quando a compra usou um único vale.
    const single = () => { const sp = split.get(); return sp.vale.length === 1 ? sp.vale[0] : null; };
    const syncUse = () => {
      const one = single();
      $("rSaldoBox").hidden = !one;
      const card = one && cardById(one.cardId);
      const s = parseMoney($("rSaldo").value);
      const a = one ? one.amount : 0;
      const wrap = $("rUseWrap");
      wrap.hidden = !(s >= 0) || !card;
      if (wrap.hidden) return;
      const newer = $("rDate").value >= lastTxDate(card.id);
      const expected = (card.balance || 0) - (a > 0 ? a : 0);
      const diff = s - expected;
      $("rUseTxt").innerHTML = diff === 0
        ? `O saldo do cupom confere com o saldo daqui depois desta compra (<span class="num">${brl(s)}</span>).`
        : `Usar o saldo do cupom como saldo atual do ${esc(card.name)}: passa a <b class="num">${brl(s)}</b> (diferença de <span class="num">${diff > 0 ? "+" : ""}${brl(diff)}</span> entra como ajuste).${newer ? "" : " Atenção: há lançamentos mais recentes que este cupom."}`;
      if (!$("rUse").dataset.touched) $("rUse").checked = newer && diff !== 0;
      $("rUse").disabled = diff === 0;
    };
    $("rUse").addEventListener("change", () => { $("rUse").dataset.touched = "1"; });
    ["rSaldo", "rDate"].forEach(id => $(id).addEventListener("input", () => { state.dupOk = false; syncUse(); }));
    split.onChange(() => { state.dupOk = false; syncUse(); });
    syncUse();
    const finish = () => { const q = scanQueue.splice(0); sheetCleanup = null; closeSheet(); if (q.length) { scanQueue.push(...q); setTimeout(nextScan, 50); } };
    $("rSkip").addEventListener("click", finish);
    $("rForm").addEventListener("submit", async e => {
      e.preventDefault();
      const sp = split.get();
      const one = sp.vale.length === 1 ? sp.vale[0] : null;
      const s = $("rSaldo").value.trim() ? parseMoney($("rSaldo").value) : NaN;
      const dt = $("rDate").value || todayISO();
      const useBal = !!one && !$("rSaldoBox").hidden && !$("rUseWrap").hidden && $("rUse").checked && !$("rUse").disabled;
      const chk = checkSplit(sp, useBal);
      if (chk.err) { $("rErr").textContent = chk.err; return; }
      if (useBal && !cardById(one.cardId)) { $("rErr").textContent = "Escolha o cartão que pagou."; return; }
      const warn = dupWarning(chk.parts, dt);
      if (warn && !state.dupOk) { state.dupOk = true; $("rErr").textContent = warn; return; }
      $("rSave").disabled = true;
      let results = [];
      const ok = await run(async () => {
        const receiptId = uid();
        await IDB.put("receipts", { id: receiptId, blob, createdAt: Date.now() });
        const desc = $("rDesc").value.trim() || state.cat || "Compra";
        const storeKey = storeKeyOf({ cnpj: d.cnpj, store: $("rDesc").value.trim() || d.store });
        const base = { desc, cat: state.cat, date: dt, source: "cupom", receiptId, ...(storeKey ? { storeKey } : {}), ...(one && s >= 0 ? { reportedBalance: s } : {}) };
        const adjust = (card, r) => {
          if (!useBal) return [];
          const diff = s - ((card.balance || 0) - r.amount);
          return diff ? [{ kind: diff > 0 ? "credit" : "debit", amount: Math.abs(diff), desc: "Ajuste pelo saldo do cupom", source: "ajuste", date: dt }] : [];
        };
        if (chk.parts.length) results = await savePurchase(chk.parts, chk.others, chk.total, base, adjust);
        else {
          // Só o saldo, sem valor: o cupom é um extrato de saldo
          const card = cardById(one.cardId);
          const diff = s - (card.balance || 0);
          results = [{ card, bal: diff ? await postTxs(card, [{ kind: diff > 0 ? "credit" : "debit", amount: Math.abs(diff), desc: "Ajuste pelo saldo do cupom", source: "ajuste", date: dt, receiptId }]) : card.balance }];
        }
      });
      if (!ok) { $("rSave").disabled = false; return; }
      toast(results.length === 1 ? `Cupom salvo. Saldo do ${results[0].card.name}: ${brl(results[0].bal)}` : `Compra salva em ${results.length} vales.`);
      finish();
    });
  }

  async function receiptSheet(tx) {
    const rec = await IDB.get("receipts", tx.receiptId).catch(() => null);
    const url = rec && rec.blob ? URL.createObjectURL(rec.blob) : null;
    openSheet(`
      <h3>${esc(tx.desc || "Cupom")}</h3>
      <p class="hint num">${esc(fmtDay(tx.date))} · ${brl(tx.amount)}${typeof tx.reportedBalance === "number" ? ` · saldo no cupom ${brl(tx.reportedBalance)}` : ""}</p>
      ${url ? `<img class="receipt-full" src="${url}" alt="Foto do cupom">` : `<p class="hint">A foto deste cupom não está mais no aparelho.</p>`}
      <div class="btnrow"><button class="btn" data-close>Fechar</button></div>`);
    if (url) sheetCleanup = () => URL.revokeObjectURL(url);
  }

  // ---------- backup ----------
  const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
  const dataURLToBlob = async u => (await fetch(u)).blob();


  async function photosSheet() {
    const recs = await IDB.all("receipts");
    const dateOf = {};
    for (const t of S.txs) if (t.receiptId) dateOf[t.receiptId] = t.date;
    const mb = b => (b / 1048576).toFixed(1).replace(".", ",") + " MB";
    const total = recs.reduce((s, r) => s + (r.blob ? r.blob.size : 0), 0);
    const olderThan = months => {
      const lim = new Date(); lim.setMonth(lim.getMonth() - months);
      const iso = isoDay(lim);
      return recs.filter(r => (dateOf[r.id] || isoDay(new Date(r.createdAt || 0))) < iso);
    };
    const opts = [3, 6, 12].map(m => ({ m, list: olderThan(m) }));
    openSheet(`
      <h3>Fotos dos cupons</h3>
      <p><b class="num">${recs.length}</b> ${recs.length === 1 ? "foto ocupa" : "fotos ocupam"} <b class="num">${mb(total)}</b> neste celular.</p>
      <p class="hint">Apagar fotos não mexe nos lançamentos nem nos saldos; só some o botão “foto” do extrato. Faça backup com fotos antes, se quiser guardá-las.</p>
      <div class="menu">
        ${opts.map(o => `<button data-del="${o.m}" ${o.list.length ? "" : "disabled"}><span class="t">Apagar fotos com mais de ${o.m} meses</span><span class="s num">${o.list.length} ${o.list.length === 1 ? "foto" : "fotos"} · ${mb(o.list.reduce((s, r) => s + (r.blob ? r.blob.size : 0), 0))}</span></button>`).join("")}
      </div>
      <div class="btnrow"><button class="btn" data-close>Fechar</button></div>`, sheet => {
      sheet.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
        const o = opts.find(x => x.m === +b.dataset.del);
        confirmSheet("Apagar fotos antigas?", `${o.list.length} ${o.list.length === 1 ? "foto de cupom com mais de " + o.m + " meses será apagada" : "fotos de cupons com mais de " + o.m + " meses serão apagadas"}. Os lançamentos continuam.`, "Apagar fotos", () => run(async () => {
          const ids = new Set(o.list.map(r => r.id));
          for (const id of ids) await IDB.del("receipts", id);
          for (const t of S.txs.filter(t => ids.has(t.receiptId))) await Store.patch("txs", t.id, { receiptId: null });
        }, "Fotos apagadas."));
      }));
    });
  }

  async function aboutSheet() {
    let usage = "";
    try { const est = await navigator.storage.estimate(); usage = `Espaço usado pelo app: ${(est.usage / 1048576).toFixed(1)} MB.`; } catch (e) {}
    let persisted = false;
    try { persisted = await navigator.storage.persisted(); } catch (e) {}
    openSheet(`
      <h3>Onde ficam seus dados</h3>
      <p>Tudo fica guardado apenas neste celular, dentro do app. Nada é enviado para a internet: nem os cupons, nem as fotos, nem as senhas.</p>
      <p>Se você desinstalar o app, limpar os dados do Chrome ou trocar de celular, os dados se perdem. Faça backup e guarde o arquivo no Google Drive ou envie para você mesmo.</p>
      <p class="hint">${esc(usage)} ${persisted ? "O Android foi avisado para não apagar estes dados sozinho." : ""}</p>
      <div class="btnrow"><button class="btn primary" id="abBk">Fazer backup agora</button><button class="btn" data-close>Fechar</button></div>`, () => {
      $("abBk").addEventListener("click", backupSheet);
    });
  }

  function backupSheet() {
    openSheet(`
      <h3>Fazer backup</h3>
      <p class="hint">O arquivo leva os cartões, os extratos e o cofre. As senhas continuam criptografadas e só abrem com a sua senha mestra.</p>
      <label class="check"><input type="checkbox" id="bkPhotos"> Incluir as fotos dos cupons (o arquivo fica bem maior)</label>
      <div class="err" id="bkErr"></div>
      <div class="btnrow"><button class="btn primary" id="bkGo">Gerar arquivo</button><button class="btn" data-close>Cancelar</button></div>`, () => {
      $("bkGo").addEventListener("click", async () => {
        $("bkGo").disabled = true; $("bkGo").textContent = "Gerando…";
        try {
          const data = { app: "ciclo", version: BACKUP_VERSION, exportedAt: new Date().toISOString(), cards: S.cards, txs: S.txs, meta: { vault: S.meta.vault || null }, receipts: [] };
          if ($("bkPhotos").checked) {
            for (const r of await IDB.all("receipts")) data.receipts.push({ id: r.id, createdAt: r.createdAt, data: await blobToDataURL(r.blob) });
          }
          const name = `ciclo-backup-${todayISO()}.json`;
          const file = new File([JSON.stringify(data)], name, { type: "application/json" });
          let shared = false;
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try { await navigator.share({ files: [file], title: "Backup do Ciclo" }); shared = true; }
            catch (e) { if (e.name === "AbortError") { $("bkGo").disabled = false; $("bkGo").textContent = "Gerar arquivo"; return; } }
          }
          if (!shared) {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(file); a.download = name;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 10000);
          }
          await Store.setMeta({ ...S.meta, lastBackup: Date.now() });
          toast(shared ? "Backup enviado." : "Backup salvo em Downloads.");
          closeSheet(); render();
        } catch (e) {
          console.error(e);
          $("bkErr").textContent = "Não foi possível gerar o backup.";
          $("bkGo").disabled = false; $("bkGo").textContent = "Gerar arquivo";
        }
      });
    });
  }

  async function importFile(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { toast("Este arquivo não é um backup válido."); return; }
    if (!data || !["ciclo", "carteira-vales"].includes(data.app) || !Array.isArray(data.cards) || !Array.isArray(data.txs)) { toast("Este arquivo não é um backup do Ciclo."); return; }
    const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString("pt-BR") : "data desconhecida";
    confirmSheet("Restaurar backup?", `O backup de <b>${esc(when)}</b> tem ${data.cards.length} cartões e ${data.txs.length} lançamentos. Os dados atuais deste celular serão <b>substituídos</b>.`, "Restaurar", async () => {
      const ok = await run(async () => {
        for (const s of ["cards", "txs", "receipts"]) await IDB.clear(s);
        for (const c of data.cards) await IDB.put("cards", c);
        for (const t of data.txs) await IDB.put("txs", t);
        for (const r of data.receipts || []) { try { await IDB.put("receipts", { id: r.id, createdAt: r.createdAt, blob: await dataURLToBlob(r.data) }); } catch (e) {} }
        const meta = { ...S.meta, vault: data.meta && data.meta.vault ? data.meta.vault : null };
        await IDB.put("meta", meta, "main");
        S.cards = data.cards; S.txs = data.txs; S.meta = meta;
        S.key = null; S.plain = {}; S.plainSig = {};
      }, "Backup restaurado.");
      if (ok) { S.view = { name: "home" }; S.person = null; render(); askPersist(); }
      return ok;
    });
  }

  // ---------- eventos ----------
  function openCard(id) {
    navigate(() => { S.view = { name: "card", id }; S.periodOffset = 0; render(); }, "forward");
    whenHistoryIdle(() => history.pushState({ card: id }, ""));
  }
  async function toggleEye() { await run(() => Store.setMeta({ ...S.meta, hideValues: !S.meta.hideValues })); }
  async function installApp() {
    if (!S.installEvt) return;
    S.installEvt.prompt();
    await S.installEvt.userChoice.catch(() => null);
    S.installEvt = null; render();
  }
  document.addEventListener("click", async e => {
    touchVault();
    const el = e.target.closest("[data-act]");
    if (!el || el.closest(".sheet")) return;
    const { act, id } = el.dataset;
    const card = id ? cardById(id) : null;
    switch (act) {
      case "open-card": openCard(id); break;
      case "home":
        if (history.state && history.state.card) history.back();
        else navigate(() => { S.view = { name: "home" }; render(); }, "back");
        break;
      case "person": S.person = el.dataset.all ? null : el.dataset.p; render(); break;
      case "per": S.periodOffset = Math.min(0, S.periodOffset + Number(el.dataset.d)); render(); break;
      case "new-card": cardSheet(null); break;
      case "edit-card": card && cardSheet(card); break;
      case "new-tx": txSheet(id, el.dataset.kind); break;
      case "adjust": card && adjustSheet(card); break;
      case "scan": S.scanCard = id || null; $("fileIn").click(); break;
      case "vault": vaultSheet(); break;
      case "backup": backupSheet(); break;
      case "import": $("importIn").click(); break;
      case "edit-secrets": card && secretsSheet(card); break;
      case "reveal": {
        const k = id + el.dataset.k;
        if (S.reveal.has(k)) S.reveal.delete(k); else { S.reveal.add(k); setTimeout(() => { S.reveal.delete(k); render(); }, 20000); }
        render(); break;
      }
      case "copy": {
        const v = (S.plain[id] || {})[el.dataset.k] || "";
        navigator.clipboard.writeText(v).then(() => toast("Copiado."), () => toast("Não foi possível copiar. Toque em Mostrar e copie à mão."));
        break;
      }
      case "view-receipt": { const tx = S.txs.find(t => t.id === id); tx && receiptSheet(tx); break; }
      case "del-card":
        card && confirmSheet("Excluir cartão?", `O cartão <b>${esc(card.name)}</b>, todo o extrato, as fotos de cupons e as senhas guardadas dele serão apagados. Não dá para desfazer.`, "Excluir",
          async () => { const ok = await run(() => deleteCard(card), "Cartão excluído."); if (ok) { S.view = { name: "home" }; } return ok; });
        break;
      case "del-tx": {
        const tx = S.txs.find(t => t.id === id);
        const siblings = tx ? S.txs.filter(t => t.groupId && t.groupId === tx.groupId && t.id !== tx.id).length : 0;
        tx && confirmSheet("Apagar lançamento?", `“${esc(tx.desc)}” de <span class="num">${brl(tx.amount)}</span> sai do extrato e o saldo do cartão é recalculado.${siblings ? ` Esta compra foi dividida: ${siblings === 1 ? "a outra parte continua" : `as outras ${siblings} partes continuam`} nos outros vales.` : tx.receiptId ? " A foto do cupom também é apagada." : ""}`, "Apagar",
          () => run(() => deleteTx(tx), "Lançamento apagado."));
        break;
      }
      case "credit-confirm": {
        const ci = card && creditInfo(card);
        if (!ci) break;
        // Valor e dia fixos: registra direto. Se algo varia, pergunta o valor e a data.
        if (!ci.estimated && amountModeOf(card) === "fixed") await run(() => registerCredit(card, card.monthlyCredit, ci.period.startISO), "Crédito registrado.");
        else creditSheet(card);
        break;
      }
      case "credit-skip": S.skipped.add(id); render(); break;
      case "credit-batch": creditBatchSheet(); break;
      case "credit-later": pendingCredits(visibleCards()).forEach(({ c }) => S.skipped.add(c.id)); render(); break;
      case "layout": {
        const next = layoutNow() === "list" ? "grid" : "list";
        await run(() => Store.setMeta({ ...S.meta, layout: next }));
        break;
      }
      case "grp": {
        const h = el.dataset.h; S.groups[h] = !groupOpen(h); $("cardArea").innerHTML = renderCardArea();
        if (S.groups[h]) { const g = [...document.querySelectorAll(".grp-head")].find(b => b.dataset.h === h); g && g.parentElement.classList.add("opened"); }
        break;
      }
      case "tab": goTab(el.dataset.tab); break;
      case "more-tx": S.txLimit += 100; $("txArea").innerHTML = renderTxArea(); break;
      case "lock": lockVault("Cofre trancado."); break;
      case "eye": toggleEye(); break;
      case "install": installApp(); break;
      case "m-backup": backupSheet(); break;
      case "m-photos": photosSheet(); break;
      case "m-about": aboutSheet(); break;
      case "m-master": changeMasterSheet(); break;
      case "m-theme": themeSheet(); break;
    }
  });
  // As buscas redesenham só a própria lista, para o teclado não fechar a cada letra.
  document.addEventListener("input", e => {
    if (e.target.id === "cardSearch") { S.cardQuery = e.target.value; $("cardArea").innerHTML = renderCardArea(); }
    else if (e.target.id === "txSearch") { S.txQuery = e.target.value; S.txLimit = 100; $("txArea").innerHTML = renderTxArea(); }
  });
  document.addEventListener("keydown", touchVault);
  $("tabbar").addEventListener("click", e => {
    const t = e.target.closest(".tab");
    if (t) goTab(t.dataset.tab);
  });
  $("plusBtn").addEventListener("click", actionSheet);
  $("eyeBtn").addEventListener("click", toggleEye);
  $("lockBtn").addEventListener("click", () => lockVault("Cofre trancado."));
  $("fileIn").addEventListener("change", e => { const files = e.target.files; if (files && files.length) startScan(files, S.scanCard); e.target.value = ""; });
  $("importIn").addEventListener("change", e => { const f = e.target.files && e.target.files[0]; if (f) importFile(f); e.target.value = ""; });
  $("installBtn").addEventListener("click", installApp);
  window.addEventListener("scroll", () => $("appbar").classList.toggle("scrolled", window.scrollY > 4), { passive: true });
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); S.installEvt = e; renderTop(); });
  window.addEventListener("appinstalled", () => { S.installEvt = null; renderTop(); toast("App instalado."); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) lockVault(); });

  // ---------- inicialização ----------
  (async () => {
    try {
      applyTheme(themeNow());
      await IDB.open();
      const migrated = await migrateOldDb().catch(e => { console.warn("migração", e); return false; });
      if (migrated) setTimeout(() => toast("Seus dados foram trazidos da versão anterior."), 600);
      const [cards, txs, meta] = await Promise.all([IDB.all("cards"), IDB.all("txs"), IDB.get("meta", "main")]);
      S.cards = cards; S.txs = txs; S.meta = meta || {}; S.loaded = true;
      history.replaceState({ home: true }, "");
      render();
      const acao = new URLSearchParams(location.search).get("acao");
      if (acao && S.cards.length) {
        history.replaceState({ home: true }, "", location.pathname);
        if (acao === "gasto") txSheet(null, "debit");
        // "Ler cupom" pelo atalho do ícone: o navegador exige um toque para abrir a câmera
        if (acao === "cupom") toast("Toque em “Ler cupom” para tirar a foto.");
      }
    } catch (e) {
      console.error(e);
      $("view").innerHTML = `<div class="notice">Não foi possível abrir os dados do app neste navegador. Verifique se o Chrome não está em modo anônimo.</div>`;
    }
  })();

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(e => console.warn("service worker", e));
  }
})();
