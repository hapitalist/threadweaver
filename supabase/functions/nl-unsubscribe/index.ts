// nl-unsubscribe (Thread Weaver, ported from Joy Looper 20 Oct 2026) - leaving (and rejoining) Russell's Wannabe Press list.
//
// Every one-off and sequence email carries
//   List-Unsubscribe: <.../functions/v1/nl-unsubscribe?t=TOKEN>   and   List-Unsubscribe-Post: List-Unsubscribe=One-Click
// so Gmail, Yahoo and Apple Mail show their own Unsubscribe button. That button POSTs here (RFC 8058): off the list at once.
// The "Unsubscribe" link in the footer goes to https://thread.wannabepress.com/email-unsubscribe.html?t=TOKEN, which asks
// this function over JSON: state / unsubscribe / resubscribe.
//
// A GET never unsubscribes anybody (mail scanners open every link); it only sends the browser on to the page, where a person
// has to press the button. Someone who comes back after a bounce or a spam complaint is also on Amazon's block list for the
// account; putting them back on asks Amazon to take them off it.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ses } from "./ses.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const PAGE = "https://thread.wannabepress.com/email-unsubscribe.html";
const ALLOWED = new Set(["https://thread.wannabepress.com", "https://main--quest-rpg-store.netlify.app"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cors(req: Request) {
  const o = req.headers.get("origin") || "";
  return { "Access-Control-Allow-Origin": ALLOWED.has(o) ? o : "https://thread.wannabepress.com", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info", "Vary": "Origin" };
}
const json = (req: Request, b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors(req), "Content-Type": "application/json" } });

// A reader who bounced or complained is on Amazon's block list (the account's suppression list) and Amazon drops every
// email to them. When they come back by their own say-so (nl_unsub_action, admin_nl_put_back),
// Amazon is asked to take them off it. Not on the list: nothing to do.
async function unblock(aws: any, email: string): Promise<{ ok: boolean; note: string | null }> {
  try {
    const u = "https://email.us-east-1.amazonaws.com/v2/email/suppression/addresses/" + encodeURIComponent(email);
    const g = await aws.fetch(u);
    if (g.status === 404) return { ok: true, note: null };
    const d = await aws.fetch(u, { method: "DELETE" });
    if (d.ok || d.status === 404) return { ok: true, note: null };
    return { ok: false, note: "Amazon did not take them off its block list: " + d.status + " " + (await d.text()).slice(0, 160) };
  } catch (e) { return { ok: false, note: "Amazon did not answer: " + String((e as Error)?.message || e).slice(0, 160) }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  const url = new URL(req.url);
  const qt = (url.searchParams.get("t") || "").trim();
  if (req.method === "GET") {
    return new Response(null, { status: 302, headers: { Location: PAGE + (UUID.test(qt) ? "?t=" + qt : "") } });
  }
  if (req.method !== "POST") return json(req, { ok: false, error: "GET or POST only" }, 405);

  const ctype = req.headers.get("content-type") || "";
  let body: any = {};
  const raw = await req.text();
  if (ctype.includes("application/json")) { try { body = JSON.parse(raw); } catch { body = {}; } }
  const token = String(body.t || qt || "").trim();
  if (!UUID.test(token)) return json(req, { ok: false, error: "That link is not complete - it may have been cut off." }, 400);

  // A mail app's one-click button: token in the query, no JSON action.
  const action = body.action ? String(body.action) : "unsubscribe";
  const how = body.action ? "unsubscribe page" : (/List-Unsubscribe=One-Click/i.test(raw) ? "mail app one-click button" : "unsubscribe link (POST)");
  if (!["state", "unsubscribe", "resubscribe"].includes(action)) return json(req, { ok: false, error: "unknown action" }, 400);
  const { data, error } = await admin.rpc("nl_unsub_action", { p_token: token, p_action: action, p_how: how });
  if (error) { console.error("[nl-unsubscribe]", error.message); return json(req, { ok: false, error: "Could not save that just now - try again in a minute." }, 500); }
  if (data?.test) return json(req, { ok: false, test: true, error: data.error });
  if (!data?.ok) return json(req, { ok: false, error: "That link is not one of ours any more." }, 404);
  const { unsuppress, was: _was, ...out } = data;
  if (unsuppress) {
    // Back by their own click after a bounce or complaint: Amazon is asked to unblock them now; if it refuses, the
    // newsletter run asks again every hour (nl_ses_unblock_due) and the reason stays on their row.
    let u = { ok: false, note: "Amazon did not answer" as string | null };
    try { u = await unblock(await ses(admin), unsuppress); } catch (e) { u = { ok: false, note: String((e as Error)?.message || e).slice(0, 160) }; }
    await admin.rpc("nl_ses_unblock_result", { p_email: unsuppress, p_ok: u.ok, p_note: u.note });
  }
  return json(req, out);
});
