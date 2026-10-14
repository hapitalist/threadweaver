"""Emulate the PACKAGED app (Cordova Android: https://localhost, files straight from www/, no Netlify
redirects, a 404 for anything not in the bundle). Cordova injects cordova.js at build time, so a shim
stands in for it: it sets window.cordova, provides a fake CdvPurchase store that records what the app
registers / orders, and fires 'deviceready' - exactly the signals the real plugin gives the app.

Usage: python3 native_emulate.py [www_dir]
"""
import os, sys, json, mimetypes
from playwright.sync_api import sync_playwright

WWW = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "www"))
OUT = os.environ.get("QA_OUT", "/tmp/claude-0/-home-claude-threadweaver/67b627e8-49be-5fa7-a8ce-7e1df1130285/scratchpad/qa")
os.makedirs(OUT, exist_ok=True)
EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
BASE = "https://localhost"

SHIM = r"""
window.__cordovaLoaded = true;
window.cordova = { platformId: 'android', InAppBrowser: { open: function(u){ window.__iab = u; return { addEventListener: function(){} }; } } };
(function(){
  var reg = [], handlers = {};
  var chain = { approved: function(f){ handlers.approved = f; return chain; }, verified: function(f){ handlers.verified = f; return chain; },
                finished: function(){ return chain; }, updated: function(){ return chain; }, productUpdated: function(){ return chain; } };
  function product(id){ var r = reg.filter(function(x){ return x.id === id; })[0]; if (!r) return null;
    return { id: id, canPurchase: true, owned: false, pricing: { price: '$9.99' },
             getOffer: function(){ return { id: id, order: function(){ window.__ordered = id; return Promise.resolve(); } }; } }; }
  window.CdvPurchase = {
    ProductType: { NON_CONSUMABLE: 'non consumable' }, Platform: { APPLE_APPSTORE: 'ios-appstore', GOOGLE_PLAY: 'android-playstore' },
    store: { register: function(r){ reg = reg.concat(r); window.__registered = reg.map(function(x){ return x.id; }); },
             when: function(){ return chain; }, initialize: function(p){ window.__iapInit = p; return Promise.resolve(); },
             update: function(){ return Promise.resolve(); }, get: product, get products(){ return reg.map(function(x){ return product(x.id); }); },
             order: function(o){ window.__ordered = (o && o.id) || o; return Promise.resolve(); },
             restorePurchases: function(){ window.__restored = true; return Promise.resolve(); }, localReceipts: [] }
  };
  setTimeout(function(){ document.dispatchEvent(new Event('deviceready')); }, 60);
})();
"""

def route(r):
    path = r.request.url[len(BASE):].split("?")[0].split("#")[0] or "/"
    if path == "/cordova.js":
        return r.fulfill(status=200, body=SHIM, headers={"Content-Type": "text/javascript"})
    f = os.path.normpath(os.path.join(WWW, path.lstrip("/")))
    if f.startswith(WWW) and os.path.isfile(f):
        ct = "text/javascript" if f.endswith((".js", ".mjs")) else (mimetypes.guess_type(f)[0] or "application/octet-stream")
        return r.fulfill(status=200, body=open(f, "rb").read(), headers={"Content-Type": ct})
    return r.fulfill(status=404, body="", headers={"Content-Type": "text/plain"})   # what the native shell does

res = []
def rec(name, ok, detail=""):
    res.append((name, bool(ok), str(detail)[:240])); print(("  PASS " if ok else "  FAIL ") + name + (f" -- {detail}" if detail else ""), flush=True)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=EXE, args=["--no-sandbox", "--disable-dev-shm-usage"])
    ctx = b.new_context(viewport={"width": 412, "height": 915}, is_mobile=True, has_touch=True, device_scale_factor=2, service_workers="block")
    ctx.route(BASE + "/**", route)
    for host in ("https://thread.wannabepress.com/**",):
        pass
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:150]))
    # 1) cold start on the page config.xml names (<content src=...>), exactly as the shell does
    import re as _re
    cfg = open(os.path.join(WWW, "..", "config.xml")).read()
    start = _re.search(r'<content src="([^"]+)"', cfg).group(1)
    print("  start page from config.xml:", start)
    # backstop: the website landing page, opened inside the app, must forward to the library
    pg.goto(BASE + "/index.html", wait_until="domcontentloaded"); pg.wait_for_timeout(2500)
    rec("index.html inside the app forwards to the library", pg.evaluate("() => !!document.getElementById('shell')"), pg.url)
    pg.goto(BASE + "/" + start, wait_until="domcontentloaded"); pg.wait_for_timeout(3500)
    pg.screenshot(path=f"{OUT}/native-1-start.png")
    st = pg.evaluate("() => ({ url: location.href, title: document.title, shell: !!document.getElementById('shell'), cordova: !!window.__cordovaLoaded })")
    rec("cold start lands in the app library (not the website landing page)", st["shell"], json.dumps(st))
    if not st["shell"]:
        # what a user does on the landing page: tap START READING
        link = pg.evaluate("() => { const a = [...document.querySelectorAll('a.btn')].find(a => /START READING/i.test(a.textContent)); return a ? a.getAttribute('href') : null; }")
        resp = None
        try:
            with pg.expect_navigation(timeout=8000) as nav:
                pg.evaluate("() => [...document.querySelectorAll('a.btn')].find(a => /START READING/i.test(a.textContent)).click()")
            resp = nav.value
        except Exception as e: pass
        pg.wait_for_timeout(2000); pg.screenshot(path=f"{OUT}/native-2-after-start-reading.png")
        rec("tapping START READING opens the app", pg.evaluate("() => !!document.getElementById('shell')"),
            f"href={link} -> {pg.url} status={resp.status if resp else '?'}")
        pg.goto(BASE + "/app.html", wait_until="domcontentloaded")
    pg.wait_for_timeout(4000)
    pg.screenshot(path=f"{OUT}/native-3-app.png")
    s = pg.evaluate("""() => ({ cordova: !!window.__cordovaLoaded, native: document.body.classList.contains('is-native'),
        wall: (() => { const w = document.getElementById('loginWall'); return !!w && getComputedStyle(w).display !== 'none'; })(),
        iapInit: window.__iapInit || null, registered: window.__registered || [], storeLinksShown: (() => { const s = document.getElementById('storeLinks'); return !!s && getComputedStyle(s).display !== 'none'; })() })""")
    rec("app.html loads the native bridge (cordova.js)", s["cordova"], json.dumps(s)[:200])
    rec("app knows it is native (no forced login, Apple/Google rule)", s["native"] and not s["wall"])
    rec("in-app purchase store starts for Google Play", s["iapInit"] == ["android-playstore"], s["iapInit"])
    rec("all 7 products registered with the store", len(s["registered"]) == 7, s["registered"])
    rec("App Store / Google Play download links hidden inside the app", not s["storeLinksShown"])
    if pg.evaluate("() => !!document.getElementById('funWelcome')"): pg.click("#fwSkip")
    pg.click("#btnStore"); pg.wait_for_timeout(700)
    ev = pg.evaluate("() => { const o = [...document.querySelectorAll('#sheet .opt')].find(o => /Unlock Everything/i.test(o.textContent)); return o ? o.textContent.replace(/\\s+/g,' ').trim() : null; }")
    rec("Unlock Everything shows the app-store price $114.99", bool(ev) and "$114.99" in ev, ev)
    pg.screenshot(path=f"{OUT}/native-4-store.png")
    stripe = []
    pg.on("request", lambda r: stripe.append(r.url) if "checkout.stripe.com" in r.url or "/functions/v1/checkout" in r.url else None)
    pg.evaluate("() => { const o = [...document.querySelectorAll('#sheet .opt')].find(o => /Dragon Strife/i.test(o.textContent)); (o.querySelector('button') || o).click(); }")
    pg.wait_for_timeout(2500)
    ordered = pg.evaluate("() => window.__ordered || null")
    rec("buying in the app goes through Google Play billing, not Stripe", bool(ordered) and not stripe, f"ordered={ordered} stripe_calls={len(stripe)}")
    # ---- signed-in, inside the app ----
    pg.evaluate("() => window.closeSheet && closeSheet()")
    pw = os.environ.get("TW_TEST_PW", ""); em = "noheltyr+tw-newdb-test@gmail.com"
    pg.click("#btnSignin"); pg.wait_for_selector("#lwEmail", state="visible", timeout=6000)
    pg.fill("#lwEmail", em); pg.fill("#lwPass", pw); pg.click("#lwGo")
    try:
        pg.wait_for_function("e => (document.getElementById('acctbar')||{}).textContent.includes(e)", arg=em, timeout=15000); ok = True
    except Exception: ok = False
    rec("in-app sign in works", ok)
    pg.wait_for_timeout(3000)
    own = pg.evaluate("() => { const g = (BOOKS||[]).filter(b => !b.free && bookUnlocked(b)); return g.length ? [g[0].file, g[0].title, g[0].id||g[0].file] : null; }")
    rec("purchases sync into the app after sign in", bool(own), own)
    def frame_txt(sub, wait=10):
        best = ""
        for _ in range(wait * 2):
            for f in pg.frames:
                if sub in f.url:
                    try:
                        t = f.evaluate("() => document.body ? document.body.innerText : ''")
                        for c in f.child_frames:
                            try: t += c.evaluate("() => document.body ? document.body.innerText : ''")
                            except Exception: pass
                        if len(t) > len(best): best = t
                    except Exception: pass
            if len(best) > 400: break
            pg.wait_for_timeout(500)
        return best
    if own:
        pg.evaluate("a => openBook(a[0], a[1], a[2])", own); t = frame_txt("reader.html")
        pg.screenshot(path=f"{OUT}/native-5-paid-book.png")
        rec(f"purchased book downloads from the server and opens in the app ({own[1]})", len(t) > 400 and "Could not load" not in t, t[:80].replace("\n", " "))
        pg.evaluate("() => closeHost()"); pg.wait_for_timeout(500)
    free = pg.evaluate("() => { const b = (BOOKS||[]).find(b => b.free); return [b.file, b.title, b.id||b.file]; }")
    pg.evaluate("a => openBook(a[0], a[1], a[2])", free); t = frame_txt("reader.html")
    rec(f"free book opens from the app bundle ({free[1]})", len(t) > 400, t[:60].replace("\n", " "))
    pg.evaluate("() => closeHost()"); pg.wait_for_timeout(500)
    pg.evaluate("() => document.querySelector('[onclick*=\"openComic\"]').click()"); pg.wait_for_timeout(6000)
    imgs = 0
    for f in pg.frames:
        if "comic.html" in f.url:
            try: imgs = f.evaluate("() => [...document.images].filter(i => i.complete && i.naturalWidth > 100).length")
            except Exception: pass
    rec("a comic opens in the app", imgs > 0, f"{imgs} pages")
    pg.evaluate("() => closeHost()"); pg.wait_for_timeout(500)
    pg.evaluate("() => twSerialOpen('pick-novel')"); pg.wait_for_timeout(2500)
    sid = pg.evaluate("() => { const p = document.querySelector('#serialSheet .pick'); const m = p && (p.getAttribute('onclick')||'').match(/twSerialOpen\\('([^']+)'/); return m ? m[1] : null; }")
    pg.evaluate("() => twSerialClose()")
    if sid:
        pg.evaluate("s => twSerialRead(s, 0)", sid); t = frame_txt("serial.html", 8)
        rec("a serial chapter opens in the app", len(t) > 400 and "Sign in to read" not in t, t[:60].replace("\n", " "))
        pg.evaluate("() => closeHost()"); pg.wait_for_timeout(500)
    pg.evaluate("() => openStore()"); pg.wait_for_timeout(500)
    pg.evaluate("() => doRestore()"); pg.wait_for_timeout(3000)
    rec("Restore purchases asks the app store", pg.evaluate("() => !!window.__restored"), pg.evaluate("() => (document.getElementById('sheetMsg')||{}).textContent"))
    pg.evaluate("() => closeSheet()")
    rec("Delete account control present when signed in", pg.evaluate("() => !!document.getElementById('btnDelAcct')"))
    pg.evaluate("() => document.getElementById('btnSignout').click()"); pg.wait_for_timeout(2500)
    s2 = pg.evaluate("() => ({ signin: !!document.getElementById('btnSignin'), wall: (() => { const w = document.getElementById('loginWall'); return !!w && getComputedStyle(w).display !== 'none'; })(), shell: getComputedStyle(document.getElementById('shell')).display !== 'none' })")
    rec("sign out works and the app stays usable signed out (no login wall)", s2["signin"] and not s2["wall"] and s2["shell"], s2)
    pg.screenshot(path=f"{OUT}/native-6-signed-out.png")
    errs2 = [e for e in errs]
    rec("no JS errors across the whole native session", not errs2, "; ".join(errs2[:3]))
    b.close()
fails = [r for r in res if not r[1]]
print(f"\n{len(res) - len(fails)}/{len(res)} passed")
sys.exit(1 if fails else 0)
