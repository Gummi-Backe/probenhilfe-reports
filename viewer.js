(() => {
  const FIREBASE_DB_BASE = String(window.PH_FIREBASE_DB_BASE || '').trim().replace(/\/+$/, '');
  const FIREBASE_SESSION_PATH = 'sessions/current';

  function firebaseUrl(path) {
    if (!FIREBASE_DB_BASE) return null;
    const base = FIREBASE_DB_BASE.replace(/\/+$/, '');
    const p = String(path || '').replace(/^\/+/, '');
    return `${base}/${p}.json`;
  }

  async function tryFetchJson(path) {
    const url = firebaseUrl(path);
    if (!url) return null;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    try { return await res.json(); } catch { return null; }
  }

  async function patchFirebase(path, payload) {
    const url = firebaseUrl(path);
    if (!url) return false;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => null);
    return !!res && res.ok;
  }

  let toastTimer = null;
  function showToast(text) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = String(text || '');
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
  }

  function escapeHtml(text) {
    return String(text ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function eventTargetElement(e) {
    const t = e?.target;
    if (t instanceof Element) return t;
    if (t && t.nodeType === 3) return t.parentElement; // Text node
    return null;
  }

  function splitHeader(header) {
    const h = String(header || '');
    const i = h.indexOf(':');
    let direction = h, cueText = h;
    if (i >= 0) {
      direction = h.slice(0, i).trim();
      cueText = h.slice(i + 1).trim();
    }
    return { direction, cueText };
  }

  function updateStepIndices(stepsEl) {
    const items = Array.from(stepsEl.querySelectorAll('.step'));
    items.forEach((el, i) => {
      const idx = el.querySelector('.stepIndex');
      if (idx) idx.textContent = String(i + 1);
    });
  }

  function setAllCollapsed(collapsed) {
    document.body.classList.toggle('compact', collapsed);
    document.querySelectorAll('.step').forEach(step => {
      const body = step.querySelector('.stepBody');
      if (!body) return;
      const isOpen = !collapsed;
      body.classList.toggle('open', isOpen);
      body.style.display = isOpen ? 'block' : 'none';
      step.classList.toggle('collapsed', !isOpen);
      const head = step.querySelector('.stepHead');
      if (head) head.setAttribute('aria-expanded', String(isOpen));
    });
  }

  let axisMetaById = null;
  let axisMetaLoadPromise = null;
  async function ensureAxisMetaLoaded(force) {
    if (axisMetaLoadPromise && !force) return axisMetaLoadPromise;
    axisMetaLoadPromise = (async () => {
      try {
        const res = await fetch('axis-meta.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const map = {};
        if (json && Array.isArray(json.axes)) {
          json.axes.forEach(a => { if (a && a.axisId != null) map[String(a.axisId)] = a; });
        } else if (json && json.axesById) {
          Object.keys(json.axesById).forEach(k => { map[String(k)] = json.axesById[k]; });
        }
        axisMetaById = map;
        return map;
      } catch {
        axisMetaById = null;
        return null;
      }
    })();
    return axisMetaLoadPromise;
  }

  function axisLabelHtml(axisId) {
    const meta = axisMetaById?.[String(axisId)];
    const longName = meta?.longName ?? `Achse ${axisId}`;
    const shortName = meta?.shortName ?? '';
    if (!shortName) return `${escapeHtml(longName)}`;
    return `${escapeHtml(longName)} <span class="muted">(${escapeHtml(shortName)})</span>`;
  }

  function axisSortOrder(axisId) {
    const meta = axisMetaById?.[String(axisId)];
    const so = meta?.sortOrder;
    return Number.isFinite(so) ? so : axisId;
  }

  let phData = null;
  let phAxes = null;
  let lastRemoteRev = null;

  function getPhData() { return phData; }
  function getPhAxes() { return phAxes; }

  function renderAxesOverlay() {
    const data = getPhAxes();
    const grid = document.getElementById('axesGrid');
    if (!data || !Array.isArray(data.axes) || !grid) return;
    grid.innerHTML = '';

    const merged = data.axes.map(a => {
      const axisId = a.axisId;
      const meta = axisId != null ? axisMetaById?.[String(axisId)] : null;
      if (meta && meta.enabled === false) return null;
      return {
        axisId,
        target: a.target,
        isChanged: !!a.isChanged,
        longName: meta?.longName ?? `Achse ${axisId}`,
        shortName: meta?.shortName ?? String(axisId ?? ''),
        sortOrder: Number.isFinite(meta?.sortOrder) ? meta.sortOrder : (axisId ?? 0),
        colorHex: meta?.colorHex ?? '#c9d1dc'
      };
    }).filter(Boolean);

    merged.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    merged.forEach(a => {
      const tile = document.createElement('div');
      tile.className = 'axisTile' + (a.isChanged ? ' changed' : '');
      tile.style.setProperty('--axisColor', a.colorHex || '#c9d1dc');
      tile.innerHTML = `
        <div class="axisLong">${escapeHtml(a.longName)}</div>
        <div class="axisShort">${escapeHtml(a.shortName)}</div>
        <div class="axisTarget">${(a.target == null) ? '' : String(a.target)}</div>
      `;
      grid.appendChild(tile);
    });

    const sub = document.getElementById('axesSub');
    if (sub) {
      const from = data.fromCueId != null ? String(data.fromCueId) : '';
      const to = data.toCueId != null ? String(data.toCueId) : '';
      sub.textContent = (from && to) ? `Zielwerte für den Sprung ${from} → ${to}` : '';
    }
  }

  function enableHelp() {
    const helpBtn = document.getElementById('helpBtn');
    const overlay = document.getElementById('helpOverlay');
    const closeBtn = document.getElementById('helpCloseBtn');
    if (!helpBtn || !overlay) return;

    const syncBodyClass = () => {
      const anyOpen = !!document.querySelector('.overlay.open');
      document.body.classList.toggle('modalOpen', anyOpen);
    };

    const open = () => { overlay.classList.add('open'); syncBodyClass(); };
    const close = () => { overlay.classList.remove('open'); syncBodyClass(); };

    helpBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); open(); });
    closeBtn?.addEventListener('click', (e) => { e.preventDefault(); close(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  function enableAxesOverlay() {
    const btn = document.getElementById('axesBtn');
    const overlay = document.getElementById('axesOverlay');
    const closeBtn = document.getElementById('axesCloseBtn');
    if (!btn || !overlay) return;
    const syncBodyClass = () => {
      const anyOpen = !!document.querySelector('.overlay.open');
      document.body.classList.toggle('modalOpen', anyOpen);
    };
    const open = async () => {
      await ensureAxisMetaLoaded(false);
      renderAxesOverlay();
      overlay.classList.add('open');
      syncBodyClass();
    };
    const close = () => { overlay.classList.remove('open'); syncBodyClass(); };
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); open(); });
    closeBtn?.addEventListener('click', (e) => { e.preventDefault(); close(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  function enableCollapse() {
    function toggleForHead(head) {
      if (!head) return;
      const step = head.closest('.step');
      const body = step?.querySelector('.stepBody');
      if (!body) return;
      const isOpen = !body.classList.contains('open');
      body.classList.toggle('open', isOpen);
      body.style.display = isOpen ? 'block' : 'none';
      step?.classList.toggle('collapsed', !isOpen);
      head.setAttribute('aria-expanded', String(isOpen));
    }

    document.addEventListener('click', (e) => {
      const t = eventTargetElement(e);
      const head = t?.closest?.('.stepHead');
      if (!head) return;
      if (t.closest('.dragHandle') || t.closest('.miniBtn')) return;
      toggleForHead(head);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const t = eventTargetElement(e);
      const head = t?.closest?.('.stepHead');
      if (!head) return;
      if (t.closest('.dragHandle') || t.closest('.miniBtn')) return;
      e.preventDefault();
      toggleForHead(head);
    });

    const compactToggle = document.getElementById('compactToggle');
    compactToggle?.addEventListener('change', () => setAllCollapsed(compactToggle.checked));
  }

  function moveStep(step, direction) {
    const parent = step.parentNode;
    if (!parent) return;
    const other = direction < 0 ? step.previousElementSibling : step.nextElementSibling;
    if (!other) return;

    const prefersReducedMotion = (() => {
      try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
      catch { return false; }
    })();

    const beforeRects = new Map();
    if (!prefersReducedMotion) {
      Array.from(parent.querySelectorAll(':scope > .step')).forEach(el => {
        beforeRects.set(el, el.getBoundingClientRect());
      });
    }

    if (direction < 0) parent.insertBefore(step, other);
    else parent.insertBefore(other, step);

    updateStepIndices(parent);

    if (!prefersReducedMotion) {
      const els = Array.from(parent.querySelectorAll(':scope > .step'));
      els.forEach(el => {
        const before = beforeRects.get(el);
        if (!before) return;
        const after = el.getBoundingClientRect();
        const dx = before.left - after.left;
        const dy = before.top - after.top;
        if (!dx && !dy) return;

        el.style.transition = 'transform 0s';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        el.getBoundingClientRect(); // force reflow

        el.style.transition = 'transform 180ms ease';
        el.style.transform = '';

        const cleanup = () => {
          el.style.transition = '';
          el.style.transform = '';
          el.removeEventListener('transitionend', cleanup);
        };
        el.addEventListener('transitionend', cleanup);
        window.setTimeout(cleanup, 260);
      });
    }

    notifyOrderChanged();
  }

  function enableReorderButtons() {
    document.addEventListener('click', (e) => {
      const t = eventTargetElement(e);
      const btn = t?.closest?.('.miniBtn[data-move]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const step = btn.closest('.step');
      if (!step) return;
      const dir = btn.getAttribute('data-move') === 'up' ? -1 : 1;
      moveStep(step, dir);
    });
  }

  function enablePointerReorder(stepsEl) {
    let dragging = null; // { step, ghost, placeholder, offsetX, offsetY }
    let lastScrollTs = 0;

    function createPlaceholder(height) {
      const ph = document.createElement('div');
      ph.className = 'dropPlaceholder';
      ph.style.height = height + 'px';
      return ph;
    }

    function createGhost(step, rect) {
      const ghost = step.cloneNode(true);
      ghost.classList.add('dragGhost');
      ghost.style.width = rect.width + 'px';
      ghost.style.left = rect.left + 'px';
      ghost.style.top = rect.top + 'px';
      return ghost;
    }

    function setGhostPos(clientX, clientY) {
      if (!dragging) return;
      dragging.ghost.style.left = (clientX - dragging.offsetX) + 'px';
      dragging.ghost.style.top = (clientY - dragging.offsetY) + 'px';
    }

    function autoScroll(clientY) {
      const now = Date.now();
      if (now - lastScrollTs < 30) return;
      lastScrollTs = now;
      const margin = 70;
      const speed = 22;
      if (clientY < margin) window.scrollBy(0, -speed);
      else if (clientY > (window.innerHeight - margin)) window.scrollBy(0, speed);
    }

    function findOverStep(clientX, clientY) {
      const el = document.elementFromPoint(clientX, clientY);
      if (!el) return null;
      const step = el.closest('.step');
      if (!step) return null;
      if (dragging && step === dragging.step) return null;
      return step;
    }

    function placePlaceholder(overStep, clientY) {
      if (!dragging || !overStep) return;
      const rect = overStep.getBoundingClientRect();
      const insertAfter = clientY > (rect.top + rect.height / 2);
      if (insertAfter) overStep.after(dragging.placeholder);
      else overStep.before(dragging.placeholder);
    }

    function finishDrag() {
      if (!dragging) return;
      const { step, ghost, placeholder } = dragging;
      ghost.remove();
      placeholder.replaceWith(step);
      step.style.display = '';
      dragging = null;
      updateStepIndices(stepsEl);
      notifyOrderChanged();
    }

    function startDrag(step, clientX, clientY) {
      if (dragging) return;
      const rect = step.getBoundingClientRect();
      const ph = createPlaceholder(rect.height);
      const ghost = createGhost(step, rect);
      document.body.appendChild(ghost);
      step.after(ph);
      step.style.display = 'none';
      dragging = {
        step,
        ghost,
        placeholder: ph,
        offsetX: clientX - rect.left,
        offsetY: clientY - rect.top
      };
      setGhostPos(clientX, clientY);
    }

    function bindPointer(pointerId) {
      function move(e) {
        if (!dragging) return;
        if (pointerId != null && e.pointerId !== pointerId) return;
        e.preventDefault();
        setGhostPos(e.clientX, e.clientY);
        autoScroll(e.clientY);
        const over = findOverStep(e.clientX, e.clientY);
        if (over) placePlaceholder(over, e.clientY);
      }
      function up(e) {
        if (pointerId != null && e.pointerId !== pointerId) return;
        window.removeEventListener('pointermove', move, { passive: false });
        window.removeEventListener('pointerup', up, { passive: false });
        window.removeEventListener('pointercancel', up, { passive: false });
        finishDrag();
      }
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up, { passive: false });
      window.addEventListener('pointercancel', up, { passive: false });
    }

    stepsEl.addEventListener('pointerdown', (e) => {
      const t = eventTargetElement(e);
      const handle = t?.closest?.('.dragHandle');
      if (!handle) return;
      const step = handle.closest('.step');
      if (!step) return;
      e.preventDefault();
      e.stopPropagation();
      startDrag(step, e.clientX, e.clientY);
      bindPointer(e.pointerId);
    }, { passive: false });
  }

  function enableFirebaseSync() {
    document.getElementById('syncRefreshBtn')?.addEventListener('click', async (e) => {
      e.preventDefault();
      const changed = await pullOrdersFromFirebase();
      showToast(changed ? 'Sortierung aktualisiert' : 'Keine Änderung');
    });
  }

  function applyOrders(orders) {
    if (!orders) return;
    Object.keys(orders).forEach(sid => {
      const desired = orders[sid];
      if (!Array.isArray(desired) || desired.length === 0) return;
      const section = document.querySelector(`.section[data-sid='${sid}']`);
      const stepsEl = section?.querySelector('.steps');
      if (!stepsEl) return;
      const all = Array.from(stepsEl.querySelectorAll(':scope > .step'));
      const byId = new Map(all.map(el => [el.dataset.stepId, el]));
      const used = new Set();
      const newOrder = [];
      desired.forEach(id => { const el = byId.get(id); if (el) { newOrder.push(el); used.add(id); } });
      all.forEach(el => { const id = el.dataset.stepId; if (!used.has(id)) newOrder.push(el); });
      newOrder.forEach(el => stepsEl.appendChild(el));
      updateStepIndices(stepsEl);
    });
    recomputeAllSections();
  }

  function getCurrentOrders() {
    const orders = {};
    document.querySelectorAll('.section').forEach(section => {
      const sid = section.dataset.sid;
      const stepsEl = section.querySelector('.steps');
      if (!sid || !stepsEl) return;
      orders[sid] = Array.from(stepsEl.querySelectorAll(':scope > .step')).map(el => el.dataset.stepId);
    });
    return orders;
  }

  let pushTimer = null;
  function notifyOrderChanged() {
    recomputeAllSections();
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => pushOrdersToFirebase(), 250);
  }

  async function pushOrdersToFirebase() {
    const orders = getCurrentOrders();
    const now = Date.now();
    const payload = { rev: now, orders, updatedAt: { '.sv': 'timestamp' } };
    await patchFirebase(FIREBASE_SESSION_PATH, payload);
    showToast('Sortierung gespeichert');
  }

  async function pullOrdersFromFirebase() {
    const session = await tryFetchJson(FIREBASE_SESSION_PATH);
    if (!session || !session.orders) return false;
    if (session.rev && lastRemoteRev && session.rev === lastRemoteRev) return false;
    lastRemoteRev = session.rev || null;
    applyOrders(session.orders);
    return true;
  }

  function mapStatusToRowClass(statusKind) {
    switch (statusKind) {
      case 'BringtAufZiel': return 'bring';
      case 'BleibtRichtig':
      case 'KeineBewegung': return 'ok';
      case 'BewegtWegVonZiel': return 'warn';
      default: return 'neutral';
    }
  }

  function setBadge(stepEl, badgeName, text) {
    const badge = stepEl.querySelector(`.badge[data-badge='${badgeName}']`);
    if (!badge) return;
    const t = (text || '').trim();
    if (!t) {
      badge.style.display = 'none';
      badge.textContent = '';
    } else {
      badge.style.display = 'inline-flex';
      badge.textContent = t;
    }
  }

  function setRow(stepEl, axisId, start, target, unblockNotice, statusText, statusKind) {
    const tr = stepEl.querySelector(`tr[data-axisid='${axisId}']`);
    if (!tr) return;
    tr.className = `row ${mapStatusToRowClass(statusKind)}`;

    const startTd = tr.querySelector('[data-role=start]');
    const targetTd = tr.querySelector('[data-role=target]');
    if (startTd) startTd.textContent = (start == null) ? '' : String(start);
    if (targetTd) targetTd.textContent = (target == null) ? '' : String(target);

    const noticeSpan = tr.querySelector('[data-role=unblockNotice]');
    const statusSpan = tr.querySelector('[data-role=statusText]');

    const noticeText = (unblockNotice || '').trim();
    if (noticeSpan) {
      noticeSpan.textContent = noticeText;
      noticeSpan.style.display = noticeText ? 'inline' : 'none';
    }
    if (statusSpan) {
      statusSpan.textContent = statusText || '';
    }
  }

  function reorderAxisRows(stepEl) {
    const tbody = stepEl?.querySelector?.('tbody');
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll('tr[data-axisid]'));
    if (rows.length <= 1) return;

    function groupRank(tr) {
      if (tr.classList.contains('warn')) return 0;
      if (tr.classList.contains('bring')) return 1;
      if (tr.classList.contains('ok')) return 2;
      return 3;
    }

    rows.sort((a, b) => {
      const ga = groupRank(a);
      const gb = groupRank(b);
      if (ga !== gb) return ga - gb;
      const axisA = parseInt(a.dataset.axisid || '', 10);
      const axisB = parseInt(b.dataset.axisid || '', 10);
      return (axisSortOrder(axisA) - axisSortOrder(axisB)) || (axisA - axisB);
    });
    rows.forEach(r => tbody.appendChild(r));
  }

  function recomputeSection(section, model, maxBlocksPerCue) {
    if (!section || !model) return;

    const maxBlocks = Number.isFinite(maxBlocksPerCue) ? maxBlocksPerCue : 3;
    const startPositions = model.startPositions || {};
    const targetPositions = model.targetPositions || {};
    const cueActions = model.cueActions || {};

    const stepsEl = section.querySelector('.steps');
    if (!stepsEl) return;

    const positions = {};
    Object.keys(startPositions).forEach(k => { positions[k] = startPositions[k]; });

    const firstTargetStepIndexByAxis = {};
    const stepEls = Array.from(stepsEl.querySelectorAll(':scope > .step'));
    for (let i = 0; i < stepEls.length; i++) {
      const stepEl = stepEls[i];
      if (!stepEl || stepEl.dataset.disabled === '1') continue;

      const kind = stepEl.dataset.kind;
      if (kind === 'manual') {
        const axisId = parseInt(stepEl.dataset.axisid || '', 10);
        const axisKey = String(axisId);
        if (!Number.isFinite(axisId)) continue;
        if (!Object.prototype.hasOwnProperty.call(targetPositions, axisKey)) continue;
        if (!Object.prototype.hasOwnProperty.call(firstTargetStepIndexByAxis, axisKey)) {
          firstTargetStepIndexByAxis[axisKey] = i;
        }
        continue;
      }

      const cueId = parseInt(stepEl.dataset.cueid || '', 10);
      if (!Number.isFinite(cueId)) continue;
      const actions = cueActions[String(cueId)];
      if (!actions) continue;
      const isBackward = stepEl.dataset.backward === '1';

      for (const axisKey in actions) {
        if (!Object.prototype.hasOwnProperty.call(actions, axisKey)) continue;
        if (Object.prototype.hasOwnProperty.call(firstTargetStepIndexByAxis, axisKey)) continue;
        if (!Object.prototype.hasOwnProperty.call(targetPositions, axisKey)) continue;

        const target = targetPositions[axisKey];
        const act = actions[axisKey];
        const next = isBackward ? act.s : act.e;
        if (next === target) firstTargetStepIndexByAxis[axisKey] = i;
      }
    }

    const blockedEarlier = new Set();
    for (let i = 0; i < stepEls.length; i++) {
      const stepEl = stepEls[i];
      if (!stepEl) continue;

      if (stepEl.dataset.disabled === '1') {
        setBadge(stepEl, 'unblock', '');
        setBadge(stepEl, 'block', '');
        setBadge(stepEl, 'affected', '');
        continue;
      }

      const kind = stepEl.dataset.kind;
      if (kind === 'manual') {
        const axisId = parseInt(stepEl.dataset.axisid || '', 10);
        if (!Number.isFinite(axisId)) continue;
        const axisKey = String(axisId);
        const start = Object.prototype.hasOwnProperty.call(positions, axisKey) ? positions[axisKey] : null;
        const target = Object.prototype.hasOwnProperty.call(targetPositions, axisKey) ? targetPositions[axisKey] : null;

        const needsUnblock = (start != null && target != null && start !== target && blockedEarlier.has(axisId));
        setBadge(stepEl, 'unblock', needsUnblock ? 'Entsperren: 1' : '');
        setBadge(stepEl, 'block', '');
        setBadge(stepEl, 'affected', (target != null ? `Auf Position ${target}` : ''));
        setRow(
          stepEl,
          axisId,
          start,
          target,
          needsUnblock ? 'Vor diesem Cue entsperren.' : '',
          (start != null && target != null && start === target)
            ? `Achse bleibt in diesem Cue auf ${start}.`
            : (target != null ? `Auf Position ${target}` : ''),
          (start != null && target != null && start === target) ? 'KeineBewegung' : 'BringtAufZiel'
        );
        reorderAxisRows(stepEl);
        if (target != null) positions[axisKey] = target;
        if (needsUnblock) blockedEarlier.delete(axisId);
        continue;
      }

      const cueId = parseInt(stepEl.dataset.cueid || '', 10);
      const actions = cueActions[String(cueId)] || {};
      const isBackward = stepEl.dataset.backward === '1';

      const toBlock = [];
      const toUnblock = [];
      const affectedAxes = [];
      const blockedThisStep = new Set();

      for (const axisKey in actions) {
        if (!Object.prototype.hasOwnProperty.call(actions, axisKey)) continue;
        const axisId = parseInt(axisKey, 10);
        if (!Number.isFinite(axisId)) continue;

        const act = actions[axisKey];
        const start = Object.prototype.hasOwnProperty.call(positions, axisKey) ? positions[axisKey] : null;
        const target = Object.prototype.hasOwnProperty.call(targetPositions, axisKey) ? targetPositions[axisKey] : null;

        const scriptStart = isBackward ? act.e : act.s;
        const scriptEnd = isBackward ? act.s : act.e;
        const scriptMoves = scriptStart !== scriptEnd;
        const movesFromCurrent = (start != null) ? (start !== scriptEnd) : scriptMoves;

        const needsUnblock = blockedEarlier.has(axisId) && (start != null && target != null && start !== target);
        if (needsUnblock) toUnblock.push(axisId);

        const lookaheadIdx = firstTargetStepIndexByAxis[axisKey];
        const canHitTargetLater = Number.isFinite(lookaheadIdx) && lookaheadIdx > i;
        const wouldMoveAway = (target != null && movesFromCurrent && scriptEnd !== target);

        let statusKind = 'SonstigeBewegung';
        let statusText = 'Für diesen Sprung ist keine vollständige Positionsinformation vorhanden.';
        const unblockNotice = needsUnblock ? 'Vor diesem Cue entsperren.' : '';

        if (target != null && start != null) {
          if (!movesFromCurrent) {
            statusKind = 'KeineBewegung';
            statusText = (start === target)
              ? `Achse bleibt in diesem Cue auf ${start}.`
              : `Achse bleibt in diesem Cue auf ${start} (Ziel ${target}).`;
          } else if (scriptEnd === target) {
            statusKind = 'BringtAufZiel';
            statusText = `Achse muss von ${start} nach ${target} fahren.`;
          } else if (start === target) {
            statusKind = 'BewegtWegVonZiel';
            statusText = `Achse bleibt in diesem Cue auf ${start} (Ziel ${target}).`;
            toBlock.push(axisId);
            blockedThisStep.add(axisId);
          } else if (wouldMoveAway && canHitTargetLater) {
            statusKind = 'BewegtWegVonZiel';
            statusText = `Cue würde die Achse von ${start} auf ${scriptEnd} setzen (Ziel ${target}).`;
            toBlock.push(axisId);
            blockedThisStep.add(axisId);
          } else if (wouldMoveAway) {
            statusKind = 'BewegtWegVonZiel';
            statusText = `Cue würde die Achse von ${start} auf ${scriptEnd} setzen (Ziel ${target}).`;
          } else {
            statusKind = 'SonstigeBewegung';
            statusText = `Cue setzt die Achse auf ${scriptEnd} (Ziel ${target}).`;
          }
        }

        const willMove = movesFromCurrent && !blockedThisStep.has(axisId);
        if (willMove) affectedAxes.push(axisId);

        setRow(stepEl, axisId, start, target, unblockNotice, statusText, statusKind);
        if (movesFromCurrent && !blockedThisStep.has(axisId)) positions[axisKey] = scriptEnd;
        if (needsUnblock) blockedEarlier.delete(axisId);
      }

      const uniqueToBlock = Array.from(new Set(toBlock));
      const uniqueToUnblock = Array.from(new Set(toUnblock));
      const uniqueAffected = Array.from(new Set(affectedAxes));

      if (uniqueToBlock.length > maxBlocks) setBadge(stepEl, 'block', `ZU VIELE Sperren nötig: ${uniqueToBlock.length}`);
      else setBadge(stepEl, 'block', uniqueToBlock.length ? `Sperren: ${uniqueToBlock.length}` : '');

      setBadge(stepEl, 'unblock', uniqueToUnblock.length ? `Entsperren: ${uniqueToUnblock.length}` : '');
      setBadge(stepEl, 'affected', uniqueAffected.length ? `Fährt: ${uniqueAffected.length}` : '');

      uniqueToBlock.forEach(a => blockedEarlier.add(a));
      reorderAxisRows(stepEl);
    }
  }

  function recomputeAllSections() {
    const ph = getPhData();
    if (!ph || !ph.suggestions) return;
    const maxBlocks = ph.maxBlocksPerCue;
    document.querySelectorAll('.section').forEach(section => {
      const sid = section.dataset.sid;
      const model = sid ? ph.suggestions[sid] : null;
      if (!model) return;
      recomputeSection(section, model, maxBlocks);
    });
  }

  async function renderReport(report) {
    await ensureAxisMetaLoaded(false);

    const titleEl = document.getElementById('reportTitle');
    const subtitleEl = document.getElementById('reportSubtitle');
    const metaEl = document.getElementById('reportMeta');
    const host = document.getElementById('sectionsHost');

    if (titleEl) titleEl.textContent = report?.title || 'Probenhilfe - Cue-Sequenz';
    if (subtitleEl) subtitleEl.textContent = report?.subtitle || '';
    if (metaEl) metaEl.innerHTML = `Export: ${escapeHtml(report?.generatedAt || '')}<br/><span class="muted">Quelle: Probenhilfe</span>`;
    if (!host) return;

    host.innerHTML = '';

    const sections = Array.isArray(report?.sections) ? report.sections : [];
    sections.forEach(section => {
      const sid = section?.sid || '';
      const sec = document.createElement('section');
      sec.className = 'section';
      sec.dataset.sid = sid;
      sec.innerHTML = `
        <div class="sectionHead">
          <div class="sectionTitle">${escapeHtml(section?.title || '')}</div>
          <div class="sectionSummary">${escapeHtml(section?.summary || '')}</div>
        </div>
        <div class="steps"></div>
      `;

      const stepsEl = sec.querySelector('.steps');
      const steps = Array.isArray(section?.steps) ? section.steps : [];
      steps.forEach((step, idx) => {
        const stepId = step?.stepId || '';
        const kind = step?.kind || 'cue';
        const backward = !!step?.backward;
        const disabled = !!step?.disabled;
        const cueId = step?.cueId;
        const axisId = step?.axisId;
        const header = step?.header || `${step?.directionLabel || ''}: ${step?.cueLabel || ''}`;
        const parts = splitHeader(header);
        const dirClass = backward ? 'dirBackward' : 'dirForward';

        const el = document.createElement('div');
        el.className = 'step';
        el.dataset.stepId = stepId;
        el.dataset.kind = kind;
        el.dataset.backward = backward ? '1' : '0';
        el.dataset.disabled = disabled ? '1' : '0';
        if (cueId != null) el.dataset.cueid = String(cueId);
        if (axisId != null) el.dataset.axisid = String(axisId);

        const unblockBadgeText = (step?.axesToUnblockText || '').trim();
        const blockBadgeText = (step?.axesToBlockText || '').trim();
        const affectedBadgeText = (step?.affectedAxesText || '').trim();

        el.innerHTML = `
          <div class="stepHead" role="button" tabindex="0" aria-expanded="true">
            <div class="stepLeft">
              <div class="dragHandle" title="Verschieben">=</div>
              <div class="stepIndex">${idx + 1}</div>
              <div class="stepTitle">
                <span class="dirBadge ${dirClass}">${escapeHtml(parts.direction)}</span>
                <span class="cueText">${escapeHtml(parts.cueText)}</span>
                ${disabled ? '<span class="muted">(deaktiviert)</span>' : ''}
              </div>
            </div>
            <div class="badges">
              <div class="reorderBtns">
                <button class="miniBtn" type="button" data-move="up" title="Nach oben">↑</button>
                <button class="miniBtn" type="button" data-move="down" title="Nach unten">↓</button>
              </div>
              <span class="badge notice" data-badge="unblock" style="display:${unblockBadgeText ? 'inline-flex' : 'none'}">${escapeHtml(unblockBadgeText)}</span>
              <span class="badge warn" data-badge="block" style="display:${blockBadgeText ? 'inline-flex' : 'none'}">${escapeHtml(blockBadgeText)}</span>
              <span class="badge" data-badge="affected" style="display:${affectedBadgeText ? 'inline-flex' : 'none'}">${escapeHtml(affectedBadgeText)}</span>
              <div class="caret" aria-hidden="true">&#x25BE;</div>
            </div>
          </div>
          <div class="stepBody open"></div>
        `;

        const body = el.querySelector('.stepBody');
        if (disabled) {
          body.innerHTML = `<div class="disabledNote">Dieser Step ist deaktiviert.</div>`;
        } else {
          const axisIdsRaw = Array.isArray(step?.axisIds) ? step.axisIds : [];
          const axisIds = Array.from(new Set(axisIdsRaw.map(Number).filter(Number.isFinite))).sort((a, b) => axisSortOrder(a) - axisSortOrder(b));
          if (axisIds.length === 0) {
            body.innerHTML = `<div class="disabledNote">Keine Detaildaten verfügbar.</div>`;
          } else {
            const rows = axisIds.map(aid => `
              <tr class="row neutral" data-axisid="${aid}">
                <td>${axisLabelHtml(aid)}</td>
                <td class="mono" data-role="start"></td>
                <td class="mono" data-role="target"></td>
                <td>
                  <span class="noticeText" data-role="unblockNotice" style="display:none"></span>
                  <span class="status" data-role="statusText"></span>
                </td>
              </tr>
            `).join('');
            body.innerHTML = `
              <div class="tableWrap">
                <table>
                  <thead><tr>
                    <th>Achse</th>
                    <th class="mono">Sprung-Start</th>
                    <th class="mono">Sprung-Ziel</th>
                    <th>Status</th>
                  </tr></thead>
                  <tbody>${rows}</tbody>
                </table>
              </div>
            `;
          }
        }

        stepsEl.appendChild(el);
      });

      host.appendChild(sec);
      enablePointerReorder(stepsEl);
    });
  }

  async function loadReport() {
    const report = await tryFetchJson(`${FIREBASE_SESSION_PATH}/report`);
    if (!report) {
      document.getElementById('reportTitle').textContent = 'Noch keine Cue-Sequenz veröffentlicht.';
      document.getElementById('reportSubtitle').textContent = '';
      document.getElementById('reportMeta').textContent = '';
      document.getElementById('sectionsHost').innerHTML = '';
      showToast('Keine Daten');
      return;
    }

    phData = report.phData || null;
    phAxes = report.phAxes || null;

    await renderReport(report);

    const compactToggle = document.getElementById('compactToggle');
    if (compactToggle) compactToggle.checked = false;
    setAllCollapsed(false);

    recomputeAllSections();
    await pullOrdersFromFirebase();
    showToast('Aktualisiert');
  }

  function mountUi() {
    const app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = `
      <div class="toolbar">
        <div class="toolbarInner">
          <div class="toolbarLeft">
            <label class="toggle" title="Kompaktmodus (zum Sortieren)"><input id="compactToggle" type="checkbox"/><span class="toggleIcon">&#9776;</span></label>
          </div>
          <div class="toolbarRight">
            <button class="btn iconBtn" id="axesBtn" type="button" title="Achsen" aria-label="Achsen">&#x25A6;</button>
            <button class="btn iconBtn" id="syncRefreshBtn" type="button" title="Sortierung aktualisieren" aria-label="Sortierung aktualisieren">&#x21BB;</button>
            <button class="btn iconBtn" id="helpBtn" type="button" title="Hilfe" aria-label="Hilfe">?</button>
          </div>
        </div>
      </div>
      <div class="toast" id="toast" aria-live="polite"></div>

      <div class="overlay" id="axesOverlay" role="dialog" aria-modal="true" aria-label="Achsen">
        <div class="modal">
          <div class="modalHead">
            <div class="modalTitle">Achsen</div>
            <button class="btn iconBtn" id="axesCloseBtn" type="button" title="Schließen" aria-label="Schließen">&#x2715;</button>
          </div>
          <div class="modalSub" id="axesSub"></div>
          <div class="modalBody">
            <div class="axesGrid" id="axesGrid"></div>
          </div>
        </div>
      </div>

      <div class="overlay" id="helpOverlay" role="dialog" aria-modal="true" aria-label="Hilfe">
        <div class="modal" style="max-width:900px">
          <div class="modalHead">
            <div class="modalTitle">Hilfe</div>
            <button class="btn iconBtn" id="helpCloseBtn" type="button" title="Schließen" aria-label="Schließen">&#x2715;</button>
          </div>
          <div class="modalBody">
            <p>Diese Seite zeigt die zuletzt in Probenhilfe veröffentlichte Cue-Sequenz. Du kannst die Reihenfolge ändern – die Details werden dabei sofort neu berechnet.</p>
            <h3>Ein-/Ausklappen</h3>
            <ul>
              <li>Tippe auf einen Cue-Kopf, um genau diesen Cue ein- oder auszuklappen.</li>
              <li><span class="kbd">&#9776;</span> Kompaktmodus (gut zum Sortieren).</li>
            </ul>
            <h3>Sortieren</h3>
            <ul>
              <li>Zum Verschieben am <span class="kbd">=</span>-Griff ziehen.</li>
              <li>Im Kompaktmodus helfen die <span class="kbd">↑</span>/<span class="kbd">↓</span>-Buttons.</li>
              <li>Nach einer Änderung wird die Sortierung automatisch (kurz verzögert) in die Cloud gespeichert.</li>
              <li><span class="kbd">&#x21BB;</span> Sortierung aktualisieren: lädt die aktuell gespeicherte Sortierung aus der Cloud (überschreibt deine lokale).</li>
            </ul>
            <h3>Achsen</h3>
            <ul>
              <li><span class="kbd">&#x25A6;</span> Zeigt die Zielwerte der Achsen für den aktuellen Cue-Sprung (wie in der App).</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="wrap">
        <div class="header">
          <div>
            <div class="title" id="reportTitle"></div>
            <div class="subtitle" id="reportSubtitle"></div>
          </div>
          <div class="meta" id="reportMeta"></div>
        </div>
        <div class="legend">
          <div class="chip"><span class="dot bring"></span>Bringt auf Ziel</div>
          <div class="chip"><span class="dot ok"></span>Keine Bewegung</div>
          <div class="chip"><span class="dot warn"></span>Würde weg vom Ziel bewegen / Sperren</div>
          <div class="chip"><span class="dot neutral"></span>Sonstiges</div>
          <div class="chip"><span class="dot" style="background:var(--notice)"></span>Vor diesem Cue entsperren</div>
        </div>
        <div id="sectionsHost"></div>
      </div>
    `;
  }

  async function start() {
    mountUi();
    enableCollapse();
    enableReorderButtons();
    enableHelp();
    enableAxesOverlay();
    enableFirebaseSync();
    await loadReport();
  }

  window.addEventListener('DOMContentLoaded', () => {
    start();
  });
})();
