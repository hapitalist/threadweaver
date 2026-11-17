import base64, html, json
e=html.escape
D='/home/claude/threadweaver/wannabepress/img/'
import shutil
def u(n):
    shutil.copy(D+n+'.webp', '/home/claude/threadweaver/www/site/covers/'+n+'.webp'); return 'site/covers/'+n+'.webp'
A={k:'site/screens/'+k+'.webp' for k in ['ph_choice','ph_open','ph_gods','ph_qg','comic']}
TW=''; BUY='/app?buy=everything'; FREE=TW+'/app?start=free'
C={n:u(n) for n in ['katrina','ichabod-1','sleeping-beauty','white-rabbit','dragon-scourge','invasion','change','quest-girls','one-damned-good-thing']}
GR='https://www.goodreads.com/book/show/'
revs=[('How can a book be so violent and hilarious and brilliant at the same time?','S.E. Anderson','Katrina Hates the Dead','katrina',GR+'30200114-katrina-hates-the-dead'),
('The artwork is superb and the storyline is creepy AF. This is definitely more Hannibal than Buffy.','Ken Goudsward','Ichabod Jones: Monster Hunter','ichabod-1',GR+'25052119-ichabod-jones'),
('A dark, imaginative twist on fairy tales with real emotional stakes. Watching Rose fight for her life across the Dream Realm had me hooked from page one.','Jess Amon','The Sleeping Beauty','sleeping-beauty',GR+'220487313-the-sleeping-beauty'),
('And like Rabbit, one taste of the addictive elixir, all you want, all you need is more.','Regina','White Rabbit','white-rabbit',GR+'36465661-white-rabbit'),
('Mr. Nohelty has written a book with a large number of surprises in it. Ewig is a surprising dragon as you discover as you read the book.','Ramona Harris','The Dragon Scourge','dragon-scourge',GR+'123190585-the-dragon-scourge'),
('I loved this story. It provided EVERYTHING I look for in an SF story.','Aurora','Invasion','invasion',GR+'51010124-invasion')]
tickets=''.join(f'''<figure class="tix" style="--r:{r}deg"><div class="stub"><img src="{C[c]}" alt="{e(b)} cover"></div><div class="tbody"><blockquote>{e(q)}</blockquote><figcaption><b>{e(w)}</b> on <cite>{e(b)}</cite><span class="src">Goodreads review</span></figcaption></div></figure>''' for (q,w,b,c,l),r in zip(revs,[-1.6,1.1,-0.8,1.4,-1.2,0.9]))
doors=[('sleeping-beauty','The Obsidian Spindle Saga','Fairy tales are real.','12 books and a story game'),
('change','The Godsverse Chronicles','Welcome to the Godschurch, rookie. Your first-year survival odds are whatever you think they are. Cut that in half.','13 books, 4 comics and a story game'),
('quest-girls','Quest Girls','A 324-year-old cursed quest guide and a runaway princess pull a heist on the Abyssal Auction.','4 books and a story game'),
('dragon-scourge','Dragon Strife','Gilda will die today.','5 books and a story game'),
('ichabod-1','Ichabod Jones: Monster Hunter','A man hears a voice. The voice tells him he is a monster hunter, humanity’s last hope. The voice may be right.','4 comics and a story game'),
('white-rabbit','Wonderland','Wonderland. Dark. Grimy. Unsavory.','The Wonderland Duology')]
PRICE={'The Obsidian Spindle Saga':('$50','obsidian_series','12 books and the story game'),'The Godsverse Chronicles':('$50','godsverse_series','13 books, 4 comics and the story game'),'Quest Girls':('$20','quest_girls_series','Books 2 to 4 and the story game. Book 1 is free.'),'Dragon Strife':('$20','dragonstrife_series','5 books and the story game'),'Ichabod Jones: Monster Hunter':('$20','ichabod_series','4 comics and the story game')}
def dattr(t):
    pr=PRICE.get(t)
    return f'data-name="{e(t)}"'+(f' data-price="{pr[0]}" data-buy="{TW}/app?buy={pr[1]}" data-what="{e(pr[2])}"' if pr else ' data-what="Comes with everything"')
door_html=''.join(f'<button type="button" class="door" {dattr(t)} data-cover="{c}"><img src="{C[c]}" alt=""><span class="dt"><span class="h3">{e(t)}</span><span class="hook">{e(h)}</span><span class="what">{e(w)}</span><span class="pick">Choose this world</span></span></button>' for c,t,h,w in doors)
COVERS_JS='{'+','.join(f'"{c}":"{C[c]}"' for c,_,_,_ in doors)+'}'
worlds=[('sleeping-beauty','The Obsidian Spindle Saga','12 books and the game','$50','obsidian_series'),('change','The Godsverse Chronicles','13 books, 4 comics and the game','$50','godsverse_series'),('quest-girls','Quest Girls','Books 2 to 4 and the game. Book 1 is free.','$20','quest_girls_series'),('dragon-scourge','Dragon Strife','5 books and the game','$20','dragonstrife_series'),('ichabod-1','Ichabod Jones','4 comics and the game','$20','ichabod_series'),(None,'All 7 story games','Just the games','$5','all_games')]
world_html=''.join(f'<li>{("<img src=%s alt=%s>"%(chr(34)+C[c]+chr(34),chr(34)*2)) if c else "<span class=glyph>7</span>"}<div><strong>{e(t)}</strong><span>{e(d)}</span></div><em>{e(p)}</em><a href="{TW}/app?buy={k}">Get this world</a></li>' for c,t,d,p,k in worlds)
faq=[("How do I get everything after I pay?","Make your free account (or log in), pay through Stripe's secure checkout, and everything unlocks in Thread Weaver right away. Sign in with the same email on your phone, tablet or computer and it is unlocked there too."),
("How do the files get to me?","Through BookFunnel. Every ebook, audiobook, audio commentary and comic comes to you as files you keep, on any reader, phone or app, forever. You never need Thread Weaver to open them."),
("Is this a subscription?","No. Every price on this page is paid once. There is nothing to renew."),
("What is free?","16 books and 5 comics are free inside the app, including Quest Girls Book 1, plus the first Agents of the Godschurch mission. Start free and buy later if you love it."),
("Can I read on my phone?","Yes. Read on the website from any browser, or get the app from the App Store or Google Play. Books you open stay on your device so you can read offline."),
("Something went wrong. Who do I tell?","Email help@wannabepress.com and a real person will sort it out.")]
faq_html=''.join(f'<details><summary>{e(q)}</summary><p>{e(a)}</p></details>' for q,a in faq)
STARS='<span class="st" aria-hidden="true">★★★★<span class="part">★</span></span>'
def offer(id=''):
    return f'''<div class="offer"{f' id="{id}"' if id else ''}><p class="rarity">The complete collection</p>
<ul class="gets"><li><b>49</b> novels</li><li><b>13</b> comics</li><li><b>7</b> story games</li><li><b>864</b> Weave entries</li><li><b>150+</b> files you keep, through BookFunnel</li></ul>
<p class="cost"><span class="wasl">One by one in the shop</span><span class="was">$260+</span><b>$99.99</b><span class="once">paid once, never renews</span></p>
<a class="buy" href="{BUY}">Get everything for $99.99</a>
<p class="fine">Secure checkout by Stripe. Unlocks on every device you sign in on.</p><a class="free" href="{FREE}">Or start free with 16 books and 5 comics</a></div>'''

page=f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><script src="tw-eyes.js"></script><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<script>/* the WEBSITE landing page. Inside the packaged app go straight to the library. */(function(){{ var p=location.protocol,h=location.hostname;var nat=p==='app:'||p==='file:'||p==='capacitor:'||p==='ionic:'||(p==='https:'&&h==='localhost'&&!location.port); if(nat) location.replace("app.html"+location.search+location.hash); }})();</script>
<meta name="theme-color" content="#0a0810"><link rel="icon" href="favicon.ico"><link rel="apple-touch-icon" href="icons/icon-192.png">
<meta property="og:title" content="Thread Weaver: read and play every Russell Nohelty story"><meta property="og:description" content="Every book, comic and story game in one app. Make the choices, level up as you read, keep every file. $99.99, paid once."><meta property="og:image" content="/site/screens/ph_choice.webp"><meta property="og:url" content="/">
<title>Thread Weaver: read and play every Russell Nohelty story</title>
<meta name="description" content="Every Russell Nohelty book, comic and story game in one app. Make the choices, level up as you read, and keep every file through BookFunnel. $99.99, paid once.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500;1,600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{{--bg:#0a0810;--panel:#120d1c;--edge:#2e2742;--ink:#ece3d0;--soft:#c9bfda;--dim:#9b91ac;--gold:#e8b53a;--gold2:#b8862a;--green:#7fd08a;--paper:#f3ead6;--paperink:#2a1d12}}
*{{box-sizing:border-box}}html{{scroll-behavior:smooth}}
body{{margin:0;background:var(--bg);color:var(--ink);font:500 21px/1.55 'Cormorant Garamond',Georgia,serif;-webkit-font-smoothing:antialiased}}
a{{color:var(--gold)}}img{{display:block;max-width:100%}}
h1,h2,h3{{font-family:Cinzel,serif;font-weight:700;line-height:1.08;margin:0}}
.in{{max-width:1160px;margin:0 auto;padding:0 24px}}:focus-visible{{outline:2px solid var(--gold);outline-offset:3px}}
.mono{{font-family:'DM Mono',monospace}}
.bar{{position:sticky;top:0;z-index:20;background:rgba(10,8,16,.88);backdrop-filter:blur(8px);border-bottom:1px solid var(--edge)}}
.bar .in{{display:flex;align-items:center;justify-content:space-between;height:60px}}
.bar .name{{font-family:Cinzel,serif;font-weight:700;letter-spacing:.06em;color:var(--ink);text-decoration:none}}

.nav{{display:flex;align-items:center;gap:18px}}.login{{color:var(--ink);text-decoration:none;font:500 .85rem 'DM Mono',monospace;border-bottom:1px solid var(--edge)}}.login:hover{{color:var(--gold)}}
.bar .sm{{font:500 .8rem 'DM Mono',monospace;color:#1a1206;background:var(--gold);padding:9px 14px;border-radius:4px;text-decoration:none}}
.buy{{display:inline-block;background:var(--gold);color:#1a1206;font:700 1.12rem Cinzel,serif;padding:17px 30px;border-radius:6px;text-decoration:none;box-shadow:0 0 28px rgba(232,181,58,.35),inset 0 -3px 0 var(--gold2)}}.buy:hover{{background:#f1c452}}
.ghost{{display:inline-block;color:var(--ink);font:600 1.1rem 'Cormorant Garamond',serif;padding:15px 22px;border:1px solid var(--edge);border-radius:6px;text-decoration:none}}.ghost:hover{{border-color:var(--gold2)}}
.st{{color:var(--gold);letter-spacing:2px}}.st .part{{background:linear-gradient(90deg,var(--gold) 30%,#4a3f5c 30%);-webkit-background-clip:text;background-clip:text;color:transparent}}
/* hero */
.hero{{position:relative;overflow:hidden;padding:70px 0 90px;background:radial-gradient(ellipse 70% 80% at 75% 40%,rgba(184,134,42,.16),transparent 70%)}}
.hero .in{{display:grid;grid-template-columns:1.05fr 1fr;gap:40px;align-items:center}}
.hero h1{{font-size:clamp(2.6rem,5.6vw,4.6rem);margin:0 0 20px}}
.lede{{font-size:1.38rem;color:var(--soft);max-width:31ch;margin:0 0 26px}}
.rating{{display:flex;align-items:center;gap:12px;margin:0 0 26px;font-family:'DM Mono',monospace;font-size:.85rem;color:var(--soft)}}.rating .st{{font-size:1.2rem}}.rating b{{color:var(--ink);font-weight:500;font-size:1rem}}
.ctas{{display:flex;flex-wrap:wrap;gap:12px;align-items:center}}
.note{{margin:14px 0 0;font-size:1rem;color:var(--dim)}}
.phones{{position:relative;height:620px}}
.phone{{position:absolute;width:250px;border-radius:34px;padding:8px;background:#05040a;border:1px solid #3a3150;box-shadow:0 30px 60px rgba(0,0,0,.7),0 0 0 1px #000}}
.phone img{{border-radius:27px;width:100%;aspect-ratio:390/844;object-fit:cover;object-position:top}}
.phone.a{{left:50%;top:10px;transform:translateX(-50%);z-index:3;width:270px}}
.phone.b{{left:0;top:70px;transform:rotate(-8deg);z-index:2;opacity:.9}}.phone.c{{right:0;top:70px;transform:rotate(8deg);z-index:1;opacity:.9}}
.tag{{position:absolute;z-index:4;font:500 .78rem 'DM Mono',monospace;background:var(--panel);border:1px solid var(--gold2);color:var(--gold);padding:7px 11px;border-radius:999px;white-space:nowrap}}
.tag.t1{{left:-6px;top:300px}}.tag.t2{{right:-10px;top:180px}}.tag.t3{{right:20px;bottom:40px;color:var(--green);border-color:#3f7a4a}}
/* reviews: tickets */
.reviews{{background:var(--panel);border-top:1px solid var(--edge);border-bottom:1px solid var(--edge);padding:80px 0 90px}}
.rhead{{text-align:center;margin-bottom:46px}}.rhead h2{{font-size:clamp(1.9rem,3.6vw,2.8rem);margin-bottom:12px}}
.agg{{display:inline-flex;align-items:center;gap:12px;font-family:'DM Mono',monospace;font-size:.85rem;color:var(--soft)}}.agg .st{{font-size:1.35rem}}.agg b{{font-size:1.25rem;color:var(--ink);font-weight:500}}
.tixes{{display:grid;grid-template-columns:repeat(3,1fr);gap:34px 30px}}
.tix{{position:relative;margin:0;display:grid;grid-template-columns:96px 1fr;background:var(--paper);color:var(--paperink);border-radius:10px;transform:rotate(var(--r));box-shadow:0 14px 30px rgba(0,0,0,.45);transition:transform .2s}}
.tix:hover{{transform:rotate(0) translateY(-3px)}}
.tix .stub{{position:relative;display:block;padding:12px;border-right:2px dashed rgba(42,29,18,.35)}}
.tix .stub img{{width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:3px;box-shadow:0 4px 10px rgba(0,0,0,.3)}}
.tix:before,.tix:after{{content:"";position:absolute;left:87px;width:18px;height:18px;border-radius:50%;background:var(--panel)}}.tix:before{{top:-9px}}.tix:after{{bottom:-9px}}
.tbody{{padding:16px 18px 14px}}.tbody blockquote{{margin:0 0 10px;font-style:italic;font-weight:600;font-size:1.18rem;line-height:1.32}}
.tbody figcaption{{font-size:.95rem;line-height:1.35}}.tbody figcaption b{{font-weight:700}}.tbody figcaption .src{{display:block;margin-top:6px;color:#8a5a12;font:500 .72rem 'DM Mono',monospace;letter-spacing:.04em}}
/* sections */
section.s{{padding:100px 0}}.s .head{{text-align:center;max-width:720px;margin:0 auto 48px}}.s h2{{font-size:clamp(1.9rem,3.6vw,2.8rem);margin-bottom:14px}}.s .head p{{color:var(--soft);margin:0}}
.split{{display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:center}}.split h2{{text-align:left}}.split p{{color:var(--soft)}}
/* doors */
.doors{{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}}
.door{{font:inherit;color:inherit;text-align:left;cursor:pointer;width:100%;display:grid;grid-template-columns:110px 1fr;gap:18px;background:linear-gradient(180deg,#151020,#0e0a16);border:1px solid var(--edge);border-radius:12px;padding:18px}}
.door img{{width:110px;aspect-ratio:2/3;object-fit:cover;border-radius:4px;box-shadow:0 10px 20px rgba(0,0,0,.6)}}
.door:hover{{border-color:var(--gold2);transform:translateY(-2px)}}.door{{transition:transform .15s,border-color .15s}}.dt{{display:flex;flex-direction:column}}.door .h3{{font:700 1.02rem Cinzel,serif;margin-bottom:8px;color:var(--gold)}}.door .hook{{font-style:italic;font-size:1.2rem;line-height:1.3;margin:0 0 10px}}.door .what{{font:400 .8rem 'DM Mono',monospace;color:var(--dim)}}.door .pick{{margin-top:12px;font:500 .8rem 'DM Mono',monospace;color:var(--gold)}}
.modal{{position:fixed;inset:0;z-index:50;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(5,4,10,.78);backdrop-filter:blur(4px)}}.modal.on{{display:flex}}
.mbox{{position:relative;width:100%;max-width:520px;background:linear-gradient(180deg,#181126,var(--panel));border:1px solid var(--gold2);border-radius:16px;padding:28px 26px 24px;box-shadow:0 30px 80px rgba(0,0,0,.7)}}
.mx{{position:absolute;top:10px;right:12px;background:none;border:0;color:var(--soft);font-size:1.6rem;cursor:pointer;line-height:1}}
.mtop{{display:grid;grid-template-columns:84px 1fr;gap:16px;align-items:center;margin-bottom:20px}}.mtop img{{width:84px;aspect-ratio:2/3;object-fit:cover;border-radius:4px}}.mtop h3{{font-size:1.3rem;margin-bottom:6px}}.mtop p{{margin:0;color:var(--soft);font-size:1.05rem}}
.opt{{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px 18px;border:1px solid var(--edge);border-radius:10px;text-decoration:none;color:var(--ink);margin-top:10px}}.opt b{{font-family:Cinzel,serif;font-size:1.05rem;display:block}}.opt span{{font-size:1rem;color:var(--dim)}}.opt em{{font-style:normal;font-family:Cinzel,serif;font-size:1.4rem;color:var(--gold);white-space:nowrap}}
.opt.best{{border-color:var(--gold);background:rgba(232,181,58,.08);box-shadow:0 0 24px rgba(232,181,58,.15)}}.opt .badge{{display:inline-block;font:500 .7rem 'DM Mono',monospace;color:#1a1206;background:var(--gold);padding:2px 7px;border-radius:3px;margin-bottom:5px}}.opt:hover{{border-color:var(--gold)}}
.mfine{{margin:14px 0 0;text-align:center;font-size:.95rem;color:var(--dim)}}
/* play */
.play .phone{{position:relative;margin:0 auto;width:300px}}
.rolls{{list-style:none;padding:0;margin:22px 0}}.rolls li{{display:grid;grid-template-columns:86px 1fr;gap:14px;padding:12px 0;border-bottom:1px solid var(--edge);font-size:1.08rem}}
.rolls span{{font:500 .78rem 'DM Mono',monospace;padding:4px 0;letter-spacing:.06em}}.e1{{color:var(--green)}}.e2{{color:var(--gold)}}.e3{{color:#e0644f}}.e4{{color:#a98bff}}
.pull{{font-family:Cinzel,serif;font-size:1.5rem;color:var(--ink);margin:18px 0 0}}
/* comics + weave */
.duo{{display:grid;grid-template-columns:1fr 1fr;gap:28px}}
.panel-card{{background:var(--panel);border:1px solid var(--edge);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}}
.panel-card .pic{{height:420px;overflow:hidden;background:#000}}.weavepic{{background:#0b0812}}.panel-card .pic img{{width:100%;height:100%;object-fit:cover;object-position:top}}
.panel-card .txt{{padding:24px 26px 28px}}.panel-card h3{{font-size:1.4rem;margin-bottom:10px}}.panel-card p{{margin:0;color:var(--soft)}}
.xp{{margin-top:16px}}.track{{height:12px;border-radius:999px;background:#1b1429;border:1px solid var(--edge);overflow:hidden}}.track i{{display:block;height:100%;width:38%;background:linear-gradient(90deg,#4fa35d,var(--green));box-shadow:0 0 14px rgba(127,208,138,.5)}}
.ends{{display:flex;justify-content:space-between;font:400 .75rem 'DM Mono',monospace;color:var(--soft);margin-top:8px}}
.quests{{list-style:none;padding:0;margin:14px 0 0;font:400 .85rem 'DM Mono',monospace}}.quests li{{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--edge)}}.quests b{{color:var(--green);font-weight:500}}
/* keep */
.keep{{background:linear-gradient(180deg,var(--panel),var(--bg));border-top:1px solid var(--edge)}}
.files{{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:10px}}
.files div{{border:1px solid var(--edge);border-radius:10px;padding:20px 16px;text-align:center;background:#0d0a15}}.files b{{display:block;font-family:Cinzel,serif;font-size:1.05rem;margin-bottom:4px}}.files span{{font-size:.98rem;color:var(--dim)}}
.bf{{margin:28px auto 0;text-align:center;max-width:52ch;color:var(--soft)}}
/* offer */
.offerwrap{{text-align:center}}
.offer{{max-width:640px;margin:0 auto;background:linear-gradient(180deg,#181126,var(--panel));border:1px solid var(--gold2);border-radius:16px;padding:36px 34px 30px;box-shadow:0 0 70px rgba(232,181,58,.16),0 30px 60px rgba(0,0,0,.55);position:relative}}
.offer:before{{content:"";position:absolute;inset:7px;border:1px solid rgba(232,181,58,.2);border-radius:11px;pointer-events:none}}
.rarity{{margin:0 0 16px;color:var(--gold);font:500 .8rem 'DM Mono',monospace;letter-spacing:.14em;text-transform:uppercase}}
.gets{{list-style:none;padding:0;margin:0 0 22px;display:flex;flex-wrap:wrap;justify-content:center;gap:8px 22px;font-size:1.1rem}}.gets b{{font-family:Cinzel,serif;color:var(--ink);margin-right:4px}}
.cost{{margin:0 0 18px;display:flex;flex-direction:column;align-items:center;gap:2px}}.cost .wasl{{font:400 .78rem 'DM Mono',monospace;color:var(--dim)}}.cost .was{{font:700 1.6rem Cinzel,serif;color:var(--dim);text-decoration:line-through;text-decoration-color:#e0644f;text-decoration-thickness:2px}}.cost b{{font-family:Cinzel,serif;font-size:3.2rem;color:var(--gold);line-height:1.05}}.cost .once{{font:400 .8rem 'DM Mono',monospace;color:var(--dim)}}
.fine{{margin:14px 0 6px;font-size:.98rem;color:var(--dim)}}.free{{font-size:1.05rem}}
.retail{{margin:22px auto 0;max-width:640px;font-size:1rem;color:var(--soft)}}.fill{{background:#e8b53a22;border-bottom:1px dashed var(--gold);padding:0 6px;font-style:italic;color:var(--gold)}}
/* worlds */
.worlds{{list-style:none;padding:0;margin:0 auto;max-width:820px}}.worlds li{{display:grid;grid-template-columns:52px 1fr auto auto;gap:18px;align-items:center;padding:14px 0;border-bottom:1px solid var(--edge)}}
.worlds img,.worlds .glyph{{width:52px;aspect-ratio:2/3;object-fit:cover;border-radius:3px;display:flex;align-items:center;justify-content:center;background:#1b1429;border:1px solid var(--edge);font-family:Cinzel,serif;color:var(--gold)}}
.worlds strong{{display:block;font-family:Cinzel,serif;font-size:1rem}}.worlds span{{font-size:1rem;color:var(--dim)}}.worlds em{{font-style:normal;color:var(--gold)}}.worlds a{{font-size:1rem;white-space:nowrap}}
.faq{{max-width:760px;margin:0 auto}}.faq details{{border-bottom:1px solid var(--edge);padding:18px 0}}.faq summary{{cursor:pointer;font-family:Cinzel,serif;font-size:1.05rem;list-style:none;display:flex;justify-content:space-between;gap:16px}}
.faq summary:after{{content:"+";color:var(--gold);font-family:'DM Mono',monospace}}.faq details[open] summary:after{{content:"\\2013"}}.faq p{{margin:12px 0 0;color:var(--soft)}}
.center{{text-align:center}}.mt{{margin-top:44px}}
footer .stores a{{display:inline-block;border:1px solid var(--edge);border-radius:8px;padding:9px 14px;margin:0 6px 10px;color:var(--ink);text-decoration:none;font:500 .8rem 'DM Mono',monospace}}footer .stores a:hover{{border-color:var(--gold2)}}
footer{{border-top:1px solid var(--edge);padding:30px 24px 110px;text-align:center;font-size:.95rem;color:var(--dim)}}footer a{{color:var(--soft);margin:0 10px}}
.sticky{{transform:translateY(110%);transition:transform .2s;}}.sticky.on{{transform:none}}.sticky{{position:fixed;left:0;right:0;bottom:0;z-index:30;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;background:rgba(18,13,28,.96);border-top:1px solid var(--gold2)}}
.sticky span{{font:400 .85rem 'DM Mono',monospace;color:var(--soft)}}.sticky b{{color:var(--gold);font-weight:500}}.sticky a{{background:var(--gold);color:#1a1206;font:700 1rem Cinzel,serif;padding:11px 18px;border-radius:6px;text-decoration:none}}
@media (min-width:900px){{.sticky{{display:none}}footer{{padding-bottom:30px}}}}
@media (max-width:980px){{.hero .in{{grid-template-columns:1fr;text-align:center}}.lede{{margin-left:auto;margin-right:auto}}.rating,.ctas{{justify-content:center}}.phones{{height:520px;max-width:520px;margin:0 auto;width:100%}}
 .tixes{{grid-template-columns:repeat(2,1fr)}}.doors{{grid-template-columns:repeat(2,1fr)}}.split,.duo{{grid-template-columns:1fr}}.split h2{{text-align:center}}.files{{grid-template-columns:repeat(2,1fr)}}}}
@media (max-width:640px){{body{{font-size:19px}}.hero{{padding:36px 0 50px}}.phones{{height:430px}}.phone{{width:180px;border-radius:26px;padding:6px}}.phone img{{border-radius:21px}}.phone.a{{width:200px}}.phone.b{{top:60px}}.phone.c{{top:60px}}.tag{{display:none}}
 .tixes,.doors{{grid-template-columns:1fr}}.tix{{grid-template-columns:84px 1fr}}.tix:before,.tix:after{{left:75px}}section.s{{padding:70px 0}}.panel-card .pic{{height:300px}}
 .worlds li{{grid-template-columns:44px 1fr auto;row-gap:2px}}.worlds img,.worlds .glyph{{width:44px;grid-row:span 2}}.worlds a{{grid-column:2/4}}.bar .sm{{display:none}}.login{{font-size:.95rem}}.offer{{padding:28px 20px 24px}}}}
@media (prefers-reduced-motion:reduce){{html{{scroll-behavior:auto}}.tix{{transition:none}}}}
</style></head><body>
<header class="bar"><div class="in"><a class="name" href="/">Thread Weaver</a><nav class="nav"><a class="login" href="{TW}/app">Log in</a><a class="sm" href="{BUY}">Everything, $99.99</a></nav></div></header>
<main>
<section class="hero"><div class="in">
<div>
<h1>Don't just read the story. Play it.</h1>
<p class="lede">Every Russell Nohelty book, comic and story game in one app. Make the choices, roll for your life, level up as you read, and keep every file forever.</p>
<p class="rating">{STARS}<b>4.3</b> from 632 Goodreads reviews</p>
<div class="ctas"><a class="buy" href="{BUY}">Get everything for $99.99</a></div>
<p class="note">Paid once, never renews. Secure checkout by Stripe.</p>
</div>
<div class="phones" aria-label="Screens from the Thread Weaver story games">
<div class="phone b"><img src="{A['ph_gods']}" alt="The Godsverse Chronicles story game: the Godschurch field manual"></div>
<div class="phone c"><img src="{A['ph_qg']}" alt="Quest Girls story game: pick a book to play"></div>
<div class="phone a"><img src="{A['ph_choice']}" alt="The Obsidian Spindle story game: three choices, each a skill roll with odds and XP"></div>
<span class="tag t1">Every choice is a roll</span><span class="tag t2">7 story games</span><span class="tag t3">+XP for risky moves</span>
</div>
</div></section>

<section class="reviews"><div class="in">
<div class="rhead"><h2>Readers can't put them down.</h2><p class="agg">{STARS}<b>4.3</b> average across 632 Goodreads reviews</p></div>
<div class="tixes">{tickets}</div>
</div></section>

<section class="s"><div class="in">
<div class="head"><h2>Pick a door.</h2><p>Six worlds, all connected. Start anywhere, and every one of them pulls you into the next.</p></div>
<div class="doors">{door_html}</div>
</div></section>

<section class="s play" style="background:var(--panel);border-top:1px solid var(--edge);border-bottom:1px solid var(--edge)"><div class="in split">
<div class="phone"><img src="{A['ph_open']}" alt="The Obsidian Spindle story game, opening scene"></div>
<div><h2>Your choices shape the story.</h2>
<p>Seven story games are set inside the books. They run like a tabletop game master: every decision offers different approaches, each one a different skill, and the further you push against your nature, the bigger the payoff.</p>
<ul class="rolls"><li><span class="e1">EASY</span>The obvious play for your kind. Safe, small reward.</li><li><span class="e2">RISKY</span>A real gamble, twice the XP.</li><li><span class="e3">DESPERATE</span>Long odds, five times the XP.</li><li><span class="e4">WILD</span>Something you have no business attempting. Ten times the XP.</li></ul>
<p class="pull">You level up. You can die.</p></div>
</div></section>

<section class="s"><div class="in">
<div class="head"><h2>Comics, and a universe to explore.</h2><p>Read 13 comics panel by panel, and fill in the Weave as you go: the threads, gods, monsters, places and relics behind every book.</p></div>
<div class="duo">
<article class="panel-card"><div class="pic"><img src="{A['comic']}" alt="A page from the comic One Damned Good Thing"></div><div class="txt"><h3>13 comics, panel by panel</h3><p>Ichabod Jones: Monster Hunter, the Godsverse comics, Paradise and more, made to read on your phone.</p></div></article>
<article class="panel-card"><div class="pic weavepic"><svg viewBox="0 0 700 520" role="img" aria-label="The nine threads of the Weave" style="width:100%;height:100%;display:block;background:radial-gradient(ellipse at 50% 40%,#1b1330,#0b0812)"><polyline points="0,40.0 10,43.0 20,45.9 30,48.8 40,51.5 50,54.1 60,56.5 70,58.6 80,60.5 90,62.1 100,63.4 110,64.4 120,65.1 130,65.5 140,65.6 150,65.4 160,64.9 170,64.2 180,63.3 190,62.2 200,60.9 210,59.6 220,58.1 230,56.6 240,55.2 250,53.7 260,52.4 270,51.2 280,50.1 290,49.3 300,48.6 310,48.1 320,47.9 330,47.9 340,48.2 350,48.7 360,49.4 370,50.4 380,51.5 390,52.8 400,54.3 410,55.8 420,57.4 430,59.1 440,60.7 450,62.3 460,63.8 470,65.2 480,66.4 490,67.4 500,68.1 510,68.6 520,68.9 530,68.8 540,68.4 550,67.7 560,66.7 570,65.4 580,63.7 590,61.8 600,59.7 610,57.3 620,54.7 630,52.0 640,49.1 650,46.2 660,43.2 670,40.2 680,37.3 690,34.5 700,31.8" fill="none" stroke="#e8b53a" stroke-width="3" stroke-linecap="round" opacity=".9"/><polyline points="0,106.0 10,106.1 20,106.0 30,105.6 40,105.0 50,104.1 60,102.9 70,101.4 80,99.7 90,97.7 100,95.6 110,93.2 120,90.7 130,88.0 140,85.3 150,82.5 160,79.7 170,77.0 180,74.4 190,71.9 200,69.5 210,67.4 220,65.5 230,63.9 240,62.6 250,61.5 260,60.8 270,60.4 280,60.4 290,60.7 300,61.2 310,62.1 320,63.3 330,64.7 340,66.3 350,68.1 360,70.1 370,72.1 380,74.2 390,76.4 400,78.5 410,80.6 420,82.5 430,84.4 440,86.0 450,87.5 460,88.8 470,89.8 480,90.6 490,91.2 500,91.4 510,91.5 520,91.3 530,90.9 540,90.3 550,89.5 560,88.6 570,87.5 580,86.4 590,85.3 600,84.2 610,83.1 620,82.1 630,81.2 640,80.5 650,80.0 660,79.7 670,79.6 680,79.8 690,80.3 700,81.0" fill="none" stroke="#a98bff" stroke-width="3" stroke-linecap="round" opacity=".9"/><polyline points="0,163.6 10,164.0 20,164.1 30,164.0 40,163.6 50,163.1 60,162.3 70,161.4 80,160.4 90,159.3 100,158.2 110,157.1 120,156.1 130,155.1 140,154.2 150,153.6 160,153.0 170,152.7 180,152.6 190,152.8 200,153.2 210,153.9 220,154.8 230,155.9 240,157.3 250,158.9 260,160.7 270,162.6 280,164.7 290,166.8 300,169.0 310,171.2 320,173.4 330,175.5 340,177.4 350,179.2 360,180.9 370,182.2 380,183.4 390,184.2 400,184.8 410,185.0 420,184.9 430,184.5 440,183.7 450,182.7 460,181.3 470,179.6 480,177.7 490,175.6 500,173.2 510,170.7 520,168.1 530,165.4 540,162.7 550,159.9 560,157.3 570,154.7 580,152.2 590,149.9 600,147.8 610,146.0 620,144.3 630,143.0 640,141.9 650,141.0 660,140.5 670,140.2 680,140.2 690,140.4 700,140.8" fill="none" stroke="#e0644f" stroke-width="3" stroke-linecap="round" opacity=".9"/><polyline points="0,211.0 10,209.1 20,207.2 30,205.2 40,203.1 50,201.2 60,199.3 70,197.5 80,195.9 90,194.5 100,193.3 110,192.3 120,191.6 130,191.1 140,191.0 150,191.1 160,191.6 170,192.3 180,193.2 190,194.4 200,195.9 210,197.5 220,199.2 230,201.1 240,203.1 250,205.1 260,207.1 270,209.1 280,210.9 290,212.7 300,214.3 310,215.7 320,216.9 330,217.8 340,218.5 350,218.9 360,219.0 370,218.8 380,218.4 390,217.6 400,216.6 410,215.4 420,213.9 430,212.3 440,210.5 450,208.6 460,206.7 470,204.6 480,202.6 490,200.7 500,198.8 510,197.1 520,195.5 530,194.1 540,193.0 550,192.1 560,191.4 570,191.1 580,191.0 590,191.2 600,191.7 610,192.5 620,193.5 630,194.8 640,196.3 650,197.9 660,199.7 670,201.6 680,203.6 690,205.6 700,207.6" fill="none" stroke="#7fd08a" stroke-width="3" stroke-linecap="round" opacity=".9"/><polyline points="0,253.8 10,252.1 20,250.5 30,249.1 40,248.0 50,247.1 60,246.4 70,246.1 80,246.0 90,246.2 100,246.7 110,247.5 120,248.5 130,249.8 140,251.3 150,252.9 160,254.7 170,256.6 180,258.6 190,260.6 200,262.6 210,264.6 220,266.4 230,268.1 240,269.7 250,271.0 260,272.1 270,273.0 280,273.6 290,273.9 300,274.0 310,273.7 320,273.2 330,272.4 340,271.3 350,270.0 360,268.5 370,266.8 380,265.0 390,263.1 400,261.1 410,259.1 420,257.1 430,255.2 440,253.4 450,251.7 460,250.1 470,248.8 480,247.7 490,246.9 500,246.3 510,246.0 520,246.0 530,246.3 540,246.9 550,247.7 560,248.8 570,250.2 580,251.7 590,253.4 600,255.2 610,257.1 620,259.1 630,261.1 640,263.1 650,265.0 660,266.9 670,268.5 680,270.0 690,271.3 700,272.4" fill="none" stroke="#6fb7e8" stroke-width="3" stroke-linecap="round" opacity=".9"/><polyline points="0,301.3 10,301.0 20,301.0 30,301.3 40,301.9 50,302.8 60,303.8 70,305.2 80,306.7 90,308.4 100,310.2 110,312.2 120,314.2 130,316.2 140,318.2 150,320.1 160,321.9 170,323.6 180,325.1 190,326.4 200,327.4 210,328.2 220,328.7 230,329.0 240,328.9 250,328.6 260,328.0 270,327.1 280,326.0 290,324.6 300,323.1 310,321.4 320,319.5 330,317.6 340,315.6 350,313.6 360,311.6 370,309.7 380,307.9 390,306.2 400,304.8 410,303.5 420,302.5 430,301.7 440,301.2 450,301.0 460,301.1 470,301.5 480,302.1 490,303.0 500,304.2 510,305.5 520,307.1 530,308.9 540,310.7 550,312.7 560,314.7 570,316.7 580,318.6 590,320.5 600,322.3 610,324.0 620,325.4 630,326.6 640,327.6 650,328.4 660,328.8 670,329.0 680,328.9 690,328.5 700,327.8" fill="none" stroke="#e88fb4" stroke-width="3" stroke-linecap="round" opacity=".9"/><polyline points="0,359.2 10,360.6 20,362.1 30,363.9 40,365.7 50,367.7 60,369.7 70,371.7 80,373.7 90,375.6 100,377.4 110,379.0 120,380.4 130,381.7 140,382.6 150,383.4 160,383.8 170,384.0 180,383.9 190,383.5 200,382.8 210,381.8 220,380.7 230,379.2 240,377.6 250,375.9 260,374.0 270,372.1 280,370.0 290,368.0 300,366.1 310,364.2 320,362.4 330,360.8 340,359.4 350,358.2 360,357.2 370,356.6 380,356.1 390,356.0 400,356.2 410,356.6 420,357.3 430,358.3 440,359.5 450,360.9 460,362.6 470,364.3 480,366.2 490,368.2 500,370.2 510,372.2 520,374.2 530,376.0 540,377.8 550,379.4 560,380.8 570,381.9 580,382.9 590,383.5 600,383.9 610,384.0 620,383.8 630,383.3 640,382.6 650,381.6 660,380.3 670,378.9 680,377.2 690,375.4 700,373.5" fill="none" stroke="#d9c38a" stroke-width="3" stroke-linecap="round" opacity=".9"/><polyline points="0,425.2 10,427.2 20,429.2 30,431.1 40,432.8 50,434.4 60,435.8 70,436.9 80,437.9 90,438.5 100,438.9 110,439.0 120,438.8 130,438.3 140,437.6 150,436.6 160,435.3 170,433.8 180,432.2 190,430.4 200,428.5 210,426.5 220,424.5 230,422.5 240,420.6 250,418.7 260,417.0 270,415.4 280,414.1 290,412.9 300,412.0 310,411.4 320,411.1 330,411.0 340,411.2 350,411.8 360,412.5 370,413.6 380,414.9 390,416.4 400,418.0 410,419.8 420,421.7 430,423.7 440,425.7 450,427.7 460,429.7 470,431.5 480,433.2 490,434.8 500,436.1 510,437.2 520,438.1 530,438.6 540,439.0 550,439.0 560,438.7 570,438.2 580,437.3 590,436.3 600,435.0 610,433.4 620,431.8 630,429.9 640,428.0 650,426.0 660,424.0 670,422.0 680,420.1 690,418.3 700,416.6" fill="none" stroke="#8fd3c6" stroke-width="3" stroke-linecap="round" opacity=".9"/><polyline points="0,491.1 10,492.2 20,493.1 30,493.7 40,494.0 50,494.0 60,493.7 70,493.1 80,492.3 90,491.2 100,489.9 110,488.4 120,486.7 130,484.9 140,483.0 150,481.0 160,479.0 170,477.0 180,475.1 190,473.2 200,471.6 210,470.0 220,468.7 230,467.7 240,466.8 250,466.3 260,466.0 270,466.0 280,466.4 290,466.9 300,467.8 310,468.9 320,470.2 330,471.8 340,473.5 350,475.3 360,477.3 370,479.3 380,481.3 390,483.3 400,485.2 410,487.0 420,488.6 430,490.1 440,491.4 450,492.5 460,493.2 470,493.8 480,494.0 490,493.9 500,493.6 510,493.0 520,492.1 530,490.9 540,489.6 550,488.0 560,486.3 570,484.4 580,482.5 590,480.5 600,478.5 610,476.5 620,474.6 630,472.8 640,471.2 650,469.7 660,468.4 670,467.4 680,466.7 690,466.2 700,466.0" fill="none" stroke="#c9a0e8" stroke-width="3" stroke-linecap="round" opacity=".9"/><circle cx="250" cy="110" r="5" fill="#ece3d0"/><circle cx="250" cy="110" r="11" fill="none" stroke="#ece3d0" stroke-opacity=".35"/><circle cx="470" cy="95" r="5" fill="#ece3d0"/><circle cx="470" cy="95" r="11" fill="none" stroke="#ece3d0" stroke-opacity=".35"/><circle cx="360" cy="300" r="5" fill="#ece3d0"/><circle cx="360" cy="300" r="11" fill="none" stroke="#ece3d0" stroke-opacity=".35"/><circle cx="300" cy="262" r="5" fill="#ece3d0"/><circle cx="300" cy="262" r="11" fill="none" stroke="#ece3d0" stroke-opacity=".35"/><circle cx="160" cy="380" r="5" fill="#ece3d0"/><circle cx="160" cy="380" r="11" fill="none" stroke="#ece3d0" stroke-opacity=".35"/><text x="18" y="28" fill="#e8b53a" font-family="Cinzel,serif" font-size="17" font-weight="700" paint-order="stroke" stroke="#0e0a17" stroke-width="7" stroke-linejoin="round">Thread 1</text><text x="682" y="28" fill="#9b91ac" font-family="Cormorant Garamond,serif" font-style="italic" font-size="16" text-anchor="end" paint-order="stroke" stroke="#0e0a17" stroke-width="7" stroke-linejoin="round">The Obsidian Spindle, Dragon Strife</text><text x="18" y="83" fill="#a98bff" font-family="Cinzel,serif" font-size="17" font-weight="700" paint-order="stroke" stroke="#0e0a17" stroke-width="7" stroke-linejoin="round">Thread 27</text><text x="682" y="83" fill="#9b91ac" font-family="Cormorant Garamond,serif" font-style="italic" font-size="16" text-anchor="end" paint-order="stroke" stroke="#0e0a17" stroke-width="7" stroke-linejoin="round">The Godsverse</text><text x="18" y="138" fill="#e0644f" font-family="Cinzel,serif" font-size="17" font-weight="700" paint-order="stroke" stroke="#0e0a17" stroke-width="7" stroke-linejoin="round">Thread 26</text><text x="682" y="138" fill="#9b91ac" font-family="Cormorant Garamond,serif" font-style="italic" font-size="16" text-anchor="end" paint-order="stroke" stroke="#0e0a17" stroke-width="7" stroke-linejoin="round">Quest Girls</text><text x="18" y="193" fill="#7fd08a" font-family="Cinzel,serif" font-size="17" font-weight="700" paint-order="stroke" stroke="#0e0a17" stroke-width="7" stroke-linejoin="round">Thread 25</text><text x="682" y="193" fill="#9b91ac" font-family="Cormorant Garamond,serif" font-style="italic" font-size="16" text-anchor="end" paint-order="stroke" stroke="#0e0a17" stroke-width="7" stroke-linejoin="round">Ichabod Jones</text><text x="18" y="248" fill="#6fb7e8" font-family="Cinzel,serif" font-size="17" font-weight="700" paint-order="stroke" stroke="#0e0a17" stroke-width="7" stroke-linejoin="round">The Shared Thread</text><text x="682" y="248" fill="#9b91ac" font-family="Cormorant Garamond,serif" font-style="italic" font-size="16" text-anchor="end" paint-order="stroke" stroke="#0e0a17" stroke-width="7" stroke-linejoin="round">Six lives on near-present Earth</text><text x="18" y="303" fill="#e88fb4" font-family="Cinzel,serif" font-size="17" font-weight="700" paint-order="stroke" stroke="#0e0a17" stroke-width="7" stroke-linejoin="round">Wonderland</text><text x="682" y="303" fill="#9b91ac" font-family="Cormorant Garamond,serif" font-style="italic" font-size="16" text-anchor="end" paint-order="stroke" stroke="#0e0a17" stroke-width="7" stroke-linejoin="round">Down the rabbit hole</text><text x="18" y="358" fill="#d9c38a" font-family="Cinzel,serif" font-size="17" font-weight="700" paint-order="stroke" stroke="#0e0a17" stroke-width="7" stroke-linejoin="round">The Pocket Dimension</text><text x="682" y="358" fill="#9b91ac" font-family="Cormorant Garamond,serif" font-style="italic" font-size="16" text-anchor="end" paint-order="stroke" stroke="#0e0a17" stroke-width="7" stroke-linejoin="round">Worst Thing in the Universe, Paradise</text><text x="18" y="413" fill="#8fd3c6" font-family="Cinzel,serif" font-size="17" font-weight="700" paint-order="stroke" stroke="#0e0a17" stroke-width="7" stroke-linejoin="round">Invasion</text><text x="682" y="413" fill="#9b91ac" font-family="Cormorant Garamond,serif" font-style="italic" font-size="16" text-anchor="end" paint-order="stroke" stroke="#0e0a17" stroke-width="7" stroke-linejoin="round">The end of the world</text><text x="18" y="468" fill="#c9a0e8" font-family="Cinzel,serif" font-size="17" font-weight="700" paint-order="stroke" stroke="#0e0a17" stroke-width="7" stroke-linejoin="round">The Marked Ones</text><text x="682" y="468" fill="#9b91ac" font-family="Cormorant Garamond,serif" font-style="italic" font-size="16" text-anchor="end" paint-order="stroke" stroke="#0e0a17" stroke-width="7" stroke-linejoin="round">Magic is the enemy</text></svg></div><div class="txt"><h3>The Weave: nine threads, 864 secrets</h3><p>Every universe in these stories is a thread, and they cross where you least expect. Every book you finish unlocks more of the 479 characters, 108 places, 63 relics and 35 powers between them. Climb from Unwoven to Architect of the Weave.</p>
<div class="xp"><div class="track"><i></i></div><div class="ends"><span>Unwoven</span><span>Architect of the Weave</span></div></div>
<ul class="quests"><li><span>Finish a book</span><b>+50 XP</b></li><li><span>Find a relic</span><b>+20 XP</b></li><li><span>Complete a thread</span><b>+100 XP</b></li></ul></div></article>
</div>
</div></section>

<section class="s keep"><div class="in">
<div class="head"><h2>Yours to keep, through BookFunnel.</h2><p>The app is the fun part. You also own the files. Everything is delivered through BookFunnel too, to read and listen to on any device, forever. No app required.</p></div>
<div class="files"><div><b>Ebooks</b><span>ePub for any reader</span></div><div><b>Audiobooks</b><span>Listen anywhere</span></div><div><b>Audio commentary</b><span>Russell on how they were made</span></div><div><b>Full comics</b><span>Every page, to keep</span></div></div>
<p class="bf">150+ DRM-free files. Not a subscription. If you never open the app again, they are still yours.</p>
</div></section>

<section class="s offerwrap" id="get" style="background:var(--panel);border-top:1px solid var(--edge);border-bottom:1px solid var(--edge)"><div class="in">
<div class="head"><h2>Step into the Weave.</h2><p>Every book, comic and story game for one price, and files you keep forever.</p></div>
{offer()}
<p class="retail">Bought one by one in Russell's shop, the books and comics alone come to $260, before Quest Girls, Wonderland or a single story game. Here it is all of that, plus the games and the Weave, for $99.99.</p>
</div></section>

<section class="s"><div class="in">
<div class="head"><h2>Only want one world?</h2><p>Each one is a one-time price and unlocks on every device you sign in on.</p></div>
<ul class="worlds">{world_html}</ul>
</div></section>

<section class="s" style="padding-top:20px"><div class="in">
<div class="head"><h2>Before you buy</h2></div><div class="faq">{faq_html}</div>
<p class="center mt"><a class="buy" href="{BUY}">Get everything for $99.99</a></p>
</div></section>
</main>
<footer><p class="stores"><a href="https://apps.apple.com/us/app/wannabe-press-thread-weaver/id6785677915">Get it on the App Store</a><a href="https://play.google.com/store/apps/details?id=com.russellnohelty.threadweaver">Get it on Google Play</a></p><p>Wannabe Press. Dark fantasy, myth, horror and comics by Russell Nohelty.</p><a href="{TW}/privacy.html">Privacy</a><a href="{TW}/delete-account.html">Delete your account</a><a href="mailto:help@wannabepress.com">help@wannabepress.com</a></footer>
<div class="sticky" id="stick" aria-hidden="true"><span>Everything <b>$99.99</b></span><a href="{BUY}" tabindex="-1">Get it</a></div>
<div class="modal" id="m" role="dialog" aria-modal="true" aria-labelledby="mt"><div class="mbox">
<button class="mx" type="button" aria-label="Close" onclick="closeM()">&times;</button>
<div class="mtop"><img id="mc" alt=""><div><h3 id="mt"></h3><p id="mw"></p></div></div>
<a class="opt best" href="{BUY}"><span><span class="badge">Best value</span><b>Everything</b><span>Every world, 49 novels, 13 comics, 7 story games</span></span><em>$99.99</em></a>
<a class="opt" id="mone" href="#"><span><b id="mon"></b><span id="mow"></span></span><em id="mop"></em></a>
<p class="mfine">Paid once. Secure checkout by Stripe. Unlocks on every device you sign in on.</p>
</div></div>
<script>
var COV=__COVERS__;
(function(){{var hb=document.querySelector('.hero .buy'),st=document.getElementById('stick');if(!hb||!st||!('IntersectionObserver' in window)){{if(st)st.classList.add('on');return;}}
new IntersectionObserver(function(es){{var gone=!es[0].isIntersecting&&es[0].boundingClientRect.top<0;st.classList.toggle('on',gone);st.setAttribute('aria-hidden',gone?'false':'true');st.querySelector('a').tabIndex=gone?0:-1;}},{{threshold:0}}).observe(hb);}})();
var m=document.getElementById('m'),last=null;
document.querySelectorAll('.door').forEach(function(d){{d.addEventListener('click',function(){{
 last=d; document.getElementById('mt').textContent=d.dataset.name; document.getElementById('mw').textContent=d.dataset.what||'';
 document.getElementById('mc').src=COV[d.dataset.cover]||'';
 var one=document.getElementById('mone');
 if(d.dataset.buy){{one.style.display='';one.href=d.dataset.buy;document.getElementById('mon').textContent='Just '+d.dataset.name;document.getElementById('mow').textContent=d.dataset.what;document.getElementById('mop').textContent=d.dataset.price;}}
 else one.style.display='none';
 m.classList.add('on'); m.querySelector('.opt.best').focus();
}});}});
function closeM(){{m.classList.remove('on'); if(last) last.focus();}}
m.addEventListener('click',function(ev){{if(ev.target===m)closeM();}});
document.addEventListener('keydown',function(ev){{if(ev.key==='Escape'&&m.classList.contains('on'))closeM();}});
</script>
</body></html>'''
page=page.replace('__COVERS__',COVERS_JS)
open('/home/claude/threadweaver/www/index.html','w').write(page); print(len(page)//1024,'KB')
