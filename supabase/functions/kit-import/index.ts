// kit-import (Thread Weaver, 20 Oct 2026) - loads copies of Russell's Kit sequences (names, settings and email content,
// no subscribers) into kit_sequences / kit_sequence_emails, so /admin/sequences can list them and bring one over as a
// draft (seq_from_kit). Nothing here touches Kit or sends anything.
//
// Only works with a single-use key whose SHA-256 is in tw_import_tokens and has not expired (each key lasts an hour).
// POST { sequences: [{id, name, active, send_days, send_hour, time_zone, email_count, updated_at}],
//        emails: [{id, sequence_id, position, subject, preview_text, published, delay_value, delay_unit, content_html}] }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

async function sha256(t: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));
  return Array.from(d).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const key = (req.headers.get("x-import-token") || "").trim();
  if (key.length < 30) return json({ error: "no" }, 403);
  const { data: tok } = await admin.from("tw_import_tokens").select("hash").eq("hash", await sha256(key)).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (!tok) return json({ error: "no" }, 403);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const seqs = (Array.isArray(body.sequences) ? body.sequences : []).map((s: any) => ({
    id: Number(s.id), name: String(s.name || "Untitled"), active: !!s.active, send_days: Array.isArray(s.send_days) ? s.send_days.map(String) : null,
    send_hour: s.send_hour == null ? null : Number(s.send_hour), time_zone: s.time_zone ? String(s.time_zone) : null,
    email_count: s.email_count == null ? null : Number(s.email_count), updated_at: s.updated_at || null, pulled_at: new Date().toISOString(),
  })).filter((s: any) => Number.isFinite(s.id));
  const ems = (Array.isArray(body.emails) ? body.emails : []).map((e: any) => ({
    id: Number(e.id), sequence_id: Number(e.sequence_id), position: e.position == null ? null : Number(e.position),
    subject: e.subject ?? null, preview_text: e.preview_text ?? null, published: e.published !== false,
    delay_value: e.delay_value == null ? 0 : Number(e.delay_value), delay_unit: e.delay_unit || "days",
    content_html: e.content_html ?? null, pulled_at: new Date().toISOString(),
  })).filter((e: any) => Number.isFinite(e.id) && Number.isFinite(e.sequence_id));
  if (seqs.length) { const { error } = await admin.from("kit_sequences").upsert(seqs, { onConflict: "id" }); if (error) return json({ error: "sequences: " + error.message }, 500); }
  for (let i = 0; i < ems.length; i += 20) {
    const { error } = await admin.from("kit_sequence_emails").upsert(ems.slice(i, i + 20), { onConflict: "id" });
    if (error) return json({ error: "emails: " + error.message, done: i }, 500);
  }
  return json({ ok: true, sequences: seqs.length, emails: ems.length });
});
