/* tw-admin.js - Thread Weaver admin email pages (20 Oct 2026).
 *
 * A small stand-in for Joy Looper's joy-core (Joy.ready) and admin nav, for the pages in /admin/:
 * one-offs.html, sequences.html, newsletter.html, subscribers.html.
 *
 *   TWAdmin.ready(function (client, session) { ... })
 *
 * It makes the Supabase client (TW's vendored /lib/supabase.js, loaded before this file), shows the
 * same email + password sign-in as /admin.html when nobody is signed in, says "This account isn't an
 * admin" for anyone else, and only then hands the page its client. The database checks again on every
 * call (is_tw_admin), so this gate is for clarity, not the lock.
 * It also draws the top nav: Readers, One-off emails, Sequences, Newsletter, Subscribers, Sign out.
 */
(function () {
  'use strict';
  var URL_ = 'https://nzkgurdmvgkizvzisqxt.supabase.co';
  var ANON = 'sb_publishable_XhncOLTTqr5qTs_G9O3Ecw_m6m5fU0f';
  var ADMINS = ['russell@wannabepress.com', 'help@wannabepress.com'];
  var LINKS = [
    ['/admin.html', 'Readers'],
    ['/admin/one-offs.html', 'One-off emails'],
    ['/admin/sequences.html', 'Sequences'],
    ['/admin/newsletter.html', 'Newsletter'],
    ['/admin/subscribers.html', 'Subscribers']
  ];

  var CSS = [
    "@font-face{font-family:'Cinzel';font-style:normal;font-weight:600;font-display:swap;src:url('/fonts/cinzel-latin-600-normal.woff2') format('woff2')}",
    "@font-face{font-family:'Atkinson Hyperlegible';font-weight:400;font-display:swap;src:url('/fonts/atkinson-400.woff2') format('woff2')}",
    "@font-face{font-family:'Atkinson Hyperlegible';font-weight:700;font-display:swap;src:url('/fonts/atkinson-700.woff2') format('woff2')}",
    "body.tw-locked main,body.tw-locked .tw-hide-locked{display:none!important}",
    ".twnav{position:relative;z-index:7000;background:#0e0a16;border-bottom:1px solid #2e2742;font:14px/1.4 'Atkinson Hyperlegible',system-ui,-apple-system,'Segoe UI',sans-serif;color:#e9e1f6}",
    ".twnav .in{max-width:1280px;margin:0 auto;padding:8px 16px;display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px}",
    ".twnav .brand{font-family:'Cinzel',Georgia,serif;color:#e8b53a;font-size:15px;letter-spacing:.5px;white-space:nowrap;margin-right:4px}",
    ".twnav nav{display:flex;flex-wrap:wrap;gap:4px;flex:1 1 auto;min-width:0}",
    ".twnav nav a{color:#cdbfe6;text-decoration:none;padding:6px 10px;border-radius:8px;border:1px solid transparent;white-space:nowrap}",
    ".twnav nav a:hover{border-color:#3a3150;background:#1b1428}",
    ".twnav nav a.on{background:#241b33;border-color:#e8b53a;color:#e8b53a;font-weight:700}",
    ".twnav .me{display:flex;align-items:center;gap:8px;color:#9b91ac;font-size:12px;min-width:0;overflow-wrap:anywhere}",
    ".twnav button{font:inherit;font-size:13px;color:#e9e1f6;background:#241b33;border:1px solid #3a3150;border-radius:8px;padding:6px 12px;cursor:pointer;min-height:34px}",
    ".twgate{max-width:380px;margin:60px auto;padding:0 16px;font:14px/1.45 'Atkinson Hyperlegible',system-ui,sans-serif;color:#e9e1f6}",
    ".twgate .box{background:#16101f;border:1px solid #2e2742;border-radius:14px;padding:22px}",
    ".twgate .kick{font-size:11px;letter-spacing:2px;color:#9b91ac;text-transform:uppercase}",
    ".twgate h1{font-family:'Cinzel',Georgia,serif;color:#e8b53a;font-size:20px;font-weight:600;margin:6px 0 14px}",
    ".twgate input{display:block;width:100%;box-sizing:border-box;margin:6px 0;font:inherit;color:#e9e1f6;background:#1b1428;border:1px solid #2e2742;border-radius:8px;padding:9px 10px;min-height:42px}",
    ".twgate button{display:block;width:100%;margin-top:10px;font:inherit;font-weight:700;border:none;border-radius:8px;padding:10px 12px;cursor:pointer;min-height:44px;background:linear-gradient(150deg,#e8b53a,#b8862a);color:#16121f}",
    ".twgate button.plain{background:#241b33;border:1px solid #3a3150;color:#e9e1f6;font-weight:400}",
    ".twgate .err{color:#ffb3a6;font-size:13px;margin-top:8px;min-height:1em}",
    ".twgate p{color:#9b91ac}",
    "@media (max-width:640px){.twnav .in{padding:6px 10px;gap:4px 8px}.twnav nav a{padding:5px 8px}.twnav .me .addr{display:none}}"
  ].join('\n');

  var callbacks = [], client = null, session = null, started = false, gateEl = null;

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function isAdmin(s) { var e = s && s.user && String(s.user.email || '').toLowerCase(); return !!e && ADMINS.indexOf(e) >= 0; }

  function addStyle() { var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); }

  function drawNav() {
    var old = document.getElementById('twNav'); if (old) old.remove();
    var h = el('header', 'twnav'); h.id = 'twNav';
    var inn = el('div', 'in'); h.appendChild(inn);
    inn.appendChild(el('span', 'brand', 'Thread Weaver admin'));
    var nav = el('nav'); nav.setAttribute('aria-label', 'Admin pages');
    var here = location.pathname.replace(/\/+$/, '');
    LINKS.forEach(function (l) {
      var a = el('a', null, l[1]); a.href = l[0];
      if (here === l[0] || here + '.html' === l[0]) { a.className = 'on'; a.setAttribute('aria-current', 'page'); }
      nav.appendChild(a);
    });
    inn.appendChild(nav);
    if (session) {
      var me = el('span', 'me');
      me.appendChild(el('span', 'addr', session.user && session.user.email || ''));
      var out = el('button', null, 'Sign out'); out.type = 'button'; out.onclick = signOut;
      me.appendChild(out); inn.appendChild(me);
    }
    document.body.insertBefore(h, document.body.firstChild);
  }

  function clearGate() { if (gateEl) { gateEl.remove(); gateEl = null; } }
  function gateBox(kick, title) {
    clearGate();
    gateEl = el('div', 'twgate'); gateEl.id = 'twGate';
    var box = el('div', 'box'); gateEl.appendChild(box);
    box.appendChild(el('div', 'kick', kick));
    box.appendChild(el('h1', null, title));
    var nav = document.getElementById('twNav');
    document.body.insertBefore(gateEl, nav ? nav.nextSibling : document.body.firstChild);
    return box;
  }

  function showSignIn(note) {
    document.body.classList.add('tw-locked');
    var box = gateBox('Thread Weaver admin', 'Sign in');
    var em = el('input'); em.type = 'email'; em.placeholder = 'Email'; em.autocomplete = 'username'; em.id = 'twEm';
    var pw = el('input'); pw.type = 'password'; pw.placeholder = 'Password'; pw.autocomplete = 'current-password'; pw.id = 'twPw';
    var go = el('button', null, 'Sign in'); go.type = 'button'; go.id = 'twSignIn';
    var err = el('div', 'err', note || '');
    box.appendChild(em); box.appendChild(pw); box.appendChild(go); box.appendChild(err);
    go.onclick = function () {
      err.textContent = ''; go.disabled = true; go.textContent = 'Signing in…';
      client.auth.signInWithPassword({ email: em.value.trim(), password: pw.value }).then(function (r) {
        go.disabled = false; go.textContent = 'Sign in';
        if (r.error) { err.textContent = r.error.message; return; }
        session = r.data.session; decide();
      }, function (e) { go.disabled = false; go.textContent = 'Sign in'; err.textContent = (e && e.message) || String(e); });
    };
    pw.onkeydown = function (e) { if (e.key === 'Enter') go.click(); };
    setTimeout(function () { em.focus(); }, 30);
  }

  function showNotAdmin() {
    document.body.classList.add('tw-locked');
    var box = gateBox('Thread Weaver admin', "This account isn't an admin");
    box.appendChild(el('p', null, 'You are signed in as ' + ((session.user && session.user.email) || 'someone') + '. These pages are only for the Wannabe Press admin accounts.'));
    var out = el('button', null, 'Sign out'); out.type = 'button'; out.onclick = signOut; box.appendChild(out);
  }

  function signOut() {
    var done = function () { location.reload(); };
    try { client.auth.signOut().then(done, done); } catch (e) { done(); }
  }

  function decide() {
    drawNav();
    if (!session) { showSignIn(); return; }
    if (!isAdmin(session)) { showNotAdmin(); return; }
    clearGate();
    document.body.classList.remove('tw-locked');
    if (started) return;
    started = true;
    callbacks.splice(0).forEach(run);
  }
  function run(cb) { try { var p = cb(client, session); if (p && p.catch) p.catch(function (e) { console.error(e); }); } catch (e) { console.error(e); } }

  function boot() {
    addStyle();
    document.body.classList.add('tw-locked');
    drawNav();
    if (!window.SBVendor || !window.SBVendor.createClient) {
      var b = gateBox('Thread Weaver admin', "Sign-in didn't load");
      b.appendChild(el('p', null, 'The sign-in code did not load. Reload the page.'));
      return;
    }
    try {
      client = window.SBVendor.createClient(URL_, ANON, { auth: { persistSession: true, detectSessionInUrl: false } });
    } catch (e) {
      var b2 = gateBox('Thread Weaver admin', "Sign-in didn't load"); b2.appendChild(el('p', null, String(e && e.message || e))); return;
    }
    client.auth.onAuthStateChange(function (ev, s) {
      if (s) session = s;
      if (ev === 'SIGNED_OUT' && started) location.reload();
    });
    client.auth.getSession().then(function (r) {
      session = r && r.data ? r.data.session : null;
      decide();
    }, function () { session = null; decide(); });
  }

  window.TWAdmin = {
    ready: function (cb) { if (started) run(cb); else callbacks.push(cb); },
    get client() { return client; },
    get session() { return session; },
    admins: ADMINS.slice(),
    url: URL_
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
