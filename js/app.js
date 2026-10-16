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

  // ---------- períodos ----------
  // Um período vai do dia do crédito até a véspera do crédito seguinte.
  // Sem dia de crédito definido, o período é o mês do calendário.
  function periodAt(card, date) {
    const day = Number(card.creditDay) || 1;
    const d = midnight(date);
    let start = mkDate(d.getFullYear(), d.getMonth(), day);
    if (d < start) start = mkDate(d.getFullYear(), d.getMonth() - 1, day);
    const end = mkDate(start.getFullYear(), start.getMonth() + 1, day);
    return { start, end, startISO: isoDay(start), endISO: isoDay(end), key: monthKey(start) };
  }
  function periodShift(card, p, n) {
    const day = Number(card.creditDay) || 1;
    return periodAt(card, mkDate(p.start.getFullYear(), p.start.getMonth() + n, day));
  }
  function periodLabel(card, p) {
    const last = new Date(p.end); last.setDate(last.getDate() - 1);
    if (!card.creditDay) return `${MONTHS[p.start.getMonth()]} ${p.start.getFullYear()}`;
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
    if (!card.creditDay) return null;
    const today = midnight(new Date());
    const p = periodAt(card, today);
    return { period: p, next: p.end, workdays: workdaysBetween(today, p.end), calDays: Math.round((p.end - today) / 86400000) };
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
  const IDB = {
    db: null,
    open() {
      return new Promise((res, rej) => {
        const r = indexedDB.open("carteira-vales", 1);
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
    view: { name: "home" }, person: null, periodOffset: 0, busy: false, skipped: new Set(), cardQuery: "", groups: {},
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
    if (tx.receiptId) await IDB.del("receipts", tx.receiptId);
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
    const b = $("vaultBtn");
    b.hidden = !hasCrypto || !S.loaded;
    b.classList.toggle("open", !!S.key);
    $("vaultLbl").textContent = !S.meta.vault ? "Cofre de senhas" : S.key ? "Cofre aberto" : "Cofre trancado";
    $("installBtn").hidden = !S.installEvt;
  }

  // ---------- renderização ----------
  function render() {
    const view = $("view");
    renderTop();
    $("fabs").hidden = !S.loaded || S.cards.length === 0;
    if (!S.loaded) return;
    if (S.view.name === "card" && cardById(S.view.id)) view.innerHTML = renderCard(cardById(S.view.id));
    else { S.view = { name: "home" }; view.innerHTML = renderHome(); }
    if (S.cards.length) decryptCards();
  }

  function pendingCredits(cards) {
    return cards.map(c => ({ c, ci: creditInfo(c) }))
      .filter(({ c, ci }) => ci && (c.monthlyCredit || 0) > 0 && c.lastCreditMonth !== ci.period.key && !S.skipped.has(c.id));
  }
  function renderNotices(list) {
    return list.map(({ c, ci }) => `
      <div class="notice">
        <span>O crédito de ${MONTHS[ci.period.start.getMonth()]} do <b>${esc(c.name)}</b>${c.holder ? ` (${esc(c.holder)})` : ""}, <span class="num">${brl(c.monthlyCredit)}</span>, já caiu?</span>
        <span class="actions">
          <button class="btn small primary" data-act="credit-confirm" data-id="${c.id}">Registrar crédito</button>
          <button class="btn small ghost" data-act="credit-skip" data-id="${c.id}">Ainda não veio</button>
        </span>
      </div>`).join("");
  }

  function renderHome() {
    if (S.cards.length === 0) {
      return `
      <div class="hero-empty">
        <span class="label">Comece por aqui</span>
        <h2>Cadastre os cartões de benefício da família</h2>
        <p>Cadastre cada cartão com o titular, o emissor (VR, Alelo, Pluxee, Ticket, Flash, Caju…) e o saldo de hoje. Depois lance as compras à mão ou tire foto do cupom fiscal: o app lê o valor e, quando o comprovante traz o saldo do cartão, corrige o saldo daqui.</p>
        <p>Tudo fica guardado só neste celular. Faça backup de vez em quando pelo botão “Mais”.</p>
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
    return `
      <section class="total">
        <span class="label">Saldo disponível${S.person !== null ? " · " + esc(S.person || "sem titular") : ""}</span>
        <span class="big num">${brl(total)}</span>
        <span class="sub num">${cards.length} ${cards.length === 1 ? "cartão" : "cartões"} · gasto em ${MONTHS[new Date().getMonth()]}: ${brl(spent)}</span>
      </section>
      ${peopleBar}
      ${renderCreditNotices(pendingCredits(cards))}
      ${backupWarn}
      ${renderCardToolbar()}
      <div id="cardArea">${renderCardArea()}</div>
      <section class="panel">
        <div class="panel-head"><h2>Últimos lançamentos</h2><span class="label">${S.person !== null ? esc(S.person || "sem titular") : "todos os cartões"}</span></div>
        ${renderTxList(recent, true)}
      </section>`;
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
    const perDay = ci ? `${brl(Math.max(0, ci.workdays > 0 ? Math.floor((c.balance || 0) / ci.workdays) : c.balance || 0))}/dia útil` : (TYPES[c.type] || TYPES.outro).label;
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
    const total = list.reduce((s, { c }) => s + (c.monthlyCredit || 0), 0);
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
              <span class="rinfo"><span class="rname">${esc(c.name)}</span><span class="rsub">${esc(c.holder || "sem titular")} · ${MONTHS[ci.period.start.getMonth()]}, dia ${esc(c.creditDay)}</span></span>
              <input class="num amt" inputmode="decimal" data-amt="${c.id}" value="${fmtInput(c.monthlyCredit)}" aria-label="Valor do crédito de ${esc(c.name)}">
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
            await postTxs(card, [{ kind: "credit", amount: v, desc: `Crédito de ${MONTHS[ci.period.start.getMonth()]}`, date: ci.period.startISO }]);
            await Store.patch("cards", id, { lastCreditMonth: ci.period.key });
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
      const sug = term ? [] : suggestions.filter(s => s.reasons.length).slice(0, 3);
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
    let meta = `<span>Sem dia de crédito definido</span>`;
    if (ci) {
      const perDay = ci.workdays > 0 ? Math.floor((c.balance || 0) / ci.workdays) : c.balance || 0;
      meta = `<span>${brl(Math.max(0, perDay))}/dia útil</span><span>crédito em ${ci.calDays} ${ci.calDays === 1 ? "dia" : "dias"}</span>`;
    }
    const attrs = clickable ? `data-act="open-card" data-id="${c.id}"` : `tabindex="-1" aria-disabled="true"`;
    return `
      <button class="cardtile ${clickable ? "" : "static"}" style="--tc:${t.color}" ${attrs}>
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
          const sub = [t.cat, t.source === "cupom" ? "via cupom" : "", who].filter(Boolean).join(" · ") || (t.kind === "credit" ? "Crédito" : "Gasto");
          const ic = t.source === "ajuste" ? "±" : t.kind === "credit" ? "+" : (t.cat || t.desc || "?").slice(0, 2);
          return `
          <div class="tx">
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
      const perDay = ci.workdays > 0 ? Math.floor(bal / ci.workdays) : bal;
      const elapsed = Math.round((midnight(new Date()) - p.start) / 86400000) + 1;
      const pct = c.monthlyCredit > 0 ? Math.max(0, Math.min(100, Math.round(bal / c.monthlyCredit * 100))) : null;
      quick = `
        <div class="stats">
          <div class="stat"><span class="h">Pode gastar por dia útil</span><span class="v num">${brl(Math.max(0, perDay))}</span><span class="h">${ci.workdays} dias úteis até o crédito</span></div>
          <div class="stat"><span class="h">Próximo crédito</span><span class="v num">${shortDate(ci.next)}</span><span class="h num">${c.monthlyCredit ? brl(c.monthlyCredit) : "valor não informado"}</span></div>
          <div class="stat"><span class="h">Gasto médio por dia</span><span class="v num">${brl(Math.round(st.debits / Math.max(1, elapsed)))}</span><span class="h">neste período</span></div>
        </div>
        ${pct !== null ? `<div class="pace"><div class="cap"><span>Saldo restante do crédito mensal</span><span class="num">${pct}%</span></div><div class="bar"><span style="width:${pct}%"></span></div></div>` : ""}`;
    } else if (isCurrent) {
      quick = `<p class="hint">Informe o dia do crédito em “Editar” para o app calcular quanto dá para gastar por dia útil e separar os períodos pelo ciclo do benefício.</p>`;
    }
    return `
      <button class="back" data-act="home">← Todos os cartões</button>
      <section class="cards" style="grid-template-columns:1fr">${renderTile(c, false)}</section>
      ${renderNotices(pendingCredits([c]))}
      <div class="btnrow">
        <button class="btn primary" data-act="new-tx" data-id="${c.id}" data-kind="debit">Lançar gasto</button>
        <button class="btn" data-act="scan" data-id="${c.id}">Ler cupom</button>
        <button class="btn" data-act="new-tx" data-id="${c.id}" data-kind="credit">Adicionar crédito</button>
        <button class="btn" data-act="adjust" data-id="${c.id}">Corrigir saldo</button>
        <button class="btn" data-act="edit-card" data-id="${c.id}">Editar</button>
      </div>
      <section class="panel">
        <div class="panel-head">
          <h2>${isCurrent ? "Período atual" : "Período"}</h2>
          <div class="pernav">
            <button class="iconbtn" data-act="per" data-d="-1" aria-label="Período anterior">‹</button>
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
    closeSheet(true);
    const root = $("sheetRoot");
    root.innerHTML = `<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
    if (opts.secret) $("scrim").dataset.secret = "1";
    const sheet = root.querySelector(".sheet");
    // Toque fora fecha só janelas sem formulário, para não perder o que foi digitado.
    $("scrim").addEventListener("click", e => { if (e.target.id === "scrim" && !sheet.querySelector("form, #scanBody")) closeSheet(); });
    sheet.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeSheet));
    onMount && onMount(sheet);
    const first = root.querySelector("[autofocus]");
    first && first.focus();
    whenHistoryIdle(() => { if ($("scrim") && !(history.state && history.state.sheet)) history.pushState({ sheet: true }, ""); });
    return sheet;
  }
  function closeSheet(keepHistory) {
    if (sheetCleanup) { const f = sheetCleanup; sheetCleanup = null; f(); }
    const had = !!$("scrim");
    $("sheetRoot").innerHTML = "";
    if (had && !keepHistory && !hist.pending && history.state && history.state.sheet) goBack();
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
    if (S.view.name === "card") { S.view = { name: "home" }; render(); }
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
        <label class="field"><span>Valor</span><input id="txAmount" class="money num" inputmode="decimal" placeholder="0,00" autocomplete="off" autofocus></label>
        <div class="field"><span>Cartão</span>${cardPickerHTML("txCard", sel)}</div>
        <div class="field" id="catField"><span>Categoria</span><div class="cats">${catButtons("")}</div></div>
        <label class="field"><span>Descrição (opcional)</span><input id="txDesc" maxlength="60" placeholder="Ex.: almoço no restaurante da esquina"></label>
        <label class="field"><span>Data</span><input id="txDate" type="date" value="${todayISO()}"></label>
        <div class="err" id="txErr"></div>
        <div class="btnrow"><button class="btn primary" type="submit">Salvar</button><button class="btn" type="button" data-close>Cancelar</button></div>
      </form>`, sheet => {
      const sync = () => {
        sheet.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.k === state.kind)));
        $("txTitle").textContent = state.kind === "debit" ? "Lançar gasto" : "Adicionar crédito";
        $("catField").hidden = state.kind !== "debit";
      };
      sheet.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => { state.kind = b.dataset.k; sync(); }));
      wireCats(sheet, state);
      wirePicker("txCard");
      sync();
      $("txForm").addEventListener("submit", async e => {
        e.preventDefault();
        const amount = parseMoney($("txAmount").value);
        const card = cardById($("txCard").value);
        if (!(amount > 0)) { $("txErr").textContent = "Informe um valor maior que zero, por exemplo 32,90."; return; }
        if (!card) { $("txErr").textContent = "Escolha um cartão."; return; }
        const date = $("txDate").value || todayISO();
        const desc = $("txDesc").value.trim() || (state.kind === "debit" ? (state.cat || "Compra") : "Crédito");
        let bal;
        const ok = await run(async () => { bal = await postTxs(card, [{ kind: state.kind, amount, desc, cat: state.kind === "debit" ? state.cat : "", date }]); });
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
          <label class="field"><span>Crédito mensal</span><input id="cCredit" class="num" inputmode="decimal" placeholder="0,00" value="${c.monthlyCredit ? fmtInput(c.monthlyCredit) : ""}"></label>
          <label class="field"><span>Dia do crédito</span><input id="cDay" type="number" min="1" max="31" inputmode="numeric" placeholder="ex.: 5" value="${esc(c.creditDay || "")}"></label>
        </div>
        <span class="hint">O dia do crédito define os períodos do cartão: cada período vai do dia do crédito até a véspera do próximo.</span>
        <div class="err" id="cErr"></div>
        <div class="btnrow"><button class="btn primary" type="submit">${isNew ? "Adicionar cartão" : "Salvar alterações"}</button><button class="btn" type="button" data-close>Cancelar</button></div>
      </form>`, () => {
      $("cardForm").addEventListener("submit", async e => {
        e.preventDefault();
        const name = $("cName").value.trim();
        const credit = $("cCredit").value.trim() ? parseMoney($("cCredit").value) : 0;
        const dayRaw = $("cDay").value.trim();
        const day = dayRaw ? Math.round(Number(dayRaw)) : "";
        const last4 = $("cLast4").value.trim();
        if (!name) { $("cErr").textContent = "Dê um nome ao cartão."; return; }
        if (last4 && !/^\d{4}$/.test(last4)) { $("cErr").textContent = "O final do cartão deve ter 4 números."; return; }
        if (isNaN(credit) || credit < 0) { $("cErr").textContent = "Crédito mensal inválido. Use o formato 800,00."; return; }
        if (day !== "" && !(day >= 1 && day <= 31)) { $("cErr").textContent = "O dia do crédito deve ser entre 1 e 31."; return; }
        const fields = { name, holder: $("cHolder").value.trim(), type: $("cType").value, issuer: $("cIssuer").value, last4, monthlyCredit: credit, creditDay: day };
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
          const check = await seal(key, { ok: "carteira-vales" });
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
          await Store.setMeta({ ...S.meta, vault: { salt, ...(await seal(newKey, { ok: "carteira-vales" })) } });
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
  function rankCards(d, amount, saldoAfter, presetCardId) {
    const key = storeKeyOf(d);
    const nameKey = d && d.store ? descKey(d.store) : null;
    const used = {};
    if (key || nameKey) for (const t of S.txs) {
      if (t.kind !== "debit") continue;
      if ((key && t.storeKey === key) || (nameKey && descKey(t.desc || "") === nameKey)) used[t.cardId] = (used[t.cardId] || 0) + 1;
    }
    return S.cards.map(c => {
      let score = 0; const reasons = [];
      if (d && d.last4 && c.last4 === d.last4) { score += 100; reasons.push("final " + c.last4); }
      if (saldoAfter !== null && saldoAfter >= 0) {
        const bal = c.balance || 0;
        if (amount > 0 && Math.abs(bal - amount - saldoAfter) <= 1) { score += 90; reasons.push("o saldo do cupom fecha com este cartão"); }
        else if (Math.abs(bal - saldoAfter) <= 1) { score += 50; reasons.push("saldo igual ao do cupom"); }
      }
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

  function reviewForm(sheet, blob, presetCardId, d, msg, rawText) {
    if (!sheet.querySelector("#scanBody")) return;
    d = d || {};
    const amount = d.paid > 0 ? d.paid : null;
    let saldo = typeof d.balance === "number" ? d.balance : null;
    if (saldo !== null && d.balanceMoment === "antes_compra" && amount) saldo -= amount;
    const ranked = rankCards(d, amount || 0, saldo, presetCardId);
    const top = ranked[0];
    const confident = top && top.score >= 50 && (!ranked[1] || top.score - ranked[1].score >= 20);
    const cardId = top && top.score > 0 ? top.card.id : (presetCardId || defaultCardId());
    const suggestLine = top && top.reasons.length
      ? `<span>Cartão ${confident ? "identificado" : "provável"}: <b>${esc(top.card.name)}</b>${top.card.holder ? ` (${esc(top.card.holder)})` : ""} · ${esc(top.reasons.join(", "))}${confident ? "" : " (confira o cartão)"}</span>`
      : (S.cards.length > 1 ? `<span>Não consegui identificar o cartão pelo cupom. Escolha abaixo.</span>` : "");
    const date = d.date || todayISO();
    const state = { cat: d.category || "", dupOk: false };
    const summary = d.found && d.found.length ? `
      <div class="found">
        <span><b>Encontrado no cupom:</b> ${esc(d.found.join(", "))}${d.issuer ? ` · ${esc(d.issuer)}` : ""}${d.last4 ? ` final ${esc(d.last4)}` : ""}</span>
        <span>${saldo !== null ? `Saldo do cartão impresso: <b class="num">${brl(saldo)}</b>${d.balanceMoment === "antes_compra" ? " (já descontada esta compra)" : ""}` : "O cupom não mostra o saldo do cartão."}</span>
        ${suggestLine}
        <span class="hint">Confira os valores com o papel antes de salvar.</span>
      </div>` : (suggestLine ? `<div class="found">${suggestLine}</div>` : "");
    sheet.querySelector("#scanBody").outerHTML = `
      ${msg ? `<div class="notice">${esc(msg)}</div>` : ""}
      ${summary}
      <form id="rForm" class="sform">
        <label class="field"><span>Valor pago com o cartão</span><input id="rAmount" class="money num" inputmode="decimal" placeholder="0,00" value="${amount ? fmtInput(amount) : ""}"></label>
        <div class="field"><span>Cartão</span>${cardPickerHTML("rCard", cardId)}</div>
        <div class="grid2">
          <label class="field"><span>Estabelecimento</span><input id="rDesc" maxlength="60" value="${esc(d.store || "")}"></label>
          <label class="field"><span>Data</span><input id="rDate" type="date" value="${date}"></label>
        </div>
        <div class="field"><span>Categoria</span><div class="cats">${catButtons(state.cat)}</div></div>
        <label class="field"><span>Saldo do cartão impresso no cupom (se houver)</span><input id="rSaldo" class="num" inputmode="decimal" placeholder="não informado" value="${saldo !== null && saldo >= 0 ? fmtInput(saldo) : ""}"></label>
        <label class="check" id="rUseWrap"><input type="checkbox" id="rUse"> <span id="rUseTxt"></span></label>
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
    wirePicker("rCard", ranked);
    const syncUse = () => {
      const card = cardById($("rCard").value);
      const s = parseMoney($("rSaldo").value);
      const a = parseMoney($("rAmount").value);
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
    ["rCard", "rSaldo", "rAmount", "rDate"].forEach(id => $(id).addEventListener("input", () => { state.dupOk = false; syncUse(); }));
    syncUse();
    const finish = () => { const q = scanQueue.splice(0); sheetCleanup = null; closeSheet(); if (q.length) { scanQueue.push(...q); setTimeout(nextScan, 50); } };
    $("rSkip").addEventListener("click", finish);
    $("rForm").addEventListener("submit", async e => {
      e.preventDefault();
      const card = cardById($("rCard").value);
      const a = $("rAmount").value.trim() ? parseMoney($("rAmount").value) : 0;
      const s = $("rSaldo").value.trim() ? parseMoney($("rSaldo").value) : NaN;
      const dt = $("rDate").value || todayISO();
      const useBal = !$("rUseWrap").hidden && $("rUse").checked && !$("rUse").disabled;
      if (!card) { $("rErr").textContent = "Escolha o cartão que pagou."; return; }
      if (isNaN(a) || a < 0) { $("rErr").textContent = "Valor inválido. Use o formato 32,90."; return; }
      if (!(a > 0) && !useBal) { $("rErr").textContent = "Informe o valor pago ou marque o uso do saldo do cupom."; return; }
      const dup = a > 0 && S.txs.find(t => t.cardId === card.id && t.kind === "debit" && t.amount === a && t.date === dt);
      if (dup && !state.dupOk) {
        state.dupOk = true;
        $("rErr").textContent = `Já existe um gasto de ${brl(a)} neste cartão em ${fmtDay(dt).toLowerCase()} (“${dup.desc}”). Toque em Salvar de novo se for outra compra.`;
        return;
      }
      $("rSave").disabled = true;
      let bal;
      const ok = await run(async () => {
        const receiptId = uid();
        await IDB.put("receipts", { id: receiptId, blob, createdAt: Date.now() });
        const list = [];
        const storeKey = storeKeyOf({ cnpj: d.cnpj, store: $("rDesc").value.trim() || d.store });
        if (a > 0) list.push({ kind: "debit", amount: a, desc: $("rDesc").value.trim() || state.cat || "Compra", cat: state.cat, date: dt, source: "cupom", receiptId, ...(storeKey ? { storeKey } : {}), ...(s >= 0 ? { reportedBalance: s } : {}) });
        if (useBal) {
          const diff = s - ((card.balance || 0) - (a > 0 ? a : 0));
          if (diff !== 0) list.push({ kind: diff > 0 ? "credit" : "debit", amount: Math.abs(diff), desc: "Ajuste pelo saldo do cupom", source: "ajuste", date: dt, ...(a > 0 ? {} : { receiptId }) });
        }
        bal = await postTxs(card, list);
      });
      if (!ok) { $("rSave").disabled = false; return; }
      toast(`Cupom salvo. Saldo do ${card.name}: ${brl(bal)}`);
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

  function menuSheet() {
    openSheet(`
      <h3>Mais opções</h3>
      <div class="menu">
        <button data-m="backup"><span class="t">Fazer backup</span><span class="s">Gera um arquivo com cartões, extratos e senhas (as senhas continuam criptografadas).</span></button>
        <button data-m="import"><span class="t">Restaurar backup</span><span class="s">Substitui os dados deste celular pelos do arquivo.</span></button>
        <button data-m="photos"><span class="t">Fotos dos cupons</span><span class="s">Ver quanto espaço ocupam e apagar fotos antigas (os lançamentos continuam).</span></button>
        ${hasCrypto && S.meta.vault ? `<button data-m="master"><span class="t">Trocar senha mestra do cofre</span><span class="s">Recriptografa todas as senhas guardadas.</span></button>` : ""}
        <button data-m="about"><span class="t">Sobre o armazenamento</span><span class="s">Onde ficam os dados e como não perder nada.</span></button>
      </div>
      <div class="btnrow"><button class="btn" data-close>Fechar</button></div>`, sheet => {
      sheet.querySelectorAll("[data-m]").forEach(b => b.addEventListener("click", () => {
        const m = b.dataset.m;
        if (m === "backup") backupSheet();
        else if (m === "import") { closeSheet(); $("importIn").click(); }
        else if (m === "master") changeMasterSheet();
        else if (m === "photos") photosSheet();
        else aboutSheet();
      }));
    });
  }

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
          const data = { app: "carteira-vales", version: BACKUP_VERSION, exportedAt: new Date().toISOString(), cards: S.cards, txs: S.txs, meta: { vault: S.meta.vault || null }, receipts: [] };
          if ($("bkPhotos").checked) {
            for (const r of await IDB.all("receipts")) data.receipts.push({ id: r.id, createdAt: r.createdAt, data: await blobToDataURL(r.blob) });
          }
          const name = `carteira-vales-backup-${todayISO()}.json`;
          const file = new File([JSON.stringify(data)], name, { type: "application/json" });
          let shared = false;
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try { await navigator.share({ files: [file], title: "Backup Carteira de Vales" }); shared = true; }
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
    if (!data || data.app !== "carteira-vales" || !Array.isArray(data.cards) || !Array.isArray(data.txs)) { toast("Este arquivo não é um backup da Carteira de Vales."); return; }
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
    S.view = { name: "card", id }; S.periodOffset = 0; render(); window.scrollTo(0, 0);
    whenHistoryIdle(() => history.pushState({ card: id }, ""));
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
        else { S.view = { name: "home" }; render(); }
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
        tx && confirmSheet("Apagar lançamento?", `“${esc(tx.desc)}” de <span class="num">${brl(tx.amount)}</span> sai do extrato e o saldo do cartão é recalculado.${tx.receiptId ? " A foto do cupom também é apagada." : ""}`, "Apagar",
          () => run(() => deleteTx(tx), "Lançamento apagado."));
        break;
      }
      case "credit-confirm": {
        const ci = card && creditInfo(card);
        if (!ci) break;
        await run(async () => {
          await postTxs(card, [{ kind: "credit", amount: card.monthlyCredit, desc: `Crédito de ${MONTHS[ci.period.start.getMonth()]}`, date: ci.period.startISO }]);
          await Store.patch("cards", card.id, { lastCreditMonth: ci.period.key });
        }, "Crédito registrado.");
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
      case "grp": { const h = el.dataset.h; S.groups[h] = !groupOpen(h); $("cardArea").innerHTML = renderCardArea(); break; }
    }
  });
  // A busca redesenha só a lista de cartões, para o teclado não fechar a cada letra.
  document.addEventListener("input", e => {
    if (e.target.id !== "cardSearch") return;
    S.cardQuery = e.target.value;
    $("cardArea").innerHTML = renderCardArea();
  });
  document.addEventListener("keydown", touchVault);
  $("fabTx").addEventListener("click", () => txSheet(S.view.name === "card" ? S.view.id : null, "debit"));
  $("fabScan").addEventListener("click", () => { S.scanCard = S.view.name === "card" ? S.view.id : null; $("fileIn").click(); });
  $("fileIn").addEventListener("change", e => { const files = e.target.files; if (files && files.length) startScan(files, S.scanCard); e.target.value = ""; });
  $("importIn").addEventListener("change", e => { const f = e.target.files && e.target.files[0]; if (f) importFile(f); e.target.value = ""; });
  $("vaultBtn").addEventListener("click", () => { if (S.key) lockVault("Cofre trancado."); else vaultSheet(); });
  $("menuBtn").addEventListener("click", menuSheet);
  $("installBtn").addEventListener("click", async () => {
    if (!S.installEvt) return;
    S.installEvt.prompt();
    await S.installEvt.userChoice.catch(() => null);
    S.installEvt = null; renderTop();
  });
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); S.installEvt = e; renderTop(); });
  window.addEventListener("appinstalled", () => { S.installEvt = null; renderTop(); toast("App instalado."); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) lockVault(); });

  // ---------- inicialização ----------
  (async () => {
    try {
      await IDB.open();
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
