// apple-iap-verify (Thread Weaver's own project, 13 Oct 2026). Validates an Apple In-App Purchase
// receipt and writes the entitlement into `purchases` (the same table Stripe purchases use), plus
// originalTransactionId -> user_id in apple_iap_receipts so a refund notification can revoke it.
// user_id comes from the VERIFIED token, never the body. Same logic as v4 in the Hapitalist project.
// The App Store shared secret is read from the APPLE_SHARED_SECRET function secret, or from this
// project's vault as 'apple-shared-secret'.
// 14 Oct 2026: kind "chapter" — the consumable com.russellnohelty.threadweaver.chapter ($0.99) reads the
// next chapter of a serial. The exact transaction_id must be in the verified receipt; it credits one
// chapter on body.serial (serial_chapter_purchases, ref apple:<transaction_id>, so it can never count twice).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import postgres from "npm:postgres@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;
const DB_URL       = Deno.env.get("SUPABASE_DB_URL")!;
let APPLE_SHARED_SECRET = Deno.env.get("APPLE_SHARED_SECRET") || "";
async function sharedSecret(): Promise<string> {
  if (APPLE_SHARED_SECRET) return APPLE_SHARED_SECRET;
  try {
    const sql = postgres(DB_URL, { max: 1, prepare: false });
    const r = await sql`select decrypted_secret from vault.decrypted_secrets where name = 'apple-shared-secret' limit 1`;
    await sql.end({ timeout: 5 });
    if (r.length) APPLE_SHARED_SECRET = String(r[0].decrypted_secret).trim();
  } catch { /* stays empty */ }
  return APPLE_SHARED_SECRET;
}

const PRODUCT_PREFIXES = ["com.russellnohelty.threadweaver.", "com.russellnohelty.questgirls."];
const APPLE_ID_ALIASES: Record<string, string> = { "all_games1": "all_games", "godsverse_series1": "godsverse_series" };
const CHAPTER_PRODUCT = "com.russellnohelty.threadweaver.chapter";
const APPLE_PROD = "https://buy.itunes.apple.com/verifyReceipt";
const APPLE_SANDBOX = "https://sandbox.itunes.apple.com/verifyReceipt";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
}
function bundleFromProductId(pid: string): string | null {
  for (const prefix of PRODUCT_PREFIXES) {
    if (pid.startsWith(prefix)) { const raw = pid.slice(prefix.length); return APPLE_ID_ALIASES[raw] || raw; }
  }
  return null;
}
async function verifyWithApple(receipt: string, secret: string) {
  const payload = JSON.stringify({ "receipt-data": receipt, "password": secret, "exclude-old-transactions": true });
  let r = await fetch(APPLE_PROD, { method: "POST", body: payload });
  let data = await r.json();
  let environment = "Production";
  if (data && data.status === 21007) {
    r = await fetch(APPLE_SANDBOX, { method: "POST", body: payload });
    data = await r.json();
    environment = "Sandbox";
  }
  return { data, environment };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "not logged in" }, 401);
    const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: u, error: uerr } = await asUser.auth.getUser();
    if (uerr || !u?.user) return json({ error: "invalid session" }, 401);
    const user_id = u.user.id;

    let body: any;
    try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    const receipt = (body.receipt || "").toString();
    if (!receipt || receipt.length < 20) return json({ error: "missing receipt" }, 400);
    const secret = await sharedSecret();
    if (!secret) return json({ error: "server not configured: APPLE_SHARED_SECRET missing" }, 500);

    const { data: appleData, environment } = await verifyWithApple(receipt, secret);
    if (!appleData || appleData.status !== 0) return json({ error: "apple rejected receipt", apple_status: appleData?.status ?? "none" }, 400);

    const inApp = (appleData.receipt && appleData.receipt.in_app) || appleData.latest_receipt_info || [];
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // ---- one serial chapter (consumable) ----
    if (String(body.kind || "") === "chapter" || String(body.product_id || "") === CHAPTER_PRODUCT) {
      const serial = String(body.serial || "");
      const txId = String(body.transaction_id || "");
      if (!/^[a-z0-9][a-z0-9_-]{0,120}$/.test(serial)) return json({ error: "bad serial" }, 400);
      if (!/^\d{5,40}$/.test(txId)) return json({ error: "bad transaction" }, 400);
      const all = [...inApp, ...(appleData.latest_receipt_info || [])];
      const hit = all.find((it: any) => it && String(it.transaction_id || "") === txId && String(it.product_id || "") === CHAPTER_PRODUCT && !it.cancellation_date && !it.cancellation_date_ms);
      if (!hit) return json({ error: "transaction not in receipt" }, 400);
      const { data: credited, error } = await admin.rpc("tw_credit_chapter", { p_user: user_id, p_serial: serial, p_source: "apple", p_ref: "apple:" + txId, p_cents: 99 });
      if (error) return json({ error: "credit failed: " + error.message }, 500);
      return json({ ok: true, kind: "chapter", serial, credited: credited === true, already: credited !== true, environment });
    }

    type Tx = { product_id: string; original_transaction_id: string; transaction_id: string };
    const txs = new Map<string, Tx>();
    for (const item of inApp) {
      if (!item || !item.product_id) continue;
      if (item.cancellation_date || item.cancellation_date_ms) continue;
      const pid = item.product_id.toString();
      if (pid === CHAPTER_PRODUCT) continue;   // consumables are credited one by one above, never as a bundle
      const otid = (item.original_transaction_id || item.transaction_id || "").toString();
      txs.set(pid, { product_id: pid, original_transaction_id: otid, transaction_id: (item.transaction_id || "").toString() });
    }
    if (!txs.size) return json({ error: "no purchases in receipt" }, 400);

    const { data: catalog } = await admin.from("lib_bundles").select("bundle");
    const validBundles = new Set((catalog || []).map((b: any) => b.bundle));
    const granted: string[] = []; const unmatched: string[] = [];
    for (const tx of txs.values()) {
      const bundle = bundleFromProductId(tx.product_id);
      if (!bundle || !validBundles.has(bundle)) { unmatched.push(tx.product_id); continue; }
      const { error: insErr } = await admin.from("purchases")
        .upsert({ user_id, bundle, stripe_session_id: "apple:" + tx.product_id }, { onConflict: "user_id,bundle", ignoreDuplicates: true });
      if (insErr) continue;
      granted.push(bundle);
      if (tx.original_transaction_id) {
        const { error: recErr } = await admin.from("apple_iap_receipts").upsert({
          original_transaction_id: tx.original_transaction_id, transaction_id: tx.transaction_id || null,
          product_id: tx.product_id, bundle, user_id, environment, revoked_at: null,
        }, { onConflict: "original_transaction_id,user_id" });
        if (recErr) console.error("apple_iap_receipts upsert failed", recErr.message);
      }
    }
    if (!granted.length) return json({ error: "no matching bundles to grant", productIds: [...txs.keys()], unmatched }, 400);
    return json({ ok: true, granted });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
