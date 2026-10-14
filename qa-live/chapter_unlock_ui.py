"""$1 read-the-next-chapter: every screen it appears on, web and app.

Web runs the LOCAL build under the real origin against the LIVE server, signed in as the test reader
(who follows Dragon Strife). Stripe Checkout is intercepted - nothing is paid.
App runs the Android emulation (native_emulate.py's fake store)."""
import os, sys, json, re, mimetypes
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); WWW = os.path.normpath(os.path.join(HERE, "..", "www"))
OUT = os.environ.get("QA_OUT", "/tmp/claude-0/-home-claude-threadweaver/67b627e8-49be-5fa7-a8ce-7e1df1130285/scratchpad/qa")
EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
EM, PW = "noheltyr+tw-newdb-test@gmail.com", os.environ.get("TW_TEST_PW", "")
SHIM = open(os.path.join(HERE, "native_emulate.py")).read().split('SHIM = r"""')[1].split('"""')[0]
res = []
def rec(n, ok, d=""):
    res.append(bool(ok)); print(("  PASS " if ok else "  FAIL ") + n + (f" -- {str(d)[:170]}" if d else ""), flush=True)

def serve(base, native):
    def route(r):
        path = r.request.url[len(base):].split("?")[0].split("#")[0] or "/"
        if native and path == "/cordova.js": return r.fulfill(status=200, body=SHIM, headers={"Content-Type": "text/javascript"})
        if not native and path in ("/", "/app"): path = "/app.html"
        f = os.path.normpath(os.path.join(WWW, path.lstrip("/")))
        if f.startswith(WWW) and os.path.isfile(f):
            ct = "text/javascript" if f.endswith(".js") else (mimetypes.guess_type(f)[0] or "application/octet-stream")
            return r.fulfill(status=200, body=open(f, "rb").read(), headers={"Content-Type": ct})
        return r.fulfill(status=404, body="") if native else r.continue_()
    return route

def frame_text(pg, sub, wait=12):
    for _ in range(wait * 2):
        for f in pg.frames:
            if sub in f.url:
                try:
                    t = f.evaluate("() => document.body.innerText")
                    if len(t) > 60 and "Opening chapter" not in t: return t, f
                except Exception: pass
        pg.wait_for_timeout(500)
    return "", None

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=EXE, args=["--no-sandbox", "--disable-dev-shm-usage"])
    SITE = "https://thread.wannabepress.com"
    # ---------------- WEB ----------------
    ctx = b.new_context(viewport={"width": 430, "height": 932}, is_mobile=True, has_touch=True, service_workers="block")
    if os.environ.get("LIVE") != "1": ctx.route(SITE + "/**", serve(SITE, False))   # LIVE=1: test what Netlify serves
    stripe = []
    ctx.route("https://checkout.stripe.com/**", lambda r: (stripe.append(r.request.url), r.fulfill(status=200, body="<h1>stripe (intercepted)</h1>", headers={"Content-Type": "text/html"})))
    pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)[:150]))
    pg.goto(SITE + "/app.html"); pg.wait_for_selector("#lwEmail", state="visible", timeout=15000)
    pg.fill("#lwEmail", EM); pg.fill("#lwPass", PW); pg.click("#lwGo")
    pg.wait_for_function("e => (document.getElementById('acctbar')||{}).textContent.includes(e)", arg=EM, timeout=15000)
    pg.wait_for_timeout(4000)
    if pg.evaluate("() => !!document.getElementById('funWelcome')"): pg.click("#fwSkip")
    mine = pg.evaluate("() => new Promise(r => setTimeout(() => r(window.twChapterPriceLabel ? window.twChapterPriceLabel() : null), 500))")
    rec("web: price label is $1", mine == "$1", mine)

    # 1) serial sheet
    pg.evaluate("() => twSerialOpen('dragon-strife')"); pg.wait_for_timeout(3500)
    sheet = pg.evaluate("() => document.getElementById('srBody').innerText")
    pg.screenshot(path=OUT + "/chapter-sheet-web.png")
    rec("web: serial sheet offers 'Read it now — $1' and 'Unlock the whole series'", "Read it now — $1" in sheet and "Unlock the whole series" in sheet, sheet[:160].replace("\n", " | "))
    # 2) end of the newest readable chapter
    through = pg.evaluate("() => new Promise(r => { const t = window.twAccessToken(); fetch(window.twFnBase + '/serial', {method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+t}, body: JSON.stringify({action:'mine', tz:new Date().getTimezoneOffset()})}).then(x=>x.json()).then(j => r(j.serials.find(s => s.serial==='dragon-strife').through)); })")
    pg.evaluate("g => { twSerialClose(); twSerialRead('dragon-strife', g); }", through)
    txt, fr = frame_text(pg, "serial.html")
    pg.wait_for_timeout(800)
    end = fr.evaluate("() => document.getElementById('end').innerText") if fr else ""
    pg.screenshot(path=OUT + "/chapter-end-web.png")
    rec(f"web: end of chapter {through+1} offers the next chapter for $1 + the series", "now — $1" in end and "Unlock the whole series" in end, end.replace("\n", " | "))
    # 3) the locked next chapter itself
    pg.evaluate("g => twSerialRead('dragon-strife', g)", through + 1); pg.wait_for_timeout(500)
    txt, fr = frame_text(pg, "serial.html")
    pg.screenshot(path=OUT + "/chapter-locked-web.png")
    rec("web: the locked next chapter offers 'Read this chapter now — $1'", "Read this chapter now — $1" in txt, txt[:150].replace("\n", " | "))
    two = pg.evaluate("g => new Promise(r => fetch(window.twFnBase + '/serial', {method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+window.twAccessToken()}, body: JSON.stringify({action:'chapter', serial:'dragon-strife', g:g, tz:new Date().getTimezoneOffset()})}).then(x=>x.json()).then(r))", through + 2)
    rec("web: a chapter two ahead is NOT sold for $1", two.get("locked") is True and two.get("buy_next") is False, {k: two.get(k) for k in ("locked", "buy_next")})
    # click it -> Stripe
    stripe.clear()
    if fr:
        try: fr.click("text=Read this chapter now", timeout=4000)
        except Exception as e: pass
    for _ in range(30):
        if stripe: break
        pg.wait_for_timeout(500)
    rec("web: tapping it goes to a $1 Stripe Checkout", bool(stripe) and "cs_live_" in stripe[0], (stripe[0][:80] if stripe else "no redirect"))
    # 4) the email's link
    stripe.clear(); pg.goto(SITE + "/app?serial=dragon-strife&unlock=next")
    for _ in range(40):
        if stripe: break
        pg.wait_for_timeout(500)
    rec("web: email link '?unlock=next' goes straight to the $1 checkout", bool(stripe), (stripe[0][:80] if stripe else "no redirect"))
    # 5) coming back from a paid checkout opens the chapter (already-credited chapter = through)
    pg.goto(SITE + f"/app?serial=dragon-strife&read={through}&purchase=chapter"); pg.wait_for_timeout(1500)
    txt, fr = frame_text(pg, "serial.html", 20)
    rec("web: returning from checkout opens the bought chapter", len(txt) > 300 and "Read this chapter now" not in txt, txt[:80].replace("\n", " "))
    rec("web: the return link is cleaned (no purchase=chapter left in the address)", "purchase=chapter" not in pg.url, pg.url)
    # 6) Unlock Everything email link lands on Unlock Everything
    pg.goto(SITE + "/app?buy=everything"); pg.wait_for_timeout(7000)
    ue = pg.evaluate("""() => { const o = [...document.querySelectorAll('#sheet .opt')].find(x => /Unlock Everything/i.test(x.textContent)); if (!o) return null;
        const r = o.getBoundingClientRect(); return { inView: r.top >= 0 && r.bottom <= innerHeight, gold: getComputedStyle(o).borderColor }; }""")
    pg.screenshot(path=OUT + "/unlock-everything-link.png")
    rec("web: 'Unlock Everything' link shows Unlock Everything on screen, highlighted", bool(ue) and ue["inView"] and ue["gold"] != "rgb(46, 39, 66)", ue)
    rec("web: no JS errors", not errs, "; ".join(errs[:3]))
    ctx.close()

    # ---------------- APP (Android emulation) ----------------
    base = "https://localhost"
    ctx = b.new_context(viewport={"width": 412, "height": 915}, is_mobile=True, has_touch=True, service_workers="block")
    ctx.route(base + "/**", serve(base, True))
    pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)[:150]))
    pg.goto(base + "/app.html"); pg.wait_for_timeout(4000)
    if pg.evaluate("() => !!document.getElementById('funWelcome')"): pg.click("#fwSkip")
    reg = pg.evaluate("() => window.__registered || []")
    rec("app: chapter product registered with the store", "threadweaver_chapter" in reg, reg)
    pg.click("#btnSignin"); pg.wait_for_selector("#lwEmail", state="visible")
    pg.fill("#lwEmail", EM); pg.fill("#lwPass", PW); pg.click("#lwGo")
    pg.wait_for_function("e => (document.getElementById('acctbar')||{}).textContent.includes(e)", arg=EM, timeout=15000); pg.wait_for_timeout(4000)
    lab = pg.evaluate("() => window.twChapterPriceLabel()")
    rec("app (Android): price label comes from the store", lab == "$9.99", f"label={lab} (fake store price $9.99)")
    pg.evaluate("() => twSerialOpen('dragon-strife')"); pg.wait_for_timeout(3500)
    sheet = pg.evaluate("() => document.getElementById('srBody').innerText")
    rec("app: serial sheet offers 'Read it now' at the store price", "Read it now — $9.99" in sheet, sheet[:140].replace("\n", " | "))
    pg.evaluate("() => { const b = [...document.querySelectorAll('#srBody .sbtn')].find(x => /Read it now/.test(x.textContent)); b.click(); }"); pg.wait_for_timeout(1500)
    ordered = pg.evaluate("() => window.__ordered || null"); pend = pg.evaluate("() => localStorage.getItem('tw.chapterPending')")
    rec("app: tapping it orders the store's chapter product (not Stripe)", ordered == "threadweaver_chapter" and pend and "dragon-strife" in pend, f"ordered={ordered} pending={pend}")
    # iPhone: server says Apple can't verify yet -> no single-chapter button, the series button stays
    pg.evaluate("() => { window.cordova.platformId = 'ios'; }")
    lab_ios = pg.evaluate("() => window.twChapterPriceLabel()")
    rec("app (iPhone, no Apple secret yet): single-chapter purchase hidden", lab_ios is None, lab_ios)
    pg.evaluate("() => twSerialOpen('dragon-strife')"); pg.wait_for_timeout(3000)
    sheet = pg.evaluate("() => document.getElementById('srBody').innerText")
    rec("app (iPhone): sheet still offers 'Unlock the whole series', no $ chapter button", "Unlock the whole series" in sheet and "Read it now" not in sheet, sheet[:140].replace("\n", " | "))
    rec("app: no JS errors", not errs, "; ".join(errs[:3]))
    b.close()
print(f"\n{sum(res)}/{len(res)} passed"); sys.exit(0 if all(res) else 1)
