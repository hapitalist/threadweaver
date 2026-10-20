/* Wannabe Library PWA service worker.
   - Precaches the app shell (small: index, readers, libs, codex json, icons).
   - For books/* and comics/* (the big paid content), serves cache-first:
     if the file was downloaded into CACHE_CONTENT after an unlock, serve it
     offline; otherwise fall through to network (so previews/first fetch work). */
/* BUMP SHELL_CACHE ON EVERY DEPLOY. If you don't, returning users keep running
   the old app.html/store.js forever and your fix never reaches them.
   FREE_CACHE is versioned SEPARATELY on purpose: it holds ~44MB of free books,
   so bumping the shell must not force every user to re-download all of it.
   Only bump FREE_CACHE when free_assets.json actually changes. */
var SHELL_CACHE   = 'wl-shell-v1.16.8';
var FREE_CACHE    = 'wl-free-v1.14.81';   /* bumped: free_assets.json changed */      /* the 44MB of free books/comics, offline up front */
var CONTENT_CACHE = 'wl-content-v2';   /* downloader fills this on unlock */

var SHELL = [
  './','./index.html','./app.html','./reader.html','./comic.html',
  './pwa.js','./store.js','./discover.js','./comstation.js','./pods.js','./fun.js','./serials.js','./serial.html','./manifest.webmanifest',
  './lib/jszip.min.js','./lib/epub.min.js','./lib/supabase.js',
  './fonts/atkinson-400.woff2','./fonts/cinzel-latin-600-normal.woff2','./fonts/cinzel-latin-700-normal.woff2','./fonts/cormorant-garamond-latin-500-normal.woff2','./fonts/cormorant-garamond-latin-500-italic.woff2','./fonts/cormorant-garamond-latin-600-normal.woff2','./fonts/cormorant-garamond-latin-600-italic.woff2','./fonts/dm-mono-latin-500-normal.woff2','./fonts/atkinson-700.woff2',
  './books/weave.json','./books/briefs.json','./books/weaver.json','./books/library.json',
  './books/ALL_lore_entries_combined.json','./comics/comics.json',
  './download_manifest.json','./free_assets.json',
  './icons/icon-192.png','./icons/icon-512.png','./icons/maskable-512.png'
];

self.addEventListener('install', function(e){
  self.skipWaiting();
  e.waitUntil(Promise.all([
    caches.open(SHELL_CACHE).then(function(c){
      /* add individually so one 404 doesn't abort the whole install */
      return Promise.all(SHELL.map(function(u){
        return c.add(u).catch(function(){ /* ignore missing optional asset */ });
      }));
    }),
    /* precache the free books/comics so the free tier works offline immediately */
    fetch('free_assets.json').then(function(r){return r.ok?r.json():[];}).then(function(list){
      return caches.open(FREE_CACHE).then(function(fc){
        return Promise.all((list||[]).map(function(u){
          return fc.add(u).catch(function(){});
        }));
      });
    }).catch(function(){})
  ]));
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        if(k!==SHELL_CACHE && k!==FREE_CACHE && k!==CONTENT_CACHE) return caches.delete(k);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  var url = new URL(e.request.url);
  if(e.request.method!=='GET'){ return; }
  /* never touch cross-origin calls */
  if(url.origin !== self.location.origin){ return; }

  var path = url.pathname;

  /* NEVER cache the auth handler. The magic-link / password-reset URL is
     byte-identical every time (the token lives in the URL fragment, which is
     never sent to the server), so caching it once pins whatever version was
     current — including a broken one — on that device forever. */
  if(path.indexOf('/auth/') === 0){ return; }

  /* Only .epub/.jpg/.png/.webp under books|comics are immutable content.
     JSON catalogs under those paths must NOT go in the permanent content
     cache or new books never appear for existing users. */
  var isContent = /\/(books|comics)\/.+\.(epub|jpe?g|png|webp|gif|avif)$/i.test(path);

  /* Shell HTML and JS go network-first so a deploy reaches users immediately;
     the cache is only a fallback for offline. */
  var isCode = e.request.mode === 'navigate' || /\.(html|js|mjs)$/i.test(path) || path === '/' || path === '/app';

  if(isContent){
    /* cache-first; on a successful network fetch, cache it so any book/comic
       you've opened is available offline afterward (Kindle-style). */
    e.respondWith(
      caches.open(CONTENT_CACHE).then(function(cc){ return cc.match(e.request); })
        .then(function(hit){ return hit || caches.open(FREE_CACHE).then(function(fc){ return fc.match(e.request); }); })
        .then(function(hit){
        if(hit) return hit;
        return fetch(e.request).then(function(res){
          if(res && res.ok && (res.type==='basic'||res.type==='default')){
            var copy=res.clone();
            caches.open(CONTENT_CACHE).then(function(c){ c.put(e.request, copy); });
          }
          return res;
        }).catch(function(){
          /* offline AND not cached: return a real Response, never undefined,
             so the reader's open path fails cleanly and can fall back. */
          return hit || new Response('content-unavailable-offline',
            { status: 504, statusText: 'offline', headers: { 'Content-Type': 'text/plain' } });
        });
      })
    );
    return;
  }

  if(isCode){
    /* network-first: always try to get the current deploy, fall back to cache
       only when the network genuinely fails (offline). */
    e.respondWith(
      fetch(e.request).then(function(res){
        if(res && res.ok && res.type==='basic'){
          var copy=res.clone();
          caches.open(SHELL_CACHE).then(function(c){ c.put(e.request, copy); });
        }
        return res;
      }).catch(function(){
        return caches.open(SHELL_CACHE).then(function(c){ return c.match(e.request); }).then(function(hit){
          if(hit) return hit;
          /* offline navigation to an uncached URL: fall back to the app shell
             rather than a blank page. */
          if(e.request.mode === 'navigate'){
            return caches.open(SHELL_CACHE).then(function(c){ return c.match('./app.html'); })
              .then(function(shell){ return shell || new Response('', { status: 504, statusText: 'offline' }); });
          }
          return new Response('', { status: 504, statusText: 'offline' });
        });
      })
    );
    return;
  }

  /* everything else (fonts, icons, images): stale-while-revalidate */
  e.respondWith(
    caches.open(SHELL_CACHE).then(function(c){
      return c.match(e.request).then(function(hit){
        var net = fetch(e.request).then(function(res){
          if(res && res.ok && res.type==='basic'){ c.put(e.request, res.clone()); }
          return res;
        }).catch(function(){
          return hit || new Response('', { status: 504, statusText: 'offline' });
        });
        return hit || net;
      });
    })
  );
});

/* The page asks the SW to pre-download a bundle's files into CONTENT_CACHE.
   Streams progress back via postMessage so the UI can show a bar. */
self.addEventListener('message', function(e){
  var d=e.data||{};
  if(d.type==='download-bundle' && d.files && d.files.length){
    var files=d.files, total=files.length, done=0, failed=0;
    caches.open(CONTENT_CACHE).then(function(cache){
      var i=0;
      function next(){
        if(i>=total){
          /* Report honestly. Paid files are not on the CDN, so every one of them
             404s here; the old code fired download-complete regardless and the
             UI said "Available offline", then refused to retry. */
          reply({type:'download-complete', bundle:d.bundle, ok:(failed===0), failed:failed, total:total});
          return;
        }
        var f=files[i++];
        cache.match(f.url).then(function(have){
          if(have){ done++; progress(); return next(); }
          return fetch(f.url).then(function(res){
            if(res && res.ok){ return cache.put(f.url, res.clone()); }
            failed++;      /* 404 / error: count it, do NOT claim success later */
          }).then(function(){ done++; progress(); next(); })
            .catch(function(){ failed++; done++; progress(); next(); });
        });
      }
      function progress(){ reply({type:'download-progress', bundle:d.bundle, done:done, total:total}); }
      /* small concurrency for speed */
      next();
    });
  }
  function reply(msg){
    self.clients.matchAll().then(function(cs){ cs.forEach(function(c){ c.postMessage(msg); }); });
  }
});
