// ==UserScript==
// @name         مساعد EMIS – تعبئة تلقائية (v8.3.2)
// @namespace    emis-helper
// @version      8.3.2
// @description  تعبئة تلقائية لـ EMIS + حفظ + «تمت المراجعة» + فتح «جديد» + نقل «الاحتياجات الخاصة» من EMIS إلى موقعك
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  if (window.__emisHelperLoaded) return;
  window.__emisHelperLoaded = true;

  /* ===================== الإعدادات ===================== */
  const MY_SITE_HOSTS = ['studentgate-kbbtktoc.manus.space'];
  const EMIS_HOSTS = ['emis.moedu.gov.iq'];
  const DATE_FORMAT = 'YYYY-MM-DD';
  const IS_TOUCH = (() => { try { return matchMedia('(pointer:coarse)').matches; } catch { return false; } })();
  // السرعة: ارفع الأرقام لتصبح أبطأ (بالميلي ثانية)
  const DELAY = IS_TOUCH ? 70 : 50;      // الانتظار بين كل حقل والذي يليه (v7.7.1: أسرع)
  const TYPE_DELAY = 4;                   // الانتظار بين كل حرف وآخر أثناء الكتابة

  // false = القوائم تُختار بالضغط فقط ولا يُكتب فيها نص أبداً
  // (الحقول التي تحمل typeSearch: true مثل الجنسية تكتب دائماً ثم تضغط على النتيجة)
  const ALLOW_TYPE_IN_LISTS = false;

  const DEFAULTS = {
    idType: 'البطاقة الوطنية الموحدة',
    nationality: 'العراقية',
    gender: 'ذكر',
    studyLanguage: 'العربية',
    place: 'مركز قضاء خانقين',
    placeChain: ['العراق', 'ديالى', 'خانقين', 'مركز قضاء خانقين'],   // احتياط فقط
    city: 'خانقين',
    living: 'الطبقة الوسطى',
  };

  // كلمات لا تظهر إلا في الصفحة الثانية (لمعرفة أن الانتقال تم)
  const PAGE2_KEYS = ['لغة الدراسة', 'المستوى المعيشي', 'الصف الدراسي', 'أقرب نقطة دالة'];

  /* ===================== أدوات عامة ===================== */
  const K_DATA = 'emis_student_v2', K_CMD = 'emis_cmd_v2', K_STATUS = 'emis_status_v2', K_SPECIAL = 'emis_special_v1', K_STOP = 'emis_stop_v1';
  const isMySite = MY_SITE_HOSTS.some(h => location.hostname.includes(h));
  const isEmis = EMIS_HOSTS.some(h => location.hostname.includes(h));
  /* ---- (v7.5) الإيقاف: أي انتظار يتوقف فوراً عند طلب الإيقاف ---- */
  let stopRequested = false, stopReason = '';
  const CTX = Math.random().toString(36).slice(2);
  class StopError extends Error { constructor(m) { super(m || 'stopped'); this.isStop = true; } }
  const checkStop = () => { if (stopRequested) throw new StopError(); };
  const sleep = ms => stopRequested
    ? Promise.reject(new StopError())
    : new Promise((res, rej) => setTimeout(() => (stopRequested ? rej(new StopError()) : res()), ms));

  const norm = s => (s ?? '').toString()
    .replace(/[ً-ٰٟـ‎‏]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x660)
    .replace(/[*:：]/g, '').replace(/\s+/g, '').toLowerCase();

  const tokens = s => (s ?? '').toString()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .toLowerCase().split(/[\s/،,\-_]+/).filter(Boolean).map(t => t.replace(/^ال/, ''));

  const clean = s => (s ?? '').replace(/\s+/g, ' ').trim();
  const isEmpty = v => !v || /^[\s—–\-]*$/.test(v);
  const yes = v => ['نعم', 'yes', 'true', '1'].includes(norm(v));
  const vis = e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const inUI = e => !!e.closest('#emis-helper-ui');
  const ownText = e => [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ');
  const gmGet = (k, d) => { try { return GM_getValue(k, d); } catch { return d; } };
  const gmSet = (k, v) => { try { GM_setValue(k, v); } catch { /* ignore */ } };
  const PE = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  const isMatcher = c => c && typeof c === 'object' && typeof c.test === 'function';

  // نقرة كاملة تحاكي المستخدم (بدون view لأنه يسبب أخطاء في فايرفوكس)
  function press(el) {
    let x = 0, y = 0;
    try { const r = el.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; } catch { /* ignore */ }
    const o = { bubbles: true, cancelable: true, clientX: x, clientY: y };
    try { el.dispatchEvent(new PE('pointerdown', o)); } catch { /* ignore */ }
    try { el.dispatchEvent(new MouseEvent('mousedown', o)); } catch { /* ignore */ }
    try { el.dispatchEvent(new PE('pointerup', o)); } catch { /* ignore */ }
    try { el.dispatchEvent(new MouseEvent('mouseup', o)); } catch { /* ignore */ }
    try { el.click(); } catch { /* ignore */ }
  }
  const tap = press;

  function pressKey(el, k) {
    const codes = { Enter: 13, Escape: 27, ArrowDown: 40, ' ': 32 };
    for (const type of ['keydown', 'keypress', 'keyup']) {
      try {
        el.dispatchEvent(new KeyboardEvent(type, {
          key: k, code: k === ' ' ? 'Space' : k, keyCode: codes[k], which: codes[k], bubbles: true, cancelable: true,
        }));
      } catch { /* ignore */ }
    }
  }

  async function waitUntil(fn, timeout = 1500, step = 100) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { if (fn()) return true; } catch { /* ignore */ }
      await sleep(step);
    }
    try { return !!fn(); } catch { return false; }
  }

  function onChange(key, cb) {
    if (typeof GM_addValueChangeListener === 'function') {
      GM_addValueChangeListener(key, (_n, _o, nv, remote) => cb(nv, remote));
    } else {
      let last = gmGet(key, null);
      setInterval(() => { const v = gmGet(key, null); if (v !== last) { last = v; cb(v, true); } }, 500);
    }
  }

  function mk(tag, css, text) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text) e.textContent = text;
    return e;
  }

  /* ===================== أدوات إضافية (v7.2) ===================== */
  const studentKeyOf = d => norm(d.name) + norm(d.father) + norm(d.grandfather);
  const arOnly = s => norm(clean(s).replace(/[^ء-ي\s]/g, ' '));

  /* ---- (v7.5) الإيقاف + رصد «رقم البطاقة الوطنية مستخدم مسبقاً» ---- */
  function sendStop(payload) { gmSet(K_STOP, JSON.stringify({ ...payload, from: CTX, t: Date.now() })); }
  function triggerStop(reason) {
    stopReason = reason || 'user';
    stopRequested = true;
    sendStop({ reason: stopReason });
  }
  function requestStop(api) {
    triggerStop('user');
    if (api) api.addLog('⏹ جارٍ الإيقاف...');
  }
  // الإيقاف يصل لكل الإطارات (موقعك + EMIS)، والبدء من جديد يلغيه
  function listenStop() {
    onChange(K_STOP, nv => {
      if (!nv) return;
      let p; try { p = JSON.parse(nv); } catch { return; }
      if (!p || p.from === CTX) return;
      if (p.clear) stopRequested = false;
      else { stopRequested = true; if (!stopReason) stopReason = p.reason || 'user'; }
    });
  }

  const ID_USED_RE = /مستخدم(?:ه)?(?:مسبق|سابق)/;
  // رسالة الخطأ الحمراء تحت حقل رقم البطاقة: «رقم البطاقة الوطنية الموحدة مستخدم مسبقاً»
  function idUsedError() {
    for (const e of document.querySelectorAll('body *')) {
      if (e.children.length > 0) continue;
      const raw = e.textContent;
      if (!raw || raw.length > 90 || raw.indexOf('مستخدم') < 0) continue;
      if (inUI(e) || !vis(e)) continue;
      const t = norm(raw);
      if (ID_USED_RE.test(t) && /بطاقه/.test(t)) return true;
    }
    return false;
  }

  // رصد الخطأ لا يعمل إلا بعد تعبئة رقم البطاقة في هذا التشغيل (حتى لا يتأثر بخطأ قديم من الطالب السابق)
  let idWatchOn = false;
  const idUsedActive = () => idWatchOn && idUsedError();

  // مسح قيمة قديمة من حقل (عندما تكون قيمة الطالب الجديد فارغة)
  async function clearControl(ctrl) {
    const tag = ctrl.tagName;
    if (tag === 'INPUT' && ['checkbox', 'radio', 'button', 'submit'].includes(ctrl.type)) return;
    if (tag === 'SELECT') {
      try { ctrl.selectedIndex = -1; ['input', 'change'].forEach(t => ctrl.dispatchEvent(new Event(t, { bubbles: true }))); } catch { /* ignore */ }
      return;
    }
    const anchor = ctrl.closest(WRAP_SEL) || ctrl;
    const clr = anchor.querySelector('[class*=clear],[class*=remove],[aria-label*=clear i],[title*=clear i]');
    if (clr && vis(clr)) { press(clr); await sleep(100); }
    if ((tag === 'INPUT' || tag === 'TEXTAREA') && ctrl.value && !ctrl.readOnly) await hardSetText(ctrl, '');
  }

  // كل العناصر بما فيها داخل shadow DOM المفتوح
  function allDeep(root = document, out = []) {
    for (const el of root.querySelectorAll('*')) {
      out.push(el);
      if (el.shadowRoot) allDeep(el.shadowRoot, out);
    }
    return out;
  }
  const hostOf = n => n.parentElement || (n.getRootNode && n.getRootNode().host) || null;
  const shown = e => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
  };

  /* ---- زر «جديد +» في قائمة EMIS (بجانب الرجوع / تحديث / تعديل) ---- */
  const CLICK_SEL = 'button,a,[role=button],ion-button,p-button,[class*=btn],[class*=button],[tabindex]';
  const STRONG_CLICK_SEL = 'button,a,[role=button],ion-button,p-button';

  function findNewButton() {
    const want = norm('جديد');
    const hits = [];
    for (const e of allDeep()) {
      if (inUI(e) || e.tagName === 'SCRIPT' || e.tagName === 'STYLE') continue;
      const cands = [e.textContent];
      if (e.tagName === 'INPUT' && /button|submit/.test(e.type || '')) cands.push(e.value);
      if (e.getAttribute) { cands.push(e.getAttribute('aria-label')); cands.push(e.getAttribute('title')); }
      if (!cands.some(t => t && String(t).length < 40 && arOnly(String(t)) === want)) continue;
      if (!shown(e)) continue;
      hits.push(e);
    }
    const deepest = hits.filter(h => !hits.some(x => x !== h && h.contains(x)));
    let best = null, bestScore = -1;
    for (const h of deepest) {
      let c = h;
      for (let i = 0; i < 6 && c; i++) {
        if (c.matches && c.matches(CLICK_SEL)) break;
        c = hostOf(c);
      }
      if (!c || !c.matches || !c.matches(CLICK_SEL)) c = h;
      const r = c.getBoundingClientRect();
      if (r.width < 20 || r.height < 16 || r.width > 400) continue;
      let score = 0;
      if (c.matches && c.matches(STRONG_CLICK_SEL)) score += 5;
      if (c !== h) score += 1;
      let up = c;
      for (let i = 0; i < 3 && hostOf(up); i++) up = hostOf(up);
      const around = norm(up.textContent || '');
      if (/الرجوع|تحديث|تعديل|تعطيل|تصدير/.test(around)) score += 6;   // نفس شريط الأزرار
      if (r.top < 900) score += 1;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  // وصف الأزرار الظاهرة (للتشخيص إن لم نجد «جديد»)
  function describeButtons() {
    const set = new Set();
    for (const e of allDeep()) {
      if (inUI(e) || !e.matches || !e.matches(CLICK_SEL) || !shown(e)) continue;
      const t = clean(e.textContent || '').replace(/[^ء-ي\s]/g, ' ').replace(/\s+/g, ' ').trim();
      if (t && t.length <= 20) set.add(t);
      if (set.size >= 14) break;
    }
    return [...set].join(' | ') || 'لا شيء';
  }

  /* ---- «الإحتياجات الخاصة، إن وجدت» في EMIS: قراءة الخيار المختار ---- */
  const EMIS_SPECIAL_OPTIONS = ['العوق الفيزياوي', 'العوق البصري', 'العوق السمعي', 'العوق الذهني', 'العوق النفسي', 'التوحد', 'بطيء التعلّم'];
  const SPECIAL_LABEL = norm('الإحتياجات الخاصة');

  // نقرأ النص الظاهر في صف الحقل (بجانب العنوان) دون لمس أي خيار
  function readEmisSpecial() {
    const labelEl = [...document.querySelectorAll('body *')].find(e => {
      if (inUI(e) || !vis(e)) return false;
      const n = norm(ownText(e));
      return n.startsWith(SPECIAL_LABEL) && n.length < 40;
    });
    if (!labelEl) return { found: false, values: [], raw: '' };
    const lr = labelEl.getBoundingClientRect();
    const top = lr.top - 25, bottom = lr.bottom + 25;
    const EXCL = '[role=listbox],[role=option],mat-option,.p-multiselect-panel,.p-multiselect-items-wrapper,.p-select-overlay,.p-dropdown-panel,.p-overlay,.cdk-overlay-container,.ng-dropdown-panel,.select2-dropdown,ul,li';
    const raws = [], values = [];
    for (const e of document.querySelectorAll('body *')) {
      if (inUI(e) || e === labelEl || labelEl.contains(e) || !vis(e)) continue;
      if (e.closest(EXCL)) continue;
      if (e.children.length > 3) continue;
      const t = clean(e.innerText || e.textContent || '');
      if (!t || t.length > 80) continue;
      const r = e.getBoundingClientRect();
      if (r.height < 8) continue;
      const cy = r.top + r.height / 2;
      if (cy < top || cy > bottom) continue;
      raws.push(t);
      const n = norm(t);
      for (const opt of EMIS_SPECIAL_OPTIONS) if (n.includes(norm(opt)) && !values.includes(opt)) values.push(opt);
    }
    return { found: true, values, raw: [...new Set(raws)].join(' | ') };
  }

  // إن كان هناك خيار مختار في EMIS نرسله لموقعك، وإن لم يكن فلا نفعل شيئاً
  async function publishSpecial(data, log) {
    try {
      await closeLists();
      await sleep(300);
      let r = readEmisSpecial();
      if (!r.found) { await sleep(800); r = readEmisSpecial(); }
      if (!r.found) { log('ℹ️ لم أجد حقل «الاحتياجات الخاصة» في EMIS'); return; }
      if (!r.values.length) {
        log('ℹ️ الاحتياجات الخاصة في EMIS: لا يوجد اختيار، لن أغيّر شيئاً في موقعك' + (r.raw ? ` (رأيت: ${r.raw})` : ''));
        return;
      }
      log('📋 الاحتياجات الخاصة في EMIS: ' + r.values.join('، '));
      gmSet(K_SPECIAL, JSON.stringify({ values: r.values, k: studentKeyOf(data), t: Date.now() }));
    } catch (e) { if (e && e.isStop) throw e; console.warn('[EMIS special]', e); }
  }

  /* ===================== الشريط ===================== */
  function createBar(title, onStart, onPage2, onNext, extra, onStop) {
    document.querySelectorAll('#emis-helper-ui').forEach(e => e.remove());

    const ui = mk('div',
      'position:fixed;top:8px;left:8px;z-index:2147483647;' +
      'background:#0f3b57;color:#fff;border-radius:12px;padding:8px;' +
      'box-sizing:border-box;width:auto;max-width:310px;' +
      'font:13px/1.5 Tahoma,Arial,sans-serif;direction:rtl;' +
      'box-shadow:0 3px 12px rgba(0,0,0,.4);touch-action:manipulation;');
    ui.id = 'emis-helper-ui';
    ui.dir = 'rtl';

    const head = mk('div', 'display:flex;justify-content:space-between;align-items:center;gap:8px');
    head.appendChild(mk('b', 'font-size:13.5px;', title + ' v8.3.2'));
    const minBtn = mk('button',
      'background:none;border:0;color:#fff;font-size:22px;' +
      'min-width:32px;min-height:32px;cursor:pointer;padding:0;line-height:1;', '−');
    head.appendChild(minBtn);

    const body = mk('div');
    const name = mk('div', 'opacity:.9;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:290px;', '—');
    const row = mk('div', 'display:flex;gap:6px;margin-top:6px');
    const log = mk('div', 'white-space:pre-wrap;margin-top:6px;font-size:12px;max-height:240px;overflow:auto;');
    const lines = [];

    const api = {
      setName: d => { name.textContent = [d.name, d.father].filter(Boolean).join(' ') || '—'; },
      setLog: t => { lines.length = 0; if (t) lines.push(t); log.textContent = t || ''; },
      addLog: t => {
        lines.push(t);
        if (lines.length > 60) lines.shift();
        log.textContent = lines.join('\n');
        log.scrollTop = log.scrollHeight;
      },
      getLog: () => log.textContent,
    };

    const btnCss = 'flex:1;min-height:38px;padding:5px 8px;border-radius:8px;border:0;font:inherit;font-size:13px;cursor:pointer;';
    const btnStart = mk('button', btnCss + 'flex:2;background:#e8a93a;font-weight:700;color:#0f3b57;', '▶ ابدأ');
    btnStart.addEventListener('click', () => { stopRequested = false; onStart(api); });
    row.appendChild(btnStart);

    const btn2 = mk('button', btnCss + 'background:#3d7ea6;color:#fff;', 'ص2');
    btn2.addEventListener('click', () => { stopRequested = false; onPage2(api); });
    row.appendChild(btn2);

    if (onNext) {
      const btn3 = mk('button', btnCss + 'flex:1.4;background:#2e8b57;color:#fff;', 'التالي ⏭');
      btn3.addEventListener('click', () => { stopRequested = false; onNext(api); });
      row.appendChild(btn3);
    }

    minBtn.onclick = () => {
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? '' : 'none';
      minBtn.textContent = hidden ? '−' : '+';
    };

    const parts = [name, row];

    // (v7.5) زر الإيقاف
    if (onStop) {
      const rowStop = mk('div', 'display:flex;margin-top:6px');
      const btnStop = mk('button', btnCss + 'background:#c0392b;color:#fff;font-weight:700;', '⏹ إيقاف');
      btnStop.addEventListener('click', () => onStop(api));
      rowStop.appendChild(btnStop);
      parts.push(rowStop);
    }

    if (extra) {
      const row2 = mk('div', 'display:flex;gap:6px;margin-top:6px;align-items:center');
      const btnR = mk('button', btnCss + 'flex:2;background:#8a5cc2;color:#fff;', '✔ تمت المراجعة ⏭');
      btnR.addEventListener('click', () => { stopRequested = false; extra.onReview(api); });
      row2.appendChild(btnR);
      const lab = mk('label', 'flex:1.6;display:flex;align-items:center;gap:4px;font-size:11.5px;cursor:pointer;');
      const cb = mk('input', 'width:16px;height:16px;');
      cb.type = 'checkbox';
      cb.checked = !!extra.autoGet();
      cb.addEventListener('change', () => extra.autoSet(cb.checked));
      lab.append(cb, document.createTextNode('تلقائي بعد الحفظ'));
      row2.appendChild(lab);
      parts.push(row2);

      // (جديد) فتح «جديد +» في EMIS وتعبئة الطالب التالي تلقائياً
      const row3 = mk('div', 'display:flex;margin-top:6px');
      const lab2 = mk('label', 'display:flex;align-items:center;gap:4px;font-size:11.5px;cursor:pointer;');
      const cb2 = mk('input', 'width:16px;height:16px;');
      cb2.type = 'checkbox';
      cb2.checked = !!extra.chainGet();
      cb2.addEventListener('change', () => extra.chainSet(cb2.checked));
      lab2.append(cb2, document.createTextNode('فتح «جديد» للطالب التالي (بدون تعبئة)'));
      row3.appendChild(lab2);
      parts.push(row3);
    }
    parts.push(log);
    body.append(...parts);
    ui.append(head, body);
    (document.body || document.documentElement).appendChild(ui);

    // سحب الشريط إلى المكان المناسب (من منطقة العنوان) مع حفظ مكانه
    const POS_KEY = 'emis_bar_pos_' + location.hostname;
    try {
      const sp = JSON.parse(gmGet(POS_KEY, 'null'));
      if (sp && typeof sp.x === 'number') {
        ui.style.left = Math.max(0, Math.min(sp.x, window.innerWidth - 60)) + 'px';
        ui.style.top = Math.max(0, Math.min(sp.y, window.innerHeight - 40)) + 'px';
      }
    } catch { /* ignore */ }
    head.style.cursor = 'move';
    head.style.touchAction = 'none';
    head.style.userSelect = 'none';
    let drag = null;
    head.addEventListener('pointerdown', ev => {
      if (ev.target === minBtn) return;
      const r = ui.getBoundingClientRect();
      drag = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
      try { head.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
      ev.preventDefault();
    });
    head.addEventListener('pointermove', ev => {
      if (!drag) return;
      const x = Math.min(Math.max(0, ev.clientX - drag.dx), Math.max(0, window.innerWidth - ui.offsetWidth));
      const y = Math.min(Math.max(0, ev.clientY - drag.dy), Math.max(0, window.innerHeight - 40));
      ui.style.left = x + 'px';
      ui.style.top = y + 'px';
    });
    const endDrag = () => {
      if (!drag) return;
      drag = null;
      const r = ui.getBoundingClientRect();
      gmSet(POS_KEY, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) }));
    };
    head.addEventListener('pointerup', endDrag);
    head.addEventListener('pointercancel', endDrag);
    return api;
  }

  /* ===================== قراءة بيانات الطالب من موقعك ===================== */
  const SITE_LABELS = {
    name: ['اسم الطالب الأول', 'اسم الطالب', 'الاسم'],
    father: ['اسم الأب'], grandfather: ['اسم والد الأب'], greatGrandfather: ['اسم جد الأب'],
    surname: ['اللقب'], mother: ['اسم الأم'], motherFather: ['اسم والد الأم'],
    motherGrandfather: ['اسم جد الأم'], dob: ['تاريخ التولد'],
    nationalId: ['رقم البطاقة الموحدة'],
    idType: ['نوع الهوية', 'نوع الوثيقة', 'نوع وثيقة التعريف'], natSite: ['الجنسية', 'نوع الجنسية'],
    civilRecord: ['رقم السجل'], civilSheet: ['رقم الصحيفة'],
    civilId: ['رقم الهوية', 'رقم هوية الأحوال المدنية', 'رقم الهوية المدنية'],
    gender: ['الجنس'], motherTongue: ['اللغة الأم'],
    blood: ['فئة الدم'], religion: ['الديانة'], phone: ['رقم الهاتف'],
    special: ['نوع الاحتياج الخاص'], living: ['المستوى المعيشي'],
    welfare: ['الرعاية الاجتماعية', 'منحة الرعاية الاجتماعية', 'مشمول بمنحة الرعاية الاجتماعية'],
    grade: ['الصف الدراسي', 'الصف'], section: ['الشعبة'],
    neighborhood: ['الحي / المنطقة', 'الحي', 'المنطقة'],
    mahalla: ['المحلة', 'رقم المحلة'],
    alley: ['الزقاق', 'رقم الزقاق', 'زقاق'],
    landmark: ['أقرب نقطة دالة'],
  };
  const ALL_LABELS = new Set(Object.values(SITE_LABELS).flat().map(norm));
  const NOISE = /^(نسخ|يحدد في EMIS|يُحدد في EMIS|تحدد في EMIS)/;

  function valueAfter(label) {
    const t = clean(label.textContent);
    const i = t.search(/[:：]/);
    if (i > -1 && clean(t.slice(i + 1))) return clean(t.slice(i + 1));
    if (label.tagName === 'LABEL' && label.control) return clean(label.control.value);
    const scan = el => {
      for (let s = el.nextElementSibling; s; s = s.nextElementSibling) {
        if (inUI(s)) continue;
        const v = clean(s.value ?? s.textContent);
        if (!v || NOISE.test(v) || ALL_LABELS.has(norm(v))) continue;
        return v;
      }
      return '';
    };
    let v = scan(label);
    if (!v && label.parentElement && label.parentElement.children.length === 1) v = scan(label.parentElement);
    return v;
  }

  function extractStudent() {
    const data = {};
    const els = [...document.querySelectorAll('body *')].filter(e => !inUI(e));
    for (const [key, aliases] of Object.entries(SITE_LABELS)) {
      const targets = aliases.map(norm);
      for (const e of els) {
        const own = norm(ownText(e).split(/[:：]/)[0]);
        if (!own || !targets.includes(own)) continue;
        const v = valueAfter(e);
        if (v && v.length < 120) { data[key] = v; break; }
      }
    }
    // الشعبة: القيمة التي تقع تحت «الصف الدراسي» (وليس مربع الصف/الشعبة العلوي)
    const gi = els.findIndex(e => norm(ownText(e)) === norm('الصف الدراسي'));
    if (gi > -1) {
      // الصف: نفضّل قيمة حقل «الصف الدراسي» نفسه في معلومات الطالب
      const gv = valueAfter(els[gi]);
      if (gv && gv.length < 40) data.grade = gv;
      for (let j = gi + 1; j < els.length; j++) {
        if (norm(ownText(els[j])) !== norm('الشعبة')) continue;
        const sv = valueAfter(els[j]);
        if (sv && sv.length < 20) data.section = sv;
        break;
      }
    }
    // احتياط: الصف من السطر العلوي بجانب EMIS («الصف — الثالث متوسط»)
    if (!data.grade) {
      const hm = (document.body ? document.body.innerText : '').match(/الصف\s*[—–\-:]\s*([^\n—–|·]{3,30})/);
      if (hm) data.grade = clean(hm[1]);
    }
    // اسم المدرسة (نفضّل ما يحتوي «للبنين/للبنات»)
    const sms = [...(document.body ? document.body.innerText : '')
      .matchAll(/(?:متوسطة|[اإ]عدادية|ثانوية|ابتدائية)[ \t]+[^\n—|·]{2,60}/g)].map(m => clean(m[0]));
    const sch = sms.find(t => /للبنين|للبنات/.test(t)) || sms[0];
    if (sch) data.school = sch;
    // احتياط: قراءة «رقم الصحيفة» من نص الصفحة إن لم تُقرأ بالطريقة العادية
    if (isEmpty(data.civilSheet)) {
      const mm = (document.body ? document.body.innerText : '').match(/رقم\s*الصحيف[ةه]\s*[:：]?\s*\n?\s*([^\n:：]{1,25})/);
      if (mm) { const v = clean(mm[1]); if (!isEmpty(v) && !ALL_LABELS.has(norm(v))) data.civilSheet = v; }
    }
    return data;
  }

  /* ===================== إيجاد الحقول في EMIS ===================== */
  const CTRL_SEL = 'input:not([type=hidden]):not([type=button]):not([type=submit]),select,textarea,' +
    'mat-select,ng-select,[role=combobox],.select2-selection,.p-dropdown,.p-select';
  const WRAP_SEL = '.p-dropdown,.p-select,.ng-select,mat-select,.select2,[class*=dropdown],[class*=select]';
  const DROPDOWN_SEL = '.p-dropdown,.p-select,.ng-select,.select2,[class*=multiselect],[class*=dropdown],[class*=v-select],[class*=vs__]';
  const OPT_SEL = '[role=option],mat-option,.ng-option,.select2-results__option,.p-dropdown-item,' +
    '.p-select-option,.ant-select-item-option,li.dropdown-item,ul[role=listbox] li,.dropdown-menu li';
  const OPT2 = OPT_SEL + ',[class*=option],[class*=item],li';

  function findControl(aliases) {
    const T = aliases.map(norm);
    const PH = new Set([...T, ...T.map(t => 'ادخل' + t), ...T.map(t => 'اختر' + t)]);
    for (const c of document.querySelectorAll('input,select,textarea,[role=combobox],mat-select,ng-select')) {
      if (inUI(c) || !vis(c)) continue;
      const a = norm(c.placeholder || c.getAttribute('aria-label') || '');
      if (a && PH.has(a)) return c;
    }
    const labels = [...document.querySelectorAll('body *')]
      .filter(e => !inUI(e) && vis(e) && T.includes(norm(ownText(e))));
    for (const l of labels) {
      if (l.control) return l.control;
      let node = l;
      for (let i = 0; i < 5 && node.parentElement; i++) {
        node = node.parentElement;
        const found = [...node.querySelectorAll(CTRL_SEL)].filter(c => !l.contains(c) && vis(c) && !inUI(c));
        const after = found.filter(c => l.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING);
        if (found.length) return (after.length ? after : found)[0];
      }
    }
    return null;
  }

  function findControlLoose(aliases) {
    const T = aliases.map(norm);
    for (const c of document.querySelectorAll('input,select,textarea,[role=combobox],mat-select,ng-select')) {
      if (inUI(c) || !vis(c)) continue;
      const a = norm(c.placeholder || c.getAttribute('aria-label') || '');
      if (!a) continue;
      if (T.some(t => a === t || a.includes(t) || t.includes(a))) return c;
    }
    const labels = [...document.querySelectorAll('label,div,span,p,h3,h4')]
      .filter(e => !inUI(e) && vis(e) && e.children.length < 3)
      .filter(e => T.some(t => {
        const n = norm(e.textContent);
        return n === t || n.startsWith(t);
      }));
    for (const l of labels) {
      if (l.control) return l.control;
      const container = l.closest('div') || l.parentElement;
      if (!container) continue;
      const found = [...container.querySelectorAll('input,select,textarea,[role=combobox],mat-select,ng-select,[tabindex="0"]')]
        .filter(c => vis(c) && !inUI(c) && c.tagName !== 'A' && c.tagName !== 'BUTTON');
      if (found.length) return found[0];
    }
    return null;
  }

  async function waitControl(labels, tries) {
    for (let i = 0; i < tries; i++) {
      const c = findControl(labels);
      if (c) return c;
      await sleep(250);
    }
    return null;
  }

  async function findControlBest(labels) {
    let c = await waitControl(labels, 4);
    if (!c) c = findControlLoose(labels);
    if (!c) c = await waitControl(labels, 4);
    return c;
  }

  // المرشّح قد يكون نصاً أو كائن مطابقة {test(text)} (يُستخدم لفئة الدم والشعبة)
  function pickOption(opts, candidates) {
    const list = [].concat(candidates);

    for (const cand of list) {
      if (!isMatcher(cand)) continue;
      if (typeof cand.pick === 'function') {
        let byPos = null;
        try { byPos = cand.pick(opts); } catch { /* ignore */ }
        if (byPos) return byPos;
      }
      const hit = opts.find(o => { try { return cand.test(o.text); } catch { return false; } });
      if (hit) return hit;
    }

    let best = null, bestScore = 0;
    for (const cand of list) {
      if (isMatcher(cand)) continue;
      const n = norm(cand), tk = tokens(cand);
      if (!n) continue;
      for (const o of opts) {
        const t = norm(o.text);
        if (!t) continue;
        let sc = 0;
        if (t === n) sc = 100;
        else if (n.length <= 3) sc = 0;                       // الكلمات القصيرة: تطابق تام فقط
        else if (t.includes(n) || (t.length > 3 && n.includes(t))) sc = 60;
        else {
          const ot = tokens(o.text);
          sc = (tk.filter(x => ot.includes(x)).length / Math.max(tk.length, ot.length)) * 50;
        }
        if (sc > bestScore) { bestScore = sc; best = o; }
      }
    }
    return bestScore >= 25 ? best : null;
  }

  function setNative(el, val) {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype
      : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    if (!IS_TOUCH) el.focus?.();
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, val); else el.value = val;
    ['input', 'change', 'blur'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
    if (IS_TOUCH) el.blur?.();
  }

  async function typeInto(el, text, keepFocus) {
    el.focus?.();
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (!setter) { setNative(el, text); return; }
    setter.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    let cur = '';
    for (const ch of text) {
      cur += ch;
      setter.call(el, cur);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
      await sleep(TYPE_DELAY);
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (!keepFocus) el.blur?.();
  }

  // كتابة قوية: مسح كامل ثم كتابة حرف حرف ثم التحقق أن القيمة صارت صحيحة (تعيد المحاولة)
  async function hardSetText(ctrl, text) {
    const want = (text || '').toString().replace(/\s/g, '');
    const same = () => (ctrl.value || '').replace(/\s/g, '') === want;
    const proto = ctrl.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    for (let i = 0; i < 3; i++) {
      try { ctrl.focus?.(); ctrl.select?.(); } catch { /* ignore */ }
      if (setter) setter.call(ctrl, ''); else ctrl.value = '';
      ctrl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
      ctrl.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(80);
      if (want) await typeInto(ctrl, text.toString(), false);
      else ctrl.blur?.();
      await sleep(100);
      if (same()) return true;
      if (i === 1 && want) { setNative(ctrl, text.toString()); await sleep(150); if (same()) return true; }
    }
    return same();
  }

  const isTextInput = c => c.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(c.type);
  const looksDropdown = c => c.getAttribute('role') === 'combobox' || !!c.getAttribute('aria-haspopup')
    || c.readOnly || !!c.closest(DROPDOWN_SEL) || c.tagName === 'MAT-SELECT' || c.tagName === 'NG-SELECT';

  /* ===================== القوائم المنسدلة ===================== */
  let lastChosen = '';
  let lastOptsTxt = '';

  // الخيارات الظاهرة بالقرب من الحقل فقط
  function gatherOptions(anchor) {
    const a = anchor.getBoundingClientRect();
    const rows = [];
    for (const el of document.querySelectorAll(OPT2)) {
      if (inUI(el) || !vis(el) || el.children.length >= 4) continue;
      // (v7.7.1) ليست خيارات: حقول الاستمارة المجاورة وعناوينها
      if (el.closest('.q-field,label,mat-form-field') || el.querySelector('input,select,textarea')) continue;
      const text = clean(el.textContent);
      if (!text || text.length > 60) continue;
      const o = el.getBoundingClientRect();
      if (o.height < 8) continue;
      const overlapX = o.right > a.left - 20 && o.left < a.right + 20;
      const below = o.top >= a.bottom - 6 && o.top - a.bottom < 500;
      const above = o.bottom <= a.top + 6 && a.top - o.bottom < 500;
      if (!overlapX || !(below || above)) continue;
      rows.push({ el, text, d: Math.min(Math.abs(o.top - a.bottom), Math.abs(a.top - o.bottom)) });
    }
    // (v7.7.1) على الهاتف قد تُفتح القائمة بعيداً عن الحقل (نافذة أعلى الصفحة أو وسطها).
    // إن كانت هناك قائمة منسدلة مفتوحة نأخذ خياراتها هي أولاً، لا نصوص الحقول المجاورة
    const near = rows.splice(0);
    {
      for (const box of openOverlays()) {
        for (const el of box.querySelectorAll(OPT2)) {
          if (inUI(el) || !vis(el) || el.children.length >= 4) continue;
          const text = clean(el.textContent);
          if (!text || text.length > 60) continue;
          const o = el.getBoundingClientRect();
          if (o.height < 8) continue;
          rows.push({ el, text, d: Math.min(Math.abs(o.top - a.bottom), Math.abs(a.top - o.bottom)) });
        }
      }
    }
    if (!rows.length) rows.push(...near);
    return rows
      .filter(r => !rows.some(x => x !== r && r.el.contains(x.el) && x.text === r.text))
      .sort((x, y) => x.d - y.d);
  }

  // (v7.7.1) القوائم المنسدلة المفتوحة حالياً (PrimeVue / PrimeNG / Material / Vuetify / Element ...)
  const OVERLAY_SEL = '[role=listbox],.q-menu,.q-dialog__inner,.q-select__dialog,.q-virtual-scroll__content,.p-select-overlay,.p-dropdown-panel,.p-multiselect-overlay,.p-multiselect-panel,' +
    '.p-autocomplete-overlay,.p-autocomplete-panel,.p-overlay,.p-connected-overlay,.cdk-overlay-pane,.mat-mdc-select-panel,' +
    '.ng-dropdown-panel,.select2-dropdown,.v-overlay__content,.v-menu,.el-select-dropdown,.el-popper,' +
    '.ant-select-dropdown,.MuiPopover-paper,.MuiMenu-paper,.MuiAutocomplete-popper,[class*=popper],[class*=dropdown-menu],' +
    '[class*=select-overlay],[class*=select-panel],[class*=select-dropdown],[class*=options-list]';
  function openOverlays() {
    const out = [];
    for (const el of document.querySelectorAll(OVERLAY_SEL)) {
      if (inUI(el) || !vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 12 || r.width < 30) continue;
      // قائمة منبثقة فقط (فوق الصفحة)، لا قوائم ثابتة في الصفحة نفسها
      let floating = false;
      for (let n = el, i = 0; n && i < 8; n = n.parentElement, i++) {
        const pos = getComputedStyle(n).position;
        if (pos === 'fixed' || pos === 'absolute') { floating = true; break; }
      }
      if (!floating) continue;
      if (out.some(x => x.contains(el))) continue;
      for (let i = out.length - 1; i >= 0; i--) if (el.contains(out[i])) out.splice(i, 1);
      out.push(el);
    }
    return out;
  }

  // ننتظر ظهور القائمة الحقيقية ثم نختار الخيار المطلوب
  async function readAndPick(anchor, cands, tries, step = 110) {
    let opts = [], best = null;
    for (let i = 0; i < tries; i++) {
      await sleep(step);
      opts = gatherOptions(anchor);
      if (opts.length) lastOptsTxt = opts.slice(0, 8).map(o => o.text).join(' | ');
      best = opts.length ? pickOption(opts, cands) : null;
      if (best) break;
    }
    return { opts, best };
  }

  async function closeLists() {
    const ae = document.activeElement;
    pressKey(ae || document.body, 'Escape');
    if (ae && ae !== document.body) ae.blur?.();
    await sleep(120);
  }

  // النص الظاهر حالياً في الحقل بعد الاختيار
  function shownValue(ctrl, anchor) {
    const parts = [];
    if (ctrl.value) parts.push(ctrl.value);
    if (anchor && anchor !== ctrl) parts.push(anchor.innerText || '');
    return norm(parts.join(' '));
  }

  /* الضغط على الخيار والتأكد أنه حُفظ فعلاً.
     لا نستخدم زر Enter عشوائياً لأنه يختار أول خيار في القائمة. */
  async function commitOption(best, ctrl, anchor, onlyOne) {
    const want = norm(best.text);
    const isOpen = () => best.el.isConnected && vis(best.el);
    const isSet = () => {
      if (want.length <= 3 || best.loose) {   // نص قصير أو اختيار بالترتيب (شعبة، فئة دم): يكفي أن تُغلق القائمة أو يظهر النص في الحقل
        if (norm(ctrl.value) === want) return true;
        if ([...anchor.querySelectorAll('*')].some(e =>
          e !== best.el && !best.el.contains(e) && e.children.length === 0 && vis(e) && norm(e.textContent) === want)) return true;
        return !isOpen();
      }
      const s = shownValue(ctrl, anchor); return !s || s.includes(want);
    };
    const settled = () => !isOpen() && isSet();
    const finish = async () => { const ok = await waitUntil(settled, 1600, 60); if (ok) lastChosen = best.text; return ok; };

    try { best.el.scrollIntoView?.({ block: 'nearest' }); } catch { /* ignore */ }
    await sleep(40);

    press(best.el);
    if (await finish()) return true;

    const up = best.el.closest('li,[role=option],mat-option,[class*=option],[class*=item]');
    if (up && up !== best.el && isOpen()) {
      press(up);
      if (await finish()) return true;
    }

    // Enter فقط إذا كان هناك خيار وحيد في القائمة (آمن)
    if (onlyOne && isOpen()) {
      try { ctrl.focus?.(); } catch { /* ignore */ }
      pressKey(ctrl, 'Enter');
      if (await finish()) return true;
    }
    return false;
  }

  // (v7.7.1) ما نكتبه في قائمة البحث: النص كاملاً، ثم أطول كلمة فيه (لو اختلفت الكتابة قليلاً في EMIS)
  // (v7.7.2) هل يعرض الحقل القيمة المطلوبة مسبقاً؟ (القيمة المختارة داخل الحقل وليس عنوانه)
  function alreadyChosen(ctrl, value) {
    try {
      let anchor = ctrl.closest(WRAP_SEL) || ctrl;
      if (anchor.getBoundingClientRect().height > 120) anchor = ctrl;
      const box = anchor.querySelector('.q-field__native,.p-select-label,.p-dropdown-label') || anchor;
      const shown = norm([ctrl.value || '', box !== ctrl ? (box.innerText || '') : ''].join(' '));
      if (!shown) return '';
      for (const c of [].concat(value)) {
        if (typeof c === 'string') {
          const n = norm(c);
          if (n.length >= 3 && shown.includes(n)) return c;
        } else if (isMatcher(c)) {
          const t = (box.innerText || ctrl.value || '').split(/\n/).map(clean).filter(Boolean);
          const hit = t.find(x => { if (x.length >= 30) return false; try { return c.test(x); } catch { return false; } });
          if (hit) return hit;
        }
      }
    } catch { /* ignore */ }
    return '';
  }

  function typeWords(c, coreFirst) {
    const src = typeof c === 'string' ? c : (c && (c.typeHint || c.label)) || '';
    const s = clean(String(src));
    if (!s) return [];
    // (v7.7.1) الكلمة المميزة أولاً (تتحمل اختلاف الكتابة)، ثم النص كاملاً، ثم بدون همزة/«ال»
    const words = s.split(/[\s/،,\-]+/).filter(w => w.length >= 3).sort((a, b) => b.length - a.length);
    const out = [];
    // (v7.7.2، للجنس فقط) أولاً جزء الكلمة الذي لا يتأثر بالهمزة (أنثى ← نثى)
    //          فيطابق «أنثى» و«انثى» معاً من أول مرة
    if (coreFirst && words[0]) {
      const core = words[0].replace(/^ال/, '').replace(/^[أإآا]/, '').split(/[أإآ]/).sort((a, b) => b.length - a.length)[0] || '';
      if (core.length >= 3 && core !== words[0]) out.push(core);
    }
    if (words[0] && !out.includes(words[0])) out.push(words[0]);
    if (!out.includes(s)) out.push(s);
    const plain = (words[0] || s).replace(/[أإآ]/g, 'ا').replace(/^ال/, '');
    if (plain.length >= 3 && !out.includes(plain)) out.push(plain);
    return out;
  }

  async function chooseCustom(ctrl, candidates, flags = {}) {
    const cands = [].concat(candidates).filter(c => isMatcher(c) || !isEmpty(c));
    if (!cands.length) return false;
    let anchor = ctrl.closest(WRAP_SEL) || ctrl;
    if (anchor.getBoundingClientRect().height > 120) anchor = ctrl;
    // (v7.6) الحقول التي تحمل typeSearch (مثل الجنسية) تكتب النص ثم تضغط على النتيجة
    // (v7.7.1) قوائم البحث (مثل قوائم EMIS: حقل كتابة role=combobox) لا تفتح بالضغط: نكتب ثم نضغط دائماً
    const searchy = isTextInput(ctrl) && !ctrl.readOnly &&
      (ctrl.getAttribute('aria-autocomplete') === 'list' || ctrl.type === 'search' || /q-field__input|q-select/.test(String(ctrl.className)));
    const canType = (ALLOW_TYPE_IN_LISTS || flags.typeSearch || searchy) && isTextInput(ctrl) && !ctrl.readOnly;
    try { ctrl.scrollIntoView?.({ block: 'center' }); } catch { /* ignore */ }
    await sleep(searchy ? 60 : 200);
    await closeLists();

    // (v7.6) كتابة النص أولاً، انتظار ظهوره في القائمة، ثم الضغط عليه (الجنسية: «العراق»)
    if (canType && (flags.typeSearch || searchy)) {
      let first = true;
      for (const c of cands) {
        for (const w of typeWords(c, flags.coreFirst)) {
          try { ctrl.focus?.(); } catch { /* ignore */ }
          press(ctrl);
          await sleep(searchy ? 80 : 250);
          await typeInto(ctrl, w, true);
          // (v7.7.1) أول مرة قد تجلب EMIS الخيارات من الخادم: ننتظر حتى 4 ثوانٍ (ونكمل فور ظهورها)
          const { opts, best } = await readAndPick(anchor, [c], first ? 50 : 25, 80);
          first = false;
          if (best && await commitOption(best, ctrl, anchor, opts.length === 1)) {
            if (IS_TOUCH) ctrl.blur?.();
            await sleep(150);
            return true;
          }
          try { await typeInto(ctrl, '', true); } catch (e) { if (e && e.isStop) throw e; }
          await closeLists();
        }
      }
    }

    const arrow = anchor.querySelector('[class*=arrow],[class*=trigger],[class*=chevron],svg');
    // (v7.7.1) قوائم البحث لا تفتح بالضغط: لا نضيّع الوقت في محاولات الضغط
    const triggers = searchy ? [] : [ctrl, anchor, arrow].filter((x, i, a) => x && a.indexOf(x) === i);

    for (const trig of triggers) {
      try { ctrl.focus?.(); } catch { /* ignore */ }
      press(trig);
      let { opts, best } = await readAndPick(anchor, cands, 12);

      if (best && await commitOption(best, ctrl, anchor, opts.length === 1)) {
        if (IS_TOUCH) ctrl.blur?.();
        await sleep(150);
        return true;
      }

      // (معطّل افتراضياً) قائمة بحث: كتابة النص لتصفية الخيارات
      if (canType) {
        for (const c of cands) {
          if (typeof c !== 'string') continue;
          await typeInto(ctrl, c, true);
          ({ opts, best } = await readAndPick(anchor, [c], 6));
          if (best && await commitOption(best, ctrl, anchor, opts.length === 1)) {
            if (IS_TOUCH) ctrl.blur?.();
            await sleep(150);
            return true;
          }
        }
        try { await typeInto(ctrl, '', true); } catch (e) { if (e && e.isStop) throw e; }
      }
      await closeLists();
    }

    // احتياط (للشعبة فقط): إذا فشل الاختيار نكتب الاسم بأنفسنا
    if (flags.typeFallback && isTextInput(ctrl) && !ctrl.readOnly) {
      const str = cands.find(c => typeof c === 'string');
      if (str) {
        await closeLists();
        await typeInto(ctrl, str, false);
        lastChosen = str + ' (كتابة)';
        return true;
      }
    }

    // فحص أخير: ربما اختير فعلاً (للنصوص فقط)
    const shown = shownValue(ctrl, anchor);
    const hit = cands.find(c => { if (typeof c !== 'string') return false; const n = norm(c); return n && shown.includes(n); });
    if (hit) { lastChosen = hit; return true; }
    return false;
  }

  /* ===================== اختيار الشعبة (طريقة مستقلة عن شكل القائمة) =====================
     نبحث عن الحروف المفردة الظاهرة تحت الحقل (ب، د، هـ، أ، ج) ونضغط على الحرف المطلوب،
     وإذا لم ينجح نستخدم أسهم لوحة المفاتيح، وآخر حل نكتب الاسم بأنفسنا. */
  const isArLetter = k => /^[ء-ي]$/.test(k);

  function secLeaves(anchor) {
    const a = anchor.getBoundingClientRect();
    const out = [];
    for (const e of document.querySelectorAll('body *')) {
      if (inUI(e) || !vis(e)) continue;
      const t = clean(ownText(e)) || (e.children.length === 0 ? clean(e.textContent) : '');
      if (!t || t.length > 3) continue;
      const k = secNorm(t);
      if (!isArLetter(k)) continue;
      const r = e.getBoundingClientRect();
      if (r.height < 6) continue;
      const below = r.top >= a.bottom - 4 && r.top - a.bottom < 800;
      const above = r.bottom <= a.top + 4 && a.top - r.bottom < 800;
      if (!(below || above)) continue;
      if (!(r.right > a.left - 20 && r.left < a.right + 20)) continue;
      out.push({ el: e, k, top: r.top });
    }
    // (v7.7.1) احتياط للهاتف: الحروف داخل القائمة المفتوحة أينما ظهرت
    if (!out.length) {
      for (const box of openOverlays()) {
        for (const e of box.querySelectorAll('*')) {
          if (inUI(e) || !vis(e)) continue;
          const t = clean(ownText(e)) || (e.children.length === 0 ? clean(e.textContent) : '');
          if (!t || t.length > 3) continue;
          const k = secNorm(t);
          if (!isArLetter(k)) continue;
          const r = e.getBoundingClientRect();
          if (r.height < 6) continue;
          out.push({ el: e, k, top: r.top });
        }
      }
    }
    out.sort((x, y) => x.top - y.top);
    return out.filter(o => !out.some(x => x !== o && o.el.contains(x.el) && x.k === o.k));
  }

  // تمرير الماوس فوق العنصر (تظليل الخيار) ثم الضغط عليه
  function hover(el) {
    let x = 0, y = 0;
    try { const r = el.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; } catch { /* ignore */ }
    const o = { bubbles: true, cancelable: true, clientX: x, clientY: y };
    for (const t of ['pointerover', 'pointerenter', 'pointermove']) { try { el.dispatchEvent(new PE(t, o)); } catch { /* ignore */ } }
    for (const t of ['mouseover', 'mouseenter', 'mousemove']) { try { el.dispatchEvent(new MouseEvent(t, o)); } catch { /* ignore */ } }
  }
  const hoverPress = el => { hover(el); press(el); };

  async function chooseSection(ctrl, raw) {
    const s = clean(raw).replace(/^(الشعبة|شعبة)\s*/, '').trim();
    if (!s) return false;
    let k = secNorm(s);
    if (/^[a-e]$/.test(k)) k = SECTION_ALT[k];

    let anchor = ctrl.closest(WRAP_SEL) || ctrl;
    if (anchor.getBoundingClientRect().height > 120) anchor = ctrl;
    const arrow = anchor.querySelector('[class*=arrow],[class*=trigger],[class*=chevron],[class*=caret],svg');
    // أصغر حاوية تحتوي كلمة «الشعبة» (لقراءة القيمة المختارة بعد إغلاق القائمة)
    let scope = anchor;
    for (let n = ctrl, i = 0; i < 6 && n.parentElement; i++) {
      n = n.parentElement;
      if (n.getBoundingClientRect().height > 300) break;
      scope = n;
      if (norm(n.innerText || '').includes(norm('الشعبة'))) break;
    }

    try { ctrl.scrollIntoView?.({ block: 'center' }); } catch { /* ignore */ }
    await sleep(300);
    if (isTextInput(ctrl) && ctrl.value) { try { await typeInto(ctrl, '', true); } catch (e) { if (e && e.isStop) throw e; } }
    await closeLists();

    const listOpen = () => new Set(secLeaves(anchor).map(o => o.k)).size >= 3;
    const shownLetters = ignoreInput => [ignoreInput ? '' : (ctrl.value || ''), ...(scope.innerText || '').split(/\s+/)]
      .map(secNorm).filter(isArLetter);
    // نجاح الاختيار = القائمة أُغلقت + الحرف المطلوب ظاهر في الحقل
    const picked = (filtered) => waitUntil(
      () => (filtered ? secLeaves(anchor).length === 0 : !listOpen()) && shownLetters(filtered).includes(k),
      1300, 100);
    const open = async () => {
      if (listOpen()) return true;
      for (const trig of [anchor, ctrl, arrow].filter((x, i, a) => x && a.indexOf(x) === i)) {
        try { ctrl.focus?.(); } catch { /* ignore */ }
        press(trig);
        if (await waitUntil(listOpen, 2500, 150)) return true;
      }
      return false;
    };
    const done = how => { lastChosen = s + (how ? ' (' + how + ')' : ''); return true; };

    // (v7.7.1) قائمة بحث (EMIS): الضغط لا يفتحها، ننتقل مباشرة للكتابة ثم الضغط (آخر الدالة)
    const searchy = isTextInput(ctrl) && !ctrl.readOnly &&
      (ctrl.getAttribute('aria-autocomplete') === 'list' || ctrl.type === 'search' || /q-field__input|q-select/.test(String(ctrl.className)));
    for (let round = 0; round < (searchy ? 0 : 2); round++) {
      if (!(await open())) { await closeLists(); await sleep(300); continue; }
      const leaves = secLeaves(anchor);
      lastOptsTxt = leaves.map(o => o.el.textContent.trim()).join(' | ');
      const idx = leaves.findIndex(o => o.k === k);
      if (idx > -1) {
        const target = leaves[idx];
        const row = target.el.closest('li,[role=option],[class*=option],[class*=item]') || target.el.parentElement || target.el;
        try { target.el.scrollIntoView?.({ block: 'nearest' }); } catch { /* ignore */ }

        // 1) تظليل ثم ضغط على الحرف
        hoverPress(target.el);
        if (await picked()) return done('');

        // 2) الضغط على صف الخيار
        if (listOpen() && row !== target.el) {
          hoverPress(row);
          if (await picked()) return done('');
        }

        // 3) الضغط على أعلى عنصر عند مركز الصف
        if (listOpen()) {
          const r = row.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (top && !inUI(top)) {
            hoverPress(top);
            if (await picked()) return done('');
          }
        }

        // 4) تظليل الخيار ثم Enter (يثبّت الخيار المظلَّل)
        if (listOpen()) {
          hover(row);
          try { ctrl.focus?.(); } catch { /* ignore */ }
          pressKey(ctrl, 'Enter');
          if (document.activeElement && document.activeElement !== ctrl) pressKey(document.activeElement, 'Enter');
          if (await picked()) return done('Enter');
        }

        // 5) أسهم لوحة المفاتيح ثم Enter
        for (const extra of [0, 1]) {
          if (!(await open())) break;
          try { ctrl.focus?.(); } catch { /* ignore */ }
          for (let i = 0; i < idx + extra; i++) { pressKey(ctrl, 'ArrowDown'); await sleep(120); }
          pressKey(ctrl, 'Enter');
          if (await picked()) return done('مفاتيح');
          const sh = shownLetters(true);
          if (!sh.length || sh.includes(k)) break;   // لا نعيد إلا إذا اختير حرف آخر بوضوح
        }
      }
      await closeLists();
      await sleep(300);
    }

    // آخر حل: نكتب الاسم ثم نضغط على الخيار الذي يظهر بعد التصفية ليُحفظ
    if (isTextInput(ctrl) && !ctrl.readOnly) {
      await closeLists();
      try { ctrl.focus?.(); } catch { /* ignore */ }
      await typeInto(ctrl, s, true);
      await waitUntil(() => secLeaves(anchor).some(o => o.k === k), 4000, 80);
      const hit = secLeaves(anchor).find(o => o.k === k);
      if (hit) {
        const row = hit.el.closest('li,[role=option],[class*=option],[class*=item]') || hit.el.parentElement || hit.el;
        hoverPress(hit.el);
        if (await picked(true)) return done('كتابة+ضغط');
        hoverPress(row);
        if (await picked(true)) return done('كتابة+ضغط');
        hover(row);
      }
      try { ctrl.focus?.(); } catch { /* ignore */ }
      pressKey(ctrl, 'Enter');
      if (await picked(true)) return done('كتابة+Enter');
      await closeLists();
      return done('كتابة فقط');
    }
    return false;
  }

  /* ===================== (v7.8) اختيار خيار حسب ما في استمارة المعلومات =====================
     يُستخدم للجنس والمستوى المعيشي: نفتح القائمة ونضغط على الخيار المطابق،
     ونتأكد أنه ظهر في الحقل، وإن لم ينجح الضغط نكتب الكلمة بأنفسنا ثم نضغط على النتيجة */
  const OPT_ROW = 'li,[role=option],mat-option,[class*=option],[class*=item]';
  const isMarked = el => {
    if (el.closest('[aria-selected=true],[aria-checked=true]')) return true;
    const row = el.closest(OPT_ROW) || el;
    return /(^|[\s-])(selected|p-highlight|checked)(\s|$)/i.test(String(row.getAttribute('class') || ''));
  };

  /* cfg: want = النوع المطلوب، label = اسم الخيار، words = كلمات للكتابة عند الحاجة،
          optKind(نص خيار) = نوعه أو '' إن لم يكن من خيارات هذا الحقل، shownKind(النص الظاهر) = نوعه */
  async function chooseKind(ctrl, cfg) {
    const { want, label, optKind, shownKind } = cfg;
    if (!want) return false;
    const words = [...new Set([label, ...(cfg.words || [])].filter(x => typeof x === 'string' && !isEmpty(x)))];
    let chosenText = '';
    const done = how => { lastChosen = (chosenText || label) + (how ? ' (' + how + ')' : ''); return true; };
    const tag = ctrl.tagName;

    // أ) قائمة عادية <select>
    if (tag === 'SELECT') {
      const o = [...ctrl.options].find(x => optKind(x.textContent) === want);
      if (o) {
        try { ctrl.focus?.(); } catch { /* ignore */ }
        ctrl.selectedIndex = o.index;
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        if (setter) setter.call(ctrl, o.value);
        ['input', 'change'].forEach(t => ctrl.dispatchEvent(new Event(t, { bubbles: true })));
        ctrl.blur?.();
        await sleep(100);
        if (ctrl.selectedIndex === o.index) { chosenText = clean(o.textContent); return done(''); }
      }
    }

    // ب) أزرار اختيار (radio)
    if (tag === 'INPUT' && ctrl.type === 'radio') {
      const r = [...document.querySelectorAll(`input[type=radio][name="${ctrl.name}"]`)]
        .find(el => optKind(el.closest('label')?.textContent || el.parentElement?.textContent || '') === want);
      if (!r) return false;
      r.click();
      await sleep(150);
      if (!r.checked) { press(r); await sleep(150); }
      return r.checked ? done('') : false;
    }

    // ج) قائمة منسدلة مخصصة
    let anchor = ctrl.closest(WRAP_SEL) || ctrl;
    if (anchor.getBoundingClientRect().height > 120) anchor = ctrl;
    const arrow = anchor.querySelector('[class*=arrow],[class*=trigger],[class*=chevron],[class*=caret],svg');
    const triggers = [ctrl, anchor, arrow].filter((x, i, a) => x && a.indexOf(x) === i);

    const kindOpts = () => gatherOptions(anchor).filter(o => optKind(o.text));
    const listOpen = () => kindOpts().length > 0;
    const findWanted = () => kindOpts().find(o => optKind(o.text) === want) || null;
    const shownText = () => norm([
      ctrl.value || '',
      (ctrl.tagName !== 'INPUT' && ctrl.tagName !== 'TEXTAREA') ? (ctrl.innerText || '') : '',
      anchor !== ctrl ? (anchor.innerText || '') : '',
    ].join(' '));
    const shownOk = () => shownKind(shownText()) === want;
    const shownOther = () => { const k = shownKind(shownText()); return !!k && k !== want; };
    // نجاح الاختيار = القائمة أُغلقت + الخيار المطلوب ظاهر في الحقل
    const picked = () => waitUntil(() => !listOpen() && shownOk(), 1500, 100);
    const noteOpts = () => { const t = gatherOptions(anchor).slice(0, 8).map(o => o.text).join(' | '); if (t) lastOptsTxt = t; };
    let soft = false;   // القائمة أُغلقت بعد الضغط لكن لم أستطع قراءة النص داخل الحقل

    const open = async () => {
      if (listOpen()) return true;
      for (const trig of triggers) {
        try { ctrl.focus?.(); } catch { /* ignore */ }
        press(trig);
        if (await waitUntil(listOpen, 1500, 120)) { noteOpts(); return true; }
      }
      noteOpts();
      return false;
    };

    const clickWanted = async () => {
      const hit = findWanted();
      if (!hit) return false;
      chosenText = hit.text;
      const row = hit.el.closest(OPT_ROW) || hit.el;
      try { hit.el.scrollIntoView?.({ block: 'nearest' }); } catch { /* ignore */ }
      await sleep(120);
      // 1) الضغط على النص  2) الضغط على صف الخيار
      for (const el of (row !== hit.el ? [hit.el, row] : [hit.el])) {
        if (!listOpen()) break;
        hoverPress(el);
        if (await picked()) return true;
      }
      // 3) الضغط على أعلى عنصر عند مركز الخيار
      if (listOpen()) {
        const r = row.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (top && !inUI(top)) { hoverPress(top); if (await picked()) return true; }
      }
      // 4) Enter فقط إذا لم يبقَ ظاهراً إلا الخيار المطلوب (حتى لا يُختار خيار آخر)
      if (listOpen()) {
        const g = kindOpts();
        if (g.length && g.every(o => optKind(o.text) === want)) {
          hover(row);
          try { ctrl.focus?.(); } catch { /* ignore */ }
          pressKey(ctrl, 'Enter');
          if (await picked()) return true;
        }
      }
      if (!listOpen() && !shownOther()) soft = true;
      return false;
    };

    // بعد ضغطة لم أستطع التأكد منها: أفتح القائمة مرة وأرى أي خيار عليه علامة الاختيار
    const checkSoft = async () => {
      if (!(await open())) return null;
      const g = kindOpts();
      const w = g.find(o => optKind(o.text) === want);
      const x = g.find(o => optKind(o.text) !== want && isMarked(o.el));
      const res = w && isMarked(w.el) ? true : (x ? false : null);
      await closeLists();
      return res;
    };

    // الحقل الذي نكتب فيه: الحقل نفسه إن كان نصياً، أو مربع البحث داخل القائمة المفتوحة
    const BOX_SEL = '.p-dropdown-panel,.p-select-overlay,.p-overlay,.cdk-overlay-container,.ng-dropdown-panel,.select2-dropdown,[role=listbox],[class*=filter],[class*=search],[class*=panel],[class*=menu]';
    const findTypeBox = () => {
      if (isTextInput(ctrl) && !ctrl.readOnly) return ctrl;
      const a = anchor.getBoundingClientRect();
      return [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit])')]
        .find(i => {
          if (i === ctrl || inUI(i) || !vis(i) || i.readOnly || i.disabled) return false;
          if (anchor.contains(i)) return true;
          if (!i.closest(BOX_SEL)) return false;
          const r = i.getBoundingClientRect();
          return r.right > a.left - 40 && r.left < a.right + 40 && Math.abs(r.top - a.bottom) < 450;
        }) || null;
    };

    try { ctrl.scrollIntoView?.({ block: 'center' }); } catch { /* ignore */ }
    await sleep(200);
    await closeLists();

    // (v7.7.1) قوائم البحث (EMIS) لا تفتح بالضغط: نذهب مباشرة إلى الكتابة ثم الضغط
    const searchy = isTextInput(ctrl) && !ctrl.readOnly &&
      (ctrl.getAttribute('aria-autocomplete') === 'list' || ctrl.type === 'search' || /q-field__input|q-select/.test(String(ctrl.className)));

    // 1) فتح القائمة والضغط على الخيار المطلوب
    for (let round = 0; round < (searchy ? 0 : 2); round++) {
      if (await open() && await clickWanted()) return done('');
      if (soft) {
        const v = await checkSoft();
        if (v === true) return done('');
        if (v === null) break;
        soft = false;   // خيار آخر هو المختار: نعيد المحاولة
      }
      await closeLists();
      await sleep(250);
    }

    // 2) احتياط: نكتب الكلمة بأنفسنا ثم نضغط على النتيجة التي تظهر
    if (!soft) {
      for (const w of words) {
        await closeLists();
        let box = findTypeBox();
        if (!box) { await open(); box = findTypeBox(); }
        if (!box) break;
        try { box.focus?.(); } catch { /* ignore */ }
        if (box === ctrl) { press(ctrl); await sleep(200); }
        await typeInto(box, w, true);
        await waitUntil(() => !!findWanted(), 4000, 80);
        noteOpts();
        if (await clickWanted()) return done('كتابة+ضغط');
        if (soft) break;
        try { await typeInto(box, '', true); } catch (e) { if (e && e.isStop) throw e; }
      }
      await closeLists();
    }

    // 3) فحص أخير
    if (shownOk()) return done('');
    if (soft && !shownOther()) return done('تأكد منه بعينك');
    return false;
  }

  /* ---- (v7.7) الجنس: «ذكر» ← ذكر، «أنثى» ← أنثى ---- */
  const optGender = t => {
    const n = norm(t);
    if (!n || n.length > 12) return '';
    if (/انث/.test(n)) return 'f';
    if (/ذكر/.test(n)) return 'm';
    return '';
  };
  const shownGender = s => {
    const f = /انث/.test(s), m = /ذكر/.test(s);
    return f && !m ? 'f' : (m && !f ? 'm' : '');
  };
  // (v7.7.3) الجنس بالضغط فقط: افتح القائمة ← انتظر ظهور «ذكر/أنثى» ← اضغط المطلوب ← انتهى
  async function chooseGenderClick(ctrl, value) {
    const want = genderOf([].concat(value)[0]);
    if (!want) return false;
    let anchor = ctrl.closest(WRAP_SEL) || ctrl;
    if (anchor.getBoundingClientRect().height > 120) anchor = ctrl;
    const control = anchor.querySelector('.q-field__control') || anchor;
    const arrow = anchor.querySelector('.q-select__dropdown-icon,[class*=dropdown-icon],[class*=arrow],[class*=chevron],[class*=trigger]');
    const box = anchor.querySelector('.q-field__native,.p-select-label,.p-dropdown-label') || anchor;
    const shownKindNow = () => shownGender(norm((box.innerText || '') + ' ' + (ctrl.value || '')));
    const findOpt = () => gatherOptions(anchor).find(o => optGender(o.text) === want) || null;
    const label = want === 'f' ? 'أنثى' : 'ذكر';
    if (shownKindNow() === want) { lastChosen = label + ' (موجود)'; return true; }

    try { ctrl.scrollIntoView?.({ block: 'center' }); } catch { /* ignore */ }
    await sleep(60);
    const openers = [
      () => press(control),
      () => press(ctrl),
      () => { if (arrow) press(arrow); },
      () => { try { ctrl.focus?.(); } catch { /* ignore */ } pressKey(ctrl, 'ArrowDown'); },
    ];
    for (const open of openers) {
      await closeLists();
      open();
      if (!(await waitUntil(() => !!findOpt(), 3000, 80))) continue;
      const o = findOpt();
      lastOptsTxt = gatherOptions(anchor).slice(0, 6).map(x => x.text).join(' | ');
      const row = o.el.closest(OPT_ROW) || o.el;
      for (const el of (row !== o.el ? [o.el, row] : [o.el])) {
        hoverPress(el);
        if (await waitUntil(() => shownKindNow() === want, 1500, 80)) { lastChosen = o.text; return true; }
        if (!findOpt()) break;   // القائمة أُغلقت
      }
      if (shownKindNow() === want) { lastChosen = o.text; return true; }
    }
    await closeLists();
    return shownKindNow() === want ? (lastChosen = label, true) : false;
  }

  function chooseGender(ctrl, value) {
    const words = [].concat(value).filter(x => typeof x === 'string' && !isEmpty(x));
    const want = genderOf(words[0]);
    return chooseKind(ctrl, {
      want, label: want === 'm' ? 'ذكر' : 'أنثى', words,
      optKind: optGender, shownKind: shownGender,
    });
  }

  /* ---- (v7.8) المستوى المعيشي: الخيار المطابق لما مكتوب في استمارة المعلومات ---- */
  async function chooseLiving(ctrl, raw) {
    const v = clean(raw);
    const want = livingKind(v);
    // كتابة غير معروفة: نطابق النص كما هو
    if (!want) return setControl(ctrl, [v], 'select');
    const L = LIVING[want];
    const ok = await chooseKind(ctrl, {
      want, label: L.label, words: [L.key, v],
      // خيارات القائمة فقط (نتجاهل نصوصاً مثل «الثالث متوسط» في حقل الصف القريب)
      optKind: t => (clean(t).length > 40 || gradeOrdinal(t)) ? '' : livingKind(t),
      shownKind: livingKind,
    });
    if (ok && !norm(lastChosen).includes(norm(v))) lastChosen += ` (بالاستمارة: ${v})`;
    return ok;
  }

  /* ===================== حقل المكان ===================== */
  function placeLabel(el) {
    return clean(el.textContent).replace(/\b[a-z_]{3,}\b/gi, ' ').replace(/\s+/g, ' ').trim();
  }

  function findPlaceInput() {
    const re = /بحث المكان|بحث عن مكان|المكان/;
    const inputs = [...document.querySelectorAll('input')].filter(e => vis(e) && !inUI(e));
    let el = inputs.find(e => re.test(e.placeholder || e.getAttribute('aria-label') || ''));
    if (el) return el;
    const c = findControl(['المكان']);
    return c && c.tagName === 'INPUT' ? c : null;
  }

  function findPlaceNode(text, input) {
    const want = norm(text);
    const ir = input.getBoundingClientRect();
    const SEL = '[role=treeitem],mat-tree-node,mat-nested-tree-node,.mat-tree-node,[role=option],mat-option,li,span,div,a,button';
    const rows = [];
    for (const el of document.querySelectorAll(SEL)) {
      if (inUI(el) || !vis(el) || el === input || el.contains(input)) continue;
      if (el.children.length > 6) continue;
      const t = placeLabel(el);
      if (!t || t.length > 90) continue;
      const n = norm(t);
      let score = 0;
      if (n === want) score = 3;
      else if (n.endsWith(want)) score = 2;
      else if (n.includes(want) && n.length < want.length + 25) score = 1;
      if (!score) continue;
      const r = el.getBoundingClientRect();
      const near = r.top >= ir.top - 5 && r.top - ir.bottom < 700;
      rows.push({ el, score: score + (near ? 10 : 0) });
    }
    if (!rows.length) return null;
    const max = Math.max(...rows.map(r => r.score));
    let top = rows.filter(r => r.score === max);
    top = top.filter(r => !top.some(x => x !== r && r.el.contains(x.el)));   // أعمق عنصر
    return top[0].el;
  }

  async function findPlaceNodeStable(text, input, timeout) {
    const t0 = Date.now();
    let prev = null, since = 0;
    while (Date.now() - t0 < timeout) {
      const n = findPlaceNode(text, input);
      if (n && n === prev) { if (Date.now() - since > 250) return n; }
      else { prev = n; since = Date.now(); }
      await sleep(150);
    }
    return prev && prev.isConnected ? prev : null;
  }

  async function clickPlaceNode(node, input, text) {
    const want = norm(text);
    const saved = () =>
      norm(input.value).includes(want) ||
      !(node.isConnected && vis(node)) ||
      !!node.closest('[aria-selected=true],[aria-checked=true]');

    try { node.scrollIntoView?.({ block: 'nearest' }); } catch { /* ignore */ }
    await sleep(200);

    press(node);
    if (await waitUntil(saved, 1800, 120)) return true;

    const up = node.closest('[role=treeitem],mat-tree-node,.mat-tree-node,[role=option],mat-option,li');
    if (up && up !== node) {
      press(up);
      if (await waitUntil(saved, 1800, 120)) return true;
    }

    pressKey(node, 'Enter');
    try { input.focus?.(); } catch { /* ignore */ }
    pressKey(input, 'Enter');
    return await waitUntil(saved, 1500, 120);
  }

  // احتياط: التنقل في الشجرة خطوة خطوة
  async function fillTreeLocation(chain) {
    let placeInput = null;
    for (let i = 0; i < 10; i++) {
      placeInput = findPlaceInput();
      if (placeInput) break;
      await sleep(300);
    }
    if (!placeInput) return { ok: 0, miss: ['المكان'] };

    let ok = 0;
    const miss = [];
    try { placeInput.scrollIntoView?.({ block: 'center' }); } catch { /* ignore */ }
    await sleep(400);
    await closeLists();

    let treeOpened = false;
    for (let tryOpen = 0; tryOpen < 5; tryOpen++) {
      try { placeInput.focus?.(); } catch { /* ignore */ }
      tap(placeInput);
      await sleep(500);
      const any = [...document.querySelectorAll('[role=treeitem], mat-tree-node, [role=option]')]
        .some(e => vis(e) && !inUI(e));
      if (any) { treeOpened = true; break; }
      await sleep(300);
    }
    if (!treeOpened) return { ok: 0, miss: ['المكان'] };

    let parentAnchor = null;
    for (let i = 0; i < chain.length; i++) {
      const target = chain[i];
      const want = norm(target);
      const isLast = (i === chain.length - 1);
      let found = false;
      let chosenEl = null;

      for (let attempt = 0; attempt < 15; attempt++) {
        await sleep(300);
        const all = [...document.querySelectorAll(
          '[role=treeitem],mat-tree-node,mat-nested-tree-node,.mat-tree-node,[role=option]'
        )].filter(e => !inUI(e) && vis(e));

        const leaves = all.filter(e => {
          const kids = e.querySelectorAll('[role=treeitem],mat-tree-node,mat-nested-tree-node,.mat-tree-node');
          return kids.length === 0 || kids.length < 3;
        });

        let matches = leaves.filter(e => norm(placeLabel(e)) === want);
        if (!matches.length) matches = leaves.filter(e => norm(placeLabel(e)).startsWith(want));

        if (matches.length) {
          if (parentAnchor) {
            const below = matches.filter(e => {
              const r = e.getBoundingClientRect();
              return r.top > parentAnchor.bottom - 5 &&
                     r.left >= parentAnchor.left - 10 &&
                     r.right <= parentAnchor.right + 200;
            });
            if (below.length) matches = below;
          }
          let hit = matches[0];
          if (isLast) {
            const final = matches.find(e => /account_balance/.test(e.textContent));
            if (final) hit = final;
          }
          chosenEl = hit;
          found = true;
          break;
        }
      }

      if (!found) {
        miss.push(target);
        try { tap(placeInput); await sleep(500); } catch (e) { if (e && e.isStop) throw e; }
        continue;
      }

      parentAnchor = chosenEl.getBoundingClientRect();
      try { chosenEl.scrollIntoView?.({ block: 'center' }); } catch { /* ignore */ }
      tap(chosenEl);
      await sleep(900);
      ok++;
    }
    await closeLists();
    return { ok, miss };
  }

  // الطريقة الأساسية: اكتب «مركز قضاء خانقين» داخل الحقل ثم اضغط على النتيجة
  async function fillPlace(text, chain, log) {
    let input = null;
    for (let i = 0; i < 20 && !input; i++) {
      input = findPlaceInput();
      if (!input) await sleep(300);
    }
    if (!input) { log('✖ المكان (لا يوجد حقل)'); return { ok: 0, miss: ['المكان'] }; }

    try { input.scrollIntoView?.({ block: 'center' }); } catch { /* ignore */ }
    await sleep(400);
    await closeLists();

    for (let attempt = 0; attempt < 2; attempt++) {
      try { input.focus?.(); } catch { /* ignore */ }
      press(input);
      await sleep(400);
      await typeInto(input, text, true);
      const node = await findPlaceNodeStable(text, input, 7000);
      if (node && await clickPlaceNode(node, input, text)) {
        log(`✔ المكان ← ${text}`);
        await sleep(500);
        return { ok: 1, miss: [] };
      }
      try { await typeInto(input, '', true); } catch (e) { if (e && e.isStop) throw e; }
      await closeLists();
    }

    log('↻ المكان: جرّب الشجرة خطوة خطوة...');
    const r = await fillTreeLocation(chain);
    log(r.miss.length ? '✖ المكان' : `✔ المكان (${r.ok} مستوى)`);
    return r;
  }

  /* ===================== تعبئة الحقول ===================== */
  function formatDate(raw, fmt, iso) {
    let y, m, d, r;
    if ((r = raw.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/))) [, y, m, d] = r;
    else if ((r = raw.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/))) [, d, m, y] = r;
    else return raw;
    m = m.padStart(2, '0'); d = d.padStart(2, '0');
    return iso ? `${y}-${m}-${d}` : fmt.replace('YYYY', y).replace('MM', m).replace('DD', d);
  }

  async function setControl(ctrl, value, kind, flags = {}) {
    const tag = ctrl.tagName;
    if (tag === 'INPUT' && ctrl.type === 'checkbox') {
      if (ctrl.checked !== yes([].concat(value)[0])) ctrl.click();
      return true;
    }
    if (tag === 'INPUT' && ctrl.type === 'radio') {
      const opts = [...document.querySelectorAll(`input[type=radio][name="${ctrl.name}"]`)].map(el => ({
        el, text: clean(el.closest('label')?.textContent || el.parentElement?.textContent || ''),
      }));
      const best = pickOption(opts, value);
      if (best) { best.el.click(); lastChosen = best.text; return true; }
      return false;
    }
    if (tag === 'SELECT') {
      const best = pickOption([...ctrl.options].map(o => ({ el: o, text: clean(o.textContent) })), value);
      if (best) {
        ctrl.focus?.();
        best.el.selected = true;
        ctrl.selectedIndex = best.el.index;
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        if (setter) setter.call(ctrl, best.el.value);
        ['input', 'change'].forEach(t => ctrl.dispatchEvent(new Event(t, { bubbles: true })));
        ctrl.blur?.();
        await sleep(100);
        if (ctrl.selectedIndex === best.el.index) { lastChosen = best.text; return true; }
      }
      return chooseCustom(ctrl, value, flags);
    }
    if (kind === 'date' && (tag === 'INPUT' || tag === 'TEXTAREA')) {
      const v = [].concat(value)[0];
      if (ctrl.type === 'date') setNative(ctrl, formatDate(v, DATE_FORMAT, true));
      else await typeInto(ctrl, formatDate(v, DATE_FORMAT, false));
      return true;
    }
    if (kind === 'select' || (kind !== 'text' && ((tag !== 'INPUT' && tag !== 'TEXTAREA') || looksDropdown(ctrl)))) {
      return chooseCustom(ctrl, value, flags);
    }
    if (kind === 'text' && (tag === 'INPUT' || tag === 'TEXTAREA') && !ctrl.readOnly) {
      return hardSetText(ctrl, [].concat(value)[0]);
    }
    setNative(ctrl, [].concat(value)[0]);
    return true;
  }

  /* ===================== تحويل القيم إلى خيارات EMIS ===================== */
  function langCandidates(v) {
    const n = norm(v);
    if (!n) return null;
    if (/عرب/.test(n)) return ['العربية', 'عربي'];
    if (/كرد/.test(n)) return ['الكردية', 'كردي'];
    if (/تركمان/.test(n)) return ['التركمانية', 'تركماني'];
    if (/سريان/.test(n)) return ['السريانية', 'سرياني'];
    if (/اشور/.test(n)) return ['الآشورية', 'الاشورية', 'آشوري'];
    if (/ارمن/.test(n)) return ['الأرمنية', 'أرمني'];
    return [v];
  }
  function religionCandidates(v) {
    const n = norm(v);
    if (!n || /مسلم|اسلام/.test(n)) return ['الإسلام', 'الاسلام', 'مسلم'];
    if (/مسيح/.test(n)) return ['المسيحية', 'مسيحي'];
    if (/ايزيد|يزيد/.test(n)) return ['الإيزيدية', 'الايزيدية', 'إيزيدي'];
    if (/صاب|مندائ/.test(n)) return ['الصابئة المندائية', 'الصابئة', 'صابئي'];
    return [v];
  }
  // (v7.7) الجنس: يُؤخذ من «الجنس» في معلومات الطالب/الطالبة أولاً (ذكر ← ذكر، أنثى ← أنثى)
  // إن كان فارغاً في موقعك: اسم المدرسة احتياطاً (القواعد أدناه)، ثم الافتراضي «ذكر»
  // قواعد خاصة بالمدارس (الاسم يحتوي الكلمة ← الجنس). غير ذلك: «للبنات» أنثى، «للبنين» ذكر
  const SCHOOL_GENDER_RULES = [
    { k: 'مزدة', g: 'أنثى' },
    { k: 'أسوار', g: 'ذكر' },
  ];
  function schoolGender(school) {
    const sn = norm(school);
    if (!sn) return null;
    for (const r of SCHOOL_GENDER_RULES) if (sn.includes(norm(r.k))) return r.g;
    if (sn.includes('للبنات')) return 'أنثى';
    if (sn.includes('للبنين')) return 'ذكر';
    return null;
  }
  // يحوّل أي كتابة للجنس إلى m (ذكر) أو f (أنثى)
  function genderOf(s) {
    const n = norm(s);
    if (!n) return '';
    if (/انث|مونث|ؤنث|بنت|طالبه|female/.test(n)) return 'f';
    if (/ذكر|ولد|طالب|male/.test(n)) return 'm';
    return '';
  }
  function genderCandidates(v, school) {
    let g = genderOf(v);                           // 1) معلومات الطالب/الطالبة
    if (!g) g = genderOf(schoolGender(school));    // 2) احتياط: اسم المدرسة
    if (!g) g = genderOf(DEFAULTS.gender);         // 3) الافتراضي
    return g === 'f' ? ['أنثى', 'انثى'] : ['ذكر'];
  }

  /* ---- فئة الدم: نحلّل النص إلى (نوع + إشارة) ونطابق الخيار بغضّ النظر عن شكل كتابته
         O+ ، +O ، O Rh+ ، O Positive ، O موجب ... ---- */
  function parseBlood(s) {
    let t = (s || '').toString().toUpperCase()
      .replace(/[ً-ٟـ‎‏]/g, '')
      .replace(/RH/g, '')
      .replace(/0/g, 'O')
      .replace(/[−–—]/g, '-');
    const word = /POS|موجب/.test(t) ? '+' : /NEG|سالب/.test(t) ? '-' : null;
    const sym = t.includes('+') ? '+' : t.includes('-') ? '-' : null;
    const sign = word || sym;
    const m = t.match(/(?:^|[^A-Z])(AB|A|B|O)(?![A-Z])/);
    if (!m || !sign) return null;
    return { type: m[1], sign };
  }
  function bloodCandidates(v) {
    if (!v) return null;
    const want = parseBlood(v);
    if (!want) return null;
    return [{
      label: `${want.type}${want.sign}`,
      typeHint: want.type,
      test: txt => { const p = parseBlood(txt); return !!p && p.type === want.type && p.sign === want.sign; },
    }];
  }

  /* ---- الصف الدراسي: نطابق رقم الصف (الأول، الثاني، الثالث ...) المكتوب في موقعك بدقة،
         ولا نختار صفاً آخر أبداً، ولا يوجد صف افتراضي. «المرحلة الدراسية» غير مستخدمة. ---- */
  const gnorm = s => (s || '').toString()
    .replace(/[ً-ٰٟـ‎‏]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x660)
    .toLowerCase();
  const GRADE_ORD = [['اول', 1], ['ثاني', 2], ['ثالث', 3], ['رابع', 4], ['خامس', 5], ['سادس', 6]];
  const GRADE_STAGE = ['متوسط', 'اعداد', 'ابتد', 'ثانو'];      // كلمة المرحلة إن كُتبت داخل قيمة الصف نفسها
  const GRADE_BRANCH = ['علمي', 'ادبي', 'احيائ', 'تطبيق'];   // فرع الصف إن كُتب (الرابع العلمي ...)

  function gradeOrdinal(s) {
    const t = ' ' + gnorm(s).replace(/[^ء-ي0-9]+/g, ' ') + ' ';
    for (const [w, n] of GRADE_ORD) {
      if (new RegExp('\\s(?:ال)?' + w + '[يه]?(?=\\s)').test(t)) return n;
    }
    const m = t.match(/\s([1-6])\s/);
    return m ? +m[1] : 0;
  }

  function gradeCandidates(v) {
    if (isEmpty(v)) return null;                 // لا صف في موقعك ← لا نختار شيئاً
    const n = gradeOrdinal(v);
    if (!n) return [v];                          // نص غير معروف: مطابقة نصية فقط
    const g = gnorm(v);
    // الكلمات المكتوبة داخل قيمة الصف نفسها (متوسط، علمي ...) يجب أن تظهر في الخيار
    const must = [...GRADE_STAGE, ...GRADE_BRANCH].filter(b => g.includes(b));
    return [
      {   // 1) نفس الرقم + نفس الكلمات (إن وُجدت)
        label: v,
        test: txt => gradeOrdinal(txt) === n && must.every(b => gnorm(txt).includes(b)),
      },
      {   // 2) نفس الرقم إذا كان الوحيد في القائمة
        label: v,
        test: () => false,
        pick: opts => {
          const m = opts.filter(o => gradeOrdinal(o.text) === n);
          return m.length === 1 ? m[0] : null;
        },
      },
    ];
  }
  // الرعاية الاجتماعية: «نعم» فقط تُختار، وغير ذلك يُترك الحقل كما هو
  function welfareCandidates(v) { return yes(v) ? ['نعم'] : null; }
  /* ---- (v7.8) المستوى المعيشي: يُختار حسب ما مكتوب في استمارة المعلومات
         (تحت خط الفقر / الفقيرة / الوسطى / العليا). لا يوجد خيار افتراضي:
         إن كان فارغاً في الاستمارة لا نختار شيئاً ---- */
  const LIVING = {
    under:  { re: /تحت|دونخط|خطالفقر|under|below|poverty/,         label: 'الطبقة تحت خط الفقر', key: 'تحت' },
    poor:   { re: /فقير|فقراء|ضعيف|محدود|poor/,                    label: 'الطبقة الفقيرة',      key: 'الفقيرة' },
    middle: { re: /وسط|معتدل|middle|medium|average/,                label: 'الطبقة الوسطى',       key: 'الوسطى' },
    high:   { re: /علي|عال|غني|ميسور|مرتفع|ثري|high|rich|upper/,    label: 'الطبقة العليا',       key: 'العليا' },
  };
  // نوع واحد فقط؛ إن طابق النص أكثر من نوع (مثلاً كل الخيارات مكتوبة معاً) نعتبره غير معروف
  function livingKind(s) {
    const t = norm(s);
    if (!t) return '';
    const hits = Object.keys(LIVING).filter(k => LIVING[k].re.test(t));
    return hits.length === 1 ? hits[0] : '';
  }
  function livingValue(v) {
    if (isEmpty(v)) return null;
    if (/^(غيرمحدد|لايوجد|لاشيء|لاشي|غيرمعروف|null|undefined)$/.test(norm(v))) return null;
    return v;
  }

  /* ---- الشعبة: ترتيب الخيار في قائمة EMIS (1 = الأول) حسب حرف الشعبة في معلومات الطالب.
         لإضافة شعبة أخرى (مثل ج) أضف سطراً: 'ج': رقم_ترتيبها ---- */
  const SECTION_POSITION = { 'ب': 1, 'د': 2, 'ه': 3, 'ا': 4, 'ج': 5 };
  const SECTION_ALT = { 'ا': 'a', 'ب': 'b', 'ج': 'c', 'د': 'd', 'ه': 'e', 'a': 'ا', 'b': 'ب', 'c': 'ج', 'd': 'د', 'e': 'ه' };

  function pickByPosition(opts, pos) {
    if (!opts.length) return null;
    const need = Math.max(pos, 5);
    const par = o => o.el.parentElement;
    const box = opts[0].el.closest('ul,[role=listbox],[class*=content],[class*=menu],[class*=panel],[class*=list]');
    let group = box ? opts.filter(o => box.contains(o.el)) : [];
    if (group.length < need) group = opts.filter(o => par(o) === par(opts[0]));
    if (group.length < need) {
      const gp = par(opts[0]) && par(opts[0]).parentElement;
      group = opts.filter(o => par(o) && par(o).parentElement === gp);
    }
    if (group.length < need) return null;
    group.sort((a, b) => {
      const ra = a.el.getBoundingClientRect(), rb = b.el.getBoundingClientRect();
      return ra.top - rb.top || ra.left - rb.left;
    });
    const hit = group[pos - 1];
    if (hit) hit.loose = true;
    return hit || null;
  }

  // (v8.3.2) الشعبة غير مكتوبة («غير محددة»، «لا يوجد»، «-»، «0»...) = بدون شعبة (ليست إلزامية)
  function sectionValue(v) {
    const s = clean(v).replace(/^(الشعبة|شعبة)\s*/, '').trim();
    if (!s) return '';
    if (/^(غيرمحدد|غيرمحدده|لايوجد|لاتوجد|بدون|بدونشعبه|لاشيء|null|undefined|-+|0+|٠+|\.+|\/+)$/.test(norm(s))) return '';
    return s;
  }
  const secNorm = x => norm((x || '').toString().normalize('NFKC')).replace(/[ھۀہ]/g, 'ه');
  function sectionCandidates(v, school) {
    const s = clean(v).replace(/^(الشعبة|شعبة)\s*/, '').trim();
    if (!s) return null;
    const n = secNorm(s);
    const ar = /^[a-e]$/.test(n) ? SECTION_ALT[n] : n;
    const pos = (!school || norm(school).includes('ازادي') || !/للبنات|للبنين|اسوار|مزده/.test(norm(school))) ? SECTION_POSITION[ar] : undefined;
    const ok = new Set([n, ar]);
    if (SECTION_ALT[n]) ok.add(SECTION_ALT[n]);
    return [{
      label: s,
      test: txt => ok.has(secNorm(clean(txt).replace(/^(الشعبة|شعبة|section)\s*/i, ''))),
      pick: pos ? (opts => pickByPosition(opts, pos)) : null,
    }, s];
  }

  function surnameCandidates(surname, greatGrandfather) {
    const s = clean(surname);
    const g = clean(greatGrandfather);
    const n = norm(s);
    if (!s) return g ? [g] : null;
    if (/^[\d٠-٩]+$/.test(s)) return g ? [g] : null;
    if (/^(لايوجد|لاشيء|لاشيئ|ليس|لاشئ|لاشي|معدوم|فارغ)$/.test(n)) return g ? [g] : null;
    const lettersOnly = s.replace(/[\sً-ٰٟـ]/g, '');
    if (lettersOnly.length <= 2) return g ? [g] : null;
    return [s];
  }

  /* ===================== الخطط ===================== */
  // إيجاد حقل «رقم الصحيفة» في EMIS (بالـ placeholder أو الحقل الذي يلي «رقم السجل»)
  async function findSheetControl() {
    for (let i = 0; i < 8; i++) {
      const inputs = [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea')]
        .filter(e => vis(e) && !inUI(e));
      let c = inputs.find(e => norm(e.placeholder || e.getAttribute('aria-label') || '').includes('صحيفه'));
      if (!c) {
        const k = inputs.findIndex(e => norm(e.placeholder || '').includes('سجل'));
        if (k > -1 && inputs[k + 1]) c = inputs[k + 1];
      }
      if (c) return c;
      await sleep(250);
    }
    return null;
  }

  // الجنسية القديمة في موقعك = «هوية الأحوال المدنية» في EMIS
  const isCivil = d => /قديم/.test(norm(d.idType || '')) || /قديم/.test(norm(d.natSite || '')) || !isEmpty(d.civilRecord);

  function buildPlanPage1(d) {
    return [
      { l: ['الاسم', 'اسم الطالب', 'اسم الطالب الأول'], v: d.name },
      { l: ['اسم الأب'], v: d.father },
      { l: ['اسم والد الأب'], v: d.grandfather },
      { l: ['اسم جد الأب'], v: d.greatGrandfather },
      { l: ['اللقب'], v: surnameCandidates(d.surname, d.greatGrandfather) },
      { l: ['اسم الأم'], v: d.mother },
      { l: ['اسم والد الأم'], v: d.motherFather },
      { l: ['اسم جد الأم'], v: d.motherGrandfather },
      { l: ['تاريخ التولد', 'تاريخ الولادة'], v: d.dob, kind: 'date' },
      { l: ['نوع الهوية', 'نوع الوثيقة'], v: isCivil(d) ? ['هوية الأحوال المدنية'] : DEFAULTS.idType, kind: 'select', after: isCivil(d) ? 800 : undefined },
      ...(isCivil(d) ? [
        { l: ['رقم جهة الأحوال المدنية'], v: d.civilId, kind: 'text' },
        { l: ['رقم السجل'], v: d.civilRecord, kind: 'text' },
        { l: ['رقم الصحيفة'], v: (d.civilSheet || '').replace(/[٠-٩]/g, x => x.charCodeAt(0) - 0x660), kind: 'text', find: findSheetControl },
      ] : []),
      { l: ['رقم البطاقة الوطنية الموحدة', 'رقم البطاقة الوطنية'], v: isCivil(d) ? null : d.nationalId, kind: 'text' },
      // (v7.7) الجنس من معلومات الطالب/الطالبة: يضغط «ذكر» أو «أنثى»، وإن فشل يكتبها ثم يضغط عليها
      // (v7.7.1) الجنس مثل باقي القوائم: يكتب «ذكر» أو «أنثى» (بالهمزة) ثم يضغط على الخيار
      // (v7.7.3) الجنس: بدون كتابة. نفتح القائمة ونضغط «ذكر» أو «أنثى» عند ظهوره، وإن كان مختاراً صحيحاً لا يُعاد
      { l: ['الجنس'], v: genderCandidates(d.gender, d.school), kind: 'select', genderClick: true, keepIfSet: true },
      // (v7.6) الجنسية: يكتب «العراق» ثم ينتظر ظهورها ويضغط عليها (احتياط: «العراقية»)
      { l: ['الجنسية'], v: ['العراق', 'العراقية'], kind: 'select', typeSearch: true },
      { l: ['اللغة الأم'], v: langCandidates(d.motherTongue), kind: 'select' },
      { l: ['الديانة'], v: religionCandidates(d.religion), kind: 'select' },
      { l: ['فئة الدم'], v: bloodCandidates(d.blood), kind: 'select' },
      { l: ['رقم الهاتف', 'الهاتف'], v: d.phone, kind: 'text' },
    ];
  }

  // الصفحة 2 — قبل المكان
  function buildPlanPage2A(d) {
    return [
      { l: ['لغة الدراسة'], v: [DEFAULTS.studyLanguage], kind: 'select' },
      // (v7.8) المستوى المعيشي حسب استمارة المعلومات (يضغط على الخيار، وإن فشل يكتبه ثم يضغط عليه)
      { l: ['المستوى المعيشي'], v: livingValue(d.living), kind: 'select', living: true, emptyNote: 'فارغ في استمارة المعلومات، لم أختر شيئاً' },
      { l: ['مشمول بمنحة الرعاية الاجتماعية', 'مشمول بمنحة الرعاية', 'منحة الرعاية الاجتماعية'],
        v: welfareCandidates(d.welfare), kind: 'select' },
      { l: ['الصف الدراسي'], v: gradeCandidates(d.grade, d.school), kind: 'select', after: 450 },
      { l: ['الشعبة'], v: sectionCandidates(sectionValue(d.section), d.school), kind: 'select', typeFallback: true, secRaw: sectionValue(d.section) },
    ];
  }

  // الصفحة 2 — بعد المكان
  function buildPlanPage2B(d) {
    return [
      { l: ['المدينة/القرية', 'المدينة / القرية', 'المدينة'], v: DEFAULTS.city },
      { l: ['الحي', 'الحي / المنطقة'], v: d.neighborhood },
      { l: ['المحلة', 'رقم المحلة'], v: d.mahalla },
      { l: ['الزقاق', 'زقاق', 'رقم الزقاق'], v: d.alley },
      { l: ['أقرب نقطة دالة'], v: d.landmark },
    ];
  }

  async function runItems(items, log) {
    const failed = [];
    let ok = 0;
    for (const item of items) {
      checkStop();
      const value = [].concat(item.v).filter(v => isMatcher(v) || !isEmpty(v));
      if (!value.length) {
        if (item.emptyNote) log(`ℹ️ ${item.l[0]}: ${item.emptyNote}`);
        // قيمة الطالب الجديد فارغة: نمسح أي قيمة قديمة بدل تركها
        const old = findControl(item.l);
        if (old) { try { await clearControl(old); } catch (e) { if (e && e.isStop) throw e; } }
        continue;
      }
      const ctrl = (item.find ? await item.find() : null) || await findControlBest(item.l);
      if (!ctrl) { failed.push(item); log(`✖ ${item.l[0]} (لا يوجد حقل)`); continue; }
      // (v7.7.2) القائمة تعرض القيمة الصحيحة مسبقاً: نتركها ولا نعيد الكتابة والاختيار
      const pre = item.keepIfSet ? alreadyChosen(ctrl, value) : '';
      if (pre) { ok++; log(`✔ ${item.l[0]} ← ${pre} (موجود)`); await sleep(DELAY); continue; }
      let done = false;
      lastChosen = '';
      lastOptsTxt = '';
      try {
        done = item.genderClick ? await chooseGenderClick(ctrl, value)
          : item.secRaw ? await chooseSection(ctrl, item.secRaw)
          : item.gender ? await chooseGender(ctrl, value)
          : item.living ? await chooseLiving(ctrl, value[0])
          : await setControl(ctrl, value, item.kind, item);
      }
      catch (err) { if (err && err.isStop) throw err; console.warn('[EMIS]', item.l[0], err); }
      if (done) { ok++; log(`✔ ${item.l[0]}${lastChosen ? ' ← ' + lastChosen : ''}`); }
      else { failed.push(item); log(`✖ ${item.l[0]}`); }
      if (!done || /كتابة/.test(lastChosen)) log('🔎 الخيارات التي رأيتها: ' + (lastOptsTxt || 'لا شيء'));
      // بدون انتظار: نكمل التعبئة، وإن ظهر «مستخدم مسبقاً» بالأحمر نتوقف فوراً
      if (/رقم البطاقة/.test(item.l[0]) && !idWatchOn) {
        // خطأ قديم باقٍ من الطالب السابق: ننتظر زواله قليلاً ثم نبدأ الرصد
        if (idUsedError()) await waitUntil(() => !idUsedError(), 1000, 100);
        idWatchOn = true;
      }
      if (idUsedActive()) { triggerStop('idUsed'); throw new StopError(); }
      await sleep(item.after || DELAY);
    }
    return { ok, failed };
  }

  async function runPlan(plan, log) {
    let { ok, failed } = await runItems(plan, log);
    if (failed.length) {
      log('🔁 إعادة المحاولة للناقص...');
      await sleep(600);
      const r2 = await runItems(failed, log);
      ok += r2.ok;
      failed = r2.failed;
    }
    return { ok, miss: failed.map(i => i.l[0]) };
  }

  /* ===================== الانتقال للصفحة التالية ===================== */
  const pageHas = keys => {
    const t = norm(document.body ? document.body.innerText : '');
    return keys.some(k => t.includes(norm(k)));
  };

  const ARROW_RE = /arrow_(back|forward|left|right)|chevron_(left|right)|navigate_(before|next)|keyboard_arrow_(left|right)|^\s*(west|east)\s*$/i;

  function isCircular(cs, r) {
    const br = cs.borderTopLeftRadius || '';
    const m = parseFloat(br);
    if (isNaN(m)) return false;
    return br.includes('%') ? m >= 40 : m >= Math.min(r.width, r.height) / 2 - 4;
  }

  function isBlueish(cs) {
    const m = (cs.backgroundColor || '').match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/);
    if (!m) return false;
    const r = +m[1], g = +m[2], b = +m[3], a = m[4] === undefined ? 1 : +m[4];
    return a > 0.25 && b > r + 25 && b >= g - 5;
  }

  const isDisabledBtn = el => {
    const b = el.closest('button,a,[role=button]') || el;
    const cls = String(b.getAttribute('class') || '');
    return !!b.disabled || b.getAttribute('aria-disabled') === 'true' || /(^|\s)(mat-button-disabled|mat-mdc-button-disabled|p-disabled|disabled)(\s|$)/.test(cls);
  };

  // الدائرة الزرقاء ذات السهم (أسفل يسار الاستمارة)
  function findNextButton() {
    const docH = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, window.innerHeight);
    const SEL = 'button,a,[role=button],mat-icon,i,svg,span,div,[class*=btn],[class*=fab],[class*=next]';
    const cands = [];
    const lowCircles = [];
    for (const e of document.querySelectorAll(SEL)) {
      if (inUI(e)) continue;
      const r = e.getBoundingClientRect();
      if (r.width < 28 || r.width > 80 || Math.abs(r.width - r.height) > 12) continue;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const circ = isCircular(cs, r);
      const blue = isBlueish(cs);
      const arrowTxt = ARROW_RE.test(e.textContent || '') || /التالي|next/i.test(e.getAttribute('aria-label') || '');
      const isBtn = e.tagName === 'BUTTON' || e.getAttribute('role') === 'button';
      const absTop = r.top + window.scrollY;
      if (circ && isBtn && absTop > docH * 0.5) lowCircles.push({ e, absTop, left: r.left });
      if (!(circ && (blue || arrowTxt))) continue;
      let score = 4 + (blue ? 4 : 0) + (arrowTxt ? 3 : 0) + (isBtn ? 2 : 0);
      if (absTop > docH * 0.5) score += 3;
      if (r.left + r.width / 2 < window.innerWidth * 0.5) score += 1;
      cands.push({ e, score, absTop });
    }
    if (cands.length) {
      cands.sort((a, b) => b.score - a.score || b.absTop - a.absTop);
      return cands[0].e;
    }
    if (lowCircles.length) {
      lowCircles.sort((a, b) => b.absTop - a.absTop || a.left - b.left);
      return lowCircles[0].e;
    }
    for (const e of document.querySelectorAll('button,a,[role=button]')) {
      if (inUI(e) || !vis(e)) continue;
      const t = (e.textContent || '') + ' ' + (e.getAttribute('aria-label') || '');
      if (/التالي|next/i.test(t)) return e;
    }
    return null;
  }

  // رسائل «مطلوب / غير صحيح» الظاهرة في الاستمارة
  function missingRequired() {
    const out = [];
    for (const e of document.querySelectorAll('mat-error,[class*=error],[class*=invalid],[class*=feedback],small,span,div,p')) {
      if (inUI(e) || !vis(e) || e.children.length > 0) continue;
      const t = clean(e.textContent);
      if (t && t.length < 40 && /مطلوب|غير صحيح/.test(t)) out.push(t);
    }
    return [...new Set(out)].slice(0, 8);
  }

  async function clickNext(btn, attempt) {
    const real = btn.closest('button,a,[role=button]') || btn;
    if (attempt === 0) {
      const r = btn.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      press(at && !inUI(at) && (btn.contains(at) || at.contains(btn)) ? at : btn);
    } else if (attempt === 1) {
      press(real);
    } else {
      try { real.focus?.(); } catch { /* ignore */ }
      pressKey(real, 'Enter');
      await sleep(120);
      pressKey(real, ' ');
      try { real.click(); } catch { /* ignore */ }
    }
  }

  async function goToNextPage(log) {
    if (pageHas(PAGE2_KEYS)) { log('✔ الصفحة الثانية جاهزة'); return true; }
    log('⏭️ البحث عن السهم الأزرق...');

    let btn = null;
    for (let i = 0; i < 10 && !btn; i++) {
      btn = findNextButton();
      if (!btn) await sleep(300);
    }
    if (!btn) { log('⚠️ لم أجد زر التالي'); return false; }

    try { btn.scrollIntoView?.({ block: 'center' }); } catch { /* ignore */ }
    await sleep(500);

    // الزر قد يبقى معطّلاً حتى تكتمل الحقول المطلوبة
    const stopIfIdUsed = () => { if (idUsedActive()) { triggerStop('idUsed'); throw new StopError(); } };
    const enabled = await waitUntil(() => !isDisabledBtn(btn) || idUsedActive(), 4000, 200);
    stopIfIdUsed();
    if (!enabled) log('⚠️ الزر معطّل (حقول ناقصة)');
    const miss = missingRequired();
    if (miss.length) log('⚠️ ' + miss.join(' | '));

    // نقرتان فقط، ولا نحاول العبور بعد النقرة الثانية
    for (let attempt = 0; attempt < 2; attempt++) {
      stopIfIdUsed();
      await clickNext(btn, attempt);
      if (await waitUntil(() => pageHas(PAGE2_KEYS) || idUsedActive(), 4000, 200)) {
        stopIfIdUsed();
        log('✅ تم الانتقال للصفحة 2');
        await sleep(600);
        return true;
      }
      btn = findNextButton() || btn;
    }
    stopIfIdUsed();
    log('⚠️ لم ينتقل بعد نقرتين. اكمل الحقول الحمراء ثم اضغط «ص2»');
    return false;
  }

  /* ===================== زر الحفظ (آخر خطوة) ===================== */
  const SAVE_RE = /save|floppy|حفظ|disk/i;
  const SUCCESS_RE = /بنجاح|تم(ت)?\s*(ال)?(حفظ|إضافة|اضافة|تسجيل)|success|saved/i;

  // الدائرة الزرقاء التي عليها أيقونة الحفظ (أسفل يسار الاستمارة)
  function findSaveButton() {
    const docH = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, window.innerHeight);
    const SEL = 'button,a,[role=button],mat-icon,i,svg,span,div,[class*=btn],[class*=fab],[class*=save]';
    const cands = [];
    for (const e of document.querySelectorAll(SEL)) {
      if (inUI(e)) continue;
      const r = e.getBoundingClientRect();
      if (r.width < 28 || r.width > 80 || Math.abs(r.width - r.height) > 12) continue;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const circ = isCircular(cs, r);
      const blue = isBlueish(cs);
      const inner = e.innerHTML && e.innerHTML.length < 800 ? e.innerHTML : '';
      const hintSrc = [e.getAttribute('class'), e.getAttribute('aria-label'), e.getAttribute('title'), e.textContent, inner].join(' ');
      const hint = SAVE_RE.test(hintSrc);
      if (!(circ && (blue || hint))) continue;
      const isBtn = e.tagName === 'BUTTON' || e.getAttribute('role') === 'button';
      const absTop = r.top + window.scrollY;
      let score = 4 + (blue ? 4 : 0) + (hint ? 6 : 0) + (isBtn ? 2 : 0);
      if (absTop > docH * 0.5) score += 3;
      cands.push({ e, score, absTop, left: r.left });
    }
    if (cands.length) {
      cands.sort((a, b) => b.score - a.score || b.absTop - a.absTop || a.left - b.left);
      return cands[0].e;
    }
    for (const e of document.querySelectorAll('button,a,[role=button]')) {
      if (inUI(e) || !vis(e)) continue;
      if (/حفظ|save/i.test((e.textContent || '') + ' ' + (e.getAttribute('aria-label') || ''))) return e;
    }
    return null;
  }

  // نقرة واحدة فقط على الحفظ (لا إعادة، حتى لا يتكرر تسجيل الطالب)
  async function saveForm(log) {
    log('💾 البحث عن زر الحفظ...');
    let btn = null;
    for (let i = 0; i < 10 && !btn; i++) {
      btn = findSaveButton();
      if (!btn) await sleep(300);
    }
    if (!btn) { log('⚠️ لم أجد زر الحفظ'); return false; }

    try { btn.scrollIntoView?.({ block: 'center' }); } catch { /* ignore */ }
    await sleep(600);

    const enabled = await waitUntil(() => !isDisabledBtn(btn), 4000, 200);
    const miss = missingRequired();
    if (miss.length) log('⚠️ ' + miss.join(' | '));
    if (!enabled) { log('⚠️ زر الحفظ معطّل — لم أحفظ'); return false; }

    const url0 = location.href;
    const hadMsg = SUCCESS_RE.test(document.body ? document.body.innerText : '');
    await clickNext(btn, 0);
    const ok = await waitUntil(() =>
      location.href !== url0 ||
      !pageHas(PAGE2_KEYS) ||
      (!hadMsg && SUCCESS_RE.test(document.body ? document.body.innerText : '')), 7000, 250);

    log(ok ? '✅ تم الحفظ'
           : '⚠️ ضغطت «حفظ» ولم يظهر تأكيد. تحقق يدوياً (لن أكرر الضغط لتجنب تكرار الطالب)');
    return ok;
  }

  /* ===================== التشغيل ===================== */
  async function fillPage1(data, log) {
    log('📄 الصفحة 1...');
    // مسح رقم البطاقة القديم (وخطؤه الأحمر) من الطالب السابق قبل البدء
    const idc = findControl(['رقم البطاقة الوطنية الموحدة', 'رقم البطاقة الوطنية']);
    if (idc && idc.value) { try { await hardSetText(idc, ''); } catch (e) { if (e && e.isStop) throw e; } }
    return runPlan(buildPlanPage1(data), log);
  }

  async function fillPage2(data, log) {
    log('📄 الصفحة 2...');
    const a = await runPlan(buildPlanPage2A(data), log);
    log('📍 المكان...');
    const loc = await fillPlace(DEFAULTS.place, DEFAULTS.placeChain, log);
    await sleep(600);
    const b = await runPlan(buildPlanPage2B(data), log);
    await sleep(600);
    await publishSpecial(data, log);     // (v7.2) إرسال «الاحتياجات الخاصة» من EMIS لموقعك إن كان فيها اختيار
    const saved = await saveForm(log);   // آخر خطوة: الحفظ ثم التوقف
    return {
      ok: a.ok + loc.ok + b.ok + (saved ? 1 : 0),
      saved: !!saved,
      miss: [...a.miss, ...loc.miss, ...b.miss, ...(saved ? [] : ['الحفظ'])],
    };
  }

  async function fillBoth(data, log) {
    log('▶ بدء التعبئة الكاملة...');
    const r1 = await fillPage1(data, log);
    log(`✅ صفحة 1: ${r1.ok} حقل` + (r1.miss.length ? `\n⚠️ ناقص: ${r1.miss.join('، ')}` : ''));
    await sleep(150);   // (v7.5) وقفة قصيرة لترى الصفحة 1 مكتملة

    const nav = await goToNextPage(log);
    if (!nav) return { ok: r1.ok, miss: [...r1.miss, 'الانتقال للصفحة 2'] };

    const r2 = await fillPage2(data, log);
    log(`✅ صفحة 2: ${r2.ok} حقل` + (r2.miss.length ? `\n⚠️ ناقص: ${r2.miss.join('، ')}` : '') +
      `\n📊 المجموع: ${r1.ok + r2.ok}`);
    return { ok: r1.ok + r2.ok, miss: [...r1.miss, ...r2.miss], saved: !!r2.saved };
  }

  /* ===================== واجهة موقع الطالب ===================== */
  function startController() {
    let bar = null, timer, last = '';
    let specialPromise = Promise.resolve(), specialNote = '';   // (v7.2) نوع الاحتياج الخاص
    // هل الطالب الحالي مراجَع؟ (يظهر زر «إلغاء المراجعة والعودة للتحديد»)
    const CANCEL_REVIEW = norm('إلغاء المراجعة');
    const isReviewedNow = () => [...document.querySelectorAll('button,a,[role=button]')]
      .some(b => !inUI(b) && vis(b) && norm(b.textContent).includes(CANCEL_REVIEW));
    const read = () => {
      const d = extractStudent();
      if (!d.name) return;
      d.reviewed = isReviewedNow();
      const s = JSON.stringify(d);
      if (s !== last) { last = s; gmSet(K_DATA, s); bar && bar.setName(d); }
    };
    /* ---------- الطالب التالي (تخطّي «تمت المراجعة») ---------- */
    let nextBusy = false;
    const REVIEWED = norm('تمت المراجعة');
    const isHelperBtn = b => !inUI(b) && b.textContent.length < 40 && /مساعد\s*EMIS/i.test(b.textContent);
    const studentKey = d => norm(d.name) + norm(d.father) + norm(d.grandfather);
    const getCurrent = () => { const d = extractStudent(); return d.name ? { d, k: studentKey(d) } : null; };

    // صفوف قائمة الطلاب: كل صف يحوي زر «مساعد EMIS» واحداً
    function findStudentRows() {
      const btns = [...document.querySelectorAll('button,a,[role=button]')].filter(isHelperBtn);
      const rows = [], seen = new Set();
      for (const b of btns) {
        let row = b;
        while (row.parentElement) {
          const p = row.parentElement;
          const n = [...p.querySelectorAll('button,a,[role=button]')].filter(isHelperBtn).length;
          if (n > 1) break;
          row = p;
        }
        if (seen.has(row)) continue;
        seen.add(row);
        rows.push({ row, btn: b });
      }
      return rows;
    }

    const isReviewedRow = row =>
      [...row.querySelectorAll('*')].some(e => e.children.length === 0 && norm(e.textContent) === REVIEWED);

    const rowOf = (d, rows) => {
      const k = studentKey(d);
      if (k.length < 5) return null;
      return rows.find(r => norm(r.row.textContent).includes(k)) || null;
    };

    const WANT_NEXT = norm('الطالب التالي');
    const findPanelNext = () => [...document.querySelectorAll('button,a,[role=button]')]
      .find(b => !inUI(b) && vis(b) && norm(b.textContent).includes(WANT_NEXT)) || null;

    async function goNextStudent(api) {
      if (nextBusy) return;
      nextBusy = true;
      try {
        api.setLog('⏭ البحث عن الطالب التالي...');
        let cur = getCurrent();

        // اللوحة غير مفتوحة: نفتح أول طالب غير مراجَع من القائمة
        if (!cur || !findPanelNext()) {
          const first = findStudentRows().find(r => !isReviewedRow(r.row));
          if (!first) { api.setLog('⚠️ لم أجد طلاباً غير مراجَعين في القائمة'); return; }
          press(first.btn);
          const ok = await waitUntil(() => getCurrent(), 5000, 200);
          await sleep(500);
          read();
          const c = getCurrent();
          api.setLog(ok && c ? `✔ ${c.d.name} ${c.d.father} ${c.d.grandfather}` : '⚠️ لم تفتح لوحة الطالب');
          return;
        }

        let skipped = 0;
        for (let i = 0; i < 80; i++) {
          const btn = findPanelNext();
          if (!btn || btn.disabled || btn.closest('button')?.disabled) {
            api.setLog('⚠️ وصلت لآخر القائمة، لا يوجد طالب غير مراجَع بعده');
            return;
          }
          const prev = cur.k;
          press(btn);
          const changed = await waitUntil(() => { const c = getCurrent(); return c && c.k !== prev; }, 5000, 200);
          if (!changed) { api.setLog('⚠️ لا يوجد طالب بعده (آخر القائمة)'); return; }
          await sleep(400);
          cur = getCurrent();
          read();

          const row = rowOf(cur.d, findStudentRows());
          if (row && isReviewedRow(row.row)) {
            skipped++;
            api.setLog(`⏭ تخطيت (تمت المراجعة): ${cur.d.name} ${cur.d.father}`);
            continue;
          }
          api.setLog(`✔ ${cur.d.name} ${cur.d.father} ${cur.d.grandfather}` +
            (skipped ? `\n(تخطيت ${skipped} تمت مراجعتهم)` : '') +
            (row ? '' : '\n⚠️ لم أجده في القائمة للتحقق من المراجعة'));
          return;
        }
        api.setLog('⚠️ توقفت بعد 80 محاولة');
      } catch (e) {
        if (e && e.isStop) api.setLog('⏹ تم الإيقاف');
        else {
          console.error('[EMIS helper]', e);
          api.setLog('❌ خطأ: ' + (e && e.message ? e.message : e));
        }
      } finally { nextBusy = false; }
    }

    /* ---------- تحديد «تمت المراجعة» ثم الانتقال لأول طالب غير مراجَع ---------- */
    const AUTO_KEY = 'emis_auto_review';
    const CHAIN_KEY = 'emis_chain_new_v3';   // الافتراضي: مفعّل (يفتح «جديد» فقط، والتعبئة عند ضغطك «ابدأ»)
    const WANT_REVIEW = norm('تحديد تمت المراجعة');
    const findReviewBtn = () => [...document.querySelectorAll('button,a,[role=button]')]
      .find(b => !inUI(b) && vis(b) && norm(b.textContent).includes(WANT_REVIEW)) || null;
    const isOff = b => !b || b.disabled || !!b.closest('button')?.disabled;

    // إن كان الطالب الحالي مراجَعاً في القائمة نتقدم حتى أول طالب غير مراجَع
    async function skipReviewedForward(api) {
      let skipped = 0;
      for (let i = 0; i < 80; i++) {
        const cur = getCurrent();
        if (!cur) return skipped;
        const row = rowOf(cur.d, findStudentRows());
        if (!(row && isReviewedRow(row.row))) return skipped;
        const btn = findPanelNext();
        if (isOff(btn)) return skipped;
        const prev = cur.k;
        press(btn);
        const changed = await waitUntil(() => { const c = getCurrent(); return c && c.k !== prev; }, 5000, 200);
        if (!changed) return skipped;
        await sleep(400);
        read();
        skipped++;
        api.setLog(`⏭ تخطيت (تمت المراجعة): ${cur.d.name} ${cur.d.father}`);
      }
      return skipped;
    }

    async function markReviewedAndNext(api) {
      if (nextBusy) return;
      nextBusy = true;
      try {
        await specialPromise;   // (v7.2) ننتظر انتهاء تحديد «نوع الاحتياج الخاص» قبل المراجعة
        const cur = getCurrent();
        const btn = findReviewBtn();
        if (!cur || !btn) { api.setLog('⚠️ لم أجد زر «تحديد تمت المراجعة»'); return; }
        if (isOff(btn)) { api.setLog('⚠️ زر «تمت المراجعة» معطّل'); return; }
        const prev = cur.k;
        press(btn);
        const changed = await waitUntil(() => { const c = getCurrent(); return c && c.k !== prev; }, 6000, 200);
        if (!changed) { api.setLog(`✅ حُدّد «تمت المراجعة»: ${cur.d.name} ${cur.d.father}\n⚠️ لم ينتقل (ربما آخر طالب)`); return; }
        await sleep(500);
        read();
        const skipped = await skipReviewedForward(api);
        const c = getCurrent();
        api.setLog(`✅ تمت مراجعة: ${cur.d.name} ${cur.d.father}` +
          (c ? `\n➡ الآن: ${c.d.name} ${c.d.father} ${c.d.grandfather}` : '') +
          (skipped ? `\n(تخطيت ${skipped} تمت مراجعتهم)` : '') +
          (specialNote ? `\n${specialNote}` : ''));
        specialNote = '';

        // فتح «جديد +» في EMIS وتعبئة الطالب التالي (إن لم يكن مراجَعاً)
        if (gmGet(CHAIN_KEY, true) && c && c.k !== prev) {
          const nrow = rowOf(c.d, findStudentRows());
          // نفتح «جديد» فقط إذا كان الطالب غير مراجَع (يظهر «تحديد تمت المراجعة» وليس «إلغاء المراجعة»)
          if (!(nrow && isReviewedRow(nrow.row)) && findReviewBtn() && !isReviewedNow()) {
            await sleep(300);
            read();
            api.addLog('🆕 فتح «جديد» في EMIS (بدون تعبئة)...');
            gmSet(K_STATUS, '');
            gmSet(K_CMD, JSON.stringify({ mode: 'newOnly', t: Date.now() }));
          }
        }
      } catch (e) {
        if (e && e.isStop) api.setLog('⏹ تم الإيقاف');
        else {
          console.error('[EMIS helper]', e);
          api.setLog('❌ خطأ: ' + (e && e.message ? e.message : e));
        }
      } finally { nextBusy = false; }
    }

    /* ---------- (v7.7) مزامنة كل الطلاب غير المراجَعين دفعة واحدة ---------- */
    const K_QUEUE = 'emis_queue_v1', K_SYNC = 'emis_sync_v1', K_MARK = 'emis_mark_v1';
    let syncBusy = false;
    // يفتح كل طالب في القائمة (ليس عليه «تمت المراجعة») ويقرأ معلوماته كاملة
    async function syncAll(known, exist) {
      if (syncBusy) return;
      const knownKeys = (known || []).filter(k => k && k.length >= 5);
      // (v7.8) طلاب موجودون في EMIS الحقيقي (الاسم الثلاثي أو رقم البطاقة): لا نزامنهم
      const exKeys = ((exist && exist.keys) || []).filter(k => k && k.length >= 5);
      const exIds = new Set(((exist && exist.ids) || []).map(String));
      const digits = t => (t || '').replace(/[\u0660-\u0669]/g, d => d.charCodeAt(0) - 0x660);
      const inEmisRow = txt => exKeys.some(k => txt.includes(k));   // (v7.9.1) الاسم الرباعي فقط
      let existing = 0;
      syncBusy = true;
      stopRequested = false;
      const prog = o => gmSet(K_SYNC, JSON.stringify({ ...o, t: Date.now() }));
      try {
        const total = findStudentRows().length;
        if (!total) {
          prog({ running: false, error: 'لم أجد قائمة الطلاب (أزرار «مساعد EMIS») في موقعك. افتح صفحة قائمة الطلاب.' });
          return;
        }
        const items = [], seen = new Set();
        let reviewed = 0;
        for (let i = 0; i < total; i++) {
          checkStop();
          const r = findStudentRows()[i];
          if (!r) break;
          if (isReviewedRow(r.row)) { reviewed++; prog({ running: true, done: i + 1, total, found: items.length, reviewed, existing }); continue; }
          // (v7.7.1) مزامنة سريعة: طالب معروف للتطبيق (قرأناه سابقاً) لا نفتحه مرة أخرى
          const rowTxt = norm(r.row.textContent);
          // (v7.8) موجود في EMIS: لا نفتحه ولا نزامنه
          if (inEmisRow(rowTxt)) { existing++; prog({ running: true, done: i + 1, total, found: items.length, reviewed, existing }); continue; }
          const kn = knownKeys.find(k => rowTxt.includes(k));
          if (kn) {
            if (!seen.has(kn)) { seen.add(kn); items.push({ k: kn, d: null }); }
            prog({ running: true, done: i + 1, total, found: items.length, reviewed });
            continue;
          }
          const prev = (getCurrent() || {}).k;
          press(r.btn);
          await waitUntil(() => { const c = getCurrent(); return c && c.k !== prev; }, 4000, 60);
          await sleep(80);
          const c = getCurrent();
          if (c) {
            c.d.reviewed = isReviewedNow();
            const k4 = c.k + norm(c.d.greatGrandfather);
            if (c.d.reviewed) reviewed++;
            else if (c.d.greatGrandfather && exKeys.includes(k4)) existing++;
            else if (!seen.has(c.k)) { seen.add(c.k); items.push({ k: c.k, d: c.d }); }
          }
          prog({ running: true, done: i + 1, total, found: items.length, reviewed, existing });
        }
        gmSet(K_QUEUE, JSON.stringify({ items, reviewed, existing, total, t: Date.now() }));
        prog({ running: false, done: total, total, found: items.length, reviewed, existing });
      } catch (e) {
        prog({ running: false, error: e && e.isStop ? 'أُوقفت المزامنة' : 'خطأ: ' + (e && e.message ? e.message : e) });
      } finally { syncBusy = false; }
    }

    // تحديد «تمت المراجعة» لطالب معيّن (بعد تسجيله في EMIS) — يعمل في الخلفية
    async function markByKey(k) {
      const res = r => gmSet(K_MARK, JSON.stringify({ k, res: r, t: Date.now() }));
      try {
        const row = findStudentRows().find(r => norm(r.row.textContent).includes(k));
        if (row && isReviewedRow(row.row)) return res('already');
        let cur = getCurrent();
        if (!cur || cur.k !== k) {
          if (!row) return res('norow');
          press(row.btn);
          await waitUntil(() => { const c = getCurrent(); return c && c.k === k; }, 5000, 120);
          await sleep(250);
          cur = getCurrent();
          if (!cur || cur.k !== k) return res('notopened');
        }
        if (isReviewedNow()) return res('already');
        const btn = findReviewBtn();
        if (!btn || isOff(btn)) return res('nobtn');
        press(btn);
        const ok = await waitUntil(() => {
          const r2 = findStudentRows().find(r => norm(r.row.textContent).includes(k));
          return (r2 && isReviewedRow(r2.row)) || (getCurrent() || {}).k !== k || isReviewedNow();
        }, 5000, 150);
        return res(ok ? 'ok' : 'unknown');
      } catch (e) { return res('error'); }
    }
    /* ---------- (v7.9) مزامنة فورية من خادم موقع الطلاب مباشرة (طلب واحد لكل الطلاب) ---------- */
    async function trpc(path, input, post) {
      const enc = encodeURIComponent(JSON.stringify({ 0: { json: input === undefined ? null : input } }));
      const res = post
        ? await fetch('/api/trpc/' + path + '?batch=1', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ 0: { json: input } }) })
        : await fetch('/api/trpc/' + path + '?batch=1&input=' + enc, { credentials: 'include' });
      const j = await res.json();
      const r = Array.isArray(j) ? j[0] : j;
      if (!r || r.error) throw new Error((r && r.error && r.error.json && r.error.json.message) || ('HTTP ' + res.status));
      return r.result && r.result.data ? r.result.data.json : null;
    }
    const REVIEWED_VALUES = ['true', '1', 'yes', 'reviewed', 'تمت المراجعة', 'تمت المراجعه'];
    // نفس معالجة موقعك للاستمارة قبل عرضها (الصف، الشعبة، التاريخ، الديانة، اللغة)
    function recordToData(rec, schoolName) {
      let t = {};
      try { t = JSON.parse(rec.details || '{}'); } catch { /* ignore */ }
      const r = { fullName: rec.fullName, grade: rec.grade, branch: rec.section, ...t };
      const S = v => String(v ?? '').trim();
      if (!r.dateOfBirth) r.dateOfBirth = [r.dateOfBirthYear, r.dateOfBirthMonth, r.dateOfBirthDay].filter(Boolean).join('-');
      if (r.identityType === 'البطاقة الموحدة') r.nationalId = '';
      r.branch = S(r.branch) === 'ا' ? 'أ' : S(r.branch) === 'ه' ? 'هـ' : S(r.branch);
      r.grade = S(r.grade) === 'الاول متوسط' ? 'الأول متوسط' : S(r.grade) === 'الاول' ? 'الأول' : S(r.grade);
      if (S(r.religion) === 'الاسلام') r.religion = 'الإسلام';
      if (['/', 'لايوجد', 'لا يوجد', '0', '٠', '.'].includes(S(r.familyName))) r.familyName = S(r.fatherGrandfatherName);
      const mt = S(r.motherTongue);
      if (['عربي', 'العربي', 'العربية'].includes(mt)) r.motherTongue = 'العربية';
      else if (['كردي', 'الكردي', 'الكردية'].includes(mt)) r.motherTongue = 'الكردية';
      else if (['تركماني', 'التركماني', 'التركمانية'].includes(mt)) r.motherTongue = 'التركمانية';
      // اسم الطالب: الاسم الأول (وإن كُتب الاسم كاملاً في الحقل نأخذ الكلمة الأولى)
      let name = S(r.fullName);
      const fn = S(r.fatherName);
      const parts = name.split(/\s+/);
      if (parts.length >= 2 && fn && norm(parts[1]) === norm(fn.split(/\s+/)[0])) name = parts[0];
      const d = {
        name, father: fn, grandfather: S(r.fatherFatherName), greatGrandfather: S(r.fatherGrandfatherName),
        surname: S(r.familyName), mother: S(r.motherName), motherFather: S(r.motherFatherName), motherGrandfather: S(r.motherGrandfatherName),
        dob: S(r.dateOfBirth), nationalId: S(r.unifiedCardNumber), idType: S(r.identityType),
        civilRecord: S(r.registryNumber), civilSheet: S(r.pageNumber), civilId: S(r.nationalId),
        gender: S(r.gender), motherTongue: S(r.motherTongue), blood: S(r.bloodType), religion: S(r.religion), phone: S(r.phone),
        special: S(r.specialNeedsType), living: S(r.livingStandard), welfare: S(r.socialCareIncluded),
        grade: S(r.grade), section: S(r.branch), neighborhood: S(r.neighborhood), mahalla: S(r.district), alley: S(r.alley),
        landmark: S(r.nearestLandmark), school: schoolName || '', reviewed: REVIEWED_VALUES.includes(S(r.reviewed).toLowerCase()),
        __id: rec.id, __schoolId: rec.schoolId,
      };
      for (const k of Object.keys(d)) if (d[k] === '') delete d[k];
      return d;
    }
    async function syncApi(known, exist) {
      if (syncBusy) return;
      syncBusy = true;
      const prog = o => gmSet(K_SYNC, JSON.stringify({ ...o, t: Date.now() }));
      let fallback = false;
      try {
        const me = await trpc('school.me');
        if (!me || !me.slug) throw new Error('no-school');
        prog({ running: true, done: 0, total: 1, found: 0, reviewed: 0, existing: 0 });
        const list = await trpc('student.listForSchool', { schoolSlug: me.slug });
        if (!Array.isArray(list)) throw new Error('bad-list');
        const exKeys = new Set(((exist && exist.keys) || []).filter(k => k && k.length >= 5));
        const exNames = ((exist && exist.names) || []).filter(n => n && n.length >= 8);
        const items = [], seen = new Set();
        let reviewed = 0, existing = 0;
        for (const rec of list) {
          if (!rec || typeof rec !== 'object') continue;
          const d = recordToData(rec, me.name);
          if (d.reviewed) { reviewed++; continue; }
          // (v7.9.1) الاسم الرباعي فقط: الاسم + الأب + الجد + جد الأب
          const k = norm(d.name) + norm(d.father) + norm(d.grandfather) + norm(d.greatGrandfather);
          if (d.greatGrandfather && (exKeys.has(k) || exNames.some(n => n.startsWith(k)))) { existing++; continue; }
          if (seen.has(k)) continue;
          seen.add(k);
          items.push({ k, d });
        }
        gmSet(K_QUEUE, JSON.stringify({ items, reviewed, existing, total: list.length, api: true, t: Date.now() }));
        prog({ running: false, done: list.length, total: list.length, found: items.length, reviewed, existing, api: true });
      } catch (e) {
        console.warn('[EMIS sync api] fallback:', e && e.message);
        fallback = true;
      } finally { syncBusy = false; }
      if (fallback) syncAll(known, exist);   // الطريقة القديمة (فتح الطلاب)
    }
    // «تمت المراجعة» مباشرة على الخادم: نفس ما يرسله زر «تمت المراجعة» في موقعك
    async function markApi(k, id) {
      const res = r => gmSet(K_MARK, JSON.stringify({ k, res: r, api: true, t: Date.now() }));
      try {
        const me = await trpc('school.me');
        const list = await trpc('student.listForSchool', { schoolSlug: me.slug });
        const rec = (list || []).find(x => x.id === id);
        if (!rec) throw new Error('not-found');
        let t = {};
        try { t = JSON.parse(rec.details || '{}'); } catch { /* ignore */ }
        if (REVIEWED_VALUES.includes(String(t.reviewed ?? '').trim().toLowerCase())) return res('already');
        await trpc('student.updateAdmin', {
          schoolId: rec.schoolId ?? me.id, id: rec.id, fullName: rec.fullName, grade: rec.grade, section: rec.section,
          details: JSON.stringify({ ...t, reviewed: 'true' }),
        }, true);
        return res('ok');
      } catch (e) {
        console.warn('[EMIS mark api] fallback:', e && e.message);
        markByKey(k);
      }
    }
    /* ---------- (v8.2) مقارنة موقع الطلاب مع EMIS + تحديد «تمت المراجعة» دفعة واحدة ---------- */
    const K_CMP = 'emis_compare_v1', K_MARKMANY = 'emis_markmany_v1';
    async function compareApi(exist) {
      const res = o => gmSet(K_CMP, JSON.stringify({ ...o, t: Date.now() }));
      try {
        const me = await trpc('school.me');
        if (!me || !me.slug) throw new Error('سجّل دخول المنسق في موقع الطلاب');
        const list = await trpc('student.listForSchool', { schoolSlug: me.slug });
        if (!Array.isArray(list)) throw new Error('لم تصل قائمة الطلاب');
        const names = ((exist && exist.names) || []).filter(n => n && n.length >= 8);
        const keys = new Set((exist && exist.keys) || []);
        const items = [];
        for (const rec of list) {
          if (!rec || typeof rec !== 'object') continue;
          const d = recordToData(rec, me.name);
          const k3 = norm(d.name) + norm(d.father) + norm(d.grandfather);
          const k4 = k3 + norm(d.greatGrandfather);
          const inEmis = !!d.greatGrandfather && (keys.has(k4) || names.some(n => n.startsWith(k4)));
          items.push({
            id: rec.id, k: k4,
            name: [d.name, d.father, d.grandfather, d.greatGrandfather, d.surname !== d.greatGrandfather ? d.surname : ''].filter(Boolean).join(' '),
            grade: d.grade || '', section: d.section || '',
            reviewed: !!d.reviewed, inEmis,
            maybe: !inEmis && k3.length >= 6 && names.some(n => n.startsWith(k3)),   // تطابق ثلاثي فقط (للتنبيه)
            noGgf: !d.greatGrandfather,
            d: inEmis ? null : d,
          });
        }
        res({ ok: true, school: me.name, total: list.length, items });
      } catch (e) { res({ ok: false, error: (e && e.message) || String(e) }); }
    }
    async function markManyApi(ids) {
      const prog = o => gmSet(K_MARKMANY, JSON.stringify({ ...o, t: Date.now() }));
      stopRequested = false;
      let done = 0, ok = 0, already = 0;
      const failed = [];
      try {
        const me = await trpc('school.me');
        const list = await trpc('student.listForSchool', { schoolSlug: me.slug });
        const byId = new Map((list || []).filter(Boolean).map(r => [r.id, r]));
        prog({ running: true, done, total: ids.length, ok, already, failed: 0 });
        for (const id of ids) {
          checkStop();
          done++;
          const rec = byId.get(id);
          if (!rec) { failed.push(id); continue; }
          let t = {};
          try { t = JSON.parse(rec.details || '{}'); } catch { /* ignore */ }
          if (REVIEWED_VALUES.includes(String(t.reviewed ?? '').trim().toLowerCase())) { already++; continue; }
          try {
            await trpc('student.updateAdmin', {
              schoolId: rec.schoolId ?? me.id, id: rec.id, fullName: rec.fullName, grade: rec.grade, section: rec.section,
              details: JSON.stringify({ ...t, reviewed: 'true' }),
            }, true);
            ok++;
          } catch (e) { if (e && e.isStop) throw e; failed.push(id); }
          if (done % 2 === 0 || done === ids.length) prog({ running: true, done, total: ids.length, ok, already, failed: failed.length });
          await sleep(40);
        }
        prog({ running: false, done, total: ids.length, ok, already, failed: failed.length, failedIds: failed });
      } catch (e) {
        prog({ running: false, done, total: ids.length, ok, already, failed: failed.length, error: e && e.isStop ? 'أُوقف' : (e && e.message) || String(e) });
      }
    }
    window.__emisCompare = exist => { compareApi(exist); };

    /* ---------- (v8.3) زر «إرسال إلى EMIS» في موقع الطلاب ----------
       الزر في الموقع علامة فقط (data-action="send-to-emis")، والمساعد هو من يقرأ الطالب
       ويطلب تسجيله مباشرة في EMIS (التطبيق، أو تبويب EMIS على الحاسبة) */
    const K_SEND = 'emis_send_req_v1', K_SEND_RES = 'emis_send_res_v1';
    document.addEventListener('click', async ev => {
      const btn = ev.target && ev.target.closest && ev.target.closest('[data-action="send-to-emis"]');
      if (!btn || inUI(btn)) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (btn.dataset.emisBusy === '1') return;
      btn.dataset.emisBusy = '1';
      const id = Number(btn.getAttribute('data-student-id'));
      try {
        let me = null;
        try { me = await trpc('school.me'); } catch { /* ignore */ }
        const slug = btn.getAttribute('data-school-slug') || (me && me.slug) || '';
        if (!slug) throw new Error('سجّل دخول المنسق في موقع الطلاب');
        const list = await trpc('student.listForSchool', { schoolSlug: slug });
        const rec = (list || []).find(r => r && r.id === id);
        if (!rec) throw new Error('لم أجد الطالب في قائمة المدرسة');
        const d = recordToData(rec, me && me.name);
        const k = norm(d.name) + norm(d.father) + norm(d.grandfather) + norm(d.greatGrandfather);
        gmSet(K_SEND, JSON.stringify({ id, k, d, t: Date.now() }));
      } catch (e) {
        gmSet(K_SEND, JSON.stringify({ id, error: (e && e.message) || String(e), t: Date.now() }));
        if (!window.ReactNativeWebView) alert('إرسال إلى EMIS: ' + ((e && e.message) || e));
      } finally {
        setTimeout(() => { btn.dataset.emisBusy = ''; }, 1500);
      }
    }, true);
    // على الحاسبة: نتيجة EMIS ← تحديد «تمت المراجعة» عند النجاح
    onChange(K_SEND_RES, nv => {
      if (!nv) return;
      let r; try { r = JSON.parse(nv); } catch { return; }
      if (r.saved && r.id) markApi(r.k, r.id);
      if (bar) bar.setLog(r.saved ? '✅ أُرسل إلى EMIS: ' + (r.name || '') : '✖ لم يُرسل: ' + ((r.miss && r.miss[0]) || ''));
    });
    window.__emisMarkMany = ids => { markManyApi(ids || []); };

    window.__emisSync = (known, exist) => { syncApi(known, exist); };
    window.__emisMark = (k, id) => { if (id) markApi(k, id); else markByKey(k); };

    bar = createBar('مساعد EMIS',
      api => {
        read();
        api.setLog('⏳ إرسال...');
        gmSet(K_STATUS, '');
        gmSet(K_CMD, JSON.stringify({ mode: 'both', t: Date.now() }));
      },
      api => {
        read();
        api.setLog('⏳ صفحة 2...');
        gmSet(K_CMD, JSON.stringify({ mode: 'page2', t: Date.now() }));
      },
      api => goNextStudent(api),
      {
        onReview: api => markReviewedAndNext(api),
        autoGet: () => gmGet(AUTO_KEY, true),
        autoSet: v => gmSet(AUTO_KEY, !!v),
        chainGet: () => gmGet(CHAIN_KEY, true),
        chainSet: v => gmSet(CHAIN_KEY, !!v),
      },
      api => requestStop(api)
    );

    /* ---------- (v7.2) «نوع الاحتياج الخاص» في موقعك = الخيار المختار في EMIS ---------- */
    const SPECIAL_SITE_LABEL = norm('نوع الاحتياج الخاص');

    // الحقل القابل للاختيار/الكتابة في صف «نوع الاحتياج الخاص» (ضمن نفس الصف فقط)
    function findSiteSpecialControl() {
      const SEL = 'select,input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]),' +
        'textarea,[role=combobox],mat-select,ng-select,[role=listbox]';
      const labels = [...document.querySelectorAll('body *')]
        .filter(e => !inUI(e) && vis(e) && norm(ownText(e).split(/[:：]/)[0]) === SPECIAL_SITE_LABEL);
      for (const l of labels) {
        const lr = l.getBoundingClientRect();
        const ly = lr.top + lr.height / 2;
        let node = l;
        for (let i = 0; i < 4 && node.parentElement; i++) {
          node = node.parentElement;
          const found = [...node.querySelectorAll(SEL)]
            .filter(c => !inUI(c) && vis(c) && !l.contains(c))
            .map(c => { const r = c.getBoundingClientRect(); return { c, h: r.height, dy: r.top + r.height / 2 - ly }; })
            .filter(x => x.h > 8 && x.dy >= -6 && x.dy < 40)
            .sort((a, b) => a.dy - b.dy);
          if (found.length) return found[0].c;
        }
      }
      return null;
    }

    async function applySpecialToSite(p) {
      const val = (p.values || [])[0];
      if (!val) return;
      const cur = getCurrent();
      if (!cur || (p.k && cur.k !== p.k)) {
        specialNote = '⚠️ نوع الاحتياج: الطالب الحالي تغيّر، لم أغيّر شيئاً';
        bar.addLog(specialNote);
        return;
      }
      const ctrl = findSiteSpecialControl();
      if (!ctrl) {
        specialNote = `⚠️ لم أجد حقل «نوع الاحتياج الخاص» القابل للاختيار في موقعك (القيمة في EMIS: ${val})`;
        bar.addLog(specialNote);
        return;
      }
      const cands = [val, val.replace(/^العوق/, 'الإعاقة'), val.replace(/^العوق/, 'إعاقة')];
      let ok = false;
      try { ok = await setControl(ctrl, cands); }
      catch (e) { if (e && e.isStop) throw e; console.warn('[EMIS special]', e); }
      specialNote = ok
        ? `✔ نوع الاحتياج الخاص ← ${lastChosen || val}` + ((p.values || []).length > 1 ? ` (في EMIS أكثر من اختيار: ${p.values.join('، ')})` : '')
        : `✖ نوع الاحتياج الخاص (${val})`;
      bar.addLog(specialNote);
    }

    onChange(K_SPECIAL, nv => {
      if (!nv) return;
      let p; try { p = JSON.parse(nv); } catch { return; }
      specialPromise = specialPromise
        .then(() => applySpecialToSite(p))
        .catch(e => console.warn('[EMIS special]', e));
    });

    let lastStatusT = 0;
    onChange(K_STATUS, nv => {
      if (!nv) return;
      let s; try { s = JSON.parse(nv); } catch { return; }
      if (s.info) { bar.setLog(s.info); return; }
      if (s.stopped) { bar.setLog((s.miss && s.miss[0]) || '⏹ تم الإيقاف'); return; }
      const msg = (s.ok ? `✅ ${s.ok} حقل` : '⚠️ لم يُعبّأ شيء') + (s.miss?.length ? `\n⚠️ ${s.miss.join('، ')}` : '') +
        (specialNote ? `\n${specialNote}` : '');
      bar.setLog(msg);
      if (s.t && s.t === lastStatusT) return;
      lastStatusT = s.t || 0;
      if (!gmGet(AUTO_KEY, true) || !s.saved) return;
      if (s.miss && s.miss.length) { bar.setLog(msg + '\n⚠️ لم أحدد «تمت المراجعة» لوجود حقول ناقصة'); return; }
      setTimeout(() => {
        if (stopRequested) { bar.addLog('⏹ ألغيت المراجعة التلقائية'); return; }
        markReviewedAndNext(bar);
      }, 1200);
    });
    new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(read, 500); })
      .observe(document.body, { childList: true, subtree: true, characterData: true });
    read();
  }

  /* ===================== واجهة EMIS ===================== */
  function startEmis() {
    let busy = false;
    const guarded = async (ui, fn) => {
      if (busy) { ui.addLog('⏳ جارٍ العمل...'); return; }
      busy = true;
      stopRequested = false; stopReason = ''; idWatchOn = false;
      sendStop({ clear: true });   // (v7.5) تشغيل جديد يلغي أي إيقاف سابق
      // (v7.5) مراقبة: إن ظهر «رقم البطاقة الوطنية مستخدم مسبقاً» نتوقف فوراً
      const watch = setInterval(() => {
        if (!stopRequested && idUsedActive()) triggerStop('idUsed');
      }, 300);
      try { await fn(); }
      catch (e) {
        if (e && e.isStop) {
          const why = stopReason === 'idUsed'
            ? '⛔ رقم البطاقة الوطنية مستخدم مسبقاً — توقفت ولن أكمل التعبئة'
            : '⏹ تم الإيقاف';
          ui.addLog(why);
          gmSet(K_STATUS, JSON.stringify({ ok: 0, miss: [why], stopped: true, t: Date.now() }));
          // رقم البطاقة مستخدم: نمسحه من الحقل ليمكنك إدخال طالب آخر بدون تحديث الصفحة
          if (stopReason === 'idUsed') {
            idWatchOn = false;
            stopRequested = false;
            try {
              const idc = findControl(['رقم البطاقة الوطنية الموحدة', 'رقم البطاقة الوطنية']);
              if (idc) { await hardSetText(idc, ''); ui.addLog('🗑 مسحت رقم البطاقة. اضغط «ابدأ» لطالب آخر'); }
            } catch (e2) { console.warn('[EMIS clear id]', e2); }
          }
        } else {
          console.error('[EMIS helper]', e);
          ui.addLog('❌ خطأ: ' + (e && e.message ? e.message : e));
        }
      }
      finally { clearInterval(watch); busy = false; }
    };

    const loadData = ui => {
      const raw = gmGet(K_DATA, null);
      if (!raw) { ui.addLog('⚠️ لا توجد بيانات. افتح صفحة الطالب في موقعك أولاً'); return null; }
      try {
        const d = JSON.parse(raw); ui.setName(d);
        if (d.reviewed) { ui.addLog('⛔ الطالب مراجَع (يظهر «إلغاء المراجعة») — لن أملأ الاستمارة'); return null; }
        return d;
      }
      catch { ui.addLog('⚠️ بيانات تالفة'); return null; }
    };

    // الضغط على «جديد +» في قائمة EMIS وانتظار ظهور نموذج الطالب الجديد
    let newDiag = '';
    async function openNewForm(log) {
      newDiag = '';
      // (v7.7.4) نموذج جديد = حقل «اسم الأب» موجود وفارغ (لا نعبّئ فوق طالب محفوظ)
      const formReady = () => { const c = findControl(['اسم الأب']); return !!c && !clean(c.value || ''); };
      await sleep(700);   // انتظار انتهاء الحفظ
      if (formReady()) {
        // ربما ما زال الحفظ يُغلق النموذج: ننتظر قليلاً، فإن بقي مفتوحاً نعتبره نموذجاً جاهزاً
        const closed = await waitUntil(() => !formReady(), 2500, 150);
        if (!closed) return true;
        await sleep(300);
      }

      let btn = null;
      // (v7.7.4) زر «+ جديد» الأزرق الغامق في قائمة الطلاب (بحث مباشر أولاً)
      const simpleNew = () => [...document.querySelectorAll('button,a,[role=button],.q-btn')]
        .find(b => !inUI(b) && shown(b) && arOnly(b.textContent || '') === norm('جديد')) || null;
      const anyNew = () => simpleNew() || findNewButton();
      let found = await waitUntil(() => { btn = anyNew(); return !!btn; }, 5000, 200);
      // بعد الحفظ قد تبقى صفحة الطالب مفتوحة: نضغط «الرجوع» إلى القائمة ثم نبحث عن «جديد»
      if (!found) {
        const back = [...document.querySelectorAll('button,a,[role=button],.q-btn')]
          .find(b => !inUI(b) && shown(b) && arOnly(b.textContent || '') === norm('الرجوع'));
        if (back) {
          log('↩ الرجوع إلى قائمة الطلاب...');
          press(back);
          found = await waitUntil(() => { btn = anyNew(); return !!btn; }, 8000, 200);
        }
      }
      if (!found || !btn) {
        newDiag = describeButtons();
        log('⚠️ لم أجد زر «جديد»');
        log('🔎 الأزرار التي رأيتها: ' + newDiag);
        return false;
      }
      log('🆕 وجدت «جديد» وسأضغط عليه');
      try { btn.scrollIntoView?.({ block: 'center' }); } catch { /* ignore */ }
      await sleep(400);

      const wantNew = norm('جديد');
      const attempts = [
        () => press(btn),
        () => {   // الضغط على أعلى عنصر عند مركز الزر
          const r = btn.getBoundingClientRect();
          const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (at && !inUI(at)) press(at);
        },
        () => {   // الضغط على عنصر الكلمة نفسها داخل الزر
          const t = [...btn.querySelectorAll('*')].find(x => arOnly(x.textContent) === wantNew);
          press(t || btn);
        },
        () => {   // لوحة المفاتيح
          try { btn.focus?.(); } catch { /* ignore */ }
          pressKey(btn, 'Enter');
          pressKey(btn, ' ');
        },
      ];
      for (const attempt of attempts) {
        attempt();
        if (await waitUntil(formReady, 5000, 250)) {
          await sleep(800);
          return true;
        }
      }
      newDiag = describeButtons();
      log('⚠️ ضغطت «جديد» ولم يفتح النموذج');
      return false;
    }

    /* ---------- (v7.8) قراءة قائمة طلاب EMIS الحقيقي (الأسماء وأرقام البطاقات) ---------- */
    const K_EXIST = 'emis_existing_v1';
    let listBusy = false;
    async function listEmisStudents() {
      if (listBusy) return;
      listBusy = true;
      stopRequested = false;
      const prog = o => gmSet(K_EXIST, JSON.stringify({ ...o, t: Date.now() }));
      const digits = t => (t || '').replace(/[\u0660-\u0669]/g, d => d.charCodeAt(0) - 0x660);
      try {
        const rowsNow = () => [...document.querySelectorAll('tbody tr')].filter(r => !inUI(r) && vis(r) && r.querySelectorAll('td').length >= 2);
        if (!rowsNow().length) { prog({ done: true, error: 'افتح «إدارة الطلاب» (قائمة الطلاب) في EMIS' }); return; }
        const tm = digits(document.body.innerText || '').match(/(\d+)\s*\n?\s*عدد الطلاب/) || digits(document.body.innerText || '').match(/عدد الطلاب\s*\n?\s*(\d+)/);
        const total = tm ? +tm[1] : 0;
        const keys = new Set(), ids = new Set(), names = new Set(), seenRows = new Set();
        const rowKey = r => clean(r.innerText || r.textContent || '');
        const collect = () => {
          for (const r of rowsNow()) {
            const txt = rowKey(r);
            if (!txt || seenRows.has(txt)) continue;
            seenRows.add(txt);
            for (const c of r.querySelectorAll('td')) {
              const tk = clean(c.innerText || c.textContent || '').split(/\s+/).filter(w => /^[\u0621-\u064A]+$/.test(w));
              if (tk.length >= 4) keys.add(norm(tk[0]) + norm(tk[1]) + norm(tk[2]) + norm(tk[3]));   // (v7.9.1) الاسم الرباعي فقط
              if (tk.length >= 3) names.add(norm(tk.join('')));
            }
          }
        };
        const report = () => prog({ done: false, rows: seenRows.size, total });

        // عدد الصفوف في الصفحة: أكبر عدد (أو «الكل») إن وُجد
        try {
          const bottom = document.querySelector('.q-table__bottom,[class*=pagination],[class*=table-bottom]');
          const sel = bottom && bottom.querySelector('.q-select,.q-field,select,[role=combobox]');
          if (sel) {
            if (sel.tagName === 'SELECT') {
              const best = [...sel.options].sort((a, b) => (+b.value || 1e9 * (/all|الكل/i.test(b.text))) - (+a.value || 0))[0];
              if (best) { sel.value = best.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
            } else {
              press(sel.querySelector('.q-field__control') || sel);
              await waitUntil(() => document.querySelectorAll('.q-menu .q-item,[role=option]').length > 0, 2500, 100);
              const opts = [...document.querySelectorAll('.q-menu .q-item,[role=option]')].filter(vis);
              const score = o => { const t = digits(clean(o.textContent)); return /all|الكل/i.test(t) ? 1e9 : (+t || 0); };
              const best = opts.sort((a, b) => score(b) - score(a))[0];
              if (best && score(best) > 0) { press(best); await sleep(1200); } else await closeLists();
            }
          }
        } catch (e) { if (e && e.isStop) throw e; }

        collect(); report();
        let fwd = '';   // نص زر «الصفحة التالية» الذي نجح (نجربه أولاً بعد ذلك)
        const t0 = Date.now();
        for (let i = 0; i < 300 && Date.now() - t0 < 90000; i++) {
          checkStop();
          // 1) تمرير للأسفل (القوائم التي تُحمّل عند التمرير)
          const before = seenRows.size;
          const body = document.querySelector('tbody');
          let sc = body && body.parentElement;
          while (sc && sc !== document.body && !(sc.scrollHeight > sc.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
          if (sc && sc !== document.body) sc.scrollTop = sc.scrollHeight;
          window.scrollTo(0, document.documentElement.scrollHeight);
          await sleep(350);
          collect();
          if (seenRows.size > before) { report(); continue; }
          // 2) الصفحة التالية
          const navBtns = [...document.querySelectorAll('.q-table__bottom button,[class*=pagination] button,button')]
            .filter(b => !inUI(b) && vis(b) && !b.disabled && !b.closest('.disabled,[aria-disabled=true]') &&
              /^(chevron_left|chevron_right|keyboard_arrow_left|keyboard_arrow_right|navigate_before|navigate_next|التالي|›|‹|>|<)$/.test(clean(b.textContent)));
          if (fwd) navBtns.sort((a, b) => (clean(b.textContent) === fwd) - (clean(a.textContent) === fwd));
          let moved = false;
          for (const nb of fwd ? navBtns.filter(b => clean(b.textContent) === fwd) : navBtns) {
            const txt = clean(nb.textContent);
            press(nb);
            if (await waitUntil(() => rowsNow().some(r => !seenRows.has(rowKey(r))), 3000, 120)) { moved = true; fwd = txt; break; }
          }
          if (!moved) break;
          collect(); report();
        }
        prog({ done: true, keys: [...keys], ids: [...ids], names: [...names], rows: seenRows.size, total });
      } catch (e) {
        prog({ done: true, error: e && e.isStop ? 'أُوقفت القراءة' : 'خطأ: ' + (e && e.message ? e.message : e) });
      } finally { listBusy = false; }
    }
    // (v7.9) قائمة طلاب EMIS من خادم EMIS مباشرة (بدل قراءة الجدول صفحة صفحة)
    function emisToken() {
      const look = (o, depth) => {
        if (!o || typeof o !== 'object' || depth > 4) return '';
        if (typeof o.accessToken === 'string' && o.accessToken.length > 20) return o.accessToken;
        for (const v of Object.values(o)) { const t = look(v, depth + 1); if (t) return t; }
        return '';
      };
      for (const st of [localStorage, sessionStorage]) {
        for (let i = 0; i < st.length; i++) {
          const v = st.getItem(st.key(i)) || '';
          if (v.indexOf('accessToken') < 0) continue;
          try { const t = look(JSON.parse(v), 0); if (t) return t; } catch { /* ignore */ }
        }
      }
      return '';
    }
    async function listEmisApi() {
      if (listBusy) return;
      const prog = o => gmSet(K_EXIST, JSON.stringify({ ...o, t: Date.now() }));
      try {
        let token = emisToken();
        if (!token) throw new Error('no-token');
        // (v8.0.1) كما في تطبيق «مساعد EMIS» الأول: إعادة المحاولة عند انقطاع الشبكة،
        // وعند 401 نعيد قراءة رمز الدخول (الصفحة تجدده بنفسها) ثم نحاول مرة أخرى
        const getJson = async url => {
          let last = '';
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json, text/plain, */*' } });
              if (res.ok) return await res.json();
              last = 'HTTP ' + res.status;
              if (res.status === 401) { await sleep(900); token = emisToken() || token; continue; }
              if (res.status === 403 || res.status === 404) break;
            } catch (e) { if (e && e.isStop) throw e; last = String(e && e.message || e); }
            await sleep(700 * (attempt + 1));
          }
          throw new Error(last || 'network');
        };
        const sm = location.pathname.match(/schools\/(\d+)/) || location.pathname.match(/entities\/(\d+)/);
        const keys = new Set(), ids = new Set(), names = new Set();
        let rows = 0, total = 0;
        // (v8.0.1) كل طلاب المدرسة بطلب واحد (3000 في الصفحة) كما في التطبيق الأول
        const per = 3000;
        for (let page = 1; page <= 100; page++) {
          const q = new URLSearchParams({ page: String(page), rowsPerPage: String(per), sortBy: 'id', sortOrder: 'desc' });
          if (sm) q.set('entityId', sm[1]);
          const j = await getJson('/api/student/getstudents?' + q);
          const data = (j && j.data) || [];
          total = (j && j.meta && j.meta.totalCount) || total;
          for (const st of data) {
            rows++;
            // (v7.9.1) المطابقة بالاسم الرباعي فقط
            const tk = clean(st.fullName || '').split(/\s+/).filter(w => /^[\u0621-\u064A]+$/.test(w));
            if (tk.length >= 4) keys.add(norm(tk[0]) + norm(tk[1]) + norm(tk[2]) + norm(tk[3]));
            // (v8.2) الاسم الكامل بدون مسافات: يطابق الأسماء المركبة («عبد الله» = «عبدالله»)
            const fullN = norm(clean(st.fullName || '').replace(/[^\u0621-\u064A\s]/g, ' '));
            if (fullN.length >= 8) names.add(fullN);
          }
          prog({ done: false, rows, total });
          // نتوقف عند اكتمال العدد (حتى لو أعاد الخادم أقل من 3000 في الصفحة نكمل الصفحات)
          if (!data.length || (total ? rows >= total : data.length < per)) break;
        }
        prog({ done: true, keys: [...keys], ids: [...ids], names: [...names], rows, total, api: true });
      } catch (e) {
        console.warn('[EMIS list api] fallback:', e && e.message);
        listEmisStudents();   // الطريقة القديمة (قراءة الجدول)
      }
    }
    window.__emisList = () => { listEmisApi(); };

    const api = createBar('مساعد EMIS',
      ui => guarded(ui, async () => {
        ui.setLog('');
        const data = loadData(ui); if (!data) return;
        const r = await fillBoth(data, ui.addLog);
        gmSet(K_STATUS, JSON.stringify({ ...r, t: Date.now() }));
      }),
      ui => guarded(ui, async () => {
        ui.setLog('');
        const data = loadData(ui); if (!data) return;
        const r = await fillPage2(data, ui.addLog);
        ui.addLog(`✅ صفحة 2: ${r.ok} حقل` + (r.miss.length ? `\n⚠️ ناقص: ${r.miss.join('، ')}` : ''));
        gmSet(K_STATUS, JSON.stringify({ ...r, t: Date.now() }));
      }),
      null, null,
      ui => requestStop(ui)
    );

    /* ---------- (v8.0) تعبئة أي نموذج في EMIS من صف Excel: عنوان العمود = اسم الحقل ---------- */
    const K_GSTAT = 'emis_generic_status_v1';
    async function fillGeneric(pairs, log) {
      let ok = 0;
      const miss = [], fail = [];
      for (const [label, raw] of pairs) {
        checkStop();
        const value = clean(String(raw ?? ''));
        if (!value || !clean(label)) continue;
        const ctrl = findControl([label]) || findControlLoose([label]);
        if (!ctrl) { miss.push(label); log(`… ${label} (ليس في هذه الصفحة)`); continue; }
        lastChosen = ''; lastOptsTxt = '';
        let done = false;
        try {
          const tag = ctrl.tagName;
          const searchy = isTextInput(ctrl) && !ctrl.readOnly &&
            (ctrl.getAttribute('aria-autocomplete') === 'list' || ctrl.type === 'search' || /q-field__input|q-select/.test(String(ctrl.className)));
          if (norm(label) === norm('الجنس')) {
            done = await chooseGenderClick(ctrl, [value]);
          } else if (tag === 'INPUT' && (ctrl.type === 'checkbox' || ctrl.type === 'radio')) {
            done = await setControl(ctrl, [value]);
          } else if (/تاريخ/.test(label) || ctrl.type === 'date') {
            done = await setControl(ctrl, [value], 'date');
          } else if (tag === 'SELECT' || searchy || looksDropdown(ctrl) || (tag !== 'INPUT' && tag !== 'TEXTAREA')) {
            const pre = alreadyChosen(ctrl, [value]);
            done = pre ? (lastChosen = pre + ' (موجود)', true) : await setControl(ctrl, [value], 'select');
          } else {
            done = clean(ctrl.value || '') === value ? true : await hardSetText(ctrl, value);
          }
        } catch (e) { if (e && e.isStop) throw e; console.warn('[EMIS generic]', label, e); }
        if (done) { ok++; log(`✔ ${label} ← ${lastChosen || value}`); }
        else { fail.push(label); log(`✖ ${label}` + (lastOptsTxt ? ` (الخيارات: ${lastOptsTxt})` : '')); }
        await sleep(DELAY);
      }
      return { ok, miss, fail };
    }
    window.__emisFillGeneric = (pairs, row) => {
      guarded(api, async () => {
        api.setLog('📄 تعبئة من Excel...');
        const r = await fillGeneric(pairs || [], api.addLog);
        api.addLog(`✅ عُبّئ ${r.ok}` + (r.fail.length ? ` · ✖ لم يُختر: ${r.fail.join('، ')}` : '') + (r.miss.length ? ` · ليس في هذه الصفحة: ${r.miss.join('، ')}` : ''));
        gmSet(K_GSTAT, JSON.stringify({ ...r, row, t: Date.now() }));
      });
    };

    /* ---------- (v8.1) التسجيل المباشر: إضافة الطالب عبر خادم EMIS (كما في تطبيق «مساعد EMIS» الأول) ---------- */
    const apiCache = {};
    async function emisApi(path, body) {
      let token = emisToken();
      if (!token) throw new Error('لا يوجد تسجيل دخول في EMIS');
      let last = '';
      for (let attempt = 0; attempt < (body ? 1 : 3); attempt++) {
        let res;
        try {
          res = await fetch('/api' + path, {
            method: body ? 'POST' : 'GET',
            headers: { Authorization: 'Bearer ' + token, Accept: 'application/json, text/plain, */*', ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
          });
        } catch (e) { if (body) throw new Error('انقطع الاتصال أثناء الإرسال — تحقق في EMIS هل أُضيف الطالب قبل الإعادة'); last = 'network'; await sleep(700); continue; }
        const txt = await res.text();
        let j = null; try { j = JSON.parse(txt); } catch { /* ignore */ }
        if (res.ok) return j;
        last = (j && (j.message || j.error || j.title)) || txt.slice(0, 200) || ('HTTP ' + res.status);
        if (j && j.errors) { try { last += ' ' + JSON.stringify(j.errors).slice(0, 300); } catch { /* ignore */ } }
        if (res.status === 401 && !body) { await sleep(900); token = emisToken() || token; continue; }
        break;
      }
      throw new Error(last || 'فشل الطلب');
    }
    const unwrap = v => (v && typeof v === 'object' && !Array.isArray(v) && v.data != null ? v.data : v);
    const oVal = x => String(x.value ?? x.id ?? x.code ?? '');
    const oTxt = x => String(x.displayName ?? x.label ?? x.name ?? x.text ?? oVal(x));
    async function optList(path) {
      if (apiCache[path]) return apiCache[path];
      const raw = unwrap(await emisApi(path));
      const list = Array.isArray(raw) ? raw.filter(x => x && typeof x === 'object') : [];
      if (list.length) apiCache[path] = list;
      return list;
    }
    // يطابق خياراً من قائمة EMIS بنفس قواعد اختيار القوائم في الاستمارة، ويعيد قيمته
    function optPick(list, cands) {
      const opts = list.map(x => ({ el: x, text: oTxt(x) }));
      const best = pickOption(opts, [].concat(cands).filter(c => isMatcher(c) || !isEmpty(c)));
      return best ? best.el : null;
    }
    const kids = n => { const r = n.children ?? n.items ?? n.subItems ?? n.childs; return Array.isArray(r) ? r : []; };

    async function registerApi(d, log) {
      const fail = why => { log('✖ ' + why); return { ok: 0, saved: false, miss: [why], api: true }; };
      const sm = location.pathname.match(/schools\/(\d+)/);
      if (!sm) return fail('افتح «إدارة الطلاب» للمدرسة في EMIS أولاً');
      const schoolId = +sm[1];
      const S = v => clean(String(v ?? ''));
      if (!S(d.name) || !S(d.father) || !S(d.grandfather)) return fail('الاسم الثلاثي ناقص');
      const dob = formatDate(S(d.dob), DATE_FORMAT, true);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return fail('تاريخ التولد ناقص أو غير مفهوم: ' + S(d.dob));

      log('🔗 التسجيل المباشر: تجهيز البيانات...');
      const enc = encodeURIComponent;
      const [genders, countries, langs, bloods, religions, econ, stages] = await Promise.all([
        optList('/selectoption/Gender'), optList('/selectoption/' + enc('بلد الولادة')), optList('/selectoption/' + enc('لغة')),
        optList('/selectoption/' + enc('فصيلة الدم')), optList('/selectoption/' + enc('الديانة')), optList('/selectoption/' + enc('حالة الاقتصادية')),
        optList('/selectoption/getAvailableStagesForStudent?schoolId=' + schoolId),
      ]);

      // الجنس
      const gk = genderOf(genderCandidates(d.gender, d.school)[0]);
      const gOpt = genders.find(x => optGender(oTxt(x)) === gk);
      const gender = gOpt ? (parseInt(oVal(gOpt), 10) || (gk === 'f' ? 2 : 1)) : (gk === 'f' ? 2 : 1);
      // البلد / اللغة / الديانة / فئة الدم / المستوى المعيشي
      const iraq = optPick(countries, ['العراق']);
      const country = iraq ? oVal(iraq) : 'العراق';
      const mtC = langCandidates(d.motherTongue);
      if (!mtC) return fail('اللغة الأم فارغة في الاستمارة');
      const mt = optPick(langs, mtC);
      if (!mt) return fail('اللغة الأم غير موجودة في EMIS: ' + S(d.motherTongue));
      const sl = optPick(langs, [DEFAULTS.studyLanguage, 'عربي']);
      const rel = optPick(religions, religionCandidates(d.religion));
      if (!rel) return fail('الديانة غير موجودة في EMIS: ' + S(d.religion));
      const bC = bloodCandidates(d.blood);
      const blood = bC ? optPick(bloods, bC) : null;
      const lv = livingValue(d.living);
      const lk = lv ? livingKind(lv) : '';
      const eco = lv ? (econ.find(x => lk && livingKind(oTxt(x)) === lk) || optPick(econ, [lv])) : null;
      // الصف والشعبة
      const gC = gradeCandidates(d.grade);
      if (!gC) return fail('الصف الدراسي فارغ في الاستمارة');
      const stage = optPick(stages, gC);
      if (!stage) return fail('الصف «' + S(d.grade) + '» غير موجود في صفوف المدرسة في EMIS (' + stages.map(oTxt).slice(0, 8).join('، ') + ')');
      const stageId = parseInt(oVal(stage), 10);
      let classRoomId = null, roomTxt = '';
      const sec = sectionValue(d.section);   // (v8.3.2) فارغة أو «غير محددة» ← تُرسل بدون شعبة
      if (sec) {
        const rooms = await optList('/selectoption/getClassRooms?schoolId=' + schoolId + '&stageId=' + stageId);
        let k = secNorm(sec); if (/^[a-e]$/.test(k)) k = SECTION_ALT[k];
        const room = rooms.find(x => { const t = secNorm(clean(oTxt(x)).replace(/^(الشعبة|شعبة|section)\s*/i, '')); return t === k || SECTION_ALT[t] === k; });
        if (!room) return fail('الشعبة «' + sec + '» غير موجودة في EMIS لهذا الصف (' + rooms.map(oTxt).join('، ') + ')');
        classRoomId = parseInt(oVal(room), 10); roomTxt = oTxt(room);
      }
      // المكان: العراق ← ديالى ← خانقين ← مركز قضاء خانقين
      let nodes = unwrap(apiCache.tree || (apiCache.tree = await emisApi('/CountryStructure/getcountrystructure')));
      nodes = Array.isArray(nodes) ? nodes : [];
      let placeId = null, depth = 0;
      for (const name of DEFAULTS.placeChain) {
        const want = norm(name);
        const hit = nodes.find(x => norm(oTxt(x)) === want) || nodes.find(x => norm(oTxt(x)).includes(want));
        if (!hit) break;
        placeId = parseInt(oVal(hit), 10); depth++; nodes = kids(hit);
      }
      if (!placeId || depth < 3) return fail('لم أجد المكان «' + DEFAULTS.placeChain.slice(0, 3).join(' / ') + '» في EMIS');
      // الهوية
      const civil = isCivil(d);
      const digits = t => S(t).replace(/[\u0660-\u0669]/g, x => x.charCodeAt(0) - 0x660);
      const idNumber = civil ? digits(d.civilId) : digits(d.nationalId).replace(/\D/g, '');
      if (!idNumber) return fail(civil ? 'رقم هوية الأحوال المدنية فارغ' : 'رقم البطاقة الوطنية فارغ');
      if (!civil) {
        const chk = await emisApi('/student/checknationalidnumber?value=' + enc(idNumber));
        if (chk && chk.isUnique === false) return fail('رقم البطاقة الوطنية مستخدم مسبقاً في EMIS');
      }

      const payload = {
        name: S(d.name), fatherName: S(d.father), grandFatherName: S(d.grandfather), fathersGrandFatherName: S(d.greatGrandfather),
        surName: S((surnameCandidates(d.surname, d.greatGrandfather) || [''])[0]),
        motherName: S(d.mother), mothersFatherName: S(d.motherFather), mothersGrandFatherName: S(d.motherGrandfather),
        imageUrl: '', dateOfBirth: dob, gender,
        nationality: country, countryOfBirth: country, homeTown: '',
        motherTongue: oVal(mt), maritalStatus: '', bloodGroup: blood ? oVal(blood) : '', religion: oVal(rel),
        homePhoneNumber: digits(d.phone), notes: '', censusNumber: '', isDisabled: false,
        identification: {
          idNumber, issuingCountry: country, idType: civil ? 3 : 12, nameOfDocument: '',
          recordNumber: civil ? digits(d.civilRecord) : '', pageNumber: civil ? digits(d.civilSheet) : '', issuer: '', issuingDate: null,
        },
        fatherIdentification: null, specialNeeds: null,
        studyLanguage: sl ? oVal(sl) : DEFAULTS.studyLanguage, economicLevel: eco ? oVal(eco) : '',
        isCoveredBySocialWelfare: yes(d.welfare), isDroppedOutFromSchool: false, lastYearResult: 3,
        schoolId, stageId, classRoomId, ageExceptionReason: null, genderExceptionReason: null,
        address: {
          addressType: 1, countryStructureId: placeId, town: DEFAULTS.city, area: S(d.neighborhood), quarter: S(d.mahalla), street: S(d.alley),
          apartmentNumber: '', buildingNumber: '', address1: '', address2: '', closestLocation: S(d.landmark) || '0',   // (v8.3.1) العنوان 1 و 2 فارغان بدل «0»
          latitude: 0, longitude: 0, schoolPhoneNumber: '', mobilePhoneNumber: '', email: '', website: '',
        },
      };
      log(`📤 إرسال: ${payload.name} ${payload.fatherName} ${payload.grandFatherName} · ${oTxt(stage)}${roomTxt ? ' ' + roomTxt : ''} · ${gender === 2 ? 'أنثى' : 'ذكر'}`);
      try { await emisApi('/student/addstudent', payload); }
      catch (e) { return fail('رفض EMIS: ' + (e && e.message ? e.message : e)); }
      log('✅ أُضيف الطالب في EMIS مباشرة');
      return { ok: 1, saved: true, miss: [], api: true };
    }

    // (v8.3) على الحاسبة (Tampermonkey): طلب «إرسال إلى EMIS» من تبويب موقع الطلاب
    //        (داخل التطبيق لا يصل هذا الطلب إلى هنا؛ التطبيق يتولاه ويطلب التأكيد)
    onChange('emis_send_req_v1', nv => {
      if (!nv || window.ReactNativeWebView) return;
      let p; try { p = JSON.parse(nv); } catch { return; }
      if (!p || p.error || !p.d) return;
      const nm = [p.d.name, p.d.father, p.d.grandfather, p.d.greatGrandfather].filter(Boolean).join(' ');
      if (!confirm('إرسال «' + nm + '» إلى EMIS الحقيقي مباشرة؟')) return;
      guarded(api, async () => {
        api.setLog('');
        let r;
        try { r = await registerApi(p.d, api.addLog); }
        catch (e) { if (e && e.isStop) throw e; r = { ok: 0, saved: false, miss: ['خطأ: ' + (e && e.message ? e.message : e)] }; }
        gmSet('emis_send_res_v1', JSON.stringify({ ...r, id: p.id, k: p.k, name: nm, t: Date.now() }));
      });
    });

    onChange(K_CMD, cmdRaw => {
      if (!cmdRaw) return;
      let cmd; try { cmd = JSON.parse(cmdRaw); } catch { return; }
      guarded(api, async () => {
        api.setLog('');
        if (cmd.mode === 'newOnly') {   // فتح «جديد» فقط بدون تعبئة
          const okNew = await openNewForm(api.addLog);
          const info = okNew ? '🆕 فُتح «جديد» — اضغط «ابدأ» لتعبئة الطالب' : '⚠️ لم أستطع فتح «جديد» — افتحه يدوياً';
          api.addLog(info);
          gmSet(K_STATUS, JSON.stringify({ info, t: Date.now() }));
          return;
        }
        const data = loadData(api); if (!data) return;
        let r;
        // (v7.7.6) «ابدأ» من التطبيق: تعبئة الاستمارة المفتوحة مباشرة (بدون شرط «جديد»)
        //          مثلاً بعد «رقم البطاقة مستخدم مسبقاً» تكمل بطالب آخر على نفس الاستمارة
        if (cmd.mode === 'api') {
          try { r = await registerApi(data, api.addLog); }
          catch (e) {
            if (e && e.isStop) throw e;
            const why = 'خطأ في التسجيل المباشر: ' + (e && e.message ? e.message : e);
            api.addLog('✖ ' + why);
            r = { ok: 0, saved: false, miss: [why], api: true };
          }
        }
        else if (cmd.mode === 'fillNew') r = await fillBoth(data, api.addLog);
        else if (cmd.mode === 'page2') r = await fillPage2(data, api.addLog);
        else if (cmd.mode === 'new') {
          if (await openNewForm(api.addLog)) r = await fillBoth(data, api.addLog);
          else {
            gmSet(K_STATUS, JSON.stringify({
              ok: 0,
              miss: ['فتح «جديد»' + (newDiag ? ' — الأزرار التي رأيتها: ' + newDiag : '')],
              t: Date.now(),
            }));
            r = null;
          }
        }
        else r = await fillBoth(data, api.addLog);
        if (r) gmSet(K_STATUS, JSON.stringify({ ...r, t: Date.now() }));
      });
    });
  }

  /* ===================== الإقلاع ===================== */
  function boot() {
    if (isMySite) { listenStop(); startController(); }
    else if (isEmis) { listenStop(); startEmis(); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
