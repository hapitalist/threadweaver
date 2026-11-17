// wannabe-sync (16 Nov 2026, jk44 for Hapitalist item 81201). Russell: "All the wannabe readers should be on thread weaver,
// just like the Hapitalist ones, and if they are on both they should be on both."
// Every 10 minutes (pg_cron job tw-wannabe-sync, supabase/wannabe_sync.sql): ask the Hapitalist app's tw-wannabe-sync for its
// Wannabe Press list (signups from its /wannabe-press page, fiction-only Kit signups, Zapier leads, and the Kit fiction readers
// it brought over from Kit), put it into this project's Wannabe Press list with wannabe_from_app() (new readers in, leaves made
// there honoured here), then hand the app back what this list holds for each of those addresses (so a leave made here is
// honoured there too). The first run is the import. Nothing is emailed.
// Trust, both ways, is the same as hapi-member-sync: pg_cron calls this with this project's admin-secret; this calls the app
// with this project's service key, which the app checks against this project's own auth admin API. No new secret anywhere.
import postgres from "npm:postgres@3";
const APP_FN = "https://fnioslsnlzyjpumdknva.supabase.co/functions/v1/tw-wannabe-sync";
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

async function callApp(body: unknown) {
  const r = await fetch(APP_FN, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-tw-key": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! },
    body: JSON.stringify(body),
  });
  const d: any = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, d };
}

Deno.serve(async (req) => {
  const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 1, prepare: false });
  try {
    const s = await sql`select decrypted_secret from vault.decrypted_secrets where name = 'admin-secret' limit 1`;
    if (!s.length || req.headers.get("x-admin-secret") !== String(s[0].decrypted_secret)) return j({ error: "forbidden" }, 403);

    const pull = await callApp({ action: "pull" });
    const rows = Array.isArray(pull.d?.rows) ? pull.d.rows : null;
    if (!pull.ok || !pull.d?.ok || !rows) {
      return j({ error: "refusing to sync from a bad answer", status: pull.status, detail: pull.d?.error ?? null }, 502);
    }

    const [res] = await sql`select public.wannabe_from_app(${sql.json({ rows })}::jsonb) as r`;
    const here: any = res.r;
    const counts = { given: here.given, added: here.added, taken_off: here.taken_off, put_back: here.put_back, subscribed: here.subscribed };

    const back = await callApp({ action: "apply", rows: Array.isArray(here.rows) ? here.rows : [], tw: counts });
    if (!back.ok || !back.d?.ok) {
      return j({ error: "the app did not take this list's answer", status: back.status, detail: back.d?.error ?? null, here: counts }, 502);
    }
    return j({ ok: true, here: counts, app: back.d });
  } catch (e) {
    return j({ error: String((e as Error).message || e).slice(0, 200) }, 500);
  } finally {
    await sql.end({ timeout: 5 });
  }
});
