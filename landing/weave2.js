/* ===================== THE WEAVE, 1.18.0 (17 Nov 2026) =====================
   Russell: the old Weave was a flat timeline picture of ONE thread, text-only thread lists, and endless scrolls of
   locked "???" cards. Now: the nine threads come first, each opens its own page (its books, its timeline, everything
   found there); the codex filters by kind and thread; locked entries fold into "N hidden in <book>" that open the
   book; every entry opens a sheet with its full text, where it appears and what it connects to, all tappable. */
var WV={view:'home', thread:null, kind:null, tf:null, stack:[]};
var WEAVE_Q='';
var WV_COVERS=null;
var WV_THREAD_ART={thread1:'sleeping-beauty',thread27:'change',thread26:'quest-girls',thread_ichabod:'ichabod-1',thread_shared:'anna-and-the-dark-place',thread_wonderland:'white-rabbit',thread_worst:'worst-thing-in-the-universe',thread_marked:'the-marked-ones',thread_invasion:'invasion'};
var WV_THREAD_COLOR={thread1:'#e8b53a',thread27:'#a98bff',thread26:'#e0644f',thread_ichabod:'#7fd08a',thread_shared:'#6fb7e8',thread_wonderland:'#e88fb4',thread_worst:'#d9c38a',thread_invasion:'#8fd3c6',thread_marked:'#c9a0e8'};
var WV_SERIES_THREAD={'Godsverse Chronicles':'thread27','Obsidian Spindle Saga':'thread1','Dragon Strife':'thread1','Quest Girls':'thread26','Wonderland':'thread_wonderland','Ichabod Jones':'thread_ichabod','In-World Comics':'thread27'};
var WV_ID_THREAD={'the-vessel':'thread27','skritchs-revenge':'thread27','godsverse-game':'thread27','obsidian-game':'thread1','dragon-strife-game':'thread1','04-wicked-bodies':'thread1','05-wicked-minds':'thread1',
  'ichabod-game':'thread_ichabod','the-void-calls-us-home-russell-nohelty':'thread_shared','anna-and-the-dark-place':'thread_shared','my-father-didnt-kill-himself':'thread_shared','sorry-for-existing':'thread_shared',
  'gumshoes-the-case-of-madisons-father':'thread_shared','time-is-a-flat-circle':'thread_shared','east-willow-game':'thread_shared','worst-thing-in-the-universe':'thread_worst','paradise':'thread_worst',
  'the-marked-ones':'thread_marked','invasion':'thread_invasion','12-eternity':'thread27'};
var WV_GAME_ID={'godsverse-game':'godsverse','obsidian-game':'obsidian','dragon-strife-game':'dragonstrife','ichabod-game':'ichabod','east-willow-game':'eastwillow','quest-girls-game':'questgirls'};
var WV_KIND={characters:'Characters',places:'Places',objects:'Objects & Relics',powers:'Powers & Beings',cosmology:'The Cosmic Weave',connections:'Connections',threads:'The Threads'};
var WV_KIND_ORDER=['characters','places','objects','powers','cosmology','connections','threads'];

function wvLoadCovers(){ if(WV_COVERS) return; WV_COVERS={}; fetch('books/covers.json').then(function(r){return r.ok?r.json():{};}).then(function(m){ WV_COVERS=m||{}; if(document.getElementById('weave').classList.contains('on')) renderWeave(); }).catch(function(){}); }
function wvItem(id){
  // a book, comic or game the Weave can point at
  var b=(typeof BOOKS!=='undefined'?BOOKS:[]).find(function(x){return x.id===id;});
  if(b) return {kind:'book', id:id, title:b.title, series:b.series, thread:WV_SERIES_THREAD[b.series]||WV_ID_THREAD[id]||null};
  var c=(typeof COMICS!=='undefined'?COMICS:[]).find(function(x){return x.id===id;});
  if(c) return {kind:'comic', id:id, title:c.title, series:c.series, thread:(c.thread==='ichabod'?'thread_ichabod':c.thread)||WV_SERIES_THREAD[c.series]||null, dir:c.dir||id};
  var gid=WV_GAME_ID[id]; var g=gid&&(typeof GAMES!=='undefined'?GAMES:[]).find(function(x){return x.id===gid;});
  if(g) return {kind:'game', id:gid, title:g.title+' (story game)', thread:WV_ID_THREAD[id]||null};
  return {kind:'book', id:id, title:id, thread:WV_ID_THREAD[id]||null};
}
function wvCover(it, cls){
  var f=WV_COVERS&&WV_COVERS[it.id];
  if(f) return '<img class="'+(cls||'wv-cov')+'" src="site/covers/'+f+'.webp" alt="" loading="lazy">';
  if(it.kind==='comic') return '<img class="'+(cls||'wv-cov')+'" src="comics/'+wEsc(it.dir)+'/000.jpg" alt="" loading="lazy">';
  var col=WV_THREAD_COLOR[it.thread]||'#e8b53a';
  return '<span class="'+(cls||'wv-cov')+' wv-covtxt" style="--c:'+col+'">'+wEsc(it.title)+'</span>';
}
function wvOpen(kind,id){
  if(kind==='game'){ closeWeave(); openGame(id); return; }
  jumpFromWeave(kind,id);
}
function wvThreadsOf(e){
  var t={}; (e.anchors||[]).forEach(function(a){ var it=wvItem(a.book); if(it.thread) t[it.thread]=1; });
  return Object.keys(t);
}
function wvIndex(){
  if(WEAVE._wv) return WEAVE._wv;
  var byThread={}, tl=WEAVE.threads||[];
  tl.forEach(function(t){ byThread[t.id]=[]; });
  WEAVE.entries.forEach(function(e){ e._th=wvThreadsOf(e); e._th.forEach(function(t){ (byThread[t]=byThread[t]||[]).push(e); }); });
  // the books in each thread, in shelf order
  var books={};
  (typeof BOOKS!=='undefined'?BOOKS:[]).forEach(function(b){ var t=WV_SERIES_THREAD[b.series]||WV_ID_THREAD[b.id]; if(t)(books[t]=books[t]||[]).push(wvItem(b.id)); });
  (typeof COMICS!=='undefined'?COMICS:[]).forEach(function(c){ var it=wvItem(c.id); if(it.thread)(books[it.thread]=books[it.thread]||[]).push(it); });
  Object.keys(WV_GAME_ID).forEach(function(k){ var it=wvItem(k); if(it.thread&&it.kind==='game')(books[it.thread]=books[it.thread]||[]).push(it); });
  WEAVE._wv={byThread:byThread, books:books};
  // only cache once the shelf has loaded
  if(!(typeof BOOKS!=='undefined'&&BOOKS.length)) delete WEAVE._wv;
  return {byThread:byThread, books:books};
}
function wvThread(id){ return (WEAVE.threads||[]).find(function(t){return t.id===id;}); }
function wvRank(){
  try{ if(typeof WEAVER!=='undefined'&&WEAVER&&typeof weaverStats==='function'&&typeof weaverXP==='function'){ var st=weaverStats(); var xp=weaverXP(st); var r=WEAVER.ranks[0]; WEAVER.ranks.forEach(function(k){ if(xp>=k.min) r=k; }); return r.title; } }catch(e){}
  return 'Unwoven';
}
function wvBar(n,t,col){ var p=t?Math.round(100*n/t):0; return '<div class="wv-bar"><i style="width:'+Math.max(p,n?3:0)+'%;'+(col?'background:'+col:'')+'"></i></div>'; }
/* hidden entries fold into the book that reveals them */
function wvHidden(list, owned){
  var by={}, order=[];
  list.forEach(function(e){ if(owned[e.id]) return; var a=(e.anchors||[])[0]; var k=a?a.book:'_'; if(!by[k]){by[k]=[];order.push(k);} by[k].push(e); });
  if(!order.length) return '';
  order.sort(function(a,b){ return by[b].length-by[a].length; });
  var h='<div class="wv-h3">Still hidden</div><div class="wv-hidden">';
  order.forEach(function(k){
    var n=by[k].length;
    if(k==='_'){ h+='<div class="wv-hrow nolink"><span class="wv-hn">'+n+'</span><span class="wv-ht">hidden across the Weave<small>Keep reading to reveal '+(n===1?'it':'them')+'.</small></span></div>'; return; }
    var it=wvItem(k);
    h+='<button class="wv-hrow" onclick="wvOpen(\''+it.kind+'\',\''+wEsc(it.id)+'\')">'+wvCover(it,'wv-hcov')+'<span class="wv-ht"><b>'+n+' hidden in '+wEsc(it.title)+'</b><small>'+wEsc(by[k][0].teaser||'')+'</small></span><span class="wv-go">'+(it.kind==='game'?'Play':'Read')+'</span></button>';
  });
  return h+'</div>';
}
function wvEntryRow(e){
  return '<button class="wv-erow" onclick="wvEntry(\''+wEsc(e.id)+'\')"><span class="wv-et">'+wEsc(e.title)+'</span><span class="wv-es">'+wEsc(e.teaser||'')+'</span></button>';
}
function wvKindChips(list, owned, cur, fn){
  var cnt={}; list.forEach(function(e){ if(owned[e.id]) cnt[e.cat]=(cnt[e.cat]||0)+1; });
  var h='<div class="wv-chips">'+'<button class="wv-chip'+(!cur?' on':'')+'" onclick="'+fn+'(null)">All</button>';
  WV_KIND_ORDER.forEach(function(k){ var tot=list.filter(function(e){return e.cat===k;}).length; if(!tot) return;
    h+='<button class="wv-chip'+(cur===k?' on':'')+'" onclick="'+fn+'(\''+k+'\')">'+WV_KIND[k]+' <span>'+(cnt[k]||0)+'/'+tot+'</span></button>'; });
  return h+'</div>';
}
function wvGo(view, arg){
  WV.stack.push({view:WV.view, thread:WV.thread, kind:WV.kind, tf:WV.tf});
  WV.view=view;
  if(view==='thread'){ WV.thread=arg; WV.kind=null; }
  if(view==='codex'){ WV.kind=arg||null; WV.tf=null; }
  renderWeave(); var s=document.getElementById('wvScroll'); if(s) s.scrollTop=0;
}
function wvBack(){
  if(document.getElementById('wvSheet').classList.contains('on')){ wvSheetClose(); return; }
  if(WEAVE_Q){ weaveSearchClear(); return; }
  if(!WV.stack.length){ closeWeave(); return; }
  var p=WV.stack.pop(); WV.view=p.view; WV.thread=p.thread; WV.kind=p.kind; WV.tf=p.tf; renderWeave();
}
function wvSetKind(k){ WV.kind=k; renderWeave(); }
function wvSetTF(t){ WV.tf=t; renderWeave(); }
function weaveTab(t){ WV.stack=[]; WV.view=(t==='codex'||t==='places')?'codex':'home'; WV.kind=(t==='places')?'places':null; if(t==='timeline'){ WV.view='thread'; WV.thread='thread27'; } renderWeave(); }
function weaveSearch(v){ WEAVE_Q=(v||'').trim(); document.getElementById('weaveQx').style.display=WEAVE_Q?'block':'none'; renderWeave(); }
function weaveSearchClear(){ WEAVE_Q=''; var i=document.getElementById('weaveQ'); if(i) i.value=''; document.getElementById('weaveQx').style.display='none'; renderWeave(); }

function renderWeave(){
  var body=document.getElementById('weaveBody');
  if(!WEAVE){ body.innerHTML='<div class="wprog">The Weave is still forming…</div>'; return; }
  wvLoadCovers();
  var owned=weaveUnlocked(), all=WEAVE.entries, X=wvIndex();
  var nOwned=all.filter(function(e){return owned[e.id];}).length;
  var title=document.getElementById('wvTitle');
  var h='';
  if(WEAVE_Q){
    var q=WEAVE_Q.toLowerCase();
    var hits=all.filter(function(e){ return ((e.title||'')+' '+(e.body||'')+' '+(e.teaser||'')).toLowerCase().indexOf(q)>-1; });
    var mine=hits.filter(function(e){return owned[e.id];});
    title.textContent='Search';
    h+='<div class="wv-note">'+mine.length+' discovered '+(mine.length===1?'entry matches':'entries match')+' &ldquo;'+wEsc(WEAVE_Q)+'&rdquo;'+(hits.length>mine.length?'. '+(hits.length-mine.length)+' more are still hidden.':'.')+'</div>';
    mine.forEach(function(e){ h+=wvEntryRow(e); });
    h+=wvHidden(hits, owned);
    body.innerHTML=h; return;
  }
  if(WV.view==='home'){
    title.textContent='The Weave';
    h+='<div class="wv-me"><div class="wv-rank">'+wEsc(wvRank())+'</div><div class="wv-count"><b>'+nOwned+'</b> of '+all.length+' secrets discovered</div>'+wvBar(nOwned,all.length)+'</div>';
    h+='<div class="wv-h2">The threads</div><div class="wv-sub">Every universe in these stories is a thread. Tap one to walk it.</div><div class="wv-threads">';
    (WEAVE.threads||[]).forEach(function(t){
      var ents=X.byThread[t.id]||[], got=ents.filter(function(e){return owned[e.id];}).length, col=WV_THREAD_COLOR[t.id]||'#e8b53a';
      var art=WV_THREAD_ART[t.id];
      h+='<button class="wv-thread" style="--c:'+col+'" onclick="wvGo(\'thread\',\''+t.id+'\')">'+(art?'<img src="site/covers/'+art+'.webp" alt="" loading="lazy">':'')+
        '<span class="wv-tb"><span class="wv-tn">'+wEsc(t.name)+'</span><span class="wv-td">'+wEsc(t.blurb)+'</span><span class="wv-tc">'+got+' of '+ents.length+' found</span>'+wvBar(got,ents.length,col)+'</span></button>';
    });
    h+='</div><div class="wv-h2">The codex</div><div class="wv-sub">Everything you have uncovered, sorted.</div><div class="wv-kinds">';
    WV_KIND_ORDER.forEach(function(k){ var tot=all.filter(function(e){return e.cat===k;}).length; if(!tot) return; var got=all.filter(function(e){return e.cat===k&&owned[e.id];}).length;
      h+='<button class="wv-kind" onclick="wvGo(\'codex\',\''+k+'\')"><b>'+WV_KIND[k]+'</b><span>'+got+' of '+tot+'</span></button>'; });
    h+='</div>';
  }
  else if(WV.view==='thread'){
    var t=wvThread(WV.thread)||{}, col=WV_THREAD_COLOR[t.id]||'#e8b53a', ents=X.byThread[t.id]||[], got=ents.filter(function(e){return owned[e.id];});
    title.textContent=t.name||'Thread';
    h+='<div class="wv-thero" style="--c:'+col+'">'+(WV_THREAD_ART[t.id]?'<img src="site/covers/'+WV_THREAD_ART[t.id]+'.webp" alt="">':'')+'<div><div class="wv-tn">'+wEsc(t.name)+'</div><p>'+wEsc(t.blurb||'')+'</p>'+
      (t.dreamer&&t.dreamer!=='unknown'?'<div class="wv-meta">Dreamer: '+wEsc(t.dreamer)+'</div>':'')+'<div class="wv-meta">'+got.length+' of '+ents.length+' found</div>'+wvBar(got.length,ents.length,col)+'</div></div>';
    var bks=X.books[t.id]||[];
    if(bks.length){ h+='<div class="wv-h3">The stories in this thread</div><div class="wv-shelf">';
      bks.forEach(function(it){ h+='<button class="wv-book" onclick="wvOpen(\''+it.kind+'\',\''+wEsc(it.id)+'\')">'+wvCover(it)+'<span>'+wEsc(it.title)+'</span></button>'; }); h+='</div>'; }
    if(t.id==='thread27' && WEAVE.timeline && WEAVE.timeline.events){
      h+='<div class="wv-h3">Timeline of the Godsverse</div><div class="wv-tl">';
      WEAVE.timeline.events.forEach(function(ev){
        var it=ev.comic?wvItem(ev.comic):(ev.book?wvItem(ev.book):null);
        h+='<button class="wv-ev"'+(it?' onclick="wvOpen(\''+it.kind+'\',\''+wEsc(it.id)+'\')"':' disabled')+'><span class="wv-date">'+wEsc(ev.date)+'</span><span class="wv-dot"></span><span class="wv-evb"><b>'+wEsc(ev.story)+'</b><small>'+wEsc(ev['in']||'')+'</small></span>'+(it?'<span class="wv-go">'+(it.kind==='comic'?'Read the comic':'Read')+'</span>':'')+'</button>';
      });
      h+='</div>';
    }
    if(got.length){ h+='<div class="wv-h3">Discovered here</div>'+wvKindChips(ents, owned, WV.kind, 'wvSetKind');
      got.filter(function(e){return !WV.kind||e.cat===WV.kind;}).forEach(function(e){ h+=wvEntryRow(e); }); }
    h+=wvHidden(ents.filter(function(e){return !WV.kind||e.cat===WV.kind;}), owned);
  }
  else if(WV.view==='codex'){
    title.textContent=WV.kind?WV_KIND[WV.kind]:'The codex';
    var list=all.filter(function(e){ return (!WV.kind||e.cat===WV.kind) && (!WV.tf||(e._th||wvThreadsOf(e)).indexOf(WV.tf)>-1); });
    h+=wvKindChips(all.filter(function(e){return !WV.tf||(e._th||wvThreadsOf(e)).indexOf(WV.tf)>-1;}), owned, WV.kind, 'wvSetKind');
    h+='<div class="wv-chips small"><button class="wv-chip'+(!WV.tf?' on':'')+'" onclick="wvSetTF(null)">Every thread</button>';
    (WEAVE.threads||[]).forEach(function(t){ h+='<button class="wv-chip'+(WV.tf===t.id?' on':'')+'" style="--c:'+(WV_THREAD_COLOR[t.id]||'#e8b53a')+'" onclick="wvSetTF(\''+t.id+'\')">'+wEsc(t.name.replace(/^Thread \d+ — /,''))+'</button>'; });
    h+='</div>';
    var mine=list.filter(function(e){return owned[e.id];});
    h+='<div class="wv-note">'+mine.length+' of '+list.length+' discovered</div>';
    mine.forEach(function(e){ h+=wvEntryRow(e); });
    h+=wvHidden(list, owned);
  }
  body.innerHTML=h;
}
function wvEntry(id){
  var e=entryById(id); if(!e) return;
  var owned=weaveUnlocked(), got=owned[e.id];
  var th=(e._th||wvThreadsOf(e)).map(function(t){ var x=wvThread(t); return x?'<button class="wv-tag" style="--c:'+(WV_THREAD_COLOR[t]||'#e8b53a')+'" onclick="wvSheetClose();wvGo(\'thread\',\''+t+'\')">'+wEsc(x.name.replace(/^Thread \d+ — /,''))+'</button>':''; }).join('');
  var h='<div class="wv-skind">'+wEsc(WV_KIND[e.cat]||'')+'</div><h3>'+wEsc(got?e.title:'Still hidden')+'</h3>'+(th?'<div class="wv-tags">'+th+'</div>':'');
  if(got){
    h+='<div class="wv-sbody">'+wEsc(e.body)+'</div>'+weaveLayers(e,owned);
  } else {
    h+='<div class="wv-sbody"><i>'+wEsc(e.teaser||'A discovery waits to be found.')+'</i></div>';
  }
  var seen={}, ap=(e.anchors||[]).filter(function(a){ if(seen[a.book]) return false; seen[a.book]=1; return true; });
  if(ap.length){ h+='<div class="wv-h3">'+(got?'Appears in':'Revealed in')+'</div>';
    ap.forEach(function(a){ var it=wvItem(a.book); h+='<button class="wv-hrow" onclick="wvSheetClose();wvOpen(\''+it.kind+'\',\''+wEsc(it.id)+'\')">'+wvCover(it,'wv-hcov')+'<span class="wv-ht"><b>'+wEsc(it.title)+'</b>'+(a.chapter?'<small>Chapter '+wEsc(a.chapter)+'</small>':'')+'</span><span class="wv-go">'+(it.kind==='game'?'Play':'Read')+'</span></button>'; }); }
  if(got && e.links && e.links.length){
    h+='<div class="wv-h3">Connected</div><div class="wv-links">';
    e.links.forEach(function(l){ var le=entryById(l); if(!le) return; var on=owned[l];
      h+='<button class="wv-link'+(on?'':' dim')+'" onclick="wvEntry(\''+wEsc(l)+'\')">'+(on?wEsc(le.title):'Hidden: '+wEsc(le.teaser||'')) +'</button>'; });
    h+='</div>';
  }
  document.getElementById('wvSheetBody').innerHTML=h;
  var s=document.getElementById('wvSheet'); s.classList.add('on'); document.getElementById('wvSheetBody').scrollTop=0;
}
function wvSheetClose(){ document.getElementById('wvSheet').classList.remove('on'); }
