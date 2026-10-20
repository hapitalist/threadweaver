// nl-seq-send (Thread Weaver, ported from Joy Looper 20 Oct 2026) - the run that sends Russell's one-off emails and
// sequences (nl_sequences, made on the Thread Weaver admin email pages) through Amazon SES from russell@wannabepress.com.
//
// pg_cron calls this every minute with the admin secret. Each call:
//   * asks nl_seq_claim for the people whose next email is due - anybody who unsubscribed, bounced or complained since is
//     stopped there, at the last moment, and Gmail addresses stay inside this week's warm-up allowance
//   * sends each one their email (seq_email.ts makes it - the same file the page's preview and test use)
//   * reports every result (nl_seq_mark), which sets when their next one is due
// Thread Weaver shares the Amazon account (14 a second) with Joy Looper's newsletter, so this goes at 6 a second at most;
// an Amazon "slow down" puts the person back in the queue (nothing was sent). Nothing sends anyone the same email twice:
// one row per person per email (unique), and a claim that never reports back is marked failed after 15 minutes.
//
// The admin pages call it too, with the admin's own session (nobody else gets an answer):
//   {action:'preview', email_id}      that email exactly as it will arrive (subject, preview line, HTML)
//   {action:'test', email_id, to[]}   that email, sent now to the admin's own address (and up to 4 more) - nobody else
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ses, sendOne, textFrom } from "./ses.ts";
import { seqEmail, fillIn, leaveUrl, SEQ_FROM } from "./seq_email.ts";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(SUPA_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const ALLOWED = new Set(["https://thread.wannabepress.com", "https://main--quest-rpg-store.netlify.app"]);
function cors(req: Request) {
  const o = req.headers.get("origin") || "";
  return { "Access-Control-Allow-Origin": ALLOWED.has(o) ? o : "https://thread.wannabepress.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
}
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });
const firstOf = (name: unknown) => String(name || "").trim().split(/\s+/)[0] || "";

// The page's two buttons: "See it as an email" and "Send me a test".
async function forThePage(req: Request) {
  const caller = createClient(SUPA_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } }, auth: { persistSession: false } });
  const { data: isAdmin, error: aerr } = await caller.rpc("is_tw_admin");
  if (aerr || isAdmin !== true) return json(req, { ok: false, error: "admins only" }, 403);
  const { data: u } = await caller.auth.getUser();
  const myEmail = (u?.user?.email || "").toLowerCase();
  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const action = String(body.action || "");
  if (action !== "preview" && action !== "test") return json(req, { ok: false, error: "unknown action" }, 422);
  const { data: em } = await admin.from("nl_sequence_emails").select("id, sequence_id, subject, preview_text, body_html").eq("id", String(body.email_id || "")).maybeSingle();
  if (!em) return json(req, { ok: false, error: "That email is not there any more - reload the page." }, 404);
  const { data: sq } = await admin.from("nl_sequences").select("kind").eq("id", em.sequence_id).maybeSingle();
  let b;
  try { b = seqEmail(em, sq?.kind === "oneoff"); } catch (e) { return json(req, { ok: false, error: "Not yet - " + String((e as Error)?.message || e) + "." }, 422); }
  if (action === "preview") {
    const { data: me } = myEmail ? await admin.from("nl_subscribers").select("name").eq("email", myEmail).maybeSingle() : { data: null };
    const p = { first: firstOf(me?.name), leaveUrl: "#stop-these-emails" };
    return json(req, { ok: true, from: SEQ_FROM, subject: fillIn(b.subject, p, false), preview_text: fillIn(b.preview_text, p, false),
      html: fillIn(b.html, p).split("%%UNSUB_URL%%").join("#unsubscribe") });
  }
  const extra = (Array.isArray(body.to) ? body.to : []).map((x: unknown) => String(x || "").trim().toLowerCase()).filter((x: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
  const to = [...new Set([...(myEmail ? [myEmail] : []), ...extra])].slice(0, 5);
  if (!to.length) return json(req, { ok: false, error: "Who should the test go to?" }, 422);
  const aws = await ses(admin);
  const results: any[] = [];
  for (const addr of to) {
    const { data: sub } = await admin.from("nl_subscribers").select("token, name").eq("email", addr).maybeSingle();
    const token = sub?.token || "00000000-0000-0000-0000-000000000000";
    const p = { first: firstOf(sub?.name), leaveUrl: leaveUrl(token, em.sequence_id) };
    const html = fillIn(b.html, p);
    const o = await sendOne(aws, { to: addr, fromName: SEQ_FROM.name, fromEmail: SEQ_FROM.email, replyTo: SEQ_FROM.email,
      subject: "[Test] " + fillIn(b.subject, p, false), html, text: textFrom(html), token, sendId: "seqtest", kind: "sequence_test" });
    results.push({ to: addr, ok: o.ok, error: o.error || null });
  }
  const good = results.some((r) => r.ok);
  return json(req, { ok: good, results, error: good ? undefined : "Amazon did not take it: " + (results[0]?.error || "no answer") });
}
const BUDGET_MS = 50_000;

let ADMIN_SECRET = "";
async function adminSecret() {
  if (ADMIN_SECRET) return ADMIN_SECRET;
  const { data } = await admin.rpc("read_secret", { secret_name: "admin-secret" });
  ADMIN_SECRET = typeof data === "string" ? data.trim() : "";
  return ADMIN_SECRET;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const sec = await adminSecret();
  if (!sec || (req.headers.get("x-admin-secret") || "").trim() !== sec) {
    try { return await forThePage(req); } catch (e) { return json(req, { ok: false, error: String((e as Error)?.message || e).slice(0, 300) }, 500); }
  }

  const holder = "seq-" + crypto.randomUUID();
  const { data: got } = await admin.rpc("nl_lease", { p_holder: holder, p_seconds: 65 });
  const fast = got === true;
  const RATE = fast ? 6 : 1;
  const LIMIT = fast ? 280 : 45;
  const t0 = Date.now();
  const out = { fast, claimed: 0, sent: 0, failed: 0, back: 0, stopped: null as string | null };
  let list: { send_id: number; email: string; token: string; first_name: string | null; sequence_id: string; email_id: string }[] = [];
  const reported = new Set<number>();
  const mark = async (chunk: any[]) => { for (const c of chunk) reported.add(c.id); await admin.rpc("nl_seq_mark", { p: chunk }); };
  try {
    const { data: rows, error } = await admin.rpc("nl_seq_claim", { p_limit: LIMIT });
    if (error) throw new Error("claim: " + error.message);
    list = (rows || []) as typeof list;
    out.claimed = list.length;
    if (!list.length) return Response.json({ ok: true, ...out });

    const ids = [...new Set(list.map((r) => r.email_id))];
    const { data: ems } = await admin.from("nl_sequence_emails").select("id, sequence_id, subject, preview_text, body_html").in("id", ids);
    const seqIds = [...new Set((ems || []).map((e: any) => e.sequence_id))];
    const { data: kinds } = await admin.from("nl_sequences").select("id, kind").in("id", seqIds.length ? seqIds : ["00000000-0000-0000-0000-000000000000"]);
    const oneoff = new Set((kinds || []).filter((k: any) => k.kind === "oneoff").map((k: any) => k.id));
    const built = new Map<string, any>();
    for (const e of ems || []) {
      try { built.set(e.id, seqEmail(e, oneoff.has(e.sequence_id))); } catch (err) { built.set(e.id, { problem: String((err as Error)?.message || err) }); }
    }
    const aws = await ses(admin);
    const results: any[] = [];
    let stop: string | null = null;
    let i = 0;
    const workers = Array.from({ length: fast ? 3 : 1 }, async () => {
      while (true) {
        const k = i++;
        if (k >= list.length) return;
        const row = list[k];
        const b = built.get(row.email_id);
        if (!b || b.problem) {
          results.push({ id: row.send_id, ok: false, retry: true, error: "this email cannot go yet: " + (b?.problem || "it is gone") });
          out.back++; continue;
        }
        if (stop || Date.now() - t0 > BUDGET_MS) {
          results.push({ id: row.send_id, ok: false, retry: true, error: stop || "run time used up - back in the queue" });
          out.back++; continue;
        }
        const due = t0 + (k * 1000) / RATE;
        if (due > Date.now()) await sleep(due - Date.now());
        const p = { first: row.first_name, leaveUrl: leaveUrl(row.token, row.sequence_id) };
        const html = fillIn(b.html, p);
        const o = await sendOne(aws, { to: row.email, fromName: SEQ_FROM.name, fromEmail: SEQ_FROM.email, replyTo: SEQ_FROM.email,
          subject: fillIn(b.subject, p, false), html, text: textFrom(html), token: row.token, sendId: "seq" + row.send_id, kind: "sequence" });
        if (o.stop && !stop) stop = o.error || "SES stopped the run";
        results.push({ id: row.send_id, ok: o.ok, message_id: o.message_id, retry: !!o.retry, error: o.error });
        if (o.ok) out.sent++; else if (o.retry) out.back++; else out.failed++;
        if (results.length >= 100) await mark(results.splice(0, results.length));
      }
    });
    await Promise.all(workers);
    if (results.length) await mark(results.splice(0, results.length));
    out.stopped = stop;
    return Response.json({ ok: true, ...out, ms: Date.now() - t0 });
  } catch (e) {
    console.error("[nl-seq-send]", (e as Error)?.message || e);
    // whoever was claimed and not sent goes back to wait ten minutes - never skipped
    const back = list.filter((r) => !reported.has(r.send_id)).map((r) => ({ id: r.send_id, ok: false, retry: true, error: "the run broke before this one went: " + String((e as Error)?.message || e).slice(0, 120) }));
    if (back.length) { try { await admin.rpc("nl_seq_mark", { p: back }); } catch { /* the 15-minute rule still covers them */ } }
    return Response.json({ ok: false, error: String((e as Error)?.message || e).slice(0, 300), ...out }, { status: 500 });
  } finally {
    if (fast) await admin.rpc("nl_release", { p_holder: holder });
  }
});
