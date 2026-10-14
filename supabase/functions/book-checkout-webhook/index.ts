// book-checkout-webhook (Thread Weaver's own project, 13 Oct 2026). Stripe webhook: grants the
// bundle on a paid checkout, revokes it on a full refund or a dispute. Stripe key and the webhook
// signing secret are read from this project's vault. Same logic as v4 in the Hapitalist project.
// 14 Oct 2026: also $1 serial chapters (metadata.kind = "chapter"): a paid session credits one chapter
// (serial_chapter_purchases, keyed on the session id so a retried webhook can't credit twice); a full
// refund or a dispute voids that credit.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import postgres from "npm:postgres@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DB_URL       = Deno.env.get("SUPABASE_DB_URL")!;
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const serialRe = /^[a-z0-9][a-z0-9_-]{0,120}$/;

let stripe: Stripe | null = null;
let webhookSecret: string | null = null;
let validBundles: Set<string> | null = null;
let initDone = false, initError: string | null = null;
async function init() {
  if (initDone) return; initDone = true;
  try {
    const sql = postgres(DB_URL, { max: 1, prepare: false });
    const rows = await sql`select name, decrypted_secret from vault.decrypted_secrets where name in ('book-checkout-webhook-secret','stripe-secret-key')`;
    const bundles = await sql`select bundle from lib_bundles`;
    await sql.end({ timeout: 5 });
    const get = (n: string) => { const r = rows.find((x: any) => x.name === n); return r ? String(r.decrypted_secret).trim() : null; };
    webhookSecret = get("book-checkout-webhook-secret");
    const key = get("stripe-secret-key");
    if (key) stripe = new Stripe(key, { apiVersion: "2024-12-18.acacia" });
    validBundles = new Set(bundles.map((b: any) => b.bundle));
  } catch (e) { initError = (e as Error).message; initDone = false; }
}

async function revokeForCharge(charge: any, reason: string) {
  const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!pi) return { ok: false, reason: "no payment_intent" };
  let sessions: any;
  try { sessions = await stripe!.checkout.sessions.list({ payment_intent: pi, limit: 5 }); }
  catch (e) { return { ok: false, reason: "session lookup failed: " + (e as Error).message }; }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  let revoked = 0;
  for (const s of (sessions?.data || [])) {
    const user_id = (s.metadata?.user_id || "").toString();
    if (!uuidRe.test(user_id)) continue;
    if (s.metadata?.kind === "chapter") {
      const { data, error } = await admin.from("serial_chapter_purchases").update({ revoked_at: new Date().toISOString() })
        .eq("ref", "stripe:" + s.id).is("revoked_at", null).select("id");
      if (!error && data && data.length) revoked++;
      console.log(JSON.stringify({ event: reason, kind: "chapter", user_id, serial: s.metadata?.serial, revoked: !error }));
      continue;
    }
    const bundle  = (s.metadata?.bundle  || "").toString();
    if (!validBundles || !validBundles.has(bundle)) continue;
    const { error } = await admin.from("purchases").delete().eq("user_id", user_id).eq("bundle", bundle);
    if (!error) revoked++;
    console.log(JSON.stringify({ event: reason, user_id, bundle, revoked: !error }));
  }
  return { ok: true, revoked };
}

Deno.serve(async (req) => {
  const hdr = { "Content-Type": "application/json" };
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: hdr });
  await init();
  if (initError || !webhookSecret || !stripe) {
    return new Response(JSON.stringify({ error: "init", detail: initError ?? (!webhookSecret ? "no webhook secret" : "no stripe key") }), { status: 500, headers: hdr });
  }
  const bodyText = await req.text();
  const sig = req.headers.get("stripe-signature");
  let event: Stripe.Event;
  try { event = await stripe.webhooks.constructEventAsync(bodyText, sig!, webhookSecret); }
  catch (e) { return new Response(JSON.stringify({ error: "sig", detail: (e as Error).message }), { status: 400, headers: hdr }); }

  if (event.type === "checkout.session.completed") {
    const s = event.data.object as any;
    if (s.payment_status === "paid" || s.status === "complete") {
      const user_id = (s.metadata?.user_id || "").toString();
      const admin = createClient(SUPABASE_URL, SERVICE_KEY);
      if (s.metadata?.kind === "chapter") {
        const serial = (s.metadata?.serial || "").toString();
        if (uuidRe.test(user_id) && serialRe.test(serial) && s.metadata?.app === "threadweaver") {
          const { data, error } = await admin.rpc("tw_credit_chapter", { p_user: user_id, p_serial: serial, p_source: "stripe", p_ref: "stripe:" + s.id, p_cents: s.amount_total ?? null });
          console.log(JSON.stringify({ event: "chapter.paid", user_id, serial, credited: data === true, error: error?.message ?? null }));
          if (error) return new Response(JSON.stringify({ error: "credit failed" }), { status: 500, headers: hdr });   // Stripe retries
        }
        return new Response(JSON.stringify({ received: true }), { status: 200, headers: hdr });
      }
      const bundle  = (s.metadata?.bundle || "").toString();
      if (uuidRe.test(user_id) && validBundles && validBundles.has(bundle)) {
        // Sessions from the Hapitalist-side checkout can name users who don't exist here; that insert simply fails.
        await admin.from("purchases").upsert({ user_id, bundle, stripe_session_id: s.id }, { onConflict: "user_id,bundle", ignoreDuplicates: true });
      }
    }
  } else if (event.type === "charge.refunded") {
    const c = event.data.object as any;
    if (typeof c.amount === "number" && typeof c.amount_refunded === "number" && c.amount_refunded >= c.amount) {
      await revokeForCharge(c, "charge.refunded");
    }
  } else if (event.type === "charge.dispute.created") {
    const d = event.data.object as any;
    const chargeId = typeof d.charge === "string" ? d.charge : d.charge?.id;
    if (chargeId) {
      try { const charge = await stripe.charges.retrieve(chargeId); await revokeForCharge(charge, "charge.dispute.created"); }
      catch (e) { console.error("dispute charge fetch failed", (e as Error).message); }
    }
  }
  return new Response(JSON.stringify({ received: true }), { status: 200, headers: hdr });
});
