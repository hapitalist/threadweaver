# -*- coding: utf-8 -*-
"""Builds the Wannabe Press site into ../ (static pages). Run: python3 build.py"""
import os, html, json
from data import *

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
E = lambda s: html.escape(str(s), quote=True)
FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Bangers&family=Space+Mono:wght@400;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap" rel="stylesheet">'
V = "2"

def page(path, title, desc, body, og="/img/og.jpg", home=False):
    canon = "https://wannabepress.com" + path
    doc = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{E(title)}</title><meta name="description" content="{E(desc)}">
<link rel="canonical" href="{canon}">
<meta property="og:title" content="{E(title)}"><meta property="og:description" content="{E(desc)}">
<meta property="og:image" content="https://wannabepress.com{og}"><meta property="og:url" content="{canon}"><meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#720a09"><link rel="icon" href="/img/favicon.png" type="image/png"><link rel="apple-touch-icon" href="/img/icon-192.png">
{FONTS}<link rel="stylesheet" href="/site.css?v={V}">
</head><body>
{header()}
<main>
{body}
</main>
{footer()}
{sticky()}
<script src="/quiz.js?v={V}" defer></script>
<script src="/site.js?v={V}" defer></script>
</body></html>"""
    out = os.path.join(ROOT, path.strip("/"), "index.html") if path != "/" else os.path.join(ROOT, "index.html")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "w", encoding="utf-8").write(doc)

def header():
    return f"""<header class="top"><div class="wrap">
<a class="brand" href="/" aria-label="Wannabe Press home"><img class="bee" src="/img/bee-w.webp" alt="" width="600" height="903"><img class="word" src="/img/logo-wannabe.webp" alt="Wannabe" width="900" height="403"><span class="press">PRESS</span></a>
<nav class="nav" aria-label="Main"><a href="/#serials">Read free</a><a href="/#series">Series</a><a href="/standalones/">Standalones</a><a href="/#creators">For creators</a><a href="/about/">About</a><a class="cta" href="{TW}/app?start=free">Open the app</a></nav>
</div></header>"""

def quiz(path_attr=""):
    a = f' data-path="{path_attr}"' if path_attr else ""
    return f'<div class="qz"{a}><div class="qz-stage"></div></div>'

def quizband(label="Not sure where to start?"):
    return f"""<div class="qzband" id="quiz"><div class="wrap">
<div><span class="k">What should I read first?</span><h2>{E(label)}</h2><p class="sub">Four questions. You’ll leave with a place to start and the book to read after it.</p></div>
{quiz()}
</div></div>"""

def footer():
    ser = "".join(f'<li><a href="/series/{s["slug"]}/">{E(s["name"])}</a></li>' for s in SERIES)
    return f"""<footer><div class="wrap">
<div><img class="word" src="/img/logo-wannabe.webp" alt="Wannabe" width="900" height="403"><p style="color:#f0d9d2;font-size:16px;margin:0">Weird books for weird people. Fantasy, horror, comics and story games by USA Today bestselling author Russell Nohelty.</p></div>
<div><h4>The series</h4><ul>{ser}</ul></div>
<div><h4>Read</h4><ul><li><a href="{TW}/">Thread Weaver</a></li><li><a href="/#serials">Read free, chapter by chapter</a></li><li><a href="/standalones/">Standalones</a></li><li><a href="/cosmic-weave/">The Cosmic Weave</a></li><li><a href="/quiz/">What should I read?</a></li><li><a href="{SHOP}/">Shop</a></li></ul></div>
<div><h4>Build</h4><ul><li><a href="https://www.hapitalist.com/">Hapitalist</a></li><li><a href="https://www.hapitalist.com/joy">Talk to Joy</a></li><li><a href="https://consulting.hapitalist.com/">Consulting</a></li><li><a href="https://www.sixfigureauthorexperiment.com/">6FAE podcast</a></li><li><a href="/about/">About Russell</a></li><li><a href="mailto:help@wannabepress.com">help@wannabepress.com</a></li></ul></div>
<div class="legal"><span>© 2026 Wannabe Press</span><a href="{TW}/privacy.html">Privacy</a></div>
</div></footer>"""

def sticky():
    return f"""<div class="sticky" id="sticky" aria-hidden="true"><p>16 books &amp; 5 comics free<br>in Thread Weaver</p><a class="btn" href="{TW}/app?start=free" tabindex="-1">Read free</a></div>"""

def cover(img, title, cls=""):
    if img: return f'<img src="/img/{img}.webp" alt="" loading="lazy" width="420" height="630">'
    return f'<div class="tcover {cls}">{E(title)}</div>'

def series_card(s):
    return f"""<a class="ser" href="/series/{s['slug']}/">{cover(s['img'], s['name'], 'y' if s['slug']=='quest-girls' else '')}<div>
<span class="k">{E(s['meta'])}</span><h3>{E(s['name'])}</h3><p class="hook">“{E(s['tag'])}”</p><span class="go">Explore the series →</span></div></a>"""

def reviews_html(rs):
    out = []
    for r in rs:
        on = f'<a href="{r["page"]}">{E(r["on"])}</a>' if r.get("page") else (f'<a href="{r["url"]}">{E(r["on"])}</a>' if r.get("url") else E(r["on"]))
        out.append(f'<figure class="q"><blockquote>“{E(r["q"])}”</blockquote><figcaption><span class="st">★★★★★</span> {E(r["who"])} · {on}</figcaption></figure>')
    return "".join(out)

def offer():
    return f"""<section class="offer" id="everything"><div class="wrap">
<div><span class="chip">Thread Weaver · the complete collection</span><h2 style="margin:16px 0 16px">Want all of it? Own all of it.</h2>
<p style="font-size:20px">Every series, standalone, comic and story game in one app, plus DRM-free files you keep forever. Paid once. No subscription. Unlocks on every device you sign in on.</p>
<div class="badges"><a href="https://apps.apple.com/us/app/wannabe-press-thread-weaver/id6785677915"> App Store</a><a href="https://play.google.com/store/apps/details?id=com.russellnohelty.threadweaver">▶ Google Play</a><a href="{TW}/">On the web</a></div></div>
<div class="ticket"><span class="k">Everything</span><div class="price">$99.99</div><span class="was">$165 for the series alone</span>
<ul><li>49 novels &amp; 13 comics</li><li>7 choose-your-path story games</li><li>150+ DRM-free ebooks &amp; audiobooks to keep</li><li>Reads offline on phone, tablet and computer</li></ul>
<a class="btn red" href="{TW}/app?buy=everything">Get everything — $99.99</a><p class="fine">One time · secure checkout by Stripe · <a href="{TW}/app?start=free">or start free</a></p></div>
</div></section>"""

def signup():
    return """<section class="signup" id="signup"><div class="wrap">
<div><span class="chip">Free · every Saturday</span><h2 style="margin:16px 0 14px">A new chapter in your inbox every Saturday.</h2>
<p style="font-size:19px;color:var(--ink2)">Join 14,000+ readers on the Wannabe Press newsletter. Serialized novels and new releases, straight to your inbox.</p>
<div class="freebook"><img src="/img/change.webp" alt="" loading="lazy" width="420" height="630"><p>Want a whole book right now? <a class="link" href="https://dl.bookfunnel.com/zdyn1info6">Get <em>Change</em> free</a></p></div></div>
<div class="formcard"><iframe src="https://wannabepress.substack.com/embed" title="Subscribe to the Wannabe Press newsletter" loading="lazy"></iframe></div>
</div></section>"""

# ------------------------------------------------------------------ home
def build_home():
    feat = SERIES_BY["quest-girls"]
    serial_cards = [
      f'<a class="scard feat" href="{tw_serial("quest-girls")}"><span class="k">App exclusive · newest series</span><h3>Quest Girls</h3><p>A cursed quest-guide and a runaway princess, through Fairy and Hell. F*ck Fairy is free, and the whole series comes out one chapter at a time on the day you pick.</p><span class="go">Follow Quest Girls free →</span></a>']
    for slug in ("godsverse", "obsidian-spindle", "dragon-strife", "wonderland"):
        s = SERIES_BY[slug]
        serial_cards.append(f'<a class="scard" href="{tw_serial(s["serial"])}"><span class="k">{E(s["meta"])}</span><h3>{E(s["name"])}</h3><p>“{E(s["tag"])}”</p><span class="go">Follow free →</span></a>')
    serial_cards.append(f'<a class="scard" href="/standalones/"><span class="k">Any standalone</span><h3>Every book, a serial</h3><p>Every standalone in the app can be followed the same way: one chapter a week, free.</p><span class="go">Pick a standalone →</span></a>')
    serial_cards.append('<a class="scard mail" id="weekCard" href="https://wannabepress.substack.com/p/time-chapter-37"><span class="k">By email · every Saturday</span><h3 id="weekTitle">Time — Chapter 37</h3><p id="weekLine">The newest Godsverse novel, a chapter a week in your inbox.</p><span class="go">Read this week’s chapter →</span></a>')

    weave = "".join(series_card(s) for s in SERIES if s["weave"])
    outside = "".join(series_card(s) for s in SERIES if not s["weave"])
    shelf = "".join(f'<a class="cv" href="/books/{b}/">{cover(BOOK_IMG[b], BOOKS[b]["title"])}<span class="t">{E(BOOKS[b]["title"])}</span><span class="s">{"Cosmic Weave · " if BOOKS[b]["weave"] else ""}Free in the app</span></a>' for b in BOOK_ORDER)
    cbooks = "".join(f'<a class="cv" href="{b["url"]}">{cover(b["img"], b["title"])}<span class="t">{E(b["title"])}</span><span class="s">{E(b["note"])}</span></a>' for b in CREATOR_BOOKS)

    body = f"""
<section class="hero" aria-labelledby="h1"><div class="wrap">
<div><span class="chip">Wannabe Press · Russell Nohelty</span>
<h1 id="h1" style="margin-top:14px">Weird books for <span>weird people.</span></h1>
<p class="lede">Gods who are jerks, fairy tales with teeth, dragons, monster hunters and Lovecraft, from <b>USA Today bestselling author Russell Nohelty</b>. Most of it is free to start.</p>
<div class="proof"><span><b>★ 4.3</b> on 632 Goodreads reviews</span><span><b>14,000+</b> readers</span><span><b>50+</b> Kickstarters</span></div></div>
<div id="quiz"><img class="beebig" src="/img/bee-w.webp" alt="" width="600" height="903"><span class="k">What should I read first?</span><h2 class="qz-title" style="font-size:38px;text-shadow:2px 2px 0 var(--bee);margin:2px 0 12px">Find your first book.</h2>{quiz()}</div>
</div></section>

<section id="serials"><div class="wrap">
<div class="head"><div><span class="k">Read free, chapter by chapter</span><h2>Start any series free.</h2></div>
<p>In Thread Weaver, every series and standalone can be followed as a free serial: one chapter a week, on the day you pick. Own the series and you skip the wait.</p></div>
<div class="serials">{''.join(serial_cards)}</div>
</div></section>

<section id="series"><div class="wrap">
<div class="head"><div><span class="k">The series</span><h2>Pick your world.</h2></div><p>Most of my series are threads in one shared universe, the Cosmic Weave. Read enough of them and you start to see where the threads cross.</p></div>
<div class="sgrid">{weave}</div>
<div class="sub2"><span class="k">Outside the Weave</span></div>
<div class="sgrid">{outside}</div>
<div class="sub2"><span class="k">Standalones · free in Thread Weaver</span></div>
<div class="shelf">{shelf}</div>
<p style="margin-top:16px"><a class="link" href="/standalones/">All standalones, comics and more</a> &nbsp; <a class="link" href="/cosmic-weave/">What is the Cosmic Weave?</a></p>
</div></section>

{offer()}

<section id="reviews"><div class="wrap">
<div class="head"><div><span class="k">What readers say</span><h2>Five stars, their words.</h2></div></div>
<div class="quotes">{reviews_html(REVIEWS)}</div>
<p style="font-family:var(--mono);font-size:12px;margin-top:20px;color:var(--ink2)">Reader reviews from Goodreads · 4.3 average across 632 reviews</p>
</div></section>

<section class="creators" id="creators"><div class="wrap">
<div class="head"><div><span class="k">For creators</span><h2>Business clarity for chaotic creators.</h2></div>
<p>Fifty-plus Kickstarters and a whole independent press, turned into frameworks you can use. Hapitalist is where Russell teaches creatives to grow in the way their brains actually work.</p></div>
<div class="cvgrid">{cbooks}</div>
<div class="joy"><div><h3>Stuck? Ask Joy.</h3><p>Joy is a coach built on Russell's frameworks. Talk to her free, then join Hapitalist when you want the full toolkit.</p></div>
<div class="b"><a class="btn" href="https://www.hapitalist.com/joy">Talk to Joy free</a><a class="btn alt" href="https://www.hapitalist.com/">Enter Hapitalist</a></div></div>
</div></section>

<section class="about"><div class="wrap">
<div class="polaroid"><img src="/img/russell-sdcc.webp" alt="Russell Nohelty at his San Diego Comic-Con panel" loading="lazy" width="900" height="900"></div>
<div><span class="k">The guy behind the press</span><h2 style="margin:8px 0 14px">Hi, I'm Russell.</h2>
<p>I’m a USA Today bestselling author of fast-paced action-adventure fantasy with a lot of humor. I’ve written 45+ novels plus comics, nonfiction and children’s books, and I run Wannabe Press, a publisher that makes weird books for weird people.</p>
<ul class="facts"><li>50+ Kickstarter campaigns</li><li>Co-founded Writer MBA</li><li>Co-host of the 6FAE podcast</li><li>Head unicorn at Hapitalist</li><li>120+ talks at 60+ conferences</li><li>Based in Los Angeles</li></ul>
<div class="links"><a class="link" href="/about/">Full bio</a><a class="link" href="https://consulting.hapitalist.com/">Consulting</a><a class="link" href="{SHOP}/">Shop</a></div></div>
</div></section>

{signup()}
"""
    page("/", "Wannabe Press — Weird books for weird people, by Russell Nohelty",
         "Fantasy, horror, comics and story games by USA Today bestselling author Russell Nohelty. Take the quiz, then read free in Thread Weaver, one chapter at a time.", body, home=True)

# ------------------------------------------------------------------ series pages
def build_series(s):
    tw_items = []
    if not s.get("no_tw"):
        tw_items.append(f'<li><a href="{tw_book(s["books"][0]["tw"]) if s["books"][0].get("tw") else TW+"/app"}">Read on Thread Weaver</a></li>')
        if s.get("unlock"):
            tw_items.append(f'<li>{"<a href=" + chr(34) + TW + "/app?buy=" + s["bundle"] + chr(34) + ">" + E(s["unlock"]) + "</a>" if s.get("bundle") else E(s["unlock"])}</li>')
        if s.get("serial"):
            tw_items.append(f'<li><a href="{tw_serial(s["serial"])}">Read it free as a weekly serial, one chapter a week</a></li>')
        tw_items.append(f'<li><a href="{TW}/app?buy=everything">Get every series, comic and game in the Complete Collection · $99.99</a></li>')
    twbox = f'<div class="wbox tw"><span class="k">Thread Weaver</span><h3>Read it in the app</h3><ul>{"".join(tw_items)}</ul><a class="btn red" href="{tw_serial(s["serial"]) if s.get("serial") else (tw_book(s["books"][0]["tw"]) if s["books"][0].get("tw") else TW+"/app")}">{"Start free, chapter by chapter" if s.get("serial") else "Open Thread Weaver"}</a></div>' if not s.get("no_tw") else ""
    if s["shop"]:
        items = "".join(f'<a class="pitem" href="{p["u"]}"><i>{E(p["p"])}</i><b>{E(p["t"])}</b><span>{E(p["d"])}</span></a>' for p in s["shop"])
        shopbox = f'<div class="wbox"><span class="k">Buy direct from me</span><h3>Bundles &amp; bonuses</h3><p style="color:var(--ink2)">Bundles and bonuses you can only get from me.</p>{items}</div>'
    else:
        shopbox = f'<div class="wbox"><span class="k">Only in the app</span><h3>App exclusive</h3><p>{E(s.get("shop_note",""))}</p></div>'

    ctas = []
    if s.get("serial"): ctas.append(f'<a class="btn" href="{tw_serial(s["serial"])}">Read free, chapter by chapter</a>')
    elif not s.get("no_tw"): ctas.append(f'<a class="btn" href="{TW}/app">Read on Thread Weaver</a>')
    if s.get("shop_main"): ctas.append(f'<a class="btn alt" href="{s["shop_main"]}">Buy from my shop</a>')
    st = s["start"]
    order = ""
    for b in s["books"]:
        read = ""
        if b.get("tw"):
            read = f'<a class="r" href="{tw_book(b["tw"])}">{"Read free" if b.get("free") else "Read in the app"}</a>'
        order += f'<div class="obook">{cover(b.get("img"), b["title"], "y" if s["slug"]=="quest-girls" else "")}<div><span class="k">{E(b["label"])}</span><b>{E(b["title"])}</b>{"<p>"+E(b["hook"])+"</p>" if b.get("hook") else ""}{read}</div></div>'
    comics = ""
    if s.get("comics"):
        comics = '<div class="sub2"><span class="k">The comics</span></div><div class="order">' + "".join(
            f'<div class="obook">{cover(c["img"], c["title"])}<div><span class="k">Comic</span><b>{E(c["title"])}</b><p>{E(c["hook"])}</p></div></div>' for c in s["comics"]) + '</div>'
    longb = ""
    if s.get("long"):
        longb = '<section><div class="wrap"><div class="head"><div><span class="k">Book 1 · F*ck Fairy</span><h2>A cursed con artist. A runaway princess.</h2></div></div><div class="longblurb">' + "".join(f"<p>{E(p)}</p>" for p in s["long"]) + f'<a class="btn" href="{tw_book("quest-girls-01-fuck-fairy")}">Read F*ck Fairy free</a></div></div></section>'
    also = ""
    if s.get("also"):
        a = s["also"]
        also = f'<div class="sub2"><span class="k">Also set in the Godsverse</span></div><div class="shelf"><a class="cv" href="{a["url"]}">{cover(a["img"], a["title"])}<span class="t">{E(a["title"])}</span><span class="s">{E(a["kind"])} · free in the app</span></a></div>'
    revs = f'<div class="sub2"><span class="k">What readers say</span></div><div class="quotes">{reviews_html(s["reviews"])}</div>' if s["reviews"] else ""
    more = "".join(series_card(o) for o in SERIES if o["slug"] != s["slug"])
    body = f"""{quizband("Is this your series? Find out.")}
<section class="phero"><div class="wrap">
<div class="art">{cover(s['img'], s['name'], 'y' if s['slug']=='quest-girls' else '')}</div>
<div><div class="crumbs"><a href="/#series">All series</a> / {"Part of the Cosmic Weave" if s["weave"] else "Outside the Weave"}</div>
<p class="tag">“{E(s['tag'])}”</p><h1>{E(s['name'])}</h1><div class="meta">{E(s['meta'])}</div>
<div class="desc">{''.join(f'<p>{E(p)}</p>' for p in s['desc'])}</div>
<div class="ctas">{''.join(ctas)}</div>
<div class="startbox"><div><span class="k">Start with</span><b>{E(st['title'])}</b><p>{E(st['note'])}</p></div><a class="btn" href="{st['url']}" style="margin-left:auto">{E(st['btn'])}</a></div>
</div></div></section>
{longb}
<section><div class="wrap">
<div class="head"><div><span class="k">Reading order · {E(s['order_label'])}</span><h2>Read them in this order.</h2></div></div>
<div class="order">{order}</div>{comics}{also}{revs}
</div></section>
<section><div class="wrap"><div class="head"><div><span class="k">Where to get it</span><h2>Read it your way.</h2></div></div>
<div class="where">{twbox}{shopbox}</div></div></section>
{offer() if not s.get("no_tw") else ""}
<section><div class="wrap"><div class="head"><div><span class="k">More series</span><h2>Keep going.</h2></div></div><div class="sgrid">{more}</div></div></section>
{signup()}"""
    page(f"/series/{s['slug']}/", f"{s['name']} · Wannabe Press", f"{s['tag']} {s['meta']} by Russell Nohelty.", body,
         og=f"/img/{s['img']}.webp" if s["img"] else "/img/og.jpg")

# ------------------------------------------------------------------ book pages
def build_book(slug):
    b = BOOKS[slug]
    others = [o for o in BOOK_ORDER if o != slug][:6]
    more = "".join(f'<a class="cv" href="/books/{o}/">{cover(BOOK_IMG[o], BOOKS[o]["title"])}<span class="t">{E(BOOKS[o]["title"])}</span><span class="s">{E(BOOKS[o]["kind"].replace("Novel · ",""))}</span></a>' for o in others)
    body = f"""{quizband("Is this your book? Find out.")}
<section class="phero"><div class="wrap">
<div class="art">{cover(BOOK_IMG[slug], b['title'])}</div>
<div><div class="crumbs"><a href="/standalones/">Standalones</a> / {"Part of the Cosmic Weave" if b["weave"] else "Outside the Weave"}</div>
<h1>{E(b['title'])}</h1><div class="meta">{E(b['kind'])}</div>
<p class="tag">“{E(b['hook'])}”</p>
<div class="longblurb">{''.join(f'<p>{E(p)}</p>' for p in b['blurb'])}</div>
<div class="where" style="margin-top:24px">
<div class="wbox tw"><span class="k">Free on Thread Weaver</span><h3>Read it free</h3><a class="btn red" href="{tw_book(b['tw'])}">Read it free</a>
<ul style="margin-top:14px"><li><a href="{tw_serial(b['tw'])}">Or read it as a weekly serial, one chapter a week</a></li><li><a href="{TW}/app?buy=everything">Or get everything in the Complete Collection · $99.99</a></li></ul></div>
<div class="wbox"><span class="k">Buy direct from me</span><h3>{E(b['price'])}</h3><a class="btn alt" href="{shop(SHOP_SLUG[slug])}">Go to the shop</a></div>
</div></div></div></section>
<section><div class="wrap"><div class="head"><div><span class="k">More standalones</span><h2>Keep reading.</h2></div><a class="link" href="/standalones/">See them all →</a></div><div class="shelf">{more}</div></div></section>
{signup()}"""
    page(f"/books/{slug}/", f"{b['title']} · Wannabe Press", f"{b['hook']} {b['kind']} by Russell Nohelty, free in Thread Weaver.", body, og=f"/img/{BOOK_IMG[slug]}.webp")

def build_standalones():
    def card_book(o):
        b = BOOKS[o]
        return f'<a class="cv" href="/books/{o}/">{cover(BOOK_IMG[o], b["title"])}<span class="t">{E(b["title"])}</span><span class="s">{E(b["kind"].replace("Novel · ",""))} · free</span></a>'
    def card_other(o):
        return f'<a class="cv" href="{o["url"]}">{cover(o["img"], o["title"])}<span class="t">{E(o["title"])}</span><span class="s">{E(o["kind"])}{" · free" if o.get("free") else ""}</span></a>'
    weave = "".join(card_book(o) for o in BOOK_ORDER if BOOKS[o]["weave"]) + "".join(card_other(o) for o in OTHER_STANDALONES if o["weave"])
    out = "".join(card_book(o) for o in BOOK_ORDER if not BOOKS[o]["weave"]) + "".join(card_other(o) for o in OTHER_STANDALONES if not o["weave"])
    body = f"""{quizband()}
<section class="phero" style="padding-bottom:30px"><div class="wrap" style="grid-template-columns:1fr">
<div><div class="crumbs"><a href="/">Home</a> / Standalones</div><h1>Standalones</h1>
<p style="max-width:40em">Full novels and novellas that stand on their own, plus comics, a short story collection and a picture book. The ones tagged Cosmic Weave are threads in the same universe as my series. Most are free to read in Thread Weaver, and every one can be followed as a free serial, one chapter a week.</p>
<div class="ctas"><a class="btn" href="{TW}/app?start=free">Read them free in Thread Weaver</a></div></div></div></section>
<section><div class="wrap"><div class="head"><div><span class="k">The Cosmic Weave</span><h2>In the Cosmic Weave</h2></div><a class="link" href="/cosmic-weave/">What is the Cosmic Weave? →</a></div><div class="cvgrid">{weave}</div></div></section>
<section><div class="wrap"><div class="head"><div><span class="k">Outside the Weave</span><h2>Outside the Weave</h2></div></div><div class="cvgrid">{out}</div></div></section>
{signup()}"""
    page("/standalones/", "Standalones · Wannabe Press", "Standalone novels, comics and more by Russell Nohelty. Most are free in Thread Weaver.", body)

def build_weave():
    ser = "".join(series_card(s) for s in SERIES if s["weave"])
    sb = "".join(f'<a class="cv" href="/books/{o}/">{cover(BOOK_IMG[o], BOOKS[o]["title"])}<span class="t">{E(BOOKS[o]["title"])}</span><span class="s">{E(BOOKS[o]["kind"].replace("Novel · ",""))}</span></a>' for o in BOOK_ORDER if BOOKS[o]["weave"])
    sb += "".join(f'<a class="cv" href="{o["url"]}">{cover(o["img"], o["title"])}<span class="t">{E(o["title"])}</span><span class="s">{E(o["kind"])}</span></a>' for o in OTHER_STANDALONES if o["weave"])
    body = f"""{quizband("Find your first thread.")}
<section class="phero" style="padding-bottom:30px"><div class="wrap" style="grid-template-columns:1fr">
<div><div class="crumbs"><a href="/">Home</a> / The Cosmic Weave</div><h1>The Cosmic Weave</h1>
<p style="max-width:40em">Most of my series and many of my standalones are threads in the same universe. Gods, fairy tales, dragons, monster hunters and a karmic anomaly named Albert Ross all live here. Read enough of them and you start to see where the threads cross.</p>
<p style="max-width:40em">In Thread Weaver, the Weave is a living codex of hundreds of secrets that unlock as you read.</p>
<div class="ctas"><a class="btn" href="{TW}/app?open=codex">Explore the Weave</a></div></div></div></section>
<section><div class="wrap"><div class="head"><div><span class="k">The series</span><h2>The series</h2></div></div><div class="sgrid">{ser}</div></div></section>
<section><div class="wrap"><div class="head"><div><span class="k">The standalones</span><h2>The standalones</h2></div></div><div class="cvgrid">{sb}</div></div></section>
{signup()}"""
    page("/cosmic-weave/", "The Cosmic Weave · Wannabe Press", "One shared universe of gods, fairy tales, dragons and monster hunters, by Russell Nohelty.", body)

def build_quiz():
    body = f"""<section class="hero" style="border-bottom:4px solid var(--ink)"><div class="wrap" style="grid-template-columns:1fr;max-width:820px">
<div><span class="chip">What should I read first?</span><h1 style="margin:14px 0 8px;font-size:clamp(48px,7vw,84px)">Let’s find your first book.</h1>
<p class="lede">Four questions. You’ll leave with a place to start and the book to read after it.</p>{quiz()}</div></div></section>
{signup()}"""
    page("/quiz/", "What Should I Read First? · Wannabe Press", "Four questions to find your first Russell Nohelty book.", body)

def build_about():
    facts = {}
    for line in open(os.path.join(os.path.dirname(__file__), "about.txt"), encoding="utf-8"):
        k, _, v = line.strip().partition(": ")
        facts[k] = v
    groups = ""
    for g in ("Writing & publishing", "Business & community", "Speaking & media", "Film, TV & audio"):
        groups += f'<div class="wbox"><span class="k">Career highlights</span><h3>{E(g)}</h3><ul>' + "".join(f"<li>{E(x)}</li>" for x in facts[g].split(" | ")) + "</ul></div>"
    body = f"""{quizband()}
<section class="about"><div class="wrap">
<div class="polaroid"><img src="/img/russell-sdcc.webp" alt="Russell Nohelty at his San Diego Comic-Con panel" width="900" height="900"></div>
<div><div class="crumbs"><a href="/">Home</a> / Bio</div><h1 style="font-size:clamp(48px,6vw,80px);text-shadow:4px 4px 0 var(--ink);margin-bottom:16px">About Russell</h1>
<p>{E(facts['P1'])}</p><p>{E(facts['P2'])}</p><p>{E(facts['P3'])}</p>
<p style="font-style:italic;font-size:21px">“One of the best writers of our time.” <span style="font-style:normal;font-family:var(--mono);font-size:13px">— Somebody, probably</span></p>
<div class="links"><a class="link" href="https://www.hapitalist.com/">Hapitalist</a><a class="link" href="https://consulting.hapitalist.com/">Consulting</a><a class="link" href="https://www.sixfigureauthorexperiment.com/">6FAE Podcast</a><a class="link" href="{SHOP}/">Shop</a></div></div>
</div></section>
<section><div class="wrap"><div class="where">{groups}</div></div></section>
{signup()}"""
    page("/about/", "About Russell Nohelty · Wannabe Press", "USA Today bestselling author Russell Nohelty, publisher at Wannabe Press.", body)

if __name__ == "__main__":
    build_home()
    for s in SERIES: build_series(s)
    for b in BOOK_ORDER: build_book(b)
    build_standalones(); build_weave(); build_quiz(); build_about()
    print("built", 1 + len(SERIES) + len(BOOK_ORDER) + 4, "pages")
