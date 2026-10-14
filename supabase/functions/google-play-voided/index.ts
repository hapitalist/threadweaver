import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// google-play-voided (Thread Weaver's own project, 14 Oct 2026). Google Play does not tell us about refunds,
// so this reads Play's Voided Purchases list (refunds, chargebacks, revocations - last 30 days) every hour
// and takes back what each voided purchase gave:
//   - a $0.99 serial chapter (threadweaver_chapter): voids that one credit (serial_chapter_purchases ref google:<token>)
//   - a series / Everything bundle: removes the purchases row that token created
// Every handled token is written to play_voided (with the removed rows) BEFORE anything is changed, so a
// token is handled once and anything taken back can be looked up and restored by hand.
// Called by pg_cron with x-admin-secret; POST {"dry_run":true} lists what it would do without changing anything.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENV_EMAIL = (Deno.env.get("GOOGLE_PLAY_SA_EMAIL") || "").trim();
const ENV_KEY = Deno.env.get("GOOGLE_PLAY_SA_PRIVATE_KEY") || "";
const PACKAGE = Deno.env.get("TW_PLAY_PACKAGE_NAME") || "com.russellnohelty.threadweaver";
const WINDOW_MS = 30 * 24 * 3600 * 1000;

function j(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } }); }
function normalizeKey(raw: string): string {
  let k = (raw || "").trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) k = k.slice(1, -1);
  k = k.replace(/\\n/g, "\n").trim();
  if (k.includes("BEGIN PRIVATE KEY")) return k;
  const compact = k.replace(/\s+/g, "");
  if (compact.length > 400 && /^[A-Za-z0-9+/=]+$/.test(compact)) {
    const lines = compact.match(/.{1,64}/g) || [];
    return "-----BEGIN PRIVATE KEY-----\n" + lines.join("\n") + "\n-----END PRIVATE KEY-----";
  }
  return k;
}
async function loadCreds(admin: any): Promise<{ email: string; key: string }> {
  if (ENV_EMAIL && ENV_KEY.trim()) return { email: ENV_EMAIL, key: normalizeKey(ENV_KEY) };
  const { data } = await admin.rpc("tw_get_play_sa");
  const row = Array.isArray(data) ? data[0] : data;
  return { email: ((row?.sa_email as string) || ENV_EMAIL || "").trim(), key: normalizeKey((row?.sa_key as string) || ENV_KEY || "") };
}
function str2ab(s: string): Uint8Array { return new TextEncoder().encode(s); }
function b64url(bytes: Uint8Array): string { let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const bin = atob(body); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
async function getAccessToken(email: string, pem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(str2ab(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64url(str2ab(JSON.stringify({ iss: email, scope: "https://www.googleapis.com/auth/androidpublisher", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })));
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, str2ab(`${header}.${claim}`)));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claim}.${b64url(sig)}` }),
  });
  const tok = await res.json();
  if (!tok.access_token) throw new Error("oauth_failed: " + JSON.stringify(tok).slice(0, 300));
  return tok.access_token;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return j({ ok: false, error: "POST only" }, 405);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const given = req.headers.get("x-admin-secret") || "";
  const { data: want } = await admin.rpc("read_secret", { secret_name: "admin-secret" });
  if (!given || typeof want !== "string" || given !== want.trim()) return j({ ok: false, error: "forbidden" }, 403);
  let body: any = {}; try { body = await req.json(); } catch { /* empty body is fine */ }
  const dry = !!body?.dry_run;

  // QA (admin only): {"simulate":[{purchaseToken,...}]} is handled as if Google had listed it; tokens must start "twsim-"
  const sim = Array.isArray(body?.simulate) ? body.simulate.filter((v: any) => /^twsim-/.test(String(v?.purchaseToken || ""))) : null;
  const voided: any[] = sim ? sim : [];
  let token = "";
  if (!sim) {
    const creds = await loadCreds(admin);
    if (!creds.email || !creds.key.includes("BEGIN PRIVATE KEY")) return j({ ok: false, error: "play_credentials_missing" }, 500);
    try { token = await getAccessToken(creds.email, creds.key); } catch (e) { return j({ ok: false, error: String((e as Error).message) }, 500); }
  }

  // every voided one-time purchase in the window (Play keeps 30 days)
  let page = "";
  for (let n = 0; !sim && n < 50; n++) {
    const u = new URL(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/purchases/voidedpurchases`);
    u.searchParams.set("startTime", String(Date.now() - WINDOW_MS + 60_000));
    u.searchParams.set("maxResults", "1000");
    if (page) u.searchParams.set("token", page);
    const r = await fetch(u, { headers: { Authorization: "Bearer " + token } });
    const t = await r.text();
    if (!r.ok) return j({ ok: false, error: "google_api " + r.status, detail: t.slice(0, 500) }, 502);
    const d = t ? JSON.parse(t) : {};
    voided.push(...(d.voidedPurchases || []));
    page = d.tokenPagination?.nextPageToken || "";
    if (!page) break;
  }

  const tokens = voided.map((v) => String(v.purchaseToken || "")).filter(Boolean);
  const seen = new Set<string>();
  for (let i = 0; i < tokens.length; i += 200) {
    const { data } = await admin.from("play_voided").select("purchase_token").in("purchase_token", tokens.slice(i, i + 200));
    for (const r of data || []) seen.add(r.purchase_token);
  }
  const fresh = voided.filter((v) => v.purchaseToken && !seen.has(String(v.purchaseToken)));

  const handled: any[] = [];
  for (const v of fresh) {
    const tok = String(v.purchaseToken), ref = "google:" + tok;
    const [{ data: credits }, { data: rows }] = await Promise.all([
      admin.from("serial_chapter_purchases").select("id, user_id, serial_id").eq("ref", ref).is("revoked_at", null),
      admin.from("purchases").select("*").eq("stripe_session_id", ref),
    ]);
    const item = { order_id: v.orderId || null, chapters: (credits || []).length, bundles: (rows || []).map((r: any) => r.bundle) };
    if (dry) { handled.push(item); continue; }
    // record first: a token is acted on once, and what was removed can be restored
    const { error: logErr } = await admin.from("play_voided").insert({
      purchase_token: tok, order_id: v.orderId || null,
      voided_at: v.voidedTimeMillis ? new Date(Number(v.voidedTimeMillis)).toISOString() : null,
      voided_source: v.voidedSource ?? null, voided_reason: v.voidedReason ?? null,
      chapter_credits_voided: (credits || []).length, bundles_revoked: rows || [],
    });
    if (logErr) { handled.push({ ...item, error: "log: " + logErr.message }); continue; }
    if ((credits || []).length) await admin.from("serial_chapter_purchases").update({ revoked_at: new Date().toISOString() }).eq("ref", ref).is("revoked_at", null);
    for (const r of rows || []) await admin.from("purchases").delete().eq("user_id", r.user_id).eq("bundle", r.bundle).eq("stripe_session_id", ref);
    handled.push(item);
  }
  const acted = handled.filter((h) => h.chapters || h.bundles.length);
  if (acted.length) console.log(JSON.stringify({ tw: "play_voided", dry, acted }));
  return j({ ok: true, dry, voided_in_window: voided.length, new: fresh.length, took_back: acted });
});
