// tw-embed (Thread Weaver, 20 Oct 2026, ported from Joy Looper's joy-embed) - link previews for the email editor
// on the Thread Weaver admin email pages (/admin/one-offs.html, /admin/sequences.html).
//
// The editor's bookmark and embed cards ask "what is at this link?". Browsers cannot read other sites' pages (CORS),
// so the question comes here.
//   { url, type?: 'bookmark' }  ->  bookmark: { url, metadata: { url, title, description, author, publisher, thumbnail, icon } }
//                                   embed:    the provider's oEmbed JSON ({ type, html, ... }), or { type: 'bookmark', url,
//                                             metadata } when the link has no player.
//
// Admins only (is_tw_admin: russell@ / help@wannabepress.com). It only fetches public http(s) pages - never localhost,
// private networks or cloud metadata addresses.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const ALLOWED_ORIGINS = new Set(["https://thread.wannabepress.com", "https://main--quest-rpg-store.netlify.app", "https://quest-rpg-store.netlify.app"]);
const UA = "Mozilla/5.0 (compatible; WannabePressBot/1.0; +https://thread.wannabepress.com)";

function cors(req: Request) {
  const o = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(o) ? o : "https://thread.wannabepress.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });
}

const PROVIDERS: Array<[RegExp, string]> = [
  [/^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i, "https://www.youtube.com/oembed?format=json&url="],
  [/^https?:\/\/(www\.|player\.)?vimeo\.com\//i, "https://vimeo.com/api/oembed.json?url="],
  [/^https?:\/\/open\.spotify\.com\//i, "https://open.spotify.com/oembed?url="],
  [/^https?:\/\/(www\.|m\.)?soundcloud\.com\//i, "https://soundcloud.com/oembed?format=json&url="],
  [/^https?:\/\/(www\.)?(twitter|x)\.com\/.+\/status\//i, "https://publish.twitter.com/oembed?url="],
  [/^https?:\/\/(www\.)?tiktok\.com\//i, "https://www.tiktok.com/oembed?url="],
  [/^https?:\/\/codepen\.io\//i, "https://codepen.io/api/oembed?format=json&url="],
  [/^https?:\/\/(www\.)?streamable\.com\//i, "https://api.streamable.com/oembed.json?url="],
  [/^https?:\/\/(www\.)?loom\.com\/share\//i, "https://www.loom.com/v1/oembed?url="],
];

function blockedHost(h: string): boolean {
  h = h.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (h === "metadata.google.internal" || h === "169.254.169.254") return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return true;
  }
  if (h.includes(":")) return true;
  return false;
}
function safeUrl(u: string): URL | null {
  try {
    const url = new URL(u.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (blockedHost(url.hostname)) return null;
    return url;
  } catch { return null; }
}

async function fetchText(url: string, max = 1_500_000): Promise<{ text: string; finalUrl: string; type: string } | null> {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5" },
                               redirect: "follow", signal: AbortSignal.timeout(8000) });
  if (!r.ok || !r.body) return null;
  const final = safeUrl(r.url || url);
  if (!final) return null;
  const reader = r.body.getReader(); const chunks: Uint8Array[] = []; let n = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value); n += value.length;
    if (n > max) { try { await reader.cancel(); } catch { /* */ } break; }
  }
  const buf = new Uint8Array(n); let o = 0; for (const c of chunks) { buf.set(c.subarray(0, Math.min(c.length, n - o)), o); o += c.length; if (o >= n) break; }
  return { text: new TextDecoder().decode(buf), finalUrl: final.toString(), type: r.headers.get("content-type") || "" };
}

function decode(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
          .replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
          .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\s+/g, " ").trim();
}
function metaTags(html: string): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs: Record<string, string> = {};
    for (const a of m[0].matchAll(/([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[a[1].toLowerCase()] = a[3] ?? a[4] ?? a[5] ?? "";
    out.push(attrs);
  }
  return out;
}
function metaOf(tags: Array<Record<string, string>>, ...names: string[]): string | null {
  for (const name of names) {
    const t = tags.find((x) => (x.property || x.name || x.itemprop || "").toLowerCase() === name);
    if (t && t.content) return decode(t.content);
  }
  return null;
}
function linkOf(html: string, base: string, test: (rel: string, type: string) => boolean): string | null {
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (m[0].match(/rel\s*=\s*["']?([^"'>]+)/i)?.[1] || "").toLowerCase();
    const type = (m[0].match(/type\s*=\s*["']?([^"'>]+)/i)?.[1] || "").toLowerCase();
    const href = m[0].match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (href && test(rel, type)) { try { return new URL(decode(href), base).toString(); } catch { /* */ } }
  }
  return null;
}
function absolute(u: string | null, base: string): string | null {
  if (!u) return null;
  try { return new URL(u, base).toString(); } catch { return null; }
}

async function bookmarkFor(url: string) {
  const page = await fetchText(url);
  if (!page) throw new Error("could not read that page");
  const html = page.text; const base = page.finalUrl;
  const tags = metaTags(html);
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = metaOf(tags, "og:title", "twitter:title") || (titleTag ? decode(titleTag) : null);
  if (!title) throw new Error("no title at that link");
  const icon = linkOf(html, base, (rel) => rel.split(/\s+/).includes("apple-touch-icon")) ||
               linkOf(html, base, (rel) => rel.split(/\s+/).includes("icon")) ||
               absolute("/favicon.ico", base);
  return {
    url: base,
    metadata: {
      url: base,
      title,
      description: metaOf(tags, "og:description", "twitter:description", "description"),
      author: metaOf(tags, "author", "article:author", "twitter:creator"),
      publisher: metaOf(tags, "og:site_name", "application-name") || new URL(base).hostname.replace(/^www\./, ""),
      thumbnail: absolute(metaOf(tags, "og:image", "og:image:url", "twitter:image", "twitter:image:src"), base),
      icon,
    },
  };
}

async function oembedFor(url: string) {
  for (const [re, endpoint] of PROVIDERS) {
    if (re.test(url)) {
      const r = await fetch(endpoint + encodeURIComponent(url), { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
      if (r.ok) { const j = await r.json(); if (j && (j.html || j.type === "photo")) return j; }
      break;
    }
  }
  const page = await fetchText(url);
  if (page) {
    const href = linkOf(page.text, page.finalUrl, (rel, type) => rel === "alternate" && type === "application/json+oembed");
    const safe = href ? safeUrl(href) : null;
    if (safe) {
      const r = await fetch(safe.toString(), { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
      if (r.ok) { const j = await r.json(); if (j && (j.html || j.type === "photo")) return j; }
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "POST only" }, 405);
  const auth = req.headers.get("Authorization") || "";
  const sb = createClient(SUPA_URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: isAdmin, error: aerr } = await sb.rpc("is_tw_admin");
  if (aerr || isAdmin !== true) return json(req, { error: "admins only" }, 403);

  let body: { url?: string; type?: string } = {};
  try { body = await req.json(); } catch { /* */ }
  const url = safeUrl(String(body.url || ""));
  if (!url) return json(req, { error: "that is not a link I can open" }, 422);
  try {
    if (body.type === "bookmark") return json(req, await bookmarkFor(url.toString()));
    const o = await oembedFor(url.toString());
    if (o) return json(req, o);
    const b = await bookmarkFor(url.toString());
    return json(req, { type: "bookmark", ...b });
  } catch (e) {
    return json(req, { error: String((e as Error)?.message || e).slice(0, 200) }, 422);
  }
});
