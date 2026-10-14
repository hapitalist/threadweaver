/* Thread Weaver — Serials (1.15.0)
   Follow any book or series as a free weekly serial: one chapter a week, on the
   day the reader picks. Owning the series (or Unlock Everything) skips the wait.
   Talks to the `serial` edge function. Also handles share links:
     /app?serial=<id>[&from=time-32]   follow a serial (optionally from a chapter)
     /app?book=<id>                    open a book
     /app?buy=<bundle|everything>      open that bundle's purchase sheet
     /app?open=codex | /app?open=quiz
   (and /serial/<id>, /book/<id>, /buy/<id>, /codex, /quiz when the site redirects them here) */
(function () {
  "use strict";
  var DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  var SITE = "https://thread.wannabepress.com";
  var SERIES_IDS = { "Godsverse Chronicles":"godsverse", "Obsidian Spindle Saga":"obsidian-spindle",
    "Dragon Strife":"dragon-strife", "Quest Girls":"quest-girls", "Wonderland":"wonderland" };
  var CATALOG = null, MINE = null;
  // 1.16.3: read-ahead one chapter at a time. Price and which app stores can verify it come from "mine".
  var CH = { cents: 100, iap: { ios: false, android: false } };

  function esc(v){ return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }
  function token(){ return window.twAccessToken ? window.twAccessToken() : null; }
  function fnBase(){ return window.twFnBase || "https://nzkgurdmvgkizvzisqxt.supabase.co/functions/v1"; }
  function api(body){
    body.tz = new Date().getTimezoneOffset();
    var h = { "Content-Type":"application/json" }, t = token();
    if (t) h.Authorization = "Bearer " + t;
    return fetch(fnBase() + "/serial", { method:"POST", headers:h, body:JSON.stringify(body) })
      .then(function(r){ return r.json().catch(function(){return {};}).then(function(j){ j.__status = r.status; return j; }); })
      .catch(function(){ return { __status:0, error:"offline" }; });
  }
  function nice(iso){ try{ var d=new Date(iso+"T12:00:00"); return DAYS[d.getDay()]+", "+d.toLocaleDateString(undefined,{month:"long",day:"numeric"}); }catch(e){ return iso; } }
  function serialIdFor(seriesName){ return SERIES_IDS[seriesName] || null; }
  window.twSerialIdFor = serialIdFor;
  function shareLink(sid, from){ return SITE + "/app?serial=" + encodeURIComponent(sid) + (from ? "&from=" + encodeURIComponent(from) : ""); }

  // Built from the app's own book list (same grouping as the server), so signed-out
  // visitors and share links work without a server call.
  var DEFAULT_DAY = { "godsverse": 6 };
  function buildCatalog(books){
    var out = [], by = {};
    (books||[]).forEach(function(b){
      if (!b || !b.id || !b.file) return;
      var sid = SERIES_IDS[b.series];
      if (sid) {
        if (!by[sid]) { by[sid] = { id:sid, title: b.series==="Godsverse Chronicles" ? "The Godsverse Chronicles" : b.series, kind:"series", bundle:null, books:[], default_day: DEFAULT_DAY[sid]!=null ? DEFAULT_DAY[sid] : null }; out.push(by[sid]); }
        by[sid].books.push({ id:b.id, title:b.title||b.id, free:!!b.free });
        if (!by[sid].bundle && b.bundle) by[sid].bundle = b.bundle;
      } else {
        out.push({ id:b.id, title:b.title||b.id, kind:"book", bundle:b.bundle||null, books:[{ id:b.id, title:b.title||b.id, free:!!b.free }], default_day:null });
      }
    });
    return out;
  }
  function loadCatalog(){
    if (CATALOG && CATALOG.length) return Promise.resolve(CATALOG);
    if (window.BOOKS && window.BOOKS.length) { CATALOG = buildCatalog(window.BOOKS); return Promise.resolve(CATALOG); }
    return fetch("books/library.json").then(function(r){ return r.json(); })
      .then(function(l){ CATALOG = buildCatalog(l); return CATALOG; }).catch(function(){ return []; });
  }
  function serialById(id){ return (CATALOG||[]).filter(function(s){ return s.id===id; })[0] || null; }

  /* ---------------------------------------------------------------- styles */
  var css = document.createElement("style");
  css.textContent = [
    "#serialsWrap{margin:6px 0 4px}",
    "#serialsWrap .sr-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px;margin:8px 0 18px}",
    ".sr-card{background:linear-gradient(150deg,#1d1530,#120d1d);border:1px solid #2e2742;border-radius:12px;padding:12px 14px;cursor:pointer;position:relative}",
    ".sr-card:hover{border-color:#7b5fd0}",
    ".sr-card .k{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:2px;color:#9b91ac;text-transform:uppercase}",
    ".sr-card .t{font-family:'Cinzel',serif;color:#e8b53a;font-size:15px;margin:3px 0 2px}",
    ".sr-card .c{color:#cdbfe6;font-size:13px}",
    ".sr-card .w{font-family:'DM Mono',monospace;font-size:11px;margin-top:8px;color:#7fd08a}",
    ".sr-card .w.wait{color:#9b91ac}",
    ".sr-card .gear{position:absolute;top:8px;right:10px;background:none;border:none;color:#9b91ac;font-size:16px;cursor:pointer;padding:4px}",
    "#serialSheet{position:fixed;inset:0;z-index:85;display:none;align-items:flex-end;justify-content:center;background:rgba(6,4,12,.72)}",
    "#serialSheet.on{display:flex}",
    "#serialSheet .panel{width:100%;max-width:520px;max-height:88vh;overflow:auto;background:#140f20;border:1px solid #2e2742;border-radius:16px 16px 0 0;padding:20px 18px calc(18px + env(safe-area-inset-bottom));position:relative;color:#e6dcf5}",
    "@media(min-width:700px){#serialSheet{align-items:center}#serialSheet .panel{border-radius:16px}}",
    "#serialSheet h2{font-family:'Cinzel',serif;color:#e8b53a;font-size:20px;margin:2px 0 6px}",
    "#serialSheet .sub{color:#b8aed0;font-size:14px;line-height:1.45;margin-bottom:14px}",
    "#serialSheet label{display:block;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:1.5px;color:#9b91ac;text-transform:uppercase;margin:12px 0 6px}",
    "#serialSheet select{width:100%;background:#0e0a16;color:#e6dcf5;border:1px solid #3a3150;border-radius:9px;padding:10px;font-size:15px}",
    "#serialSheet .sbtn{display:block;width:100%;margin-top:12px;padding:12px;border-radius:10px;border:none;font-weight:800;font-size:15px;cursor:pointer;font-family:inherit}",
    "#serialSheet .go{background:linear-gradient(150deg,#e8b53a,#b8862a);color:#16121f}",
    "#serialSheet .alt{background:#241b33;color:#e6dcf5;border:1px solid #3a3150}",
    "#serialSheet .quiet{background:none;color:#9b91ac;font-weight:600}",
    "#serialSheet .msg{min-height:16px;margin-top:10px;font-family:'DM Mono',monospace;font-size:12px;text-align:center;color:#b8aed0}",
    "#serialSheet .x{position:absolute;top:10px;right:12px;background:none;border:none;color:#9b91ac;font-size:24px;cursor:pointer}",
    "#serialSheet .pick{display:flex;justify-content:space-between;align-items:center;padding:10px 4px;border-bottom:1px solid #241b33;cursor:pointer}",
    "#serialSheet .pick:hover{color:#e8b53a}",
    ".serial-row .row-title{font-style:italic}"
  ].join("\n");
  document.head.appendChild(css);

  /* ------------------------------------------------------------ the sheet */
  function sheet(){
    var s = document.getElementById("serialSheet");
    if (s) return s;
    s = document.createElement("div"); s.id = "serialSheet";
    s.innerHTML = '<div class="panel" role="dialog" aria-modal="true"><button class="x" aria-label="Close" onclick="twSerialClose()">&#215;</button><div id="srBody"></div></div>';
    s.addEventListener("click", function(e){ if (e.target === s) twSerialClose(); });
    document.body.appendChild(s);
    return s;
  }
  window.twSerialClose = function(){ var s=document.getElementById("serialSheet"); if(s) s.classList.remove("on"); };
  function body(html){ sheet(); document.getElementById("srBody").innerHTML = html; sheet().classList.add("on"); }
  function msg(t){ var m=document.getElementById("srMsg"); if(m) m.textContent=t; }

  // pick-novel: choose which standalone novel to follow
  function openNovelPicker(){
    loadCatalog().then(function(cat){
      var list = cat.filter(function(s){ return s.kind==="book"; });
      body('<h2>Follow a novel</h2><div class="sub">Pick any novel. You get one chapter a week, on the day you choose.</div>' +
        list.map(function(s){ return '<div class="pick" onclick="twSerialOpen(\''+esc(s.id)+'\')"><span>'+esc(s.title)+'</span><span>&#9656;</span></div>'; }).join(""));
    });
  }

  window.twSerialOpen = function(sid, from){
    if (sid === "pick-novel") return openNovelPicker();
    body('<div class="sub">Loading…</div>');
    Promise.all([loadCatalog(), token() ? loadMine() : Promise.resolve(null)]).then(function(){
      var s = serialById(sid);
      if (!s) { body('<h2>Serial not found</h2><div class="sub">That serial link isn’t valid anymore.</div>'); return; }
      var f = (MINE||[]).filter(function(x){ return x.serial===sid; })[0] || null;
      var today = new Date().getDay();
      var day = f ? f.weekday : (s.default_day!=null ? s.default_day : today);
      var dayOpts = DAYS.map(function(d,i){ return '<option value="'+i+'"'+(i===day?" selected":"")+'>'+d+'</option>'; }).join("");
      var html = '<h2>'+esc(s.title)+'</h2>';
      if (f) {
        html += '<div class="sub">You’re following this serial. A new chapter unlocks every <b>'+DAYS[f.weekday]+'</b>.' +
          (f.owns_all ? ' You own the whole series, so every chapter is open now.' : '') + '</div>' +
          (f.next_chapter ? (f.next_chapter.ready
            ? '<button class="sbtn go" onclick="twSerialClose();twSerialRead(\''+esc(sid)+'\','+f.next_chapter.g+')">Read '+esc(f.next_chapter.title)+'</button>'
            : '<div class="sub" style="margin:0">Up next: <b>'+esc(f.next_chapter.title)+'</b>, arriving '+nice(f.next_delivery)+'.</div>' +
              (f.next_chapter.can_buy && window.twChapterPriceLabel() ? '<button class="sbtn go" onclick="twSerialBuyChapter(\''+esc(sid)+'\')">Read it now — '+esc(window.twChapterPriceLabel())+'</button>' : '') +
              (s.bundle && !f.owns_all ? '<button class="sbtn alt" onclick="twSerialBuy(\''+esc(s.bundle)+'\')">Unlock the whole series</button>' : '')) : '') +
          '<label style="display:flex;align-items:center;gap:10px;text-transform:none;letter-spacing:0;font-size:14px;color:#e6dcf5;margin-top:16px"><input type="checkbox" id="srEmail"'+(f.email!==false?' checked':'')+' onchange="twSerialEmail(\''+esc(sid)+'\',this.checked)" style="width:20px;height:20px"> Email me each new chapter</label>' +
          '<label for="srDay">Delivery day</label><select id="srDay">'+dayOpts+'</select>' +
          '<button class="sbtn alt" onclick="twSerialSetDay(\''+esc(sid)+'\')">Save day</button>' +
          '<button class="sbtn alt" onclick="twSerialShare(\''+esc(sid)+'\')">Copy share link</button>' +
          '<button class="sbtn quiet" onclick="twSerialUnfollow(\''+esc(sid)+'\')">Stop following</button>';
      } else {
        html += '<div class="sub">Read it as a free weekly serial: one chapter a week, on the day you pick, in the app and in your inbox. ' +
          (s.bundle ? 'Can’t wait? Unlock the series and read straight through.' : '') + '</div>' +
          '<label for="srDay">New chapter every</label><select id="srDay">'+dayOpts+'</select>' +
          '<label for="srFrom">Start from</label><select id="srFrom"><option value="">The beginning</option></select>' +
          '<button class="sbtn go" onclick="twSerialFollow(\''+esc(sid)+'\')">Follow this serial</button>' +
          (s.bundle ? '<button class="sbtn alt" onclick="twSerialBuy(\''+esc(s.bundle)+'\')">Read it all now</button>' : '') +
          '<button class="sbtn quiet" onclick="twSerialShare(\''+esc(sid)+'\')">Copy share link</button>';
      }
      html += '<div class="msg" id="srMsg" role="status" aria-live="polite"></div>';
      body(html);
      if (!f) fillFrom(sid, from);
    });
  };
  function fillFrom(sid, from){
    if (!token()) {   // chapter list needs the server; signed-out readers start at the beginning
      var sel0 = document.getElementById("srFrom");
      if (sel0) sel0.innerHTML = '<option value="">The beginning</option>' + (from ? '<option value="'+esc(from)+'" selected>Where the link points ('+esc(from)+')</option>' : '');
      return;
    }
    api({ action:"toc", serial:sid }).then(function(j){
      var sel = document.getElementById("srFrom"); if (!sel || !j || !j.chapters) return;
      var books = {}; (serialById(sid).books||[]).forEach(function(b){ books[b.id]=b.title; });
      var multi = (serialById(sid).books||[]).length > 1, opts = '<option value="">The beginning</option>', pick = -1;
      if (from) {   // "time-32" -> match the same way the server does, to pre-select it
        var m = String(from).toLowerCase().match(/^(.*?)-(\d+)$/);
        if (m) { var key=m[1].replace(/[^a-z0-9]+/g,""), n=+m[2];
          j.chapters.forEach(function(c){ if(pick<0){ var bid=c.book.toLowerCase().replace(/^[0-9]+-/,"").replace(/[^a-z0-9]+/g,""); var bt=(books[c.book]||"").toLowerCase().replace(/[^a-z0-9]+/g,"");
            if((bid.indexOf(key)===0||bt.indexOf(key)===0) && new RegExp("(^|·\\s*)chapter\\s+"+n+"\\b","i").test(c.title)) pick=c.g; } }); }
        else if (/^\d+$/.test(from)) pick = +from - 1;
      }
      j.chapters.forEach(function(c){ opts += '<option value="'+(c.g+1)+'"'+(c.g===pick?" selected":"")+'>'+esc((multi?books[c.book]+" — ":"")+c.title)+'</option>'; });
      sel.innerHTML = opts;
    });
  }
  function needSignin(){
    msg("Sign in first — your serial is saved to your account.");
    try{ sessionStorage.setItem("tw_pending_link", location.search || ""); }catch(e){}
    if (window.promptSignin) try{ window.promptSignin(); }catch(e){}
  }
  window.twSerialFollow = function(sid){
    if (!token()) return needSignin();
    var day = +document.getElementById("srDay").value, fromSel = document.getElementById("srFrom");
    var from = fromSel && fromSel.value ? (/^\d+$/.test(fromSel.value) ? +fromSel.value : fromSel.value) : null;
    msg("Saving…");
    api({ action:"follow", serial:sid, weekday:day, from:from }).then(function(j){
      if (j.__status === 401) return needSignin();
      if (!j.ok) return msg("Couldn’t save that. Try again.");
      MINE = null; refresh();
      twSerialClose();
      twSerialRead(sid, j.start);
    });
  };
  window.twSerialSetDay = function(sid){
    var day = +document.getElementById("srDay").value; msg("Saving…");
    api({ action:"set_day", serial:sid, weekday:day }).then(function(j){
      if (!j.ok) return msg("Couldn’t save that. Try again.");
      msg("Saved. Next chapter "+nice(j.next)+"."); MINE=null; refresh();
    });
  };
  window.twSerialEmail = function(sid, on){
    msg(on ? "Saving…" : "Saving…");
    api({ action:"set_email", serial:sid, on:!!on }).then(function(j){
      if (!j.ok) { msg("Couldn\u2019t save that. Try again."); var c=document.getElementById("srEmail"); if(c) c.checked=!on; return; }
      msg(on ? "You\u2019ll get each new chapter by email." : "Emails off. The serial stays here in the app."); MINE=null; refresh();
    });
  };
  window.twSerialUnfollow = function(sid){
    api({ action:"unfollow", serial:sid }).then(function(){ MINE=null; refresh(); twSerialClose(); });
  };
  window.twSerialShare = function(sid){
    var url = shareLink(sid);
    var done = function(){ msg("Link copied: "+url); };
    try {
      if (navigator.share) { navigator.share({ title: (serialById(sid)||{}).title || "Thread Weaver", url:url }).catch(function(){}); return; }
      navigator.clipboard.writeText(url).then(done, function(){ msg(url); });
    } catch(e) { msg(url); }
  };
  window.twSerialBuy = function(bundle){
    twSerialClose();
    if (bundle === "unlock_all" || bundle === "everything") {
      // 1.16.3: an "Unlock Everything" link lands ON Unlock Everything, not on the top of the store list
      if (window.openStore) window.openStore();
      setTimeout(function(){
        var o = Array.prototype.filter.call(document.querySelectorAll("#sheet .opt"), function(x){ return /Unlock Everything/i.test(x.textContent); })[0];
        if (o) { o.style.borderColor = "var(--gold)"; try{ o.scrollIntoView({ block:"center" }); }catch(e){} }
      }, 60);
      return;
    }
    if (window.openSheet) window.openSheet(bundle); else if (window.openStore) window.openStore();
  };

  /* ------------------------------------------- read the next chapter now */
  function nativePlat(){ try{ var p = window.cordova && window.cordova.platformId; return (p === "ios" || p === "android") ? p : null; }catch(e){ return null; } }
  // The label to show on "read it now" buttons, or null when this build can't sell a single chapter
  // (the app, until the store product exists and the server can verify it).
  window.twChapterPriceLabel = function(){
    var plat = nativePlat();
    if (!plat) return "$" + (CH.cents / 100).toFixed(CH.cents % 100 ? 2 : 0);
    if (!CH.iap[plat]) return null;
    return window.twChapterNativePrice ? window.twChapterNativePrice() : null;
  };
  window.twSerialBuyChapter = function(sid){
    if (!token()) {
      try{ sessionStorage.setItem("tw_pending_link", "?serial=" + encodeURIComponent(sid) + "&unlock=next"); }catch(e){}
      if (window.promptSignin) try{ window.promptSignin(); }catch(e){}
      return;
    }
    try{ var pl = sessionStorage.getItem("tw_pending_link"); if (pl && /unlock=next/.test(pl)) sessionStorage.removeItem("tw_pending_link"); }catch(e){}
    if (nativePlat()) {
      if (window.twChapterPriceLabel() && window.twBuyChapterNative) { window.twBuyChapterNative(sid); return; }
      var s0 = serialById(sid); if (s0 && s0.bundle) window.twSerialBuy(s0.bundle);
      return;
    }
    body('<div class="sub">Opening secure checkout…</div>');
    api({ action:"chapter_checkout", serial:sid }).then(function(j){
      if (j && j.url) { location.href = j.url; return; }
      if (j && j.error === "owned" && j.g != null) { twSerialClose(); window.twSerialRead(sid, j.g); return; }
      if (j && j.error === "not following") { window.twSerialOpen(sid); setTimeout(function(){ msg(j.message || "Follow this serial first."); }, 400); return; }
      body('<h2>Couldn’t open checkout</h2><div class="sub">' + esc((j && j.message) || "Something went wrong. Please try again.") + '</div>' +
        '<button class="sbtn alt" onclick="twSerialOpen(\'' + esc(sid) + '\')">Back</button>');
    });
  };
  // the app store approved and the server credited a chapter: open it
  window.twSerialChapterBought = function(sid){
    MINE = null;
    loadMine().then(function(){
      render();
      var f = (MINE||[]).filter(function(x){ return x.serial === sid; })[0];
      if (f) { twSerialClose(); window.twSerialRead(sid, f.through); }
    });
  };

  /* ----------------------------------------------------------- reading */
  window.twSerialRead = function(sid, g){
    var s = serialById(sid);
    document.getElementById("hosttitle").textContent = (s ? s.title : "Serial");
    var bf = document.getElementById("btnFinished"); if (bf) bf.style.display = "none";
    document.getElementById("frame").src = "serial.html?serial="+encodeURIComponent(sid)+"&g="+(+g||0);
    document.getElementById("host").classList.add("on");
    var wb = document.getElementById("weaveBtn"); if (wb) wb.style.display = "none";
    var cs = document.getElementById("csBtn"); if (cs) cs.style.display = "none";
    if (window.__podsBtnVisible) window.__podsBtnVisible(false);
    if (window.__weaverBarVisible) window.__weaverBarVisible(false);
  };
  // serial.html asks the app to open a purchase sheet / refresh the row
  window.addEventListener("message", function(ev){
    var d = ev.data || {};
    if (d.type === "serial-buy") window.twSerialBuy(d.bundle);
    if (d.type === "serial-chapter-buy" && d.serial) window.twSerialBuyChapter(String(d.serial));
    if (d.type === "serial-progress") { MINE = null; refresh(); }
  });

  /* ------------------------------------------------- "Your serials" row */
  function loadMine(){
    if (!token()) { MINE = []; return Promise.resolve(MINE); }
    return api({ action:"mine" }).then(function(j){
      MINE = (j && j.serials) || [];
      if (j && j.chapter_iap) CH.iap = j.chapter_iap;
      if (j && j.chapter_price_cents) CH.cents = j.chapter_price_cents;
      return MINE;
    });
  }
  function wrap(){
    var w = document.getElementById("serialsWrap");
    if (w) return w;
    var shelf = document.getElementById("shelf"); if (!shelf) return null;
    var anchor = shelf.previousElementSibling; // the GAMES heading
    w = document.createElement("div"); w.id = "serialsWrap";
    shelf.parentNode.insertBefore(w, anchor || shelf);
    return w;
  }
  function render(){
    var w = wrap(); if (!w) return;
    if (!MINE || !MINE.length) { w.innerHTML = ""; return; }
    w.innerHTML = '<div class="secwrap"><div class="sec"><span class="st">YOUR SERIALS</span><span class="sc">'+MINE.length+'</span></div>' +
      '<div class="ss">One chapter a week, on your day. Tap to read.</div></div><div class="sr-cards">' +
      MINE.map(function(x){
        var nx = x.next_chapter, ready = nx && nx.ready;
        var when = !nx ? "You’re all caught up — that’s the end." : (ready ? "▸ Ready to read" : "Next chapter "+nice(x.next_delivery) + (nx.can_buy && window.twChapterPriceLabel() ? " · or read it now" : ""));
        var click = nx && ready ? 'twSerialRead(\''+esc(x.serial)+'\','+nx.g+')' : 'twSerialOpen(\''+esc(x.serial)+'\')';
        return '<div class="sr-card" onclick="'+click+'"><button class="gear" aria-label="Serial settings" onclick="event.stopPropagation();twSerialOpen(\''+esc(x.serial)+'\')">&#9881;</button>' +
          '<div class="k">Every '+DAYS[x.weekday]+(x.owns_all?" · owned":"")+'</div><div class="t">'+esc(x.title)+'</div>' +
          '<div class="c">'+(nx ? esc((x.kind==="series" && nx.book ? nx.book+" — " : "")+nx.title) : "")+'</div>' +
          '<div class="w'+(ready?"":" wait")+'">'+when+'</div></div>';
      }).join("") + '</div>';
  }
  function refresh(){ loadMine().then(render); }
  window.twSerialsRefresh = refresh;

  /* -------------------------------------------------------- share links */
  function handleLink(){
    var q = new URLSearchParams(location.search), p = location.pathname.replace(/\/+$/,"");
    var m = p.match(/\/(serial|book|buy)\/([^\/]+)$/), kind = m ? m[1] : null, id = m ? decodeURIComponent(m[2]) : null;
    if (/\/codex$/.test(p)) { kind = "open"; id = "codex"; }
    if (/\/quiz$/.test(p)) { kind = "open"; id = "quiz"; }
    function pick(){ ["serial","book","buy","open"].some(function(k){ if (q.get(k)) { kind=k; id=q.get(k); return true; } return false; }); }
    if (!kind) pick();
    // a link that had to wait for sign-in: replay it in full (1.16.3: incl. &unlock=next)
    if (!kind) { try{ var pend=sessionStorage.getItem("tw_pending_link"); if(pend && token()){ sessionStorage.removeItem("tw_pending_link"); q=new URLSearchParams(pend); pick(); } }catch(e){} }
    if (!kind) return;
    var from = q.get("from");
    var readG = q.get("read");
    // back from a $1 chapter checkout: the Stripe webhook lands within seconds - wait for it, then open the chapter
    if (kind === "serial" && q.get("purchase") === "chapter" && readG != null && /^\d+$/.test(readG)) {
      try{ history.replaceState(null, "", location.pathname + location.search.replace(/[?&]purchase=chapter/, "").replace(/^&/, "?")); }catch(e){}
      if (!token()) { try{ sessionStorage.setItem("tw_pending_link", "?serial="+encodeURIComponent(id)+"&read="+readG); }catch(e){} return; }
      body('<h2>Thank you!</h2><div class="sub">Unlocking your chapter…</div>');
      var delays = [800, 1500, 2500, 4000, 6000, 10000, 15000, 20000], k = 0;
      (function attempt(){
        api({ action:"chapter", serial:id, g:+readG }).then(function(j){
          if (j && !j.locked && j.html) { MINE = null; refresh(); twSerialClose(); window.twSerialRead(id, +readG); return; }
          if (k >= delays.length) { body('<h2>Payment received</h2><div class="sub">Your chapter is still unlocking. It will open in a minute — tap below to try again.</div><button class="sbtn go" onclick="twSerialClose();twSerialRead(\''+esc(id)+'\','+(+readG)+')">Open the chapter</button>'); return; }
          setTimeout(attempt, delays[k++]);
        });
      })();
      return;
    }
    if (kind === "serial" && q.get("unlock") === "next") { window.twSerialBuyChapter(id); return; }
    if (kind === "serial" && readG != null && /^\d+$/.test(readG) && token()) window.twSerialRead(id, +readG);
    else if (kind === "serial") window.twSerialOpen(id, from);
    else if (kind === "book") {
      var b = (window.BOOKS||[]).filter(function(x){ return x.id===id; })[0];
      if (b && window.openBook) window.openBook(b.file, b.title, b.id);
    }
    else if (kind === "buy") window.twSerialBuy(id === "everything" ? "unlock_all" : id);
    else if (kind === "open" && id === "codex" && window.openWeave) window.openWeave();
    else if (kind === "open" && id === "quiz" && window.openDiscover) window.openDiscover();
  }

  /* -------------------------------------------------------------- boot */
  function ready(fn){ if (document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  ready(function(){
    loadCatalog();
    // wait until the shelf has books (BOOKS loads async) before handling links
    var tries = 0;
    (function wait(){
      if ((window.BOOKS && window.BOOKS.length) || tries++ > 40) { handleLink(); refresh(); return; }
      setTimeout(wait, 250);
    })();
    // re-check when the reader signs in or out
    var last = !!token();
    setInterval(function(){ var now = !!token(); if (now !== last) { last = now; MINE = null; refresh(); if (now) handleLink(); } }, 1500);
  });
})();
