"""Story games: every game opens; the free/preview one plays (a choice advances the story); a locked
one routes to the unlock sheet. Runs as the website (signed in) and as the packaged Android app."""
import os, sys, json, importlib.util
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
def load(n):
    spec = importlib.util.spec_from_file_location(n, os.path.join(HERE, n + ".py")); return spec
EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
OUT = os.environ.get("QA_OUT", "/tmp/claude-0/-home-claude-threadweaver/67b627e8-49be-5fa7-a8ce-7e1df1130285/scratchpad/qa")
WWW = os.path.normpath(os.path.join(HERE, "..", "www"))
PW = os.environ.get("TW_TEST_PW", ""); EM = "noheltyr+tw-newdb-test@gmail.com"
import mimetypes
SHIM = open(os.path.join(HERE, "native_emulate.py")).read().split('SHIM = r"""')[1].split('"""')[0]

def serve(base, native):
    def route(r):
        path = r.request.url[len(base):].split("?")[0].split("#")[0] or "/"
        if native and path == "/cordova.js": return r.fulfill(status=200, body=SHIM, headers={"Content-Type": "text/javascript"})
        if not native:
            if path in ("/", ""): path = "/index.html"
            if path == "/app": path = "/app.html"
        f = os.path.normpath(os.path.join(WWW, path.lstrip("/")))
        if f.startswith(WWW) and os.path.isfile(f):
            ct = "text/javascript" if f.endswith((".js", ".mjs")) else (mimetypes.guess_type(f)[0] or "application/octet-stream")
            return r.fulfill(status=200, body=open(f, "rb").read(), headers={"Content-Type": ct})
        if native: return r.fulfill(status=404, body="")
        return r.continue_()
    return route

res = []
def rec(n, ok, d=""):
    res.append((n, bool(ok), str(d)[:200])); print(("  PASS " if ok else "  FAIL ") + n + (f" -- {d}" if d else ""), flush=True)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=EXE, args=["--no-sandbox", "--disable-dev-shm-usage"])
    for mode, base in (("web", "https://thread.wannabepress.com"), ("native", "https://localhost")):
        native = mode == "native"
        ctx = b.new_context(viewport={"width": 430, "height": 932}, is_mobile=True, has_touch=True, service_workers="block")
        ctx.route(base + "/**", serve(base, native))
        pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:150]))
        pg.goto(base + "/app.html", wait_until="domcontentloaded"); pg.wait_for_timeout(3500)
        if not native:
            pg.wait_for_selector("#lwEmail", state="visible"); pg.fill("#lwEmail", EM); pg.fill("#lwPass", PW); pg.click("#lwGo")
            pg.wait_for_function("e => (document.getElementById('acctbar')||{}).textContent.includes(e)", arg=EM, timeout=15000); pg.wait_for_timeout(3000)
        if pg.evaluate("() => !!document.getElementById('funWelcome')"): pg.click("#fwSkip")
        games = pg.evaluate("() => (window.GAMES||[]).map(g => ({ id: g.id, title: g.title, locked: !!g.locked && !isUnlocked(g.id) && !ownsAll(), preview: !!g.preview }))")
        rec(f"{mode}: game list loads", len(games) >= 7, f"{len(games)} games")
        for g in games:
            pg.evaluate("id => openGame(id)", g["id"]); pg.wait_for_timeout(3500)
            sheet = pg.evaluate("() => document.getElementById('sheet').classList.contains('on')")
            if g["locked"] and not g["preview"]:
                rec(f"{mode}: locked game '{g['title']}' opens the unlock sheet", sheet)
                pg.evaluate("() => closeSheet()"); continue
            fr = next((f for f in pg.frames if f != pg.main_frame and f.url not in ("about:blank", "")), None)
            txt = ""; choices = 0
            if fr:
                try:
                    fr.wait_for_load_state("domcontentloaded", timeout=8000); pg.wait_for_timeout(1500)
                    txt = fr.evaluate("() => document.body.innerText"); choices = fr.evaluate("() => [...document.querySelectorAll('button, .choice, [data-choice], a')].filter(e => e.offsetParent && /\\w/.test(e.textContent)).length")
                except Exception as e: txt = "ERR " + str(e)[:80]
            ok = len(txt) > 150 and "Could not load game" not in txt
            rec(f"{mode}: game '{g['title']}' opens{' (free preview)' if g['locked'] else ''}", ok, txt[:70].replace("\n", " "))
            if ok and choices:
                # play: start / first choice, the text must change
                before = txt
                try:
                    fr.evaluate("""() => { const b = [...document.querySelectorAll('button, .choice, [data-choice]')].filter(e => e.offsetParent && /\\w/.test(e.textContent));
                        const pick = b.find(e => !e.disabled && /report|start|begin|play|new game|continue|\u2192/i.test(e.textContent) && !/load|save/i.test(e.textContent)) || b.find(e => !e.disabled && !/load|save/i.test(e.textContent)); pick.click(); }""")
                    pg.wait_for_timeout(1500)
                    after = fr.evaluate("() => document.body.innerText")
                    rec(f"{mode}: '{g['title']}' responds to a choice", after != before, after[:70].replace("\n", " "))
                except Exception as e: rec(f"{mode}: '{g['title']}' responds to a choice", False, str(e)[:100])
            pg.screenshot(path=f"{OUT}/game-{mode}-{g['id']}.png")
            pg.evaluate("() => closeHost()"); pg.wait_for_timeout(600)
        rec(f"{mode}: no JS errors in games", not errs, "; ".join(errs[:3]))
        ctx.close()
    b.close()
f = [r for r in res if not r[1]]; print(f"\n{len(res)-len(f)}/{len(res)} passed"); sys.exit(1 if f else 0)
