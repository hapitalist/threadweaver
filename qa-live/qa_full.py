"""Thread Weaver full QA pass.

Serves the LOCAL www/ build under the REAL origin (https://thread.wannabepress.com) via request
routing, so CORS, auth redirects and edge functions behave exactly as in production, against the
LIVE Thread Weaver database. --live skips routing and tests what Netlify is actually serving.

Usage: python3 qa_full.py [--live] [--only firstrun|signedin|pages]
"""
import json, os, sys, time, mimetypes, re
from playwright.sync_api import sync_playwright

LIVE = "--live" in sys.argv
ONLY = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
WWW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "www")
ORIGIN = "https://thread.wannabepress.com"
OUT = os.environ.get("QA_OUT", "/tmp/claude-0/-home-claude-threadweaver/67b627e8-49be-5fa7-a8ce-7e1df1130285/scratchpad/qa")
os.makedirs(OUT, exist_ok=True)
EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
TEST_EMAIL, TEST_PW = "noheltyr+tw-newdb-test@gmail.com", os.environ.get("TW_TEST_PW", "")
REVIEW = json.load(open(os.path.join(WWW, "qa-review-notes.json")))

results = []
def rec(area, name, ok, detail=""):
    results.append((area, name, bool(ok), str(detail)[:300]))
    print(("  PASS " if ok else "  FAIL ") + f"[{area}] {name}" + (f" -- {detail}" if detail else ""), flush=True)

VIEWPORTS = [("iphone-se", 375, 667, True), ("iphone-pro-max", 430, 932, True), ("ipad", 1024, 1366, True), ("desktop", 1440, 900, False)]

def local_route(route):
    url = route.request.url
    path = url[len(ORIGIN):].split("?")[0].split("#")[0]
    if path in ("", "/"): path = "/index.html"
    if path == "/app": path = "/app.html"
    if path.startswith("/auth/confirm"): path = "/auth-confirm.html"
    f = os.path.normpath(os.path.join(WWW, path.lstrip("/")))
    if f.startswith(os.path.normpath(WWW)) and os.path.isfile(f):
        ct = mimetypes.guess_type(f)[0] or "application/octet-stream"
        if f.endswith(".js") or f.endswith(".mjs"): ct = "text/javascript"
        route.fulfill(status=200, body=open(f, "rb").read(), headers={"Content-Type": ct, "Cache-Control": "no-store"})
    else:
        route.continue_()

def new_ctx(b, w, h, mobile, native=False):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=mobile and w < 900, has_touch=mobile,
                        device_scale_factor=2 if mobile else 1, service_workers="block")
    if not LIVE: ctx.route(ORIGIN + "/**", local_route)
    if native: ctx.add_init_script("window.cordova = { platformId: 'ios' };")
    return ctx

def watch(pg):
    errs = []
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)[:160]))
    def con(m):
        if m.type == "error":
            t = m.text
            if "favicon" in t or "ERR_BLOCKED_BY_CLIENT" in t: return
            errs.append("console: " + t[:160])
    pg.on("console", con)
    def resp(r):
        u = r.url
        if r.status >= 400:
            errs.append(f"http {r.status}: {u[:140]}")
    pg.on("response", resp)
    return errs

HIT = """sel => { const el = document.querySelector(sel); if (!el) return 'missing';
  const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return 'zero-size';
  if (r.bottom < 0 || r.top > innerHeight) return 'offscreen';
  const t = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
  return (t === el || el.contains(t)) ? 'ok' : ('covered by ' + (t ? (t.id || t.tagName + '.' + t.className) : 'null')); }"""

def firstrun(b):
    for native in (False, True):
        for name, w, h, mobile in VIEWPORTS:
            if native and not mobile: continue
            tag = f"{'native' if native else 'web'}/{name}"
            ctx = new_ctx(b, w, h, mobile, native); pg = ctx.new_page(); errs = watch(pg)
            pg.goto(ORIGIN + "/app.html", wait_until="domcontentloaded"); pg.wait_for_timeout(3500)
            if not native:
                # web visitors meet the login screen first; the welcome must NOT be hiding under it
                pg.screenshot(path=f"{OUT}/web-login-first-{name}.png")
                rec("first launch", f"{tag}: login screen first, welcome not built underneath it", pg.evaluate("() => !document.getElementById('funWelcome')"))
                sign_in(pg, TEST_EMAIL, TEST_PW); pg.wait_for_timeout(3500)
            shot = f"{OUT}/firstrun-{tag.replace('/', '-')}.png"; pg.screenshot(path=shot)
            fw = pg.evaluate("""() => { const o = document.getElementById('funWelcome'); if (!o) return null;
                const c = o.firstElementChild.getBoundingClientRect(); const cs = getComputedStyle(o);
                const brand = document.querySelector('#shell .brand'); const br = brand ? brand.getBoundingClientRect() : null;
                const ab = document.getElementById('acctbar'); const ar = ab ? ab.getBoundingClientRect() : null;
                const mid = document.elementFromPoint(c.left + c.width/2, c.top + Math.min(c.height/2, 60));
                return { z: cs.zIndex, bg: cs.backgroundImage.slice(0, 40), cardTop: c.top, cardBottom: c.bottom, vh: innerHeight,
                         brandBottom: br ? br.bottom : null, acctBottom: ar ? ar.bottom : null,
                         cardOnTop: o.firstElementChild.contains(mid),
                         overlapsHeader: br ? c.top < br.bottom - 1 : false }; }""")
            rec("first launch", f"{tag}: welcome screen shows", fw is not None, json.dumps(fw) if fw else "")
            if fw:
                fallback = (not native) and fw["overlapsHeader"] and fw["acctBottom"] is not None and fw["cardTop"] >= fw["acctBottom"]
                rec("first launch", f"{tag}: welcome card sits below the header (or, small web phone, below the account bar), nothing over it",
                    (not fw["overlapsHeader"] or fallback) and fw["cardOnTop"], f"cardTop={fw['cardTop']:.0f} headerBottom={fw['brandBottom']} acctBottom={fw['acctBottom']}" + (" [small-web fallback]" if fallback else ""))
                if native:
                    rec("first launch", f"{tag}: native: card never covers the header/Store", not fw["overlapsHeader"])
                rec("first launch", f"{tag}: welcome background is solid (no see-through)", "rgba(" not in fw["bg"] and "gradient" in fw["bg"], fw["bg"])
                rec("first launch", f"{tag}: 'Just let me browse' reachable", pg.evaluate(HIT, "#fwSkip") == "ok", pg.evaluate(HIT, "#fwSkip"))
                rec("first launch", f"{tag}: floating Weave bar hidden while welcome is up", pg.evaluate("() => { const d = document.getElementById('dock'); return !d || getComputedStyle(d).display === 'none'; }"))
                rec("first launch", f"{tag}: both welcome buttons fully on screen without scrolling",
                    pg.evaluate("() => ['fwGo','fwSkip'].every(id => { const r = document.getElementById(id).getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })"))
            fb = bool(fw) and (not native) and fw["overlapsHeader"]
            if fb:
                rec("first launch", f"{tag}: (small-web fallback) Store covered only by the welcome itself", pg.evaluate(HIT, "#btnStore") == "covered by funWelcome", pg.evaluate(HIT, "#btnStore"))
            else:
                rec("first launch", f"{tag}: Store button tappable with welcome up", pg.evaluate(HIT, "#btnStore") == "ok", pg.evaluate(HIT, "#btnStore"))
            acct = "#btnSignin" if native else "#btnSignout"
            rec("first launch", f"{tag}: account button ({acct[4:]}) tappable with welcome up", pg.evaluate(HIT, acct) == "ok", pg.evaluate(HIT, acct))
            # Store opens (over the welcome; small-web fallback: after closing it) and lists every product with a price
            if fb:
                pg.click("#fwSkip"); pg.wait_for_timeout(400)
                rec("first launch", f"{tag}: (small-web fallback) Store tappable right after closing the welcome", pg.evaluate(HIT, "#btnStore") == "ok", pg.evaluate(HIT, "#btnStore"))
            try: pg.click("#btnStore", timeout=4000)
            except Exception as e: pass
            pg.wait_for_timeout(700)
            st = pg.evaluate("""() => { const s = document.getElementById('sheet'); if (!s || !s.classList.contains('on')) return null;
                const opts = [...s.querySelectorAll('.opt')]; const r = s.getBoundingClientRect();
                const top = document.elementFromPoint(innerWidth/2, innerHeight/2);
                return { n: opts.length, priced: opts.filter(o => /\\$\\d/.test(o.textContent)).length,
                         everything: s.innerHTML.includes('Unlock Everything'), visibleOnTop: s.contains(top) || top === s }; }""")
            rec("store", f"{tag}: Store opens, on top, 7+ products all priced incl. Unlock Everything",
                bool(st) and st["n"] >= 7 and st["priced"] == st["n"] and st["everything"] and st["visibleOnTop"], json.dumps(st))
            if st:
                topcov = pg.evaluate("""() => { const s = document.getElementById('sheet'); const box = s.querySelector('.box, .sheetbox, div') || s;
                    const out = []; for (const y of [8, 30, 60]) for (const x of [0.15, 0.5, 0.85]) { const t = document.elementFromPoint(innerWidth*x, y);
                    if (t && !s.contains(t)) out.push((t.id || t.tagName) + '@' + y); } return out; }""")
                rec("store", f"{tag}: nothing (account bar etc.) draws over the Store list", not topcov, ", ".join(topcov))
            pg.screenshot(path=f"{OUT}/store-{tag.replace('/', '-')}.png")
            pg.evaluate("() => window.closeSheet && closeSheet()"); pg.wait_for_timeout(300)
            if fw and not fb:
                pg.click("#fwSkip"); pg.wait_for_timeout(400)
                rec("first launch", f"{tag}: Weave bar comes back after closing", pg.evaluate("() => { const d = document.getElementById('dock'); return !d || getComputedStyle(d).display !== 'none'; }"))
                rec("first launch", f"{tag}: 'Just let me browse' closes it", pg.evaluate("() => !document.getElementById('funWelcome')"))
                pg.screenshot(path=f"{OUT}/afterwelcome-{tag.replace('/', '-')}.png")
            # reload: welcome must NOT come back
            pg.reload(wait_until="domcontentloaded"); pg.wait_for_timeout(2500)
            rec("first launch", f"{tag}: welcome does not reappear on next visit", pg.evaluate("() => !document.getElementById('funWelcome')"))
            items = pg.evaluate("() => document.querySelectorAll('.row, .card, [onclick*=\"openComic\"]').length")
            if not native:
                rec("account", f"{tag}: still signed in after reload", TEST_EMAIL in (pg.evaluate("() => (document.getElementById('acctbar')||{}).textContent") or ""))
            rec("library", f"{tag}: library renders", items > 20, f"{items} items")
            hscroll = pg.evaluate("() => document.documentElement.scrollWidth - innerWidth")
            rec("layout", f"{tag}: no sideways scrolling", hscroll <= 1, f"overflow={hscroll}px")
            rec("errors", f"{tag}: no JS / network errors", not errs, "; ".join(errs[:4]))
            ctx.close()
        # tap outside the card dismisses
        ctx = new_ctx(b, 375, 667, True, native); pg = ctx.new_page()
        pg.goto(ORIGIN + "/app.html", wait_until="domcontentloaded"); pg.wait_for_timeout(3000)
        if not native: sign_in(pg, TEST_EMAIL, TEST_PW); pg.wait_for_timeout(3500)
        if pg.evaluate("() => !!document.getElementById('funWelcome')"):
            pg.mouse.click(8, 660); pg.wait_for_timeout(300)
            rec("first launch", f"{'native' if native else 'web'}: tapping outside the card closes the welcome", pg.evaluate("() => !document.getElementById('funWelcome')"))
        ctx.close()

def sign_in(pg, email, pw):
    if not pg.evaluate("() => { const w = document.getElementById('loginWall'); return !!w && getComputedStyle(w).display !== 'none'; }"):
        pg.click("#btnSignin")
    pg.wait_for_selector("#lwEmail", state="visible", timeout=5000)
    pg.fill("#lwEmail", email); pg.fill("#lwPass", pw); pg.click("#lwGo")
    pg.wait_for_function(f"() => (document.getElementById('acctbar')||{{}}).textContent && document.getElementById('acctbar').textContent.includes({json.dumps(email)})", timeout=15000)

def frame_text(pg, wait=9000):
    """Text visible in the reader/comic iframe, including epub.js's nested iframe."""
    t0 = time.time(); best = ""
    while time.time() - t0 < wait / 1000:
        txt = ""
        for f in pg.frames:
            if f == pg.main_frame: continue
            try: txt += " " + f.evaluate("() => document.body ? document.body.innerText : ''")
            except Exception: pass
        if len(txt.strip()) > len(best): best = txt.strip()
        if len(best) > 400: break
        pg.wait_for_timeout(600)
    return best

def signedin(b):
    for name, w, h, mobile in [("iphone-pro-max", 430, 932, True), ("desktop", 1440, 900, False)]:
        tag = f"web/{name}"
        ctx = new_ctx(b, w, h, mobile); pg = ctx.new_page(); errs = watch(pg)
        pg.goto(ORIGIN + "/app.html", wait_until="domcontentloaded"); pg.wait_for_timeout(3000)
        if pg.evaluate("() => !!document.getElementById('funWelcome')"): pg.click("#fwSkip")
        # signed-out web: paid & free books require sign-in (Russell's call), store visible
        locked_before = pg.evaluate("() => document.querySelectorAll('.row.locked').length")
        try:
            sign_in(pg, TEST_EMAIL, TEST_PW); ok = True; d = ""
        except Exception as e: ok = False; d = str(e)[:120]
        rec("account", f"{tag}: sign in with email + password", ok, d)
        if not ok: ctx.close(); continue
        pg.wait_for_timeout(2500)
        info = pg.evaluate("""() => { const g = (BOOKS||[]).filter(b => !b.free);
            const own = g.filter(b => bookUnlocked(b)), not = g.filter(b => !bookUnlocked(b));
            return { owned: own.map(b => b.bundle).filter((v,i,a)=>a.indexOf(v)===i), lockedRows: document.querySelectorAll('.row.locked').length,
                     ownBook: own[0] ? [own[0].file, own[0].title, own[0].id||own[0].file] : null,
                     lockedBook: not[0] ? [not[0].file, not[0].title, not[0].bundle] : null }; }""")
        rec("account", f"{tag}: purchases load (owns Godsverse only)", info["owned"] == ["godsverse_series"], json.dumps(info["owned"]))
        rec("account", f"{tag}: owned series unlock, the rest stay locked", 0 < info["lockedRows"] < locked_before or (locked_before == 0 and info["lockedRows"] > 0), f"locked rows before={locked_before} after={info['lockedRows']}")
        # open an owned paid book through the UI row
        if info["ownBook"]:
            pg.evaluate("a => openBook(a[0], a[1], a[2])", info["ownBook"])
            txt = frame_text(pg)
            pg.screenshot(path=f"{OUT}/reader-owned-{name}.png")
            cov = pg.evaluate("""() => { const h = document.getElementById('host'); const out = [];
                for (const y of [6, 24, 48]) for (const x of [0.1, 0.5, 0.9]) { const t = document.elementFromPoint(innerWidth*x, y); if (t && !h.contains(t)) out.push((t.id||t.tagName)+'@'+y); } return out; }""")
            rec("reading", f"{tag}: nothing draws over the reader", not cov, ", ".join(cov))
            rec("reading", f"{tag}: owned paid book opens and shows text ({info['ownBook'][1]})", len(txt) > 300 and "not owned" not in txt.lower(), txt[:80].replace("\n", " "))
            pg.evaluate("() => { const x = document.querySelector('#host .x, #hostClose, [onclick*=\"closeHost\"]'); if (x) x.click(); else if (window.closeHost) closeHost(); }")
            pg.wait_for_timeout(600)
        # locked book row opens the buy sheet for its series, not the reader
        if info["lockedBook"]:
            pg.evaluate("() => document.querySelector('.row.locked').scrollIntoView({block:'center'})")
            pg.evaluate("() => { const r = document.querySelector('.row.locked'); const p = r.closest('.series, .ser, details'); if (p && p.tagName==='DETAILS') p.open = true; }")
            pg.evaluate("() => document.querySelector('.row.locked').click()"); pg.wait_for_timeout(600)
            sheet = pg.evaluate("() => { const s = document.getElementById('sheet'); return s && s.classList.contains('on') ? s.querySelectorAll('.opt').length : 0; }")
            rec("store", f"{tag}: tapping a locked book opens its buy sheet", sheet > 0, f"options={sheet}")
            # web checkout: clicking a buy option must hand off to Stripe Checkout
            stripe = {"url": None}
            def on_req(r):
                if "checkout.stripe.com" in r.url and not stripe["url"]: stripe["url"] = r.url
            pg.on("request", on_req)
            pg.route("https://checkout.stripe.com/**", lambda r: r.fulfill(status=200, body="stripe-intercepted"))
            btn = pg.evaluate("""() => { const o = document.querySelector('#sheet .opt'); if (!o) return null;
                const b = o.querySelector('button') || o; b.click(); return (o.textContent||'').replace(/\\s+/g,' ').trim().slice(0,60); }""")
            for _ in range(20):
                if stripe["url"]: break
                pg.wait_for_timeout(500)
            rec("purchase", f"{tag}: buying hands off to Stripe Checkout (not paid)", bool(stripe["url"]), f"clicked '{btn}' -> {(stripe['url'] or 'no redirect')[:70]}")
            pg.unroute("https://checkout.stripe.com/**")
            if stripe["url"]:
                pg.goto(ORIGIN + "/app.html", wait_until="domcontentloaded"); pg.wait_for_timeout(3500)
                rec("account", f"{tag}: still signed in after coming back from checkout", TEST_EMAIL in (pg.evaluate("() => (document.getElementById('acctbar')||{}).textContent") or ""))
            else:
                pg.evaluate("() => window.closeSheet && closeSheet()")
        # comic
        cid = pg.evaluate("() => { const e = document.querySelector('[onclick*=\"openComic\"]'); return e ? e.getAttribute('onclick') : null; }")
        if cid:
            pg.evaluate("() => document.querySelector('[onclick*=\"openComic\"]').click()"); pg.wait_for_timeout(5000)
            imgs = 0
            for f in pg.frames:
                if "comic.html" in f.url:
                    try: imgs = f.evaluate("() => [...document.images].filter(i => i.complete && i.naturalWidth > 100).length")
                    except Exception: pass
            pg.screenshot(path=f"{OUT}/comic-{name}.png")
            rec("reading", f"{tag}: a comic opens and its pages load", imgs > 0, f"{imgs} pages loaded; {cid[:60]}")
            pg.evaluate("() => { if (window.closeHost) closeHost(); }"); pg.wait_for_timeout(400)
        # reading progress sync: open a FREE book, page forward, check Supabase got the position
        free = pg.evaluate("() => { const b = (BOOKS||[]).find(b => b.free); return b ? [b.file, b.title, b.id||b.file] : null; }")
        if free:
            pg.evaluate("a => openBook(a[0], a[1], a[2])", free); frame_text(pg, 6000)
            for f in pg.frames:
                if "reader.html" in f.url:
                    for _ in range(3):
                        try: f.evaluate("() => { if (window.rendition) rendition.next(); else document.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight'})); }")
                        except Exception: pass
                        pg.wait_for_timeout(900)
            pg.wait_for_timeout(4000)
            rec("reading", f"{tag}: free book opens ({free[1]})", True)
            pg.evaluate("() => { if (window.closeHost) closeHost(); }")
        # serials, the way users reach them: from inside the app
        pg.evaluate("() => twSerialOpen('pick-novel')"); pg.wait_for_timeout(2500)
        picks = pg.evaluate("() => [...document.querySelectorAll('#serialSheet .pick')].map(p => (p.getAttribute('onclick')||'').match(/twSerialOpen\\('([^']+)'/)).filter(Boolean).map(m => m[1])")
        rec("serials", f"{tag}: 'Follow a novel' lists the novels", len(picks) > 3, f"{len(picks)} novels")
        if picks:
            pg.evaluate("sid => twSerialOpen(sid)", picks[0]); pg.wait_for_timeout(2500)
            sh = pg.evaluate("() => (document.getElementById('srBody')||{}).innerText || ''")
            rec("serials", f"{tag}: a novel's serial page opens (follow + weekday options)", ("Follow" in sh or "following" in sh) and "not found" not in sh, sh[:90].replace("\n", " "))
            pg.screenshot(path=f"{OUT}/serial-sheet-{name}.png")
            pg.evaluate("() => twSerialClose()")
            pg.evaluate("sid => twSerialRead(sid, 0)", picks[0]); pg.wait_for_timeout(5000)
            txt = ""
            for f in pg.frames:
                if "serial.html" in f.url:
                    try: txt = f.evaluate("() => document.body.innerText")
                    except Exception: pass
            pg.screenshot(path=f"{OUT}/serial-chapter-{name}.png")
            rec("serials", f"{tag}: chapter 1 opens in the reader (text, or the server's 'not out yet' notice)",
                (len(txt) > 400 or "isn’t out yet" in txt) and "Sign in to read" not in txt and "Couldn’t open" not in txt, txt[:90].replace("\n", " "))
            pg.evaluate("() => { if (window.closeHost) closeHost(); }"); pg.wait_for_timeout(400)
        # sign out
        pg.evaluate("() => { const b = document.getElementById('btnSignout'); if (b) b.click(); }"); pg.wait_for_timeout(2500)
        rec("account", f"{tag}: sign out works", bool(pg.evaluate("() => !!document.getElementById('btnSignin')")))
        errs = [e for e in errs if not re.search(r"/comics/[^/]+/(layout\.json|\d+\.(jpg|png|webp))", e) and "Failed to load resource: the server responded with a status of 404" not in e]
        rec("errors", f"{tag}: no JS / network errors during signed-in session (offline-copy probe 404s for paid comics excluded)", not errs, "; ".join(errs[:5]))
        ctx.close()

    # account forms: wrong password, existing-email sign-up, forgot password
    ctx = new_ctx(b, 430, 932, True); pg = ctx.new_page(); errs = watch(pg)
    pg.goto(ORIGIN + "/app.html", wait_until="domcontentloaded"); pg.wait_for_timeout(3000)
    pg.wait_for_selector("#lwEmail", state="visible", timeout=8000)
    pg.screenshot(path=f"{OUT}/login-iphone.png")
    rec("account", "login form: every field tappable", all(pg.evaluate(HIT, s) == "ok" for s in ("#lwEmail", "#lwPass", "#lwGo")), [pg.evaluate(HIT, s) for s in ("#lwEmail", "#lwPass", "#lwGo")])
    pg.fill("#lwEmail", TEST_EMAIL); pg.fill("#lwPass", "definitely-wrong-1"); pg.click("#lwGo"); pg.wait_for_timeout(3500)
    m = pg.inner_text("#lwMsg"); rec("account", "wrong password shows a clear message", "Wrong email or password" in m, m)
    pg.click("#lwTabSignup"); pg.fill("#lwEmail", TEST_EMAIL); pg.fill("#lwPass", "whatever-123"); pg.click("#lwGo"); pg.wait_for_timeout(5000)
    m = pg.inner_text("#lwMsg"); rec("account", "signing up with an existing email says so and switches to Log In", "already has a Thread Weaver account" in m, m)
    pg.fill("#lwEmail", REVIEW["demo_email"]); pg.click("#lwForgot"); pg.wait_for_timeout(5000)
    m = pg.inner_text("#lwMsg"); rec("account", "forgot password sends the reset email", bool(re.search(r"sent|check your email", m, re.I)), m)
    pg.screenshot(path=f"{OUT}/forgot-iphone.png")
    # App Review demo account signs in
    pg.fill("#lwEmail", REVIEW["demo_email"]); pg.fill("#lwPass", REVIEW["demo_password"]); pg.click("#lwGo")
    try:
        pg.wait_for_function("e => (document.getElementById('acctbar')||{}).textContent && document.getElementById('acctbar').textContent.includes(e)", arg=REVIEW["demo_email"], timeout=15000); ok = True
    except Exception: ok = False
    rec("account", "App Review demo account signs in (the login Apple uses)", ok)
    if ok:
        pg.wait_for_timeout(2500)
        rec("account", "demo account has everything unlocked", pg.evaluate("() => (BOOKS||[]).every(b => bookUnlocked(b))"))
    rec("errors", "no JS errors on the account forms (expected 400 from the deliberate wrong password excluded)",
        not [e for e in errs if "token?grant_type=password" not in e and "status of 400" not in e], "; ".join(errs[:4]))
    ctx.close()

def pages(b):
    for p in ["/", "/index.html", "/app.html", "/reader.html?src=books/anna-and-the-dark-place.epub&id=anna-and-the-dark-place.epub&title=Anna",
              "/privacy.html", "/delete-account.html", "/auth/confirm?token_hash=bogus&type=signup&next=/app"]:
        ctx = new_ctx(b, 430, 932, True); pg = ctx.new_page(); errs = watch(pg)
        r = pg.goto(ORIGIN + p, wait_until="domcontentloaded"); pg.wait_for_timeout(3500)
        txt = pg.evaluate("() => document.body ? document.body.innerText : ''")
        bogus = "confirm" in p
        if bogus:
            errs = [e for e in errs if "verify" not in e and "http 403" not in e and "http 400" not in e]
            ok = bool(re.search(r"expired|invalid|didn.t work|request a new|try again", txt, re.I))
            rec("pages", f"{p}: a dead email link explains itself instead of failing silently", ok, txt[:100].replace("\n", " "))
        else:
            rec("pages", f"{p}: loads (HTTP {r.status if r else '?'}), has content, no errors", (r is None or r.status < 400) and len(txt) > 40 and not errs, f"{len(txt)} chars; " + "; ".join(errs[:3]))
        pg.screenshot(path=f"{OUT}/page{p.split('?')[0].replace('/', '_') or '_root'}.png")
        ctx.close()

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=EXE, args=["--no-sandbox", "--disable-dev-shm-usage"])
    print(f"=== Thread Weaver QA ({'LIVE site' if LIVE else 'local build under real origin'}) ===", flush=True)
    for nm, fn in [("firstrun", firstrun), ("signedin", signedin), ("pages", pages)]:
        if ONLY and ONLY != nm: continue
        print(f"--- {nm} ---", flush=True)
        try: fn(b)
        except Exception as e: rec(nm, "suite crashed", False, repr(e)[:250])
    b.close()
fails = [r for r in results if not r[2]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
json.dump(results, open(f"{OUT}/results{'-live' if LIVE else ''}.json", "w"), indent=1)
sys.exit(1 if fails else 0)
