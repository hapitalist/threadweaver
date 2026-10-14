/* fun.js — the "feel" layer. Hooks existing functions; rewrites nothing.
   1) first-run: auto-offer Find Your Thread
   2) tiered unlock celebration (toast / modal / relic takeover)
   3) persistent Weaver progress bar (rank, % of Weave, next milestone)
   4) rank-up takeover moment
   5) "Continue reading" hero at top of home
   Depends only on globals app.html already defines: weaverStats, weaverXP, rankFor,
   nextRank, WEAVE, BOOKS, openBook, openDiscover, showUnlockModal. All optional-guarded. */
(function(){
  "use strict";

  function $(id){ return document.getElementById(id); }
  function have(fn){ return typeof window[fn]==="function"; }

  /* ---------------- styles ---------------- */
  function css(){
    if($("funCss")) return;
    var s=document.createElement("style"); s.id="funCss";
    s.textContent=[
      /* Weaver bar */
      "#weaverBar{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(20px + env(safe-area-inset-bottom));z-index:45;background:rgba(14,11,22,.92);border:1px solid #2e2742;border-radius:14px;padding:8px 14px;display:flex;align-items:center;gap:10px;box-shadow:0 6px 24px rgba(0,0,0,.5);font-family:'DM Mono',monospace;max-width:90vw;cursor:pointer}",
      "#weaverBar .wr{font-family:'Cinzel',serif;font-size:12px;color:#e8b53a;white-space:nowrap}",
      "#weaverBar .wbar{width:120px;height:7px;border-radius:5px;background:#241b33;overflow:hidden}",
      "#weaverBar .wbar > i{display:block;height:100%;background:linear-gradient(90deg,#7b5fd0,#e8b53a);transition:width .5s ease}",
      "#weaverBar .wn{font-size:10px;color:#9b91ac;white-space:nowrap}",
      "@media(max-width:520px){#weaverBar .wn{display:none}#weaverBar .wbar{width:84px}}",
      /* toast (common unlocks) */
      "#funToast{position:fixed;left:50%;transform:translateX(-50%) translateY(20px);bottom:calc(74px + env(safe-area-inset-bottom));z-index:96;background:linear-gradient(150deg,#241640,#140d22);border:1px solid #7b5fd0;border-radius:12px;padding:11px 16px;font-family:'DM Mono',monospace;font-size:13px;color:#ece3d0;opacity:0;pointer-events:none;transition:opacity .3s,transform .3s;max-width:80vw;box-shadow:0 6px 24px rgba(0,0,0,.5)}",
      "#funToast.on{opacity:1;transform:translateX(-50%) translateY(0)}",
      "#funToast .tg{color:#e8b53a;margin-right:6px}",
      /* takeover (rank-up + relic) */
      "#funTakeover{position:fixed;inset:0;z-index:130;display:none;align-items:center;justify-content:center;background:radial-gradient(120% 90% at 50% 40%,rgba(60,40,110,.55),rgba(6,4,12,.92));backdrop-filter:blur(4px);padding:24px}",
      "#funTakeover.on{display:flex;animation:funFade .4s ease}",
      "@keyframes funFade{from{opacity:0}to{opacity:1}}",
      "#funTakeover .tk{max-width:400px;width:100%;text-align:center}",
      "#funTakeover .tkStar{font-size:64px;color:#e8b53a;animation:funPop .6s cubic-bezier(.2,1.4,.5,1);filter:drop-shadow(0 0 18px rgba(232,181,58,.6))}",
      "@keyframes funPop{0%{transform:scale(0) rotate(-30deg);opacity:0}60%{transform:scale(1.25) rotate(8deg)}100%{transform:scale(1) rotate(0);opacity:1}}",
      /* reduce-motion: honor OS setting AND the reader's manual toggle (body[data-reduce-motion='1']) */
      "@media (prefers-reduced-motion: reduce){#funTakeover.on{animation:none}#funTakeover .tkStar{animation:none}#funToast{transition:opacity .15s}}",
      "body[data-reduce-motion='1'] #funTakeover.on{animation:none}",
      "body[data-reduce-motion='1'] #funTakeover .tkStar{animation:none}",
      "body[data-reduce-motion='1'] #funToast{transition:opacity .15s}",
      "#funTakeover .tkKick{font-family:'DM Mono',monospace;font-size:11px;letter-spacing:4px;color:#7b5fd0;text-transform:uppercase;margin-top:8px}",
      "#funTakeover .tkTitle{font-family:'Cinzel',serif;font-size:28px;color:#e8b53a;margin:10px 0 6px;line-height:1.15}",
      "#funTakeover .tkSub{font-family:'Cormorant Garamond',Georgia,serif;font-size:18px;color:#cdbfe6;line-height:1.4;margin-bottom:22px}",
      "#funTakeover button{font-family:'DM Mono',monospace;font-size:13px;background:linear-gradient(150deg,#7b5fd0,#3a2a6e);border:1px solid #e8b53a;color:#fff;padding:12px 26px;border-radius:10px;cursor:pointer;letter-spacing:1px}",
      /* continue-reading hero */
      "#continueHero{margin:0 0 6px;padding:0 4px}",
      "#continueHero .ch{display:flex;align-items:center;gap:14px;background:linear-gradient(110deg,#1c1430,#120d1f);border:1px solid #2e2742;border-left:3px solid #e8b53a;border-radius:14px;padding:14px 16px;cursor:pointer;transition:border-color .2s}",
      "#continueHero .ch:active{border-color:#e8b53a}",
      "#continueHero .ch .ico{font-size:26px;flex:none}",
      "#continueHero .ch .tx{flex:1;min-width:0}",
      "#continueHero .ch .k{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:2px;color:#9b91ac;text-transform:uppercase}",
      "#continueHero .ch .t{font-family:'Cinzel',serif;font-size:16px;color:#ece3d0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      "#continueHero .ch .go{font-family:'DM Mono',monospace;font-size:12px;color:#e8b53a;flex:none}"
    ].join("\n");
    document.head.appendChild(s);
  }

  /* ---------------- progress model (reuse app.html machinery) ---------------- */
  function stats(){ try{ return have("weaverStats")?window.weaverStats():null; }catch(e){ return null; } }
  function xpOf(st){ try{ return have("weaverXP")?window.weaverXP(st):0; }catch(e){ return 0; } }
  function rankOf(xp){ try{ return have("rankFor")?window.rankFor(xp):null; }catch(e){ return null; } }
  function nextOf(xp){ try{ return have("nextRank")?window.nextRank(xp):null; }catch(e){ return null; } }
  function weaveTotal(){ return (window.WEAVE&&window.WEAVE.entries)?window.WEAVE.entries.length:864; }
  function codexLit(){ try{ return Object.keys(window.weaveUnlocked()).length; }catch(e){ return 0; } }

  var _lastRankTitle = null;

  /* ---------------- 3) persistent Weaver bar ---------------- */
  function mountBar(){
    if($("weaverBar")) return;
    var b=document.createElement("div"); b.id="weaverBar";
    b.innerHTML='<span class="wr" id="wbRank">Unwoven</span><span class="wbar"><i id="wbFill" style="width:0%"></i></span><span class="wn" id="wbNext"></span><span class="wsave" id="wbSave" style="display:none;margin-left:10px;font-size:11px;color:#e8b53a;cursor:pointer;text-decoration:underline">Sign in to save your rank</span>';
    b.onclick=function(ev){
      if(ev && ev.target && ev.target.id==="wbSave"){ if(have("promptSignin")) window.promptSignin(); else if(have("showLoginWall")) window.showLoginWall(); return; }
      if(have("openWeave")) window.openWeave();
    };
    document.body.appendChild(b);
  }
  function refreshBar(){
    var st=stats(); if(!st) return;
    var xp=xpOf(st), r=rankOf(xp), nx=nextOf(xp);
    var lit=codexLit(), tot=weaveTotal();
    var pct=Math.min(100, Math.round(lit/tot*100));
    var rl=$("wbRank"), wf=$("wbFill"), wn=$("wbNext");
    if(rl&&r) rl.textContent=r.title;
    if(wf) wf.style.width=pct+"%";
    if(wn){
      if(nx){ var need=nx.min-xp; wn.textContent=pct+"% woven \u00b7 next: "+nx.title; }
      else { wn.textContent=pct+"% woven \u00b7 max rank"; }
    }
    var sv=$("wbSave");
    if(sv){
      var signedIn=false;
      try{ signedIn = !!(window.twSession || (window.getSession && window.getSession())); }catch(e){}
      if(!signedIn){ try{ signedIn = /log ?out|sign ?out/i.test((document.getElementById("acctbar")||{}).textContent||""); }catch(e){} }
      sv.style.display = (!signedIn && xp>0) ? "inline" : "none";
    }
    // rank-up detection
    if(r){
      if(_lastRankTitle!==null && r.title!==_lastRankTitle){ rankUp(r); }
      _lastRankTitle=r.title;
    }
  }
  function hideBarWhileReading(show){ var b=$("weaverBar"); if(b) b.style.display=show?"":"none"; }
  window.__weaverBarVisible = hideBarWhileReading;

  /* ---------------- 2) tiered unlock celebration ---------------- */
  // wrap the existing showUnlockModal: decide tier, then either toast, modal, or takeover.
  function entById(id){ try{ return window.WEAVE?window.WEAVE.entries.find(function(e){return e.id===id;}):null; }catch(e){ return null; } }
  // TAKEOVER is reserved for genuinely rare moments only (the 2 thread reveals, or
  // anything explicitly flagged rare). Spoilers are notable but get the modal, not a
  // full-screen interruption \u2014 otherwise ~20% of unlocks would take over the screen.
  function isRare(e){
    if(!e) return false;
    if(e.cat==='threads'||e.cat==='thread') return true;
    if(e.rare===true || e.tier==='rare') return true;
    return false;
  }
  function isNotable(e){
    return !!(e && (e.spoiler || e.cat==='cosmology' || e.cat==='powers'));
  }
  function toast(html){
    var t=$("funToast"); if(!t){ t=document.createElement("div"); t.id="funToast"; document.body.appendChild(t); }
    t.innerHTML=html; t.classList.add("on");
    clearTimeout(t._h); t._h=setTimeout(function(){ t.classList.remove("on"); }, 2600);
  }
  function takeover(kick,title,sub){
    var o=$("funTakeover");
    if(!o){ o=document.createElement("div"); o.id="funTakeover";
      o.innerHTML='<div class="tk"><div class="tkStar">\u2726</div><div class="tkKick" id="tkKick"></div><div class="tkTitle" id="tkTitle"></div><div class="tkSub" id="tkSub"></div><button id="tkBtn">Continue</button></div>';
      document.body.appendChild(o);
      $("tkBtn").onclick=function(){ o.classList.remove("on"); };
    }
    $("tkKick").innerHTML=kick; $("tkTitle").innerHTML=title; $("tkSub").innerHTML=sub||"";
    o.classList.add("on");
  }

  function installUnlockHook(){
    if(!have("showUnlockModal") || window.__funUnlockHooked) return;
    window.__funUnlockHooked=true;
    var orig=window.showUnlockModal;
    window.showUnlockModal=function(ids){
      try{
        var ents=(ids||[]).map(entById).filter(Boolean);
        if(!ents.length){ refreshBar(); return; }
        var rare=ents.filter(isRare);
        var notable=ents.filter(isNotable);
        if(rare.length){
          // a thread / flagged-rare reveal -> full takeover (fires ~a handful of times ever)
          var names=ents.slice(0,4).map(function(e){return e.title;}).join(" \u00b7 ");
          takeover("A rare thread reveals itself",
                   ents.length===1 ? ents[0].title : ents.length+" new revelations",
                   names + (ents.length>4?" \u2026":""));
        } else if(notable.length || ents.length>=3){
          // a notable reveal or a burst of several -> the full modal (the existing weight)
          orig(ids);
        } else {
          // 1\u20132 common entries -> lightweight toast, no interruption to reading flow
          var glyph = ents[0].cat==='places' ? '\u25C6' : '\u2738';
          var label = ents.length===1 ? ents[0].title : ents.length+" new entries";
          toast('<span class="tg">'+glyph+'</span>'+label+' added to the Weave');
        }
      }catch(e){ try{ orig(ids); }catch(_){} }
      refreshBar();
    };
  }

  /* ---------------- 4) rank-up moment ---------------- */
  function rankUp(r){
    takeover("You've risen",
             r.title,
             (r.blurb||"") + "<br><br>The Weave answers to a steadier hand now.");
  }

  /* ---------------- 5) continue-reading hero ---------------- */
  function mostRecentBook(){
    if(!window.BOOKS||!window.BOOKS.length) return null;
    var best=null, bestT=0;
    window.BOOKS.forEach(function(b){
      var id=b.id||b.file;
      try{
        if(localStorage.getItem("rdr_done_"+id)) return; // finished -> not "continue"
        var pos=localStorage.getItem("rdr_pos_"+id);
        if(pos){
          // we don't store a timestamp on pos; approximate recency by reader meta if present
          var t=parseInt(localStorage.getItem("rdr_seen_"+id)||"0",10)||1;
          if(t>=bestT){ bestT=t; best=b; }
        }
      }catch(e){}
    });
    return best;
  }
  function mountContinue(){
    if(!window.BOOKS) return;
    var book=mostRecentBook();
    var bookshelf=$("bookshelf");
    var existing=$("continueHero");
    if(!book){ if(existing) existing.remove(); return; }
    if(!existing){
      existing=document.createElement("div"); existing.id="continueHero";
      // place it just above the bookshelf grid
      if(bookshelf&&bookshelf.parentNode){ bookshelf.parentNode.insertBefore(existing, bookshelf); }
      else document.body.appendChild(existing);
    }
    existing.innerHTML='<div class="ch"><span class="ico">\u{1F4D6}</span><span class="tx"><div class="k">Continue reading</div><div class="t">'+(book.title||book.file)+'</div></span><span class="go">\u25B8 Resume</span></div>';
    existing.querySelector(".ch").onclick=function(){
      if(have("openBook")) window.openBook(book.file, book.title, book.id||book.file);
    };
  }

  /* ---------------- 1) first-run: offer the quiz ---------------- */
  function isFirstRun(){
    try{
      if(localStorage.getItem("tw_seen_intro")) return false;
      // truly new = no reading position, no unlocks, no games played
      var hasUnlocks=codexLit()>0;
      var hasReading=false;
      (window.BOOKS||[]).forEach(function(b){ if(localStorage.getItem("rdr_pos_"+(b.id||b.file))) hasReading=true; });
      return !hasUnlocks && !hasReading;
    }catch(e){ return false; }
  }
  function offerQuiz(){
    if(!isFirstRun()) return;
    try{ localStorage.setItem("tw_seen_intro","1"); }catch(e){}
    // gentle: a takeover-style welcome that launches the quiz or dismisses
    var o=document.createElement("div"); o.id="funWelcome";
    /* 1.16.1: it sat at z-index 50, BELOW the header, store buttons and search (z 52), and its middle was
       half transparent, so the whole page bled through the text. It now covers the page outright; it is
       still dismissed by \"Just let me browse\" or a tap anywhere outside the card, so nothing is blocked. */
    o.style.cssText="position:fixed;inset:0;z-index:150;display:flex;align-items:center;justify-content:center;background:radial-gradient(120% 90% at 50% 40%,#2a1d4d,#07050d 75%);padding:24px";
    o.innerHTML='<div style="max-width:400px;text-align:center;background:rgba(22,16,38,.92);border:1px solid #3a2d5c;border-radius:16px;padding:28px 22px;box-shadow:0 20px 60px rgba(0,0,0,.6)">'+
      '<div style="font-size:54px;color:#e8b53a;filter:drop-shadow(0 0 16px rgba(232,181,58,.5))">\u2726</div>'+
      '<div style="font-family:\'Cinzel\',serif;font-size:24px;color:#e8b53a;margin:12px 0 6px">Welcome, Weaver</div>'+
      '<div style="font-family:\'Cormorant Garamond\',Georgia,serif;font-size:18px;color:#cdbfe6;line-height:1.45;margin-bottom:22px">Every game, book, and comic here is a thread in one vast story. As you read, the Weave \u2014 a codex of 864 secrets \u2014 lights up. Not sure where to start? Let\u2019s find your thread.</div>'+
      '<button id="fwGo" style="font-family:\'DM Mono\',monospace;font-size:13px;background:linear-gradient(150deg,#7b5fd0,#3a2a6e);border:1px solid #e8b53a;color:#fff;padding:12px 24px;border-radius:10px;cursor:pointer;letter-spacing:1px;margin-right:8px">Find my thread</button>'+
      '<button id="fwSkip" style="font-family:\'DM Mono\',monospace;font-size:13px;background:#1d1830;border:1px solid #2e2742;color:#9b91ac;padding:12px 18px;border-radius:10px;cursor:pointer">Just let me browse</button>'+
      '</div>';
    document.body.appendChild(o);
    $("fwGo").onclick=function(){ o.remove(); if(have("openDiscover")) window.openDiscover(); };
    $("fwSkip").onclick=function(){ o.remove(); };
    /* Apple 2.1(a) (build 11464): this full-screen first-run layer sat at z-index 140 over
       the whole app, so the "Log in to save your place" button under it appeared dead to
       App Review. Tapping ANYWHERE outside the card now dismisses it, so no control can be
       permanently blocked. (It was previously masked by the old forced-login wall.) */
    o.addEventListener("click", function(ev){ if(ev.target === o) o.remove(); });
  }

  /* ---------------- wire it together ---------------- */
  function tick(){ try{ installUnlockHook(); refreshBar(); mountContinue(); }catch(e){} }

  function boot(){
    css(); mountBar();
    // give app.html a beat to load WEAVE/WEAVER/BOOKS, then sync + first-run
    var tries=0;
    var iv=setInterval(function(){
      tries++;
      installUnlockHook();
      refreshBar();
      mountContinue();
      if((window.WEAVE && window.BOOKS) || tries>30){
        clearInterval(iv);
        // seed _lastRankTitle so we don't fire a rank-up on first load
        var st=stats(); if(st){ var r=rankOf(xpOf(st)); _lastRankTitle = r?r.title:null; }
        setTimeout(offerQuiz, 1200);   // after the boot splash fades
      }
    }, 400);
    // refresh on focus / message (unlocks arrive via postMessage from reader)
    window.addEventListener("message", function(ev){
      if(ev.data && (ev.data.type==="weave-unlock" || ev.data.type==="weaver-relic")){ setTimeout(tick, 300); }
      if(ev.data && ev.data.type==="reduce-motion"){
        document.body.setAttribute("data-reduce-motion", ev.data.on ? "1":"0");
        try{ localStorage.setItem("rdr_motion", ev.data.on?"1":"0"); }catch(e){}
      }
    });
    // honor reduce-motion at boot: OS preference OR a saved reader toggle
    try{
      var rm = localStorage.getItem("rdr_motion");
      if(rm===null){ rm = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "1":"0"; }
      document.body.setAttribute("data-reduce-motion", rm==="1"?"1":"0");
    }catch(e){}
    document.addEventListener("visibilitychange", function(){ if(!document.hidden) tick(); });
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
