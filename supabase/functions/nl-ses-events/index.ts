// nl-ses-events (Thread Weaver, 20 Oct 2026, ported from Joy Looper) - Amazon SES tells Thread Weaver what happened to each email it sent.
// Configuration set "wannabepress-email" publishes to SNS topic "wannabepress-email-events", which posts here. Covers one-offs,
// sequences and the weekly serial chapter emails (SES tag kind=serial_chapter).
//
// 1 Oct 2026. Russell is leaving Ghost; the newsletter goes out from the app through his own Amazon SES
// account (configuration set "hapitalist-newsletter"). SES publishes bounces, spam complaints, opens,
// clicks, rejects and rendering failures to the SNS topic "hapitalist-newsletter-events", and SNS posts
// each one here. A permanent bounce or a complaint takes that person off the newsletter at once
// (public.nl_record_event), which is what keeps the account under SES's bounce and complaint limits.
//
// Nothing is believed without checking: every message must be signed by Amazon SNS (certificate fetched
// only from sns.<region>.amazonaws.com) and come from the one topic this app created. Anything else is
// refused with 403 and changes nothing.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createVerify } from "node:crypto";

const TOPIC = "arn:aws:sns:us-east-1:955239075464:wannabepress-email-events";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const certs = new Map<string, string>();

function okCertUrl(u: string) {
  try { const x = new URL(u); return x.protocol === "https:" && /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(x.hostname) && x.pathname.endsWith(".pem"); }
  catch { return false; }
}
function stringToSign(m: any): string {
  const keys = m.Type === "Notification"
    ? ["Message", "MessageId", ...(m.Subject !== undefined && m.Subject !== null ? ["Subject"] : []), "Timestamp", "TopicArn", "Type"]
    : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
  return keys.map((k) => `${k}\n${m[k]}\n`).join("");
}
async function verified(m: any): Promise<boolean> {
  if (!m || typeof m !== "object" || !okCertUrl(String(m.SigningCertURL || "")) || !m.Signature) return false;
  let pem = certs.get(m.SigningCertURL);
  if (!pem) {
    const r = await fetch(m.SigningCertURL, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return false;
    pem = await r.text();
    if (!pem.includes("BEGIN CERTIFICATE")) return false;
    certs.set(m.SigningCertURL, pem);
  }
  const algo = String(m.SignatureVersion) === "2" ? "RSA-SHA256" : "RSA-SHA1";
  try {
    const v = createVerify(algo);
    v.update(stringToSign(m), "utf8");
    return v.verify(pem, m.Signature, "base64");
  } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  let m: any;
  try { m = JSON.parse(await req.text()); } catch { return new Response("bad body", { status: 400 }); }
  if (m?.TopicArn !== TOPIC) return new Response("wrong topic", { status: 403 });
  if (!(await verified(m))) return new Response("bad signature", { status: 403 });

  if (m.Type === "SubscriptionConfirmation") {
    const u = new URL(String(m.SubscribeURL));
    if (u.protocol !== "https:" || !/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(u.hostname)) return new Response("bad subscribe url", { status: 403 });
    const r = await fetch(u.toString(), { signal: AbortSignal.timeout(10000) });
    await admin.from("nl_events").insert({ sns_message_id: m.MessageId, event_type: "SubscriptionConfirmation", detail: { confirmed: r.ok, status: r.status }, at: new Date().toISOString() });
    return new Response(r.ok ? "confirmed" : "confirm failed", { status: r.ok ? 200 : 502 });
  }
  if (m.Type === "UnsubscribeConfirmation") {
    await admin.from("nl_events").insert({ sns_message_id: m.MessageId, event_type: "UnsubscribeConfirmation", detail: { topic: m.TopicArn }, at: new Date().toISOString() });
    return new Response("noted");
  }
  if (m.Type !== "Notification") return new Response("ignored");
  let ev: any;
  try { ev = JSON.parse(m.Message); } catch { return new Response("not json", { status: 200 }); }
  ev._sns_id = m.MessageId;
  const { data, error } = await admin.rpc("nl_record_event", { p: ev });
  if (error) { console.error("[nl-ses-events]", error.message); return new Response("retry", { status: 500 }); }
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
});
