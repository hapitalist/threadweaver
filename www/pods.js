/* pods.js — Weave Pods (co-op reading). Self-contained UI + edge-function calls.
   Backend: weave-pods edge function (create/join/record_unlocks/get_pod/my_pods).
   Auth: uses window.twAuth (exposed by store.js). No login of its own. */
(function(){
  "use strict";
  var RANK_TITLES = ["Unwoven","Novice Weaver","Thread-Walker","Pattern-Reader","Loom-Keeper","Master Weaver","Architect of the Weave"];
  var WEAVE_TOTAL = 864; // total codex entries; for the "% of the Weave lit" line
  var activePod = null;   // {pod, members, unlocked_ids, state}

  function fn(){ return (window.twAuth && window.twAuth.fnBase) || ""; }
  function tok(){ return window.twAuth ? window.twAuth.token() : null; }
  function loggedIn(){ return !!(window.twAuth && window.twAuth.isLoggedIn()); }

  // local codex unlocks (same store the reader/comstation use)
  function localUnlockIds(){
    try{ return Object.keys(JSON.parse(localStorage.getItem("weave.unlocked")||"{}")); }catch(e){ return []; }
  }

  function call(action, body){
    var t = tok();
    if(!t) return Promise.reject(new Error("not signed in"));
    return fetch(fn()+"/weave-pods", {
      method:"POST",
      headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+t },
      body: JSON.stringify(Object.assign({action:action}, body||{}))
    }).then(function(r){ return r.json().then(function(d){ if(!r.ok) throw new Error(d.error||"error"); return d; }); });
  }

  /* ---------- UI ---------- */
  function ensureStyles(){
    if(document.getElementById("podsCss")) return;
    var s=document.createElement("style"); s.id="podsCss";
    s.textContent=[
      "#podsBtn{position:fixed;left:16px;bottom:calc(74px + env(safe-area-inset-bottom));z-index:55;background:#0c1326;border:1px solid #4ac97a;color:#4ac97a;font-family:'Cinzel',serif;letter-spacing:.05em;padding:10px 14px;border-radius:10px;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.45);font-size:13px}",
      "#podsOverlay{position:fixed;inset:0;z-index:9100;background:rgba(6,9,18,.9);backdrop-filter:blur(3px);display:none;overflow-y:auto}",
      "#podsOverlay.on{display:block}",
      "#podsPanel{max-width:560px;margin:0 auto;padding:22px 18px calc(40px + env(safe-area-inset-bottom))}",
      ".pods-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}",
      ".pods-h h2{font-family:'Cinzel',serif;color:#e8b53a;font-size:18px;letter-spacing:.06em}",
      ".pods-x{background:#1d1830;border:1px solid #2e2742;color:#ece3d0;border-radius:9px;padding:8px 13px;cursor:pointer;font-family:'DM Mono',monospace;font-size:12px}",
      ".pods-card{border:1px solid #243150;border-radius:12px;padding:16px;margin-bottom:14px;background:#0a1020}",
      ".pods-card h3{font-family:'Cinzel',serif;color:#e0d0b0;font-size:15px;margin-bottom:6px}",
      ".pods-sub{font-family:'DM Mono',monospace;font-size:12px;color:#9fb0d0;line-height:1.5}",
      ".pods-bar{height:10px;border-radius:6px;background:#16203a;overflow:hidden;margin:12px 0 6px}",
      ".pods-bar > i{display:block;height:100%;background:linear-gradient(90deg,#4ac97a,#e8b53a)}",
      ".pods-rank{font-family:'Cinzel',serif;color:#e8b53a;font-size:14px}",
      ".pods-input{width:100%;box-sizing:border-box;background:#0e0b16;border:1px solid #2e2742;color:#ece3d0;border-radius:9px;padding:11px 12px;font-family:'DM Mono',monospace;font-size:14px;margin:6px 0}",
      ".pods-btn{background:linear-gradient(150deg,#4ac97a,#2f9d57);border:none;color:#06210f;font-weight:700;border-radius:9px;padding:11px 16px;cursor:pointer;font-family:'DM Mono',monospace;font-size:13px;margin-right:8px}",
      ".pods-btn.alt{background:#1d1830;border:1px solid #2e2742;color:#e8b53a}",
      ".pods-code{font-family:'DM Mono',monospace;font-size:20px;letter-spacing:3px;color:#4ac97a;background:#0e0b16;border:1px dashed #2e2742;border-radius:9px;padding:10px 14px;text-align:center;margin:8px 0}",
      ".pods-gate{border-left:3px solid #e8b53a;padding:10px 12px;background:rgba(232,181,58,.07);border-radius:0 9px 9px 0;margin-top:10px;font-family:'DM Mono',monospace;font-size:12px;color:#e8d5a8;line-height:1.5}",
      ".pods-broke{border-left-color:#4ac97a;background:rgba(74,201,122,.08);color:#bfe8cf}",
      ".pods-msg{font-family:'DM Mono',monospace;font-size:12px;color:#c98a8a;min-height:16px;margin-top:8px}",
      ".pods-mem{font-family:'DM Mono',monospace;font-size:12px;color:#9fb0d0;padding:4px 0}"
    ].join("\n");
    document.head.appendChild(s);
  }

  function mountButton(){
    if(document.getElementById("podsBtn")) return;
    var b=document.createElement("button"); b.id="podsBtn"; b.textContent="\u25C8 Weave Pods";
    b.onclick=openPods; document.body.appendChild(b);
    var ov=document.createElement("div"); ov.id="podsOverlay";
    ov.innerHTML='<div id="podsPanel"></div>'; document.body.appendChild(ov);
  }

  function close(){ var o=document.getElementById("podsOverlay"); if(o) o.classList.remove("on"); }

  function openPods(){
    ensureStyles();
    var o=document.getElementById("podsOverlay"); o.classList.add("on");
    if(!loggedIn()){ renderLoggedOut(); return; }
    renderLoading();
    call("my_pods").then(function(d){
      var pods=(d&&d.pods)||[];
      if(pods.length){ openPod(pods[0].id); }     // show the first pod (most users have one)
      else renderNoPod();
    }).catch(function(e){ renderError(e.message); });
  }

  function panel(){ return document.getElementById("podsPanel"); }
  function header(title){ return '<div class="pods-h"><h2>'+title+'</h2><button class="pods-x" onclick="WeavePods.close()">Close</button></div>'; }

  function renderLoggedOut(){
    panel().innerHTML = header("Weave Pods") +
      '<div class="pods-card"><h3>Read together. Light the Weave together.</h3>'+
      '<div class="pods-sub">A Weave Pod is a small group whose shared codex lights up as any member reads. '+
      'You read solo from day one \u2014 a pod just amplifies it. Free reading climbs the pod a couple of ranks; '+
      'when anyone in the pod owns paid books, the whole pod surges ahead together.</div>'+
      '<div style="margin-top:14px"><button class="pods-btn" onclick="WeavePods.login()">Log in to start a pod</button></div></div>';
  }
  function renderLoading(){ panel().innerHTML = header("Weave Pods") + '<div class="pods-sub">Loading your pod\u2026</div>'; }
  function renderError(m){ panel().innerHTML = header("Weave Pods") + '<div class="pods-msg">'+esc(m||"Something went wrong")+'</div><div style="margin-top:12px"><button class="pods-btn alt" onclick="WeavePods.open()">Retry</button></div>'; }

  function renderNoPod(){
    panel().innerHTML = header("Weave Pods") +
      '<div class="pods-card"><h3>Start a pod</h3>'+
      '<div class="pods-sub">Create a pod and share the code with friends. Everything any of you reads lights the shared Weave.</div>'+
      '<input class="pods-input" id="podName" placeholder="Pod name (e.g. The Night Readers)" maxlength="40">'+
      '<button class="pods-btn" onclick="WeavePods.create()">Create pod</button></div>'+
      '<div class="pods-card"><h3>Join a pod</h3>'+
      '<div class="pods-sub">Got a 6-character invite code? Drop it in.</div>'+
      '<input class="pods-input" id="podCode" placeholder="INVITE CODE" maxlength="6" style="text-transform:uppercase">'+
      '<button class="pods-btn alt" onclick="WeavePods.join()">Join pod</button>'+
      '<div class="pods-msg" id="podsMsg"></div></div>';
  }

  // 1.14.82: pod names, invite codes and server messages are user/server text -
  // escape before inserting into the page.
  function esc(v){ return String(v==null?"":v).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function renderPod(d){
    activePod = d;
    var st=d.state||{}, pod=d.pod||{}, members=d.members||[];
    var lit = (d.unlocked_ids||[]).length;
    var pct = Math.min(100, Math.round(lit/WEAVE_TOTAL*100));
    var rankT = RANK_TITLES[st.rank_index||0] || "Unwoven";
    var broke = !!st.gate_broken;
    var gateHtml = broke
      ? '<div class="pods-gate pods-broke">\u2728 The gate is broken. Someone in your pod brought paid books in \u2014 the whole pod is climbing past the free cap. Keep reading; the map keeps lighting.</div>'
      : '<div class="pods-gate">Your pod has lit <b>'+pct+'%</b> of the Weave on free reading. The threads above are waiting \u2014 the cap lifts the moment anyone in the pod owns paid books. <a href="#" onclick="WeavePods.close();return false;" style="color:#e8b53a">Browse paid series \u2192</a></div>';
    var memHtml = members.map(function(m){ return '<div class="pods-mem">\u25CB '+(m.role==="founder"?"\u2605 ":"")+(m.user_id===("self")?"You":("Reader "+String(m.user_id).slice(0,4)))+'</div>'; }).join("");
    panel().innerHTML = header("\u25C8 "+esc(pod.name||"Your Pod")) +
      '<div class="pods-card">'+
        '<div class="pods-rank">'+rankT+'</div>'+
        '<div class="pods-bar"><i style="width:'+pct+'%"></i></div>'+
        '<div class="pods-sub">'+lit+' of '+WEAVE_TOTAL+' codex entries lit \u00b7 '+members.length+' reader'+(members.length===1?"":"s")+' in the pod</div>'+
        gateHtml+
      '</div>'+
      '<div class="pods-card"><h3>Invite readers</h3><div class="pods-sub">Share this code:</div>'+
        '<div class="pods-code">'+esc(pod.invite_code||"\u2014")+'</div>'+
        '<button class="pods-btn alt" onclick="WeavePods.sync()">Push my unlocks to the pod</button></div>'+
      '<div class="pods-card"><h3>Readers</h3>'+memHtml+'</div>';
  }

  function openPod(id){
    renderLoading();
    // first push our own unlocks so the pod reflects this device, then fetch
    var ids = localUnlockIds();
    var after = function(){ call("get_pod",{pod_id:id}).then(renderPod).catch(function(e){ renderError(e.message); }); };
    if(ids.length){ call("record_unlocks",{pod_id:id, entry_ids:ids}).then(after, after); }
    else after();
  }

  /* ---------- actions (exposed) ---------- */
  window.WeavePods = {
    open: openPods,
    close: close,
    login: function(){ if(window.twAuth&&window.twAuth.promptSignin) window.twAuth.promptSignin(); },
    create: function(){
      var name=(document.getElementById("podName")||{}).value||"";
      if(!name.trim()){ msg("Give your pod a name."); return; }
      msg("Creating\u2026");
      call("create_pod",{name:name.trim()}).then(function(d){ openPod(d.pod.id); }).catch(function(e){ msg(e.message); });
    },
    join: function(){
      var code=((document.getElementById("podCode")||{}).value||"").toUpperCase().trim();
      if(code.length<4){ msg("Enter the invite code."); return; }
      msg("Joining\u2026");
      call("join_pod",{invite_code:code}).then(function(d){ openPod(d.pod.id); }).catch(function(e){ msg(e.message); });
    },
    sync: function(){
      if(!activePod) return;
      var ids=localUnlockIds();
      if(!ids.length){ return; }
      call("record_unlocks",{pod_id:activePod.pod.id, entry_ids:ids}).then(function(){ openPod(activePod.pod.id); });
    }
  };
  function msg(m){ var el=document.getElementById("podsMsg"); if(el) el.textContent=m; }

  // hide the pods button while a book/comic/game is open (sacred reading surface)
  window.__podsBtnVisible = function(show){ var b=document.getElementById("podsBtn"); if(b) b.style.display = show?"":"none"; };

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", function(){ ensureStyles(); mountButton(); });
  else { ensureStyles(); mountButton(); }
})();
