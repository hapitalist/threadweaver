/* =====================================================================
   THE COM STATION  —  Mission Brief meta-narrative engine
   Reads books/briefs.json. Wires into the EXISTING app.html plumbing:
     - completion signals: localStorage rdr_done_* / comic_done_*
     - codex %: weaveUnlocked() count / WEAVE.entries.length
     - books-finished count: number of rdr_done_* keys
   Self-contained. Appends one button + one overlay. Does not rewrite app.html.
   ===================================================================== */
(function(){
  "use strict";

  var TW_VERSION = "1.16.0";
  try{ console.log("Thread Weaver v"+TW_VERSION); }catch(e){}

  /* ---------- persistent state (its own namespace) ---------- */
  var SK = {
    seen:      "cs.seenBriefs",      // {briefKey:ts} briefs already shown
    score:     "cs.allegiance",      // integer, - = agent, + = director
    locked:    "cs.locked",          // bar locked at point of no return
    forwards:  "cs.forwards",        // {sealedId:"director"|"agent"} + truth
    badges:    "cs.badges",          // {badgeId:ts}
    falsefeed: "cs.falseFeeds",      // count of false intel sent
    ending:    "cs.ending",          // which ending fired
    coda:      "cs.coda",            // 100% coda shown
    started:   "cs.started",         // recruit intro shown
    queue:     "cs.queue"            // pending briefs not yet read
  };
  function gj(k,d){ try{ var v=localStorage.getItem(k); return v?JSON.parse(v):d; }catch(e){ return d; } }
  function sj(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }
  function gi(k,d){ var v=gj(k,null); return (v===null||isNaN(v))?d:v; }

  /* ---------- briefs data ---------- */
  var B=null, READY=false;
  function load(cb){
    if(B){ cb&&cb(); return; }
    fetch("books/briefs.json").then(function(r){return r.ok?r.json():null;}).then(function(d){
      B=d; READY=!!d; cb&&cb();
    }).catch(function(){ READY=false; cb&&cb(); });
  }

  /* ---------- read real progress signals from app.html's world ---------- */
  function finishedBookIds(){
    // every rdr_done_<id> key => a finished book id
    var ids=[];
    try{
      for(var i=0;i<localStorage.length;i++){
        var k=localStorage.key(i);
        if(k && k.indexOf("rdr_done_")===0) ids.push(k.slice(9));
        if(k && k.indexOf("comic_done_")===0) ids.push(k.slice(11));
      }
    }catch(e){}
    return ids;
  }
  function booksFinishedCount(){ return finishedBookIds().length; }
  function codexPct(){
    // uses the same numbers app.html shows: unlocked / total entries
    try{
      var owned = (typeof weaveUnlocked==="function") ? weaveUnlocked() : gj("weave.unlocked",{});
      var total = (typeof WEAVE!=="undefined" && WEAVE && WEAVE.entries) ? WEAVE.entries.length : 0;
      if(!total) return 0;
      var n=Object.keys(owned).length;
      return Math.max(0, Math.min(100, Math.round(100*n/total)));
    }catch(e){ return 0; }
  }
  function codexUnlockedIds(){
    try{ return (typeof weaveUnlocked==="function")?weaveUnlocked():gj("weave.unlocked",{}); }catch(e){ return {}; }
  }

  /* ---------- which brief should fire for a freshly finished book ---------- */
  function briefForBook(bookId, finishedCountAtThatPoint){
    if(!B) return null;
    // 1. bespoke brief keyed to the real library id
    if(B.bespoke && B.bespoke[bookId]) return {key:"bespoke:"+bookId, textKey:B.bespoke[bookId]};
    // 2. else next count-driven arc beat
    if(B.arc){
      // arc is an ordered list of {at, textKey} style beats; fire the highest 'at' <= count not yet seen
      var seen=gj(SK.seen,{});
      var beat=null;
      B.arc.forEach(function(a){
        var at=a.at||a.count||a.books||0;
        if(finishedCountAtThatPoint>=at){
          var key="arc:"+at;
          if(!seen[key]) { if(!beat || at>(beat.at||0)) beat={at:at,key:key,textKey:a.text||a.textKey||a.brief}; }
        }
      });
      if(beat) return beat;
    }
    return null;
  }

  /* ---------- the engine tick: detect new completions, queue briefs, fire crescendo ---------- */
  function tick(){
    if(!READY) return;
    var seen=gj(SK.seen,{});
    var queue=gj(SK.queue,[]);
    var fin=finishedBookIds();
    var count=fin.length;

    // recruit intro (Act 1 open) on very first finish
    if(count>=1 && !gj(SK.started,false)){
      sj(SK.started,true);
      if(B.text && B.text.recruit_intro){ queue.push({key:"recruit_intro",textKey:"recruit_intro",from:"director"}); seen["recruit_intro"]=Date.now(); }
    }

    // per-book briefs
    fin.forEach(function(id){
      var bk="book:"+id;
      if(seen[bk]) return;
      var br=briefForBook(id,count);
      if(br){
        queue.push({key:bk, textKey:br.textKey, from: pickVoice(count)});
        seen[bk]=Date.now();
        if(br.key && br.key.indexOf("arc:")===0) seen[br.key]=Date.now();
      } else {
        seen[bk]=Date.now(); // mark handled even if no brief, so we don't recheck forever
      }
    });

    // THE HACK — Charlie breaks in at the gate (default 4 books)
    var gate=(B.config&&B.config.hack_gate&&B.config.hack_gate.min_books_finished)||4;
    if(count>=gate && !seen["__hack"]){
      seen["__hack"]=Date.now();
      if(B.text && B.text.hack_intro) queue.push({key:"hack_intro",textKey:"hack_intro",from:"agent",hack:true});
    }

    // sealed unlocks — when a story-critical codex entry is newly owned, offer it for forwarding
    if(count>=gate && B.allegiance && B.allegiance.sealed_unlocks){
      var owned=codexUnlockedIds();
      var fwd=gj(SK.forwards,{});
      B.allegiance.sealed_unlocks.forEach(function(su){
        var cid=su.codex_id||su.id;
        if(owned[cid] && !seen["sealed:"+cid] && !fwd[cid]){
          seen["sealed:"+cid]=Date.now();
          queue.push({key:"sealed:"+cid, sealed:su, from:"sealed"});
        }
      });
    }

    sj(SK.seen,seen);
    sj(SK.queue,queue);

    // CRESCENDO: point of no return + ending at ~85%, coda at 100%
    var pct=codexPct();
    var lockAt=(B.config&&B.config.crescendo&&B.config.crescendo.point_of_no_return_at_percent)||85;
    var codaAt=(B.config&&B.config.crescendo&&B.config.crescendo.final_coda_at_percent)||100;

    if(pct>=lockAt && !gj(SK.locked,false) && count>=gate){
      sj(SK.locked,true);
      computeEnding();
    }
    if(pct>=codaAt && !gj(SK.coda,false)){
      sj(SK.coda,true);
      var q=gj(SK.queue,[]); q.push({key:"coda",textKey:(B.config.crescendo.coda_brief||"coda_100"),from:"director",coda:true}); sj(SK.queue,q);
    }

    updateBadgeDot();
  }

  function pickVoice(count){
    // Director voice through Act 1; after the hack the Agent also speaks. Simple alternation post-hack.
    var gate=(B.config&&B.config.hack_gate&&B.config.hack_gate.min_books_finished)||4;
    if(count<gate) return "director";
    return (count%2===0)?"director":"agent";
  }

  /* ---------- allegiance + endings ---------- */
  function forward(sealedId, to, asFalse){
    var fwd=gj(SK.forwards,{});
    if(fwd[sealedId]) return; // already forwarded
    fwd[sealedId]={to:to, false:!!asFalse, ts:Date.now()};
    sj(SK.forwards,fwd);

    var al=B.allegiance||{};
    var perD = (al.per_forward&&al.per_forward.to_director)||12;
    var perA = (al.per_forward&&al.per_forward.to_agent)||-12;
    var score=gi(SK.score,0);
    if(to==="director") score+=perD;
    else if(to==="agent") score+=perA;
    // false feeds tip less + count toward Double Agent
    if(asFalse){
      var ff=gi(SK.falsefeed,0)+1; sj(SK.falsefeed,ff);
      score = Math.round(score*0.5); // false intel carries half weight
      if(ff>=3) award("double_agent");
    }
    sj(SK.score,score);

    // first-forward badges
    if(to==="director") award("first_forward_director");
    if(to==="agent") award("first_forward_agent");
  }

  function computeEnding(){
    var al=B.allegiance||{}; var e=al.endings||{};
    var s=gi(SK.score,0);
    var which="fence", textKey="ending_fence", badge="double_agent";
    function thresh(o){ return o||{}; }
    var aw=thresh(e.agent_win), dw=thresh(e.director_win), fn=thresh(e.fence);
    var aLte=(aw.score_lte!==undefined)?aw.score_lte:-40;
    var dGte=(dw.score_gte!==undefined)?dw.score_gte:40;
    if(s<=aLte){ which="agent_win"; textKey=(B.config.crescendo.endings&&B.config.crescendo.endings.agent_win)||"ending_save"; badge=aw.badge||"the_unwoven_truth"; }
    else if(s>=dGte){ which="director_win"; textKey=(B.config.crescendo.endings&&B.config.crescendo.endings.director_win)||"ending_doom"; badge=dw.badge||"hand_that_lit_the_dark"; }
    else { which="fence"; textKey=(B.config.crescendo.endings&&B.config.crescendo.endings.fence)||"ending_fence"; badge=fn.badge||"double_agent"; }
    sj(SK.ending,which);
    if(badge) award(badge);
    var q=gj(SK.queue,[]);
    q.push({key:"climax",textKey:(B.config.crescendo.climax_brief||"climax_85"),from:"director",climax:true});
    q.push({key:"ending",textKey:textKey,from:(which==="director_win"?"director":(which==="agent_win"?"agent":"director")),ending:true});
    sj(SK.queue,q);
  }

  function award(id){ if(!id) return; var bd=gj(SK.badges,{}); if(!bd[id]){ bd[id]=Date.now(); sj(SK.badges,bd); } }

  /* ---------- UI ---------- */
  function pendingCount(){ return gj(SK.queue,[]).length; }
  function updateBadgeDot(){
    var dot=document.getElementById("csDot"); if(!dot) return;
    var n=pendingCount(); dot.style.display=n>0?"flex":"none"; dot.textContent=n>9?"9+":String(n);
  }

  var VOICE={
    director:{name:"THE DIRECTOR", cls:"cs-dir"},
    agent:{name:"CHARLIE", cls:"cs-agt"},
    sealed:{name:"SEALED TRANSMISSION", cls:"cs-seal"}
  };

  function brieftext(textKey){
    if(B.text && B.text[textKey]) return B.text[textKey];
    return textKey; // fallback so nothing renders blank
  }

  function openStation(){
    load(function(){
      tick();
      render();
      document.getElementById("csOverlay").classList.add("on");
    });
  }
  function closeStation(){ var o=document.getElementById("csOverlay"); if(o) o.classList.remove("on"); }

  function render(){
    var body=document.getElementById("csBody"); if(!body) return;
    if(!READY){ body.innerHTML='<p class="cs-empty">The com station is dark. (briefs unavailable)</p>'; return; }

    var pct=codexPct(), count=booksFinishedCount();
    var gate=(B.config&&B.config.hack_gate&&B.config.hack_gate.min_books_finished)||4;
    var score=gi(SK.score,0), locked=gj(SK.locked,false);
    var queue=gj(SK.queue,[]);
    var html="";

    // status strip
    html+='<div class="cs-status">';
    html+='<span>Threads charted: <b>'+pct+'%</b></span>';
    html+='<span>Books closed: <b>'+count+'</b></span>';
    if(count>=gate){ html+='<span>Allegiance: '+allegianceLabel(score,locked)+'</span>'; }
    html+='</div>';

    // allegiance bar (after the hack)
    if(count>=gate){
      var pos=Math.max(0,Math.min(100, 50 + (score/80)*50)); // -80..+80 maps to 0..100
      html+='<div class="cs-bar-wrap"><div class="cs-bar-ends"><span>CHARLIE</span><span>THE DIRECTOR</span></div>';
      html+='<div class="cs-bar"><div class="cs-bar-fill" style="left:'+pos+'%"></div></div>';
      if(locked) html+='<div class="cs-locked">— allegiance locked —</div>';
      html+='</div>';
    }

    // pending briefs / sealed unlocks
    if(queue.length){
      html+='<div class="cs-sec">Incoming</div>';
      queue.forEach(function(item,idx){
        if(item.sealed){ html+=sealedCard(item.sealed,idx); }
        else { html+=briefCard(item,idx); }
      });
    } else {
      html+='<p class="cs-empty">No new transmissions. Keep reading — the Weave is watching.</p>';
    }

    // badges
    var bd=gj(SK.badges,{}); var bk=Object.keys(bd);
    if(bk.length){
      html+='<div class="cs-sec">Commendations</div><div class="cs-badges">';
      bk.forEach(function(id){ html+='<span class="cs-badge">'+badgeName(id)+'</span>'; });
      html+='</div>';
    }

    body.innerHTML=html;
    updateBadgeDot();
  }

  function allegianceLabel(s,locked){
    var t = s<=-40?"Charlie's":(s>=40?"the Director's":"unclaimed");
    return '<b>'+t+'</b>'+(locked?' (locked)':'');
  }
  function badgeName(id){
    if(B.badges && B.badges[id] && B.badges[id].name) return B.badges[id].name;
    var map={first_forward_director:"Loyal Recruit",first_forward_agent:"First Leak",double_agent:"Double Agent",the_unwoven_truth:"The Unwoven Truth",hand_that_lit_the_dark:"The Hand That Lit the Dark"};
    return map[id]||id;
  }

  function briefCard(item,idx){
    var v=VOICE[item.from]||VOICE.director;
    var txt=brieftext(item.textKey);
    var h='<div class="cs-card '+v.cls+'">';
    h+='<div class="cs-from">'+v.name+'</div>';
    h+='<div class="cs-msg">'+escapeHtml(txt).replace(/\n/g,"<br>")+'</div>';
    h+='<div class="cs-acts"><button onclick="ComStation.ack('+idx+')">Acknowledge</button></div>';
    h+='</div>';
    return h;
  }

  function sealedCard(su,idx){
    var v=VOICE.sealed;
    var title=su.title||su.codex_id||"Sealed intel";
    var desc=su.desc||su.note||"A story-critical truth has surfaced. Forward it — or bury it in a lie.";
    var h='<div class="cs-card '+v.cls+'">';
    h+='<div class="cs-from">'+v.name+'</div>';
    h+='<div class="cs-seal-title">'+escapeHtml(title)+'</div>';
    h+='<div class="cs-msg">'+escapeHtml(desc)+'</div>';
    h+='<div class="cs-acts cs-seal-acts">';
    h+='<button class="cs-toD" onclick="ComStation.fwd('+idx+',\'director\',false)">Forward to Director</button>';
    h+='<button class="cs-toA" onclick="ComStation.fwd('+idx+',\'agent\',false)">Slip to Charlie</button>';
    h+='<button class="cs-false" onclick="ComStation.fwd('+idx+',\'director\',true)">Feed a lie</button>';
    h+='</div></div>';
    return h;
  }

  function escapeHtml(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  /* ---------- public actions wired to buttons ---------- */
  var Pub={
    open:openStation, close:closeStation,
    ack:function(idx){
      var q=gj(SK.queue,[]); if(idx<0||idx>=q.length) return;
      q.splice(idx,1); sj(SK.queue,q); render();
    },
    fwd:function(idx,to,asFalse){
      var q=gj(SK.queue,[]); var item=q[idx]; if(!item||!item.sealed) return;
      var cid=item.sealed.codex_id||item.sealed.id;
      forward(cid,to,asFalse);
      q.splice(idx,1); sj(SK.queue,q);
      render();
    },
    tick:tick
  };
  window.ComStation=Pub;

  /* ---------- styles ---------- */
  function injectCSS(){
    if(document.getElementById("csCSS")) return;
    var s=document.createElement("style"); s.id="csCSS";
    s.textContent=[
"#csBtn{position:fixed;left:14px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:9000;background:#0c1326;border:1px solid #caa24a;color:#caa24a;font-family:'Cinzel',serif;letter-spacing:.06em;padding:10px 14px;border-radius:6px;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.5);}",
"#csBtn:hover{background:#13203f;}",
"#csDot{position:absolute;top:-8px;right:-8px;min-width:20px;height:20px;border-radius:10px;background:#b5202a;color:#fff;font-family:sans-serif;font-size:11px;display:none;align-items:center;justify-content:center;padding:0 5px;}",
"#csOverlay{position:fixed;inset:0;z-index:9001;background:rgba(4,7,16,.86);backdrop-filter:blur(3px);display:none;}",
"#csOverlay.on{display:flex;align-items:flex-start;justify-content:center;}",
"#csPanel{margin-top:4vh;width:min(680px,94vw);max-height:90vh;overflow:auto;background:#070b16;border:1px solid #caa24a;border-radius:10px;padding:0 0 18px;}",
"#csHead{position:sticky;top:0;background:#0a1020;border-bottom:1px solid #2a3556;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;}",
"#csHead h2{font-family:'Cinzel',serif;color:#caa24a;margin:0;font-size:18px;letter-spacing:.08em;}",
"#csClose{background:none;border:1px solid #555;color:#bbb;border-radius:5px;padding:5px 11px;cursor:pointer;}",
".cs-ver{font-family:'Cinzel',serif;font-size:11px;color:#5d6a8a;letter-spacing:.08em;margin-left:auto;margin-right:12px;}",
"#csBody{padding:16px 20px;color:#dfe3ee;font-family:'Cormorant Garamond',Georgia,serif;font-size:17px;line-height:1.5;}",
".cs-status{display:flex;gap:16px;flex-wrap:wrap;font-size:14px;color:#9fb0d0;border-bottom:1px solid #1c2640;padding-bottom:12px;margin-bottom:14px;}",
".cs-status b{color:#caa24a;}",
".cs-bar-wrap{margin:6px 0 18px;}",
".cs-bar-ends{display:flex;justify-content:space-between;font-family:'Cinzel',serif;font-size:11px;letter-spacing:.05em;color:#8290b0;margin-bottom:4px;}",
".cs-bar{position:relative;height:8px;background:linear-gradient(90deg,#3a1c2a,#1c2640,#2a2418);border-radius:4px;}",
".cs-bar-fill{position:absolute;top:-3px;width:14px;height:14px;border-radius:50%;background:#caa24a;transform:translateX(-50%);box-shadow:0 0 8px #caa24a;transition:left .4s;}",
".cs-locked{text-align:center;font-size:12px;color:#b5202a;margin-top:6px;letter-spacing:.05em;}",
".cs-sec{font-family:'Cinzel',serif;color:#7f8db0;font-size:12px;letter-spacing:.12em;text-transform:uppercase;margin:18px 0 8px;}",
".cs-card{border:1px solid #243150;border-radius:8px;padding:13px 15px;margin-bottom:12px;background:#0a1020;}",
".cs-dir{border-left:3px solid #caa24a;} .cs-agt{border-left:3px solid #4a9fd0;} .cs-seal{border-left:3px solid #9d6bd0;}",
".cs-from{font-family:'Cinzel',serif;font-size:12px;letter-spacing:.08em;color:#caa24a;margin-bottom:6px;}",
".cs-agt .cs-from{color:#4a9fd0;} .cs-seal .cs-from{color:#b98fe0;}",
".cs-msg{white-space:normal;}",
".cs-seal-title{font-family:'Cinzel',serif;color:#e0d0b0;font-size:15px;margin-bottom:6px;}",
".cs-acts{margin-top:11px;display:flex;gap:8px;flex-wrap:wrap;}",
".cs-acts button{font-family:'Cinzel',serif;font-size:12px;letter-spacing:.04em;padding:7px 12px;border-radius:5px;cursor:pointer;border:1px solid #444;background:#11192e;color:#cfd6e6;}",
".cs-toD{border-color:#caa24a!important;color:#caa24a!important;} .cs-toA{border-color:#4a9fd0!important;color:#4a9fd0!important;} .cs-false{border-color:#9d6bd0!important;color:#b98fe0!important;}",
".cs-acts button:hover{background:#1a2540;}",
".cs-badges{display:flex;gap:8px;flex-wrap:wrap;}",
".cs-badge{font-family:'Cinzel',serif;font-size:11px;letter-spacing:.04em;color:#0a1020;background:#caa24a;padding:5px 10px;border-radius:12px;}",
".cs-empty{color:#7f8db0;font-style:italic;}"
].join("\n");
    document.head.appendChild(s);
  }

  /* ---------- mount ---------- */
  // The Com Station is a meta layer — it must never sit over an open book/comic.
  // The host overlay (#host.on) means the reader/comic is active.
  function hostOpen(){
    try{ var h=document.getElementById("host"); return !!(h && h.classList.contains("on")); }catch(e){ return false; }
  }
  function syncBtnVisibility(){
    var b=document.getElementById("csBtn"); if(!b) return;
    var ov=document.getElementById("csOverlay");
    var overlayOpen = ov && ov.style.display==="block";
    b.style.display = (hostOpen() && !overlayOpen) ? "none" : "";
  }

  function mount(){
    injectCSS();
    if(!document.getElementById("csBtn")){
      var btn=document.createElement("button");
      btn.id="csBtn"; btn.innerHTML='⟁ Com Station<span id="csDot"></span>';
      btn.onclick=openStation;
      document.body.appendChild(btn);
    }
    if(!document.getElementById("csOverlay")){
      var ov=document.createElement("div"); ov.id="csOverlay";
      ov.innerHTML='<div id="csPanel"><div id="csHead"><h2>⟁ THE COM STATION</h2><span class="cs-ver">v'+TW_VERSION+'</span><button id="csClose">Close</button></div><div id="csBody"></div></div>';
      document.body.appendChild(ov);
      ov.addEventListener("click",function(e){ if(e.target===ov) closeStation(); });
      document.getElementById("csClose").onclick=closeStation;
    }
    load(function(){ tick(); updateBadgeDot(); });
    syncBtnVisibility();
    // poll for new completions while the app is open (cheap: every 4s)
    setInterval(function(){ load(function(){ tick(); }); syncBtnVisibility(); }, 1500);
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",mount);
  else mount();
})();
