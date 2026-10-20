// serial — Thread Weaver Serials (1.15.0), 12 Oct 2026. Moved to Thread Weaver's own project 13 Oct 2026
// (only change: unsubscribe links point at this project).
// 20 Oct 2026: chapter emails use SES configuration set "wannabepress-email" (events -> this project's nl-ses-events), not Joy's "hapitalist-newsletter".
// 14 Oct 2026: paid serials can be read ahead one chapter at a time for $1 (serial_chapter_purchases).
// Each paid chapter is a credit that moves that reader's serial one chapter ahead for good; the weekly
// schedule continues from there, so a bought chapter is never "delivered" again for free.
//
// Any book or series in the app can be followed as a serial: one chapter a week,
// on the weekday the reader picks. Readers who own the bundle (or Unlock Everything,
// which includes paying Hapitalist members via my_entitlements) and free books read
// straight through. Chapters come from the app's own EPUBs: each book is opened ONCE,
// split along its reading order, cleaned, and cached in serial_chapter_index.
//
// POST JSON { action, ... }: catalog | toc | follow | set_day | unfollow | mine | chapter | set_email |
//   chapter_checkout (web: $1 Stripe Checkout for the reader's next chapter) | mail_run
//   GET ?unsub=1&u&s&t -> one-click unsubscribe from a chapter email

import { createClient } from "jsr:@supabase/supabase-js@2";
import { unzipSync, strFromU8 } from "npm:fflate@0.8.2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

const SITE = "https://thread.wannabepress.com";
const SELF = (Deno.env.get("SUPABASE_URL") || "") + "/functions/v1/serial";
const CHAPTER_PRICE_CENTS = 100;
const ALLOWED_ORIGINS = [
  SITE, "https://quest-rpg-store.netlify.app",
  "capacitor://localhost", "http://localhost", "https://localhost",
  "app://localhost", "ionic://localhost", "null",
];
function cors(origin: string | null) {
  const o = origin && (ALLOWED_ORIGINS.includes(origin) || /^http:\/\/localhost:\d+$/.test(origin)) ? origin : SITE;
  return {
    "Access-Control-Allow-Origin": o, "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

type Book = { id: string; title: string; file: string; free: boolean; bundle: string | null; series: string };
type Serial = { id: string; title: string; kind: "series" | "book"; bundle: string | null; books: Book[] };

const SERIES_IDS: Record<string, string> = {
  "Godsverse Chronicles": "godsverse",
  "Obsidian Spindle Saga": "obsidian-spindle",
  "Dragon Strife": "dragon-strife",
  "Quest Girls": "quest-girls",
  "Wonderland": "wonderland",
};
const DEFAULT_DAY: Record<string, number> = { "godsverse": 6 };

export function buildCatalog(lib: any[]): Serial[] {
  const out: Serial[] = [];
  const bySeries = new Map<string, Serial>();
  for (const b of lib) {
    if (!b || !b.id || !b.file) continue;
    const book: Book = { id: b.id, title: b.title || b.id, file: b.file, free: !!b.free, bundle: b.bundle || null, series: b.series || "Novel" };
    const sid = SERIES_IDS[book.series];
    if (sid) {
      let s = bySeries.get(sid);
      if (!s) { s = { id: sid, title: book.series === "Godsverse Chronicles" ? "The Godsverse Chronicles" : book.series, kind: "series", bundle: null, books: [] }; bySeries.set(sid, s); out.push(s); }
      s.books.push(book);
      if (!s.bundle && book.bundle) s.bundle = book.bundle;
    } else {
      out.push({ id: book.id, title: book.title, kind: "book", bundle: book.bundle, books: [book] });
    }
  }
  return out;
}

const SKIP_TITLES = /^(contents|table of contents|copyright|title page|also by|other books by|books by|about the author|about the publisher|acknowledg|dedication|cover|newsletter|join my|thank you for reading|special thanks|thanks to|author[’']?s? notes?|a note from the author|afterword from the author|come find me)/i;
const BACK_MATTER = /^(also by|other books by|books by|about the author|about the publisher|acknowledg|newsletter|join my|thank you for reading|author[’']?s? notes?|a note from the author|afterword from the author|come find me)/i;
const DIVIDER = /^(book|part|volume)\s+([0-9]+|[a-z]+)\b/i;
const EXCERPT = /(excerpt|sneak peek|preview|read on for|keep reading|continue reading|start reading|first chapter of|chapter one of)/i;
const NUM_WORDS: Record<string, number> = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12 };
function chapterNumber(title: string): number | null {
  const t = title.trim().toLowerCase();
  if (/^prologue\b/.test(t)) return 0;
  const m = t.match(/^(?:chapter|ch\.?|part)?\s*(\d+|[a-z]+)\b/);
  if (!m) return null;
  if (/^\d+$/.test(m[1])) return +m[1];
  return NUM_WORDS[m[1]] ?? null;
}
const KEEP_TAGS = new Set(["p","br","em","i","strong","b","h1","h2","h3","h4","blockquote","hr","ul","ol","li","small","sup","sub","span","div","section"]);

export function cleanHtml(body: string): string {
  let s = body;
  s = s.replace(/<(script|style|svg|iframe|object|embed|noscript|math|form|button|input|select|textarea|video|audio|picture|figure|head)\b[\s\S]*?<\/\1\s*>/gi, "");
  s = s.replace(/<(img|source|link|meta|input|embed|base)\b[^>]*>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<\s*(\/?)\s*([a-zA-Z0-9]+)\b[^>]*?(\/?)\s*>/g, (_m, close, tag, self) => {
    const t = String(tag).toLowerCase();
    if (!KEEP_TAGS.has(t)) return "";
    if (t === "div" || t === "section" || t === "span") return close ? (t === "span" ? "" : "</p>") : (t === "span" ? "" : "<p>");
    return "<" + close + t + (self && t !== "br" && t !== "hr" ? "" : "") + ">";
  });
  s = s.replace(/(<p>\s*){2,}/g, "<p>").replace(/(<\/p>\s*){2,}/g, "</p>");
  s = s.replace(/<p>\s*(<h[1-4]>)/g, "$1").replace(/(<\/h[1-4]>)\s*<\/p>/g, "$1");
  s = s.replace(/<p>\s*<\/p>/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return s;
}
function textOf(html: string) { return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim(); }
function decodeEntities(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)));
}
function joinPath(base: string, href: string) {
  const parts = (base ? base + "/" : "").concat(href.split("#")[0]).split("/");
  const out: string[] = [];
  for (const p of parts) { if (p === "..") out.pop(); else if (p && p !== ".") out.push(decodeURIComponent(p)); }
  return out.join("/");
}

export type Chapter = { idx: number; title: string; words: number; html: string };
export function splitEpub(bytes: Uint8Array): Chapter[] {
  const files = unzipSync(bytes);
  const read = (p: string) => { const f = files[p]; return f ? strFromU8(f) : ""; };
  const container = read("META-INF/container.xml");
  const opfPath = (container.match(/full-path\s*=\s*"([^"]+)"/i) || [])[1];
  if (!opfPath) throw new Error("epub: no OPF");
  const opf = read(opfPath);
  const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";
  const manifest = new Map<string, { href: string; props: string }>();
  for (const m of opf.matchAll(/<item\b[^>]*>/gi)) {
    const tag = m[0];
    const id = (tag.match(/\bid\s*=\s*"([^"]+)"/i) || [])[1];
    const href = (tag.match(/\bhref\s*=\s*"([^"]+)"/i) || [])[1];
    const props = (tag.match(/\bproperties\s*=\s*"([^"]+)"/i) || [])[1] || "";
    if (id && href) manifest.set(id, { href, props });
  }
  const chapters: Chapter[] = [];
  let highest = -1, part = "", pending = "", ended = false;
  for (const m of opf.matchAll(/<itemref\b[^>]*idref\s*=\s*"([^"]+)"[^>]*>/gi)) {
    const it = manifest.get(m[1]);
    if (!it || /\bnav\b/.test(it.props)) continue;
    if (/linear\s*=\s*"no"/i.test(m[0])) continue;
    const raw = read(joinPath(base, it.href));
    if (!raw) continue;
    const body = (raw.match(/<body\b[^>]*>([\s\S]*)<\/body>/i) || [])[1] || raw;
    const html = cleanHtml(body);
    const text = textOf(html);
    const words = text ? text.split(" ").length : 0;
    const h = body.match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i);
    const tt = raw.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const strip = (x: string) => decodeEntities(x.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    let title = strip((h && h[1]) || (tt && tt[1]) || "").slice(0, 140);
    if (!title) title = strip(text.slice(0, 60));
    const started = chapters.length >= 3;
    if (ended && /^bonus/i.test(title)) { ended = false; part = "Bonus"; highest = -1; continue; }
    if (ended) continue;
    if (started && (BACK_MATTER.test(title) || EXCERPT.test(title))) { ended = true; continue; }
    const dv = title.match(DIVIDER);
    if (dv && words < 150) { if (chapters.length) pending = title.replace(/\s+/g, " ").trim(); continue; }
    if (words < 150 || SKIP_TITLES.test(title)) continue;
    const n = chapterNumber(title);
    if (pending) { if (n !== null && n <= 1) { part = pending; highest = -1; } pending = ""; }
    if (n !== null) {
      if (highest >= 3 && n <= 1) { ended = true; continue; }
      if (n > highest) highest = n;
    }
    const label = part && !DIVIDER.test(title) ? part + " · " + title : title;
    chapters.push({ idx: chapters.length, title: label, words, html });
  }
  if (!chapters.length) throw new Error("epub: no chapters found");
  return chapters;
}

export function localDate(nowMs: number, tzOffsetMin: number): string {
  return new Date(nowMs - (tzOffsetMin || 0) * 60000).toISOString().slice(0, 10);
}
export function weekdaysBetween(fromISO: string, toISO: string, weekday: number): number {
  const a = Date.parse(fromISO + "T00:00:00Z"), b = Date.parse(toISO + "T00:00:00Z");
  if (!(b > a)) return 0;
  const days = Math.round((b - a) / 86400000);
  const startDow = new Date(a).getUTCDay();
  const first = ((weekday - startDow + 7) % 7) || 7;
  return first > days ? 0 : 1 + Math.floor((days - first) / 7);
}
export function allowedThrough(f: { start_index: number; started_on: string; weekday: number }, todayISO: string): number {
  return f.start_index + weekdaysBetween(f.started_on, todayISO, f.weekday);
}
export function nextDelivery(todayISO: string, weekday: number): string {
  const t = Date.parse(todayISO + "T00:00:00Z");
  const add = ((weekday - new Date(t).getUTCDay() + 7) % 7) || 7;
  return new Date(t + add * 86400000).toISOString().slice(0, 10);
}

type Mail = { from: string; to: string; reply_to: string; subject: string; html: string; text: string; headers: Record<string, string> };
type Deps = {
  library(): Promise<any[]>;
  user(token: string): Promise<{ id: string } | null>;
  entitlements(token: string): Promise<string[]>;
  followsList(token: string, uid: string): Promise<any[]>;
  followGet(token: string, uid: string, sid: string): Promise<any | null>;
  followUpsert(token: string, row: any): Promise<void>;
  followDelete(token: string, uid: string, sid: string): Promise<void>;
  indexMeta(bookId: string): Promise<{ idx: number; title: string; words: number }[]>;
  indexChapter(bookId: string, idx: number): Promise<{ title: string; html: string } | null>;
  indexPut(bookId: string, chapters: Chapter[]): Promise<void>;
  epub(book: Book): Promise<Uint8Array>;
  secret(name: string): Promise<string>;
  dueFollows(weekday: number, todayISO: string): Promise<any[]>;
  userEmail(uid: string): Promise<string | null>;
  markEmailed(uid: string, sid: string, g: number): Promise<void>;
  setEmailAdmin(uid: string, sid: string, on: boolean): Promise<boolean>;
  setEmailAsUser(token: string, uid: string, sid: string, on: boolean): Promise<void>;
  ownedBy(uid: string): Promise<string[]>;
  sendKey(email: string): Promise<{ allow: boolean; reason: string; key: string | null }>;
  sendMail(m: Mail): Promise<{ ok: boolean; id?: string; error?: string; retry?: boolean; stop?: boolean }>;
  sesIdentity(domain: string): Promise<any>;
  recordSends(rows: { resend_id: string; user_id: string; serial_id: string; g: number }[]): Promise<void>;
  // paid chapters (credits) a reader holds on a serial, and whether the app stores can verify a purchase
  extra(uid: string, sid: string): Promise<number>;
  iapReady(): Promise<{ ios: boolean; android: boolean }>;
  stripeSession(form: URLSearchParams): Promise<{ url?: string; error?: string }>;
};

let _lib: { at: number; data: any[] } | null = null;
function realDeps(): Deps {
  const URL_ = Deno.env.get("SUPABASE_URL")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(URL_, SERVICE);
  const asUser = (t: string) => createClient(URL_, ANON, { global: { headers: { Authorization: `Bearer ${t}` } } });
  return {
    async library() {
      if (_lib && Date.now() - _lib.at < 10 * 60000) return _lib.data;
      const r = await fetch(SITE + "/books/library.json");
      if (!r.ok) throw new Error("library.json " + r.status);
      _lib = { at: Date.now(), data: await r.json() };
      return _lib.data;
    },
    async user(t) { const { data } = await asUser(t).auth.getUser(); return data?.user ? { id: data.user.id } : null; },
    async entitlements(t) { const { data } = await asUser(t).rpc("my_entitlements"); return Array.isArray(data) ? data.filter((x: any) => typeof x === "string") : []; },
    async followsList(t, uid) { const { data } = await asUser(t).from("serial_follows").select("*").eq("user_id", uid); return data || []; },
    async followGet(t, uid, sid) { const { data } = await asUser(t).from("serial_follows").select("*").eq("user_id", uid).eq("serial_id", sid).maybeSingle(); return data || null; },
    async followUpsert(t, row) { const { error } = await asUser(t).from("serial_follows").upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "user_id,serial_id" }); if (error) throw new Error(error.message); },
    async followDelete(t, uid, sid) { await asUser(t).from("serial_follows").delete().eq("user_id", uid).eq("serial_id", sid); },
    async indexMeta(id) { const { data } = await admin.from("serial_chapter_index").select("idx,title,words").eq("book_id", id).order("idx"); return data || []; },
    async indexChapter(id, idx) { const { data } = await admin.from("serial_chapter_index").select("title,html").eq("book_id", id).eq("idx", idx).maybeSingle(); return data || null; },
    async indexPut(id, ch) {
      for (let i = 0; i < ch.length; i += 50) {
        const { error } = await admin.from("serial_chapter_index").upsert(ch.slice(i, i + 50).map((c) => ({ book_id: id, idx: c.idx, title: c.title, words: c.words, html: c.html })), { onConflict: "book_id,idx" });
        if (error) throw new Error("index write: " + error.message);
      }
    },
    async secret(name) { const { data, error } = await admin.rpc("read_secret", { secret_name: name }); if (error || !data) throw new Error("secret unavailable: " + name); return String(data); },
    async dueFollows(weekday, todayISO) {
      const { data, error } = await admin.from("serial_follows").select("*").eq("email", true).eq("weekday", weekday).lt("started_on", todayISO).limit(2000);
      if (error) throw new Error("due follows: " + error.message); return data || [];
    },
    async userEmail(uid) { const { data } = await admin.auth.admin.getUserById(uid); return data?.user?.email || null; },
    async markEmailed(uid, sid, g) { await admin.from("serial_follows").update({ last_emailed_g: g, updated_at: new Date().toISOString() }).eq("user_id", uid).eq("serial_id", sid); },
    async setEmailAdmin(uid, sid, on) { const { data } = await admin.from("serial_follows").update({ email: on, updated_at: new Date().toISOString() }).eq("user_id", uid).eq("serial_id", sid).select("serial_id"); return !!(data && data.length); },
    async setEmailAsUser(t, uid, sid, on) { const { error } = await asUser(t).from("serial_follows").update({ email: on, updated_at: new Date().toISOString() }).eq("user_id", uid).eq("serial_id", sid); if (error) throw new Error(error.message); },
    async ownedBy(uid) { const { data } = await admin.rpc("member_access", { p_member_uid: uid }); const e = data && (data as any).entitlements; return Array.isArray(e) ? e : []; },
    async sendKey(email) {
      const { data, error } = await admin.rpc("tw_may_email", { p_email: email });
      if (error || !data) return { allow: false, reason: "check_error: " + (error?.message || "no answer"), key: null };
      const v = data as any; return { allow: !!v.allow, reason: String(v.reason || ""), key: null };
    },
    async sendMail(m) {
      const aws = await sesClient(admin);
      const body = {
        FromEmailAddress: m.from, Destination: { ToAddresses: [m.to] }, ReplyToAddresses: [m.reply_to],
        FeedbackForwardingEmailAddress: SES_FEEDBACK_TO, ConfigurationSetName: SES_CONFIG_SET,
        EmailTags: [{ Name: "kind", Value: "serial_chapter" }],
        Content: { Simple: { Subject: { Data: m.subject, Charset: "UTF-8" },
          Body: { Html: { Data: m.html, Charset: "UTF-8" }, Text: { Data: m.text, Charset: "UTF-8" } },
          Headers: Object.entries(m.headers).map(([Name, Value]) => ({ Name, Value })) } },
      };
      let r: Response;
      try { r = await aws.fetch(`https://email.${SES_REGION}.amazonaws.com/v2/email/outbound-emails`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
      catch (e) { return { ok: false, error: "network: " + String((e as Error)?.message || e).slice(0, 200) }; }
      const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = null; }
      if (r.ok && j?.MessageId) return { ok: true, id: j.MessageId };
      const code = (r.headers.get("x-amzn-errortype") || j?.__type || "").split(":")[0].split("#").pop() || ("HTTP" + r.status);
      const msg = code + ": " + String(j?.message || j?.Message || t || "").slice(0, 240);
      if (code === "TooManyRequestsException" || r.status === 429 || r.status >= 500) return { ok: false, retry: true, error: msg };
      if (/LimitExceeded|SendingPaused|AccountSuspended|MailFromDomainNotVerified|AccessDenied|NotFound|MessageRejected/.test(code)) return { ok: false, stop: true, error: msg };
      return { ok: false, error: msg };
    },
    async sesIdentity(domain) {
      const aws = await sesClient(admin);
      const r = await aws.fetch(`https://email.${SES_REGION}.amazonaws.com/v2/email/identities/${encodeURIComponent(domain)}`);
      const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /**/ }
      return r.ok ? { ok: true, verified: j?.VerifiedForSendingStatus, dkim: j?.DkimAttributes?.Status, type: j?.IdentityType, mail_from: j?.MailFromAttributes?.MailFromDomainStatus } : { ok: false, status: r.status, error: t.slice(0, 300) };
    },
    async recordSends(rows) { const ok = rows.filter((r) => r.resend_id); if (ok.length) await admin.from("serial_email_sends").upsert(ok, { onConflict: "resend_id" }); },
    async epub(book) {
      if (book.free) {
        const r = await fetch(SITE + "/books/" + encodeURIComponent(book.file));
        if (r.ok) return new Uint8Array(await r.arrayBuffer());
      }
      const { data, error } = await admin.storage.from("library").download("books/" + book.file);
      if (error || !data) throw new Error("epub download failed: " + book.file);
      return new Uint8Array(await data.arrayBuffer());
    },
    async extra(uid, sid) {
      const { count } = await admin.from("serial_chapter_purchases").select("id", { count: "exact", head: true })
        .eq("user_id", uid).eq("serial_id", sid).is("revoked_at", null);
      return count || 0;
    },
    async iapReady() {
      const { data } = await admin.rpc("tw_iap_ready");
      const v = (data || {}) as any;
      return { ios: !!v.ios || !!(Deno.env.get("APPLE_SHARED_SECRET") || "").trim(), android: !!v.android };
    },
    async stripeSession(form) {
      const key = (await this.secret("stripe-secret-key")).trim();
      const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form,
      });
      const j: any = await r.json().catch(() => ({}));
      return r.ok && j.url ? { url: j.url } : { error: j?.error?.message || ("stripe " + r.status) };
    },
  };
}

const SPLIT_VERSION = "v3";
const ck = (b: Book) => SPLIT_VERSION + ":" + b.id;
async function bookMeta(d: Deps, b: Book) {
  let meta = await d.indexMeta(ck(b));
  if (!meta.length) {
    const ch = splitEpub(await d.epub(b));
    await d.indexPut(ck(b), ch);
    meta = ch.map(({ idx, title, words }) => ({ idx, title, words }));
  }
  return meta;
}
async function walk(d: Deps, s: Serial, g: number) {
  const list: { g: number; book: Book; idx: number; title: string }[] = [];
  for (const b of s.books) {
    const meta = await bookMeta(d, b);
    for (const m of meta) {
      list.push({ g: list.length, book: b, idx: m.idx, title: m.title });
      if (g >= 0 && list.length > g + 1) return list;
    }
  }
  return list;
}
async function resolveFrom(d: Deps, s: Serial, from: unknown): Promise<number> {
  if (from == null || from === "") return 0;
  if (typeof from === "number" || /^\d+$/.test(String(from))) return Math.max(0, Number(from) - 1);
  const m = String(from).toLowerCase().match(/^(.*?)-(\d+)$/);
  if (!m) return 0;
  const key = m[1].replace(/[^a-z0-9]+/g, ""), n = Number(m[2]);
  let offset = 0;
  for (const b of s.books) {
    const meta = await bookMeta(d, b);
    const bid = b.id.toLowerCase().replace(/^[0-9]+-/, "").replace(/[^a-z0-9]+/g, "");
    const bt = b.title.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (bid.startsWith(key) || bt.startsWith(key) || key === bid || key === bt) {
      const exact = meta.findIndex((c) => new RegExp("(^|·\\s*)chapter\\s+" + n + "\\b", "i").test(c.title));
      return offset + (exact >= 0 ? exact : Math.min(meta.length - 1, Math.max(0, n - 1)));
    }
    offset += meta.length;
  }
  return 0;
}
function owns(ents: string[], b: Book) { return b.free || ents.includes("unlock_all") || (!!b.bundle && ents.includes(b.bundle)); }

const MAIL_FROM = "Wannabe Press <stories@wannabepress.com>";
const SES_REGION = "us-east-1", SES_CONFIG_SET = "wannabepress-email", SES_FEEDBACK_TO = "my_dmarc_report@hapitalist.com";
const SEND_RATE = 4;
const RUN_BUDGET_MS = 100_000;
let _ses: AwsClient | null = null;
async function sesClient(admin: any): Promise<AwsClient> {
  if (_ses) return _ses;
  const [{ data: id }, { data: sec }] = await Promise.all([
    admin.rpc("read_secret", { secret_name: "ses-newsletter-key-id" }), admin.rpc("read_secret", { secret_name: "ses-newsletter-secret" })]);
  if (typeof id !== "string" || typeof sec !== "string" || !id || !sec) throw new Error("the SES key is not in the vault");
  _ses = new AwsClient({ accessKeyId: id.trim(), secretAccessKey: sec.trim(), service: "ses", region: SES_REGION });
  return _ses;
}
const MAIL_REPLY_TO = "help@wannabepress.com";
const PRICES: Record<string, string> = {
  godsverse_series: "$50", obsidian_series: "$50", dragonstrife_series: "$20",
  quest_girls_series: "$20", ichabod_series: "$20", unlock_all: "$99.99",
};
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MAIL_TZ_OFFSET = 420;

function escHtml(v: unknown) { return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as any)[c]); }
function longDate(iso: string) {
  const d = new Date(iso + "T12:00:00Z");
  return DAYS[d.getUTCDay()] + ", " + d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}
async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
  return Array.from(sig.slice(0, 16)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function recommend(lib: any[], catalog: Serial[], followed: string[], n = 2) {
  const genresOf = new Map<string, Set<string>>();
  for (const s of catalog) {
    const g = new Set<string>();
    for (const b of s.books) for (const x of ((lib.find((l: any) => l.id === b.id) || {}).genres || [])) g.add(String(x));
    genresOf.set(s.id, g);
  }
  const mine = new Set<string>(); for (const f of followed) for (const x of genresOf.get(f) || []) mine.add(x);
  return catalog.filter((s) => !followed.includes(s.id))
    .map((s) => ({ s, score: [...(genresOf.get(s.id) || [])].filter((x) => mine.has(x)).length + (s.kind === "series" ? 0.5 : 0) }))
    .sort((a, b) => b.score - a.score || a.s.title.localeCompare(b.s.title))
    .slice(0, n).map((x) => ({ id: x.s.id, title: x.s.title, kind: x.s.kind, free: x.s.books.every((b) => b.free), genres: [...(genresOf.get(x.s.id) || [])].slice(0, 2) }));
}

export function renderEmail(o: {
  serialTitle: string; bookTitle: string; chapterTitle: string; html: string; readUrl: string;
  nextDate: string | null; nextTitle: string | null; ownsSeries: boolean; bundle: string | null; buyUrl: string | null;
  chapterUrl: string | null;
  everythingUrl: string; recs: { title: string; url: string; note: string }[]; unsubUrl: string; manageUrl: string; ownsAll: boolean;
}) {
  const gold = "#b8862a", ink = "#1d1a24", dim = "#6f6780", rule = "#e8e2f0";
  const btn = (href: string, label: string, solid = true) =>
    `<a href="${escHtml(href)}" style="display:inline-block;padding:13px 22px;border-radius:8px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;text-decoration:none;${solid ? `background:${gold};color:#ffffff;` : `background:#ffffff;color:${gold};border:2px solid ${gold};`}">${escHtml(label)}</a>`;
  const body = o.html
    .replace(/<h[1-4]>[\s\S]*?<\/h[1-4]>/g, "")
    .replace(/<p>/g, `<p style="margin:0 0 1.05em;font-family:Georgia,'Times New Roman',serif;font-size:18px;line-height:1.65;color:${ink};">`)
    .replace(/<blockquote>/g, `<blockquote style="margin:1em 0;padding-left:14px;border-left:3px solid ${rule};font-style:italic;">`)
    .replace(/<hr>/g, `<p style="text-align:center;color:${dim};margin:1.4em 0;">&#10022;</p>`);
  const book = o.bookTitle && o.bookTitle !== o.serialTitle ? ` &middot; ${escHtml(o.bookTitle)}` : "";
  // read-ahead: the next chapter for $1, or the whole series at full price
  const ahead = o.chapterUrl || o.buyUrl
    ? `<p style="margin:0 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:${ink};">Can&rsquo;t wait?${o.chapterUrl ? ` Read ${o.nextTitle ? `&ldquo;${escHtml(o.nextTitle)}&rdquo;` : "the next chapter"} now for $1` : ""}${o.chapterUrl && o.buyUrl ? ", or" : ""}${o.buyUrl ? ` unlock the whole series${o.bundle && PRICES[o.bundle] ? ` for ${PRICES[o.bundle]}` : ""} and read straight through` : ""}.</p>` +
      `${o.chapterUrl ? btn(o.chapterUrl, "Read the next chapter — $1") : ""}${o.chapterUrl && o.buyUrl ? `<span style="display:inline-block;width:10px;height:10px;"></span>` : ""}${o.buyUrl ? btn(o.buyUrl, o.chapterUrl ? "Unlock the whole series" : "Read the rest now", !o.chapterUrl) : ""}`
    : "";
  const next = o.ownsSeries
    ? `<p style="margin:0 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:${ink};">You own this series, so the next chapter is already waiting.</p>${btn(o.readUrl, "Keep reading in the app")}`
    : `<p style="margin:0 0 6px;font-family:Helvetica,Arial,sans-serif;font-size:13px;letter-spacing:1px;text-transform:uppercase;color:${dim};">Next chapter</p>
       <p style="margin:0 0 14px;font-family:Georgia,serif;font-size:19px;color:${ink};">${o.nextTitle ? `&ldquo;${escHtml(o.nextTitle)}&rdquo; arrives ` : "Arrives "}<b>${o.nextDate ? escHtml(longDate(o.nextDate)) : "next week"}</b>.</p>
       ${ahead}`;
  const recs = o.recs.length ? `
    <tr><td style="padding:28px 28px 8px;"><p style="margin:0 0 4px;font-family:Helvetica,Arial,sans-serif;font-size:13px;letter-spacing:1px;text-transform:uppercase;color:${dim};">You might also like</p></td></tr>
    ${o.recs.map((r) => `<tr><td style="padding:8px 28px;"><a href="${escHtml(r.url)}" style="text-decoration:none;display:block;border:1px solid ${rule};border-radius:10px;padding:14px 16px;">
      <span style="display:block;font-family:Georgia,serif;font-size:18px;color:${ink};">${escHtml(r.title)}</span>
      <span style="display:block;margin-top:4px;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:${dim};">${escHtml(r.note)} &middot; <span style="color:${gold};font-weight:700;">Follow free &rarr;</span></span></a></td></tr>`).join("")}` : "";
  const everything = o.ownsAll ? "" : `
    <tr><td style="padding:22px 28px 6px;"><div style="background:#faf6ee;border-radius:10px;padding:18px;">
      <p style="margin:0 0 6px;font-family:Georgia,serif;font-size:18px;color:${ink};">Every book, comic and game &mdash; one purchase.</p>
      <p style="margin:0 0 12px;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:${dim};">Unlock Everything in Thread Weaver and every serial opens all the way through.</p>
      ${btn(o.everythingUrl, "Unlock Everything", false)}</div></td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${escHtml(o.chapterTitle)}</title></head>
<body style="margin:0;padding:0;background:#f4f1f8;">
<div style="display:none;max-height:0;overflow:hidden;">${escHtml(o.serialTitle)}: ${escHtml(o.chapterTitle)} is here.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1f8;"><tr><td align="center" style="padding:20px 10px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;">
  <tr><td style="padding:24px 28px 6px;"><p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${gold};font-weight:700;">Wannabe Press &middot; Thread Weaver</p></td></tr>
  <tr><td style="padding:6px 28px 0;"><p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:${dim};">${escHtml(o.serialTitle)}${book}</p>
    <h1 style="margin:6px 0 4px;font-family:Georgia,serif;font-size:30px;line-height:1.2;color:${ink};font-weight:normal;">${escHtml(o.chapterTitle)}</h1></td></tr>
  <tr><td style="padding:14px 28px 6px;">${btn(o.readUrl, "Read in the app", false)}</td></tr>
  <tr><td style="padding:18px 28px 6px;border-top:1px solid ${rule};">${body}</td></tr>
  <tr><td style="padding:10px 28px 6px;"><div style="border-top:1px solid ${rule};padding-top:22px;">${next}</div></td></tr>
  ${recs}
  ${everything}
  <tr><td style="padding:26px 28px 28px;"><p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:${dim};">
    You&rsquo;re getting this because you follow <b>${escHtml(o.serialTitle)}</b> in Thread Weaver.<br>
    <a href="${escHtml(o.manageUrl)}" style="color:${dim};">Manage your serials</a> &middot; <a href="${escHtml(o.unsubUrl)}" style="color:${dim};">Stop these emails</a> (your serial stays in the app)<br>
    Wannabe Press &middot; Los Angeles, CA</p></td></tr>
</table></td></tr></table></body></html>`;
}
function plainText(o: { serialTitle: string; chapterTitle: string; html: string; readUrl: string; unsubUrl: string; chapterUrl?: string | null }) {
  const t = o.html.replace(/<h[1-4]>[\s\S]*?<\/h[1-4]>/g, "").replace(/<\/p>/g, "\n\n").replace(/<br>/g, "\n").replace(/<[^>]+>/g, "");
  return `${o.serialTitle} — ${o.chapterTitle}\n\n${decodeEntities(t).trim()}\n\nRead in the app: ${o.readUrl}\n${o.chapterUrl ? `Read the next chapter now for $1: ${o.chapterUrl}\n` : ""}\nStop these emails: ${o.unsubUrl}\n`;
}
function unsubPage(title: string, msg: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(title)}</title></head>
<body style="margin:0;background:#0e0a16;color:#e9e1f6;font-family:Georgia,serif;"><div style="max-width:460px;margin:12vh auto;padding:24px;text-align:center;">
<p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:2px;color:#e8b53a;">WANNABE PRESS &middot; THREAD WEAVER</p>
<h1 style="font-weight:normal;color:#e8b53a;">${escHtml(title)}</h1><p style="line-height:1.6;color:#cdbfe6;">${msg}</p>
<p><a href="${SITE}/app" style="color:#e8b53a;">Open Thread Weaver</a></p></div></body></html>`;
}

async function mailRun(d: Deps, catalog: Serial[], lib: any[], opts: { dry: boolean; onlyUser?: string; today?: string }) {
  const today = opts.today || localDate(Date.now(), MAIL_TZ_OFFSET);
  const dow = new Date(today + "T00:00:00Z").getUTCDay();
  const rows = (await d.dueFollows(dow, today)).filter((f) => !opts.onlyUser || f.user_id === opts.onlyUser);
  const adminSecret = await d.secret("admin-secret");
  const t0 = Date.now();
  const held: { to: string; serial: string; reason: string }[] = [];
  const byUser = new Map<string, any[]>();
  for (const f of rows) { if (!byUser.has(f.user_id)) byUser.set(f.user_id, []); byUser.get(f.user_id)!.push(f); }
  const out: any[] = [], batch: any[] = [], marks: [string, string, number][] = [];
  for (const [uid, fs] of byUser) {
    const email = await d.userEmail(uid); if (!email) continue;
    if (!opts.dry) {
      const gate = await d.sendKey(email);
      if (!gate.allow) { for (const f of fs) held.push({ to: email.replace(/(^.).*(@.*$)/, "$1…$2"), serial: f.serial_id, reason: gate.reason }); continue; }
    }
    const ents = await d.ownedBy(uid);
    const followedIds = fs.map((f) => f.serial_id);
    for (const f of fs) {
      const s = catalog.find((x) => x.id === f.serial_id); if (!s) continue;
      const g = allowedThrough(f, today) + await d.extra(uid, s.id);
      if (g <= (f.last_emailed_g ?? -1)) continue;
      const list = await walk(d, s, g + 1);
      const c = list[g]; if (!c) continue;
      const ch = await d.indexChapter(ck(c.book), c.idx); if (!ch) continue;
      const nx = list[g + 1] || null;
      const ownsSeries = s.books.every((b) => owns(ents, b));
      const ownsAll = ents.includes("unlock_all");
      const tok = await hmac(adminSecret, uid + ":" + s.id);
      const unsubUrl = `${SELF}?unsub=1&u=${uid}&s=${encodeURIComponent(s.id)}&t=${tok}`;
      const recs = recommend(lib, catalog, followedIds).map((r) => ({ title: r.title, url: `${SITE}/app?serial=${encodeURIComponent(r.id)}`, note: (r.genres.join(" · ") || (r.kind === "series" ? "Series" : "Novel")) + (r.free ? " · free" : "") }));
      const chapterUrl = nx && !owns(ents, nx.book) ? `${SITE}/app?serial=${encodeURIComponent(s.id)}&unlock=next` : null;
      const o = {
        serialTitle: s.title, bookTitle: c.book.title, chapterTitle: ch.title, html: ch.html,
        readUrl: `${SITE}/app?serial=${encodeURIComponent(s.id)}&read=${g}`,
        nextDate: nx ? nextDelivery(today, f.weekday) : null, nextTitle: nx ? nx.title : null,
        ownsSeries, bundle: s.bundle, buyUrl: s.bundle && !ownsSeries ? `${SITE}/app?buy=${encodeURIComponent(s.bundle)}` : null,
        chapterUrl,
        everythingUrl: `${SITE}/app?buy=everything`, recs, unsubUrl, manageUrl: `${SITE}/app?serial=${encodeURIComponent(s.id)}`, ownsAll,
      };
      const subject = `${s.title}: ${ch.title}`;
      batch.push({ from: MAIL_FROM, to: email, reply_to: MAIL_REPLY_TO, subject, html: renderEmail(o), text: plainText(o),
        headers: { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
      marks.push([uid, s.id, g]);
      out.push({ to: email.replace(/(^.).*(@.*$)/, "$1…$2"), serial: s.id, g, subject });
    }
  }
  let sent = 0, left = 0; const errors: string[] = [];
  if (!opts.dry) {
    let stop = "";
    for (let k = 0; k < batch.length; k++) {
      if (stop || Date.now() - t0 > RUN_BUDGET_MS) { left = batch.length - k; break; }
      const due = t0 + (k * 1000) / SEND_RATE; if (due > Date.now()) await new Promise((r) => setTimeout(r, due - Date.now()));
      let r = await d.sendMail(batch[k]);
      if (!r.ok && r.retry) { await new Promise((x) => setTimeout(x, 2000)); r = await d.sendMail(batch[k]); }
      const [u, sid, g] = marks[k];
      if (r.ok) { await d.recordSends([{ resend_id: r.id || "", user_id: u, serial_id: sid, g }]); await d.markEmailed(u, sid, g); sent++; }
      else { errors.push(r.error || "send failed"); if (r.stop) stop = r.error || "stop"; }
    }
  }
  return { today, weekday: DAYS[dow], due: rows.length, prepared: batch.length, sent, left, errors: errors.slice(0, 10), held, items: out.slice(0, 50), preview: opts.dry && batch[0] ? batch[0].html : undefined };
}

export async function handle(req: Request): Promise<Response> {
  const origin = req.headers.get("Origin");
  const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors(origin), "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  const d: Deps = (globalThis as any).__TW_SERIAL_DEPS || realDeps();

  const q = new URL(req.url).searchParams;
  if (q.get("unsub") === "1") {
    const html = (t: string, m: string, st = 200) => new Response(unsubPage(t, m), { status: st, headers: { "Content-Type": "text/html; charset=utf-8" } });
    const u = q.get("u") || "", sid = q.get("s") || "", t = q.get("t") || "";
    try {
      const want = await hmac(await d.secret("admin-secret"), u + ":" + sid);
      if (!u || !sid || t !== want) return html("Link not recognised", "This unsubscribe link isn&rsquo;t valid. You can turn serial emails off inside the app.", 400);
      const changed = await d.setEmailAdmin(u, sid, false);
      const s = buildCatalog(await d.library()).find((x) => x.id === sid);
      return html("You’re unsubscribed", changed
        ? `You won&rsquo;t get emails for <b>${escHtml(s ? s.title : sid)}</b> anymore. The serial is still in your Thread Weaver library, and you can turn emails back on there any time.`
        : "There was nothing to change &mdash; you&rsquo;re not getting emails for this serial.");
    } catch { return html("Something went wrong", "Please try the link again in a minute.", 500); }
  }
  if (req.method !== "POST") return out({ error: "POST only" }, 405);
  let body: any;
  try { body = await req.json(); } catch { return out({ error: "bad json" }, 400); }
  const action = String(body?.action || "");
  const tz = Number.isFinite(+body?.tz) ? Math.max(-840, Math.min(840, +body.tz)) : 0;
  const today = localDate(Date.now(), tz);

  try {
    const catalog = buildCatalog(await d.library());
    const find = (id: unknown) => catalog.find((s) => s.id === String(id || ""));

    if (action === "catalog") {
      return out({ serials: catalog.map((s) => ({ id: s.id, title: s.title, kind: s.kind, bundle: s.bundle, books: s.books.map((b) => ({ id: b.id, title: b.title, free: b.free })), default_day: DEFAULT_DAY[s.id] ?? null })) });
    }
    if (action === "toc") {
      const s = find(body.serial); if (!s) return out({ error: "unknown serial" }, 404);
      const list = await walk(d, s, -1);
      return out({ serial: s.id, chapters: list.map((c) => ({ g: c.g, book: c.book.id, title: c.title })) });
    }
    if (action === "mail_run") {
      const given = req.headers.get("x-admin-secret") || "";
      if (!given || given !== await d.secret("admin-secret")) return out({ error: "forbidden" }, 403);
      if (body.ses_check) return out(await d.sesIdentity("wannabepress.com"));
      const res = await mailRun(d, catalog, await d.library(), { dry: !!body.dry_run, onlyUser: body.only_user ? String(body.only_user) : undefined, today: body.today ? String(body.today) : undefined });
      return out(res);
    }

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return out({ error: "not logged in" }, 401);
    const user = await d.user(token);
    if (!user) return out({ error: "not logged in" }, 401);

    if (action === "follow") {
      const s = find(body.serial); if (!s) return out({ error: "unknown serial" }, 404);
      const existing = await d.followGet(token, user.id, s.id);
      const wd = Number.isInteger(+body.weekday) && +body.weekday >= 0 && +body.weekday <= 6
        ? +body.weekday : (DEFAULT_DAY[s.id] ?? new Date(today + "T00:00:00Z").getUTCDay());
      const start = body.from != null ? await resolveFrom(d, s, body.from) : (existing ? allowedThrough(existing, today) : 0);
      await d.followUpsert(token, { user_id: user.id, serial_id: s.id, start_index: start, started_on: today, weekday: wd, last_read: existing ? Math.min(existing.last_read, start - 1) : start - 1 });
      return out({ ok: true, serial: s.id, start: start + await d.extra(user.id, s.id), weekday: wd, next: nextDelivery(today, wd) });
    }
    if (action === "set_day") {
      const s = find(body.serial); if (!s) return out({ error: "unknown serial" }, 404);
      const f = await d.followGet(token, user.id, s.id); if (!f) return out({ error: "not following" }, 404);
      const wd = +body.weekday; if (!(Number.isInteger(wd) && wd >= 0 && wd <= 6)) return out({ error: "bad weekday" }, 400);
      await d.followUpsert(token, { ...f, start_index: allowedThrough(f, today), started_on: today, weekday: wd });
      return out({ ok: true, weekday: wd, next: nextDelivery(today, wd) });
    }
    if (action === "set_email") {
      const s = find(body.serial); if (!s) return out({ error: "unknown serial" }, 404);
      await d.setEmailAsUser(token, user.id, s.id, !!body.on);
      return out({ ok: true, email: !!body.on });
    }
    if (action === "unfollow") {
      const s = find(body.serial); if (!s) return out({ error: "unknown serial" }, 404);
      await d.followDelete(token, user.id, s.id);
      return out({ ok: true });
    }
    if (action === "mine") {
      const [rows, ents, iap] = await Promise.all([d.followsList(token, user.id), d.entitlements(token), d.iapReady()]);
      const items = [];
      for (const f of rows) {
        const s = find(f.serial_id); if (!s) continue;
        const through = allowedThrough(f, today) + await d.extra(user.id, s.id);
        const nextG = Math.max(0, (f.last_read ?? -1) + 1);
        const list = await walk(d, s, Math.max(nextG, through + 1));
        const nx = list[nextG] || null;
        const ownAll = s.books.every((b) => owns(ents, b));
        const ready = !!nx && (nx.g <= through || owns(ents, nx.book));
        // the chapter that $1 would unlock right now: the one straight after everything they can read
        const buyable = list[through + 1] || null;
        items.push({
          serial: s.id, title: s.title, kind: s.kind, bundle: s.bundle, weekday: f.weekday, email: f.email !== false,
          through, last_read: f.last_read, owns_all: ownAll,
          next_chapter: nx ? { g: nx.g, title: nx.title, book: nx.book.title, ready, can_buy: !ready && !!buyable && !owns(ents, buyable.book) && buyable.g === nx.g } : null,
          next_delivery: nextDelivery(today, f.weekday),
        });
      }
      return out({ today, serials: items, chapter_price_cents: CHAPTER_PRICE_CENTS, chapter_iap: iap });
    }
    if (action === "chapter") {
      const s = find(body.serial); if (!s) return out({ error: "unknown serial" }, 404);
      const g = Math.max(0, Math.floor(+body.g || 0));
      const [f, ents] = await Promise.all([d.followGet(token, user.id, s.id), d.entitlements(token)]);
      const list = await walk(d, s, g + 1);
      const c = list[g]; if (!c) return out({ error: "no such chapter", end: true }, 404);
      const through = f ? allowedThrough(f, today) + await d.extra(user.id, s.id) : -1;
      const ok = owns(ents, c.book) || (f && g <= through);
      if (!ok) return out({ locked: true, error: "locked", following: !!f, unlock_on: f ? nextDelivery(today, f.weekday) : null, bundle: c.book.bundle || s.bundle,
        buy_next: !!f && g === through + 1, chapter_price_cents: CHAPTER_PRICE_CENTS });
      const ch = await d.indexChapter(ck(c.book), c.idx);
      if (!ch) return out({ error: "chapter missing" }, 500);
      if (f && g > (f.last_read ?? -1)) { try { await d.followUpsert(token, { ...f, last_read: g }); } catch { /* best effort */ } }
      const nx = list[g + 1] || null;
      const nxReady = !!nx && (owns(ents, nx.book) || (!!f && nx.g <= through));
      return out({
        serial: s.id, serial_title: s.title, g, book: { id: c.book.id, title: c.book.title }, title: ch.title, html: ch.html,
        bundle: c.book.bundle || s.bundle, owned: owns(ents, c.book),
        next: nx ? { g: nx.g, title: nx.title, ready: nxReady, unlock_on: f ? nextDelivery(today, f.weekday) : null, can_buy: !nxReady && !!f && nx.g === through + 1 } : null,
        chapter_price_cents: CHAPTER_PRICE_CENTS,
      });
    }
    if (action === "chapter_checkout") {
      // web: $1 Stripe Checkout for the chapter straight after everything this reader can already read
      const s = find(body.serial); if (!s) return out({ error: "unknown serial" }, 404);
      const [f, ents] = await Promise.all([d.followGet(token, user.id, s.id), d.entitlements(token)]);
      if (!f) return out({ error: "not following", message: "Follow this serial first — then you can read ahead one chapter at a time." }, 409);
      const through = allowedThrough(f, today) + await d.extra(user.id, s.id);
      const g = through + 1;
      const list = await walk(d, s, g + 1);
      const c = list[g];
      if (!c) return out({ error: "end", message: "You're all caught up — there's no next chapter yet." }, 409);
      if (owns(ents, c.book)) return out({ error: "owned", g, message: "You already own that chapter." }, 409);
      const email = await d.userEmail(user.id);
      const form = new URLSearchParams();
      form.set("mode", "payment");
      form.set("line_items[0][quantity]", "1");
      form.set("line_items[0][price_data][currency]", "usd");
      form.set("line_items[0][price_data][unit_amount]", String(CHAPTER_PRICE_CENTS));
      form.set("line_items[0][price_data][product_data][name]", `${s.title} — ${c.title}`.slice(0, 200));
      form.set("line_items[0][price_data][product_data][description]", "Read the next chapter now. It stays unlocked, and your weekly chapters carry on from there.");
      form.set("success_url", `${SITE}/app?serial=${encodeURIComponent(s.id)}&read=${g}&purchase=chapter`);
      form.set("cancel_url", `${SITE}/app?serial=${encodeURIComponent(s.id)}`);
      form.set("client_reference_id", user.id);
      if (email) form.set("customer_email", email);
      // the Stripe account is shared with Hapitalist: show readers who they are paying
      form.set("branding_settings[display_name]", "Wannabe Press · Thread Weaver");
      form.set("branding_settings[button_color]", "#b8862a");
      form.set("branding_settings[icon][type]", "url");
      form.set("branding_settings[icon][url]", SITE + "/icons/icon-192.png");
      for (const [k, v] of Object.entries({ kind: "chapter", app: "threadweaver", user_id: user.id, serial: s.id, g: String(g), chapter: c.title.slice(0, 200) })) {
        form.set(`metadata[${k}]`, v); form.set(`payment_intent_data[metadata][${k}]`, v);
      }
      let r = await d.stripeSession(form);
      if (!r.url && /branding/i.test(r.error || "")) {
        // never lose a sale over the page's look: if Stripe refuses the branding, sell without it
        for (const k of [...form.keys()].filter((k) => k.startsWith("branding_settings"))) form.delete(k);
        r = await d.stripeSession(form);
      }
      if (!r.url) return out({ error: "payments unavailable", detail: r.error }, 502);
      return out({ url: r.url, g, title: c.title });
    }
    return out({ error: "unknown action" }, 400);
  } catch (e) {
    return out({ error: "server", detail: String((e as Error)?.message || e) }, 500);
  }
}

Deno.serve(handle);
