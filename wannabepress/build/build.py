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
<nav class="nav" aria-label="Main"><a href="/books/">Books</a><a href="/standalones/">Standalones</a><a href="/shop/">Shop</a><a href="/#creators">For creators</a><a href="/about/">About</a><a class="cta" href="{TW}/app?start=free">Thread Weaver</a></nav>
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
<div><h4>Read</h4><ul><li><a href="{TW}/">Thread Weaver</a></li><li><a href="/#serials">Read free, chapter by chapter</a></li><li><a href="/standalones/">Standalones</a></li><li><a href="/cosmic-weave/">The Cosmic Weave</a></li><li><a href="/quiz/">What should I read?</a></li><li><a href="/shop/">Shop</a></li><li><a href="/books/">All books</a></li></ul></div>
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

<section id="series"><div class="wrap">
<div class="head"><div><span class="k">The series</span><h2>Pick your world.</h2></div><p>Most of my series are threads in one shared universe, the Cosmic Weave. Read enough of them and you start to see where the threads cross.</p></div>
<div class="bkgrid">{''.join(series_cover_card(s) for s in SERIES)}</div>
<div class="head" style="margin-top:56px"><div><span class="k">Standalones</span><h2>One-and-done reads.</h2></div><a class="link" href="/standalones/">All standalones →</a></div>
<div class="bkgrid">{''.join(cover_card(o, "Cosmic Weave" if o in STD_WEAVE else None, CAT[o]["meta"].replace("Novel · ","")) for o in ["invasion","thevessel","thevoid","worstthing","skritchsrevenge","mfdkh"])}</div>
<p style="margin-top:22px"><a class="link" href="/books/">See every book</a> &nbsp; <a class="link" href="/cosmic-weave/">What is the Cosmic Weave?</a></p>
</div></section>

<section id="shop" class="dark"><div class="wrap">
<div class="head"><div><span class="k" style="color:var(--bee)">The shop</span><h2>Buy direct from me.</h2></div><p style="color:#f3d9d0">Bundles, audiobooks, audio commentary and hardcovers you can only get here.</p></div>
<div class="bkgrid">{''.join(f'<a class="bk" href="{shop(sl)}">{cover(img, t)}<b>{E(t)}</b><span class="price">{E(p)}</span></a>' for t, p, d, sl, img in SHOP_ITEMS[:6])}</div>
<p style="margin-top:22px"><a class="btn" href="/shop/">See the whole shop</a></p>
</div></section>

<section id="serials"><div class="wrap">
<div class="head"><div><span class="k">Read free, chapter by chapter</span><h2>Or read it free, a chapter at a time.</h2></div>
<p>In Thread Weaver, every series and standalone can be followed as a free serial: one chapter a week, on the day you pick. Own the series and you skip the wait.</p></div>
<div class="serials">{''.join(serial_cards)}</div>
</div></section>


{offer()}

<section id="reviews"><div class="wrap">
<div class="head"><h2>What readers say</h2></div>
<div class="quotes">{rev_html([REV["godsverse"][0], REV["ichabod-jones"][0], REV["obsidian-spindle"][0], REV["wonderland"][0], REV["thevessel"][0], REV["worstthing"][0]])}</div>
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

REV = json.load(open(os.path.join(os.path.dirname(__file__), "reviews.json"), encoding="utf-8"))
def rev_html(rows):
    return "".join(f'<figure class="q"><blockquote>“{E(q)}”</blockquote><figcaption>{E(who)} · <a href="{u}" rel="noopener">{E(on)} on Goodreads</a></figcaption></figure>' for q, who, on, u in rows)
# ------------------------------------------------------------------ catalog (copied from russellnohelty.com)
from urllib.parse import quote_plus
RN = json.load(open(os.path.join(os.path.dirname(__file__), "rn_books.json"), encoding="utf-8"))
CAT = {}
for slug, ser, title, meta, q, blurb, img, shops, rets in RN:
    CAT[slug] = dict(slug=slug, series=ser, title=title, meta=meta, quote=q, blurb=blurb, img=img, shops=shops, rets=rets)
# standalone novels captured earlier (same copy as russellnohelty.com/books/...)
for slug in BOOK_ORDER:
    b = BOOKS[slug]
    CAT[slug] = dict(slug=slug, series="standalones", title=b["title"], meta=b["kind"], quote=b["hook"], blurb=b["blurb"], img=BOOK_IMG[slug],
                     shops=["store.russellnohelty.com/l/" + SHOP_SLUG[slug]], rets=[], tw=b["tw"], price=b["price"], weave=b["weave"])
STD_RETS = {"invasion":["Amazon","Apple Books","Barnes & Noble","Kobo","Google Play"],"markedones":["Amazon","Apple Books","Barnes & Noble","Kobo"],
  "thevessel":["Amazon","Apple Books","Kobo","Google Play","Barnes & Noble"],"thevoid":["Amazon","Apple Books","Barnes & Noble","Kobo"],
  "anna":["Amazon","Apple Books","Barnes & Noble"],"worstthing":["Amazon","Apple Books","Barnes & Noble","Kobo"],"tiafc":[],
  "skritchsrevenge":["Amazon","Apple Books","Barnes & Noble","Kobo","Google Play","Smashwords"],"vengeance":["Amazon","Apple Books","Barnes & Noble","Kobo","Google Play","Smashwords"],
  "sorryforexisting":["Amazon","Barnes & Noble","Kobo","Google Play"],"mfdkh":["Amazon","Apple Books","Barnes & Noble","Kobo","Google Play"],"gumshoes":["Amazon","Apple Books","Barnes & Noble","Kobo","Google Play"]}
for k, v in STD_RETS.items(): CAT[k]["rets"] = v
# Thread Weaver ids for books in the app
TWID = {"changedl":"00-change","magic":"01-magic","evil":"02-evil","time":"03-time","heaven":"04-heaven","death":"05-death","doom":"06-doom","hell":"07-hell",
  "ruin":"08-ruin","conquest":"09-conquest","darkness":"10-darkness","chaos":"11-chaos","eternity":"12-eternity","bulletins":"bulletins-at-the-end-of-the-world",
  "thesleepingbeauty":"01-the-sleeping-beauty-generic","thewickedwitch":"02-the-wicked-witch-generic","thefairyqueen":"03-the-fairy-queen-generic",
  "theredrider":"04-the-red-rider-generic","theswordwielder":"05-the-sword-wielder-generic","thedarkprince":"06-the-dark-prince-generic",
  "thedragonwarrior":"07-the-dragon-warrior-generic","thesunkenkingdom":"08-the-sunken-kingdom-generic","thefacelesswoman":"09-the-faceless-woman-generic",
  "thedrownedprincess":"10-the-drowned-princess-generic","thegoldenamulet":"11-the-golden-locket","thedarkplanet":"12-the-dark-planet-generic",
  "thedragonscourge":"01-the-dragon-scourge","thedragonchampion":"02-the-dragon-champion","thedragongoddess":"03-the-dragon-goddess","wickedbodies":"04-wicked-bodies",
  "wickedminds":"05-wicked-minds","whiterabbit":"01-white-rabbit-nohelty-bookfunnel-2023-10-13-generic","blackjack":"02-black-jack-nohelty-bookfunnel-2023-10-13-generic"}
for k, v in TWID.items(): CAT[k]["tw"] = v
TW_SERIES = {"godsverse":"godsverse","obsidian-spindle":"obsidian-spindle","dragon-strife":"dragon-strife","ichabod-jones":"ichabod-jones","wonderland":"wonderland","quest-girls":"quest-girls"}
IN_APP = {"katrinahatesthedead","blackmarketheroine","pixiedust","paradise1","ichabodjonesvolume1","ichabodjonesvolume2","ichabodjonesvolume3","ichabodjonesvolume4","hn2ie","gherkinboy","odgt"}
SERIES_BOOKS = {"godsverse":["changedl","magic","evil","time","heaven","death","doom","hell","ruin","conquest","darkness","chaos","eternity"],
  "obsidian-spindle":["thesleepingbeauty","thewickedwitch","thefairyqueen","theredrider","theswordwielder","thedarkprince","thedragonwarrior","thesunkenkingdom","thefacelesswoman","thedrownedprincess","thegoldenamulet","thedarkplanet"],
  "dragon-strife":["thedragonscourge","thedragonchampion","thedragongoddess","wickedbodies","wickedminds"],
  "ichabod-jones":["ichabodjonesvolume1","ichabodjonesvolume2","ichabodjonesvolume3","ichabodjonesvolume4"],
  "cthulhu":["cthulhuishardtospell","theterribletwos","battleroyale"], "wonderland":["whiterabbit","blackjack"]}
SERIES_COMICS = {"godsverse":["katrinahatesthedead","blackmarketheroine","pixiedust","paradise1"]}
STD_WEAVE = ["invasion","markedones","thevessel","thevoid","anna","worstthing","tiafc","bulletins","paradise1","thewannabes"]
STD_OUT = ["skritchsrevenge","vengeance","sorryforexisting","mfdkh","gumshoes","the-little-bird-and-the-little-worm","hn2ie","gherkinboy","odgt","deathskiss","luciferlicorice1"]
LABEL = {"changedl":"Book 0 · Prequel","thesleepingbeauty":"Book 1 · Arc 1 starts here","theswordwielder":"Book 5 · Arc 2 starts here","thefacelesswoman":"Book 9 · Arc 3 starts here",
  "wickedbodies":"Book 4 · Wicked Witch Academy 1","wickedminds":"Book 5 · Wicked Witch Academy 2","whiterabbit":"Book 1 · Free","blackjack":"Book 2 · Free"}
def label_for(slug, i, ser):
    if slug in LABEL: return LABEL[slug]
    if ser in ("ichabod-jones","cthulhu"): return f"Volume {i+1}"
    return f"Book {i if ser=='godsverse' else i+1}"
def hook(slug):
    q = CAT[slug]["quote"]
    for s in SERIES:
        for b in s["books"]:
            if b["title"] == CAT[slug]["title"] and b.get("hook"): return b["hook"]
    return q
RET_URL = {
 "Amazon": "https://www.amazon.com/s?k={q}", "Comixology": "https://www.amazon.com/s?k={q}+comixology",
 "Barnes & Noble": "https://www.barnesandnoble.com/s/{q}", "Apple Books": "https://books.apple.com/us/search?term={q}",
 "Kobo": "https://www.kobo.com/us/en/search?query={q}", "Google Play": "https://play.google.com/store/search?q={q}&c=books",
 "Smashwords": "https://www.smashwords.com/books/search?query={q}", "Global Comix": "https://globalcomix.com/search?q={q}",
 "DriveThru Comics": "https://www.drivethrucomics.com/browse.php?keywords={q}", "Spinwhiz Comics": "https://spinwhiz.com/"}
def rets_html(title, rets):
    q = quote_plus(f"{title} Russell Nohelty")
    return "".join(f'<a class="chip2" href="{RET_URL[r].format(q=q)}" rel="noopener">{E(r)}</a>' for r in rets if r in RET_URL)
def shop_url(u): return "https://" + u
def book_tw_link(slug):
    c = CAT[slug]
    if c.get("tw"): return f"{TW}/app?book={c['tw']}"
    ser = c["series"]
    if ser in TW_SERIES: return f"{TW}/app?series={TW_SERIES[ser]}"
    return f"{TW}/app?series=standalones"
def in_app(slug):
    c = CAT[slug]
    return bool(c.get("tw")) or slug in IN_APP or (c["series"] in TW_SERIES)
def cover_card(slug, label=None, sub=None):
    c = CAT[slug]
    return (f'<a class="bk" href="/books/{slug}/">{cover(c["img"], c["title"])}'
            f'{"<span class=k>"+E(label)+"</span>" if label else ""}<b>{E(c["title"])}</b>'
            f'{"<p>"+E(sub)+"</p>" if sub else ""}</a>')
def series_cover_card(s):
    img = "quest-girls" if s["slug"] == "quest-girls" else s["img"]
    return (f'<a class="bk" href="/series/{s["slug"]}/">{cover(img, s["name"])}<span class="k">{E(s["meta"])}</span>'
            f'<b>{E(s["name"])}</b><p>“{E(s["tag"])}”</p></a>')

def series_page(s):
    sl = s["slug"]; img = "quest-girls" if sl == "quest-girls" else s["img"]
    sid = TW_SERIES.get(sl)
    ctas = []
    if sid: ctas.append(f'<a class="btn" href="{TW}/app?series={sid}">▸ Read on Thread Weaver</a>')
    if s.get("serial"): ctas.append(f'<a class="btn alt" href="{TW}/app?serial={s["serial"]}">Read free, weekly</a>')
    if s.get("shop_main"): ctas.append(f'<a class="btn alt" href="{s["shop_main"]}">Buy from my shop</a>')
    st = s["start"]
    start_url = st["url"] if "bookfunnel" in st["url"] else (f'/books/{SERIES_BOOKS[sl][0]}/' if sl in SERIES_BOOKS else st["url"])
    hero = f"""<section class="phero"><div class="wrap">
<div class="art">{cover(img, s['name'])}</div>
<div><div class="crumbs"><a href="/books/">All books</a> / <span class="pill">{"Part of the Cosmic Weave" if s["weave"] else "Outside the Weave"}</span></div>
<p class="tag">“{E(s['tag'])}”</p><h1>{E(s['name'])}</h1><div class="meta">{E(s['meta'])}</div>
<div class="desc">{''.join(f'<p>{E(p)}</p>' for p in s['desc'])}</div>
<div class="ctas">{''.join(ctas)}</div>
<div class="startwith"><span class="k">Start with</span><b>{E(st['title'])}</b><p>{E(st['note'])}</p>{f'<a class="link" href="{st["url"]}">▸ {E(st["btn"])}</a>' if "bookfunnel" in st["url"] or sl in ("quest-girls","wonderland") else f'<a class="link" href="{start_url}">▸ About {E(st["title"])}</a>'}</div>
</div></div></section>"""
    # reading order
    if sl in SERIES_BOOKS:
        grid = "".join(cover_card(b, label_for(b, i, sl), hook(b)) for i, b in enumerate(SERIES_BOOKS[sl]))
    else:  # Quest Girls (app only, no book pages)
        grid = "".join(f'<a class="bk" href="{TW}/app?series=quest-girls">{cover("quest-girls" if i==0 else None, b["title"], "y")}<span class="k">{E(b["label"])}</span><b>{E(b["title"])}</b>{"<p>"+E(b["hook"])+"</p>" if b.get("hook") else ""}</a>' for i, b in enumerate(s["books"]))
    order = f'<section><div class="wrap"><div class="head"><h2>Reading order</h2><span class="k">{E(s["order_label"])}</span></div><div class="bkgrid">{grid}</div>'
    if sl in SERIES_COMICS:
        order += '<div class="head" style="margin-top:50px"><h2>The comics</h2></div><div class="bkgrid">' + "".join(cover_card(c, None, CAT[c]["quote"]) for c in SERIES_COMICS[sl]) + '</div>'
    order += '</div></section>'
    if s.get("long"):
        order = '<section><div class="wrap"><div class="head"><h2>Book 1 · F*ck Fairy</h2></div><div class="longblurb">' + "".join(f"<p>{E(p)}</p>" for p in s["long"]) + f'<a class="btn" href="{TW}/app?series=quest-girls">▸ Read F*ck Fairy free</a></div></div></section>' + order
    # where to get it: Thread Weaver / my shop / the stores
    boxes = []
    if sid:
        items = []
        if s.get("unlock"): items.append(f'<li>{E(s["unlock"])}</li>')
        if s.get("serial"): items.append(f'<li><a href="{TW}/app?serial={s["serial"]}">Read it free as a weekly serial, one chapter a week</a></li>')
        items.append(f'<li><a href="{TW}/app?buy=everything">Get every series, comic and game in the Complete Collection · $99.99</a></li>')
        boxes.append(f'<div class="wbox"><span class="k">Thread Weaver</span><a class="btn" style="width:100%;margin:10px 0 12px" href="{TW}/app?series={sid}">▸ Read on Thread Weaver</a><ul>{"".join(items)}</ul></div>')
    if s["shop"]:
        boxes.append('<div class="wbox"><span class="k">Buy direct from my shop</span><p class="note">Bundles and bonuses you can only get from me.</p>' +
            "".join(f'<a class="pitem" href="{p["u"]}"><i>{E(p["p"])}</i><b>{E(p["t"])}</b><span>{E(p["d"])}</span></a>' for p in s["shop"]) + '</div>')
    else:
        boxes.append(f'<div class="wbox"><span class="k">Only in the app</span><p>{E(s.get("shop_note",""))}</p></div>')
    if sl in SERIES_BOOKS:
        b1 = SERIES_BOOKS[sl][0 if sl != "godsverse" else 1]
        if CAT[b1]["rets"]:
            boxes.append(f'<div class="wbox"><span class="k">{E(CAT[b1]["title"])} ({"Volume 1" if sl in ("ichabod-jones","cthulhu") else "Book 1"}) is also at</span><div class="chips">{rets_html(CAT[b1]["title"], CAT[b1]["rets"])}</div></div>')
    where = f'<section><div class="wrap"><div class="head"><h2>Where to get it</h2></div><div class="where3">{"".join(boxes)}</div>'
    if sl == "godsverse":
        where += '<div class="head" style="margin-top:50px"><h2>Also set in the Godsverse</h2></div><div class="bkgrid">' + cover_card("bulletins", "Cosmic Weave", "Short stories · Fantasy · Horror") + '</div>'
    if REV.get(sl):
        where += f'<div class="head" style="margin-top:50px"><h2>What readers say</h2></div><div class="quotes">{rev_html(REV[sl])}</div>'
    where += '</div></section>'
    more = '<section class="dark"><div class="wrap"><div class="head"><h2>More series</h2></div><div class="bkgrid">' + "".join(series_cover_card(o) for o in SERIES if o["slug"] != sl) + '</div></div></section>'
    body = quizband("Is this your series? Find out.") + hero + order + where + more + signup()
    page(f"/series/{sl}/", f"{s['name']} · Wannabe Press", f"{s['tag']} {s['meta']} by Russell Nohelty.", body, og=f"/img/{img}.webp" if img else "/img/og.jpg")

def series_name(ser):
    return SERIES_BY[ser]["name"] if ser in SERIES_BY else "Standalones"
def book_page(slug):
    c = CAT[slug]; ser = c["series"]
    lst = SERIES_BOOKS.get(ser) or (SERIES_COMICS.get(ser) if slug in SERIES_COMICS.get(ser, []) else None)
    if ser == "godsverse" and slug in SERIES_COMICS["godsverse"] + ["bulletins"]: lst = SERIES_COMICS["godsverse"]
    if ser == "standalones": lst = STD_WEAVE + STD_OUT
    crumbs = '<a href="/books/">All books</a> / ' + (f'<a href="/series/{ser}/">{E(series_name(ser))}</a>' if ser in SERIES_BY else '<a href="/standalones/">Standalones</a>')
    weave = c.get("weave", ser in ("godsverse","obsidian-spindle","dragon-strife","ichabod-jones") or slug in STD_WEAVE)
    if weave: crumbs += ' / <span class="pill">Part of the Cosmic Weave</span>'
    boxes = []
    free = [u for u in c["shops"] if "bookfunnel" in u]
    paid = [u for u in c["shops"] if "bookfunnel" not in u]
    if free:
        boxes.append(f'<div class="wbox tw"><span class="k">Free</span><a class="btn red" style="width:100%;margin-top:10px" href="{shop_url(free[0])}">▸ Get it free</a></div>')
    if in_app(slug):
        freeapp = slug in STD_WEAVE + STD_OUT or ser == "wonderland"
        boxes.append(f'<div class="wbox"><span class="k">{"Free on Thread Weaver" if freeapp else "Thread Weaver"}</span><a class="btn" style="width:100%;margin:10px 0 12px" href="{book_tw_link(slug)}">▸ {"Read it free" if freeapp else "Read on Thread Weaver"}</a><ul><li><a href="{TW}/app?buy=everything">Or get everything in the Complete Collection · $99.99</a></li></ul></div>')
    if paid:
        pr = c.get("price")
        is_series_bundle = any(x in paid[0] for x in ("complete","dbptdz","dragonstrife","wtmdih","cthulhuishardtospell"))
        boxes.append(f'<div class="wbox"><span class="k">Buy direct from me</span>{"<h3>"+E(pr)+"</h3>" if pr else ""}<a class="btn alt" style="width:100%;margin-top:10px" href="{shop_url(paid[0])}">▸ {"Get the whole series from my shop" if is_series_bundle else "Get it from my shop"}</a></div>')
    if c["rets"]:
        boxes.append(f'<div class="wbox"><span class="k">Available at</span><div class="chips">{rets_html(c["title"], c["rets"])}</div></div>')
    pn = ""
    if lst and slug in lst:
        i = lst.index(slug)
        prev = f'<a class="link" href="/books/{lst[i-1]}/">← {E(CAT[lst[i-1]]["title"])}</a>' if i > 0 else "<span></span>"
        nxt = f'<a class="link" href="/books/{lst[i+1]}/">Next: {E(CAT[lst[i+1]]["title"])} →</a>' if i + 1 < len(lst) else "<span></span>"
        pn = f'<div class="prevnext">{prev}{nxt}</div>'
    hero = f"""<section class="phero"><div class="wrap">
<div class="art">{cover(c['img'], c['title'])}</div>
<div><div class="crumbs">{crumbs}</div><h1>{E(c['title'])}</h1><div class="meta">{E(c['meta'])}</div>
{f'<p class="tag">“{E(c["quote"])}”</p>' if c["quote"] else ''}
<div class="longblurb">{''.join(f'<p>{E(p)}</p>' for p in c['blurb'])}</div>
<div class="where3" style="margin-top:26px">{''.join(boxes)}</div>{pn}
</div></div></section>"""
    if lst:
        others = [o for o in lst if o != slug][:12]
        title = f"More in {series_name(ser)}" if ser != "standalones" else "More standalones"
        more = f'<section><div class="wrap"><div class="head"><h2>{E(title)}</h2><a class="link" href="{"/series/"+ser+"/" if ser in SERIES_BY else "/standalones/"}">{"The whole series" if ser in SERIES_BY else "See them all"} →</a></div><div class="bkgrid">' + "".join(cover_card(o, label_for(o, SERIES_BOOKS[ser].index(o), ser) if ser in SERIES_BOOKS and o in SERIES_BOOKS[ser] else None) for o in others) + '</div></div></section>'
    else: more = ""
    rv = REV.get(slug) or [r for r in REV.get(ser, []) if r[2].lower().startswith(c["title"].lower()[:12])]
    revs = f'<section><div class="wrap"><div class="head"><h2>What readers say</h2></div><div class="quotes">{rev_html(rv)}</div></div></section>' if rv else ""
    body = quizband("Is this your book? Find out.") + hero + revs + more + signup()
    page(f"/books/{slug}/", f"{c['title']} · Wannabe Press", f"{c['quote'] or c['title']} {c['meta']} by Russell Nohelty.", body, og=f"/img/{c['img']}.webp")

def build_standalones():
    def card(o):
        c = CAT[o]; kind = c["meta"].replace("Novel · ", "").replace("Comic · ", "Comic · ")
        return f'<a class="bk" href="/books/{o}/">{cover(c["img"], c["title"])}{"<span class=k>Cosmic Weave</span>" if o in STD_WEAVE else ""}<b>{E(c["title"])}</b><p>{E(kind)}</p></a>'
    body = f"""{quizband()}
<section class="phero" style="padding-bottom:26px"><div class="wrap" style="grid-template-columns:1fr">
<div><div class="crumbs"><a href="/books/">All books</a> / Standalones</div><h1>Standalones</h1>
<p style="max-width:42em">Full novels and novellas that stand on their own, plus comics, a short story collection and a picture book. The ones tagged Cosmic Weave are threads in the same universe as my series. Most are free to read in Thread Weaver.</p>
<div class="ctas"><a class="btn alt" href="#weave">In the Cosmic Weave</a><a class="btn alt" href="#outside">Outside the Weave</a></div></div></div></section>
<section id="weave"><div class="wrap"><div class="head"><h2>In the Cosmic Weave</h2><a class="link" href="/cosmic-weave/">What is the Cosmic Weave? →</a></div><div class="bkgrid">{''.join(card(o) for o in STD_WEAVE)}</div></div></section>
<section id="outside"><div class="wrap"><div class="head"><h2>Outside the Weave</h2></div><div class="bkgrid">{''.join(card(o) for o in STD_OUT)}</div></div></section>
{signup()}"""
    page("/standalones/", "Standalones · Wannabe Press", "Standalone novels, comics and more by Russell Nohelty.", body)

def build_allbooks():
    weave = "".join(series_cover_card(s) for s in SERIES if s["weave"])
    out = "".join(series_cover_card(s) for s in SERIES if not s["weave"])
    std = "".join(cover_card(o, "Cosmic Weave" if o in STD_WEAVE else None, CAT[o]["meta"].replace("Novel · ","")) for o in STD_WEAVE + STD_OUT)
    body = f"""{quizband()}
<section class="phero" style="padding-bottom:26px"><div class="wrap" style="grid-template-columns:1fr"><div><div class="crumbs"><a href="/">Home</a> / All books</div><h1>All books</h1>
<p style="max-width:42em">Every series, standalone and comic from Wannabe Press. Buy direct from my shop, read in Thread Weaver, or find them at your favorite store.</p></div></div></section>
<section><div class="wrap"><div class="head"><h2>The Cosmic Weave</h2><a class="link" href="/cosmic-weave/">What is the Cosmic Weave? →</a></div><div class="bkgrid">{weave}</div>
<div class="head" style="margin-top:50px"><h2>Outside the Weave</h2></div><div class="bkgrid">{out}</div></div></section>
<section><div class="wrap"><div class="head"><h2>Standalones</h2><a class="link" href="/standalones/">See them all →</a></div><div class="bkgrid">{std}</div></div></section>
{signup()}"""
    page("/books/", "All books · Wannabe Press", "Every series, standalone and comic by Russell Nohelty.", body)

SHOP_ITEMS = [
 ("The Godsverse Chronicles Complete Series", "Pay what you want", "4,500+ pages, plus 118 hours of audiobooks and audio commentary.", "godsversecomplete", "change"),
 ("The Obsidian Spindle Saga: Complete Portal Fantasy series", "$40+", "All twelve books, direct from me.", "dbptdz", "sleeping-beauty"),
 ("Dragon Strife - the complete epic fantasy trilogy", "$15", "Plus the audio commentary for all three books, free.", "dragonstrife", "dragon-scourge"),
 ("Wicked Witch Academy Complete Series", "$10", "Wicked Bodies and Wicked Minds, plus the audio commentary free.", "wtmdih", "wwa-bodies"),
 ("Ichabod Jones: the complete series, vol. 1–4", "$40+", "Plus the audio commentary for all four volumes, free.", "ichabodcomplete", "ichabod-1"),
 ("Cthulhu Is Hard to Spell: the mega-anthology bundle", "$30", "All three volumes, nearly 500 pages.", "cthulhuishardtospell", "cth-vol1"),
 ("Hardcovers", "$30", "Your choice from nine Wannabe Press hardcovers.", "hardcoverbook", "cth-battle-royale"),
 ("Katrina Hates the Dead", "$10", "With free audio commentary.", "katrina", "katrina"),
 ("Black Market Heroine", "$10", "With free audio commentary.", "bmh", "bmh"),
 ("Pixie Dust", "$10", "With free audio commentary.", "pixiedust", "pixiedust"),
 ("Drawn by me! collection", "$10+", "How NOT to Invade Earth, Gherkin Boy and more.", "drawnbyme", "gherkin-boy"),
 ("Invasion", "$5+", "Ebook.", "invasion", "invasion"),
 ("The Marked Ones", "Pay what you want", "Ebook.", "markedones", "the-marked-ones"),
 ("The Vessel", "$5+", "Ebook.", "thevessel", "the-vessel"),
 ("The Void Calls Us Home", "$15+", "Audio drama + ebook.", "voidaudiodrama", "the-void-calls-us-home"),
 ("Anna and the Dark Place", "$20+", "Ebook + audiobook.", "anna", "anna-and-the-dark-place"),
 ("Worst Thing in the Universe", "$5", "Ebook.", "worstthing", "worst-thing-in-the-universe"),
 ("Time is a Flat Circle", "$5", "Ebook.", "yjwajm", "time-is-a-flat-circle"),
 ("Skritch's Revenge", "$5", "Ebook.", "xtijuu", "skritchs-revenge"),
 ("Vengeance", "$5", "Ebook.", "ejxbkd", "vengeance"),
 ("Sorry for Existing", "$5+", "Ebook.", "sorryforexisting", "sorry-for-existing"),
 ("My Father Didn't Kill Himself", "$5+", "Ebook.", "mfdkh", "my-father-didnt-kill-himself"),
 ("Gumshoes: The Case of Madison's Father", "Pay what you want", "Ebook.", "gumshoes", "gumshoes"),
 ("The Little Bird and The Little Worm", "$5+", "Children’s picture book.", "rqxzl", "the-little-bird-and-the-little-worm"),
]
def build_shop():
    items = "".join(f'<a class="bk shopitem" href="{shop("%s" % sl)}">{cover(img, t)}<b>{E(t)}</b><p>{E(d)}</p><span class="price">{E(p)}</span></a>' for t, p, d, sl, img in SHOP_ITEMS)
    body = f"""{quizband()}
<section class="phero" style="padding-bottom:26px"><div class="wrap" style="grid-template-columns:1fr"><div><div class="crumbs"><a href="/">Home</a> / Shop</div><h1>The shop</h1>
<p style="max-width:42em">Buy direct from me. Bundles, audiobooks, audio commentary and hardcovers you can only get here. Checkout opens right on this page.</p>
<div class="ctas"><a class="btn" href="{TW}/app?buy=everything">Everything in Thread Weaver · $99.99</a><a class="btn alt" href="{SHOP}/">Open the full shop</a></div></div></div></section>
<section><div class="wrap"><div class="bkgrid">{items}</div></div></section>
{signup()}"""
    page("/shop/", "Shop · Wannabe Press", "Buy Russell Nohelty's books, bundles, audiobooks and hardcovers direct.", body)

def build_weave():
    ser = "".join(series_cover_card(s) for s in SERIES if s["weave"])
    sb = "".join(f'<a class="cv" href="/books/{o}/">{cover(BOOK_IMG[o], BOOKS[o]["title"])}<span class="t">{E(BOOKS[o]["title"])}</span><span class="s">{E(BOOKS[o]["kind"].replace("Novel · ",""))}</span></a>' for o in BOOK_ORDER if BOOKS[o]["weave"])
    sb += "".join(f'<a class="cv" href="{o["url"]}">{cover(o["img"], o["title"])}<span class="t">{E(o["title"])}</span><span class="s">{E(o["kind"])}</span></a>' for o in OTHER_STANDALONES if o["weave"])
    body = f"""{quizband("Find your first thread.")}
<section class="phero" style="padding-bottom:30px"><div class="wrap" style="grid-template-columns:1fr">
<div><div class="crumbs"><a href="/">Home</a> / The Cosmic Weave</div><h1>The Cosmic Weave</h1>
<p style="max-width:40em">Most of my series and many of my standalones are threads in the same universe. Gods, fairy tales, dragons, monster hunters and a karmic anomaly named Albert Ross all live here. Read enough of them and you start to see where the threads cross.</p>
<p style="max-width:40em">In Thread Weaver, the Weave is a living codex of hundreds of secrets that unlock as you read.</p>
<div class="ctas"><a class="btn" href="{TW}/app?open=codex">Explore the Weave</a></div></div></div></section>
<section><div class="wrap"><div class="head"><div><span class="k">The series</span><h2>The series</h2></div></div><div class="bkgrid">{ser}</div></div></section>
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
    for s in SERIES: series_page(s)
    for b in CAT: book_page(b)
    build_standalones(); build_allbooks(); build_shop(); build_weave(); build_quiz(); build_about()
    print("built", 1 + len(SERIES) + len(CAT) + 7, "pages")
