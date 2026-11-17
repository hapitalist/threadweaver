/* Wannabe Press — "What should I read first?" quiz.
   Sits at the top of every page. Four questions, then a place to start and the book after it.
   Fiction leads to a series or standalone (read free in Thread Weaver); creator business leads to Hapitalist. */
(function () {
  "use strict";
  var TW = "https://thread.wannabepress.com/app";
  var HAP = "https://www.hapitalist.com";

  var FIC = [
    { q: "Pick a first line.", a: [
      { t: "“Fairy tales are real.”", w: { obsidian: 6 } },
      { t: "“All gods are real… they’re just dicks.”", w: { godsverse: 6 } },
      { t: "“Gilda will die today.”", w: { dragon: 6 } },
      { t: "“A mental patient wakes up in an asylum and must become a monster hunter.”", w: { ichabod: 6 } },
      { t: "“A cursed quest-guide and a runaway princess.”", w: { questgirls: 6 } },
      { t: "“Wonderland. Dark. Grimy. Unsavory.”", w: { wonderland: 6 } },
      { t: "“More than 100 comic stories about Lovecraft’s gods and monsters.”", w: { cthulhu: 6 } }
    ]},
    { q: "How do you like to read?", a: [
      { t: "Novels, and plenty of them", w: { godsverse: 2, obsidian: 2, questgirls: 2, dragon: 1, wonderland: 1, standalone: 1 } },
      { t: "Comics", w: { ichabod: 3, cthulhu: 3, godsverse: 1 } },
      { t: "Both, depending on the day", w: { godsverse: 2, ichabod: 1 } },
      { t: "I want to play the story, too", w: { questgirls: 2, obsidian: 2, dragon: 2, ichabod: 2, godsverse: 1 } }
    ]},
    { q: "How dark can it get?", a: [
      { t: "Keep it fun. All ages.", w: { cthulhu: 3, standalone: 1 }, tone: "allages" },
      { t: "YA adventure with real stakes", w: { obsidian: 2, dragon: 2, standalone: 1 }, tone: "ya" },
      { t: "Dark, funny and irreverent", w: { godsverse: 2, questgirls: 2, wonderland: 1 }, tone: "funny" },
      { t: "Full horror, please", w: { ichabod: 2, standalone: 1 }, tone: "horror" }
    ]},
    { q: "How long do you want to stay?", a: [
      { t: "Something I can finish in a sitting or two", w: { standalone: 5, wonderland: 1 } },
      { t: "A short run", w: { dragon: 2, wonderland: 2, ichabod: 2, questgirls: 1, cthulhu: 1 } },
      { t: "A dozen books and a whole mythology", w: { godsverse: 3, obsidian: 3 } }
    ]}
  ];

  var BIZ = [
    { q: "Where is your creative business right now?", a: [
      { t: "I haven’t really started yet", s: "start" },
      { t: "I’m doing a lot, and nothing is sticking", s: "stuck" },
      { t: "One thing works, but I’m spread thin", s: "thin" },
      { t: "It’s working, but I’ve hit a ceiling", s: "ceiling" }
    ]},
    { q: "What do you want most right now?", a: [
      { t: "To sell directly to my readers", b: "direct" },
      { t: "A Kickstarter that actually funds the next book", b: "kickstarter" },
      { t: "To stop burning out", b: "happy" },
      { t: "To know which strategy fits me", b: "frictionless" },
      { t: "Income from more than one channel", b: "stack" },
      { t: "Books readers can’t put down", b: "irresistible" }
    ]},
    { q: "How do you grow best?", a: [
      { t: "In bursts: launches and campaigns", b2: "kickstarter" },
      { t: "By building with partners", b2: "frictionless" },
      { t: "As a guest on other people’s stages", b2: "frictionless" },
      { t: "Through a community that loves what I make", b2: "direct" },
      { t: "Honestly, I’d rather just write", b2: "irresistible" }
    ]},
    { q: "Be honest: how’s your energy?", a: [
      { t: "Fired up and ready to build", e: "up" },
      { t: "Fine, but scattered", e: "mid" },
      { t: "Running on fumes", e: "low" }
    ]}
  ];

  // Fiction results. start/then are what to read first and next.
  var SER = {
    questgirls: { name: "Quest Girls", meta: "App exclusive · 4 books + a story game", line: "A cursed quest-guide and a runaway princess.",
      why: "Lacey is a 324-year-old con artist with the worst luck in any realm. Princess Margaret says she can break the curse. Then the queen is murdered and they flee into Fairy with a bounty on their heads.",
      page: "/series/quest-girls/", start: ["F*ck Fairy", "Book 1. Free in the app."], then: ["Go to Hell", "Book 2."],
      go: [TW + "?book=quest-girls-01-fuck-fairy", "Start reading — free"], serial: "quest-girls", buy: "quest_girls_series", price: "the rest of the series · $20" },
    godsverse: { name: "The Godsverse Chronicles", meta: "13 novels + 4 comics · Mythic portal fantasy", line: "All gods are real… they’re just dicks.",
      why: "Every pantheon builds a world, then leaves one of their own behind to run it. Heaven, Hell, Olympus and Valhalla, fast and full of twists.",
      page: "/series/godsverse/", start: ["Change", "The prequel. Free when you join the reader list."], then: ["Magic", "Ollie wasn’t looking for trouble, but it came for her anyway."],
      go: ["https://dl.bookfunnel.com/zdyn1info6", "Get Change free"], serial: "godsverse", buy: "godsverse_series", price: "the complete series · $50" },
    obsidian: { name: "The Obsidian Spindle Saga", meta: "12 novels + a story RPG · YA portal fantasy", line: "Fairy tales are real.",
      why: "Rose Briar falls into a coma and wakes in the Dream Realm, where every fairy tale is alive and the Wicked Witch wants her dead.",
      page: "/series/obsidian-spindle/", start: ["The Sleeping Beauty", "Book 1. Free download."], then: ["The Wicked Witch", "Ding dong. The Wicked Witch has fallen."],
      go: ["https://dl.bookfunnel.com/bj27ih641p", "Get it free"], serial: "obsidian-spindle", buy: "obsidian_series", price: "the complete series · $50" },
    dragon: { name: "Dragon Strife", meta: "5 books + a story RPG · YA epic fantasy", line: "Gilda will die today.",
      why: "Gilda was raised to be sacrificed to a dragon lord. Tonight she walks up the volcano. This time the sacrifice becomes the hero.",
      page: "/series/dragon-strife/", start: ["The Dragon Scourge", "Book 1."], then: ["The Dragon Champion", "There will be a reckoning."],
      go: [TW + "?serial=dragon-strife", "Read it free, chapter by chapter"], serial: null, buy: "dragonstrife_series", price: "the complete series · $20" },
    ichabod: { name: "Ichabod Jones: Monster Hunter", meta: "4 comics + a story RPG · Horror comedy", line: "A mental patient wakes up in an asylum and must become a monster hunter.",
      why: "Lovecraft’s Dreamlands, only funnier and gorier. Ichabod never knows if he’s killing monsters, humans, or if it’s all in his head.",
      page: "/series/ichabod-jones/", start: ["Volume 1", "Start at the beginning."], then: ["Volume 2", "Keep going."],
      go: [TW, "Read on Thread Weaver"], serial: null, buy: "ichabod_series", price: "all four volumes · $20" },
    wonderland: { name: "The Wonderland Duology", meta: "2 novels · Noir mystery", line: "Wonderland. Dark. Grimy. Unsavory.",
      why: "The Red Queen is gone and her drug is banned. Alice Liddell joins the NARCO police to keep it off the streets. Both books are free.",
      page: "/series/wonderland/", start: ["White Rabbit", "Book 1. Free in the app."], then: ["Black Jack", "Alice failed."],
      go: [TW + "?book=01-white-rabbit-nohelty-bookfunnel-2023-10-13-generic", "Start reading — free"], serial: "wonderland", buy: null },
    cthulhu: { name: "Cthulhu Is Hard to Spell", meta: "3 hardcover anthologies · All-ages comics", line: "More than 100 full-color comic stories from 200+ creators.",
      why: "For people who know nothing about Lovecraft and people who love him deep in their bones. Nearly 500 pages across three volumes.",
      page: "/series/cthulhu/", start: ["Cthulhu Is Hard to Spell", "Volume 1."], then: ["The Terrible Twos", "Volume 2."],
      go: ["https://store.russellnohelty.com/l/cthulhuishardtospell", "Get all three · $30"], serial: null, buy: null, notw: true }
  };
  // Standalones, picked by how dark the reader wants it.
  var SOLO = {
    allages: { book: "gumshoes", name: "Gumshoes: The Case of Madison’s Father", line: "CSI for kids.", tw: "gumshoes-the-case-of-madisons-father", then: ["Invasion", "/books/invasion/"] },
    ya: { book: "invasion", name: "Invasion", line: "The end of the world is a bad time to fall in love.", tw: "invasion", then: ["The Marked Ones", "/books/markedones/"] },
    funny: { book: "worstthing", name: "Worst Thing in the Universe", line: "Albert Ross is the most miserable, pathetic, and terrible thing in the entire universe.", tw: "worst-thing-in-the-universe", then: ["Time is a Flat Circle", "/books/tiafc/"] },
    horror: { book: "thevoid", name: "The Void Calls Us Home", line: "Rebecca never thought she was suicidal.", tw: "the-void-calls-us-home-russell-nohelty", then: ["Anna and the Dark Place", "/books/anna/"] }
  };
  // A quick read in the same flavor as the first line they picked.
  var BYLINE = { godsverse: "funny", questgirls: "flat", obsidian: "marked", dragon: "marked", ichabod: "horror" };
  SOLO.marked = { book: "markedones", name: "The Marked Ones", line: "Magic destroyed the world once. Now, magic users are the enemy.", tw: "the-marked-ones", then: ["Anna and the Dark Place", "/books/anna/"] };
  SOLO.flat = { book: "tiafc", name: "Time is a Flat Circle", line: "A curious thing happened when Larry Lizer woke up this morning.", tw: "time-is-a-flat-circle", then: ["Worst Thing in the Universe", "/books/worstthing/"] };
  var BOOKS = {
    frictionless: ["Frictionless Growth!", "Find the growth path that fits how your brain actually works.", HAP + "/course/frictionless-growth/", "/img/frictionless-growth.webp"],
    direct: ["Direct Sales Strategy for Authors", "Sell straight to your readers: web store, Kickstarter and live events.", HAP + "/course/direct-sales-strategy-for-authors/", "/img/direct-sales-strategy.webp"],
    kickstarter: ["How to Launch Your Book on Kickstarter", "A campaign that actually funds the next book.", HAP + "/course/how-to-launch-your-book-on-kickstarter/", "/img/launch-kickstarter.webp"],
    happy: ["On Being Happy and a Successful Writer at the Same Time", "Build the career without burning yourself down.", HAP + "/course/on-being-happy-and-a-successful-writer/", "/img/on-being-happy.webp"],
    stack: ["The Six-Figure Author Stack", "Income from more than one channel, working together.", HAP + "/courses/", "/img/six-figure-author-stack.webp"],
    irresistible: ["How to Write Irresistible Books That Readers Devour", "Craft the books readers can’t put down.", HAP + "/courses/", null]
  };

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function mount(box) {
    var stage = box.querySelector(".qz-stage");
    var path = null, step = 0, picks = [];
    function hdr(n, total, label) {
      return '<div class="qz-meta"><span>QUESTION ' + n + ' OF ' + total + '</span><span>' + label + '</span></div>';
    }
    function start() {
      path = null; step = 0; picks = [];
      stage.innerHTML = '<p class="qz-q">What are you looking for?</p><div class="qz-opts qz-two">' +
        '<button type="button" class="qz-opt" data-p="fic"><b>A story to fall into</b><small>Gods, fairy tales, dragons, monster hunters and Lovecraft</small></button>' +
        '<button type="button" class="qz-opt" data-p="biz"><b>Help with my creative business</b><small>Direct sales, Kickstarter, craft, and growing without burning out</small></button></div>';
      box.classList.remove("qz-open");
    }
    function ask() {
      var Q = path === "fic" ? FIC : BIZ, qd = Q[step];
      var html = hdr(step + 1, Q.length, path === "fic" ? "FICTION" : "CREATOR BUSINESS") + '<p class="qz-q">' + esc(qd.q) + '</p><div class="qz-opts">';
      qd.a.forEach(function (a, i) { html += '<button type="button" class="qz-opt" data-i="' + i + '"><em>' + "ABCDEFG"[i] + '</em>' + esc(a.t) + '</button>'; });
      html += '</div><button type="button" class="qz-back">← Back</button>';
      stage.innerHTML = html;
      box.classList.add("qz-open");
    }
    function finish() {
      if (path === "fic") ficResult(); else bizResult();
      try { box.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) {}
    }
    function ficResult() {
      var score = {}, tone = "ya";
      picks.forEach(function (a) { for (var k in a.w) score[k] = (score[k] || 0) + a.w[k]; if (a.tone) tone = a.tone; });
      var best = null, bs = -1;
      for (var k in score) if (score[k] > bs) { bs = score[k]; best = k; }
      var first = Object.keys(picks[0].w)[0], quick = picks[3] && picks[3].w.standalone >= 5;
      if (quick && first !== "cthulhu" && first !== "wonderland") best = "standalone";
      if (best === "standalone") {
        var s = SOLO[BYLINE[first]] || SOLO[tone] || SOLO.ya;
        stage.innerHTML = '<div class="qz-res"><span class="qz-k">YOUR FIRST READ · A STANDALONE · FREE IN THE APP</span>' +
          '<h3>' + esc(s.name) + '</h3><p class="qz-line">“' + esc(s.line) + '”</p>' +
          '<div class="qz-btns"><a class="btn" href="' + TW + '?book=' + s.tw + '">Start reading — free</a><a class="btn alt" href="/books/' + s.book + '/">About the book →</a></div>' +
          '<p class="qz-or">Or read it free as a weekly serial, <a href="' + TW + '?serial=' + s.tw + '">one chapter a week</a> · Or get <a href="' + TW + '?buy=everything">everything for $99.99</a></p>' +
          '<ol class="qz-path"><li><span>01 · START WITH</span><b>' + esc(s.name) + '</b></li><li><span>02 · THEN READ</span><b><a href="' + s.then[1] + '">' + esc(s.then[0]) + '</a></b></li></ol>' + again() + '</div>';
        return;
      }
      var r = SER[best];
      var ors = [];
      if (r.serial) ors.push('Or read it free as a weekly serial, <a href="' + TW + '?serial=' + r.serial + '">one chapter a week</a>');
      if (r.buy) ors.push('Or unlock <a href="' + TW + '?buy=' + r.buy + '">' + r.price + '</a>');
      if (!r.notw) ors.push('Or get <a href="' + TW + '?buy=everything">everything for $99.99</a>');
      stage.innerHTML = '<div class="qz-res"><span class="qz-k">YOUR FIRST THREAD · ' + esc(r.meta.toUpperCase()) + '</span>' +
        '<h3>' + esc(r.name) + '</h3><p class="qz-line">“' + esc(r.line) + '”</p><p class="qz-why">' + esc(r.why) + '</p>' +
        '<div class="qz-btns"><a class="btn" href="' + r.go[0] + '">' + esc(r.go[1]) + '</a><a class="btn alt" href="' + r.page + '">About the series →</a></div>' +
        '<p class="qz-or">' + ors.join(" · ") + '</p>' +
        '<ol class="qz-path"><li><span>01 · START WITH</span><b>' + esc(r.start[0]) + '</b><small>' + esc(r.start[1]) + '</small></li>' +
        '<li><span>02 · THEN READ</span><b>' + esc(r.then[0]) + '</b><small>' + esc(r.then[1]) + '</small></li></ol>' + again() + '</div>';
    }
    function bizResult() {
      var stage1 = picks[0].s, want = picks[1].b, grow = picks[2].b2, energy = picks[3].e;
      var first = want;
      if (energy === "low" && want !== "happy") first = "happy";
      var next = first === want ? (grow !== first ? grow : (stage1 === "start" ? "frictionless" : "stack")) : want;
      if (next === first) next = first === "frictionless" ? "stack" : "frictionless";
      var a = BOOKS[first], b = BOOKS[next];
      stage.innerHTML = '<div class="qz-res qz-biz"><span class="qz-k">YOUR FIRST READ · HAPITALIST</span>' +
        (a[3] ? '<img src="' + a[3] + '" alt="" width="120" height="191">' : '') +
        '<h3>' + esc(a[0]) + '</h3><p class="qz-why">' + esc(a[1]) + (energy === "low" && want !== "happy" ? ' Start here, because running on fumes makes every other plan harder.' : '') + '</p>' +
        '<div class="qz-btns"><a class="btn" href="' + a[2] + '">Read it on Hapitalist</a><a class="btn alt" href="' + HAP + '/joy">Talk it through with Joy, free</a></div>' +
        '<ol class="qz-path"><li><span>01 · START WITH</span><b>' + esc(a[0]) + '</b></li><li><span>02 · THEN READ</span><b><a href="' + b[2] + '">' + esc(b[0]) + '</a></b></li></ol>' +
        again('Need a story break? Find your first novel', 'fic') + '</div>';
    }
    function again(other, p) {
      return '<div class="qz-again"><button type="button" class="qz-reset">Take it again</button>' +
        (other ? '<button type="button" class="qz-switch" data-p="' + p + '">' + esc(other) + '</button>' :
                 '<button type="button" class="qz-switch" data-p="biz">Also a writer? Find your business book</button>') + '</div>';
    }
    stage.addEventListener("click", function (e) {
      var t = e.target.closest("button"); if (!t) return;
      if (t.classList.contains("qz-reset")) { start(); return; }
      if (t.dataset.p) { path = t.dataset.p; step = 0; picks = []; ask(); return; }
      if (t.classList.contains("qz-back")) { if (step === 0) start(); else { step--; picks.pop(); ask(); } return; }
      if (t.dataset.i != null) {
        var Q = path === "fic" ? FIC : BIZ;
        picks[step] = Q[step].a[+t.dataset.i]; step++;
        if (step >= Q.length) finish(); else ask();
      }
    });
    var pre = box.getAttribute("data-path");
    if (pre) { path = pre; ask(); } else start();
  }
  function boot() { Array.prototype.forEach.call(document.querySelectorAll(".qz"), mount); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
