// harness/walk.mjs - Thread Weaver's walker (the Data Harness, 17 Nov 2026).
//
// Ported from Hapitalist's walkers (.github/browser-check every-page.mjs, clicks.mjs, app-walks.mjs, route-harness/run.mjs)
// and Command Center's harness (walk.ts, browser.ts, selftest.ts), for Thread Weaver's own pages, games, books and comics.
// It walks the way a reader does, in a real browser, on a phone and on a laptop, and its browser says who it is
// (TWDataHarness/1 on the end of the user agent) so the pages' own eyes (www/tw-eyes.js) never count it as a visitor.
//
// The walks (each one a test on /admin/harness.html, every step kept for the replay):
//   Every page            every page of the site opened as a stranger: not there, crashes, failed calls, broken pictures,
//                         junk, sideways scroll, cut-off and unreadable buttons, links that go nowhere, slow pages
//   Admin kept locked     every admin page and admin call as a stranger: must show the sign-in and give nothing away
//   Every button          every button on every page pressed once as a stranger (never one that pays, sends, deletes,
//                         signs out, subscribes or cancels): a press nothing answers, an error after it, a crash
//   The app (phone app)   the packaged app (Cordova shim) as a new reader: the library, every story game (locked ones must
//                         open the unlock sheet; the free one is played choice by choice), every free book read three pages
//                         in, every free comic paged, the Weave searched and opened, the store sheet
//   Signed in             (GitHub only: test people are made by the hx-ingest function) the website as a reader with
//                         nothing bought and as one with Unlock Everything: every game played, books and comics opened
//   Self-test             /admin/selftest.html has one of every break; every one must be caught (the harness checking
//                         that it can still see)
//   Look again            every open item a walk found is walked again at its exact page and step
//
// Run:  node harness/walk.mjs [--site https://thread.wannabepress.com] [--local <repo dir>] [--only pages,buttons,...]
//                             [--devices phone,laptop] [--out dir] [--ingest oidc|key|none] [--trigger schedule|push|asked|hand]
// --local serves this repository's files under the real site's address (Netlify's _redirects rules), so what is walked is
// what will be published, against the live database. Results always go to <out>/results.json; with --ingest they go to
// Thread Weaver's database through the hx-ingest edge function (GitHub's OIDC token, or HX_KEY for a run by hand).
import { chromium, webkit, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const SITE = (arg("site", "https://thread.wannabepress.com")).replace(/\/$/, "");
const LOCAL = arg("local", "");
const ONLY = (arg("only", "pages,locked,buttons,app,signedin,selftest,again")).split(",");
const DEVICES = (arg("devices", "phone,laptop")).split(",");
const OUT = arg("out", "/tmp/tw-harness");
const INGEST = arg("ingest", "none");
const TRIGGER = arg("trigger", "hand");
const FN = "https://nzkgurdmvgkizvzisqxt.supabase.co/functions/v1/hx-ingest";
const SUPA = "https://nzkgurdmvgkizvzisqxt.supabase.co";
const ANON = "sb_publishable_XhncOLTTqr5qTs_G9O3Ecw_m6m5fU0f";
const MARK = " TWDataHarness/1";
const NATIVE = "https://localhost";            // the packaged app's address (app.html loads cordova.js here)
fs.mkdirSync(path.join(OUT, "shots"), { recursive: true });

const NOT_HERE = /page not found|that page is not here|this page could not be found|application error|\b404\b/i;
// never pressed on its own: anything that pays, sends, deletes, cancels, subscribes or signs out
const DANGER = /\b(buy|pay|purchase|checkout|check out|unlock (everything|all|it|this|the|series|book)|get (it|all|everything)|subscribe|sign ?out|log ?out|delete|remove|send|restore purchases|reset password|cancel|unsubscribe|stop (these|getting)|leave|follow|start (the )?serial|read (the rest|ahead)|\$\s?\d)/i;
const clip = (s, n = 300) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// ---------------------------------------------------------------------------------------------------- serving --local
const REPO = LOCAL ? path.resolve(LOCAL) : "";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon", ".epub": "application/epub+zip", ".webmanifest": "application/manifest+json", ".webp": "image/webp" };
const NOT_PUBLISHED = /^\/(certificates|supabase|qa-live|harness|resources|\.github)\/|^\/(README\.md|voltbuilder\.json|config\.xml|_redirects|_headers|scan\.py|compliance_ledger\.(py|txt)|package(-lock)?\.json)$|^\/(www\/)?qa-|^\/www\/(scan\.py|compliance_ledger|package)/i;
function localFile(p, native) {
  if (native) return path.join(REPO, "www", p === "/" ? "index.html" : p);
  if (NOT_PUBLISHED.test(p)) return null;
  if (p === "/app") return path.join(REPO, "www/app.html");
  if (p === "/auth/confirm") return path.join(REPO, "www/auth-confirm.html");
  if (p === "/" || p === "") return path.join(REPO, "www/index.html");
  if (p.startsWith("/admin/")) return path.join(REPO, p);
  return path.join(REPO, "www", p);
}
async function serveLocal(ctx, base, native) {
  await ctx.route(base + "/**", async (route) => {
    const u = new URL(route.request().url());
    let p = decodeURIComponent(u.pathname);
    if (native && p === "/cordova.js") return route.fulfill({ status: 200, contentType: "text/javascript", body: SHIM });
    let f = localFile(p, native);
    if (f && fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
    if (!f || !fs.existsSync(f)) {
      // Netlify answers a missing file with the site's 404 page
      return route.fulfill({ status: 404, contentType: "text/html", body: "<!doctype html><title>Page not found</title><h1>Page not found</h1>" });
    }
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || "application/octet-stream", body: fs.readFileSync(f), headers: { "cache-control": "no-store" } });
  });
}
// the packaged app's plugins, stood in for (qa-live/native_emulate.py): store, in-app browser, deviceready
const SHIM = `window.__cordovaLoaded = true;
window.cordova = { platformId: 'android', InAppBrowser: { open: function(u){ window.__iab = u; return { addEventListener: function(){} }; } } };
(function(){
  var reg = [], handlers = {};
  var chain = { approved: function(f){ handlers.approved = f; return chain; }, verified: function(f){ handlers.verified = f; return chain; },
                finished: function(){ return chain; }, updated: function(){ return chain; }, productUpdated: function(){ return chain; } };
  function product(id){ var r = reg.filter(function(x){ return x.id === id; })[0]; if (!r) return null;
    return { id: id, canPurchase: true, owned: false, pricing: { price: '$9.99' },
             getOffer: function(){ return { id: id, order: function(){ window.__ordered = id; return Promise.resolve(); } }; } }; }
  window.CdvPurchase = {
    ProductType: { NON_CONSUMABLE: 'non consumable', CONSUMABLE: 'consumable' }, Platform: { APPLE_APPSTORE: 'ios-appstore', GOOGLE_PLAY: 'android-playstore' },
    store: { register: function(r){ reg = reg.concat(r); }, when: function(){ return chain; }, initialize: function(){ return Promise.resolve(); },
             update: function(){ return Promise.resolve(); }, get: product, get products(){ return reg.map(function(x){ return product(x.id); }); },
             order: function(o){ window.__ordered = (o && o.id) || o; return Promise.resolve(); },
             restorePurchases: function(){ window.__restored = true; return Promise.resolve(); }, localReceipts: [] }
  };
  setTimeout(function(){ document.dispatchEvent(new Event('deviceready')); }, 60);
})();`;

// ---------------------------------------------------------------------------------------------------- browsers and devices
let BROWSERS = {};
async function browserFor(dev) {
  if (BROWSERS[dev]) return BROWSERS[dev];
  if (dev === "phone") {
    try { BROWSERS.phone = { b: await webkit.launch(), kind: "webkit" }; }
    catch (_) { BROWSERS.phone = { b: await chromium.launch({ args: ["--no-sandbox"] }), kind: "chromium" }; console.log("(The phone is walked in Chromium with an iPhone's screen: WebKit is not installed here.)"); }
  } else BROWSERS[dev] = { b: await chromium.launch({ args: ["--no-sandbox"] }), kind: "chromium" };
  return BROWSERS[dev];
}
async function newContext(dev, { native = false, storage } = {}) {
  const { b, kind } = await browserFor(dev);
  const base = native ? NATIVE : SITE;
  let opts;
  if (dev === "phone") {
    const d = devices["iPhone 13"];
    opts = { viewport: d.viewport, deviceScaleFactor: 2, isMobile: kind !== "webkit" ? true : d.isMobile, hasTouch: true, userAgent: d.userAgent + MARK };
    if (kind === "webkit") opts.isMobile = true;
  } else {
    opts = { viewport: { width: 1366, height: 900 }, userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${b.version()} Safari/537.36` + MARK };
  }
  opts.serviceWorkers = "block";
  opts.ignoreHTTPSErrors = true;
  if (storage) opts.storageState = storage;
  const ctx = await b.newContext(opts);
  // 27 Nov 2026 (Command Center 1.9.0): the widest each picture has been drawn, so a picture that shows big and then shrinks is seen
  await ctx.addInitScript(() => { try { const M = window.__hxMaxw = new WeakMap(); const RO = new ResizeObserver((es) => { for (const e of es) { const w = e.target.getBoundingClientRect().width; if (w > (M.get(e.target) || 0)) M.set(e.target, w); } });
    const pics = () => { for (const im of document.images) if (!im.__hxw) { im.__hxw = 1; RO.observe(im); } }; new MutationObserver(pics).observe(document, { childList: true, subtree: true }); } catch (_) {} });
  if (LOCAL || native) await serveLocal(ctx, base, native);
  return { ctx, base };
}

// ---------------------------------------------------------------------------------------------------- one run of one walk
function pageKey(url) {
  try {
    const u = new URL(url);
    let p = u.pathname || "/";
    if (/^\/(www\/)?(index\.html)?$/.test(p)) p = "/";
    p = p.replace(/^\/www\//, "/").replace(/^\/app\.html$/, "/app").replace(/^\/auth-confirm\.html$/, "/auth/confirm");
    const keep = u.searchParams.get("id") || u.searchParams.get("serial") || u.searchParams.get("s") || u.searchParams.get("book");
    if (keep && /reader|comic|serial/.test(p)) p += "?id=" + keep;
    return p.slice(0, 200);
  } catch (_) { return String(url).slice(0, 200); }
}
class Run {
  constructor(name, kind, persona, device, steps = []) {
    Object.assign(this, { name, kind, persona, device, started: new Date().toISOString(), steps: [], findings: [], clean: [], expect: [], testSteps: steps, keys: new Set() });
  }
  step(s) { this.steps.push({ passed: true, ...s, page_said: clip(s.page_said, 1200), note: clip(s.note, 1200) }); }
  find(f) {
    const k = f.page + "|" + (f.step || "") + "|" + f.kind + "|" + (/script error|failed call/.test(f.kind) ? clip(f.message, 80) : "");
    if (this.keys.has(k)) return false;
    this.keys.add(k);
    this.findings.push({ page: f.page, step: f.step || "", kind: f.kind, message: clip(f.message, 600), trail: f.trail || null, shot: f.shot || null });
    this.step({ action: "found", target: f.step || "", url: f.url || "", page: f.page, step: f.step || "", kind: f.kind, message: f.message, passed: false, note: f.kind + ": " + clip(f.message, 400), shot: f.shot });
    return true;
  }
  ok(page, step = "") { this.clean.push({ page, step }); }
  get passed() { return this.findings.filter((f) => f.kind !== "slow page").length === 0; }
  payload(extra = {}) {
    return { test: { name: this.name, kind: this.kind, persona: this.persona, steps: this.testSteps }, device: this.device, trigger: TRIGGER,
      started_at: this.started, finished_at: new Date().toISOString(), passed: this.passed, build: BUILD,
      summary: this.passed ? `${this.steps.length} steps, nothing wrong` : `${this.findings.length} thing(s) wrong: ` + this.findings.slice(0, 6).map((f) => f.kind + " on " + f.page + (f.step ? " (" + f.step + ")" : "")).join("; "),
      gh_run: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : "", steps: this.steps, findings: this.findings, clean: this.clean, expect: this.expect, ...extra };
  }
}
let BUILD = "";
const RESULTS = [];
let shotN = 0;
async function shot(page, why) {
  try {
    const f = path.join(OUT, "shots", `${String(++shotN).padStart(4, "0")}-${why.replace(/[^a-z0-9]+/gi, "-").slice(0, 50)}.jpg`);
    await page.screenshot({ path: f, type: "jpeg", quality: 55, timeout: 8000 });
    return f;
  } catch (_) { return null; }
}

// what the browser itself saw on a page (crashes, failed calls, broken pictures), on top of the page's own eyes
// 27 Nov 2026: a frame locked on purpose (the book reader runs each chapter with scripts off; the email previews too) says this when
// the book or email carries a script. The lock working is not a fault; whether the reader sees the words is checked by looking.
const SANDBOXED = /Blocked script execution in 'about:(srcdoc|blank)' because the document's frame is sandboxed/;
function watch(page) {
  const w = { errors: [], failed: [], calls: [], dialogs: [], loads: 0 };
  // 27 Nov 2026: a link to the page you are on reloads it and takes you to the top - that is an answer (the site name on the home page)
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) w.loads++; });
  // Playwright's own service-worker blocking reaches into sandboxed frames (an email preview) and throws there; a reader's browser never does
  const ours = (m) => /Failed to read the 'serviceWorker' property from 'Navigator'|Service Worker is disabled because the context is sandboxed/i.test(m);
  page.on("pageerror", (e) => { if (!ours(e.message)) w.errors.push(clip(e.message, 300)); });
  page.on("console", (m) => { if (m.type() === "error") { const t = m.text(); if (!/favicon|ERR_BLOCKED_BY_CLIENT|Failed to load resource/.test(t) && !SANDBOXED.test(t) && !ours(t)) w.errors.push(clip(t, 300)); } });
  page.on("response", (r) => {
    const t = r.request().resourceType(), s = r.status(), u = r.url();
    if (/hx_report|hx-ingest/.test(u)) return;
    if (s >= 400 && ["image", "script", "stylesheet", "font"].includes(t)) w.failed.push(`${t} ${s}: ${clip(u, 160)}`);
    else if (s >= 500 && ["fetch", "xhr"].includes(t)) w.calls.push(`a call to ${clip(u.replace(/\?.*/, ""), 140)} answered ${s}`);
  });
  page.on("requestfailed", (r) => {
    const t = r.request ? r.resourceType() : r.resourceType(), e = (r.failure() || {}).errorText || "";
    if (/ERR_ABORTED|cancelled|NS_BINDING_ABORTED|Load request cancelled|Request cancelled/i.test(e)) return;
    if (/hx_report/.test(r.url())) return;
    if (["image", "script", "stylesheet"].includes(t)) w.failed.push(`${t} did not load (${e}): ${clip(r.url(), 160)}`);
    else if (["fetch", "xhr"].includes(t)) w.calls.push(`a call to ${clip(r.url().replace(/\?.*/, ""), 140)} got no answer (${e})`);
  });
  page.on("dialog", (d) => { w.dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  return w;
}
// everything the eyes in the page and its frames (games, books) saw
async function eyes(page) {
  const out = [];
  for (const fr of page.frames()) {
    try {
      const f = await fr.evaluate(() => (window.__twEyes ? window.__twEyes.findings.map((x) => ({ ...x, trail: window.__twEyes.trail.slice(-8) })) : []));
      out.push(...f);
    } catch (_) {}
  }
  return out;
}
async function settle(page, ms = 2500) {
  try { await page.waitForLoadState("domcontentloaded", { timeout: 20000 }); } catch (_) {}
  try { await page.waitForLoadState("networkidle", { timeout: 8000 }); } catch (_) {}
  await page.waitForTimeout(ms);
}
async function bodyText(page) { try { return await page.evaluate(() => (document.body ? document.body.innerText : "")); } catch (_) { return ""; } }
// file what the browser and the eyes saw since `from`, as findings at `pageK` / `stepLabel`
async function harvest(run, page, w, pageK, stepLabel, from) {
  let n = 0;
  const shotIf = async (why) => (n === 0 ? await shot(page, why) : null);
  for (const e of w.errors.slice(from.errors)) if (run.find({ page: pageK, step: stepLabel, kind: "script error", message: e, url: page.url(), shot: await shotIf("script-error") })) n++;
  for (const e of w.calls.slice(from.calls)) if (run.find({ page: pageK, step: stepLabel, kind: "failed call", message: e, url: page.url(), shot: await shotIf("failed-call") })) n++;
  for (const e of w.failed.slice(from.failed)) if (run.find({ page: pageK, step: stepLabel, kind: /^image/.test(e) ? "broken picture" : "failed call", message: e, url: page.url(), shot: await shotIf("broken") })) n++;
  for (const f of await eyes(page)) {
    if (f.kind === "slow page") { run.step({ action: "note", page: f.page, note: f.message }); continue; }
    if (run.find({ page: f.page || pageK, step: f.step || stepLabel, kind: f.kind, message: f.message, trail: f.trail, url: page.url(), shot: await shotIf(f.kind) })) n++;
  }
  return n;
}
const mark = (w) => ({ errors: w.errors.length, calls: w.calls.length, failed: w.failed.length });

// ---------------------------------------------------------------------------------------------------- the site's pages
let LIB = [], COMICS = [], GAMES = [];
async function loadCatalog() {
  const get = async (p) => {
    if (LOCAL) return JSON.parse(fs.readFileSync(path.join(REPO, "www", p), "utf8"));
    const r = await fetch(SITE + "/" + p); return r.json();
  };
  LIB = await get("books/library.json");
  COMICS = await get("comics/comics.json");
  const app = LOCAL ? fs.readFileSync(path.join(REPO, "www/app.html"), "utf8") : await (await fetch(SITE + "/app")).text();
  GAMES = [...app.matchAll(/\{\s*id:'([a-z0-9]+)',[^\n]*?title:'((?:[^'\\]|\\.)*)'[^\n]*?locked:(true|false)(?:[^\n]*?preview:(true))?/g)].map((m) => ({ id: m[1], title: m[2], locked: m[3] === "true", preview: !!m[4] }));
  BUILD = (app.match(/TW_APP_VERSION\s*=\s*(?:window\.TW_APP_VERSION\s*=\s*)?["']([\d.]+)/) || [])[1] || "";
}
function sitePages() {
  const freeBook = LIB.find((b) => b.free), freeComic = COMICS.find((c) => c.free);
  return [
    "/", "/app", "/privacy.html", "/delete-account.html", "/auth/confirm", "/email-unsubscribe.html", "/email-leave.html",
    "/serial.html?serial=godsverse",
    freeBook && `/reader.html?src=books/${encodeURIComponent(freeBook.file)}&id=${encodeURIComponent(freeBook.id)}&title=${encodeURIComponent(freeBook.title)}`,
    freeComic && `/comic.html?id=${encodeURIComponent(freeComic.id)}`,
  ].filter(Boolean);
}
const ADMIN_PAGES = ["/admin.html", "/admin/one-offs.html", "/admin/sequences.html", "/admin/newsletter.html", "/admin/subscribers.html", "/admin/harness.html"];

async function openAndLook(run, page, w, url, { label = "", expectText = null } = {}) {
  const from = mark(w);
  const pageK = pageKey(url);
  let status = null, t0 = Date.now();
  try { const r = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }); status = r ? r.status() : null; }
  catch (e) { run.find({ page: pageK, step: label, kind: "page did not open", message: clip(e.message, 200), url, shot: await shot(page, "no-open") }); return false; }
  await settle(page, 3500);
  const text = await bodyText(page);
  run.step({ action: "goto", target: url, url: page.url(), page_said: text.slice(0, 600), ms: Date.now() - t0 });
  let bad = 0;
  if (status === 404 || NOT_HERE.test(text.slice(0, 400))) { run.find({ page: pageK, step: label, kind: "page not there", message: `${url} answered ${status}: ${clip(text, 120)}`, url, shot: await shot(page, "not-there") }); bad++; }
  if (expectText && !new RegExp(expectText, "i").test(text)) { run.find({ page: pageK, step: label, kind: "wrong thing on the page", message: `Expected "${expectText}" and it is not there: ${clip(text, 160)}`, url, shot: await shot(page, "wrong") }); bad++; }
  bad += await harvest(run, page, w, pageK, label, from);
  bad += await looks(run, page, pageK, label);
  if (!bad) run.ok(pageK, label);
  return true;
}
// 27 Nov 2026 (Command Center 1.9.0, from Hapitalist's own site on 18 Nov): two things a person sees as broken that no error says.
// A bordered box drawn in a close shade of what is behind it (within 12 delta-E, and not white) reads as an error message; a
// picture drawn at under 60% of its own size (its width= or the widest it was drawn) although the space around it could hold it
// whole looks broken - the tarot card that came out 80px of its 260px.
async function lookExtra(page) {
  return await page.evaluate(() => {
    const rgb = (v) => { const m = String(v).match(/rgba?\(([^)]+)\)/); if (!m) return null; const a = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return a.length > 3 && a[3] === 0 ? null : a.slice(0, 3); };
    const lab = (c) => { const f = (v) => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; const r = f(c[0]), g = f(c[1]), b = f(c[2]); const X = (r * .4124 + g * .3576 + b * .1805) / .95047, Y = r * .2126 + g * .7152 + b * .0722, Z = (r * .0193 + g * .1192 + b * .9505) / 1.08883; const q = (x) => x > .008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116; return [116 * q(Y) - 16, 500 * (q(X) - q(Y)), 200 * (q(Y) - q(Z))]; };
    const dE = (a, b) => { a = lab(a); b = lab(b); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); };
    const behind = (el) => { for (let e = el.parentElement; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c) return c; } return [255, 255, 255]; };
    const samebox = [];
    for (const el of document.querySelectorAll("body *")) { const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed" || cs.position === "sticky") continue;
      if ((parseFloat(cs.borderTopWidth) || 0) < 2 || cs.borderTopStyle === "none" || /^(INPUT|SELECT|TEXTAREA|BUTTON|A|IMG|LABEL)$/.test(el.tagName)) continue;
      const rc = el.getBoundingClientRect(); if (rc.width < 120 || rc.height < 40) continue; const bg = rgb(cs.backgroundColor); if (!bg || bg.join() === "255,255,255") continue;
      const x = dE(bg, behind(el)); if (x < 12) samebox.push(((el.innerText || "").trim().slice(0, 40).replace(/\s+/g, " ") || el.tagName.toLowerCase()) + " (" + x.toFixed(1) + " from the page behind it)"); if (samebox.length >= 5) break; }
    const shrunk = [];
    for (const i of document.images) { const w = i.getBoundingClientRect().width; if (!(w > 0)) continue;
      const mx = (window.__hxMaxw && window.__hxMaxw.get(i)) || 0, want = Math.max(parseFloat(i.getAttribute("width")) || 0, mx);
      if (want < 120 || w >= want * 0.6) continue;
      let room = innerWidth; for (let e = i.parentElement; e; e = e.parentElement) { const ew = e.getBoundingClientRect().width; if (ew > w * 1.2) { room = ew; break; } }
      if (room >= want * 0.9) shrunk.push((i.alt || (i.currentSrc || i.src).split("/").pop() || "a picture").slice(0, 60) + " is drawn " + Math.round(w) + "px wide of its " + Math.round(want) + "px");
      if (shrunk.length >= 5) break; }
    return { samebox, shrunk };
  }).catch(() => ({ samebox: [], shrunk: [] }));
}
async function looks(run, page, pageK, label) {
  const x = await lookExtra(page); let n = 0;
  for (const b of x.samebox.slice(0, 3)) if (run.find({ page: pageK, step: label, kind: "a box the colour of the page", message: "A box drawn in a close shade of the page behind it, so it reads as an error: " + b, url: page.url(), shot: n ? null : await shot(page, "samebox") })) n++;
  for (const b of x.shrunk.slice(0, 3)) if (run.find({ page: pageK, step: label, kind: "a picture squeezed small", message: "A picture drawn far smaller than it is although there is room for it: " + b, url: page.url(), shot: n ? null : await shot(page, "shrunk") })) n++;
  return n;
}

// 27 Nov 2026 (Command Center 1.8.0): what good looks like after a press, written down on /admin/harness.html (page, the button's words,
// what must or must not show, within how many seconds). A new one waits until a walk sees it come true once; then a walk that presses
// the button and does not see it lists "a press that did not give its result".
let EXPECT = null;
async function expectRules() {
  if (EXPECT) return EXPECT;
  try { const r = await fetch(SUPA + "/rest/v1/rpc/hx_expect_rules", { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: "{}" }); const d = await r.json(); EXPECT = Array.isArray(d) ? d : []; }
  catch (_) { EXPECT = []; }
  return EXPECT;
}
async function checkExpect(run, page, pageK, label, t0) {
  const rules = (await expectRules()).filter((e) => (!e.page || pageK.toLowerCase().includes(String(e.page).toLowerCase()) || String(e.page).toLowerCase().includes(pageK.toLowerCase())) &&
    String(e.press).trim().toLowerCase() === String(label).trim().toLowerCase());
  for (const e of rules) {
    const want = String(e.words).toLowerCase(); let ok = false, text = "";
    for (;;) {
      text = (await bodyText(page)).toLowerCase();
      ok = e.kind === "not_see" ? !text.includes(want) : text.includes(want);
      if (ok && e.kind !== "not_see") break;
      if (Date.now() - t0 > e.within_s * 1000) break;
      await page.waitForTimeout(500);
    }
    const said = ok ? (e.kind === "not_see" ? '"' + e.words + '" did not show' : '"' + e.words + '" showed') : (e.kind === "not_see" ? '"' + e.words + '" showed and should not have' : '"' + e.words + '" did not show within ' + e.within_s + " s");
    run.expect.push({ id: e.id, ok, said: said + " (" + run.device + ")" });
    run.step({ action: "see", target: label, page: pageK, passed: ok || !e.on, note: "What good looks like after pressing \"" + label + "\": " + said + (e.on ? "" : " (not on yet: it waits until a walk sees it come true once)") });
    if (!ok && e.on) run.find({ page: pageK, step: label, kind: "a press that did not give its result", message: 'Pressing "' + label + '" should ' + (e.kind === "not_see" ? "not show" : "show") + ' "' + e.words + '": ' + said, url: page.url(), shot: await shot(page, "expect") });
  }
  return rules.length;
}
// every link on the page that stays on this site must answer
async function linksGoSomewhere(run, page, pageK, seen) {
  let hrefs = [];
  try { hrefs = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.href, text: (a.innerText || a.getAttribute("aria-label") || "").trim().slice(0, 60) }))); } catch (_) {}
  for (const h of hrefs) {
    let u; try { u = new URL(h.href); } catch (_) { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    if (u.origin !== new URL(SITE).origin) continue;
    const key = u.pathname + u.search; if (seen.has(key)) continue; seen.add(key);
    let s = 0;
    if (LOCAL) { const p = decodeURIComponent(u.pathname); const f = localFile(p, false); s = f && fs.existsSync(f) ? 200 : 404; }
    else { try { s = (await fetch(u.href, { method: "GET", redirect: "follow" })).status; } catch (_) { s = 0; } }
    run.step({ action: "link", target: h.text || u.pathname, url: u.href, note: "answered " + s, passed: s > 0 && s < 400 });
    if (!(s > 0 && s < 400)) run.find({ page: pageK, step: h.text || u.pathname, kind: "link goes nowhere", message: `"${h.text || u.pathname}" goes to ${u.pathname} and it answered ${s || "nothing"}`, url: page.url() });
  }
}

// ---------------------------------------------------------------------------------------------------- the walks
async function walkPages(dev) {
  const run = new Run("Every page", "pages", "stranger", dev);
  const { ctx } = await newContext(dev); const page = await ctx.newPage(); const w = watch(page); const seen = new Set();
  for (const p of sitePages()) {
    await openAndLook(run, page, w, SITE + p);
    await linksGoSomewhere(run, page, pageKey(SITE + p), seen);
  }
  await ctx.close(); return run;
}

async function walkLocked(dev) {
  const run = new Run("Admin kept locked", "locked", "stranger", dev);
  const { ctx } = await newContext(dev); const page = await ctx.newPage(); const w = watch(page);
  for (const p of ADMIN_PAGES) {
    const ok = await openAndLook(run, page, w, SITE + p);
    if (!ok) continue;
    await page.waitForTimeout(1500);
    const t = await bodyText(page);
    const gate = /sign in|log in|password/i.test(t);
    const leak = await page.evaluate(() => document.querySelectorAll("table tbody tr, .item .addr, .row .email").length).catch(() => 0);
    run.step({ action: "see", target: "the sign-in, and nothing of the readers", page: pageKey(SITE + p), passed: gate && !leak, page_said: t.slice(0, 300) });
    if (!gate) run.find({ page: pageKey(SITE + p), step: "", kind: "admin page open to a stranger", message: "Signed out, the page does not ask for a sign-in: " + clip(t, 160), shot: await shot(page, "admin-open") });
    if (leak) run.find({ page: pageKey(SITE + p), step: "", kind: "admin data shown to a stranger", message: leak + " rows of data shown to someone signed out", shot: await shot(page, "admin-leak") });
  }
  // break-in tries: the admin calls straight to the database, with no account
  const calls = [["hx_admin_items", { p_status: "open" }], ["hx_admin_summary", {}], ["hx_make_local_key", { p_for: "x" }], ["admin_heat_summary", {}], ["hx_admin_findings", { p_source: "all", p_days: 30 }]];
  for (const [fn, body] of calls) {
    const r = await fetch(`${SUPA}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: ANON, Authorization: "Bearer " + ANON, "content-type": "application/json" }, body: JSON.stringify(body) });
    const t = await r.text();
    const refused = r.status >= 400 || /admin|not allowed|permission|denied/i.test(t);
    run.step({ action: "call", target: fn + " with no account", note: `answered ${r.status}: ${clip(t, 160)}`, passed: refused });
    if (!refused) run.find({ page: "/rest/v1/rpc/" + fn, step: "no account", kind: "admin call open to a stranger", message: `${fn} answered ${r.status} to someone signed out: ${clip(t, 160)}` });
    else run.ok("/rest/v1/rpc/" + fn, "no account");
  }
  await ctx.close(); return run;
}

// press every button on a page once (fresh page for each press), never a dangerous one
async function pressEverything(run, ctx, url, { prepare } = {}) {
  const pageK = pageKey(url);
  let page = await ctx.newPage(); let w = watch(page);
  const fresh = async () => {
    await page.close().catch(() => {}); page = await ctx.newPage(); w = watch(page);
    try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }); } catch (_) {}
    await settle(page, 2500); if (prepare) await prepare(page);
  };
  await fresh();
  const list = await page.evaluate((danger) => {
    const rx = new RegExp(danger, "i");
    const vis = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 2 && r.height > 2 && cs.visibility !== "hidden" && cs.display !== "none" && r.bottom > 0 && r.top < innerHeight * 3; };
    const out = [], seen = new Set();
    document.querySelectorAll("button, [role=button], [role=tab], summary, a[href], [onclick]").forEach((e) => {
      if (!vis(e) || e.disabled) return;
      const label = (e.getAttribute("aria-label") || e.innerText || e.title || e.id || "").replace(/\s+/g, " ").trim().slice(0, 60);
      if (!label || seen.has(label)) return;
      if (rx.test(label) || rx.test(e.getAttribute("onclick") || "")) return;
      const href = e.tagName === "A" ? e.getAttribute("href") || "" : "";
      if (href && (/^(mailto:|tel:|sms:)/i.test(href) || e.target === "_blank" || (/^https?:/.test(href) && new URL(href, location.href).host !== location.host))) return;
      seen.add(label); out.push(label);
    });
    return out.slice(0, 60);
  }, DANGER.source).catch(() => []);
  run.step({ action: "look", target: `${list.length} buttons and links on ${pageK}`, url, note: list.join(" | ").slice(0, 1100) });
  for (const label of list) {
    const from = mark(w);
    const el = await findByLabel(page, label);
    if (!el) { await fresh(); continue; }
    const before = await page.evaluate(() => ({ c: window.__twEyes ? window.__twEyes.changes : 0, u: location.href })).catch(() => ({ c: 0, u: "" })), loads0 = w.loads;
    const t0 = Date.now();
    try { await el.click({ timeout: 5000 }); } catch (e) { run.step({ action: "tap", target: label, passed: true, note: "could not be pressed: " + clip(e.message, 100) }); await fresh(); continue; }
    // the answer: any change on the page, a new page, a pop-up (watched up to 13 s like the eyes)
    let answered = false, ms = 0;
    for (let i = 0; i < 26; i++) {
      await page.waitForTimeout(500);
      const now = await page.evaluate(() => ({ c: window.__twEyes ? window.__twEyes.changes : 0, u: location.href })).catch(() => ({ c: -1, u: "gone" }));
      if (now.c !== before.c || now.u !== before.u || w.dialogs.length || w.loads !== loads0) { answered = true; ms = Date.now() - t0; break; }
      if (i === 11 && !answered) continue;
    }
    await page.waitForTimeout(800);
    const step = label;
    const here = pageKey(page.url()) === pageK ? pageK : pageK;
    let n = 0;
    if (!answered) { run.find({ page: here, step, kind: "pressed, nothing happened", message: `"${label}" was pressed and nothing on the page changed for 13 s`, url, shot: await shot(page, "dead-" + label) }); n++; }
    else if (ms >= 10000) { run.find({ page: here, step, kind: "an answer that took 10 seconds or more", message: `"${label}" answered after ${Math.round(ms / 1000)} s`, url }); n++; }
    n += await harvest(run, page, w, here, step, from);
    const nf = run.findings.length; await checkExpect(run, page, here, label, t0); n += run.findings.length - nf;
    const said = (await bodyText(page)).slice(0, 300);
    run.step({ action: "tap", target: label, url: page.url(), page_said: said, ms, passed: n === 0 });
    if (!n) run.ok(here, step);
    await fresh();
  }
  await page.close().catch(() => {});
}
async function findByLabel(page, label) {
  const tries = [page.getByRole("button", { name: label, exact: true }), page.getByRole("link", { name: label, exact: true }), page.getByRole("tab", { name: label, exact: true }),
    page.locator("button, [role=button], summary, a[href], [onclick]").filter({ hasText: label })];
  for (const l of tries) {
    const n = await l.count().catch(() => 0);
    for (let i = 0; i < n && i < 5; i++) { const e = l.nth(i); if (await e.isVisible().catch(() => false)) return e; }
  }
  return null;
}
async function walkButtons(dev) {
  const run = new Run("Every button", "buttons", "stranger", dev);
  const { ctx } = await newContext(dev);
  for (const p of sitePages().filter((p) => !/selftest/.test(p))) await pressEverything(run, ctx, SITE + p);
  await ctx.close();
  // the packaged app (no sign-in wall): every button of the library
  const n = await newContext(dev, { native: true });
  await pressEverything(run, n.ctx, NATIVE + "/app.html", { prepare: skipWelcome });
  await n.ctx.close();
  return run;
}
async function skipWelcome(page) {
  for (const sel of ["#fwSkip", "#welcome button", "#fwStart"]) {
    const e = page.locator(sel); if (await e.count().catch(() => 0)) { await e.first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(600); }
  }
}

// the packaged app as a new reader: games, free books, free comics, the Weave, the store
async function walkApp(dev, { persona = "new reader", native = true, storage = null, all = false } = {}) {
  const run = new Run(native ? "The app (phone app)" : (all ? "Signed in: Unlock Everything" : "Signed in: nothing bought"), native ? "app" : "signedin", persona, dev);
  const { ctx, base } = await newContext(dev, { native, storage });
  const page = await ctx.newPage(); const w = watch(page);
  await openAndLook(run, page, w, base + (native ? "/app.html" : "/app"));
  await skipWelcome(page);
  const signedIn = await page.evaluate(() => !!(window.getSession && window.getSession())).catch(() => false);
  if (!native && !signedIn) { run.find({ page: "/app", step: "sign in", kind: "could not sign in", message: "The test person did not end up signed in" }); await ctx.close(); return run; }

  // the story games
  for (const g of GAMES) {
    const from = mark(w), pk = "/game/" + g.id;
    const owned = all || (await page.evaluate((id) => (window.isUnlocked ? isUnlocked(id) || ownsAll() : false), g.id).catch(() => false));
    await page.evaluate((id) => openGame(id), g.id).catch((e) => run.find({ page: pk, step: "open", kind: "script error", message: e.message }));
    await page.waitForTimeout(3500);
    const sheet = await page.evaluate(() => document.getElementById("sheet") && document.getElementById("sheet").classList.contains("on")).catch(() => false);
    if (g.locked && !g.preview && !owned) {
      run.step({ action: "tap", target: "open " + g.title, page: pk, passed: sheet, note: sheet ? "the unlock sheet opened" : "the unlock sheet did not open" });
      if (!sheet) run.find({ page: pk, step: "open", kind: "locked game did not offer the unlock", message: `${g.title} is locked and pressing it did not open the unlock sheet`, shot: await shot(page, "locked-" + g.id) });
      else run.ok(pk, "open");
      await page.evaluate(() => window.closeSheet && closeSheet()).catch(() => {});
      continue;
    }
    await playGame(run, page, g, pk);
    await harvest(run, page, w, pk, "", from);
    await page.evaluate(() => window.closeHost && closeHost()).catch(() => {});
    await page.waitForTimeout(600);
  }

  // free books (all books when everything is owned), three pages in
  // with everything owned, a different 10 books and 4 comics each night (every one of them is opened within a week), so a
  // night's walk finishes inside GitHub's time limit; the free ones are opened every night
  const day = Math.floor(Date.now() / 864e5), turn = (list, n) => list.length <= n ? list : Array.from({ length: n }, (_, i) => list[(day * n + i) % list.length]);
  const books = all ? turn(LIB.filter((b) => !b.free), 10) : LIB.filter((b) => b.free);
  for (const b of books) await readBook(run, page, w, b, native);
  for (const c of (all ? turn(COMICS.filter((c) => !c.free), 4) : COMICS.filter((c) => c.free))) await readComic(run, page, w, c);

  // the Weave
  {
    const from = mark(w);
    await page.evaluate(() => window.openWeave && openWeave()).catch(() => {});
    await page.waitForTimeout(2500);
    const n = await page.evaluate(() => document.querySelectorAll("#weaveBody [onclick], #weaveBody .entry, #weaveBody .we").length).catch(() => 0);
    run.step({ action: "tap", target: "The Weave", page: "/app", passed: true, note: n + " entries showing" });
    const q = page.locator("#weaveQ");
    if (await q.count()) { await q.fill("dragon").catch(() => {}); await page.waitForTimeout(1500); run.step({ action: "type", target: "Weave search: dragon", page: "/app", page_said: clip(await page.evaluate(() => (document.getElementById("weaveBody") || {}).innerText || "").catch(() => ""), 300) }); }
    const first = page.locator("#weaveBody [onclick]").first();
    if (await first.count()) { await first.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(1500); }
    if (!(await harvest(run, page, w, "/app", "The Weave", from))) run.ok("/app", "The Weave");
    await page.evaluate(() => window.closeWeave && closeWeave()).catch(() => {});
  }
  // the store sheet (looked at, never bought from)
  {
    const from = mark(w);
    await page.evaluate(() => window.openStore && openStore()).catch(() => {});
    await page.waitForTimeout(2000);
    const t = clip(await page.evaluate(() => (document.getElementById("sheet") || {}).innerText || "").catch(() => ""), 600);
    const prices = (t.match(/\$\d/g) || []).length;
    run.step({ action: "tap", target: "Store", page: "/app", page_said: t, passed: prices > 0 || all });
    if (!prices && !all) run.find({ page: "/app", step: "Store", kind: "wrong thing on the page", message: "The store opened with no prices: " + clip(t, 160), shot: await shot(page, "store") });
    if (!(await harvest(run, page, w, "/app", "Store", from)) && (prices || all)) run.ok("/app", "Store");
  }
  await ctx.close();
  return run;
}
async function dismissCelebration(run, page, pk) {
  const what = await page.evaluate(() => {
    const tk = document.getElementById("funTakeover"), um = document.getElementById("unlockModal");
    if (tk && tk.classList.contains("on")) { const t = (tk.innerText || "").replace(/\s+/g, " ").trim().slice(0, 140); document.getElementById("tkBtn").click(); return t; }
    if (um && um.classList.contains("on")) { const t = (um.innerText || "").replace(/\s+/g, " ").trim().slice(0, 140); if (window.closeUnlockModal) closeUnlockModal(); else um.classList.remove("on"); return t; }
    return "";
  }).catch(() => "");
  if (what) { run.step({ action: "tap", target: "Continue", page: pk, note: "A celebration opened over the game; pressed Continue like a reader: " + what }); await page.waitForTimeout(500); }
  return !!what;
}
async function playGame(run, page, g, pk) {
  await dismissCelebration(run, page, pk);
  const fr = page.frames().find((f) => f !== page.mainFrame() && /^blob:/.test(f.url()));
  if (!fr) { run.find({ page: pk, step: "open", kind: "game did not open", message: `${g.title}: no game frame appeared`, shot: await shot(page, "game-" + g.id) }); return; }
  try { await fr.waitForLoadState("domcontentloaded", { timeout: 10000 }); } catch (_) {}
  await page.waitForTimeout(1200);
  let text = clip(await fr.evaluate(() => document.body.innerText).catch(() => ""), 4000);
  if (text.length < 120) { run.find({ page: pk, step: "open", kind: "game did not open", message: `${g.title} opened to almost nothing: "${clip(text, 120)}"`, shot: await shot(page, "game-" + g.id) }); return; }
  run.step({ action: "goto", target: g.title, page: pk, page_said: text.slice(0, 600) });
  run.ok(pk, "open");
  // play like a reader: press what moves the story on (begin / continue / a choice), picking a card or an option first when a
  // screen needs one; never save / load / restart / quit. Every real button pressed must do something; 25 story changes is enough.
  let dead = 0, moves = 0, tried = new Set();
  // 27 Nov 2026: a game's own panels (Character, Case Board, Dossier, The Ledger, Travel) are pressed once each and closed again,
  // like a reader looking and going back to the story. Until today the walk opened one, never closed it, pressed the same tab
  // behind the open panel and called it dead (Obsidian's Character), or pressed it four times running (Dossier, The Ledger).
  const panels = new Set(), PANEL = /^\W*(character|case board|dossier|the ledger|ledger)\W*$/i;
  for (let i = 0; i < 60 && moves < 25; i++) {
    const pick = await fr.evaluate((tried) => {
      // 27 Nov 2026: "back", "menu", "journal" and "close" are skipped only as a whole button (◈ Journal, Close); a story choice like
      // "Back to the room ▸" is the story going on, and skipping it stopped Dragon Strife after five moves
      const bad = { test: (t) => /\b(save|load|restart|new game|quit|reset|share|copy|seed|delete|erase|start over|settings|sound|music)\b/i.test(t) || /^\W*(back|menu|journal|close)\W*$/i.test(String(t).trim()) };
      const vis = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 4 && r.height > 4 && cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity > 0.1; };
      const all = [...document.querySelectorAll("button, [onclick], [role=button], a[href^='#'], .choice, .ch, .opt, .option, .card, .tile, .pick, li, label, div, span")]
        .filter((e) => vis(e) && !e.disabled && /\w/.test(e.textContent) && e.textContent.trim().length < 400 && !bad.test(e.textContent))
        .filter((e) => /^(BUTTON|A|LABEL)$/.test(e.tagName) || e.hasAttribute("onclick") || e.getAttribute("role") === "button" || getComputedStyle(e).cursor === "pointer")
        .filter((e) => !(e.parentElement && e.parentElement.closest && e.parentElement.closest("button, [onclick], [role=button]")));
      const key = (e) => e.tagName + "|" + e.textContent.replace(/\s+/g, " ").trim().slice(0, 60);
      const real = (e) => e.tagName === "BUTTON" || e.hasAttribute("onclick") || e.getAttribute("role") === "button";
      const go = /\b(begin|start|play|continue|next|enter|confirm|report|accept|ready|go|proceed|onward)\b|\u2192|\u203a/i;
      const fresh = all.filter((e) => !tried.includes(key(e)));
      const p = fresh.find((e) => real(e) && go.test(e.textContent)) || fresh.find((e) => /choice|\bch\b|opt|card|tile|pick/.test(e.className)) || fresh.find(real) || fresh[0];
      if (!p) return null;
      document.querySelectorAll("[data-hx-pick]").forEach((x) => x.removeAttribute("data-hx-pick"));
      p.setAttribute("data-hx-pick", "1");
      return { key: key(p), label: p.textContent.replace(/\s+/g, " ").trim().slice(0, 80), real: real(p) };
    }, [...tried]).catch(() => null);
    if (pick && PANEL.test(pick.label) && pick.label.length < 40) {
      if (panels.has(pick.label.toLowerCase())) { tried.add(pick.key); continue; }
      panels.add(pick.label.toLowerCase());
    }
    if (!pick) { run.step({ action: "note", page: pk, note: `After ${moves} story moves there was nothing left to press (an ending, or a screen with no choices)`, page_said: clip(await fr.evaluate(() => document.body.innerText).catch(() => ""), 400) }); break; }
    tried.add(pick.key);
    // 27 Nov 2026: the app celebrates over the game (a rare Weave thread, a rank-up, new Weave entries). A reader presses Continue
    // and plays on; the walk does the same and says so. Until today it pressed the game underneath and called the choice dead.
    await dismissCelebration(run, page, pk);
    const before = text, c0 = await fr.evaluate(() => (window.__twEyes ? window.__twEyes.changes : 0)).catch(() => 0);
    let missed = false;
    await fr.locator("[data-hx-pick]").first().click({ timeout: 4000 }).catch(() => { missed = true; });
    if (missed) {
      // the press did not land. Inside the game (its own dice box, its own panel) the game is mid-move and the loop below goes on;
      // something of the app's over the game that is not a celebration with a Continue is what a reader meets too, and is listed
      const over = await page.evaluate(() => { const f = document.getElementById("frame"); if (!f) return ""; const r = f.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        if (!e || e === f) return ""; const box = e.closest("[id]") || e; return (box.id ? "#" + box.id + ": " : "") + (box.innerText || "").replace(/\s+/g, " ").trim().slice(0, 160); }).catch(() => "");
      if (over) { run.find({ page: pk, step: "choice: " + pick.label, kind: "game covered", message: `In ${g.title}, "${pick.label}" could not be pressed: something of the app is over the game (${over})`, shot: await shot(page, "covered-" + g.id) }); dead++; break; }
    }
    let changed = false, any = false;
    for (let k = 0; k < 12 && !changed; k++) {
      await page.waitForTimeout(400);
      await fr.evaluate(() => { const r = document.querySelector(".rollbtn, .rollbox button"); if (r && r.offsetParent) r.click(); }).catch(() => {});
      text = clip(await fr.evaluate(() => document.body.innerText).catch(() => ""), 4000);
      changed = text !== before;
      any = any || changed || (await fr.evaluate(() => (window.__twEyes ? window.__twEyes.changes : 0)).catch(() => 0)) !== c0;
    }
    if (changed && PANEL.test(pick.label) && pick.label.length < 40) {
      // a panel opened: look, then close it the way a reader does, and do not count it as a story move
      // its Close (an overlay), or the same tab again (a panel that opens in place, like Dossier and The Ledger)
      let closed = await fr.evaluate(() => { const vis = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 4 && r.height > 4 && cs.visibility !== "hidden" && cs.display !== "none"; };
        const c = [...document.querySelectorAll("button, [onclick], [role=button]")].find((e) => vis(e) && /^(close|done|×|✕)$/i.test(e.textContent.trim()));
        if (c) { c.click(); return true; } return false; }).catch(() => false);
      if (!closed) { await fr.locator("[data-hx-pick]").first().click({ timeout: 3000 }).catch(() => {}); }
      await page.waitForTimeout(500);
      text = clip(await fr.evaluate(() => document.body.innerText).catch(() => ""), 4000);
      if (!closed) closed = text === before;
      run.step({ action: "choose", target: pick.label, page: pk, passed: true, note: closed ? "a panel opened; looked and closed it" : "a panel opened; it had no Close to press" });
      if (!closed) { run.find({ page: pk, step: "panel: " + pick.label, kind: "panel would not close", message: `In ${g.title}, "${pick.label}" opened a panel with no way to close it`, shot: await shot(page, "panel-" + g.id) }); dead++; break; }
      continue;
    }
    if (changed) { moves++; tried = new Set(); }
    run.step({ action: "choose", target: pick.label, page: pk, step: "move " + (moves), page_said: text.slice(0, 500), passed: any || !pick.real });
    if (!any && pick.real) { dead++; run.find({ page: pk, step: "choice: " + pick.label, kind: "choice did nothing", message: `In ${g.title}, pressing "${pick.label}" did nothing`, shot: await shot(page, "choice-" + g.id) }); break; }
  }
  run.step({ action: "note", page: pk, note: `${g.title}: ${moves} story moves played` });
  if (!dead) run.ok(pk, "play");
}
async function readBook(run, page, w, b, native) {
  const pk = "/reader.html?id=" + b.id, from = mark(w);
  await page.evaluate((x) => openBook(x.file, x.title, x.id), b).catch((e) => run.find({ page: pk, step: "open", kind: "script error", message: e.message }));
  // the reader opens in the host frame; the book's text is inside epub.js's own frame
  let words = "", t0 = Date.now();
  let shows = false;
  for (let i = 0; i < 40 && !shows; i++) {
    await page.waitForTimeout(500);
    for (const f of page.frames()) {
      if (f === page.mainFrame() || /reader\.html/.test(f.url())) continue;
      if (f.parentFrame() && /reader\.html/.test(f.parentFrame().url())) {
        const t = await f.evaluate(() => ({ t: document.body ? document.body.innerText : "", pics: [...document.querySelectorAll("img")].filter((im) => im.naturalWidth > 1).length + document.querySelectorAll("svg image, image").length })).catch(() => ({ t: "", pics: 0 }));
        if (t.t.length > words.length) words = t.t;
        if (t.t.trim().length > 20 || t.pics) shows = true;
      }
    }
  }
  const rf = page.frames().find((f) => /reader\.html/.test(f.url()));
  const readerSaid = rf ? clip(await rf.evaluate(() => document.body.innerText).catch(() => ""), 300) : "";
  if (!shows) {
    run.find({ page: pk, step: "open", kind: "book did not open", message: `"${b.title}" did not show its text in ${Math.round((Date.now() - t0) / 1000)} s. The reader said: "${clip(readerSaid, 160)}"`, shot: await shot(page, "book-" + b.id) });
  } else {
    run.step({ action: "read", target: b.title, page: pk, page_said: clip(words, 400), ms: Date.now() - t0 });
    let turned = 0, last = words;
    for (let i = 0; i < 3 && rf; i++) {
      await rf.evaluate(() => window.next && window.next()).catch(() => {});
      await page.waitForTimeout(1200);
      let now = "";
      for (const f of page.frames()) if (f.parentFrame() === rf) { const t = await f.evaluate(() => document.body ? document.body.innerText : "").catch(() => ""); if (t.length > now.length) now = t; }
      const pct = await rf.evaluate(() => (document.getElementById("pct") || {}).textContent || "").catch(() => "");
      if (now !== last || pct) turned++;
      if (now.trim().length > (words || "").trim().length) words = now;
      last = now;
    }
    // 27 Nov 2026: a cover alone is not reading. Words must show by the third page, or it is listed.
    let most = words;
    for (const f of page.frames()) if (f.parentFrame() === rf) { const t = await f.evaluate(() => document.body ? document.body.innerText : "").catch(() => ""); if (t.trim().length > most.trim().length) most = t; }
    if (last && last.trim().length > most.trim().length) most = last;
    const wordsShown = most.trim().split(/\s+/).filter(Boolean).length;
    run.step({ action: "turn pages", target: b.title, page: pk, passed: turned > 0 && wordsShown >= 15, note: `turned ${turned} of 3; ${wordsShown} words showing`, page_said: clip(most, 300) });
    if (turned && wordsShown < 15) run.find({ page: pk, step: "read", kind: "book shows no words", message: `"${b.title}" opened and turned, but after three pages only ${wordsShown} words show: "${clip(most, 120)}"`, shot: await shot(page, "words-" + b.id) });
    if (!turned) run.find({ page: pk, step: "next page", kind: "page did not turn", message: `In "${b.title}", next page did nothing`, shot: await shot(page, "turn-" + b.id) });
  }
  const n = await harvest(run, page, w, pk, "", from);
  if (!n && shows) run.ok(pk, "open");
  await page.evaluate(() => window.closeHost && closeHost()).catch(() => {});
  await page.waitForTimeout(500);
}
async function readComic(run, page, w, c) {
  const pk = "/comic.html?id=" + c.id, from = mark(w);
  await page.evaluate((x) => openComic(x.id, x.title), c).catch((e) => run.find({ page: pk, step: "open", kind: "script error", message: e.message }));
  let ok = false, cf = null;
  for (let i = 0; i < 30 && !ok; i++) {
    await page.waitForTimeout(500);
    cf = page.frames().find((f) => /comic\.html/.test(f.url()));
    if (cf) ok = await cf.evaluate(() => [...document.images].some((im) => im.complete && im.naturalWidth > 50)).catch(() => false);
  }
  if (!ok) run.find({ page: pk, step: "open", kind: "comic did not open", message: `"${c.title}" showed no page in 15 s: ${clip(cf ? await cf.evaluate(() => document.body.innerText).catch(() => "") : "no comic frame", 160)}`, shot: await shot(page, "comic-" + c.id) });
  else {
    run.step({ action: "read", target: c.title, page: pk });
    await cf.evaluate(() => { const n = document.getElementById("nextBtn"); if (n) n.click(); }).catch(() => {});
    await page.waitForTimeout(1000);
  }
  if (!(await harvest(run, page, w, pk, "", from)) && ok) run.ok(pk, "open");
  await page.evaluate(() => window.closeHost && closeHost()).catch(() => {});
}

// signed in, as the test people (made and signed in by hx-ingest; GitHub only)
async function walkSignedIn(dev) {
  const runs = [];
  for (const who of ["reader", "everything"]) {
    const link = await ingest({ action: "persona", who });
    if (!link || !link.link) { console.log("  (no sign-in for the test person " + who + ": " + JSON.stringify(link).slice(0, 160) + ")"); continue; }
    const { ctx } = await newContext(dev);
    const page = await ctx.newPage();
    await page.goto(link.link, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await settle(page, 5000);
    const storage = await ctx.storageState();
    await ctx.close();
    runs.push(await walkApp(dev, { persona: who === "everything" ? "Unlock Everything" : "nothing bought", native: false, storage, all: who === "everything" }));
  }
  return runs;
}

// the self-test: one of every break, every one must be caught
const PLANTED = ["pressed, nothing happened", "an answer that took 10 seconds or more", "pressed again and again", "stalled", "page stuck loading", "error pop-up",
  "error shown", "script error", "failed call", "broken picture", "junk on the page", "did not finish", "link goes nowhere",
  // 27 Nov 2026 (Command Center 1.9.0, 1.11.0)
  "pressed on a busy page, nothing happened", "a busy page's real answer heard", "a box the colour of the page", "a picture squeezed small"];
const PHONE_ONLY = ["sideways scroll", "cut off button", "unreadable button"];
async function walkSelftest(dev) {
  const run = new Run("Self-test", "selftest", "stranger", dev);
  const { ctx } = await newContext(dev); const page = await ctx.newPage(); const w = watch(page);
  const url = SITE + "/admin/selftest.html";
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await settle(page, 2000);
  // the dead button alone first: any other press inside its 13 s would count as its answer
  await page.locator("#dead").click({ timeout: 4000 }).catch(() => {});
  run.step({ action: "tap", target: "dead", page: "/admin/selftest.html" });
  await page.waitForTimeout(14500);
  // the busy page (27 Nov 2026): its helper must not hide a dead button, and must not make a button that answers look dead.
  // On the phone's zoomed-out page the tap can land beside it, so the press is sent to the button itself when it does.
  await page.locator("#churnDead").click({ timeout: 4000 }).catch(() => page.locator("#churnDead").dispatchEvent("click").catch(() => {}));
  run.step({ action: "tap", target: "churnDead", page: "/admin/selftest.html" });
  await page.waitForTimeout(14500);
  await page.locator("#churnReal").click({ timeout: 4000 }).catch(() => page.locator("#churnReal").dispatchEvent("click").catch(() => {}));
  run.step({ action: "tap", target: "churnReal", page: "/admin/selftest.html" });
  await page.waitForTimeout(1500);
  for (const id of ["slow", "popup", "shown", "crash", "call", "expect", "stall"]) {
    await page.locator("#" + id).click({ timeout: 4000 }).catch(() => {});
    run.step({ action: "tap", target: id, page: "/admin/selftest.html" });
    await page.waitForTimeout(300);
  }
  for (let i = 0; i < 4; i++) { await page.locator("#rage").click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(250); }
  await linksGoSomewhere(run, page, "/admin/selftest.html", new Set());
  await page.waitForTimeout(60000);   // the stall (45 s) and the page stuck loading (25 s) need their time
  const f = await eyes(page);
  const caught = new Set(f.map((x) => x.kind));
  if (run.findings.some((x) => x.kind === "link goes nowhere")) caught.add("link goes nowhere");
  const deadOn = (lbl) => f.some((x) => x.kind === "pressed, nothing happened" && String(x.step || x.message || "").includes(lbl));
  if (deadOn("Does nothing here too")) caught.add("pressed on a busy page, nothing happened");
  if (!deadOn("Show the chapters")) caught.add("a busy page's real answer heard");
  const ex = await lookExtra(page);
  if (ex.samebox.length) caught.add("a box the colour of the page");
  if (ex.shrunk.length) caught.add("a picture squeezed small");
  for (const e of w.errors) if (e) caught.add("script error");
  const expected = PLANTED.concat(dev === "phone" ? PHONE_ONLY : []);
  const missed = expected.filter((k) => !caught.has(k));
  run.step({ action: "see", target: "every planted break caught", page: "/admin/selftest.html", passed: missed.length === 0, note: missed.length ? "missed: " + missed.join(", ") : `all ${expected.length} caught` });
  run.findings = [];   // the planted breaks are not bugs
  run.selftest = { expected, caught: expected.filter((k) => caught.has(k)) };
  if (missed.length) run.find({ page: "/admin/selftest.html", step: "", kind: "harness went blind", message: "The self-test missed: " + missed.join(", "), shot: await shot(page, "selftest") });
  await ctx.close();
  return run;
}

// look again: every open item a walk found, at its exact page and step (Command Center's nightly look-again). A step that is a
// button is looked at again: gone from a page that shows, or switched off, closes it without a press; still there, it is
// pressed once (never a send / pay / delete button) and must answer.
async function walkAgain(dev) {
  const items = await ingest({ action: "open_findings" });
  if (!items || !Array.isArray(items.findings) || !items.findings.length) return null;
  const run = new Run("Look again", "again", "stranger", dev);
  const { ctx } = await newContext(dev);
  const mine = items.findings.filter((f) => ((f.seen_devices || []).includes(dev) || (f.sources || []).includes("visitor")) && /^\/(?!game\/|rest\/)/.test(f.page));
  for (const p of [...new Set(mine.map((f) => f.page))]) {
    const page = await ctx.newPage(); const w = watch(page);
    await openAndLook(run, page, w, SITE + p);
    for (const f of mine.filter((x) => x.page === p && x.step && !/^choice/.test(x.step))) {
      const el = await findByLabel(page, f.step);
      const on = el ? await el.isEnabled().catch(() => false) : false;
      if (!el || !on) {
        run.step({ action: "see", target: f.step, page: p, note: `"${f.step}" is ${el ? "switched off" : "no longer on this page"}${page.url() !== SITE + p ? " (the page now goes to " + page.url() + ")" : ""}; nothing to press, nothing left to answer.` });
        run.ok(p, f.step);
        continue;
      }
      if (DANGER.test(f.step)) { run.step({ action: "see", target: f.step, page: p, note: `"${f.step}" is still there; it is never pressed by the harness (it sends, pays or deletes). It closes when a test that presses it passes, or when you press it, look, and press Done.` }); continue; }
      const from = mark(w), before = await page.evaluate(() => ({ c: window.__twEyes ? window.__twEyes.changes : 0, u: location.href })).catch(() => ({ c: 0, u: "" }));
      await el.click({ timeout: 5000 }).catch(() => {});
      let answered = false;
      for (let i = 0; i < 26 && !answered; i++) { await page.waitForTimeout(500); const now = await page.evaluate(() => ({ c: window.__twEyes ? window.__twEyes.changes : 0, u: location.href })).catch(() => ({ c: -1, u: "gone" })); answered = now.c !== before.c || now.u !== before.u || w.dialogs.length > 0; }
      if (!answered) run.find({ page: p, step: f.step, kind: "pressed, nothing happened", message: `"${f.step}" was pressed again and still nothing changed for 13 s`, shot: await shot(page, "again") });
      else if (!(await harvest(run, page, w, p, f.step, from))) { run.step({ action: "tap", target: f.step, page: p, note: "it answered" }); run.ok(p, f.step); }
      await page.goto(SITE + p, { waitUntil: "domcontentloaded" }).catch(() => {}); await settle(page, 2000);
    }
    await page.close();
  }
  await ctx.close();
  return run;
}

// ---------------------------------------------------------------------------------------------------- results
async function oidc() {
  const u = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, t = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!u || !t) return null;
  const r = await fetch(u + "&audience=tw-data-harness", { headers: { authorization: "bearer " + t } });
  return (await r.json()).value;
}
async function ingest(body) {
  if (INGEST === "none") return null;
  try {
    const auth = INGEST === "oidc" ? { oidc: await oidc() } : { key: process.env.HX_KEY || "" };
    const r = await fetch(FN, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, ...auth }) });
    return await r.json();
  } catch (e) { return { ok: false, error: String(e) }; }
}
async function send(run) {
  const p = run.payload(run.selftest ? { selftest: run.selftest } : {});
  RESULTS.push(p);
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(RESULTS, null, 1));
  const bad = p.findings.length;
  console.log(`${p.passed ? "PASS" : "FAIL"} ${run.name} on a ${run.device}: ${p.summary}`);
  for (const f of p.findings) console.log(`   - ${f.kind} | ${f.page}${f.step ? " | " + f.step : ""} | ${clip(f.message, 220)}`);
  if (INGEST !== "none") {
    // pictures go up with the run (the function keeps them in Thread Weaver's private storage)
    const withShots = { ...p, steps: p.steps.map((s) => ({ ...s, shot_b64: s.shot && fs.existsSync(s.shot) ? fs.readFileSync(s.shot).toString("base64") : undefined, shot: undefined })) };
    const r = await ingest({ action: "report", run: withShots });
    console.log("   -> " + JSON.stringify(r).slice(0, 200));
  }
  return bad;
}

(async () => {
  await loadCatalog();
  console.log(`Thread Weaver data harness: ${SITE}${LOCAL ? " (this repository's files)" : ""}, build ${BUILD}, ${GAMES.length} games, ${LIB.length} books, ${COMICS.length} comics`);
  const asked = INGEST !== "none" ? await ingest({ action: "next", max: 5 }) : null;
  // --queue: the half-hourly pass only walks when someone asked for a run on /admin/harness.html
  if (argv.includes("--queue") && !(asked && Array.isArray(asked.work) && asked.work.length)) { console.log("Nothing asked for."); process.exit(0); }
  let total = 0;
  for (const dev of DEVICES) {
    if (ONLY.includes("selftest")) { const r = await walkSelftest(dev); await send(r); if (r.findings.length) console.log("   THE HARNESS IS BLIND TO SOMETHING ON A " + dev.toUpperCase()); }
    if (ONLY.includes("pages")) total += await send(await walkPages(dev));
    if (ONLY.includes("locked")) total += await send(await walkLocked(dev));
    if (ONLY.includes("buttons")) total += await send(await walkButtons(dev));
    if (ONLY.includes("app")) total += await send(await walkApp(dev));
    if (ONLY.includes("signedin") && INGEST !== "none") for (const r of await walkSignedIn(dev)) total += await send(r);
    if (ONLY.includes("again") && INGEST !== "none") { const r = await walkAgain(dev); if (r) total += await send(r); }
  }
  if (asked && Array.isArray(asked.work)) for (const q of asked.work) await ingest({ action: "done", request_id: q.request_id });
  for (const k in BROWSERS) await BROWSERS[k].b.close().catch(() => {});
  console.log(`\n${total} thing(s) wrong in all. Results: ${path.join(OUT, "results.json")}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
