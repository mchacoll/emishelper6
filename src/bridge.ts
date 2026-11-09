import { USERSCRIPT_SOURCE } from './userscript.generated';

/**
 * طبقة بديلة لـ Tampermonkey داخل WebView:
 *  GM_getValue / GM_setValue / GM_addValueChangeListener
 * القيم محفوظة في التطبيق (Native) وتُنقل بين نافذة «موقع الطلاب» ونافذة EMIS،
 * تماماً كما كانت تنتقل بين التبويبين في المتصفح.
 */

export type BridgeMessage =
  | { __gm: 'hello' }
  | { __gm: 'set'; k: string; v: unknown }
  | { __gm: 'log'; level: string; msg: string }
  | { __gm: 'bar'; text: string };

const SITE_HOSTS_LINE = "const MY_SITE_HOSTS = ['studentgate-kbbtktoc.manus.space'];";
const EMIS_HOSTS_LINE = "const EMIS_HOSTS = ['emis.moedu.gov.iq'];";

/** يستبدل نطاقَي موقع الطلاب و EMIS في السكربت بما يحدده المستخدم في الإعدادات */
function patchedUserscript(siteHosts: string[], emisHosts: string[]): string {
  let src = USERSCRIPT_SOURCE;
  if (siteHosts.length) src = src.replace(SITE_HOSTS_LINE, 'const MY_SITE_HOSTS = ' + JSON.stringify(siteHosts) + ';');
  if (emisHosts.length) src = src.replace(EMIS_HOSTS_LINE, 'const EMIS_HOSTS = ' + JSON.stringify(emisHosts) + ';');
  return src;
}

const SHIM = String.raw`
(function () {
  if (window.__gmBridge) return;
  var store = {};
  var listeners = {};
  var booted = false;
  var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  function post(m) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) { /* ignore */ }
  }
  function fire(k, o, n, remote) {
    var ls = listeners[k];
    if (!ls) return;
    for (var i = 0; i < ls.length; i++) {
      try { ls[i](k, o, n, remote); } catch (e) { console.error('[GM listener]', e); }
    }
  }
  window.GM_getValue = function (k, d) { return has(store, k) ? store[k] : d; };
  window.GM_setValue = function (k, v) {
    var o = store[k];
    store[k] = v;
    post({ __gm: 'set', k: k, v: v === undefined ? null : v });
    if (o !== v) fire(k, o, v, false);
  };
  window.GM_addValueChangeListener = function (k, cb) {
    (listeners[k] = listeners[k] || []).push(cb);
    return listeners[k].length;
  };
  window.__gmBridge = {
    remoteSet: function (k, v) {
      var o = store[k];
      store[k] = v;
      if (o !== v) fire(k, o, v, true);
    },
    sync: function (all) {
      store = Object.assign({}, all || {});
    },
    boot: function () {
      if (booted) return;
      booted = true;
      try { window.__gmBoot && window.__gmBoot(); } catch (e) { console.error('[EMIS helper boot]', e); }
    }
  };
  ['error', 'warn'].forEach(function (lvl) {
    var orig = console[lvl];
    console[lvl] = function () {
      try {
        // أخطاء المساعد فقط (رسائل الموقع نفسه مثل 401 لا تفيد)
        var first = String(arguments[0] || '');
        if (first.indexOf('[EMIS') !== 0 && first.indexOf('[GM') !== 0) return orig.apply(console, arguments);
        post({ __gm: 'log', level: lvl, msg: Array.prototype.map.call(arguments, function (a) {
          return a && a.stack ? a.stack : String(a);
        }).join(' ').slice(0, 2000) });
      } catch (e) { /* ignore */ }
      return orig.apply(console, arguments);
    };
  });
  // منع ظهور الكيبورد عندما يضع السكربت (أو الموقع بسببه) المؤشر داخل حقل.
  // ظهور الكيبورد يصغّر الشاشة فتقفز القائمة المنسدلة إلى أعلى الصفحة ويفشل الاختيار.
  // عند لمسك أنت للحقل يعمل الكيبورد طبيعياً.
  var lastTouch = 0;
  function isField(el) {
    return el && el.tagName && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }
  function unguard(el) {
    if (!el || !el.__gmIm) return;
    try {
      if (el.__gmIm === 1) el.removeAttribute('inputmode');
      else el.setAttribute('inputmode', el.__gmImOld);
    } catch (e) { /* ignore */ }
    el.__gmIm = 0;
  }
  function guard(el) {
    try {
      if (!isField(el) || el.__gmIm) return;
      if (Date.now() - lastTouch < 1200) return;   // لمسة حقيقية منك: اترك الكيبورد
      if (el.hasAttribute('inputmode')) { el.__gmImOld = el.getAttribute('inputmode'); el.__gmIm = 2; }
      else el.__gmIm = 1;
      el.setAttribute('inputmode', 'none');
    } catch (e) { /* ignore */ }
  }
  ['touchstart', 'pointerdown', 'mousedown'].forEach(function (t) {
    document.addEventListener(t, function (e) {
      if (!e.isTrusted) return;
      var tg = e.target;
      if (tg && tg.closest && tg.closest('#emis-helper-ui')) return;   // أزرار الشريط ليست كتابة
      lastTouch = Date.now();
      if (tg && tg.__gmIm) unguard(tg);
    }, true);
  });
  try {
    var origFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function () { guard(this); return origFocus.apply(this, arguments); };
  } catch (e) { /* ignore */ }
  document.addEventListener('focusin', function (e) { guard(e.target); }, true);
  document.addEventListener('focusout', function (e) {
    var el = e.target;
    setTimeout(function () { if (el && el.__gmIm && document.activeElement !== el) unguard(el); }, 0);
  }, true);

  // نسخة من سجل الشريط الأزرق تُرسل للتطبيق (لزر «مشاركة السجل»)
  var lastBar = '';
  setInterval(function () {
    try {
      var ui = document.getElementById('emis-helper-ui');
      if (!ui) return;
      var t = ui.innerText || '';
      if (t !== lastBar) { lastBar = t; post({ __gm: 'bar', text: t.slice(-6000) }); }
    } catch (e) { /* ignore */ }
  }, 1500);
  post({ __gm: 'hello' });
  // احتياط: إن لم يرد التطبيق خلال 3 ثوانٍ نشغّل السكربت بالقيم الحالية
  setTimeout(function () { window.__gmBridge.boot(); }, 3000);
})();
`;

/** السكربت الذي يُحقن في كل صفحة (موقع الطلاب و EMIS) */
export function buildInjection(siteHosts: string[], emisHosts: string[]): string {
  return (
    SHIM +
    '\nwindow.__gmBoot = function () {\n' +
    patchedUserscript(siteHosts, emisHosts) +
    '\n};\ntrue;'
  );
}

/**
 * وضع الكمبيوتر: تُعرض الصفحة بعرض شاشة كمبيوتر (مثل المتصفح على الحاسوب)
 * حتى تفتح القوائم المنسدلة تحت الحقل كما اعتاد السكربت، ويُكبَّر الشريط الأزرق ليبقى سهل الضغط.
 * يُحقن قبل تحميل الصفحة.
 */
export function desktopViewportJs(width: number): string {
  return String.raw`
(function () {
  var W = ${width};
  function fix() {
    try {
      var m = document.querySelector('meta[name=viewport]');
      if (!m) {
        m = document.createElement('meta');
        m.name = 'viewport';
        (document.head || document.documentElement).appendChild(m);
      }
      var c = 'width=' + W;
      if (m.getAttribute('content') !== c) m.setAttribute('content', c);
      if (!document.getElementById('emis-desktop-style') && (document.head || document.documentElement)) {
        var z = Math.max(1, Math.min(2.2, (W / (screen.width || 400)) * 0.6));
        var st = document.createElement('style');
        st.id = 'emis-desktop-style';
        st.textContent = '#emis-helper-ui{transform:scale(' + z.toFixed(2) + ');transform-origin:top left;}';
        (document.head || document.documentElement).appendChild(st);
      }
    } catch (e) { /* ignore */ }
  }
  fix();
  document.addEventListener('DOMContentLoaded', fix);
  var n = 0, iv = setInterval(function () { fix(); if (++n > 40) clearInterval(iv); }, 250);
})();
true;`;
}

/** رد التطبيق على «hello»: يرسل كل القيم المحفوظة ثم يشغّل السكربت */
export function syncAndBootJs(store: Record<string, unknown>): string {
  return (
    'try{if(window.__gmBridge){window.__gmBridge.sync(' +
    JSON.stringify(store) +
    ');window.__gmBridge.boot();}}catch(e){console.error(e)};true;'
  );
}

/** إيصال قيمة غيّرتها النافذة الأخرى */
export function remoteSetJs(k: string, v: unknown): string {
  return (
    'try{window.__gmBridge&&window.__gmBridge.remoteSet(' +
    JSON.stringify(k) +
    ',' +
    JSON.stringify(v) +
    ')}catch(e){console.error(e)};true;'
  );
}

export function parseBridgeMessage(data: string): BridgeMessage | null {
  try {
    const m = JSON.parse(data);
    return m && typeof m === 'object' && typeof m.__gm === 'string' ? (m as BridgeMessage) : null;
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
