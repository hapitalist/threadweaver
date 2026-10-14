import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// play-products (Thread Weaver's own project, 14 Oct 2026). Admin-only (x-admin-secret): reads and creates
// Google Play in-app products with the app's own Play service account, so nobody has to click through
// the Play Console. POST {action:"list"} | {action:"get", sku} | {action:"create", sku, title, description, usd_micros}
// | {action:"raw", method, path, body} (androidpublisher v3 path under applications/<package>/, for one-off fixes).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PACKAGE = Deno.env.get("TW_PLAY_PACKAGE_NAME") || "com.russellnohelty.threadweaver";
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;

function j(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } }); }
function normalizeKey(raw: string): string {
  let k = (raw || "").trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) k = k.slice(1, -1);
  k = k.replace(/\\n/g, "\n").trim();
  if (k.includes("BEGIN PRIVATE KEY")) return k;
  const compact = k.replace(/\s+/g, "");
  if (compact.length > 400 && /^[A-Za-z0-9+/=]+$/.test(compact)) return "-----BEGIN PRIVATE KEY-----\n" + (compact.match(/.{1,64}/g) || []).join("\n") + "\n-----END PRIVATE KEY-----";
  return k;
}
function str2ab(s: string): Uint8Array { return new TextEncoder().encode(s); }
function b64url(bytes: Uint8Array): string { let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const bin = atob(body); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out.buffer;
}
async function accessToken(admin: any): Promise<string> {
  const { data } = await admin.rpc("tw_get_play_sa");
  const row = Array.isArray(data) ? data[0] : data;
  const email = String(row?.sa_email || "").trim(), pem = normalizeKey(String(row?.sa_key || ""));
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(str2ab(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64url(str2ab(JSON.stringify({ iss: email, scope: "https://www.googleapis.com/auth/androidpublisher", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })));
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, str2ab(`${header}.${claim}`)));
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claim}.${b64url(sig)}` }) });
  const t = await r.json(); if (!t.access_token) throw new Error("oauth_failed: " + JSON.stringify(t).slice(0, 300)); return t.access_token;
}
async function call(tok: string, method: string, url: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let d: any = t; try { d = t ? JSON.parse(t) : null; } catch { /* text */ }
  return { status: r.status, data: d };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return j({ ok: false, error: "POST only" }, 405);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: want } = await admin.rpc("read_secret", { secret_name: "admin-secret" });
  if (typeof want !== "string" || (req.headers.get("x-admin-secret") || "") !== want.trim()) return j({ ok: false, error: "forbidden" }, 403);
  let b: any = {}; try { b = await req.json(); } catch { /**/ }
  let tok: string; try { tok = await accessToken(admin); } catch (e) { return j({ ok: false, error: String((e as Error).message) }, 500); }
  const a = String(b.action || "list");
  if (a === "list") {
    const [legacy, otp] = await Promise.all([call(tok, "GET", `${API}/inappproducts?maxResults=100`), call(tok, "GET", `${API}/oneTimeProducts?pageSize=100`)]);
    return j({ ok: true, inappproducts: legacy, oneTimeProducts: otp });
  }
  if (a === "get") {
    const sku = encodeURIComponent(String(b.sku || ""));
    const [legacy, otp] = await Promise.all([call(tok, "GET", `${API}/inappproducts/${sku}`), call(tok, "GET", `${API}/oneTimeProducts/${sku}`)]);
    return j({ ok: true, inappproduct: legacy, oneTimeProduct: otp });
  }
  if (a === "create") {
    const sku = String(b.sku || ""); const micros = String(b.usd_micros || "");
    if (!/^[a-z0-9][a-z0-9_.]{0,138}$/.test(sku) || !/^\d+$/.test(micros)) return j({ ok: false, error: "bad sku or price" }, 400);
    const product = {
      packageName: PACKAGE, sku, status: "active", purchaseType: "managedUser",
      defaultPrice: { priceMicros: micros, currency: "USD" },
      listings: { "en-US": { title: String(b.title || sku).slice(0, 55), description: String(b.description || "").slice(0, 200) } },
      defaultLanguage: "en-US",
    };
    const r = await call(tok, "POST", `${API}/inappproducts?autoConvertMissingPrices=true`, product);
    return j({ ok: r.status < 300, created: r });
  }
  if (a === "create_otp") {
    // Google's current one-time product API (the old inappproducts API is closed to this app):
    // convert the US price to every region, create the product (one "buy" option, legacy-compatible so the
    // app's billing library sees it), then activate that option. {dry_run:true} stops after the conversion.
    const sku = String(b.sku || ""); const cents = Number(b.usd_cents);
    if (!/^[a-z0-9][a-z0-9_.]{0,138}$/.test(sku) || !Number.isInteger(cents) || cents < 1) return j({ ok: false, error: "bad sku or price" }, 400);
    const usd = { currencyCode: "USD", units: String(Math.floor(cents / 100)), nanos: (cents % 100) * 10_000_000 };
    const conv = await call(tok, "POST", `${API}/pricing:convertRegionPrices`, { price: usd });
    if (conv.status >= 300) return j({ ok: false, step: "convert", conv });
    const regions = Object.values(conv.data.convertedRegionPrices || {}).map((r: any) => ({
      regionCode: r.regionCode, price: r.regionCode === "US" ? usd : r.price, availability: "AVAILABLE",
    }));
    const version = conv.data.regionVersion?.version;
    const product = {
      packageName: PACKAGE, productId: sku,
      listings: [{ languageCode: "en-US", title: String(b.title || sku).slice(0, 55), description: String(b.description || "").slice(0, 200) }],
      purchaseOptions: [{
        purchaseOptionId: "buy",
        buyOption: { legacyCompatible: true, multiQuantityEnabled: false },
        regionalPricingAndAvailabilityConfigs: regions,
        newRegionsConfig: { usdPrice: conv.data.convertedOtherRegionsPrice?.usdPrice || usd, eurPrice: conv.data.convertedOtherRegionsPrice?.eurPrice, availability: "AVAILABLE" },
      }],
    };
    if (b.dry_run) return j({ ok: true, dry_run: true, version, regions: regions.length, us: regions.find((r) => r.regionCode === "US"), sample: regions.slice(0, 3), other: conv.data.convertedOtherRegionsPrice });
    const qs = `allowMissing=true&regionsVersion.version=${encodeURIComponent(version)}&updateMask=listings,purchaseOptions`;
    // Google routes writes at "onetimeproducts" and reads at "oneTimeProducts" (each 404s on the other spelling)
    const put = await call(tok, "PATCH", `${API}/onetimeproducts/${encodeURIComponent(sku)}?${qs}`, product);
    if (put.status >= 300) return j({ ok: false, step: "create", put });
    const actBody = { requests: [{ activatePurchaseOptionRequest: { packageName: PACKAGE, productId: sku, purchaseOptionId: "buy" } }] };
    let act = await call(tok, "POST", `${API}/oneTimeProducts/${encodeURIComponent(sku)}/purchaseOptions:batchUpdateStates`, actBody);
    if (act.status === 404 && typeof act.data === "string") act = await call(tok, "POST", `${API}/onetimeproducts/${encodeURIComponent(sku)}/purchaseOptions:batchUpdateStates`, actBody);
    const got = await call(tok, "GET", `${API}/oneTimeProducts/${encodeURIComponent(sku)}`);
    const opt = got.data?.purchaseOptions?.[0] || {};
    return j({ ok: act.status < 300 && opt.state === "ACTIVE", sku, version, regions: regions.length, state: opt.state,
      us_price: (opt.regionalPricingAndAvailabilityConfigs || []).find((r: any) => r.regionCode === "US")?.price,
      title: got.data?.listings?.[0]?.title, activate_status: act.status, activate_error: act.status >= 300 ? act.data : undefined });
  }
  if (a === "raw") {
    const path = String(b.path || "");
    if (!/^[A-Za-z0-9_./:?=&%-]*$/.test(path)) return j({ ok: false, error: "bad path" }, 400);
    return j({ ok: true, result: await call(tok, String(b.method || "GET").toUpperCase(), `${API}/${path}`, b.body) });
  }
  return j({ ok: false, error: "unknown action" }, 400);
});
