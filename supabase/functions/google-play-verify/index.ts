import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// google-play-verify (Thread Weaver's own project, 13 Oct 2026; same logic as v6 in the Hapitalist project).
// Called by the Android app after a Google Play Billing purchase with purchase_token + product_id.
// Validates the token against the Play Developer API (one-time products), then writes the
// entitlement into `purchases`. user_id comes from the VERIFIED JWT. Credentials: env, else vault
// via public.tw_get_play_sa(). Product-ID scheme: "threadweaver_" + bundle.
// 14 Oct 2026: "threadweaver_chapter" (consumable) reads the next chapter of a serial: a purchased token
// credits one chapter on body.serial (serial_chapter_purchases, ref google:<token>, never twice).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const ENV_EMAIL = (Deno.env.get("GOOGLE_PLAY_SA_EMAIL") || "").trim();
const ENV_KEY = Deno.env.get("GOOGLE_PLAY_SA_PRIVATE_KEY") || "";
const PACKAGE = Deno.env.get("TW_PLAY_PACKAGE_NAME") || "com.russellnohelty.threadweaver";
const PRODUCT_PREFIX = "threadweaver_";
const CHAPTER_PRODUCT = "threadweaver_chapter";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function j(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}
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
async function loadCreds(admin: any): Promise<{ email: string; key: string; source: string }> {
  if (ENV_EMAIL && ENV_KEY.trim()) return { email: ENV_EMAIL, key: normalizeKey(ENV_KEY), source: "env" };
  const { data, error } = await admin.rpc("tw_get_play_sa");
  if (error) return { email: ENV_EMAIL, key: normalizeKey(ENV_KEY), source: "vault_error: " + error.message };
  const row = Array.isArray(data) ? data[0] : data;
  const email = ((row?.sa_email as string) || ENV_EMAIL || "").trim();
  const key = normalizeKey((row?.sa_key as string) || ENV_KEY || "");
  return { email, key, source: "vault" };
}
function str2ab(s: string): Uint8Array { return new TextEncoder().encode(s); }
function b64encode(bytes: Uint8Array): string { let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return btoa(bin); }
function b64url(bytes: Uint8Array): string { return b64encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
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
  const signingInput = `${header}.${claim}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, str2ab(signingInput)));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${signingInput}.${b64url(sig)}` }),
  });
  const tok = await res.json();
  if (!tok.access_token) throw new Error("oauth_failed: " + JSON.stringify(tok));
  return tok.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j({ ok: false, error: "method" }, 405);
  const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
  const { data: ures, error: uerr } = await userClient.auth.getUser();
  if (uerr || !ures?.user) return j({ ok: false, error: "no_user" }, 401);
  const user_id = ures.user.id;

  let body: any;
  try { body = await req.json(); } catch { return j({ ok: false, error: "bad_json" }, 400); }
  const purchaseToken: string = body?.purchase_token || body?.purchaseToken;
  const productId: string = body?.product_id || body?.productId;
  if (!purchaseToken || !productId) return j({ ok: false, error: "missing_params" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const creds = await loadCreds(admin);
  if (!creds.email || !creds.key) return j({ ok: false, error: "server_not_configured", source_checked: creds.source, missing: { GOOGLE_PLAY_SA_EMAIL: !creds.email, GOOGLE_PLAY_SA_PRIVATE_KEY: !creds.key } }, 500);
  if (!creds.key.includes("BEGIN PRIVATE KEY")) return j({ ok: false, error: "private_key_invalid", source: creds.source }, 500);

  if (!productId.startsWith(PRODUCT_PREFIX)) return j({ ok: false, error: "unknown_product", product_id: productId }, 400);
  const isChapter = productId === CHAPTER_PRODUCT;
  const serial = String(body?.serial || "");
  if (isChapter && !/^[a-z0-9][a-z0-9_-]{0,120}$/.test(serial)) return j({ ok: false, error: "bad_serial" }, 400);
  const bundle = productId.slice(PRODUCT_PREFIX.length);
  if (!isChapter) {
    const { data: catalog } = await admin.from("lib_bundles").select("bundle");
    const validBundles = new Set((catalog || []).map((b: any) => b.bundle));
    if (!validBundles.has(bundle)) return j({ ok: false, error: "unknown_bundle", bundle }, 400);
  }

  let token: string;
  try { token = await getAccessToken(creds.email, creds.key); }
  catch (e) { return j({ ok: false, error: "oauth: " + (e as Error).message }, 500); }

  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
  const gres = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (!gres.ok) return j({ ok: false, error: "google_api: " + gres.status, detail: await gres.text() }, 400);
  const purchase = await gres.json();
  if (purchase.purchaseState !== 0) return j({ ok: false, error: "not_purchased", purchase_state: purchase.purchaseState }, 400);

  if (isChapter) {
    const { data: credited, error } = await admin.rpc("tw_credit_chapter", { p_user: user_id, p_serial: serial, p_source: "google", p_ref: "google:" + purchaseToken, p_cents: 99 });
    if (error) return j({ ok: false, error: "credit_failed: " + error.message }, 500);
    return j({ ok: true, kind: "chapter", serial, credited: credited === true, already: credited !== true });
  }

  const { error: insErr } = await admin.from("purchases").upsert({ user_id, bundle, stripe_session_id: "google:" + purchaseToken }, { onConflict: "user_id,bundle", ignoreDuplicates: true });
  if (insErr) return j({ ok: false, error: insErr.message }, 500);
  return j({ ok: true, granted: [bundle], product_id: productId });
});
