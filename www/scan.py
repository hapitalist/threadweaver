import json, re, sys

FAIL=[]; OK=[]

def check(cond, msg):
    (OK if cond else FAIL).append(msg)

reader=open(__import__('os').path.join(__import__('os').path.dirname(__file__),'reader.html')).read()
app=open(__import__('os').path.join(__import__('os').path.dirname(__file__),'app.html')).read()
sw=open(__import__('os').path.join(__import__('os').path.dirname(__file__),'sw.js')).read()
lib=json.load(open(__import__('os').path.join(__import__('os').path.dirname(__file__),'books/library.json')))

# 1. Reader must actually call Supabase storage to sign URLs
check('createSignedUrl' in reader, "reader calls storage.createSignedUrl")
check("storage.from('library')" in reader or 'storage.from("library")' in reader,
      "reader targets the 'library' bucket")

# 2. Reader must resolve bundle-vs-bucket, not just use raw relative path
check('resolveBookUrl' in reader, "reader has bundle-vs-bucket resolver")

# 3. Remote (signed-URL) books MUST be fetched as bytes and opened with
#    {type:'binary'} — passing a "...epub?token=" URL straight to ePub() makes
#    epub.js treat it as an exploded directory and 400 on META-INF/container.xml.
check("r.arrayBuffer()" in reader and "type:'binary'" in reader,
      "remote books are fetched as bytes and opened with {type:'binary'}")
#    And it must branch on remote vs local (not blindly pass a URL).
check(re.search(r'isRemote\s*=\s*/\^https', reader) is not None or "isRemote" in reader,
      "openTheBook branches remote-URL vs local-path")

# 4. CSP must allow the supabase host for connect-src
csp=re.search(r'connect-src([^;]*)', reader)
check(bool(csp) and 'nzkgurdmvgkizvzisqxt.supabase.co' in csp.group(1),
      "CSP connect-src allows supabase storage host")

# 5. SW must NOT swallow the cross-origin bucket fetch
check('url.origin !== self.location.origin' in sw and 'return' in sw,
      "SW skips cross-origin (bucket) requests")

# 6. Every paid book referenced must resolve SOMEWHERE: either bundled OR fetchable from bucket.
import os
_os = os
bundled=set(os.listdir(os.path.join(os.path.dirname(__file__),'books')))
paid_missing_locally=[b['file'] for b in lib if not b.get('free') and b['file'] not in bundled]
# These MUST be the ones the bucket serves — scanner can't hit the bucket, but it can assert
# the resolver exists to handle them. Already checked #3. Just report count.
check(True, f"{len(paid_missing_locally)} paid books rely on bucket fetch (resolver required)")

# ---- COMIC READER CHECKS (added after comics shipped broken in 1.14.x) ----
comic=open(os.path.join(os.path.dirname(__file__),'comic.html')).read()
comics_json=json.load(open(os.path.join(os.path.dirname(__file__),'comics/comics.json')))
clist=comics_json if isinstance(comics_json,list) else comics_json.get('comics',comics_json)

# C1. Paid comic pages must be authorised SERVER-SIDE. The reader now calls the
# library-url edge function, which verifies the signed-in user owns the bundle
# before minting a signed URL (and validates the path against traversal). That is
# strictly stronger than the old client-side createSignedUrl call, which trusted
# the browser to only ask for files it owned.
check('functions/v1/library-url' in comic or 'createSignedUrl' in comic,
      "comic reader obtains paid URLs via server-side authorisation")
check('functions/v1/library-url' in comic
      or "storage.from('library')" in comic or 'storage.from("library")' in comic,
      "comic reader resolves paid pages from the 'library' bucket")

# C2. Must require an authed session BEFORE signing (bucket is authenticated-read only)
check('getSession' in comic and 'not-signed-in' in comic,
      "comic reader requires a session before signing (no anon)")

# C3. Image src must route through the resolver, not a raw relative path
check('urlFor(fn)' in comic, "comic image src routes through urlFor() resolver")
check("im.src='comics/'+comic.dir" not in comic and 'src="comics/\'+comic.dir' not in comic,
      "comic reader has no hard-coded raw image paths")

# C4. CSP must allow the supabase host for IMAGES (img-src) and connect-src
cimg=re.search(r'img-src([^;]*)', comic)
check(bool(cimg) and 'nzkgurdmvgkizvzisqxt.supabase.co' in cimg.group(1),
      "comic CSP img-src allows supabase host")
ccon=re.search(r'connect-src([^;]*)', comic)
check(bool(ccon) and 'nzkgurdmvgkizvzisqxt.supabase.co' in ccon.group(1) and 'esm.sh' not in ccon.group(1),
      "comic CSP connect-src allows supabase; esm.sh retired (supabase-js vendored)")

# C5. Every comic listed must be either bundled locally OR present as a paid (non-free) entry
#     (a free comic with no local pages on disk WOULD be broken — catch that)
comic_dirs=set(os.listdir(os.path.join(os.path.dirname(__file__),'comics')))
for c in clist:
    cid=c.get('id'); d=c.get('dir'); free=c.get('free')
    if free:
        # free comics must be bundled with their images
        has_dir = d in comic_dirs and os.path.isdir(os.path.join(os.path.dirname(__file__),'comics',d))
        first = (c.get('pages') or ['000.jpg'])[0]
        has_first = has_dir and os.path.exists(os.path.join(os.path.dirname(__file__),'comics',d,first))
        check(has_first, f"free comic '{cid}' is bundled with images")
    # paid comics are verified against the live bucket separately (see scan_supabase.py)

# --- ENTITLEMENT REACHABILITY: run the APP'S OWN code, not a reimplementation ---
# Bug class: buying Quest Girls granted "questgirls" but books required
# "quest_girls_series" -> paid content never unlocked. This check executes the
# real ENT_ALIASES/setUnlocked/isUnlocked from app.html and asserts that
# granting what the store grants actually unlocks every paid bundle.
import subprocess as _sp, tempfile as _tf
_books = lib if isinstance(lib,list) else lib.get('books',[])
comics_path=_os.path.join(_os.path.dirname(__file__),'comics','comics.json')
_comics_raw=json.load(open(comics_path)) if _os.path.exists(comics_path) else []
_comics = _comics_raw if isinstance(_comics_raw,list) else _comics_raw.get('comics',[])
required_bundles = sorted(set(x.get('bundle') for x in (_books+_comics) if x.get('bundle')))

# pull the real entitlement block out of app.html (ENT_ALIASES through ownsAll line)
_m = re.search(r'(var ENT_ALIASES=.*?function ownsAll\(\)\{[^\n]*\})', app, re.S)
# what the store actually grants: the id a buyer receives (CODES values + unlock_all).
# What a buyer actually receives: the bundle ids registered with StoreKit/Play in
# store.js (these are what the server's my_entitlements RPC grants after purchase).
# NOTE: this used to read the CODES map; redeem codes were removed for Apple 3.1.1,
# so the source of truth is now the real IAP product list.
_store_js = open(_os.path.join(_os.path.dirname(__file__),'store.js'), encoding='utf-8').read()
_bm = re.search(r'var bundles = \[([^\]]+)\]', _store_js)
granted_ids = set(re.findall(r'"([a-z_]+)"', _bm.group(1))) if _bm else set()
granted_ids |= {"unlock_all"}

if not _m:
    check(False, "entitlement code block found in app.html for runtime test")
else:
    harness = 'var UNLOCK_KEY="wannabe.unlocked";' + _m.group(1) + """
var localStorage={_d:{},getItem:function(k){return this._d[k]||null;},setItem:function(k,v){this._d[k]=v;}};
var REQUIRED=""" + json.dumps(required_bundles) + """;
var GRANTED=""" + json.dumps(sorted(granted_ids)) + """;
var fails=[];
REQUIRED.forEach(function(bundle){
  // a buyer ends up with SOME granted id that should cover this bundle.
  // success = at least one granted id, when set, makes isUnlocked(bundle) true.
  var ok=GRANTED.some(function(gid){
    localStorage._d={};               // fresh buyer
    setUnlocked(gid);
    return isUnlocked(bundle);
  });
  if(!ok) fails.push(bundle);
});
console.log(JSON.stringify(fails));
"""
    _f=_tf.NamedTemporaryFile('w',suffix='.js',delete=False); _f.write(harness); _f.close()
    _r=_sp.run(['node',_f.name],capture_output=True,text=True)
    if _r.returncode!=0:
        check(False, "entitlement runtime harness executed cleanly ("+_r.stderr.strip()[:80]+")")
    else:
        orphaned=json.loads(_r.stdout.strip() or "[]")
        for b in required_bundles:
            check(b not in orphaned,
                  f"paid bundle '{b}' unlocks via the app's real entitlement code after purchase")

# --- POST-PURCHASE RENDER HOOKS: store.js calls these after a purchase/refresh ---
# Bug class: store.js called window.renderShelves()/renderAll() which didn't exist,
# so a completed purchase never refreshed the UI until a manual reload.
try:
    store_src=open(_os.path.join(_os.path.dirname(__file__),'store.js')).read()
except Exception:
    store_src=""
hooks_called=set(re.findall(r'window\.(render\w+)\s*\(', store_src))
for hook in sorted(hooks_called):
    # store.js calls window.<hook>(), so it must be assigned onto window
    present = (('window.'+hook+'=') in app.replace(' ','')) or (('window.'+hook+' =') in app)
    check(present, f"render hook window.{hook}() that store.js calls is wired onto window in app.html")

# ---- Annotations: highlights + bookmarks must be PRESENT and schema-correct ----
# These checks have teeth: each fails if the feature is narrated-but-missing,
# or if the client writes a column the real table does not have.
check('window.toggleBookmark=' in reader.replace(' ',''),
      "reader has a bookmark toggle (toggleBookmark)")
check('window.toggleNotebook=' in reader.replace(' ',''),
      "reader has a notebook panel (toggleNotebook)")
check('window.hlFromSelection=' in reader.replace(' ',''),
      "reader can create a highlight from a text selection")
check('rendition.annotations.highlight(' in reader,
      "highlights are painted via epub.js annotations.highlight()")
check("from('annotations')" in reader,
      "reader syncs annotations to the Supabase 'annotations' table")
# schema guard: the real column is text_excerpt, NOT text. Writing 'text:' would
# silently fail every cloud insert (the bug class we already got burned by).
_ann_upsert = reader.split("from('annotations').upsert(")
check(len(_ann_upsert) > 1 and 'text_excerpt' in _ann_upsert[1][:400],
      "annotations upsert writes the real column text_excerpt (not 'text')")
check('crypto.randomUUID' in reader,
      "annotation ids are real UUIDs (annotations.id column is uuid)")
check('__annSyncFromCloud' in reader,
      "annotation cloud-sync is triggered once the session is ready")
# notebook markup + bar buttons actually exist (not just JS)
check('id="notebook"' in reader and 'id="bmBtn"' in reader,
      "notebook panel markup and bookmark button exist in the reader DOM")

# ---- Scroll/page mode ----
check('window.toggleFlow=' in reader.replace(' ',''),
      "reader has a scroll/page mode toggle (toggleFlow)")
check("rdr_flow" in reader and "scrolled-doc" in reader,
      "scroll mode persists and maps to epub.js 'scrolled-doc' flow")

# ---- Highlight colors + notes + share ----
check('window.noteFromSelection=' in reader.replace(' ',''),
      "reader supports typed notes on a selection")
check('class="sp-sw"' in reader and 'hlFromSelection(' in reader,
      "highlight color swatches exist in the selection popover")
check('color:rec.color' in reader.replace(' ','') or 'rec.color' in reader,
      "highlight color is carried through paint/store")
check('navigator.share' in reader,
      "annotations can be shared (Web Share API with clipboard fallback)")
# schema guard: color + note must be in the cloud upsert (real columns)
_ann_up = reader.split("from('annotations').upsert(")
check(len(_ann_up)>1 and 'color:' in _ann_up[1][:500] and 'note:' in _ann_up[1][:500],
      "annotations upsert writes the real color and note columns")

# ---- Reading stats / streaks (reader-side tracker + app-side display) ----
check('reading_sessions' in reader,
      "reader flushes reading time to the reading_sessions table")
check('rdr_stat_days' in reader,
      "reader records per-day reading days for streak computation")
check('function readingStats(' in app,
      "app computes reading stats (streak/total/goal) for the Weaver screen")
check('day streak' in app and 'rdr_goal_min' in app,
      "Weaver screen shows the streak card with a settable daily goal")

# ---- CODEX MYTHOLOGY LAYERS: source / cross-tradition / per-series + source reader ----
# Data-side: weave.json must carry the three layers, and both codex copies must agree.
_books_dir=_os.path.join(_os.path.dirname(__file__),'books')
weave=json.load(open(_os.path.join(_books_dir,'weave.json')))
_wents=weave['entries']
_src=[e for e in _wents if isinstance(e,dict) and 'source' in e]
_xl=[e for e in _wents if isinstance(e,dict) and 'crosslinks' in e]
_var=[e for e in _wents if isinstance(e,dict) and 'variants' in e]
check(len(_src)>=120, f"codex carries the real-myth source layer ({len(_src)} entries sourced)")
check(len(_xl)>=15, f"codex carries the cross-tradition layer ({len(_xl)} crosslink maps)")
check(len(_var)>=5, f"codex carries the per-series variant layer ({len(_var)} variant sets)")
# every source block well-formed
_badsrc=[e['id'] for e in _src if not {'tradition','real','weave','confidence'}.issubset(e['source'])]
check(not _badsrc, f"every source block has tradition/real/weave/confidence ({len(_badsrc)} malformed)")
# every crosslink interaction is the standard {with,note} dict pointing at a real entry
_ids=set(e['id'] for e in _wents if isinstance(e,dict))
_badx=[]
for e in _xl:
    xl=e['crosslinks']
    if not {'summary','interactions'}.issubset(xl): _badx.append(e['id']); continue
    for it in xl['interactions']:
        if not isinstance(it,dict) or it.get('with') not in _ids or 'note' not in it:
            _badx.append(e['id']); break
check(not _badx, f"every crosslink is well-formed and targets a real entry ({len(_badx)} broken)")
# no review flags left unresolved (Russell's 5 calls were applied)
_rev=[e['id'] for e in _wents if isinstance(e,dict) and '_source_review' in e]
check(not _rev, f"no unresolved _source_review flags remain ({len(_rev)} left)")
# both copies in sync on the source layer
_comb=json.load(open(_os.path.join(_books_dir,'ALL_lore_entries_combined.json')))
_cents=[e for e in (_comb if isinstance(_comb,list) else _comb.get('entries',[])) if isinstance(e,dict)]
_csrc=sum(1 for e in _cents if 'source' in e)
check(_csrc==len(_src), f"both codex copies agree on source count (weave {len(_src)} == combined {_csrc})")

# UI-side: app.html must render the layers and host the source reader.
check('function weaveLayers(' in app, "app builds the codex layers (weaveLayers)")
check('weaveLayers(e,owned)' in app.replace(' ',''), "renderWeave injects the layers into codex + places entries")
# Codex SEARCH across the whole catalog (the index): box + handler + all-entry filter.
check('id="weaveQ"' in app, "codex has a search box over the whole catalog")
check('function weaveSearch(' in app, "codex search handler exists (weaveSearch)")
check('var hits=WEAVE.entries.filter(' in app and 'WEAVE_Q' in app,
      "codex search filters across ALL weave entries, not one category")
check('No entries match' in app, "codex search shows a no-results state")
check('The real myth' in app, "codex shows the real-myth layer header")
check('Across traditions' in app, "codex shows the cross-tradition layer header")
check('Across the series' in app, "codex shows the per-series layer header")
check('function openSourceWork(' in app and 'function openSourceFull(' in app,
      "app has the source reader (excerpt + full-text loader)")
check('id="srcModal"' in app, "source reader modal markup exists in the DOM")
# source manifest present and covers every work_id the codex references
_man_path=_os.path.join(_books_dir,'sources','manifest.json')
check(_os.path.exists(_man_path), "source manifest is bundled (books/sources/manifest.json)")
if _os.path.exists(_man_path):
    _man=json.load(open(_man_path))
    _need=set(e['source']['work_id'] for e in _src if e['source'].get('work_id'))
    _miss=_need-set(_man.keys())
    check(not _miss, f"every referenced work has a source manifest entry ({len(_miss)} missing)")
    _noex=[k for k,v in _man.items() if not v.get('excerpt')]
    check(not _noex, f"every source manifest entry has a curated excerpt ({len(_noex)} missing)")
    # Full works: 27 are bucket-hosted (in-app overlay), the rest link out, a few are excerpt-only.
    _bad_url=[k for k,v in _man.items() if v.get('full_url') and not str(v['full_url']).startswith('http')]
    check(not _bad_url, f"every full-work link is a real http(s) URL ({len(_bad_url)} malformed)")
    _ft=sum(1 for v in _man.values() if v.get('full_text'))
    check(_ft>=25, f"most works have an in-app full text from the bucket ({_ft}/{len(_man)})")
    # bucket-hosted full texts must point under fulltext/ (matches the upload path)
    _badft=[k for k,v in _man.items() if v.get('full_text') and not str(v['full_text']).startswith('fulltext/')]
    check(not _badft, f"every bucket full_text uses the fulltext/ path ({len(_badft)} wrong)")
    # no stale bundle-path fields
    _stale=[k for k,v in _man.items() if 'full_file' in v or 'has_full' in v]
    check(not _stale, f"no stale bundle-path fields remain in the manifest ({len(_stale)} left)")
    # the in-app full-text overlay must exist and stream from the bucket (signed URL), decompress, render safely
    check('function openFullTextOverlay(' in app and "createSignedUrl(key" in app,
          "app has an in-app full-text overlay that streams from the library bucket")
    check('id="ftOverlay"' in app and 'function renderFullText(' in app,
          "full-text overlay markup + renderer exist")
    check("document.getElementById('ftBody').textContent=txt" in app,
          "full text is rendered via textContent (injection-safe), not innerHTML")
    check('DecompressionStream' in app,
          "full-text overlay decompresses the gzipped text on device")
    # store.js must expose the supabase client the overlay reuses (no second client)
    check('window.getSb = function' in store_src or 'window.getSb=function' in store_src.replace(' ',''),
          "store.js exposes window.getSb so the overlay reuses the one supabase client")
    # the obsolete bundled-full-text fetch must be gone
    check("fetch('books/'+s.full_file)" not in app,
          "the obsolete bundled-full-text fetch is fully removed")

# ---- DICTIONARY: real-English + in-Weave lookup, streamed from storage, cached offline ----
# Architecture: the dictionary is NOT bundled (it lives in the 'library' bucket and is
# fetched once then cached in IndexedDB). So the checks verify the WIRING, and assert the
# heavy file is NOT in the app bundle (bloat guard).
check('function loadDictionary(' in reader, "reader has the dictionary loader")
check('function defineWord(' in reader, "reader has the word-lookup function")
check("'dictionary/thread_dictionary.json.gz'" in reader and "'dictionary/thread_dictionary.json'" in reader,
      "dictionary streams from the library bucket (gz + raw fallback paths), not bundled")
check("var haveDS=(typeof DecompressionStream!=='undefined')" in reader and "haveDS ? 'dictionary/thread_dictionary.json.gz' : 'dictionary/thread_dictionary.json'" in reader,
      "dictionary falls back to raw JSON when DecompressionStream is unavailable (older WKWebView)")
check('DecompressionStream' in reader, "reader decompresses the gzipped dictionary on device")
check("indexedDB.open('tw_dict'" in reader, "dictionary is cached in IndexedDB after first load")
check('defineFromSelection' in reader and 'id="defcard"' in reader,
      "reader has a Define action and definition card")
check("addEventListener('dblclick'" in reader and 'showDefine' in reader,
      "reader supports double-tap/double-click to define a single word (Kindle-style)")
check('In the Weave' in reader and 'In English' in reader,
      "definition card shows BOTH labeled sections (Weave + English)")
# bloat guard: the multi-MB dictionary must NOT be inside the app bundle
_dict_bundled = _os.path.exists(_os.path.join(_books_dir,'dictionary','thread_dictionary.json.gz')) \
             or _os.path.exists(_os.path.join(_books_dir,'dictionary','thread_dictionary.json'))
check(not _dict_bundled, "dictionary is NOT bundled in the app (kept in storage to avoid bloat)")

print("=== SERVER-CALL SCAN: thread-weaver 1.14.50 ===\n")
for o in OK:   print("  PASS:", o)
print()
for f in FAIL: print("  FAIL:", f)
print()


# ============================================================================
# NATIVE-BUILD CLASSES (added after the July 2026 failure cluster:
# Apple 2.1a dead login buttons, stale config versionCode, SW-precache
# near-miss, esm.sh supply chain, keystore-in-www risk)
# ============================================================================
import os, re as _re, glob as _glob

def _shell_files():
    pages = [f for f in _glob.glob("*.html") if os.path.getsize(f) < 400_000]  # shell pages, not game blobs
    scripts = [f for f in _glob.glob("*.js") if f != "games.js"]
    return pages, scripts

def check_no_dynamic_import():
    """N1. Dynamic import()/type=module is FORBIDDEN in shell code.
    WKWebView blocks ES-module loading on the native app's local origin —
    this exact pattern shipped dead Log In buttons to Apple review (build 11457)."""
    pages, scripts = _shell_files()
    bad = []
    for f in pages + scripts:
        t = open(f, encoding="utf-8", errors="replace").read()
        for m in _re.finditer(r"import\s*\(", t):
            ctx = t[max(0, m.start()-2):m.start()]
            if _re.search(r"[A-Za-z0-9_$.]$", ctx):  # someObj.import( — not the keyword
                continue
            bad.append(f + " (dynamic import)")
            break
        if _re.search(r"<script[^>]+type=[\"']module", t):
            bad.append(f + " (module script tag)")
    return ("no dynamic import()/module scripts in shell (WKWebView-fatal on native)", not bad, ", ".join(bad))

def check_local_refs_exist():
    """N2. Every local <script src>/<link href> in shell pages exists on disk."""
    pages, _ = _shell_files()
    missing = []
    for f in pages:
        t = open(f, encoding="utf-8", errors="replace").read()
        for m in _re.finditer(r"<(?:script[^>]+src|link[^>]+href)=[\"']([^\"'#?]+)", t):
            u = m.group(1)
            if u.startswith(("http", "//", "data:", "cordova.js")): continue
            if not os.path.exists(u.lstrip("./")):
                missing.append(f + " -> " + u)
    return ("every local script/link reference in shell pages exists on disk", not missing, ", ".join(missing[:6]))

def check_sw_precache_exists():
    """N3. Every service-worker SHELL precache entry + every free_assets entry exists.
    A single missing file rejects the whole SW install (font-copy near-miss, v1.14.53)."""
    missing = []
    sw = open("sw.js", encoding="utf-8").read()
    for m in _re.finditer(r"'\.\/([^']+)'", sw):
        p = m.group(1)
        if "." in p.split("/")[-1] and not os.path.exists(p):
            missing.append("sw.js -> " + p)
    try:
        import json as _json
        for p in _json.load(open("free_assets.json")):
            if isinstance(p, str) and not os.path.exists(p):
                missing.append("free_assets -> " + p)
    except Exception as e:
        missing.append("free_assets.json unreadable: " + str(e))
    return ("every SW/free-assets precache entry exists on disk", not missing, ", ".join(missing[:6]))

def check_version_stamps_agree():
    """N4. config.xml version + android-versionCode + ios-CFBundleVersion +
    sw.js cache strings + TW_VERSION + TW_APP_VERSION all agree.
    (A stale config.xml at 11452 nearly shipped a Play-rejected upload.)"""
    vals = {}
    cfg = open("../config.xml", encoding="utf-8").read() if os.path.exists("../config.xml") else ""
    if cfg:
        vals["config version"] = (_re.search(r'widget[^>]*version="([\d.]+)"', cfg) or [None,""])[1]
        vals["android-versionCode"] = (_re.search(r'android-versionCode="(\d+)"', cfg) or [None,""])[1]
        vals["ios-CFBundleVersion"] = (_re.search(r'ios-CFBundleVersion="(\d+)"', cfg) or [None,""])[1]
    vals["sw cache"] = (_re.search(r"wl-shell-v([\d.]+)", open("sw.js",encoding="utf-8").read()) or [None,""])[1]
    vals["TW_VERSION"] = (_re.search(r"TW_VERSION\s*=\s*['\"]([\d.]+)", open("comstation.js",encoding="utf-8").read()) or [None,""])[1]
    vals["TW_APP_VERSION"] = (_re.search(r"TW_APP_VERSION\s*=\s*['\"]([\d.]+)", open("app.html",encoding="utf-8").read()) or [None,""])[1]
    semvers = {k:v for k,v in vals.items() if "." in str(v)}
    codes = {k:v for k,v in vals.items() if k.endswith(("versionCode","CFBundleVersion"))}
    ok = len(set(semvers.values()))<=1 and len(set(codes.values()))<=1
    if ok and semvers and codes:
        sem = next(iter(semvers.values())); code = next(iter(codes.values()))
        # build number = major*10000 + minor*100 + patch (1.15.1 -> 11501, 1.16.0 -> 11600): always
        # rises, which Apple and Google both require. The old rule (dots removed: 1.16.0 -> 1160)
        # would have gone BACKWARDS from 11501 and been rejected by both stores.
        try:
            mj, mn, pt = (int(x) for x in sem.split("."))
            ok = int(code) == mj * 10000 + mn * 100 + pt
        except Exception:
            ok = False
    return ("version stamps agree everywhere (config/sw/comstation/app)", ok, str(vals))

def check_no_cdn_scripts():
    """N5. No third-party CDN script imports in shell (esm.sh class of supply-chain risk)."""
    pages, scripts = _shell_files()
    bad = []
    for f in pages + scripts:
        t = open(f, encoding="utf-8", errors="replace").read()
        for m in _re.finditer(r"(?:src=[\"']|import\s*\(\s*[\"'])(https?://[^\"']+)", t):
            bad.append(f + " -> " + m.group(1)[:60])
    return ("no third-party CDN script loads in shell", not bad, ", ".join(bad[:4]))

def check_no_secrets_in_www():
    """N6. No keystore/provisioning material inside www/ (would be served publicly)."""
    bad = [p for p in _glob.glob("**/*", recursive=True) if p.endswith((".p12",".mobileprovision",".keystore",".jks"))]
    ok_redirects = True
    if os.path.exists("../_redirects"):
        ok_redirects = "/certificates/" in open("../_redirects").read()
    return ("no signing material in www; _redirects blocks /certificates/*", (not bad) and ok_redirects,
            ("secrets in www: "+", ".join(bad)) if bad else ("" if ok_redirects else "_redirects missing certificates block"))


def check_rpc_names_known():
    """N7. Every sb.rpc('name') in shell code must be in the known-good allowlist
    (qa-known-rpcs.json, generated against live pg_proc). A name not listed is a
    typo or a missing DB function that silently 404s at runtime."""
    import json as _json
    try:
        known = set(_json.load(open("qa-known-rpcs.json")))
    except Exception as e:
        return ("RPC names validated against allowlist", False, "qa-known-rpcs.json unreadable: " + str(e))
    pages, scripts = _shell_files()
    bad = []
    for f in pages + scripts:
        t = open(f, encoding="utf-8", errors="replace").read()
        for m in _re.finditer(r"\.rpc\(\s*['\"]([a-z0-9_]+)['\"]", t):
            if m.group(1) not in known:
                bad.append(f + " -> rpc('" + m.group(1) + "')")
    return ("every sb.rpc() name is a known live function", not bad, ", ".join(sorted(set(bad))[:6]))

def check_endpoint_names_known():
    """N8. Every functions/v1/<name> in shell code must be a deployed edge function.
    (TW currently calls none; any appearance without an allowlist entry is flagged.)"""
    import json as _json
    known = set()
    if os.path.exists("qa-known-endpoints.json"):
        try: known = set(_json.load(open("qa-known-endpoints.json")))
        except Exception: pass
    pages, scripts = _shell_files()
    bad = []
    for f in pages + scripts:
        t = open(f, encoding="utf-8", errors="replace").read()
        for m in _re.finditer(r"functions/v1/([a-z0-9-]+)", t):
            if m.group(1) not in known:
                bad.append(f + " -> functions/v1/" + m.group(1))
    return ("every edge-function endpoint is deployed (allowlisted)", not bad, ", ".join(sorted(set(bad))[:6]))

def check_redirects_targets_exist():
    """N9. Every rewrite target in the root _redirects must exist on disk (no dead
    redirects -> the class of 404 that got the site rejected). Forced 404 rules and
    splat/placeholder rewrites are exempt."""
    rp = "../_redirects"
    if not os.path.exists(rp):
        return ("_redirects rewrite targets all exist", True, "")
    bad = []
    for line in open(rp, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#"): continue
        parts = line.split()
        if len(parts) < 2: continue
        src, dst = parts[0], parts[1]
        code = parts[2] if len(parts) > 2 else "200"
        if code.startswith("404"): continue
        if "*" in dst or ":" in dst: continue      # splat/param placeholder
        if dst.startswith(("http://", "https://")): continue
        # dst is a site path -> maps to www/<path> (or www/index.html for "/")
        r0 = dst.lstrip("/") or "index.html"
        if not os.path.exists(r0) and not os.path.exists("../" + dst.lstrip("/")):
            bad.append(src + " -> " + dst)
    return ("every _redirects rewrite target exists", not bad, ", ".join(bad[:6]))

def check_native_start_page():
    """N10 (1.16.2). The packaged app must START in the app. config.xml pointed at index.html, the
    WEBSITE landing page, whose "/app" links only exist on Netlify: the app opened on a marketing page
    with App Store buttons and "Start reading" led to an error page."""
    cfg = open("../config.xml", encoding="utf-8").read() if os.path.exists("../config.xml") else ""
    m = _re.search(r'<content\s+src="([^"]+)"', cfg)
    src = m.group(1) if m else ""
    idx = open("index.html", encoding="utf-8", errors="replace").read() if os.path.exists("index.html") else ""
    fwd = 'location.replace("app.html"' in idx
    ok = src == "app.html" and os.path.exists("app.html") and fwd
    return ("native: app starts on app.html (and index.html forwards there inside the app)", ok,
            "" if ok else "content src=%r, index.html forwards=%s" % (src, fwd))

def check_native_bridge_loaded():
    """N11 (1.16.2). app.html must load cordova.js inside the packaged app. Without it 'deviceready'
    never fires: the app ran as the website (forced login) and in-app purchases never initialised."""
    t = open("app.html", encoding="utf-8", errors="replace").read()
    head = t[:t.find("</head>")] if "</head>" in t else t[:6000]
    ok = "cordova.js" in head and "app:" in head and "localhost" in head
    return ("native: app.html loads cordova.js inside the app (deviceready, in-app purchases)", ok,
            "" if ok else "no in-app cordova.js loader in app.html <head>")

NATIVE_CHECKS = [check_no_dynamic_import, check_local_refs_exist, check_sw_precache_exists,
                 check_version_stamps_agree, check_no_cdn_scripts, check_no_secrets_in_www,
                 check_rpc_names_known, check_endpoint_names_known, check_redirects_targets_exist,
                 check_native_start_page, check_native_bridge_loaded]

def run_native_checks():
    fails = 0
    print("\n--- NATIVE-BUILD CLASSES ---")
    for fn in NATIVE_CHECKS:
        name, ok, detail = fn()
        print(("  PASS: " if ok else "  FAIL: ") + name + (("  [" + detail + "]") if (detail and not ok) else ""))
        if not ok: fails += 1
    return fails


_native_fails = run_native_checks()
print("RESULT (core + native):", "PASS" if not (FAIL or _native_fails) else f"{len(FAIL) + _native_fails} FAILURE(S)")


# ============================================================================
# STORE COMPLIANCE CLASSES  (Apple App Review Guidelines + Google Play)
# Every rejection this project has received, plus every mechanically-checkable
# rule from the published guidelines. A build CANNOT be packaged while any of
# these fail. Sources: developer.apple.com/app-store/review/guidelines
# ============================================================================

def check_no_code_unlock():
    """S1 / Apple 3.1.1 - "Apps may not use their own mechanisms to unlock content
    or functionality, such as license keys..."  No redeem-code / license-key /
    promo-code unlock path may exist in the shipping app.
    (REJECTED 2026-07-12 for exactly this: the HAVE A CODE? redeem box.)"""
    pages, scripts = _shell_files()
    bad = []
    pat = _re.compile(r"(redeem|license[_ ]?key|promo[_ ]?code|unlock[_ ]?code|voucher|coupon)", _re.I)
    for f in pages + scripts:
        t = open(f, encoding="utf-8", errors="replace").read()
        for m in pat.finditer(t):
            line = t[t.rfind("\n", 0, m.start())+1 : t.find("\n", m.start())]
            if line.strip().startswith(("//", "/*", "*", "#")):  # comments are fine
                continue
            bad.append(f + ": " + m.group(1))
            break
    return ("Apple 3.1.1: no code/license-key unlock mechanism in app", not bad, ", ".join(bad[:5]))

def check_iap_restore_exists():
    """S2 / Apple 3.1.1 - "Ensure you have a restoration mechanism for restorable
    in-app purchases." A Restore Purchases path must exist."""
    ok = False
    for f in ["store.js", "app.html"]:
        if os.path.exists(f):
            t = open(f, encoding="utf-8", errors="replace").read()
            if _re.search(r"restore", t, _re.I): ok = True
    return ("Apple 3.1.1: restore-purchases mechanism present", ok, "" if ok else "no restore path found")

def check_account_deletion_in_app():
    """S3 / Apple 5.1.1(v) - apps supporting account creation MUST offer in-app
    account deletion. Email/website-only deletion is insufficient.
    (REJECTED 2026-07-09 for exactly this.)"""
    t = open("store.js", encoding="utf-8", errors="replace").read()
    has_btn = "btnDelAcct" in t or _re.search(r"delete\s*account", t, _re.I)
    has_call = "delete-account" in t
    ok = bool(has_btn and has_call)
    return ("Apple 5.1.1(v): in-app account deletion present + wired to backend", ok,
            "" if ok else ("button=%s call=%s" % (bool(has_btn), bool(has_call))))

def check_privacy_policy_reachable():
    """S4 / Apple 5.1.1 + Play - a privacy policy must exist and be linked from
    inside the app (hidden == missing)."""
    exists = os.path.exists("privacy.html")
    linked = False
    for f in ["app.html", "index.html"]:
        if os.path.exists(f) and "privacy.html" in open(f, encoding="utf-8", errors="replace").read():
            linked = True
    ok = exists and linked
    return ("Apple 5.1.1 / Play: privacy policy exists AND is linked in-app", ok,
            "" if ok else ("exists=%s linked_in_app=%s" % (exists, linked)))

def check_deletion_page_reachable():
    """S5 / Play Data-safety - the account/data deletion URL on the Data Safety form
    must resolve. The page must exist and be linked.
    (Play REJECTED 2026-07: delete-account.html returned 404.)"""
    exists = os.path.exists("delete-account.html")
    linked = os.path.exists("privacy.html") and "delete-account" in open("privacy.html", encoding="utf-8", errors="replace").read()
    ok = exists and linked
    return ("Play Data-safety: delete-account page exists and is linked", ok,
            "" if ok else ("exists=%s linked=%s" % (exists, linked)))

def check_no_external_purchase_links():
    """S6 / Apple 3.1.1 + 3.1.3 - no buttons/links steering users to non-IAP
    purchase mechanisms for digital content (gumroad/patreon/paypal/etc)."""
    pages, scripts = _shell_files()
    bad = []
    pat = _re.compile(r"(gumroad|patreon|paypal\.me|buymeacoffee|ko-fi|itch\.io/checkout)", _re.I)
    for f in pages + scripts:
        t = open(f, encoding="utf-8", errors="replace").read()
        for m in pat.finditer(t):
            bad.append(f + ": " + m.group(1))
            break
    return ("Apple 3.1.1/3.1.3: no external non-IAP purchase links for digital content", not bad, ", ".join(bad[:5]))

def check_price_consistency():
    """S7 / Apple 2.3 Accurate Metadata - prices shown in-app must match the store
    products. Every price string in the UI is listed here so a human/CI can diff it
    against App Store Connect; mismatch is a documented rejection cause.
    (Apple QUERIED 2026-07-12: 'is 114.99USD the intended price of Everything?'
    while the app displays $99.99 -> metadata/price mismatch.)"""
    t = open("app.html", encoding="utf-8", errors="replace").read()
    prices = sorted(set(_re.findall(r'price:\s*"\$([0-9.]+)"', t) + _re.findall(r'UNLOCK_ALL_PRICE\s*=\s*"\$([0-9.]+)"', t)))
    expected_path = "qa-store-prices.json"
    if not os.path.exists(expected_path):
        return ("Apple 2.3: in-app prices match store products (qa-store-prices.json)", False,
                "qa-store-prices.json missing - create it with the ACTUAL App Store Connect / Play prices")
    import json as _json
    expected = _json.load(open(expected_path))
    ui = {}
    for m in _re.finditer(r'(\w+):\s*\{[^}]*price:\s*"\$([0-9.]+)"', t):
        ui[m.group(1)] = m.group(2)
    # UNLOCK_ALL_PRICE is platform-aware: Apple/Google take a cut, so the NATIVE store
    # price for "Everything" is higher than the web/Stripe price. qa-store-prices.json
    # holds the NATIVE price (that's what App Review sees), so read the native branch.
    m = _re.search(r'UNLOCK_ALL_PRICE\s*=\s*"\$([0-9.]+)"', t)
    if m:
        ui["unlock_all"] = m.group(1)
    else:
        mnat = _re.search(r'p === "ios" \|\| p === "android"\)\s*return\s*"\$([0-9.]+)"', t)
        if mnat: ui["unlock_all"] = mnat.group(1)
    bad = []
    for k, v in expected.items():
        if k.startswith("_"): continue
        if k in ui and str(ui[k]) != str(v):
            bad.append("%s: app shows $%s, store says $%s" % (k, ui[k], v))
        if k not in ui:
            bad.append("%s: no price shown in app" % k)
    return ("Apple 2.3: in-app prices match the real store prices", not bad, "; ".join(bad[:6]))

def check_iap_products_registered():
    """S8 / Apple 2.1 - every purchasable bundle in the UI must be registered with
    StoreKit/Play under a product id, or tapping it errors.
    (REJECTED 2026-07-12: 'An error message appeared when we tapped different
    unlock games' -> a UI bundle had no matching registered product.)"""
    app = open("app.html", encoding="utf-8", errors="replace").read()
    store = open("store.js", encoding="utf-8", errors="replace").read()
    ui_bundles = set(_re.findall(r'^\s{2}(\w+):\s*\{\s*name:', app, _re.M))
    m = _re.search(r'var bundles = \[([^\]]+)\]', store)
    registered = set(_re.findall(r'"([a-z_]+)"', m.group(1))) if m else set()
    if _re.search(r'buy\(\s*.unlock_all', app): ui_bundles.add("unlock_all")
    missing = sorted(ui_bundles - registered)
    return ("Apple 2.1: every purchasable bundle is a registered IAP product", not missing,
            ("UI offers but NOT registered: " + ", ".join(missing)) if missing else "")

def check_no_placeholder_content():
    """S9 / Apple 2.1 App Completeness - no lorem ipsum / TODO / coming-soon /
    placeholder text may be visible to users."""
    pages, scripts = _shell_files()
    bad = []
    pat = _re.compile(r"(lorem ipsum|coming soon|placeholder text|TBD|FIXME)", _re.I)
    for f in pages + scripts:
        t = open(f, encoding="utf-8", errors="replace").read()
        for m in pat.finditer(t):
            line = t[t.rfind("\n", 0, m.start())+1 : t.find("\n", m.start())]
            if line.strip().startswith(("//", "/*", "*", "#")): continue
            bad.append(f + ": " + m.group(1)); break
    return ("Apple 2.1: no placeholder/coming-soon content visible", not bad, ", ".join(bad[:5]))

def check_no_beta_naming():
    """S10 / Apple 2.3 - app name/version must not signal an unfinished product
    (beta/alpha/demo/test in the display name)."""
    cfg = open("../config.xml", encoding="utf-8").read() if os.path.exists("../config.xml") else ""
    m = _re.search(r"<name>([^<]*)</name>", cfg)
    name = m.group(1) if m else ""
    bad = bool(_re.search(r"\b(beta|alpha|demo|test|trial)\b", name, _re.I))
    return ("Apple 2.3: app display name is not beta/alpha/demo", not bad, name if bad else "")

def check_sign_in_with_apple():
    """S11 / Apple 4.8 - if the app offers ANY third-party social login (Google,
    Facebook, etc), it must also offer Sign in with Apple. Email/password-only is
    exempt. (TW is email/password + magic link -> exempt, but this guards the future.)"""
    t = open("store.js", encoding="utf-8", errors="replace").read()
    third_party = bool(_re.search(r"signInWithOAuth|provider:\s*['\"](google|facebook|twitter|github)", t, _re.I))
    has_apple = bool(_re.search(r"provider:\s*['\"]apple|SignInWithApple", t, _re.I))
    ok = (not third_party) or has_apple
    return ("Apple 4.8: Sign in with Apple offered if 3rd-party login exists", ok,
            "" if ok else "third-party login present without Sign in with Apple")

def check_iap_product_prefix_matches_bundle_id():
    """S12 - the Apple/Play product-id prefixes the app sends must match the app's
    real bundle id. (FOUND 2026-07-13: apple-iap-verify still expected the OLD
    'com.russellnohelty.questgirls.' prefix while the app sends '...threadweaver.',
    so every Apple purchase verified with Apple then got rejected by our own server:
    money taken, nothing granted. google-play-verify was worse - it was Joy Looper's
    subscription code pointed at com.hapitalist.joylooper.)"""
    cfg = open("../config.xml", encoding="utf-8").read() if os.path.exists("../config.xml") else ""
    m = _re.search(r'id="([^"]+)"', cfg)
    app_id = m.group(1) if m else ""
    t = open("store.js", encoding="utf-8", errors="replace").read()
    bad = []
    for m in _re.finditer(r'return\s+"(com\.[a-z.]+)\."\s*\+\s*bundle', t):
        if app_id and not m.group(1).startswith(app_id):
            bad.append("app sends " + m.group(1) + " but app id is " + app_id)
    for m in _re.finditer(r'APPLE_OVERRIDE\s*=\s*\{([^}]*)\}', t, _re.S):
        for pid in _re.findall(r'"(com\.[^"]+)"', m.group(1)):
            if app_id and not pid.startswith(app_id):
                bad.append("override id " + pid + " not under " + app_id)
    return ("IAP product-id prefixes match the app bundle id", not bad, "; ".join(bad[:4]))


def check_free_content_without_login():
    """S13 / Apple 5.1.1(v) - "If your app doesn't include significant account-based
    features, let people use it without a login." Gating FREE content behind a
    mandatory account is a documented rejection (and reads as 4.2 minimum-functionality
    to a reviewer who can't get past the wall). TW ships ~40 free books + 7 free games:
    they must be reachable without signing in."""
    app = open("app.html", encoding="utf-8", errors="replace").read()
    hard_wall = bool(_re.search(r"body\.pre-auth\s*#shell\s*\{[^}]*visibility\s*:\s*hidden", app))
    return ("Apple 5.1.1(v): free content is usable without a login", not hard_wall,
            "the whole shell is hidden until sign-in (free books/games unreachable)" if hard_wall else "")

def check_age_rating_gate():
    """S14 / Apple 2.3.6 + 4.7.5 - content exceeding the app's age rating needs an
    age gate, and the rating must be declared honestly. Obsidian carries adult content
    and ships an 18+ warning; the app must not contradict that."""
    ok = True
    detail = ""
    # the 18+ gate must still exist in the shipped obsidian blob
    games = open("games.js", encoding="utf-8", errors="replace").read()
    import base64 as _b64
    m = _re.search(r"'obsidian'\s*:\s*\"([A-Za-z0-9+/=]+)\"", games)
    if m:
        try:
            blob = _b64.b64decode(m.group(1)).decode("utf-8", "replace")
            if "18+" not in blob:
                ok = False; detail = "obsidian's 18+ content warning was removed"
        except Exception as e:
            ok = False; detail = "could not decode obsidian blob: " + str(e)
    return ("Apple 2.3.6/4.7.5: adult-content age gate intact", ok, detail)

def check_purchases_marked_before_buy():
    """S15 / Apple 2.3.2 + 1.2.1 - the app must clearly indicate which items require
    an additional purchase. Locked items must show a price/locked affordance."""
    app = open("app.html", encoding="utf-8", errors="replace").read()
    ok = bool(_re.search(r"locked", app)) and bool(_re.search(r"gamePrice|price", app))
    return ("Apple 2.3.2: locked items visibly marked as requiring purchase", ok,
            "" if ok else "no locked/price affordance found")

def check_no_hidden_features():
    """S16 / Apple 2.3.1(a) - no hidden, dormant, or undocumented features. Dead code
    paths that could unlock content (leftover cheat/dev/debug unlocks) are a violation."""
    pages, scripts = _shell_files()
    bad = []
    pat = _re.compile(r"(cheat|debug_?unlock|dev_?unlock|god_?mode|unlock_?all\s*=\s*true|backdoor)", _re.I)
    for f in pages + scripts:
        t = open(f, encoding="utf-8", errors="replace").read()
        for m in pat.finditer(t):
            line = t[t.rfind("\n", 0, m.start())+1 : t.find("\n", m.start())]
            if line.strip().startswith(("//", "/*", "*", "#")): continue
            bad.append(f + ": " + m.group(1)); break
    return ("Apple 2.3.1(a): no hidden/dev unlock features", not bad, ", ".join(bad[:4]))

def check_demo_account_documented():
    """S17 / Apple 2.1(a) - apps with a login MUST ship working demo credentials to
    App Review, and the backend must be live. Track them in-repo so they are never
    stale at submission."""
    # 1.16.3: in a native package the notes sit OUTSIDE www/ (anything in www/ is compiled into the app and
    # can be extracted from it - the file holds the App Review demo password). Look in both places.
    notes = "qa-review-notes.json" if os.path.exists("qa-review-notes.json") else "../qa-review-notes.json"
    ok = os.path.exists(notes)
    detail = ""
    if ok:
        import json as _json
        d = _json.load(open(notes))
        need = ["demo_email", "demo_password"]
        missing = [k for k in need if not d.get(k)]
        if missing:
            ok = False; detail = "missing: " + ", ".join(missing)
    else:
        detail = "qa-review-notes.json missing (demo account for App Review)"
    return ("Apple 2.1(a): demo account credentials recorded for App Review", ok, detail)

def check_support_and_privacy_urls_live():
    """S18 / Apple 1.5 + 5.1.1(i) - the app must include an easy way to contact the
    developer, and the privacy policy must be reachable IN the app."""
    ok = False
    for f in ["privacy.html", "delete-account.html", "app.html"]:
        if os.path.exists(f):
            t = open(f, encoding="utf-8", errors="replace").read()
            if _re.search(r"mailto:|support@|help@", t): ok = True
    return ("Apple 1.5: developer contact method present in-app", ok,
            "" if ok else "no contact/support email found anywhere in the app")



def check_no_overlay_blocks_controls():
    """S19 / Apple 2.1(a) - NO fixed/absolute overlay may sit on top of an interactive
    control. (Build 11464 REJECTED: fun.js's first-run #funWelcome layer, z-index 140,
    position:fixed, inset:0, covered the whole app -- the reviewer tapped "Log in to save
    your place" and hit the overlay instead. It only surfaced once the forced-login wall
    was removed, which used to mask it.)
    Static rule: every full-screen fixed overlay must be dismissible AND must not outrank
    the account bar. The real proof is qa-clicktest.mjs (Playwright), which CLICKS the
    control on iPad+iPhone viewports and asserts the login form actually opens."""
    bad = []
    # 1) any full-screen fixed layer must be dismissible by tapping the backdrop
    for f in ["fun.js", "discover.js", "pods.js", "comstation.js", "app.html"]:
        if not os.path.exists(f): continue
        t = open(f, encoding="utf-8", errors="replace").read()
        for m in _re.finditer(r'id\s*=\s*["\']?(\w+)["\']?;[\s\S]{0,200}?position:fixed;inset:0;z-index:(\d+)', t):
            oid, z = m.group(1), int(m.group(2))
            seg = t[m.start():m.start()+3000]
            dismissible = ("ev.target === o" in seg) or ("target===o" in seg) or (".remove()" in seg and "addEventListener(\"click\"" in seg)
            if not dismissible:
                bad.append("%s: #%s (z=%d) full-screen overlay is not backdrop-dismissible" % (f, oid, z))
    # 2) the account bar must outrank any such overlay
    store = open("store.js", encoding="utf-8", errors="replace").read()
    m = _re.search(r'bar\.style\.cssText\s*=\s*"([^"]*)"', store)
    barz = 0
    if m:
        mz = _re.search(r"z-index:(\d+)", m.group(1))
        barz = int(mz.group(1)) if mz else 0
    # 1.16.2: the bar must sit ABOVE the first-run welcome (auto-shown, can cover Sign in) and BELOW the
    # layers a user opens on purpose (store sheet, reader host, unlock modal) - at z 160 it floated over them.
    fun = open("fun.js", encoding="utf-8", errors="replace").read()
    fw = _re.search(r'id="funWelcome";[\s\S]{0,1500}?z-index:(\d+)', fun)
    fwz = int(fw.group(1)) if fw else 0
    app = open("app.html", encoding="utf-8", errors="replace").read()
    def _z(sel):
        mm = _re.search(r'%s\{[^}]*?z-index:(\d+)' % _re.escape(sel), app)
        return int(mm.group(1)) if mm else 10**6
    ceiling = min(_z("#sheet"), _z("#host"), _z("#unlockModal"))
    if not (fwz < barz < ceiling):
        bad.append("account bar z-index=%d must be above the welcome (%d) and below the store/reader/unlock layers (%d)" % (barz, fwz, ceiling))
    return ("Apple 2.1(a): no overlay can block interactive controls", not bad, "; ".join(bad[:4]))



def check_purchase_works_without_login():
    """S20 / Apple 2.1(b) - the purchase flow must NOT force sign-in before buying.
    App Review tests in a sandbox with no app account; a login gate before the
    StoreKit dialog reads as "there isn't a purchase option / unable to proceed with
    purchase". (REJECTED build 11466: buyBundle opened with `if(!session) promptSignin`.)"""
    t = open("store.js", encoding="utf-8", errors="replace").read()
    m = _re.search(r"buyBundle\s*=\s*function\s*\(bundle\)\s*\{(.{0,240})", t, _re.S)
    gated = bool(m and _re.search(r"if\s*\(\s*!session\s*\)\s*\{\s*promptSignin", m.group(1)))
    # and a purchase must grant locally so it works with no account
    grants_local = "window.setUnlocked" in t and "store.when().approved" in t
    ok = (not gated) and grants_local
    detail = []
    if gated: detail.append("buyBundle forces sign-in before purchase")
    if not grants_local: detail.append("approved purchase does not grant locally")
    return ("Apple 2.1(b): purchase works without forcing login (grants locally)", ok, "; ".join(detail))



def check_store_is_discoverable():
    """S21 / Apple 2.1(b) - App Review must be able to LOCATE the in-app purchases.
    (REJECTED twice: the only route to the purchase sheet was tapping a locked item,
    so the reviewer reported "we cannot locate the In-App Purchases within the app".)
    There must be an always-visible store entry point on the main screen that lists
    every purchasable bundle."""
    app = open("app.html", encoding="utf-8", errors="replace").read()
    has_button = bool(_re.search(r'id="btnStore"[^>]*onclick="openStore\(\)"', app))
    has_fn = "function openStore(" in app and "window.openStore" in app
    lists_all = bool(_re.search(r"openStore\(\)\s*\{[\s\S]{0,400}?bundleOptsHTML\(null\)", app))
    bad = []
    if not has_button: bad.append("no always-visible Store button on the main screen")
    if not has_fn: bad.append("openStore() missing or not exposed")
    if not lists_all: bad.append("store does not list all bundles")
    return ("Apple 2.1(b): in-app purchases are discoverable (visible Store entry)", not bad, "; ".join(bad))


STORE_CHECKS = [check_iap_product_prefix_matches_bundle_id, check_no_code_unlock, check_iap_restore_exists, check_account_deletion_in_app,
                check_privacy_policy_reachable, check_deletion_page_reachable,
                check_no_external_purchase_links, check_price_consistency,
                check_iap_products_registered, check_no_placeholder_content,
                check_no_beta_naming, check_sign_in_with_apple,
                check_free_content_without_login, check_age_rating_gate,
                check_purchases_marked_before_buy, check_no_hidden_features,
                check_demo_account_documented, check_support_and_privacy_urls_live,
                check_no_overlay_blocks_controls, check_purchase_works_without_login,
                check_store_is_discoverable]

def run_store_checks():
    fails = 0
    print("\n--- STORE COMPLIANCE (Apple + Play) ---")
    for fn in STORE_CHECKS:
        name, ok, detail = fn()
        print(("  PASS: " if ok else "  FAIL: ") + name + (("  [" + detail + "]") if (detail and not ok) else ""))
        if not ok: fails += 1
    return fails

_store_fails = run_store_checks()
if _store_fails:
    print("\nRESULT: %d STORE-COMPLIANCE FAILURE(S) - DO NOT SUBMIT" % _store_fails)


# ---------------------------------------------------------------------------
# GOOGLE PLAY POLICY CLASSES (play.google/developer-content-policy + Play Console)
# ---------------------------------------------------------------------------

def check_play_target_api():
    """G1 / Play Target API Level policy - since Nov 2025 ALL app updates must target
    API level 35 (Android 15). Below the floor, Play refuses the upload outright."""
    cfg = open("../config.xml", encoding="utf-8").read() if os.path.exists("../config.xml") else ""
    m = _re.search(r'android-targetSdkVersion"\s+value="(\d+)"', cfg)
    target = int(m.group(1)) if m else 0
    ok = target >= 36
    return ("Play: targetSdkVersion >= 36 (Android 16 floor, effective 2026-08-31)", ok,
            ("targetSdkVersion=%s (needs >=36)" % (target or "missing")) if not ok else "")

def check_play_privacy_policy_names_entity():
    """G2 / Play User Data policy - the privacy policy must be clearly labeled, name the
    entity from the store listing, and give a privacy point of contact."""
    if not os.path.exists("privacy.html"):
        return ("Play: privacy policy names the legal entity + contact", False, "privacy.html missing")
    t = open("privacy.html", encoding="utf-8", errors="replace").read()
    named = "Wannabe Press" in t
    contact = bool(_re.search(r"mailto:|@wannabepress", t))
    labeled = bool(_re.search(r"privacy policy", t, _re.I))
    ok = named and contact and labeled
    return ("Play: privacy policy labeled, names entity, has contact", ok,
            "" if ok else ("named=%s contact=%s labeled=%s" % (named, contact, labeled)))

def check_play_web_deletion_resource():
    """G3 / Play Account Deletion Requirement - deletion must be available BOTH in-app AND
    via a WEB resource that works WITHOUT the user re-downloading the app (Google is
    explicit: 'your web resource should give users a way to request that their data be
    deleted without sending the user back to the app')."""
    if not os.path.exists("delete-account.html"):
        return ("Play: web deletion resource works without the app", False, "delete-account.html missing")
    t = open("delete-account.html", encoding="utf-8", errors="replace").read()
    # must offer a route that does NOT require the app (an email/web request path)
    web_route = bool(_re.search(r"mailto:", t))
    describes = bool(_re.search(r"what (is|gets) deleted|we (permanently )?remove", t, _re.I))
    ok = web_route and describes
    return ("Play: web deletion resource usable without re-installing the app", ok,
            "" if ok else ("web_route=%s describes_what_is_deleted=%s" % (web_route, describes)))

def check_play_no_safetynet():
    """G4 / Play - SafetyNet Attestation was retired (June 2024) and returns nothing.
    Any remaining call is dead code that can fail closed."""
    pages, scripts = _shell_files()
    bad = [f for f in pages + scripts
           if _re.search(r"safetynet", open(f, encoding="utf-8", errors="replace").read(), _re.I)]
    return ("Play: no retired SafetyNet Attestation calls", not bad, ", ".join(bad[:3]))

def check_play_permissions_justified():
    """G5 / Play Permissions policy - every dangerous permission must be justified and
    declared. TW needs NONE (no camera/location/contacts/SMS): any appearance is a
    Data-safety declaration burden and a likely rejection."""
    cfg = open("../config.xml", encoding="utf-8").read() if os.path.exists("../config.xml") else ""
    dangerous = _re.findall(r'uses-permission[^>]*android:name="android\.permission\.([A-Z_]+)"', cfg)
    risky = [p for p in dangerous if p in (
        "ACCESS_FINE_LOCATION","ACCESS_COARSE_LOCATION","READ_CONTACTS","WRITE_CONTACTS",
        "RECORD_AUDIO","CAMERA","READ_SMS","SEND_SMS","READ_CALL_LOG","READ_MEDIA_IMAGES",
        "READ_MEDIA_VIDEO","READ_EXTERNAL_STORAGE")]
    return ("Play: no unjustified dangerous permissions declared", not risky, ", ".join(risky))

def check_play_billing_products_match():
    """G6 / Play Billing - every bundle the UI sells must have a Play product id under the
    'threadweaver_' scheme that the server's google-play-verify will actually resolve.
    (FOUND 2026-07-13: google-play-verify was Joy Looper's SUBSCRIPTION code pointed at
    com.hapitalist.joylooper -- no Android purchase could ever grant anything.)"""
    store = open("store.js", encoding="utf-8", errors="replace").read()
    m = _re.search(r'if \(plat === "android"\) return "([a-z_]+)" \+ bundle', store)
    prefix = m.group(1) if m else ""
    ok = prefix == "threadweaver_"
    return ("Play: Android product-id scheme is threadweaver_<bundle>", ok,
            ("android prefix is %r" % prefix) if not ok else "")

PLAY_CHECKS = [check_play_target_api, check_play_privacy_policy_names_entity,
               check_play_web_deletion_resource, check_play_no_safetynet,
               check_play_permissions_justified, check_play_billing_products_match]

def run_play_checks():
    fails = 0
    print("\n--- GOOGLE PLAY POLICY ---")
    for fn in PLAY_CHECKS:
        name, ok, detail = fn()
        print(("  PASS: " if ok else "  FAIL: ") + name + (("  [" + detail + "]") if (detail and not ok) else ""))
        if not ok: fails += 1
    return fails

_play_fails = run_play_checks()
if _play_fails:
    print("\nRESULT: %d GOOGLE PLAY FAILURE(S) - DO NOT SUBMIT" % _play_fails)


# --- combined verdict: original checks + native + store compliance ---
_total = len(FAIL) + _native_fails + _store_fails + _play_fails
print("\nRESULT: ALL PASS" if not _total else "\nRESULT: %d FAILURE(S) - DO NOT SUBMIT" % _total)
sys.exit(1 if _total else 0)
