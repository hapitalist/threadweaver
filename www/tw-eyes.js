/* tw-eyes.js - Thread Weaver watching what a reader actually gets.  17 November 2026.
 *
 * Ported from Hapitalist's joy-eyes.js (5 Nov 2026) and Command Center's Data Harness 1.6.0. Russell, 5 Nov 2026:
 * "If somebody clicks and nothing answers it's WRONG." - "IF SOMETHING STALLS then it's an error." And 17 Nov 2026: take
 * everything relevant from the Joy Looper and Command Center data harnesses and add it to Thread Weaver.
 *
 * Loaded first on every page (the app, the reader, comics, serials, the landing page, sign-in links, the email pages, the
 * admin pages) and inside every story game. It watches for:
 *   pressed, nothing happened   a press with no change on the page within 6 s
 *   an answer that took 10 s    a press that did answer, but 10 s or more later
 *   pressed again and again     the same thing pressed 4 times inside 3 s
 *   stalled                     "loading / opening / saving..." still showing after 45 s (2 min for AI words)
 *   page stuck loading          a page still on its loading words 25 s after it opened
 *   error pop-up                alert() / confirm() with error words, word for word
 *   error shown                 error words that appear on the page after a press
 *   script error, failed call   a crash in the page's code; a call that got a server error or no answer
 *   broken picture              a picture that did not load
 *   junk on the page            undefined / NaN / null / [object Object] / {{placeholder}} / raw **markdown** / Invalid Date
 *   sideways scroll, cut off button, unreadable button   on a phone-sized screen
 *   slow page                   a page that took more than 6 s to show (reported, never a failure on its own)
 * Each one goes to Thread Weaver's own database (hx_report) with the reader's last 20 presses and pages (labels and pages
 * only - NOTHING TYPED IS EVER READ OR SENT), the device and the build. The same thing seen again is one finding, grouped
 * there by page + step + kind (/admin/harness.html). The harness's own browser says TWDataHarness/1 in its user agent; its
 * reports are kept but never counted as a visitor's error (Command Center 1.6.0).
 *
 * window.__twEyes is what the harness's walker reads after every press: findings, changes, busy().
 * window.twExpect(name, check, ms, tell) lets a page say "after this, this must be true within ms".
 */
(function () {
  "use strict";
  if (window.__twEyes) return;
  var SUPA = "https://nzkgurdmvgkizvzisqxt.supabase.co";
  var ANON = "sb_publishable_XhncOLTTqr5qTs_G9O3Ecw_m6m5fU0f";
  var UA = String(navigator.userAgent || "");
  var HARNESS = /TWDataHarness\//.test(UA);
  var proto = location.protocol, host = location.hostname;
  // a developer's own machine says nothing (unless the harness is walking it)
  var DEV = (host === "127.0.0.1" || (host === "localhost" && !!location.port)) && !HARNESS;

  var DEAD_MS = 6000, SLOW_MS = 10000, LATE_MS = 13000, STALL_MS = 45000, STALL_AI_MS = 120000, OPEN_STALL_MS = 25000, SLOW_PAGE_MS = 6000;
  var BUSY = /(^.{0,30}?\b(loading|opening|saving|sending|creating|submitting|uploading|processing|connecting|checking|updating|finding|fetching|downloading|unlocking|restoring|signing you in|signing in|please wait|one moment|one sec|just a (sec|moment)|generating|writing|thinking|drafting|building|preparing)\b[^\n.…]{0,40}(\.\.\.|…|\. \. \.)\s*$|^[^a-z0-9]{0,3}(loading|please wait|one moment|one sec)\b[^\n]{0,40}$)/i;
  var BUSY_AI = /\b(generating|writing|thinking|drafting|building)\b/i;
  var ERR = /(something went wrong|went wrong|couldn'?t (?:save|load|find|reach|connect|send|open|complete|finish|get|read|sign|do that|unlock|restore)|could not|failed|\berrors?\b|not allowed|permission denied|violates|unable to|is not available|not found|timed out|did not save|didn'?t save|network (?:error|problem|request|connection))/i;
  // 27 Nov 2026: a story game's dice say "6 +0 = 6 vs DC 7 · Failed · Accept the cost" - that is the story, not the site
  var NOT_ERR = /(no errors?|error-free|without error|nothing failed|try again tomorrow|\bvs\.? DC \d+|accept the cost)/i;
  var JUNK = [
    [/(^|[\s>:("'])undefined([\s<.,)"']|$)/, "the word undefined"],
    [/(^|[\s>:("'])NaN([\s<.,%)"']|$)/, "NaN"],
    [/\[object Object\]/, "[object Object]"],
    [/\{\{\s*[\w.]+\s*\}\}/, "an unfilled {{placeholder}}"],
    [/(^|\s)\*\*[^*\n]{1,80}\*\*(\s|[.,]|$)/, "raw **markdown**"],
    [/(^|[\s>:("'])null(?! and void)([\s<.,)"']|$)/, "the word null"],
    [/\bInvalid Date\b/, "Invalid Date"],
    [/\b1 new (notifications|messages|items|replies|chapters)\b/i, "\"1 new ...s\""]
  ];

  var E = window.__twEyes = { findings: [], changes: 0, added: [], trail: [], sent: {}, openedAt: Date.now(), harness: HARNESS };

  function device() {
    var w = Math.min(screen.width || innerWidth, innerWidth || 9999);
    if (/iPad|Tablet/i.test(UA) || (w >= 700 && w < 1000 && "ontouchstart" in window)) return "tablet";
    return (w < 700 || /iPhone|Android.+Mobile/i.test(UA)) ? "phone" : "laptop";
  }
  function browser() {
    var m = UA.match(/(Edg|OPR|Firefox|CriOS|Chrome|Version)\/(\d+)/);
    var n = m ? ({ Edg: "Edge", OPR: "Opera", CriOS: "Chrome iOS", Version: /Safari/.test(UA) ? "Safari" : "Browser" }[m[1]] || m[1]) + " " + m[2] : "browser";
    if (/cordova|is-native/.test(document.documentElement.className + " " + ((document.body && document.body.className) || "")) || proto === "app:" || proto === "file:") n += " (app)";
    return n;
  }
  function build() { return String(window.TW_APP_VERSION || window.TW_VERSION || ""); }
  // the page a finding is on: the path, with the book / comic / serial it is showing
  function pageKey() {
    if (window.__twEyesPage) return String(window.__twEyesPage);
    var p = location.pathname || "/";
    if (/^\/(www\/)?(index\.html)?$/.test(p)) p = "/";
    p = p.replace(/^\/www\//, "/").replace(/^\/app\.html$/, "/app").replace(/^\/auth-confirm\.html$/, "/auth/confirm");
    var q = new URLSearchParams(location.search), keep = q.get("id") || q.get("serial") || q.get("s") || q.get("book");
    if (keep && /reader|comic|serial/.test(p)) p += "?id=" + keep;
    return p.slice(0, 200);
  }
  function clip(s, n) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n || 300); }
  function labelOf(el) {
    if (!el) return "";
    var t = el.getAttribute && (el.getAttribute("aria-label") || el.getAttribute("title"));
    if (!t) t = (el.innerText || el.textContent || "").trim();
    if (!t && el.value && /^(submit|button)$/i.test(el.type || "")) t = el.value;
    if (!t && el.id) t = "#" + el.id;
    if (!t) { var img = el.querySelector && el.querySelector("img[alt]"); if (img) t = img.alt; }
    return clip(t, 60) || (el.tagName || "").toLowerCase();
  }
  function trail(t, what) { E.trail.push(t + ": " + clip(what, 80) + " @ " + pageKey()); if (E.trail.length > 20) E.trail.shift(); }
  function token() {
    try { if (window.twAccessToken) { var t = window.twAccessToken(); if (t) return t; } } catch (e) {}
    return ANON;
  }

  // ---------------------------------------------------------------- the one channel every finding goes through
  function report(kind, step, message, extra) {
    var f = { kind: kind, page: pageKey(), step: clip(step, 160), message: clip(message, 600), at: Date.now() };
    var key = f.page + "|" + f.step + "|" + kind + "|" + (/script error|failed call/.test(kind) ? f.message.slice(0, 80) : "");
    if (E.sent[key]) return; E.sent[key] = 1;
    E.findings.push(f);
    if (DEV || !window.fetch) return;
    var body = { kind: kind, page: f.page, step: f.step, message: f.message, device: device(), browser: browser(), ua: UA.slice(0, 300),
                 build: build(), trail: E.trail.slice(-20), extra: extra || null };
    try {
      _fetch(SUPA + "/rest/v1/rpc/hx_report", { method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json", apikey: ANON, Authorization: "Bearer " + token() },
        body: JSON.stringify({ p: body }) }).catch(function () {});
    } catch (e) {}
  }
  E.report = report;

  // ---------------------------------------------------------------- crashes, failed calls, error pop-ups, broken pictures
  window.addEventListener("error", function (ev) {
    var t = ev && ev.target;
    if (t && t !== window && t.tagName) {
      if (t.tagName === "IMG" && t.src && !/^data:/.test(t.src)) report("broken picture", "", "A picture did not load: " + clip(t.currentSrc || t.src, 200));
      else if (t.tagName === "SCRIPT" && t.src) report("failed call", "", "A script did not load: " + clip(t.src, 200));
      return;
    }
    var m = ev && (ev.message || (ev.error && ev.error.message)) || "Script error";
    if (/^Script error\.?$/.test(m) && !ev.filename) return;        // another site's script, nothing to say
    if (/ResizeObserver loop/.test(m)) return;
    report("script error", "", clip(m, 300) + (ev.filename ? " (" + clip(String(ev.filename).split("/").pop(), 60) + ":" + (ev.lineno || 0) + ")" : ""));
  }, true);
  window.addEventListener("unhandledrejection", function (ev) {
    var r = ev && ev.reason, m = r && (r.message || String(r)) || "A promise failed";
    if (/AbortError|aborted|Load failed$|NetworkError when attempting|Failed to fetch/i.test(m)) return;   // offline and cancels are the failed-call watcher's
    report("script error", "", "Unhandled: " + clip(m, 300));
  });
  var _fetch = window.fetch ? window.fetch.bind(window) : null;
  function shortUrl(u) { try { var x = new URL(u, location.href); return (x.host === location.host ? "" : x.host) + x.pathname; } catch (e) { return clip(u, 120); } }
  if (_fetch) {
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      var mine = /\/rpc\/hx_report/.test(url);
      return _fetch(input, init).then(function (r) {
        if (!mine && r.status >= 500) report("failed call", "", "A call to " + shortUrl(url) + " answered " + r.status);
        return r;
      }, function (err) {
        var aborted = err && (err.name === "AbortError" || /abort/i.test(String(err.message)));
        if (!mine && !aborted && navigator.onLine !== false && !E.leaving) report("failed call", "", "A call to " + shortUrl(url) + " got no answer (" + clip(err && err.message, 80) + ")");
        throw err;
      });
    };
  }
  try {
    var XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__twUrl = u; return XO.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () {
      var x = this;
      x.addEventListener("loadend", function () {
        if (x.status >= 500) report("failed call", "", "A call to " + shortUrl(x.__twUrl) + " answered " + x.status);
        else if (x.status === 0 && !E.leaving && navigator.onLine !== false && !x.__twAborted && /^https?:/.test(String(x.__twUrl || location.href))) report("failed call", "", "A call to " + shortUrl(x.__twUrl) + " got no answer");
      });
      x.addEventListener("abort", function () { x.__twAborted = true; });
      return XS.apply(this, arguments);
    };
  } catch (e) {}
  ["alert", "confirm"].forEach(function (k) {
    var orig = window[k]; if (!orig) return;
    window[k] = function (msg) {
      E.changes++; E.dialog = Date.now();
      var s = String(msg == null ? "" : msg);
      if (ERR.test(s) && !NOT_ERR.test(s)) report("error pop-up", E.lastPress ? E.lastPress.label : "", s);
      return orig.apply(window, arguments);
    };
  });
  var _open = window.open;
  if (_open) window.open = function () { E.changes++; return _open.apply(window, arguments); };

  // ---------------------------------------------------------------- everything the page changes (a press that answers changes something)
  // 27 Nov 2026 (Command Center 1.11.0, from Hapitalist's 19 Nov, "a press nobody answers"): a page helper that adds and takes away a
  // hidden element several times a second made every press look answered, so a dead button was never caught. A change counts as the
  // page answering only when a person could have seen it: what is hidden, off the screen, has no size and no words, is marked
  // data-hx, or is gone again before anyone could look is not an answer.
  function unseen(n) {
    try {
      if (n.nodeType !== 1) { var pe = n.parentElement; return !pe || unseen(pe); }
      if (n.hasAttribute("data-hx") || (n.closest && n.closest("[data-hx]"))) return true;
      if (n.hasAttribute("hidden") || n.getAttribute("aria-hidden") === "true") return true;
      var st = n.getAttribute("style") || "";
      if (/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d])|(left|top)\s*:\s*-\d{3,}px|(clip|clip-path)\s*:/i.test(st)) return true;
      // something taken away: it was seen if it had words or a picture or a control in it (an empty probe was not)
      if (!n.isConnected) return !((n.textContent || "").trim() || (n.querySelector && n.querySelector("img,svg,canvas,video,input,button,iframe")));
      var cs = getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return true;
      var b = n.getBoundingClientRect();
      if (b.width < 1 && b.height < 1 && !(n.textContent || "").trim() && !n.querySelector("img,svg,canvas,video,input,button,iframe")) return true;
    } catch (e) {}
    return false;
  }
  function seeable(m) {
    if (m.type !== "childList") return !(m.target && m.target.nodeType === 1 && (m.target.hasAttribute("data-hx") || (m.target.closest && m.target.closest("[data-hx]"))));
    var nodes = [], k;
    for (k = 0; k < m.addedNodes.length; k++) nodes.push(m.addedNodes[k]);
    for (k = 0; k < m.removedNodes.length; k++) nodes.push(m.removedNodes[k]);
    if (!nodes.length) return false;
    for (k = 0; k < nodes.length; k++) {
      var x = nodes[k];
      if (x.nodeType === 1 && /^(SCRIPT|STYLE|LINK|META)$/.test(x.tagName)) continue;
      if (x.nodeType === 3 && !(x.nodeValue || "").trim()) continue;
      if (!unseen(x)) return true;
    }
    return false;
  }
  function track(list) {
    for (var i = 0; i < list.length; i++) {
      var m = list[i]; if (!seeable(m)) continue; E.changes++;
      if (m.type === "childList") {
        for (var j = 0; j < m.addedNodes.length && E.added.length < 80; j++) {
          var a = m.addedNodes[j], t = (a.nodeType === 3 ? a.nodeValue : (a.innerText || a.textContent || "")) || "";
          if (a.nodeType === 1 && /^(SCRIPT|STYLE)$/.test(a.tagName)) continue;
          if (t.trim()) E.added.push(t.trim().slice(0, 300));
        }
      } else if (m.type === "characterData") {
        var v = (m.target.nodeValue || "").trim(); if (v && E.added.length < 80) E.added.push(v.slice(0, 300));
      } else if (m.type === "attributes" && m.target && m.target.nodeType === 1 && /^(hidden|open|style|class)$/.test(m.attributeName)) {
        var s = (m.target.innerText || "").trim(); if (s && E.added.length < 80 && m.target.offsetParent !== null) E.added.push(s.slice(0, 300));
      }
    }
  }
  function observe() {
    try { new MutationObserver(track).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ["class", "hidden", "open", "style", "aria-expanded", "aria-pressed", "aria-checked", "aria-selected", "disabled", "src", "href", "value"] }); } catch (e) {}
  }
  if (document.documentElement) observe(); else document.addEventListener("readystatechange", observe, { once: true });
  addEventListener("scroll", function () { E.changes++; }, { passive: true, capture: true });
  addEventListener("hashchange", function () { E.changes++; trail("page", location.hash); });
  addEventListener("pagehide", function () { E.leaving = true; });
  addEventListener("beforeunload", function () { E.leaving = true; });
  try { var _ps = history.pushState; history.pushState = function () { E.changes++; var r = _ps.apply(this, arguments); trail("page", location.pathname); return r; }; } catch (e) {}
  // a game, book or comic opened in a frame counts as an answer when it loads
  addEventListener("load", function (ev) { if (ev.target && ev.target.tagName === "IFRAME") E.changes++; }, true);

  // ---------------------------------------------------------------- what is on screen right now
  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false;
    var cs = getComputedStyle(el); return cs.display !== "none" && cs.visibility !== "hidden" && +cs.opacity > 0.05;
  }
  E.busy = function () {
    var out = [];
    try {
      var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null), n, k = 0;
      while ((n = w.nextNode()) && k < 5000) {
        k++; var s = (n.nodeValue || "").trim(); if (!s || s.length > 160 || !BUSY.test(s)) continue;
        var p = n.parentElement; if (!p || /^(SCRIPT|STYLE|NOSCRIPT|OPTION)$/.test(p.tagName) || !visible(p)) continue;
        if (p.closest && p.closest("[data-eyes-ok]")) continue;
        out.push(s);
      }
    } catch (e) {}
    return out;
  };
  function bodyText() { try { return document.body ? document.body.innerText || "" : ""; } catch (e) { return ""; } }
  var junkSeen = {};
  E.scanJunk = function () {
    var t = bodyText(); if (!t) return [];
    var hits = [];
    for (var i = 0; i < JUNK.length; i++) {
      var m = t.match(JUNK[i][0]); if (!m) continue;
      var at = t.indexOf(m[0]), near = clip(t.slice(Math.max(0, at - 60), at + 80), 150);
      hits.push({ what: JUNK[i][1], near: near });
      if (!junkSeen[JUNK[i][1]]) { junkSeen[JUNK[i][1]] = 1; report("junk on the page", "", JUNK[i][1] + " on the page: “" + near + "”"); }
    }
    return hits;
  };
  function lum(rgb) {
    var c = rgb.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function rgba(s) { var m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; var p = m[1].split(",").map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
  function bgOf(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentElement) {
      var cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== "none") return null;   // a picture or gradient: cannot tell, say nothing
      var c = rgba(cs.backgroundColor); if (c && c[3] > 0.9) return c;
    }
    return [255, 255, 255, 1];
  }
  E.scanLayout = function () {
    var out = { sideways: false, cutoff: [], unreadable: [] };
    if (device() !== "phone") return out;
    try {
      var W = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth > W + 2 && getComputedStyle(document.body).overflowX !== "hidden") {
        out.sideways = true; report("sideways scroll", "", "The page is " + document.documentElement.scrollWidth + " px wide on a " + W + " px screen; it scrolls sideways");
      }
      var els = document.querySelectorAll("button, a[href], [role=button], input[type=submit], input[type=button]");
      for (var i = 0; i < els.length && i < 400; i++) {
        var el = els[i]; if (!visible(el)) continue;
        var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        if (inClosedPanel(el)) continue;
        if ((r.right > W + 1 && r.left < W) || (r.left < -1 && r.right > 0)) { var l = labelOf(el); if (out.cutoff.indexOf(l) < 0) { out.cutoff.push(l); report("cut off button", l, "“" + l + "” runs off the edge of a " + W + " px screen"); } }
        var fg = rgba(cs.color), bg = bgOf(el);
        if (fg && bg && fg[3] > 0.5 && (el.innerText || "").trim()) {
          var a = lum(fg), b = lum(bg), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          if (ratio < 2) { var l2 = labelOf(el); if (out.unreadable.indexOf(l2) < 0) { out.unreadable.push(l2); report("unreadable button", l2, "“" + l2 + "” is hard to read (contrast " + ratio.toFixed(1) + ":1)"); } }
        }
      }
    } catch (e) {}
    return out;
  };
  function inClosedPanel(e) {
    for (var q = e.parentElement; q && q !== document.body; q = q.parentElement) {
      var cs = getComputedStyle(q);
      if (cs.position === "fixed" || cs.position === "absolute") {
        var r = q.getBoundingClientRect(); if (r.right <= 0 || r.left >= innerWidth || r.bottom <= 0 || r.top >= innerHeight) return true;
      }
      if (cs.overflowX === "auto" || cs.overflowX === "scroll") return true;   // a row meant to scroll sideways
    }
    return false;
  }

  // ---------------------------------------------------------------- stalls and pages stuck loading
  var busySince = {};
  setInterval(function () {
    if (document.hidden) return;
    var now = Date.now(), seen = {}, list = E.busy();
    list.forEach(function (s) {
      seen[s] = 1; if (!busySince[s]) busySince[s] = (now - E.openedAt < 6500) ? E.openedAt : now;   // on screen since the page opened
      var age = now - busySince[s], limit = BUSY_AI.test(s) ? STALL_AI_MS : STALL_MS;
      if (busySince[s] === E.openedAt && age > OPEN_STALL_MS) report("page stuck loading", "", "“" + clip(s, 80) + "” still showing " + Math.round((now - E.openedAt) / 1000) + " s after the page opened");
      else if (age > limit) report("stalled", E.lastPress ? E.lastPress.label : "", "“" + clip(s, 80) + "” still showing after " + Math.round(age / 1000) + " s");
    });
    for (var k in busySince) if (!seen[k]) delete busySince[k];
  }, 5000);

  // ---------------------------------------------------------------- the press watcher
  var PRESSABLE = "button, a, [role=button], [role=tab], [role=menuitem], summary, label, input[type=submit], input[type=button], input[type=checkbox], input[type=radio], select, [onclick], [data-tap]";
  var recent = [];
  document.addEventListener("click", function (ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest(PRESSABLE) : null;
    if (!el || el.disabled || el.getAttribute("aria-disabled") === "true") return;
    if (el.closest && el.closest("[data-eyes-ok]")) return;               // controls allowed to change nothing (reviewed)
    var label = labelOf(el), now = Date.now();
    trail("press", label);
    // pressed again and again: the same thing 4 times inside 3 s
    recent.push({ el: el, at: now }); recent = recent.filter(function (r) { return now - r.at < 3000; });
    if (recent.filter(function (r) { return r.el === el; }).length >= 4) report("pressed again and again", label, "“" + label + "” was pressed 4 times in 3 seconds - it did not seem to answer");
    var href = el.tagName === "A" ? (el.getAttribute("href") || "") : "";
    if (href && (/^(mailto:|tel:|sms:)/i.test(href) || el.hasAttribute("download") || el.target === "_blank" || (/^https?:/i.test(href) && el.host !== location.host))) return;   // opens elsewhere
    if (/^(checkbox|radio)$/i.test(el.type || "") || el.tagName === "SELECT" || el.tagName === "LABEL") return;   // changes their own state
    var before = { changes: E.changes, url: location.href, added: E.added.length, dialog: E.dialog || 0 };
    E.lastPress = { label: label, at: now };
    setTimeout(function () { check(el, label, before, now, false); }, DEAD_MS);
  }, true);
  function answered(before) { return E.changes !== before.changes || location.href !== before.url || (E.dialog || 0) !== before.dialog; }
  function check(el, label, before, at, late) {
    if (E.leaving) return;
    if (!late) {
      if (answered(before)) { lookForErrors(label, before); return; }
      // still waiting on the server? watch it a little longer before calling it dead
      setTimeout(function () { check(el, label, before, at, true); }, LATE_MS - DEAD_MS);
      before.waited = true; return;
    }
    if (answered(before)) { report("an answer that took 10 seconds or more", label, "“" + label + "” answered, but only after " + Math.round((Date.now() - at) / 1000) + " s"); lookForErrors(label, before); return; }
    if (!document.contains(el) || document.hidden) return;
    report("pressed, nothing happened", label, "“" + label + "” was pressed and nothing on the page changed for " + Math.round(LATE_MS / 1000) + " s");
  }
  function lookForErrors(label, before) {
    var words = E.added.slice(before.added).join(" • ");
    var m = words.match(ERR);
    if (m && !NOT_ERR.test(words)) {
      var i = words.indexOf(m[0]); report("error shown", label, "After pressing “" + label + "” the page said: “" + clip(words.slice(Math.max(0, i - 80), i + 140), 220) + "”");
    }
    setTimeout(function () { E.scanJunk(); E.scanLayout(); }, 1500);
  }

  // ---------------------------------------------------------------- a page's own promise: "after this, this must be true"
  window.twExpect = function (name, check, ms, tell) {
    var start = Date.now();
    (function loop() {
      var ok = false; try { ok = !!check(); } catch (e) {}
      if (ok) return;
      if (Date.now() - start > (ms || 15000)) { report("did not finish", name, tell || (name + " did not finish in " + Math.round((ms || 15000) / 1000) + " s")); return; }
      setTimeout(loop, 500);
    })();
  };

  // ---------------------------------------------------------------- when the page has opened
  function opened() {
    trail("page", location.pathname + location.search.slice(0, 60));
    setTimeout(function () {
      var nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
      var ms = nav ? Math.round(nav.domContentLoadedEventEnd || nav.duration) : 0;
      if (ms > SLOW_PAGE_MS) report("slow page", "", "The page took " + (ms / 1000).toFixed(1) + " s to show");
      if (document.body && !bodyText().trim() && !document.querySelector("img,canvas,iframe,video,svg")) report("blank page", "", "The page opened and shows nothing");
      E.scanJunk(); E.scanLayout();
    }, 3000);
  }
  if (document.readyState === "complete" || document.readyState === "interactive") setTimeout(opened, 0);
  else document.addEventListener("DOMContentLoaded", opened, { once: true });
})();
