// hx-ingest - Thread Weaver's Data Harness, the far end of the walker (17 Nov 2026).
// Ported from Hapitalist's route-harness function. The walker (harness/walk.mjs) runs in the GitHub workflow
// data-harness.yml and proves who it is with GitHub's own short-lived OIDC token (audience tw-data-harness), checked here
// against GitHub's keys: nothing secret is kept on the GitHub side. A walk run by hand on a computer uses a one-day key
// from hx_make_local_key() instead (checked by the database).
//
// Actions (POST JSON, with oidc or key):
//   report   {run}                 one run of one walk on one device: every step, what it found, what it walked clean;
//                                  pictures (shot_b64) are kept in the private bucket "harness" and the step keeps the path
//   next     {max}                 the runs asked for from /admin/harness.html
//   done     {request_id}
//   persona  {who: reader|everything}   a one-day sign-in link for a test person (made here if missing; addresses end in
//                                  @test.invalid so nothing is ever sent to them); "everything" owns Unlock Everything
//   open_findings                  what is open on What needs doing, for the nightly "Look again"
// And for the admin page, with the admin's own sign-in (Authorization: Bearer <their token>):
//   shot     {path}                a link to a run's picture, good for an hour
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const REPO = "hapitalist/threadweaver";
const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "tw-data-harness";
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));
const SITE = "https://thread.wannabepress.com";
const PERSONAS: Record<string, string> = { reader: "harness-reader@test.invalid", everything: "harness-everything@test.invalid" };
const CORS = { "access-control-allow-origin": SITE, "access-control-allow-headers": "authorization, content-type, apikey, x-client-info", "access-control-allow-methods": "POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", ...CORS } });

async function fromOurWorkflow(oidc: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(oidc, JWKS, { issuer: ISSUER, audience: AUDIENCE });
    // the repository check is the whole gate: a token from anybody else's repository verifies against GitHub's keys too
    return payload.repository === REPO && String(payload.workflow_ref || "").indexOf(REPO + "/.github/workflows/data-harness.yml@") === 0;
  } catch (_) { return false; }
}
async function keyOk(key: string): Promise<boolean> {
  if (!key) return false;
  const { data } = await admin.rpc("hx_key_ok", { p_key: key });
  return data === true;
}
function b64ToBytes(b: string): Uint8Array { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

async function keepShots(run: any) {
  const day = new Date().toISOString().slice(0, 10);
  let n = 0;
  for (const s of (run.steps || [])) {
    if (!s.shot_b64 || n >= 40) { delete s.shot_b64; continue; }
    const p = `runs/${day}/${crypto.randomUUID()}.jpg`;
    const { error } = await admin.storage.from("harness").upload(p, b64ToBytes(s.shot_b64), { contentType: "image/jpeg" });
    delete s.shot_b64;
    if (!error) { s.shot = p; n++; }
  }
  for (const f of (run.findings || [])) {
    const same = (run.steps || []).find((s: any) => s.action === "found" && s.kind === f.kind && s.page === f.page && s.step === f.step && s.shot);
    f.shot = same ? same.shot : null;
  }
}
async function ensureBucket() {
  const { data } = await admin.storage.getBucket("harness");
  if (!data) await admin.storage.createBucket("harness", { public: false, fileSizeLimit: 2 * 1024 * 1024 });
}
async function persona(who: string) {
  const email = PERSONAS[who];
  if (!email) return { ok: false, reason: "no such test person" };
  // made once; never on the list, never sent anything (the address cannot receive mail)
  let { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let user = (list?.users || []).find((u: any) => (u.email || "").toLowerCase() === email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, password: crypto.randomUUID() + "Aa1!", user_metadata: { name: "Harness " + who, harness: true } });
    if (error) return { ok: false, reason: error.message };
    user = data.user;
  }
  if (who === "everything") await admin.from("purchases").upsert({ user_id: user!.id, bundle: "unlock_all", stripe_session_id: "harness-test-person" }, { onConflict: "user_id,bundle" });
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo: SITE + "/app" } });
  if (error) return { ok: false, reason: error.message };
  const h = (link as any).properties?.hashed_token;
  return { ok: true, email, link: h ? `${SITE}/auth/confirm?token_hash=${encodeURIComponent(h)}&type=magiclink&next=/app` : (link as any).properties?.action_link };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return j({ error: "POST only" }, 405);
  let body: any = {};
  try { body = await req.json(); } catch (_) { return j({ error: "bad json" }, 400); }

  // the admin page: a picture from a run, for an admin signed in on the site
  if (body.action === "shot") {
    const auth = req.headers.get("authorization") || "";
    const userClient = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: isAdmin } = await userClient.rpc("is_tw_admin");
    if (isAdmin !== true) return j({ error: "admins only" }, 401);
    const p = String(body.path || "");
    if (!/^runs\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.jpg$/.test(p)) return j({ error: "no such picture" }, 400);
    const { data, error } = await admin.storage.from("harness").createSignedUrl(p, 3600);
    if (error) return j({ error: error.message }, 404);
    return j({ ok: true, url: data.signedUrl });
  }

  const viaGitHub = await fromOurWorkflow(String(body.oidc || ""));
  if (!viaGitHub && !(await keyOk(String(body.key || "")))) return j({ error: "not allowed" }, 401);

  if (body.action === "report") {
    const run = body.run || {};
    if (!Array.isArray(run.steps)) return j({ error: "no steps" }, 400);
    run.steps = run.steps.slice(0, 600);
    await ensureBucket();
    await keepShots(run);
    if (!viaGitHub) run.trigger = run.trigger || "hand";
    const { data, error } = await admin.rpc("_hx_ingest", { p: run });
    if (error) return j({ error: error.message }, 500);
    return j(data);
  }
  if (body.action === "next") {
    const { data, error } = await admin.rpc("hx_next_requests", { p_max: Math.min(Math.max(Number(body.max) || 5, 1), 10) });
    if (error) return j({ error: error.message }, 500);
    return j({ ok: true, work: data || [] });
  }
  if (body.action === "done") {
    await admin.rpc("hx_request_done", { p_id: Number(body.request_id) || 0 });
    return j({ ok: true });
  }
  if (body.action === "persona") return j(await persona(String(body.who || "")));
  if (body.action === "open_findings") {
    const { data, error } = await admin.from("hx_findings").select("fp,page,step,kind,seen_devices,sources,item_id").not("item_id", "is", null).eq("planted", false).limit(200);
    if (error) return j({ error: error.message }, 500);
    const { data: open } = await admin.from("hx_items").select("id").in("status", ["open", "fix_waiting"]);
    const ids = new Set((open || []).map((i: any) => i.id));
    return j({ ok: true, findings: (data || []).filter((f: any) => ids.has(f.item_id)) });
  }
  return j({ error: "unknown action" }, 400);
});
