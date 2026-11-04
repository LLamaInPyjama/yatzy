(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------
  const STORE_KEY = 'yatzy.game.v1';
  const PREFS_KEY = 'yatzy.prefs.v2';
  const COLORS = ['#d4553a', '#2f6db5', '#2f8a57', '#9a52b8'];

  // null = no fixed value -> the thrown dice sum is entered instead.
  const DEFAULT_RULES = {
    fullHouse: 30,
    pairs: 30,
    smallStraight: 30,
    largeStraight: 40,
    yatzy: 50,
    bonusThreshold: 84,
    bonus: 35,
  };
  const RULE_INPUTS = [
    { key: 'fullHouse', label: 'Full House', optional: true },
    { key: 'pairs', label: 'Paare', optional: true },
    { key: 'smallStraight', label: 'Kl. Straße', optional: true },
    { key: 'largeStraight', label: 'Gr. Straße', optional: true },
    { key: 'yatzy', label: 'Yatzy', optional: true },
    { key: 'bonusThreshold', label: 'Bonus ab (Summe oben)', optional: false },
    { key: 'bonus', label: 'Bonus-Punkte', optional: false },
  ];

  const WORDS = ['Einser', 'Zweier', 'Dreier', 'Vierer', 'Fünfer', 'Sechser'];
  const UPPER = WORDS.map((word, i) => ({ id: 'u' + (i + 1), label: i + 1 + 'er', word, kind: 'count', face: i + 1 }));
  const LOWER = [
    { id: 'k3', label: '3er Pasch', kind: 'sum' },
    { id: 'k4', label: '4er Pasch', kind: 'sum' },
    { id: 'k5', label: '5er Pasch', kind: 'sum' },
    { id: 'fh', label: 'Full House', kind: 'rule', rule: 'fullHouse' },
    { id: 'pa', label: 'Paare', kind: 'rule', rule: 'pairs' },
    { id: 'ss', label: 'Kl. Straße', kind: 'rule', rule: 'smallStraight' },
    { id: 'ls', label: 'Gr. Straße', kind: 'rule', rule: 'largeStraight' },
    { id: 'ya', label: 'Yatzy', kind: 'rule', rule: 'yatzy' },
    { id: 'ch', label: 'Chance', kind: 'sum' },
  ];
  const FIELDS = [...UPPER, ...LOWER];
  const FIELD = Object.fromEntries(FIELDS.map((f) => [f.id, f]));
  const SUM_MIN = 1;
  const SUM_MAX = 36; // 6 dice

  const COLS = [
    { dir: 'down', sym: '↓', name: 'von oben nach unten' },
    { dir: 'free', sym: 'frei', name: 'beliebig' },
    { dir: 'free', sym: 'frei', name: 'beliebig' },
    { dir: 'up', sym: '↑', name: 'von unten nach oben' },
  ];

  // ---------------------------------------------------------------------------
  // Helpers & persistence
  // ---------------------------------------------------------------------------
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function load(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable – game still works for this session */
    }
  }

  let game = load(STORE_KEY);
  if (!game || game.version !== 1 || !Array.isArray(game.players) || !Array.isArray(game.scores)) game = null;

  const storedPrefs = load(PREFS_KEY) || {};
  let prefs = {
    count: [2, 3, 4].includes(storedPrefs.count) ? storedPrefs.count : 2,
    names: Array.isArray(storedPrefs.names) ? storedPrefs.names : [],
    rules: { ...DEFAULT_RULES, ...(storedPrefs.rules || {}) },
  };

  const persist = () => save(STORE_KEY, game);

  // ---------------------------------------------------------------------------
  // Game rules
  // ---------------------------------------------------------------------------
  function fieldMode(f, rules) {
    if (f.kind !== 'rule') return f.kind;
    return rules[f.rule] == null ? 'sum' : 'fixed';
  }

  const points = (v) => (typeof v === 'number' ? v : 0); // 'x' (gestrichen) and empty count 0

  function colScore(col, rules) {
    let upper = 0;
    let upperFilled = 0;
    let lower = 0;
    for (const f of UPPER) {
      if (col[f.id] != null) {
        upperFilled++;
        upper += points(col[f.id]);
      }
    }
    for (const f of LOWER) lower += points(col[f.id]);
    const reached = upper >= rules.bonusThreshold;
    const bonus = reached ? rules.bonus : 0;
    return { upper, upperFilled, upperDone: upperFilled === UPPER.length, reached, bonus, lower, total: upper + bonus + lower };
  }

  function isAllowed(p, c, fid) {
    const col = game.scores[p][c];
    if (col[fid] != null) return false;
    const dir = COLS[c].dir;
    if (dir === 'free') return true;
    const order = dir === 'down' ? FIELDS : [...FIELDS].reverse();
    const next = order.find((f) => col[f.id] == null);
    return !!next && next.id === fid;
  }

  const filledCount = (p) => game.scores[p].reduce((n, col) => n + Object.keys(col).length, 0);
  const isComplete = () => game.players.every((_, p) => filledCount(p) === FIELDS.length * COLS.length);
  const playerTotal = (p) => game.scores[p].reduce((a, col) => a + colScore(col, game.rules).total, 0);

  function newGame(players, rules) {
    return {
      version: 1,
      players,
      rules: { ...rules },
      scores: players.map(() => COLS.map(() => ({}))),
      current: 0,
      history: [],
      finished: false,
      startedAt: Date.now(),
    };
  }

  // ---------------------------------------------------------------------------
  // Screens
  // ---------------------------------------------------------------------------
  function show(id) {
    $('#setup').hidden = id !== 'setup';
    $('#game').hidden = id !== 'game';
    document.body.dataset.screen = id;
    if (id === 'game') keepAwake();
  }

  // ----- Setup ---------------------------------------------------------------
  const setup = { count: 2, names: [], rules: {} };

  function openSetup() {
    const src = game ? game.players.map((p) => p.name) : prefs.names;
    setup.count = game ? game.players.length : prefs.count;
    setup.names = Array.from({ length: 4 }, (_, i) => src[i] || '');
    setup.rules = { ...(game ? game.rules : prefs.rules) };
    renderSetup();
    show('setup');
    window.scrollTo(0, 0);
  }

  function renderSetup() {
    const n = setup.count;
    const players = setup.names
      .slice(0, n)
      .map(
        (name, i) => `
        <li class="prow" style="--pc:${COLORS[i]}">
          <span class="pnum">${i + 1}</span>
          <input class="pinput" data-i="${i}" value="${esc(name)}" placeholder="Spieler ${i + 1}"
                 autocomplete="off" autocorrect="off" autocapitalize="words" spellcheck="false" enterkeyhint="next" maxlength="16">
          <button type="button" class="icon-btn" data-move="${i}" data-by="-1" ${i === 0 ? 'disabled' : ''} aria-label="Nach oben">↑</button>
          <button type="button" class="icon-btn" data-move="${i}" data-by="1" ${i === n - 1 ? 'disabled' : ''} aria-label="Nach unten">↓</button>
        </li>`
      )
      .join('');

    const rules = RULE_INPUTS.map(
      (r) => `
        <label class="rule">
          <span>${r.label}</span>
          <input type="number" inputmode="numeric" min="0" max="999" data-rule="${r.key}"
                 value="${setup.rules[r.key] ?? ''}" placeholder="${r.optional ? 'Augensumme' : DEFAULT_RULES[r.key]}">
        </label>`
    ).join('');

    $('#setup-body').innerHTML = `
      ${game ? `<button type="button" class="btn btn-ghost resume" data-act="resume">← Zurück zum ${game.finished ? 'letzten' : 'laufenden'} Spiel</button>` : ''}
      <section class="card">
        <div class="card-head">
          <h2>Spieler</h2>
          <div class="seg" role="group" aria-label="Anzahl Spieler">
            ${[2, 3, 4].map((k) => `<button type="button" class="seg-btn ${k === n ? 'on' : ''}" data-count="${k}" aria-pressed="${k === n}">${k}</button>`).join('')}
          </div>
        </div>
        <p class="muted small">Reihenfolge = Spielreihenfolge. Spieler 1 beginnt.</p>
        <ol class="plist">${players}</ol>
        <button type="button" class="btn btn-ghost" data-act="shuffle">🎲 Reihenfolge auslosen</button>
      </section>
      <details class="card rules">
        <summary>Punkte &amp; Regeln</summary>
        <p class="muted small">Leeres Feld = es wird die geworfene Augensumme eingetragen. 1er–6er, Pasch und Chance werden immer als Augen eingetragen.</p>
        <div class="rule-grid">${rules}</div>
        <ul class="muted small legend">
          <li><b>Spalte 1 (↓)</b> nur von oben nach unten</li>
          <li><b>Spalte 2 + 3 (frei)</b> beliebige Reihenfolge</li>
          <li><b>Spalte 4 (↑)</b> nur von unten nach oben</li>
        </ul>
      </details>
      <button type="button" class="btn btn-primary btn-big" data-act="start">Spiel starten</button>
    `;
  }

  $('#setup-body').addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches('.pinput')) setup.names[+t.dataset.i] = t.value;
    if (t.matches('[data-rule]')) {
      const def = RULE_INPUTS.find((r) => r.key === t.dataset.rule);
      const v = t.value.trim() === '' ? null : Math.max(0, Math.round(+t.value));
      setup.rules[def.key] = v == null && !def.optional ? DEFAULT_RULES[def.key] : v;
    }
  });

  $('#setup-body').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches('.pinput')) return;
    e.preventDefault();
    const next = $(`.pinput[data-i="${+e.target.dataset.i + 1}"]`);
    if (next) next.focus();
    else e.target.blur();
  });

  $('#setup-body').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.count) {
      setup.count = +b.dataset.count;
      renderSetup();
    } else if (b.dataset.move) {
      const i = +b.dataset.move;
      const j = i + +b.dataset.by;
      [setup.names[i], setup.names[j]] = [setup.names[j], setup.names[i]];
      renderSetup();
    } else if (b.dataset.act === 'shuffle') {
      const list = setup.names.slice(0, setup.count);
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      setup.names.splice(0, list.length, ...list);
      renderSetup();
      toast(`${list[0].trim() || 'Spieler 1'} beginnt`);
    } else if (b.dataset.act === 'start') {
      startGame();
    } else if (b.dataset.act === 'resume') {
      showGame();
    }
  });

  async function startGame() {
    if (game && !game.finished && game.history.length) {
      const ok = await confirmBox('Laufendes Spiel verwerfen?', 'Das aktuelle Spielblatt wird gelöscht.', 'Neu starten', true);
      if (!ok) return;
    }
    const players = setup.names
      .slice(0, setup.count)
      .map((name, i) => ({ name: name.trim() || `Spieler ${i + 1}`, color: COLORS[i] }));
    prefs = { count: setup.count, names: setup.names.map((s) => s.trim()), rules: { ...setup.rules } };
    save(PREFS_KEY, prefs);
    game = newGame(players, setup.rules);
    persist();
    showGame();
  }

  // ----- Game ----------------------------------------------------------------
  let lastKey = null; // cell that was just written, for a short highlight

  function showGame() {
    renderGame();
    show('game');
  }

  function renderGame() {
    renderStatus();
    renderBoard();
    $('#btn-undo').disabled = !game.history.length;
  }

  function renderStatus() {
    const el = $('#status');
    if (game.finished) {
      el.innerHTML = `<button type="button" class="btn btn-primary" data-act="results">🏆 Ergebnis anzeigen</button>`;
    } else if (isComplete()) {
      el.innerHTML = `<button type="button" class="btn btn-primary pulse" data-act="finish">Endstand berechnen</button>`;
    } else {
      const p = game.current;
      const pl = game.players[p];
      const turn = Math.min(filledCount(p) + 1, FIELDS.length * COLS.length);
      el.innerHTML = `
        <div class="turn-pill" style="--pc:${pl.color}">
          <span class="dot"></span><b>${esc(pl.name)}</b>&nbsp;ist dran
          <span class="muted turn-no">Zug ${turn} / ${FIELDS.length * COLS.length}</span>
        </div>`;
    }
  }

  function renderBoard() {
    const fin = game.finished;
    const rules = game.rules;
    const scores = game.scores.map((cols) => cols.map((col) => colScore(col, rules)));
    const turnCls = (p) => (!fin && p === game.current ? ' turn' : '');
    const out = [];

    // Header: names
    out.push('<div class="cell corner"></div>');
    game.players.forEach((pl, p) => {
      const cur = !fin && p === game.current;
      out.push(`
        <button type="button" class="cell pname${cur ? ' is-turn' : ''}" data-player="${p}" style="--pc:${pl.color}">
          <span class="nm">${esc(pl.name)}</span>${fin ? `<span class="ptot">${playerTotal(p)}</span>` : ''}
        </button>`);
    });
    // Header: column directions
    game.players.forEach((pl, p) =>
      COLS.forEach((col, c) =>
        out.push(`<div class="cell dir${c === 3 ? ' gend' : ''}${turnCls(p)}" style="--pc:${pl.color}" title="${col.name}">${col.sym}</div>`)
      )
    );

    const fieldRow = (f, extra = '') => {
      out.push(`<div class="cell label${extra}">${f.label}</div>`);
      game.players.forEach((pl, p) =>
        COLS.forEach((_, c) => {
          const v = game.scores[p][c][f.id];
          let cls = 'cell sc' + extra + (c === 3 ? ' gend' : '') + turnCls(p);
          let inner = '';
          if (v === 'x') {
            cls += ' filled struck';
            inner = '<span class="strike" aria-label="gestrichen"></span>';
          } else if (v != null) {
            cls += ' filled';
            inner = v;
          } else if (!fin && p === game.current && isAllowed(p, c, f.id)) {
            cls += ' open';
          }
          if (lastKey === `${p}.${c}.${f.id}`) cls += ' just';
          out.push(`<div class="${cls}" data-p="${p}" data-c="${c}" data-f="${f.id}" style="--pc:${pl.color}">${inner}</div>`);
        })
      );
    };

    const calcRow = (label, extra, fn) => {
      out.push(`<div class="cell label calc${extra}">${label}</div>`);
      game.players.forEach((pl, p) =>
        COLS.forEach((_, c) => {
          const [content, cls = ''] = fn(scores[p][c]);
          out.push(`<div class="cell calc${extra}${c === 3 ? ' gend' : ''}${turnCls(p)} ${cls}" style="--pc:${pl.color}">${content}</div>`);
        })
      );
    };

    UPPER.forEach((f) => fieldRow(f));
    calcRow('Summe', ' sep', (s) => [s.upperFilled ? s.upper : '']);
    calcRow(`Bonus <small>ab ${rules.bonusThreshold}</small>`, '', (s) => {
      if (s.reached) return [`+${s.bonus}`, 'ok'];
      if (s.upperDone) return ['0', 'miss'];
      if (s.upperFilled) return [`<small>−${rules.bonusThreshold - s.upper}</small>`, 'need'];
      return [''];
    });
    LOWER.forEach((f, i) => fieldRow(f, i === 0 ? ' sep' : ''));
    calcRow('Gesamt', ' total', (s) => [fin ? s.total : '']);

    const board = $('#board');
    board.style.setProperty('--players', game.players.length);
    board.innerHTML = out.join('');
    lastKey = null;
  }

  $('#board').addEventListener('click', async (e) => {
    const nameBtn = e.target.closest('[data-player]');
    if (nameBtn) {
      const p = +nameBtn.dataset.player;
      if (game.finished || p === game.current) return;
      const ok = await confirmBox(`${game.players[p].name} ist dran?`, 'Nur nötig, falls die Reihenfolge durcheinander geraten ist.', 'Ja, wechseln');
      if (ok) {
        game.current = p;
        persist();
        renderGame();
      }
      return;
    }
    const cell = e.target.closest('[data-f]');
    if (!cell) return;
    const p = +cell.dataset.p;
    const c = +cell.dataset.c;
    const fid = cell.dataset.f;
    if (game.scores[p][c][fid] != null) return openEntry(p, c, fid);
    if (game.finished) return;
    if (p !== game.current) return toast(`${game.players[game.current].name} ist dran`);
    if (isAllowed(p, c, fid)) return openEntry(p, c, fid);
    toast(`Spalte ${c + 1} wird ${COLS[c].name} ausgefüllt`);
  });

  $('#status').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'finish') {
      game.finished = true;
      persist();
      renderGame();
      openResults();
    } else if (b.dataset.act === 'results') {
      openResults();
    }
  });

  $('#btn-undo').addEventListener('click', undo);

  // Fullscreen (iPad Safari supports it for pages; not needed when launched from the home screen)
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  const fsEnabled = document.fullscreenEnabled || document.webkitFullscreenEnabled;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const fsBtn = $('#btn-fs');
  const syncFs = () => {
    fsBtn.textContent = fsEl() ? '⤡ Vollbild beenden' : '⛶ Vollbild';
  };
  if (fsEnabled && !standalone) {
    fsBtn.hidden = false;
    fsBtn.addEventListener('click', () => {
      const root = document.documentElement;
      try {
        if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        else (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
      } catch {
        toast('Vollbild wird nicht unterstützt');
      }
    });
    document.addEventListener('fullscreenchange', syncFs);
    document.addEventListener('webkitfullscreenchange', syncFs);
  }
  $('#btn-new').addEventListener('click', openSetup);

  function commit(p, c, fid, val) {
    const col = game.scores[p][c];
    const prev = col[fid] ?? null;
    closeDialog($('#entry'));
    if (prev === val) return;
    const isNew = prev === null;
    game.history.push({ p, c, f: fid, prev, turn: game.current });
    col[fid] = val;
    if (isNew) game.current = (p + 1) % game.players.length;
    persist();
    lastKey = `${p}.${c}.${fid}`;
    renderGame();
    if (isNew && isComplete()) toast('Alle Felder ausgefüllt – Endstand berechnen!');
  }

  function undo() {
    const h = game.history.pop();
    if (!h) return;
    const col = game.scores[h.p][h.c];
    if (h.prev === null) delete col[h.f];
    else col[h.f] = h.prev;
    game.current = h.turn;
    if (!isComplete()) game.finished = false;
    persist();
    lastKey = `${h.p}.${h.c}.${h.f}`;
    renderGame();
    toast(`Rückgängig: ${game.players[h.p].name} · ${FIELD[h.f].label} (Spalte ${h.c + 1})`);
  }

  // ---------------------------------------------------------------------------
  // Entry dialog
  // ---------------------------------------------------------------------------
  const pad = { active: false, str: '', fresh: false, target: null };

  function openEntry(p, c, fid) {
    const f = FIELD[fid];
    const pl = game.players[p];
    const mode = fieldMode(f, game.rules);
    const cur = game.scores[p][c][fid];
    const editing = cur != null;
    const curText = cur === 'x' ? 'gestrichen' : cur;

    let body = '';
    let hint = '';
    if (mode === 'count') {
      hint = `Wie viele ${f.word} wurden geworfen?`;
      body = `<div class="picks">${[1, 2, 3, 4, 5, 6]
        .map((k) => {
          const v = k * f.face;
          return `<button type="button" class="pick${cur === v ? ' on' : ''}" data-val="${v}"><b>${v}</b><small>${k}×</small></button>`;
        })
        .join('')}</div>`;
    } else if (mode === 'fixed') {
      const v = game.rules[f.rule];
      hint = `${f.label} geworfen?`;
      body = `<button type="button" class="pick pick-wide${cur === v ? ' on' : ''}" data-val="${v}"><b>${v}</b><small>Punkte eintragen</small></button>`;
    } else {
      hint = 'Geworfene Augensumme eingeben';
      body = `
        <div class="pad-display"><span id="pad-val"></span><small>Augen</small></div>
        <div class="keypad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button type="button" class="key" data-key="${d}">${d}</button>`).join('')}
          <button type="button" class="key key-fn" data-key="del" aria-label="Löschen">⌫</button>
          <button type="button" class="key" data-key="0">0</button>
          <button type="button" class="key key-ok" data-key="ok">OK</button>
        </div>`;
    }

    const dlg = $('#entry');
    dlg.innerHTML = `
      <div class="sheet" style="--pc:${pl.color}">
        <header class="sheet-head">
          <div class="who"><span class="dot"></span>${esc(pl.name)} · Spalte ${c + 1} <span class="dirtag">${COLS[c].sym}</span></div>
          <h2>${f.label}</h2>
          <p class="muted">${editing ? `Korrigieren · bisher: <b>${curText}</b>` : hint}</p>
        </header>
        <div class="sheet-body">${body}</div>
        <footer class="sheet-foot">
          <button type="button" class="btn btn-danger${cur === 'x' ? ' on' : ''}" data-val="x">✕ Streichen</button>
          <button type="button" class="btn" data-act="cancel">Abbrechen</button>
        </footer>
      </div>`;

    pad.active = mode === 'sum';
    pad.str = typeof cur === 'number' && pad.active ? String(cur) : '';
    pad.fresh = editing;
    pad.target = { p, c, fid };
    if (pad.active) updatePad();
    dlg.showModal();
    // Keep focus off buttons so nothing looks pre-selected on iPad.
    dlg.querySelector('.sheet').setAttribute('tabindex', '-1');
    dlg.querySelector('.sheet').focus();
  }

  function padValue() {
    const n = parseInt(pad.str, 10);
    return Number.isFinite(n) && n >= SUM_MIN && n <= SUM_MAX ? n : null;
  }

  function updatePad() {
    const el = $('#pad-val');
    if (!el) return;
    el.textContent = pad.str || '–';
    const tooBig = pad.str && parseInt(pad.str, 10) > SUM_MAX;
    el.parentElement.classList.toggle('bad', !!tooBig);
    el.parentElement.querySelector('small').textContent = tooBig ? `max. ${SUM_MAX}` : 'Augen';
    const ok = $('#entry [data-key="ok"]');
    if (ok) ok.disabled = padValue() === null;
  }

  function padKey(k) {
    if (k === 'ok') {
      const v = padValue();
      if (v !== null) commit(pad.target.p, pad.target.c, pad.target.fid, v);
      return;
    }
    if (pad.fresh) {
      pad.str = '';
      pad.fresh = false;
    }
    if (k === 'del') pad.str = pad.str.slice(0, -1);
    else if (pad.str.length < 2) pad.str = (pad.str + k).replace(/^0+/, '');
    updatePad();
  }

  $('#entry').addEventListener('click', (e) => {
    const dlg = $('#entry');
    if (e.target === dlg) return closeDialog(dlg); // tap on backdrop
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.act === 'cancel') return closeDialog(dlg);
    if (b.dataset.key) return padKey(b.dataset.key);
    if (b.dataset.val) {
      const { p, c, fid } = pad.target;
      commit(p, c, fid, b.dataset.val === 'x' ? 'x' : +b.dataset.val);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!$('#entry').open || !pad.active) return;
    if (/^[0-9]$/.test(e.key)) padKey(e.key);
    else if (e.key === 'Backspace') padKey('del');
    else if (e.key === 'Enter') {
      e.preventDefault();
      padKey('ok');
    }
  });

  // ---------------------------------------------------------------------------
  // Results
  // ---------------------------------------------------------------------------
  function openResults() {
    const rows = game.players
      .map((pl, p) => {
        const cs = game.scores[p].map((col) => colScore(col, game.rules));
        return { pl, cs, total: cs.reduce((a, s) => a + s.total, 0), bonuses: cs.filter((s) => s.reached).length };
      })
      .sort((a, b) => b.total - a.total);

    const list = rows
      .map((r) => {
        const rank = 1 + rows.filter((o) => o.total > r.total).length;
        return `
        <li class="rank rank-${rank}" style="--pc:${r.pl.color}">
          <span class="pos">${rank}</span>
          <div class="rinfo">
            <b>${esc(r.pl.name)}</b>
            <span class="muted small">Spalten ${r.cs.map((s) => s.total).join(' · ')}${r.bonuses ? ` · ${r.bonuses}× Bonus` : ''}</span>
          </div>
          <span class="rtotal">${r.total}</span>
        </li>`;
      })
      .join('');

    const winners = rows.filter((r) => r.total === rows[0].total).map((r) => esc(r.pl.name));
    const dlg = $('#results');
    dlg.innerHTML = `
      <div class="sheet">
        <header class="sheet-head center">
          <div class="trophy">🏆</div>
          <h2>${winners.length > 1 ? `Unentschieden: ${winners.join(' & ')}` : `${winners[0]} gewinnt!`}</h2>
          <p class="muted">Endstand</p>
        </header>
        <ol class="ranking">${list}</ol>
        <footer class="sheet-foot">
          <button type="button" class="btn" data-act="close">Zum Spielblatt</button>
          <button type="button" class="btn" data-act="new">Neues Spiel</button>
          <button type="button" class="btn btn-primary" data-act="rematch">Revanche</button>
        </footer>
      </div>`;
    dlg.showModal();
    dlg.querySelector('.sheet').setAttribute('tabindex', '-1');
    dlg.querySelector('.sheet').focus();
  }

  $('#results').addEventListener('click', (e) => {
    const dlg = $('#results');
    if (e.target === dlg) return closeDialog(dlg);
    const act = e.target.closest('button')?.dataset.act;
    if (!act) return;
    closeDialog(dlg);
    if (act === 'new') openSetup();
    if (act === 'rematch') {
      game = newGame(game.players, game.rules);
      persist();
      showGame();
      toast(`Neues Spiel · ${game.players[0].name} beginnt`);
    }
  });

  // ---------------------------------------------------------------------------
  // Confirm, toast, dialogs
  // ---------------------------------------------------------------------------
  function confirmBox(title, text, okLabel, danger = false) {
    return new Promise((resolve) => {
      const dlg = $('#confirm');
      dlg.innerHTML = `
        <div class="sheet">
          <header class="sheet-head"><h2>${esc(title)}</h2><p class="muted">${esc(text)}</p></header>
          <footer class="sheet-foot">
            <button type="button" class="btn" data-ok="0">Abbrechen</button>
            <button type="button" class="btn ${danger ? 'btn-danger solid' : 'btn-primary'}" data-ok="1">${esc(okLabel)}</button>
          </footer>
        </div>`;
      const done = (v) => {
        dlg.removeEventListener('click', onClick);
        dlg.removeEventListener('close', onClose);
        closeDialog(dlg);
        resolve(v);
      };
      const onClick = (e) => {
        if (e.target === dlg) return done(false);
        const b = e.target.closest('[data-ok]');
        if (b) done(b.dataset.ok === '1');
      };
      const onClose = () => done(false);
      dlg.addEventListener('click', onClick);
      dlg.addEventListener('close', onClose);
      dlg.showModal();
    });
  }

  function closeDialog(dlg) {
    if (dlg.open) dlg.close();
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ---------------------------------------------------------------------------
  // Keep the screen on during a game, offline support
  // ---------------------------------------------------------------------------
  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible' && !$('#game').hidden) {
        await navigator.wakeLock.request('screen');
      }
    } catch {
      /* not supported or denied */
    }
  }
  document.addEventListener('visibilitychange', keepAwake);

  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && secure) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  if (game) showGame();
  else openSetup();
})();
