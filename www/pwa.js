/* Wannabe Library PWA glue.
   Registers the service worker, locks in persistent storage, and downloads a
   bundle's books/comics the moment its entitlement is unlocked (by local code
   or purchase entitlement). Games are already inline in the shell, so they need no
   download — this is only for the heavy books/comics. */
(function(){
  if(!('serviceWorker' in navigator)) return;

  var swReady = navigator.serviceWorker.register('sw.js').then(function(){
    return navigator.serviceWorker.ready;
  }).catch(function(){ return null; });

  /* Auto-update: when a new SW activates and takes control (skipWaiting +
     clients.claim in sw.js), reload ONCE so the user sees the new version
     without a manual hard refresh. Guarded so it never loops, and skipped
     on the very first install (when there was no prior controller). */
  var hadController = !!navigator.serviceWorker.controller;
  var reloadedForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', function(){
    if(reloadedForUpdate) return;
    if(!hadController) return;        /* first install of the SW — no reload */
    reloadedForUpdate = true;
    window.location.reload();
  });

  /* Persistent storage: without this, iOS may evict downloaded content after
     ~7 idle days. Requesting it (esp. once added to Home Screen) protects it. */
  async function lockStorage(){
    try{
      if(navigator.storage && navigator.storage.persist){
        var already = await navigator.storage.persisted();
        if(!already){ await navigator.storage.persist(); }
      }
    }catch(e){}
  }
  lockStorage();

  /* entitlement id -> download bundle id (matches download_manifest.json) */
  var ENT_TO_BUNDLE = {
    'godsverse':'godsverse_series',   'godsverse_series':'godsverse_series',
    'obsidian':'obsidian_series',     'obsidian_series':'obsidian_series',
    'dragonstrife':'dragonstrife_series','dragonstrife_series':'dragonstrife_series',
    'ichabod':'ichabod_series',       'ichabod_series':'ichabod_series',
    'questgirls':'quest_girls_series','quest_girls_series':'quest_girls_series'
  };

  var MANIFEST=null;
  function manifest(){
    if(MANIFEST) return Promise.resolve(MANIFEST);
    return fetch('download_manifest.json').then(function(r){return r.json();})
      .then(function(m){ MANIFEST=m; return m; }).catch(function(){ return {}; });
  }

  /* progress UI ------------------------------------------------------ */
  function bar(){
    var el=document.getElementById('pwaDL');
    if(!el){
      el=document.createElement('div'); el.id='pwaDL';
      el.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:9999;'+
        'background:#161019;color:#f3e9da;font:600 13px/1.4 system-ui,sans-serif;'+
        'padding:10px 14px;box-shadow:0 -2px 12px rgba(0,0,0,.5);display:none';
      el.innerHTML='<div id="pwaDLmsg"></div>'+
        '<div style="height:6px;background:#2a2030;border-radius:4px;margin-top:6px;overflow:hidden">'+
        '<div id="pwaDLfill" style="height:100%;width:0;background:linear-gradient(90deg,#d98a5a,#b8607f);transition:width .2s"></div></div>';
      document.body.appendChild(el);
    }
    return el;
  }
  function showProgress(label, done, total){
    var el=bar(); el.style.display='block';
    document.getElementById('pwaDLmsg').textContent=label+' — '+done+' / '+total+' files';
    document.getElementById('pwaDLfill').style.width=(total?Math.round(done/total*100):0)+'%';
  }
  function hideProgress(label){
    var el=bar();
    document.getElementById('pwaDLmsg').textContent=label+' — downloaded. Available offline.';
    document.getElementById('pwaDLfill').style.width='100%';
    setTimeout(function(){ el.style.display='none'; }, 2500);
  }

  navigator.serviceWorker.addEventListener('message', function(e){
    var d=e.data||{};
    if(d.type==='download-progress'){ showProgress(prettyBundle(d.bundle), d.done, d.total); }
    if(d.type==='download-complete'){
      if(d.ok===false){
        /* Don't mark it downloaded — otherwise the bundle is skipped forever
           and the user can never retry. */
        var _el=bar();
        document.getElementById('pwaDLmsg').textContent=prettyBundle(d.bundle)+' — couldn\u2019t be saved for offline ('+d.failed+' of '+d.total+' files failed). Tap to try again.';
        document.getElementById('pwaDLfill').style.width='100%';
        setTimeout(function(){ _el.style.display='none'; }, 5000);
        return;
      }
      hideProgress(prettyBundle(d.bundle));
      try{ markBundleDownloaded(d.bundle); }catch(_){}
      try{ if(typeof renderBooks==='function') renderBooks(); if(typeof renderShelf==='function') renderShelf(); }catch(_){}
    }
  });

  function prettyBundle(b){
    return ({godsverse_series:'The Godsverse Chronicles',obsidian_series:'The Obsidian Spindle Saga',
      dragonstrife_series:'Dragon Strife',ichabod_series:'Ichabod Jones',quest_girls_series:'Quest Girls'})[b]||'Library';
  }

  var DLKEY='wannabe.downloaded';
  function downloaded(){ try{return JSON.parse(localStorage.getItem(DLKEY)||'{}');}catch(e){return {};} }
  function markBundleDownloaded(b){ var d=downloaded(); d[b]=Date.now(); localStorage.setItem(DLKEY,JSON.stringify(d)); }
  function isBundleDownloaded(b){ return !!downloaded()[b]; }

  /* kick a download for an entitlement, if it maps to a content bundle ---- */
  function downloadForEntitlement(entId){
    var bundle = (entId==='unlock_all') ? '__ALL__' : ENT_TO_BUNDLE[entId];
    if(!bundle) return; /* e.g. a game-only unlock with no extra content */
    Promise.all([swReady, manifest()]).then(function(arr){
      var m=arr[1]||{};
      var bundles = bundle==='__ALL__' ? Object.keys(m) : [bundle];
      var files=[];
      bundles.forEach(function(b){ if(m[b]&&!isBundleDownloaded(b)) files=files.concat(m[b].files.map(function(f){return {url:f.url};})); });
      if(!files.length) return;
      lockStorage();
      Promise.resolve(arr[0] || navigator.serviceWorker.ready).then(function(reg){
        var worker = (navigator.serviceWorker.controller) ||
                     (reg && (reg.active || reg.waiting)) || null;
        if(worker){
          worker.postMessage({ type:'download-bundle',
            bundle:(bundle==='__ALL__'?'__ALL__':bundle), files:files });
          showProgress(bundle==='__ALL__'?'Your library':prettyBundle(bundle), 0, files.length);
        }
      });
    });
  }
  window.__pwaDownloadForEntitlement = downloadForEntitlement;

  /* Unlocking a series NO LONGER auto-downloads the whole bundle. Tapping a
     book fetches just that book (Kindle-style). Offline bulk download is
     opt-in via the per-series "Download all for offline" button, which calls
     window.__pwaDownloadForEntitlement(seriesId) directly. */
})();
