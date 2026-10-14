// checkout (Thread Weaver's own project, 13 Oct 2026): create a Stripe Checkout session for a
// logged-in user buying one bundle. Same rules as before: return_url allowlisted, CORS locked,
// bundle validated, price read server-side from lib_bundles, Deal Week half-off on Everything.
// The Stripe key is read from this project's vault (stripe-secret-key).
// 14 Oct 2026: the Stripe account is shared with Hapitalist, so the checkout page is branded
// "Wannabe Press · Thread Weaver" per session (branding_settings) instead of the account name.
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
let _stripe: Stripe | null = null;
async function stripeClient(admin: any): Promise<Stripe> {
  if (_stripe) return _stripe;
  const { data } = await admin.rpc("read_secret", { secret_name: "stripe-secret-key" });
  if (typeof data !== "string" || !data) throw new Error("stripe key unavailable");
  _stripe = new Stripe(data.trim(), { apiVersion: "2024-12-18.acacia" });
  return _stripe;
}

const ALLOWED_ORIGINS = [
  "https://thread.wannabepress.com",
  "https://quest-rpg-store.netlify.app",
  "capacitor://localhost", "http://localhost", "https://localhost",
  "app://localhost", "ionic://localhost", "null",
];
const ALLOWED_RETURN_PREFIXES = [
  "https://thread.wannabepress.com",
  "https://quest-rpg-store.netlify.app",
  "http://localhost", "https://localhost", "capacitor://localhost",
];
const DEFAULT_RETURN = "https://thread.wannabepress.com/app.html";
const BRANDING = {
  display_name: "Wannabe Press · Thread Weaver",
  button_color: "#b8862a",
  icon: { type: "url", url: "https://thread.wannabepress.com/icons/icon-192.png" },
};

const DEAL_WINDOWS: Array<[number, number]> = [
  [Date.UTC(2026, 10, 23, 14), Date.UTC(2026, 10, 28, 14)],
  [Date.UTC(2026, 10, 30, 14), Date.UTC(2026, 11, 1, 14)],
];
const DEAL_BUNDLE = "unlock_all";
const DEAL_PRICE_CENTS = 4999;
function dealWeekLive(now = Date.now()): boolean {
  return DEAL_WINDOWS.some(([a, b]) => now >= a && now < b);
}

function corsFor(origin: string | null) {
  const o = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": o, "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(b: unknown, s: number, origin: string | null) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsFor(origin), "Content-Type": "application/json" } });
}
function safeReturn(u: string): string {
  if (!u) return DEFAULT_RETURN;
  try {
    const url = new URL(u);
    if (url.search || url.hash) return DEFAULT_RETURN;
    if (ALLOWED_RETURN_PREFIXES.some((p) => u.startsWith(p))) return u;
  } catch { /* not a URL */ }
  return DEFAULT_RETURN;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(origin) });
  if (req.method !== "POST") return json({ error: "POST only" }, 405, origin);

  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
  if (!token) return json({ error: "not logged in" }, 401, origin);
  const asUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: u } = await asUser.auth.getUser();
  const user = u?.user;
  if (!user) return json({ error: "not logged in" }, 401, origin);

  let body: any; try { body = await req.json(); } catch { return json({ error: "bad json" }, 400, origin); }
  const bundle = (body.bundle || "").toString().trim();
  if (!/^[a-z_]{1,40}$/.test(bundle)) return json({ error: "bad bundle" }, 400, origin);
  const returnUrl = safeReturn((body.return_url || "").toString().trim());

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: brow } = await admin.from("lib_bundles")
    .select("label, price_cents").eq("bundle", bundle).maybeSingle();
  if (!brow || !brow.price_cents) return json({ error: "unknown bundle" }, 404, origin);

  const { data: owned } = await admin.from("purchases")
    .select("id").eq("user_id", user.id).in("bundle", [bundle, "unlock_all"]).limit(1).maybeSingle();
  if (owned) return json({ error: "already owned", bundle }, 409, origin);

  const deal = bundle === DEAL_BUNDLE && dealWeekLive();
  const unitAmount = deal ? DEAL_PRICE_CENTS : brow.price_cents;
  const label = deal ? `${brow.label} (Deal Week, half off)` : brow.label;
  const metadata: Record<string, string> = { user_id: user.id, bundle, app: "threadweaver" };
  if (deal) { metadata.campaign = "deal-week-2026"; metadata.regular_price_cents = String(brow.price_cents); }

  let stripe: Stripe;
  try { stripe = await stripeClient(admin); } catch (e) { return json({ error: "payments unavailable" }, 500, origin); }
  const params: any = {
    mode: "payment",
    line_items: [{
      price_data: { currency: "usd", product_data: { name: label }, unit_amount: unitAmount },
      quantity: 1,
    }],
    success_url: `${returnUrl}?purchase=success`,
    cancel_url: `${returnUrl}?purchase=cancel`,
    client_reference_id: user.id,
    customer_email: user.email || undefined,
    metadata,
  };
  let session: any;
  try {
    session = await stripe.checkout.sessions.create({ ...params, branding_settings: BRANDING });
  } catch (e: any) {
    // never lose a sale over the page's look: if Stripe refuses the branding, sell without it
    if (!/branding/i.test(String(e?.message || e?.raw?.param || ""))) throw e;
    console.error("branding refused, selling without it:", e?.message);
    session = await stripe.checkout.sessions.create(params);
  }

  return json({ url: session.url }, 200, origin);
});
