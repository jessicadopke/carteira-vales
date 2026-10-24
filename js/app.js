import { $, brl, CATS, delta, esc, explain, fmtDay, fmtInput, fold, ICON, isoDay, ISSUERS, issuerStyle, MANY, midnight, monthKey, MONTHS, parseMoney, shortDate, toast, todayISO, TYPES, uid } from "./app/util.js";
import { cardById, holders, lastTxDate, S, sortedCards, txSort, visibleCards } from "./app/estado.js";
import { b64, deriveKey, hasCrypto, seal, unseal } from "./app/cripto.js";
import { amountModeOf, benefitCredits, creditInfo, creditWhen, dayModeOf, expectedAmount, fromISO, isBenefitCredit, perDayOf, periodAt, periodLabel, periodShift, periodStats } from "./app/periodos.js";

(() => {
  "use strict";
  // Versão do app (SemVer: MAJOR.MINOR.PATCH). Ao mudar, atualize também CHANGELOG.md e VERSION em sw.js.
  const APP_VERSION = "1.11.0";
  const LOCK_MS = 5 * 60 * 1000;
  const BACKUP_VERSION = 1;

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
    syncAgenda();
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

  // ---------- créditos previstos: hoje e próximos dias ----------
  // Cartões visíveis com crédito de hoje até 3 dias, menos os que ela já adiou nesta sessão.
  const previstos = cards => Credito.proximos(cards, new Date(), 3, S.txs).filter(p => !S.skipped.has(p.cardId));
  const previstosHoje = cards => previstos(cards).filter(p => p.faltam === 0);
  function renderPrevistos(cards) {
    const list = previstos(cards);
    if (!list.length) return "";
    const hoje = list.filter(p => p.faltam === 0);
    const emLote = hoje.length > 1 && hoje.every(p => pendingCredits(cards).some(x => x.c.id === p.cardId));
    const rows = list.map(p => {
      const c = cardById(p.cardId);
      const quando = `${p.estimado ? "~" : ""}${Credito.rotulo(p.faltam)}`;
      const amt = expectedAmount(c);
      const valor = amountModeOf(c) === "variable"
        ? `${amt > 0 ? `<span class="num">${brl(amt)}</span> · ` : ""}valor varia`
        : `<span class="num">${brl(amt)}</span>`;
      const acoes = p.faltam === 0 && !emLote
        ? `<span class="actions"><button class="btn small primary" data-act="credito-prev-confirm" data-id="${c.id}">Confirmar valor</button><button class="btn small ghost" data-act="credit-skip" data-id="${c.id}">Ainda não veio</button></span>` : "";
      return `<div class="prev-row"><span><b>${esc(c.name)}</b>${c.holder ? ` (${esc(c.holder)})` : ""}: <b>${quando}</b> · ${valor}</span>${acoes}</div>`;
    }).join("");
    const lote = emLote ? `<span class="actions"><button class="btn small primary" data-act="credit-batch">Confirmar valores</button><button class="btn small ghost" data-act="credit-later">Depois</button></span>` : "";
    return `<div class="notice prev"><div class="prev-title">Créditos previstos</div>${rows}${lote}</div>`;
  }

  // ---------- aviso por notificação (experimento) ----------
  // A agenda dos próximos 14 dias (só data e quantidade) fica em meta.avisoCredito, fora do backup, para o service worker ler.
  function syncAgenda() {
    const a = S.meta && S.meta.avisoCredito;
    if (!S.loaded || !a || !a.ligado) return;
    const datas = Credito.montarAgenda(S.cards, new Date(), S.txs);
    if (JSON.stringify(datas) === JSON.stringify(a.datas || [])) return;
    S.meta = { ...S.meta, avisoCredito: { ...a, datas } };
    IDB.put("meta", S.meta, "main").catch(e => console.warn("agenda do aviso", e));
  }
  // Só mostra o interruptor quando o aparelho permite: periodicSync (Chrome) e app instalado.
  const avisoSuportado = () => !!S.periodicOk && "Notification" in window;
  async function avisoLigar() {
    try {
      if (!avisoSuportado()) { toast("Seu aparelho ou navegador não permite este aviso."); return; }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { toast("Sem permissão para avisar. Ative as notificações do Ciclo nas configurações do celular e tente de novo."); return; }
      const reg = await navigator.serviceWorker.ready;
      await reg.periodicSync.register("ciclo-credito", { minInterval: 12 * 3600 * 1000 });
      await Store.setMeta({ ...S.meta, avisoCredito: { ligado: true, datas: Credito.montarAgenda(S.cards, new Date(), S.txs) } });
      toast("Aviso ligado. Ele pode atrasar ou não chegar; confie no quadro do Início.");
    } catch (e) {
      console.warn("aviso de crédito", e);
      toast("Não consegui ligar o aviso neste aparelho. O quadro do Início continua funcionando.");
    }
    render();
  }
  async function avisoDesligar() {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg.periodicSync) await reg.periodicSync.unregister("ciclo-credito");
    } catch (e) { console.warn("aviso de crédito", e); }
    try { await Store.setMeta({ ...S.meta, avisoCredito: { ligado: false, datas: [] } }); } catch (e) { console.warn(e); }
    toast("Aviso desligado.");
    render();
  }
  function renderAvisoCredito() {
    const on = !!(S.meta.avisoCredito && S.meta.avisoCredito.ligado);
    if (!avisoSuportado()) return `<div class="menu"><div class="menu-note"><span class="t">Aviso de crédito (experimento)</span><span class="s">Seu aparelho ou navegador não permite este aviso. O quadro do Início continua funcionando.</span></div></div>`;
    return `<div class="menu"><button data-act="${on ? "credito-aviso-desligar" : "credito-aviso-ligar"}"><span class="t">Aviso de crédito (experimento): ${on ? "ligado" : "desligado"}</span><span class="s">O Android decide quando o app roda em segundo plano; o aviso pode atrasar ou não chegar. Confie no quadro do Início. Toque para ${on ? "desligar" : "ligar"}.</span></button></div>`;
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
    // Lembrete de backup: sem backup, backup com mais de 30 dias ou 30 lançamentos novos desde o último
    const newSinceBackup = S.meta.lastBackup ? S.txs.filter(t => (t.createdAt || 0) > S.meta.lastBackup).length : S.txs.length;
    const backupOld = S.txs.length >= 10 && (!S.meta.lastBackup || Date.now() - S.meta.lastBackup > 30 * 86400000);
    const lembreteDrive = Drive.lembrete({ drive: S.meta.drive, agora: Date.now() });
    const driveWarn = lembreteDrive.tipo === "falhando"
      ? `<div class="notice info"><span>${lembreteDrive.texto} Os dados deste celular continuam aqui; veja a ligação com o Drive.</span><span class="actions"><button class="btn small primary" data-act="m-drive">Abrir Drive</button></span></div>` : "";
    const backupWarn = driveWarn || lembreteDrive.tipo === "nenhum" ? driveWarn : backupOld || (S.meta.lastBackup && newSinceBackup >= 30)
      ? `<div class="notice info"><span>${!S.meta.lastBackup ? "Você ainda não fez backup." : backupOld ? "Seu último backup tem mais de 30 dias." : `Há ${newSinceBackup} lançamentos novos desde o último backup.`} Se o celular for perdido ou formatado, os dados vão junto.</span><span class="actions"><button class="btn small primary" data-act="backup">Fazer backup</button></span></div>` : "";
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
      ${renderPrevistos(cards)}
      ${renderCreditNotices(pendingCredits(cards).filter(({ c }) => !previstosHoje(cards).some(p => p.cardId === c.id)))}
      ${renderUpdateNotice()}
      ${backupWarn}
      ${renderCardToolbar()}
      <div id="cardArea">${renderCardArea()}</div>
      <div class="section-head"><h2>Últimos lançamentos</h2><button class="btn small ghost" data-act="tab" data-tab="extrato">Ver extrato</button></div>
      <section class="panel">
        ${renderTxList(recent, true)}
      </section>`;
  }

  // ---------- gráficos de gastos ----------
  const periodoDeCartao = (c, n) => periodShift(c, periodAt(c, new Date()), n);
  // Painel "Gastos do período": offset 0 = período atual, -1 = o anterior... Cada cartão usa o seu período.
  // nav: botões ‹ › próprios (aba Extrato); na tela do cartão quem navega é o painel "Período".
  function renderGraficos(cards, offset, nav) {
    const sel = Graficos.selecionar(S.txs, cards, offset, periodoDeCartao);
    const atual = Graficos.somarGastos(sel.atual, cards);
    const ant = Graficos.somarGastos(sel.anterior, cards);
    const multi = atual.titulares.todos.length > 1;
    const view = S.gfView === "titulares" && !multi ? "categorias" : (["categorias", "lojas", "titulares"].includes(S.gfView) ? S.gfView : "categorias");
    const abas = [["categorias", "Categorias"], ["lojas", "Lojas"]].concat(multi ? [["titulares", "Titulares"]] : []);
    const comp = Graficos.comparar(atual[view], ant[view]);
    const navHtml = nav ? `
      <div class="pernav">
        <button class="iconbtn" data-act="gf-off" data-d="-1" aria-label="Período anterior" ${offset <= -36 ? "disabled" : ""}>‹</button>
        <span class="p num">${offset === 0 ? "Atual" : (-offset) + "º atrás"}</span>
        <button class="iconbtn" data-act="gf-off" data-d="1" aria-label="Próximo período" ${offset === 0 ? "disabled" : ""}>›</button>
      </div>` : "";
    return `
      <section class="panel" id="gfPanel">
        <div class="panel-head"><h2>Gastos do período</h2>${navHtml}</div>
        ${nav ? `<p class="hint">Período de cada cartão${offset === 0 ? "" : `, ${-offset} ${offset === -1 ? "período" : "períodos"} atrás`}.</p>` : ""}
        ${atual.total ? `<div class="gf-tabs" role="group" aria-label="Agrupar gastos por">${abas.map(([k, n]) => `<button data-act="gf-view" data-v="${k}" aria-pressed="${view === k}">${n}</button>`).join("")}</div>` : ""}
        ${Graficos.desenhar(atual[view], brl, esc, comp)}
        ${atual.total ? `<p class="gf-frase gv">${esc(Graficos.frase(comp, brl))}</p>` : ""}
      </section>`;
  }

  // ---------- aba Extrato ----------
  function renderExtrato() {
    if (!S.cards.length) return renderHome();
    return `
      <h1 class="page-title">Extrato</h1>
      <div class="toolbar"><input id="txSearch" class="search" type="search" placeholder="Buscar loja, categoria, cartão, titular ou valor" value="${esc(S.txQuery)}" autocomplete="off" aria-label="Buscar no extrato"></div>
      ${renderGraficos(visibleCards(), S.gfOffset, true)}
      <div id="txArea">${renderTxArea()}</div>`;
  }
  // Lançamentos do extrato conforme a busca da tela (usado na lista e na planilha).
  function extratoFiltrado() {
    const words = fold(S.txQuery.trim()).split(/\s+/).filter(Boolean);
    return S.txs.filter(t => {
      if (!words.length) return true;
      const c = cardById(t.cardId);
      const hay = fold([t.desc, t.cat, c && c.name, c && c.holder, c && c.issuer, fmtInput(t.amount), (t.date || "").split("-").reverse().join("/"), t.kind === "credit" ? "credito" : "gasto"].join(" "));
      return words.every(w => hay.includes(w));
    }).sort(txSort);
  }
  async function exportarPlanilha() {
    const list = extratoFiltrado();
    if (!list.length) { toast("Nada para exportar."); return; }
    const name = `ciclo-extrato-${todayISO()}.csv`;
    const file = new File([Csv.montar(list, S.cards)], name, { type: "text/csv;charset=utf-8" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "Extrato do Ciclo" }); toast("Planilha enviada."); return; }
      catch (e) { if (e.name === "AbortError") return; }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast("Planilha salva em Downloads.");
  }
  function renderTxArea() {
    const list = extratoFiltrado();
    const spent = list.filter(t => t.kind === "debit" && t.source !== "ajuste").reduce((s, t) => s + t.amount, 0);
    const got = list.filter(isBenefitCredit).reduce((s, t) => s + t.amount, 0);
    const shown = list.slice(0, S.txLimit);
    return `
      <div class="tots">
        <div class="tot"><span class="k">Gastos</span><span class="v num">${brl(spent)}</span></div>
        <div class="tot"><span class="k">Créditos</span><span class="v num in">${brl(got)}</span></div>
      </div>
      <section class="panel">${list.length ? renderTxList(shown, true) : `<div class="empty">Nada encontrado para “${esc(S.txQuery)}”.</div>`}</section>
      ${list.length > shown.length ? `<button class="btn more" data-act="more-tx">Mostrar mais (${list.length - shown.length} restantes)</button>` : ""}
      ${list.length ? `<button class="btn more" data-act="export-csv">Exportar planilha</button>` : ""}`;
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
        <button data-act="m-drive"><span class="t">Backup no Drive</span><span class="s">${driveOn() ? "Ligado: o app guarda uma cópia no seu Google Drive sozinho." : "Guarda uma cópia sozinha no seu Google Drive."}</span></button>
        ${driveOn() ? `<button data-act="drive-save"><span class="t">Salvar no Drive</span><span class="s">${S.meta.drive.ultimo ? "Último: " + new Date(S.meta.drive.ultimo).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + "." : "Ainda não salvou."}</span></button>
        <button data-act="drive-restore"><span class="t">Restaurar do Drive</span><span class="s">Escolha um backup do Drive para trazer de volta.</span></button>` : ""}
        <button data-act="m-photos"><span class="t">Fotos dos cupons</span><span class="s">Espaço usado e limpeza de fotos antigas.</span></button>
        <button data-act="m-about"><span class="t">Onde ficam os dados</span><span class="s">Como não perder nada ao trocar de celular.</span></button>
      </div>
      <div class="section-head"><h2>Leitura de fotos</h2></div>
      <div class="menu">
        <button data-act="m-gemini"><span class="t">Gemini</span><span class="s">${S.meta.gemini && S.meta.gemini.enabled && S.meta.gemini.key ? "Ligado: cupons e cartões são lidos pelo Gemini, com o leitor do celular como reserva." : "Desligado: cupons e cartões são lidos só no celular, sem internet."}</span></button>
        <button data-act="recorte-auto"><span class="t">Recortar o cupom sem perguntar</span><span class="s">${Recorte.autoLigado(S.meta) ? "Ligado: o app recorta a foto do cupom sozinho e mostra o recorte depois da leitura." : "Desligado: antes de ler, o app mostra o recorte para você conferir e ajustar."}</span></button>
      </div>
      <div class="section-head"><h2>Avisos</h2></div>
      ${renderAvisoCredito()}
      <div class="section-head"><h2>Aparência</h2></div>
      <div class="menu">
        <button data-act="m-theme"><span class="t">Tema</span><span class="s">Agora: ${THEMES[themeNow()].toLowerCase()}. ${THEME_HINT[themeNow()]}</span></button>
        <button data-act="layout"><span class="t">Mostrar cartões ${list ? "como cartões" : "em lista"}</span><span class="s">Agora: ${list ? "lista compacta" : "cartões grandes"}.</span></button>
        <button data-act="eye"><span class="t">${S.meta.hideValues ? "Mostrar valores" : "Esconder valores"}</span><span class="s">O mesmo que o botão de olho no topo.</span></button>
      </div>
      ${hasCrypto && S.meta.vault ? `<div class="section-head"><h2>Cofre</h2></div><div class="menu"><button data-act="m-master"><span class="t">Trocar senha mestra</span><span class="s">Recriptografa todas as senhas guardadas.</span></button></div>` : ""}
      <div class="section-head"><h2>Sobre o app</h2></div>
      <div class="menu">
        ${S.updateAvailable
          ? `<button data-act="update-now"><span class="t">Atualizar para a versão ${esc(S.updateAvailable)}</span><span class="s">Você está na ${APP_VERSION}. Seus cartões, extratos e senhas não são afetados.</span></button>`
          : `<button data-act="update-check"><span class="t">Buscar atualização</span><span class="s">Versão instalada: ${APP_VERSION}${S.lastUpdateCheck ? ` · verificado às ${new Date(S.lastUpdateCheck).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}.</span></button>`}
        <button data-act="update-force"><span class="t">Recarregar o app</span><span class="s">Baixa de novo todos os arquivos do app. Use se algo parecer desatualizado.</span></button>
        ${S.installEvt ? `<button data-act="install"><span class="t">Instalar o app</span><span class="s">Ícone na tela inicial, tela cheia e uso sem internet.</span></button>` : ""}
      </div>
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

  // ---------- leitura de fotos (cupons e cartões) com o Gemini (opcional) ----------
  // A chave fica só neste celular (S.meta.gemini) e não vai para o backup.
  // Limpa o que costuma vir junto ao copiar: espaços, quebras de linha, aspas, caracteres invisíveis,
  // e um "NOME_DA_VARIAVEL=" na frente (ex.: GEMINI_API_KEY=...).
  const cleanKey = raw => {
    let k = String(raw || "").replace(/[\s ​-‍⁠﻿"'`´“”‘’]/g, "");
    if (/^[A-Z_]+=/.test(k)) k = k.slice(k.indexOf("=") + 1);
    return k;
  };
  const geminiOn = () => !!(S.meta.gemini && S.meta.gemini.enabled && S.meta.gemini.key && navigator.onLine && window.GeminiReader);
  // Opções da lista de modelos: o padrão e o atual sempre aparecem, mesmo fora da lista do Google
  function modelOptions(list, current) {
    const ids = [...new Set([GeminiReader.DEFAULT_MODEL, current, ...list].filter(Boolean))];
    return ids.map(id => `<option value="${esc(id)}" ${id === current ? "selected" : ""}>${esc(id)}${id === GeminiReader.DEFAULT_MODEL ? " (padrão)" : ""}</option>`).join("");
  }
  function geminiUsageText() {
    const u = GeminiReader.usage();
    if (!u.last) return "Este celular ainda não leu nenhuma foto com o Gemini.";
    const when = new Date(u.last.t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    return `Última leitura: ${u.last.m}, em ${when}. Nos últimos 30 dias: ${u.reads30} ${u.reads30 === 1 ? "leitura" : "leituras"} e ${u.quota30} ${u.quota30 === 1 ? "erro" : "erros"} de cota (429).`;
  }
  function geminiSheet() {
    const g = S.meta.gemini || {};
    openSheet(`
      <h3>Leitura de fotos com o Gemini</h3>
      <p class="hint">Com o Gemini ligado, as fotos de cupons e de cartões (frente do cartão ou print do app do emissor) são enviadas para o Google, que devolve os dados lidos. A leitura costuma acertar mais, principalmente em cupom térmico apagado. Sem internet, ou se o Gemini falhar, o app usa o leitor do próprio celular.</p>
      <form id="gForm" class="sform" autocomplete="off">
        <label class="check"><input type="checkbox" id="gOn" ${g.enabled ? "checked" : ""}> <span>Usar o Gemini para ler cupons e cartões</span></label>
        <label class="field"><span>Chave de API do Google AI Studio</span><input id="gKey" type="password" autocomplete="off" spellcheck="false" placeholder="Cole aqui a chave (começa com AIza…)" value="${esc(g.key || "")}"></label>
        <label class="check"><input type="checkbox" id="gShow"> <span>Mostrar a chave</span></label>
        <details class="raw"><summary>Avançado</summary>
          <label class="field" style="margin-top:10px"><span>Modelo</span><select id="gModel">${modelOptions([], g.model || GeminiReader.DEFAULT_MODEL)}</select></label>
          <span class="hint" id="gModelHint">O padrão (${GeminiReader.DEFAULT_MODEL}) sempre aponta para o Gemini Flash mais recente.${g.key ? " Buscando os modelos que a sua chave pode usar…" : " Com a chave salva, a lista mostra os modelos que ela pode usar."}</span>
          <p class="hint" id="gUse">${esc(geminiUsageText())}</p>
        </details>
        <div class="notice info"><span><b>Privacidade:</b> no plano gratuito do Gemini, o Google pode usar as fotos enviadas para melhorar os produtos dele. Uma NFC-e pode trazer CPF e o final do cartão. Ativar o faturamento no Google AI Studio impede esse uso.</span></div>
        <p class="hint">A chave fica guardada só neste celular e não entra no backup. Para protegê-la, restrinja a chave ao site <b>jessicadopke.github.io</b> no Google Cloud Console.</p>
        <div class="err" id="gErr"></div>
        <div class="btnrow">
          <button class="btn primary" type="submit" id="gSave">Testar e salvar</button>
          <button class="btn" type="button" data-close>Cancelar</button>
          ${g.key ? `<button class="btn danger" type="button" id="gDel">Remover chave</button>` : ""}
        </div>
      </form>`, () => {
      $("gShow").addEventListener("change", e => { $("gKey").type = e.target.checked ? "text" : "password"; });
      const fillModels = list => { const cur = $("gModel").value; $("gModel").innerHTML = modelOptions(list, cur); };
      if (g.key) GeminiReader.listModels(g.key).then(list => {
        if (!$("gModel")) return;
        fillModels(list);
        $("gModelHint").textContent = `O padrão (${GeminiReader.DEFAULT_MODEL}) sempre aponta para o Gemini Flash mais recente. ${list.length} modelos disponíveis para a sua chave.`;
      }, () => { if ($("gModelHint")) $("gModelHint").textContent = `O padrão (${GeminiReader.DEFAULT_MODEL}) sempre aponta para o Gemini Flash mais recente. Não foi possível buscar a lista agora.`; });
      $("gDel") && $("gDel").addEventListener("click", async () => {
        const ok = await run(() => Store.setMeta({ ...S.meta, gemini: { enabled: false, key: "", model: g.model || "" } }), "Chave do Gemini removida.");
        if (ok) closeSheet();
      });
      $("gForm").addEventListener("submit", async e => {
        e.preventDefault();
        const key = cleanKey($("gKey").value), enabled = $("gOn").checked, model = $("gModel").value.trim() || GeminiReader.DEFAULT_MODEL;
        $("gKey").value = key;
        $("gErr").textContent = "";
        if (enabled && !key) { $("gErr").textContent = "Cole a chave de API para ligar o Gemini."; return; }
        // Quem decide se a chave vale é o Google (no teste abaixo); aqui só barra o que claramente está incompleto.
        if (key && key.length < 20) { $("gErr").textContent = `A chave colada parece incompleta (${key.length} caracteres). Copie de novo no Google AI Studio.`; return; }
        if (key) {
          $("gSave").disabled = true; $("gSave").textContent = "Testando…";
          try { fillModels(await GeminiReader.test(key)); }
          catch (err) {
            $("gErr").textContent = GeminiReader.explain(err);
            $("gSave").disabled = false; $("gSave").textContent = "Testar e salvar";
            return;
          }
        }
        const ok = await run(() => Store.setMeta({ ...S.meta, gemini: { enabled, key, model } }), enabled ? "Gemini ligado. Os próximos cupons e cartões serão lidos por ele." : "Configuração salva.");
        if (ok) closeSheet(); else { $("gSave").disabled = false; $("gSave").textContent = "Testar e salvar"; }
      });
    }, { secret: true });
  }

  // ---------- atualização do app ----------
  // version.json (na raiz do site) traz a versão publicada. Compara com APP_VERSION;
  // se for maior, oferece atualizar: limpa a cópia offline do app (não os dados) e recarrega.
  const newerThan = (a, b) => {
    const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
    for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
    return false;
  };
  async function checkUpdate(manual) {
    if (!navigator.onLine) { if (manual) toast("Sem internet. Conecte-se para buscar atualização."); return null; }
    try {
      const res = await fetch("version.json?t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const v = String((await res.json()).version || "");
      const before = S.updateAvailable;
      S.lastUpdateCheck = Date.now();
      S.updateAvailable = newerThan(v, APP_VERSION) ? v : null;
      if (manual && !S.updateAvailable) toast(`Você já está na versão mais recente (${APP_VERSION}).`);
      if (S.loaded && !$("scrim") && before !== S.updateAvailable) render();
      return S.updateAvailable;
    } catch (e) {
      console.warn("atualização", e);
      if (manual) toast("Não foi possível verificar agora. Tente de novo em instantes.");
      return null;
    }
  }
  async function applyUpdate() {
    if (!navigator.onLine) { toast("Sem internet. Conecte-se para atualizar."); return; }
    toast("Atualizando…");
    try {
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update().catch(() => {});
      // Só a cópia offline do programa; cartões, extratos e senhas ficam no IndexedDB e não são tocados.
      if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
    } catch (e) { console.warn("atualização", e); }
    location.reload();
  }
  function renderUpdateNotice() {
    if (!S.updateAvailable) return "";
    return `<div class="notice info"><span>A versão <b class="num">${esc(S.updateAvailable)}</b> do Ciclo está disponível (você está na ${APP_VERSION}).</span><span class="actions"><button class="btn small primary" data-act="update-now">Atualizar</button></span></div>`;
  }

  // ---------- leitura de cartão por foto ----------
  // Gemini (se ligado) e, se falhar, o leitor do celular. A imagem não é guardada em lugar nenhum.
  async function readCardImage(file, onStatus) {
    let fallbackMsg = null;
    if (geminiOn()) {
      try {
        onStatus && onStatus("Lendo com o Gemini…");
        const img = await shrink(file, 2000, 0.85, false);
        return await GeminiReader.readCard(img, { key: S.meta.gemini.key, model: S.meta.gemini.model });
      } catch (e) {
        console.warn("gemini cartão", e);
        fallbackMsg = "Gemini: " + GeminiReader.explain(e) + " Lido no celular.";
      }
    }
    try {
      onStatus && onStatus("Lendo no celular…");
      const text = await ReceiptReader.readText(file);
      const r = ReceiptReader.parseCard(text);
      r.fallbackMsg = fallbackMsg;
      return r;
    } catch (e) { console.warn("cartão", e); return null; }
  }

  // ---------- câmera ou galeria ----------
  // "Ler cupom" abre a câmera traseira direto (capture="environment"); a galeria fica como opção secundária.
  // Sem o Gemini, o leitor do celular já vai carregando enquanto a câmera ou a galeria estão abertas.
  const warmReader = () => { if (!geminiOn() && window.ReceiptReader) ReceiptReader.warm(); };
  function openCamera(cardId) { S.scanCard = cardId || null; warmReader(); $("camIn").click(); }
  function openGallery(cardId) { S.scanCard = cardId || null; warmReader(); $("fileIn").click(); }

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
      </div>
      <button class="linkbtn" data-q="galeria">Ler cupom de uma foto da galeria</button>`, sheet => {
      sheetCleanup = () => $("plusBtn").classList.remove("open");
      sheet.querySelectorAll("[data-q]").forEach(b => b.addEventListener("click", () => {
        const q = b.dataset.q;
        if (q === "cupom") { closeSheet(); openCamera(cardId); }
        else if (q === "galeria") { closeSheet(); openGallery(cardId); }
        else if (q === "gasto") txSheet(cardId, "debit");
        else if (q === "credito") txSheet(cardId, "credit");
        else cardSheet(null);
      }));
    });
  }
  function goTab(t) {
    if (t === S.tab && S.view.name !== "card") { window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" }); return; }
    navigate(() => { S.tab = t; S.view = { name: "home" }; S.gfOffset = 0; render(); });
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
            <span class="a num ${t.kind === "credit" ? "in" : ""}">${t.kind === "credit" ? "+" : "−"}${brl(t.amount)}${typeof t.reportedBalance === "number" ? `<span class="rb" title="Saldo impresso no cupom">saldo ${brl(t.reportedBalance)}</span>` : ""}</span>
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
      <button class="linkbtn" data-act="scan-gallery" data-id="${c.id}">Ler cupom de uma foto da galeria</button>
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
      ${renderGraficos([c], S.periodOffset, false)}
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
  const defaultCardId = () => S.view.name === "card" ? S.view.id : ((visibleCards()[0] || sortedCards()[0]) || {}).id || "";

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
      <div class="photofill">
        <span class="hint">Preencher por foto:</span>
        <div class="btnrow">
          <button class="btn small" type="button" id="cpCamBtn">${ICON.cupom}Foto do cartão</button>
          <button class="btn small" type="button" id="cpGalBtn">${ICON.cartao}Print do app do emissor</button>
        </div>
        <input type="file" id="cpCam" accept="image/*" capture="environment" hidden>
        <input type="file" id="cpGal" accept="image/*" hidden>
        <div id="cpStatus" class="hint" role="status"></div>
      </div>
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
      // ---- preencher por foto (cartão ou print do app) ----
      const onPhoto = async e => {
        const f = e.target.files && e.target.files[0]; e.target.value = "";
        if (!f) return;
        const st = $("cpStatus");
        st.innerHTML = `<span class="loading"><span class="spin"></span>Lendo a imagem…</span>`;
        const r = await readCardImage(f, msg => { if ($("cpStatus")) $("cpStatus").textContent = msg; });
        if (!$("cardForm")) return;
        if (!r) { st.textContent = "Não consegui ler a imagem. Preencha os campos à mão."; return; }
        const filled = [];
        const setV = (id, v, label) => { if (v && $(id)) { $(id).value = v; filled.push(label); } };
        if (r.issuer && ISSUERS.includes(r.issuer)) setV("cIssuer", r.issuer, "emissor");
        if (r.type && TYPES[r.type]) setV("cType", r.type, "tipo");
        setV("cLast4", r.last4, "final");
        setV("cHolder", r.holder, "titular");
        if (r.balance !== null && r.balance !== undefined && $("cBalance")) setV("cBalance", fmtInput(r.balance), "saldo");
        if (!$("cName").value.trim() && (r.issuer || r.type)) {
          $("cName").value = [r.issuer && r.issuer !== "Outro" ? r.issuer.replace(" (Sodexo)", "") : "", r.type ? TYPES[r.type].label : ""].filter(Boolean).join(" ");
          filled.push("nome");
        }
        st.textContent = filled.length
          ? `${r.source === "gemini" ? "Lido pelo Gemini" : "Lido no celular"}: ${filled.join(", ")}. Confira antes de salvar.${r.fallbackMsg ? " (" + r.fallbackMsg + ")" : ""}`
          : "Não encontrei os dados do cartão nessa imagem. Tente uma foto mais nítida da frente do cartão ou preencha à mão.";
      };
      $("cpCam").addEventListener("change", onPhoto);
      $("cpGal").addEventListener("change", onPhoto);
      $("cpCamBtn").addEventListener("click", () => $("cpCam").click());
      $("cpGalBtn").addEventListener("click", () => $("cpGal").click());

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
  // Para o Gemini: colorida, lado maior ≤ 2000 px (shrink(file, 2000, 0.85, false)).
  async function shrink(file, max = 1280, q = 0.6, gray = true) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
      const ctx = cv.getContext("2d");
      if (gray) ctx.filter = "grayscale(1) contrast(1.15)";
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

  async function scanOne(file, presetCardId, extra = {}) {
    const url = URL.createObjectURL(file);
    let alive = true;
    const loaderHTML = `
        <div class="loading"><span class="spin"></span><span id="scanStatus">Preparando…</span></div>
        <div class="progress" style="margin-top:10px"><span id="scanBar"></span></div>
        <div class="btnrow" style="margin-top:12px"><button class="btn" id="scanStop">Preencher à mão</button></div>`;
    const remaining = scanQueue.length;
    const sheet = openSheet(`
      <h3>Ler cupom${remaining ? ` <span class="hint num">(mais ${remaining} na fila)</span>` : ""}</h3>
      <img class="receipt-img" src="${url}" alt="Foto do cupom">
      <div id="scanBody">${loaderHTML}</div>`);
    const ctl = window.AbortController ? new AbortController() : null;
    sheetCleanup = () => { alive = false; ctl && ctl.abort(); URL.revokeObjectURL(url); scanQueue.length = 0; };
    const stored = shrink(file);
    const bindStop = () => $("scanStop").addEventListener("click", async () => { alive = false; ctl && ctl.abort(); reviewForm(sheet, await stored, presetCardId, null, "Preencha os dados do cupom.", ""); });
    bindStop();

    // 1º: Gemini, se estiver ligado, com chave e com internet. Se falhar, segue para o leitor do celular.
    // "Como foi lido" (modelos tentados, erros e tempos) aparece na conferência, para entender demora ou falha.
    const t0 = Date.now();
    const secs = () => ((Date.now() - t0) / 1000).toFixed(1).replace(".", ",") + " s";
    let geminiFail = null, geminiLog = "";
    if (!geminiOn()) geminiLog = !(S.meta.gemini && S.meta.gemini.key) ? "Gemini: sem chave salva." : !(S.meta.gemini && S.meta.gemini.enabled) ? "Gemini: desligado em Ajustes." : !navigator.onLine ? "Gemini: sem internet." : "";
    if (geminiOn()) {
      // Andamento: modelo da tentativa atual, troca de modelo e tempo decorrido
      let gNow = "Lendo com o Gemini…";
      const showNow = () => { if (alive && $("scanStatus")) $("scanStatus").textContent = `${gNow} ${Math.round((Date.now() - t0) / 1000)} s`; };
      const onProgress = ({ model, prev }) => {
        gNow = !prev ? `Lendo com o Gemini (${model})…`
          : prev.running ? `${prev.model} está demorando; tentando também ${model}…`
          : `${prev.model}: ${GeminiReader.shortStatus(prev.status)}. Tentando ${model}…`;
        showNow();
      };
      showNow();
      const tick = setInterval(showNow, 1000);
      $("scanBar").parentElement.hidden = true;
      try {
        // 1600 px bastam para o Gemini ler o cupom; foto menor sobe e é processada mais rápido
        const img = await shrink(file, 1600, 0.8, false);
        const g = await GeminiReader.read(img, { key: S.meta.gemini.key, model: S.meta.gemini.model }, ctl && ctl.signal, onProgress);
        clearInterval(tick);
        if (!alive || !$("scanBody")) return;
        const p = g.parsed;
        p.how = `Gemini: ${GeminiReader.describe(g.attempts)}. Total: ${secs()}.`;
        const msg = !p.legible ? "O Gemini achou que a foto não é um comprovante ou está ilegível. Confira os dados." : !p.found.length ? "O Gemini não encontrou valores nesta foto. Confira ou preencha à mão." : null;
        reviewForm(sheet, await stored, presetCardId, p, msg, g.raw);
        return;
      } catch (e) {
        clearInterval(tick);
        if (!alive || !$("scanBody")) return;
        console.warn("gemini", e);
        geminiFail = GeminiReader.explain(e);
        geminiLog = `Gemini: ${GeminiReader.describe(e.attempts) || e.message}.`;
        $("scanBar").parentElement.hidden = false;
      }
    }

    const labels = { "preparando a foto": "Preparando a foto…", "loading tesseract core": "Carregando o leitor…", "initializing tesseract": "Carregando o leitor…", "loading language traineddata": "Carregando o português…", "initializing api": "Carregando o leitor…", "recognizing text": "Lendo o texto do cupom…" };
    if (geminiFail) $("scanStatus").textContent = `${geminiFail} Usando o leitor do celular…`;
    try {
      // Recorte (só no leitor do celular): acha o papel e deixa conferir os cantos antes de ler.
      const info = { ms: {} };
      const opts = { info };
      if (extra.semRecorte) info.motivo = "pedido: ler sem recorte";
      else {
        if ($("scanStatus")) $("scanStatus").textContent = "Procurando o cupom na foto…";
        const det = await ReceiptReader.detectar(file).catch(() => null);
        if (!alive || !$("scanBody")) return;
        if (det) info.ms = { ...det.ms };
        if (!det || !det.cantos) { info.motivo = "não achei o papel"; }
        else if (!Recorte.diferenteDaMoldura(det.cantos, det.larg, det.alt)) { info.motivo = "a foto já está enquadrada"; }
        else if (Recorte.autoLigado(S.meta)) opts.cantos = det.cantos;
        else {
          const r = await confirmarRecorte(sheet, url, det);
          if (!alive || !$("scanBody")) return;
          $("scanBody").innerHTML = loaderHTML; bindStop();
          if (r.cantos) opts.cantos = r.cantos; else info.motivo = "você escolheu ler a foto inteira";
        }
      }
      const text = await ReceiptReader.readText(file, (status, p) => {
        if (!alive || !$("scanStatus")) return;
        $("scanStatus").textContent = labels[status] || "Lendo…";
        $("scanBar").style.width = Math.round((status === "recognizing text" ? 0.3 + p * 0.7 : p * 0.3) * 100) + "%";
      }, opts);
      if (!alive || !$("scanBody")) return;
      const parsed = ReceiptReader.parse(text);
      parsed.how = `${geminiLog ? geminiLog + " " : ""}Leitor do celular. ${info.texto || ""} Total: ${secs()}.`;
      // recorte usado automaticamente: mostra a miniatura e deixa ler de novo sem ele
      if (info.cantos && Recorte.autoLigado(S.meta)) parsed.recorteMini = info.miniatura;
      const empty = !parsed.found.length;
      const prefix = geminiFail ? `Gemini: ${geminiFail} A foto foi lida pelo leitor do celular. ` : "";
      reviewForm(sheet, await stored, presetCardId, parsed, empty ? prefix + "Não encontrei valores nesta foto. Confira se o cupom está inteiro, reto e bem iluminado, ou preencha à mão." : (prefix ? prefix + "Confira os valores com atenção." : null), text);
      const again = sheet.querySelector("#rNoCrop");
      if (again) again.addEventListener("click", () => { sheetCleanup = null; scanOne(file, presetCardId, { semRecorte: true }); });
    } catch (e) {
      console.error(e);
      if (!alive || !$("scanBody")) return;
      reviewForm(sheet, await stored, presetCardId, null, "Não foi possível ler a foto. Preencha os dados do cupom.", "");
    }
  }

  // Passo de conferência do recorte: contorno sobre a foto e 4 pontos para arrastar com o dedo.
  // Resolve com { cantos } (em pixels da foto) ou { inteira: true }.
  function confirmarRecorte(sheet, url, det) {
    return new Promise(resolve => {
      const body = sheet.querySelector("#scanBody"), foto = sheet.querySelector(".receipt-img");
      if (foto) foto.hidden = true;
      body.innerHTML = `
        <p class="hint">Achei o cupom na foto. Se o contorno não estiver certo, arraste os pontos com o dedo.</p>
        <div class="crop" id="crop" style="max-width:${Math.round(360 * det.larg / det.alt)}px">
          <img src="${url}" alt="Foto do cupom com o contorno do recorte" draggable="false">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon id="cropPoly"></polygon></svg>
          ${[0, 1, 2, 3].map(i => `<button type="button" class="crop-h" data-i="${i}" aria-label="Ponto ${i + 1} de 4 do recorte"></button>`).join("")}
        </div>
        <div class="btnrow">
          <button class="btn primary" type="button" id="cropOk">Usar recorte</button>
          <button class="btn" type="button" id="cropFull">Ler a foto inteira</button>
          <button class="btn" type="button" id="cropRedo">Refazer sozinho</button>
        </div>`;
      const box = $("crop"), hs = [...box.querySelectorAll(".crop-h")];
      let cur = det.cantos.map(p => ({ ...p }));
      const pct = (v, n) => (v / Math.max(1, n - 1) * 100);
      const draw = () => {
        $("cropPoly").setAttribute("points", cur.map(p => `${pct(p.x, det.larg)},${pct(p.y, det.alt)}`).join(" "));
        hs.forEach((h, i) => { h.style.left = pct(cur[i].x, det.larg) + "%"; h.style.top = pct(cur[i].y, det.alt) + "%"; });
      };
      draw();
      hs.forEach(h => {
        const i = +h.dataset.i;
        h.addEventListener("pointerdown", e => { e.preventDefault(); h.setPointerCapture(e.pointerId); h.classList.add("on"); });
        h.addEventListener("pointermove", e => {
          if (!h.classList.contains("on")) return;
          const r = box.getBoundingClientRect();
          const novo = cur.map(p => ({ ...p }));
          novo[i] = { x: (e.clientX - r.left) / r.width * (det.larg - 1), y: (e.clientY - r.top) / r.height * (det.alt - 1) };
          const ok = Recorte.validar(novo, det.larg, det.alt); // trava dentro da foto; cruzado não passa
          if (ok) { cur = ok; draw(); }
        });
        const solta = () => h.classList.remove("on");
        h.addEventListener("pointerup", solta); h.addEventListener("pointercancel", solta);
      });
      $("cropOk").addEventListener("click", () => { if (foto) foto.hidden = false; resolve({ cantos: cur }); });
      $("cropFull").addEventListener("click", () => { if (foto) foto.hidden = false; resolve({ inteira: true }); });
      $("cropRedo").addEventListener("click", () => { cur = det.cantos.map(p => ({ ...p })); draw(); });
    });
  }

  // Escolha do cartão pelo cupom: js/match.js (funções puras, com testes)
  const storeKeyOf = Match.storeKeyOf;
  const rankCards = (d, amount, saldos, presetCardId) => Match.rankCards(S.cards, S.txs, d, amount, saldos, presetCardId);

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
    // Um cartão sugerido para cada parte paga com vale, e avisos de cartão que pode não estar na carteira
    const { saldos, others, parts, unknown } = Match.matchReceipt(d, S.cards, S.txs, presetCardId, defaultCardId());
    const pays = d.payments || [];
    const unkLabel = u => esc([u.issuer || u.issuerRaw, u.last4 ? "final " + u.last4 : ""].filter(Boolean).join(" ") || "deste cupom");
    const unknownHTML = unknown.map(u => {
      const amt = u.amount ? ` (<span class="num">${brl(u.amount)}</span>)` : "";
      const text = u.kind === "novo"
        ? `O cartão <b>${unkLabel(u)}</b>${amt} não está cadastrado na sua carteira.`
        : u.kind === "saldo"
          ? `O saldo impresso no cupom (<b class="num">${brl(u.saldo)}</b>)${u.issuer ? ` do ${esc(u.issuer)}` : ""} não fecha com nenhum cartão cadastrado. Pode ser um cartão que ainda não está na carteira.`
          : `Se esta compra${amt} foi paga com um cartão que não está na carteira, cadastre na hora.`;
      const btns = `<button type="button" class="btn small${u.kind === "fraco" ? "" : " primary"}" data-newcard="${u.i}">${u.kind === "fraco" ? "Cadastrar outro cartão" : "Cadastrar agora"}</button>`
        + (u.alt ? `<button type="button" class="btn small" data-isit="${u.i}">É o ${esc(u.alt.name)}</button>` : "");
      return `
      <div class="notice${u.kind === "fraco" ? " info" : ""}" id="unk${u.i}">
        <span>${text}</span>
        <span class="actions">${btns}</span>
      </div>
      <div id="ncBox${u.i}"></div>`;
    }).join("");
    const hardUnknown = i => unknown.some(u => u.i === i && u.kind !== "fraco");
    const suggestLine = parts.map((pt, i) => hardUnknown(i) ? "" : pt.pick && pt.pick.reasons.length
      ? `<span>${parts.length > 1 ? `Vale ${i + 1} (${brl(pt.amount)}): ` : "Cartão "}${pt.confident ? "identificado" : "provável"}: <b>${esc(pt.pick.card.name)}</b>${pt.pick.card.holder ? ` (${esc(pt.pick.card.holder)})` : ""} · ${esc(pt.pick.reasons.join(", "))}${pt.confident ? "" : " (confira o cartão)"}</span>`
      : S.cards.length > 1 ? `<span>${parts.length > 1 ? `Vale ${i + 1}: n` : "N"}ão consegui identificar o cartão pelo cupom. Escolha abaixo.</span>` : "").join("");
    const date = d.date || todayISO();
    const state = { cat: d.category || "", dupOk: false };
    const payLine = pays.length > 1 ? `<span>Pagamento: ${esc(pays.map(p => `${p.kind === "vale" ? "vale" : OTHER_KINDS[p.kind] || p.kind} ${brl(p.amount)}`).join(" + "))}</span>` : "";
    const summary = d.found && d.found.length ? `
      <div class="found">
        <span><b>${d.source === "gemini" ? "Lido pelo Gemini" : "Lido no celular"}:</b> ${esc(d.found.join(", "))}${d.issuer ? ` · ${esc(d.issuer)}` : ""}${d.last4 ? ` final ${esc(d.last4)}` : ""}</span>
        ${payLine}
        <span>${saldos.length ? `Saldo${saldos.length > 1 ? "s" : ""} do vale impresso${saldos.length > 1 ? "s" : ""}: <b class="num">${saldos.map(brl).join(" · ")}</b>${d.balanceMoment === "antes_compra" ? " (já descontada esta compra)" : ""}` : "O cupom não mostra o saldo do cartão: o saldo daqui será descontado pelo valor pago."}</span>
        ${suggestLine}
        <span class="hint">Confira os valores com o papel antes de salvar.</span>
      </div>` : (suggestLine ? `<div class="found">${suggestLine}</div>` : "");
    sheet.querySelector("#scanBody").outerHTML = `
      ${msg ? `<div class="notice">${esc(msg)}</div>` : ""}
      ${d.recorteMini ? `<div class="found recorte-usado"><img src="${d.recorteMini}" alt="Recorte usado na leitura"><span>O app recortou a foto antes de ler.<br><button type="button" class="btn small" id="rNoCrop">Ler de novo sem recorte</button></span></div>` : ""}
      ${summary}
      ${unknownHTML}
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
        ${d.how ? `<details class="raw"><summary>Como foi lido</summary><p class="hint num" style="margin-top:8px">${esc(d.how)}</p></details>` : ""}
        ${rawText ? `<details class="raw"><summary>${d.source === "gemini" ? "Ver resposta do Gemini" : "Ver texto lido da foto"}</summary><pre></pre></details>` : ""}
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

    // ---- cadastrar na hora o cartão que não está na carteira ----
    const typeFromCat = { Mercado: "alimentacao", Feira: "alimentacao", Restaurante: "refeicao", Lanche: "refeicao", Padaria: "refeicao", Delivery: "refeicao" };
    // escolhe um cartão para o vale da linha k, como se fosse pelo seletor
    const selectRow = (k, cardId) => {
      const row = [...sheet.querySelectorAll('#rsRows .split-row[data-kind="vale"]')][k];
      if (!row) return;
      const hidden = $(row.dataset.pid);
      hidden.value = cardId;
      $(row.dataset.pid + "Btn").innerHTML = pickLabel(cardById(cardId));
      hidden.dispatchEvent(new Event("input", { bubbles: true }));
    };
    sheet.addEventListener("click", async e => {
      const isit = e.target.closest("[data-isit]");
      if (isit) {
        const u = unknown.find(x => x.i === +isit.dataset.isit);
        selectRow(u.i, u.alt.id);
        $("ncBox" + u.i).innerHTML = "";
        $("unk" + u.i).className = "notice info";
        $("unk" + u.i).innerHTML = `<span><b>${esc(u.alt.name)}</b> escolhido para este vale.${u.kind === "saldo" ? " Como o saldo daqui não batia com o do cupom, confira abaixo a opção de usar o saldo do cupom." : ""}</span>`;
        return;
      }
      const open = e.target.closest("[data-newcard]");
      const save = e.target.closest("[data-ncsave]");
      const cancel = e.target.closest("[data-nccancel]");
      if (open) {
        const u = unknown.find(x => x.i === +open.dataset.newcard);
        const type = u.type && TYPES[u.type] ? u.type : typeFromCat[state.cat] || "alimentacao";
        const issuer = u.issuer && ISSUERS.includes(u.issuer) ? u.issuer : "Outro";
        const k = u.i;
        $("ncBox" + k).innerHTML = `
          <div class="newcard">
            <h4>Novo cartão</h4>
            <div class="grid2">
              <label class="field"><span>Nome do cartão</span><input id="ncName${k}" maxlength="40" value="${esc([issuer !== "Outro" ? issuer.replace(" (Sodexo)", "") : u.issuerRaw || "", TYPES[type].label].filter(Boolean).join(" ").slice(0, 40))}"></label>
              <label class="field"><span>Titular</span><input id="ncHolder${k}" maxlength="40" list="ncHolders${k}" value="${esc(u.holder || S.person || "")}" placeholder="Ex.: Ana"><datalist id="ncHolders${k}">${holders().filter(Boolean).map(h => `<option value="${esc(h)}">`).join("")}</datalist></label>
            </div>
            <div class="grid2">
              <label class="field"><span>Tipo</span><select id="ncType${k}">${Object.entries(TYPES).map(([t, v]) => `<option value="${t}" ${t === type ? "selected" : ""}>${v.label}</option>`).join("")}</select></label>
              <label class="field"><span>Emissor</span><select id="ncIssuer${k}">${ISSUERS.map(x => `<option ${x === issuer ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></label>
            </div>
            <div class="grid2">
              <label class="field"><span>Final do cartão</span><input id="ncLast${k}" inputmode="numeric" maxlength="4" value="${esc(u.last4 || "")}" placeholder="4 últimos dígitos"></label>
              <label class="field"><span>${u.saldo !== null ? "Saldo após a compra" : "Saldo antes da compra"}</span><input id="ncBal${k}" class="num" inputmode="decimal" placeholder="0,00" value="${u.saldo !== null && u.saldo >= 0 ? fmtInput(u.saldo) : ""}"></label>
            </div>
            <span class="hint">${u.saldo !== null ? "Veio do saldo impresso no cupom. " : ""}O dia e o valor do crédito você completa depois, em Editar cartão.</span>
            <div class="err" id="ncErr${k}"></div>
            <div class="btnrow"><button type="button" class="btn primary" data-ncsave="${k}">Adicionar cartão</button><button type="button" class="btn" data-nccancel="${k}">Cancelar</button></div>
          </div>`;
        open.hidden = true;
        $("ncName" + k).focus();
      } else if (cancel) {
        const k = +cancel.dataset.nccancel;
        $("ncBox" + k).innerHTML = "";
        const b = sheet.querySelector(`[data-newcard="${k}"]`); if (b) b.hidden = false;
      } else if (save) {
        const k = +save.dataset.ncsave;
        const u = unknown.find(x => x.i === k);
        const name = $("ncName" + k).value.trim(), last4 = $("ncLast" + k).value.trim();
        const balRaw = $("ncBal" + k).value.trim(), bal = balRaw ? parseMoney(balRaw) : 0;
        if (!name) { $("ncErr" + k).textContent = "Dê um nome ao cartão."; return; }
        if (last4 && !/^\d{4}$/.test(last4)) { $("ncErr" + k).textContent = "O final do cartão deve ter 4 números."; return; }
        if (isNaN(bal) || bal < 0) { $("ncErr" + k).textContent = "Saldo inválido. Use o formato 450,75."; return; }
        // valor que este vale pagou (pode ter sido corrigido na tela)
        const valeRows = [...sheet.querySelectorAll('#rsRows .split-row[data-kind="vale"]')];
        const row = valeRows[k];
        const rowAmt = row ? (parseMoney(row.querySelector(".amt").value) || 0) : u.amount || 0;
        // o saldo inicial fica de modo que, depois desta compra, o saldo seja o informado
        const initial = u.saldo !== null ? bal + rowAmt : bal;
        const newCard = { id: uid(), name, holder: $("ncHolder" + k).value.trim(), type: $("ncType" + k).value, issuer: $("ncIssuer" + k).value, last4, monthlyCredit: 0, creditDay: "", dayMode: "none", amountMode: "fixed", balance: 0, createdAt: Date.now(), secret: null };
        save.disabled = true;
        const ok = await run(async () => {
          await Store.put("cards", newCard);
          if (initial > 0) await postTxs(newCard, [{ kind: "credit", amount: initial, desc: "Saldo inicial", source: "ajuste", date: $("rDate").value || todayISO() }]);
        });
        if (!ok) { save.disabled = false; return; }
        askPersist();
        // escolhe o cartão novo para este vale
        selectRow(k, newCard.id);
        $("ncBox" + k).innerHTML = "";
        $("unk" + k).className = "notice info";
        $("unk" + k).innerHTML = `<span>Cartão <b>${esc(name)}</b> cadastrado e escolhido para este vale. Agora é só salvar o cupom.</span>`;
      }
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
      <p>Tudo fica guardado apenas neste celular, dentro do app. Nada é enviado para a internet, a menos que você ligue por conta própria o backup no Drive (a cópia vai para o seu Google Drive) ou a leitura com o Gemini (as fotos vão para o Google). As senhas do cofre só saem do celular dentro do backup, e criptografadas.</p>
      <p>Se você desinstalar o app, limpar os dados do Chrome ou trocar de celular, os dados se perdem. Faça backup e guarde o arquivo no Google Drive ou envie para você mesmo.</p>
      <p class="hint">${esc(usage)} ${persisted ? "O Android foi avisado para não apagar estes dados sozinho." : ""}</p>
      <div class="btnrow"><button class="btn primary" id="abBk">Fazer backup agora</button><button class="btn" data-close>Fechar</button></div>`, () => {
      $("abBk").addEventListener("click", backupSheet);
    });
  }

  async function coletarFotos() {
    const out = [];
    for (const r of await IDB.all("receipts")) out.push({ id: r.id, createdAt: r.createdAt, data: await blobToDataURL(r.blob) });
    return out;
  }

  // ---------- backup no Drive (opcional; veja js/drive.js e apps-script/backup.gs) ----------
  const driveOn = () => !!(S.meta.drive && S.meta.drive.ligado && S.meta.drive.url && S.meta.drive.secret);
  // Gera o backup e manda ao script. Lança Error com texto em português se não der.
  async function enviarAoDrive() {
    const d = S.meta.drive, fotos = !!d.fotos;
    const receipts = fotos ? await coletarFotos() : [];
    const conteudo = JSON.stringify(Drive.montarBackup({ cards: S.cards, txs: S.txs, meta: S.meta, receipts }, fotos));
    if (!Drive.cabe(conteudo)) throw new Error("Com as fotos o backup passa do limite do Drive. Salve sem fotos ou apague fotos antigas em Ajustes → Fotos.");
    await Drive.chamar(d, { acao: "salvar", nome: Drive.nomeArquivo(new Date()), conteudo });
    const agora = Date.now();
    await Store.setMeta({ ...S.meta, lastBackup: agora, drive: { ...S.meta.drive, ultimo: agora, ultimoErro: null } });
  }
  async function salvarNoDrive() {
    if (!driveOn()) { driveSheet(); return; }
    toast("Salvando no Drive…");
    const ok = await run(enviarAoDrive, "Backup salvo no Drive.");
    return ok;
  }
  // Ao abrir o app: em segundo plano, sem aviso de erro (tenta de novo na próxima abertura).
  async function driveAutomatico() {
    if (!driveOn() || !navigator.onLine) return;
    const d = S.meta.drive;
    const novos = d.ultimo ? S.txs.filter(t => (t.createdAt || 0) > d.ultimo).length : S.txs.length;
    if (!Drive.precisaSalvar({ ligado: true, ultimo: d.ultimo, novos, agora: Date.now() })) return;
    try { await enviarAoDrive(); }
    catch (e) {
      console.warn("backup no Drive", e);
      try { await Store.setMeta({ ...S.meta, drive: { ...S.meta.drive, ultimoErro: Date.now() } }); } catch (e2) {}
    }
    if (!S.busy && !$("scrim")) render();
  }
  async function restaurarDoDrive() {
    if (!driveOn()) { driveSheet(); return; }
    toast("Buscando backups no Drive…");
    let itens;
    try { itens = (await Drive.chamar(S.meta.drive, { acao: "listar" })).itens || []; }
    catch (e) { toast(e.message); return; }
    if (!itens.length) { toast("Ainda não há backups no Drive."); return; }
    const fmtTam = b => b >= 1048576 ? (b / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
    openSheet(`
      <h3>Restaurar do Drive</h3>
      <p class="hint">Escolha o backup. Antes de trocar os dados deste celular, o app pede a sua confirmação.</p>
      <div class="menu">${itens.map((it, i) => `<button data-i="${i}"><span class="t">${esc(new Date(it.data).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }))}</span><span class="s num">${fmtTam(it.tamanho)}</span></button>`).join("")}</div>
      <div class="btnrow"><button class="btn" data-close>Cancelar</button></div>`, sheet => {
      sheet.querySelectorAll("[data-i]").forEach(b => b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          const r = await Drive.chamar(S.meta.drive, { acao: "ler", id: itens[+b.dataset.i].id });
          importFile(JSON.parse(r.conteudo));
        } catch (e) { b.disabled = false; toast(e instanceof SyntaxError ? "Este backup do Drive não é válido." : e.message); }
      }));
    });
  }
  function driveSheet() {
    const d = S.meta.drive || {};
    let secret = d.secret || Drive.gerarSegredo();
    openSheet(`
      <h3>Backup no Drive</h3>
      <p class="hint">O Ciclo guarda uma cópia dos seus dados numa pasta do seu Google Drive, sozinho, a cada 7 dias ou 30 lançamentos novos. Se perder o celular, você restaura de lá. É preciso fazer uma vez a configuração abaixo, no computador.</p>
      <form id="dForm" class="sform" autocomplete="off">
        <label class="field"><span>Código secreto (copie e use no passo 2)</span>
          <input id="dSec" type="text" readonly value="${esc(secret)}"></label>
        <div class="btnrow"><button class="btn small" type="button" id="dCopy">Copiar código</button><button class="btn small" type="button" id="dNew">Gerar outro</button></div>
        <ol class="hint">
          <li>No computador, abra script.google.com, crie um projeto e cole o arquivo <b>apps-script/backup.gs</b> do Ciclo.</li>
          <li>Troque o texto da linha SEGREDO_LOCAL pelo código acima e rode a função <b>configurar</b>.</li>
          <li>Implante como <b>App da Web</b> (executar como você; acesso: qualquer pessoa) e copie o link.</li>
          <li>Cole o link aqui e toque em <b>Testar conexão</b>.</li>
        </ol>
        <label class="field"><span>Link do script</span><input id="dUrl" type="url" inputmode="url" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(d.url || "")}"></label>
        <label class="check"><input type="checkbox" id="dOn" ${d.ligado ? "checked" : ""}> <span>Salvar no Drive automaticamente</span></label>
        <label class="check"><input type="checkbox" id="dFotos" ${d.fotos ? "checked" : ""}> <span>Incluir fotos (o backup fica bem maior e pode passar do limite de 20 MB)</span></label>
        <p class="hint">Quem tiver o link e o código consegue ler os backups. Não compartilhe os dois. O link e o código ficam só neste celular e não entram no backup.</p>
        <div class="err" id="dErr"></div>
        <p class="hint" id="dOk"></p>
        <div class="btnrow">
          <button class="btn primary" type="submit" id="dSave">Salvar</button>
          <button class="btn" type="button" id="dTest">Testar conexão</button>
          <button class="btn" type="button" data-close>Fechar</button>
        </div>
      </form>`, () => {
      const cfg = () => ({ url: $("dUrl").value.trim(), secret });
      $("dCopy").addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(secret); toast("Código copiado."); } catch (e) { $("dSec").select(); toast("Selecione e copie o código."); }
      });
      $("dNew").addEventListener("click", () => { secret = Drive.gerarSegredo(); $("dSec").value = secret; $("dOk").textContent = "Código novo. Troque também no script e rode “configurar” de novo."; });
      $("dTest").addEventListener("click", async () => {
        $("dErr").textContent = ""; $("dOk").textContent = "";
        if (!/^https:\/\//i.test(cfg().url)) { $("dErr").textContent = "Cole o link do App da Web (começa com https://)."; return; }
        $("dTest").disabled = true; $("dTest").textContent = "Testando…";
        try { await Drive.chamar(cfg(), { acao: "listar" }); $("dOk").textContent = "Conectado."; }
        catch (e) { $("dErr").textContent = e.message; }
        $("dTest").disabled = false; $("dTest").textContent = "Testar conexão";
      });
      $("dForm").addEventListener("submit", async e => {
        e.preventDefault();
        const { url } = cfg(), ligado = $("dOn").checked;
        $("dErr").textContent = "";
        if (ligado && !/^https:\/\//i.test(url)) { $("dErr").textContent = "Cole o link do App da Web (começa com https://) para ligar."; return; }
        const drive = { ...d, url, secret, ligado, fotos: $("dFotos").checked };
        if (ligado && !d.ligado) { drive.ligadoEm = Date.now(); drive.ultimoErro = null; }
        const ok = await run(() => Store.setMeta({ ...S.meta, drive }), ligado ? "Backup no Drive ligado." : "Configuração salva.");
        if (ok) { closeSheet(); if (ligado && !d.ligado) driveAutomatico(); }
      });
    }, { secret: true });
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
          const fotos = $("bkPhotos").checked;
          const data = Drive.montarBackup({ cards: S.cards, txs: S.txs, meta: S.meta, receipts: fotos ? await coletarFotos() : [] }, fotos);
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

  // Aceita o arquivo escolhido ou os dados já lidos (restaurar do Drive).
  async function importFile(file) {
    let data;
    try { data = typeof file.text === "function" ? JSON.parse(await file.text()) : file; } catch (e) { toast("Este arquivo não é um backup válido."); return; }
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
      case "gf-view": S.gfView = el.dataset.v; render(); break;
      case "gf-off": S.gfOffset = Math.max(-36, Math.min(0, S.gfOffset + Number(el.dataset.d))); render(); break;
      case "per": S.periodOffset = Math.min(0, S.periodOffset + Number(el.dataset.d)); render(); break;
      case "new-card": cardSheet(null); break;
      case "edit-card": card && cardSheet(card); break;
      case "new-tx": txSheet(id, el.dataset.kind); break;
      case "adjust": card && adjustSheet(card); break;
      case "scan": openCamera(id || null); break;
      case "scan-gallery": openGallery(id || null); break;
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
      case "credito-prev-confirm": card && creditSheet(card); break;
      case "credito-aviso-ligar": avisoLigar(); break;
      case "credito-aviso-desligar": avisoDesligar(); break;
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
      case "recorte-auto": run(() => Store.setMeta({ ...S.meta, recorteAuto: !Recorte.autoLigado(S.meta) })); break;
      case "install": installApp(); break;
      case "m-backup": backupSheet(); break;
      case "export-csv": exportarPlanilha(); break;
      case "m-drive": driveSheet(); break;
      case "drive-save": salvarNoDrive(); break;
      case "drive-restore": restaurarDoDrive(); break;
      case "m-photos": photosSheet(); break;
      case "m-about": aboutSheet(); break;
      case "m-master": changeMasterSheet(); break;
      case "m-theme": themeSheet(); break;
      case "m-gemini": geminiSheet(); break;
      case "update-check": {
        el.querySelector(".s").textContent = "Verificando…";
        await checkUpdate(true);
        render(); break;
      }
      case "update-now": applyUpdate(); break;
      case "update-force":
        confirmSheet("Recarregar o app?", "O app baixa de novo todos os seus arquivos e reinicia. Seus cartões, extratos, fotos e senhas não são afetados. Precisa de internet.", "Recarregar", async () => { applyUpdate(); return true; });
        break;
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
  $("camIn").addEventListener("change", e => { const files = e.target.files; if (files && files.length) startScan(files, S.scanCard); e.target.value = ""; });
  $("importIn").addEventListener("change", e => { const f = e.target.files && e.target.files[0]; if (f) importFile(f); e.target.value = ""; });
  $("installBtn").addEventListener("click", installApp);
  window.addEventListener("scroll", () => $("appbar").classList.toggle("scrolled", window.scrollY > 4), { passive: true });
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); S.installEvt = e; renderTop(); });
  window.addEventListener("appinstalled", () => { S.installEvt = null; renderTop(); toast("App instalado."); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { lockVault(); return; }
    // ao voltar para o app, verifica de novo se passou mais de 6 horas
    if (!S.lastUpdateCheck || Date.now() - S.lastUpdateCheck > 6 * 3600 * 1000) checkUpdate(false);
  });

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
      setTimeout(() => checkUpdate(false), 1500);
      setTimeout(driveAutomatico, 3000);
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
    // O aviso de crédito por notificação só aparece com periodicSync e o app instalado.
    navigator.serviceWorker.ready.then(reg => {
      const instalado = window.matchMedia && matchMedia("(display-mode: standalone)").matches;
      S.periodicOk = "periodicSync" in reg && instalado;
      if (S.periodicOk && S.loaded && S.tab === "ajustes") render();
    }).catch(e => console.warn("service worker", e));
  }
})();
