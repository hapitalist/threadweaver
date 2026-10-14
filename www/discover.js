/* discover.js — "Where do I start?" quiz + thread-aware next-read recs.
   100% client-side. Reads library.json + weave.json (already bundled). No backend, no auth.
   Exposes window.openDiscover() to launch the quiz, and window.nextReads(bookId) for recs. */
(function () {
  "use strict";

  var LIB = null, WV = null;
  function load() {
    if (LIB && WV) return Promise.resolve();
    return Promise.all([
      fetch("books/library.json").then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
      fetch("books/weave.json").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (a) { LIB = a[0] || []; WV = a[1]; });
  }

  // ---- The quiz: 4 questions, each answer carries genre/series weights ----
  var QUIZ = [
    { q: "What pulls you in?", a: [
      { t: "Gods, myth, and cosmic war", w: { "Mythology": 3, "Epic Fantasy": 2 } },
      { t: "Dark fairy tales, twisted", w: { "Fairy Tale": 3, "Dark Fantasy": 2 } },
      { t: "Real, raw, human stories", w: { "Literary": 3, "Metaphysical": 2 } },
      { t: "Monsters, horror, the weird", w: { "Horror": 3, "Dark Fantasy": 2 } }
    ]},
    { q: "Pick a vibe.", a: [
      { t: "Sweeping and epic", w: { "Epic Fantasy": 3, "Adventure": 1 } },
      { t: "Funny and irreverent", w: { "Comedy": 3, "Adventure": 1 } },
      { t: "Noir, mystery, secrets", w: { "Crime/Noir": 3, "Mystery": 2 } },
      { t: "Strange and mind-bending", w: { "Sci-Fi": 2, "Metaphysical": 2, "Dystopian": 1 } }
    ]},
    { q: "How much do you want to bite off?", a: [
      { t: "A quick standalone", w: { "_standalone": 3 } },
      { t: "A big series to live in", w: { "_series": 3 } },
      { t: "Either — surprise me", w: {} }
    ]},
    { q: "Your ideal hero?", a: [
      { t: "A reluctant chosen one", w: { "Epic Fantasy": 2, "Mythology": 1 } },
      { t: "A sharp-tongued misfit", w: { "Comedy": 2, "Fairy Tale": 1 } },
      { t: "An ordinary person in over their head", w: { "Literary": 2, "Mystery": 1 } },
      { t: "Something inhuman", w: { "Horror": 2, "Dark Fantasy": 1 } }
    ]}
  ];

  function scoreToBook(score) {
    var wantStandalone = (score["_standalone"] || 0) > (score["_series"] || 0);
    var wantSeries = (score["_series"] || 0) > (score["_standalone"] || 0);
    // free books first — we want a new user reading in 30 seconds
    var pool = LIB.filter(function (b) { return b.free; });
    function rank(b) {
      var s = 0;
      (b.genres || []).forEach(function (g) { s += (score[g] || 0); });
      var isSeries = b.series && b.series !== "Novel";
      if (wantStandalone && !isSeries) s += 2;
      if (wantSeries && isSeries) s += 2;
      return s;
    }
    pool.sort(function (a, b) { return rank(b) - rank(a); });
    return pool[0] || LIB.find(function (b) { return b.free; });
  }

  // ---- Thread-aware "read next" ----
  // Given a finished book id, suggest the next book in its thread, then series-mates.
  window.nextReads = function (bookId) {
    if (!LIB) return [];
    var book = LIB.find(function (b) { return b.id === bookId || b.file === bookId; });
    if (!book) return [];
    var out = [];
    // 1) same series, not yet the same book
    LIB.forEach(function (b) {
      if (b.id !== book.id && b.series && b.series === book.series) out.push(b);
    });
    // 2) same thread (from weave.json threads -> book titles)
    if (WV && WV.threads) {
      var inThread = WV.threads.filter(function (t) {
        return (t.books || []).some(function (s) { return s.indexOf(book.title) >= 0; });
      });
      inThread.forEach(function (t) {
        (t.books || []).forEach(function (entry) {
          LIB.forEach(function (b) {
            if (b.id !== book.id && entry.indexOf(b.title) >= 0 && out.indexOf(b) < 0) out.push(b);
          });
        });
      });
    }
    return out.slice(0, 4);
  };

  // ---- UI ----
  function el(tag, css, html) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; return e; }

  window.openDiscover = function () {
    load().then(renderQuiz).catch(function () {
      try { alert("Couldn't load your library just now \u2014 check your connection and try again."); } catch (e) {}
    });
  };

  function overlay() {
    var o = document.getElementById("discoverOverlay");
    if (o) { o.innerHTML = ""; o.style.display = "flex"; return o; }
    o = el("div", "position:fixed;inset:0;background:rgba(8,6,14,.92);z-index:200;display:flex;align-items:center;justify-content:center;padding:18px;overflow:auto", "");
    o.id = "discoverOverlay";
    o.onclick = function (e) { if (e.target === o) o.style.display = "none"; };
    document.body.appendChild(o);
    return o;
  }

  function panel() {
    return el("div", "max-width:440px;width:100%;background:linear-gradient(180deg,#191324,#120d1c);border:1px solid #2e2742;border-radius:16px;padding:24px 22px;font-family:'Cormorant Garamond',serif;color:#ece3d0");
  }

  function renderQuiz() {
    var answers = [];
    var o = overlay();
    var p = panel();
    o.appendChild(p);
    var step = 0;

    function draw() {
      p.innerHTML = "";
      if (step >= QUIZ.length) { showResult(); return; }
      var qd = QUIZ[step];
      p.appendChild(el("div", "font-family:'DM Mono',monospace;font-size:10px;letter-spacing:3px;color:#9b91ac;text-align:center", "FIND YOUR THREAD &middot; " + (step + 1) + " / " + QUIZ.length));
      p.appendChild(el("div", "font-family:'Cinzel',serif;font-size:22px;color:#e8b53a;text-align:center;margin:8px 0 18px", qd.q));
      qd.a.forEach(function (ans) {
        var btn = el("div", "background:#0e0b16;border:1px solid #2e2742;border-radius:11px;padding:13px 15px;margin-bottom:9px;cursor:pointer;font-size:16px;color:#ece3d0;transition:.14s", ans.t);
        btn.onmouseover = function () { btn.style.borderColor = "#e8b53a"; };
        btn.onmouseout = function () { btn.style.borderColor = "#2e2742"; };
        btn.onclick = function () { answers.push(ans.w); step++; draw(); };
        p.appendChild(btn);
      });
    }

    // Which paid series does this taste point toward? (for conversion framing)
    function paidDestination(score) {
      // map genre weights to the series most associated with them
      var seriesGenre = {
        "Godsverse Chronicles": ["Mythology", "Epic Fantasy"],
        "Obsidian Spindle Saga": ["Fairy Tale", "Dark Fantasy"],
        "Dragon Strife": ["Epic Fantasy", "Adventure"],
        "Quest Girls": ["Comedy", "Fairy Tale"]
      };
      var best = null, bestScore = 0;
      for (var s in seriesGenre) {
        var sc = seriesGenre[s].reduce(function (acc, g) { return acc + (score[g] || 0); }, 0);
        if (sc > bestScore) { bestScore = sc; best = s; }
      }
      return bestScore >= 4 ? best : null;
    }

    function showResult() {
      var score = {};
      answers.forEach(function (w) { for (var k in w) score[k] = (score[k] || 0) + w[k]; });
      var pick = scoreToBook(score);
      var dest = paidDestination(score);
      p.innerHTML = "";
      p.appendChild(el("div", "font-family:'DM Mono',monospace;font-size:10px;letter-spacing:3px;color:#7fd08a;text-align:center", "YOUR THREAD BEGINS"));
      p.appendChild(el("div", "font-family:'Cinzel',serif;font-size:26px;color:#e8b53a;text-align:center;margin:10px 0 4px", pick.title));
      p.appendChild(el("div", "font-size:15px;color:#9b91ac;text-align:center;font-style:italic;margin-bottom:6px", (pick.series && pick.series !== "Novel" ? pick.series : "A standalone") + (pick.genres ? " &middot; " + pick.genres.slice(0, 2).join(", ") : "")));
      p.appendChild(el("div", "font-size:11px;color:#7fd08a;text-align:center;font-family:'DM Mono';margin-bottom:" + (dest ? "10px" : "16px"), "&#10003; FREE TO READ NOW"));
      if (dest && dest !== pick.series) {
        p.appendChild(el("div", "background:#0c0a14;border:1px solid #3a2e10;border-radius:10px;padding:10px 12px;margin-bottom:16px;text-align:center;font-size:14px;color:#c9bfda;line-height:1.4", "Your thread leads to <b style='color:#e8b53a'>" + dest + "</b> &mdash; when you're ready for more."));
      }
      var go = el("div", "background:linear-gradient(150deg,#e8b53a,#b8862a);color:#16121f;font-family:'DM Mono';font-size:13px;font-weight:700;letter-spacing:1px;text-align:center;padding:13px;border-radius:10px;cursor:pointer", "&#9654; START READING");
      go.onclick = function () {
        document.getElementById("discoverOverlay").style.display = "none";
        if (typeof window.openBook === "function") { window.openBook(pick.file, pick.title, pick.id); }
      };
      p.appendChild(go);
      var again = el("div", "text-align:center;font-family:'DM Mono';font-size:11px;color:#7a7090;margin-top:12px;cursor:pointer", "Take it again");
      again.onclick = renderQuiz;
      p.appendChild(again);
    }

    draw();
  }
})();
