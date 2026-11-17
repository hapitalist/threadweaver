# -*- coding: utf-8 -*-
# Everything the Wannabe Press site says, in one place. build.py turns it into pages.
# Copy for the series and books comes from Russell's own russellnohelty.com pages.

TW = "https://thread.wannabepress.com"
SHOP = "https://store.russellnohelty.com"

def tw_book(i): return f"{TW}/app?book={i}"
def tw_serial(i): return f"{TW}/app?serial={i}"
def shop(slug): return f"{SHOP}/l/{slug}"

SERIES = [
 dict(slug="quest-girls", name="Quest Girls", weave=True, img=None,
  tag="A cursed quest-guide and a runaway princess.",
  meta="App exclusive · Thread Weaver",
  desc=["A serial across fairy courts, the Abyssal Auction, Hell’s bureaucracy and a remade Heaven.",
        "Quest Girls isn’t sold anywhere else. The only place to read it is the app, and F*ck Fairy is free."],
  start=dict(title="F*ck Fairy", note="Book 1. Free in the app.", btn="Read F*ck Fairy free", url=tw_book("quest-girls-01-fuck-fairy")),
  serial="quest-girls", unlock="F*ck Fairy free · the rest $20", bundle="quest_girls_series",
  order_label="4 BOOKS",
  books=[
   dict(label="Book 1 · Free in the app", title="F*ck Fairy", tw="quest-girls-01-fuck-fairy", free=True,
        hook="A cursed con artist. A runaway princess. A quest through Fairy and Hell that nobody asked for."),
   dict(label="Book 2", title="Go to Hell", tw="quest-girls-02-go-to-hell"),
   dict(label="Book 3", title="Gods Damned", tw="quest-girls-03-gods-damned"),
   dict(label="Book 4", title="Cosmic Bastards", tw="quest-girls-04-cosmic-bastards"),
  ],
  long=["Lacey has been immortal for 324 years, and she has the worst luck in any realm. Every crown she earns vanishes, whether it's stolen, burned, or swallowed by some freak disaster. She once watched an airship bank collapse the day after she invested.",
        "These days she's aged out of taking quests herself. So she guides spoiled princes through staged dragon fights and bills their royal parents for the cover-up.",
        "It's a living. Barely.",
        "Then Princess Margaret corners her with seven words: I know how to break your curse.",
        "That night, the queen is murdered, the palace blames Lacey, and the two of them dive through a portal with a million-euro bounty on Lacey's tail.",
        "Now the only way out runs through Fairy, a realm that hates humans. Pixie royalty wants to eat them. A monster auction wants to sell them. And the prim princess turns out to be handy with a stolen sword.",
        "Lacey's been running cons for centuries.",
        "She never planned on falling for a princess.",
        "And she never saw the catch coming: breaking the curse might finally kill her."],
  shop=[], shop_note="Quest Girls isn’t sold anywhere else.", reviews=[]),

 dict(slug="godsverse", name="The Godsverse Chronicles", weave=True, img="change",
  tag="All gods are real… they’re just dicks.",
  meta="13 novels + 4 comics · Mythic portal fantasy",
  desc=["Every time a new world forms, every pantheon shows up to make it livable. Then the gods move on and leave one of their own behind as regent. Some rule well. Others downright suck.",
        "Across the series the characters travel to Heaven, Hell, Mount Olympus, Valhalla, other planets and other dimensions, through Greek, Roman, Norse, Egyptian and Judeo-Christian mythology. It’s fast-paced and full of plot twists."],
  start=dict(title="Change", note="The prequel. Free when you join my reader list.", btn="Get Change free", url="https://dl.bookfunnel.com/zdyn1info6"),
  serial="godsverse", unlock="Unlock the series in the app · $50", bundle="godsverse_series",
  order_label="13 BOOKS",
  books=[
   dict(label="Book 0 · Prequel", title="Change", img="change", tw="00-change", hook="One last job. Then she’ll retire. But this job just might kill her."),
   dict(label="Book 1", title="Magic", img="magic", tw="01-magic", hook="Ollie wasn’t looking for trouble, but it came for her anyway."),
   dict(label="Book 2", title="Evil", img="evil", tw="02-evil", hook="Anjelica’s mother never told her that she was a demon."),
   dict(label="Book 3", title="Time", img="time", tw="03-time", hook="In the ashes of her past, she will rise up, and her death will save us all."),
   dict(label="Book 4", title="Heaven", img="heaven", tw="04-heaven", hook="Heaven is fractured. Hell is about to burst. Earth is a powder keg."),
   dict(label="Book 5", title="Death", img="death", tw="05-death", hook="All gods are real… they’re just dicks."),
   dict(label="Book 6", title="Doom", img="doom", tw="06-doom", hook="The Universe is a dangerous place… even for the gods."),
   dict(label="Book 7", title="Hell", img="hell", tw="07-hell", hook="Living is the best revenge… even if it’s living in Hell."),
   dict(label="Book 8", title="Ruin", img="ruin", tw="08-ruin", hook="Pixies are real. They are being hunted. Julia Freeman must protect them."),
   dict(label="Book 9", title="Conquest", img="conquest", tw="09-conquest", hook="The Lords of Hell collude to ruin Katrina and end her reign as Devil."),
   dict(label="Book 10", title="Darkness", img="darkness", tw="10-darkness", hook="Death consumed her, until she embraced it."),
   dict(label="Book 11", title="Chaos", img="chaos", tw="11-chaos", hook="The end of the Universe is coming, and it will consume everything in its wake."),
   dict(label="Book 12", title="Eternity", img="eternity", tw="12-eternity", hook="Freedom is worth any cost."),
  ],
  comics=[
   dict(title="Katrina Hates the Dead", img="katrina", hook="What would you do during the Apocalypse? How would you survive?"),
   dict(title="Black Market Heroine", img="bmh", hook="Ollie wasn’t looking for trouble, but after she saved the Antichrist from being slaughtered, it came for her."),
   dict(title="Pixie Dust", img="pixiedust", hook="A pixie monster hunter is betrayed, murdered, and comes back as a zombie for revenge."),
   dict(title="Paradise", img="paradise", hook="A man who gets frozen and wakes up in a dystopian future where nothing is what it seems."),
  ],
  shop=[dict(t="The complete series", p="Pay what you want", d="4,500+ pages, plus 118 hours of audiobooks and audio commentary.", u=shop("godsversecomplete")),
        dict(t="Godsverse comics", p="$10 each", d="Katrina Hates the Dead, Black Market Heroine and Pixie Dust, each with free audio commentary.", u=shop("katrina"))],
  shop_main=shop("godsversecomplete"),
  also=dict(title="Bulletins at the End of the World", img="bulletins-at-the-end-of-the-world", kind="Short stories · Fantasy · Horror", url=tw_book("bulletins-at-the-end-of-the-world")),
  reviews=[dict(q="How can a book be so violent and hilarious and brilliant at the same time?", who="S.E. Anderson", on="Katrina Hates the Dead")]),

 dict(slug="obsidian-spindle", name="The Obsidian Spindle Saga", weave=True, img="sleeping-beauty",
  tag="Fairy tales are real.",
  meta="12 novels + a story RPG · YA portal fantasy",
  desc=["Rose Briar can’t afford her insulin. She falls into a coma and wakes in the Dream Realm, where every fairy tale is alive and the Wicked Witch wants her dead. Her only way home is the Obsidian Spindle, one of the most powerful objects in the universe.",
        "Three arcs move from the Dream and Nightmare Realms to the Underworld and the Fairy Realm, then to the Celestial Realm and the Dark Planet, told from viewpoints all across the world of Urgu. Every book ends on a cliffhanger, and you can jump in at Book 1, 5 or 9."],
  start=dict(title="The Sleeping Beauty", note="Book 1. Free download.", btn="Get it free", url="https://dl.bookfunnel.com/bj27ih641p"),
  serial="obsidian-spindle", unlock="Unlock the series in the app · $50", bundle="obsidian_series",
  order_label="12 BOOKS",
  books=[
   dict(label="Book 1 · Arc 1 starts here", title="The Sleeping Beauty", img="sleeping-beauty", tw="01-the-sleeping-beauty-generic", hook="Fairy tales are real."),
   dict(label="Book 2", title="The Wicked Witch", img="wicked-witch", tw="02-the-wicked-witch-generic", hook="Ding dong. The Wicked Witch has fallen."),
   dict(label="Book 3", title="The Fairy Queen", img="fairy-queen", tw="03-the-fairy-queen-generic", hook="The Queen of Oz is dead. Long live the queen."),
   dict(label="Book 4", title="The Red Rider", img="red-rider", tw="04-the-red-rider-generic", hook="The end is nigh. The Dream Realm will fall. All is lost."),
   dict(label="Book 5 · Arc 2 starts here", title="The Sword Wielder", img="sword-wielder", tw="05-the-sword-wielder-generic", hook="Adventure is calling… and it can go screw itself."),
   dict(label="Book 6", title="The Dark Prince", img="dark-prince", tw="06-the-dark-prince-generic", hook="Even death cannot stop true love."),
   dict(label="Book 7", title="The Dragon Warrior", img="dragon-warrior", tw="07-the-dragon-warrior-generic", hook="The Underworld teeters on the verge of collapse."),
   dict(label="Book 8", title="The Sunken Kingdom", img="sunken-kingdom", tw="08-the-sunken-kingdom-generic", hook="The Fairy Realm has been fractured for too long."),
   dict(label="Book 9 · Arc 3 starts here", title="The Faceless Woman", img="faceless-woman", tw="09-the-faceless-woman-generic", hook="Death would have been a mercy."),
   dict(label="Book 10", title="The Drowned Princess", img="drowned-princess", tw="10-the-drowned-princess-generic", hook="The universe inches closer to doom."),
   dict(label="Book 11", title="The Golden Locket", img="golden-locket", tw="11-the-golden-locket", hook="Hope will get you nowhere."),
   dict(label="Book 12", title="The Dark Planet", img="dark-planet", tw="12-the-dark-planet-generic", hook="The universe will never be the same."),
  ],
  shop=[dict(t="The complete series", p="$40+", d="All twelve books, direct from me.", u=shop("dbptdz"))],
  shop_main=shop("dbptdz"),
  reviews=[dict(q="Great story! Really loved everything about it.", who="Dennis", on="The Sleeping Beauty", url="https://www.goodreads.com/book/show/220487313-the-sleeping-beauty")]),

 dict(slug="dragon-strife", name="Dragon Strife", weave=True, img="dragon-scourge",
  tag="Gilda will die today.",
  meta="5 books + a story RPG · YA epic fantasy",
  desc=["Gilda has lived her whole life for one purpose: to be sacrificed to the great dragon lord Ewig. The city gave her riches and the finest food, and everyone resented her for it. Tonight she walks up the volcano to the dragon’s keep.",
        "Dragon sacrifice stories usually belong to the hero who saves the damsel. This one asks what happens when the sacrifice becomes the hero, and what the people society casts out can do to change the world. The story continues in Wicked Bodies and Wicked Minds."],
  start=dict(title="The Dragon Scourge", note="Book 1.", btn="Read it free, chapter by chapter", url=tw_serial("dragon-strife")),
  serial="dragon-strife", unlock="Unlock the series in the app · $20", bundle="dragonstrife_series",
  order_label="5 BOOKS",
  books=[
   dict(label="Book 1", title="The Dragon Scourge", img="dragon-scourge", tw="01-the-dragon-scourge", hook="Gilda will die today."),
   dict(label="Book 2", title="The Dragon Champion", img="dragon-champion", tw="02-the-dragon-champion", hook="There will be a reckoning."),
   dict(label="Book 3", title="The Dragon Goddess", img="dragon-goddess", tw="03-the-dragon-goddess", hook="The emperor will pay for his insolence."),
   dict(label="Book 4 · Wicked Witch Academy 1", title="Wicked Bodies", img="wwa-bodies", tw="04-wicked-bodies", hook="I should be dead."),
   dict(label="Book 5 · Wicked Witch Academy 2", title="Wicked Minds", img="wwa-minds", tw="05-wicked-minds", hook="My mother is alive."),
  ],
  shop=[dict(t="The complete trilogy", p="$15", d="Plus the audio commentary for all three books, free.", u=shop("dragonstrife")),
        dict(t="Wicked Witch Academy (books 4–5)", p="$10", d="Wicked Bodies and Wicked Minds, plus the audio commentary free.", u=shop("wtmdih"))],
  shop_main=shop("dragonstrife"), reviews=[]),

 dict(slug="ichabod-jones", name="Ichabod Jones: Monster Hunter", weave=True, img="ichabod-1",
  tag="A mental patient wakes up in an asylum and must become a monster hunter.",
  meta="4 comics + a story RPG · Horror comedy",
  desc=["Ichabod wakes up in the Apocalypse with a monster trying to devour his soul. He breaks a band of inmates out of the asylum and leads them across the desert, never sure if he’s killing monsters, humans, or if it’s all in his head.",
        "Think Lovecraft’s Dreamlands, only funnier and gorier. A complete fantastical and psychological mindscrew. There’s also a card game, made with the German publisher Wredespiele."],
  start=dict(title="Volume 1", note="Start at the beginning.", btn="Read on Thread Weaver", url=f"{TW}/app"),
  serial=None, unlock="Unlock the series in the app · $20", bundle="ichabod_series",
  order_label="4 VOLUMES", comic=True,
  books=[dict(label=f"Volume {n}", title=f"Volume {n}", img=f"ichabod-{n}") for n in (1,2,3,4)],
  shop=[dict(t="The complete series, vol. 1–4", p="$40+", d="Plus the audio commentary for all four volumes, free.", u=shop("ichabodcomplete")),
        dict(t="Hardcovers", p="$30", d="Ichabod Jones in hardcover. Your choice from nine Wannabe Press hardcovers.", u=shop("hardcoverbook"))],
  shop_main=shop("ichabodcomplete"),
  reviews=[dict(q="This is definitely more Hannibal than Buffy.", who="Ken G.", on="Ichabod Jones", url="https://www.goodreads.com/book/show/25052119-ichabod-jones"),
           dict(q="This story keeps you glued to the pages.", who="Kaye", on="Ichabod Jones", url="https://www.goodreads.com/book/show/25052119-ichabod-jones")]),

 dict(slug="wonderland", name="The Wonderland Duology", weave=False, img="white-rabbit",
  tag="Wonderland. Dark. Grimy. Unsavory.",
  meta="2 novels · Noir mystery",
  desc=["Wonderland was a lively place under the Red Queen, until she was arrested and the city banned White Rabbit, the drug she’d laced into the water supply. Now the NARCO police run the streets, and Alice Liddell joins them to keep the drugs out.",
        "When a new dealer threatens the fragile peace, Alice has to stop them before the city comes down around her. Black Jack finishes the story."],
  start=dict(title="White Rabbit", note="Both books are free in the app.", btn="Read White Rabbit free", url=tw_book("01-white-rabbit-nohelty-bookfunnel-2023-10-13-generic")),
  serial="wonderland", unlock="Both books free in the app", bundle=None,
  order_label="2 BOOKS",
  books=[
   dict(label="Book 1 · Free", title="White Rabbit", img="white-rabbit", tw="01-white-rabbit-nohelty-bookfunnel-2023-10-13-generic", free=True, hook="Wonderland. Dark. Grimy. Unsavory."),
   dict(label="Book 2 · Free", title="Black Jack", img="black-jack", tw="02-black-jack-nohelty-bookfunnel-2023-10-13-generic", free=True, hook="Alice failed."),
  ],
  shop=[dict(t="Preorder the print editions", p="BackerKit", d="Print editions through BackerKit.", u="https://wonderland.backerkit.com/hosted_preorders")],
  shop_main="https://wonderland.backerkit.com/hosted_preorders",
  reviews=[dict(q="Dark, dirty, grimy. That’s the Wonderland Nohelty shows.", who="Brandon", on="White Rabbit", url="https://www.goodreads.com/book/show/36465661-white-rabbit")]),

 dict(slug="cthulhu", name="Cthulhu Is Hard to Spell", weave=False, img="cth-vol1",
  tag="More than 100 full-color comic stories from 200+ creators.",
  meta="3 hardcover anthologies · All-ages comics",
  desc=["More than 100 full-color comic stories from 200+ creators, including Trina Robbins, David Pepose, Paul Jenkins and Lea Hernandez, across 500+ pages.",
        "Made for people who know nothing about Lovecraft as much as for people who love him deep in their bones. I edited all three and wrote a story for each."],
  start=dict(title="Cthulhu Is Hard to Spell", note="Volume 1.", btn="Get the bundle", url=shop("cthulhuishardtospell")),
  serial=None, unlock=None, bundle=None, no_tw=True,
  order_label="3 VOLUMES", comic=True,
  books=[
   dict(label="Volume 1", title="Cthulhu Is Hard to Spell", img="cth-vol1", hook="With my story Azathoth Slumbers."),
   dict(label="Volume 2", title="The Terrible Twos", img="cth-terrible-twos", hook="With my story Good Kitty."),
   dict(label="Volume 3", title="Battle Royale", img="cth-battle-royale", hook="With my title story, Battle Royale."),
  ],
  shop=[dict(t="The mega-anthology bundle", p="$30", d="All three volumes, nearly 500 pages.", u=shop("cthulhuishardtospell")),
        dict(t="Hardcovers", p="$30", d="Cthulhu Is Hard to Spell in hardcover. Your choice from nine.", u=shop("hardcoverbook"))],
  shop_main=shop("cthulhuishardtospell"), reviews=[]),
]
SERIES_BY = {s["slug"]: s for s in SERIES}

# Standalone novels with their own pages (copy from russellnohelty.com/books/...)
import json, os
_here = os.path.dirname(__file__)
BOOKS = {}
for f in ("books1.json", "books2.json", "books3.json"):
    BOOKS.update(json.load(open(os.path.join(_here, f), encoding="utf-8")))
SHOP_SLUG = {"invasion":"invasion","markedones":"markedones","thevessel":"thevessel","thevoid":"voidaudiodrama","anna":"anna",
             "worstthing":"worstthing","tiafc":"yjwajm","skritchsrevenge":"xtijuu","vengeance":"ejxbkd","sorryforexisting":"sorryforexisting",
             "mfdkh":"mfdkh","gumshoes":"gumshoes"}
BOOK_IMG = {"invasion":"invasion","markedones":"the-marked-ones","thevessel":"the-vessel","thevoid":"the-void-calls-us-home","anna":"anna-and-the-dark-place",
            "worstthing":"worst-thing-in-the-universe","tiafc":"time-is-a-flat-circle","skritchsrevenge":"skritchs-revenge","vengeance":"vengeance",
            "sorryforexisting":"sorry-for-existing","mfdkh":"my-father-didnt-kill-himself","gumshoes":"gumshoes"}
BOOK_ORDER = ["invasion","markedones","thevessel","thevoid","anna","worstthing","tiafc","skritchsrevenge","vengeance","sorryforexisting","mfdkh","gumshoes"]

# Other standalones (no page of their own yet): where each one lives
OTHER_STANDALONES = [
 dict(title="Bulletins at the End of the World", img="bulletins-at-the-end-of-the-world", kind="Short stories · Fantasy · Horror", weave=True, url=tw_book("bulletins-at-the-end-of-the-world"), free=True),
 dict(title="Paradise", img="paradise", kind="Comics · Sci-fi", weave=True, url=f"{TW}/app"),
 dict(title="The Wannabes", img="the-wannabes", kind="All ages · Comics · Fantasy", weave=True, url=SHOP),
 dict(title="The Little Bird and the Little Worm", img="the-little-bird-and-the-little-worm", kind="Children’s picture book", weave=False, url=SHOP),
 dict(title="How NOT to Invade Earth", img="how-not-to-invade-earth", kind="All ages · Comics · Humor · Sci-fi", weave=False, url=f"{TW}/app", free=True),
 dict(title="Gherkin Boy and the Dollar of Destiny", img="gherkin-boy", kind="Comics · Sci-fi · Humor", weave=False, url=f"{TW}/app", free=True),
 dict(title="One Damned Good Thing", img="one-damned-good-thing", kind="Comics · Horror", weave=False, url=f"{TW}/app", free=True),
 dict(title="Death’s Kiss", img="deaths-kiss", kind="Comics · Fantasy", weave=False, url=SHOP),
 dict(title="Lucifer Licorice", img="lucifer-licorice", kind="All ages · Comics · Fantasy · Humor", weave=False, url=SHOP),
]

REVIEWS = [
 dict(q="How can a book be so violent and hilarious and brilliant at the same time?", who="S.E. Anderson", on="Katrina Hates the Dead", page="/series/godsverse/"),
 dict(q="This is definitely more Hannibal than Buffy.", who="Ken G.", on="Ichabod Jones", page="/series/ichabod-jones/"),
 dict(q="Dark, dirty, grimy. That’s the Wonderland Nohelty shows.", who="Brandon", on="White Rabbit", page="/series/wonderland/"),
 dict(q="It provided EVERYTHING I look for in an SF story.", who="Aurora", on="Invasion", page="/books/invasion/"),
 dict(q="It had everything a great read should have.", who="Leah S.", on="The Vessel", page="/books/thevessel/"),
 dict(q="Great story! Really loved everything about it.", who="Dennis", on="The Sleeping Beauty", page="/series/obsidian-spindle/"),
]

CREATOR_BOOKS = [
 dict(title="Frictionless Growth!", img="frictionless-growth", note="Start here · free", url="https://www.hapitalist.com/course/frictionless-growth/"),
 dict(title="The Six-Figure Author Stack", img="six-figure-author-stack", note="Book & course", url="https://www.hapitalist.com/courses/"),
 dict(title="Direct Sales Strategy for Authors", img="direct-sales-strategy", note="Book & course", url="https://www.hapitalist.com/course/direct-sales-strategy-for-authors/"),
 dict(title="How to Launch Your Book on Kickstarter", img="launch-kickstarter", note="Book & course", url="https://www.hapitalist.com/course/how-to-launch-your-book-on-kickstarter/"),
 dict(title="On Being Happy and a Successful Writer", img="on-being-happy", note="Book & course", url="https://www.hapitalist.com/course/on-being-happy-and-a-successful-writer/"),
 dict(title="Publishing Is Broken", img="publishing-is-broken", note="Book", url="https://www.hapitalist.com/courses/"),
]
