// admin-readers — Thread Weaver admin: who's hot / who isn't, across Substack (Wannabe Press),
// BackerKit fiction backers, Thread Weaver app users, Kit history (public.kit_readers) and BookFunnel
// fiction downloads (public.bookfunnel_readers), both imported by Russell from Cohortz on 20 Oct 2026.
// Kit, BookFunnel and the Joy/Hapitalist list (public.joy_readers) also feed heat_score (kit_points, bf_points, joy_points).
// Reads public.admin_reader_heat; the summary is one pass via public.admin_heat_summary().
// Routes (GET): /summary, /readers?heat=&segment=&series=&backer=&kit=in|active|gone|none&kit_tag=&bf=1|0&bf_page=&joy=1|active|0&q=&sort=&limit=&offset=,
//               /reader?email=, /series
// Access: signed-in Thread Weaver users whose email is in ADMINS.
import { createClient } from "jsr:@supabase/supabase-js@2";
const ADMINS = new Set(["russell@wannabepress.com", "help@wannabepress.com"]);
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });
const COLS = "email,heat,heat_score,substack_segment,on_substack_list,superfan,opens_verified_human,open_rate,sends_opened,last_open,series_opens,city,region,country,projects_backed,total_pledged,last_pledged_on,projects,thread_weaver_user,app_joined_at,last_sign_in_at," +
  "in_kit,kit_state,kit_joined_at,kit_cancelled_at,kit_lifetime_sent,kit_lifetime_opened,kit_lifetime_clicked,kit_broadcasts_got,kit_broadcasts_opened,kit_broadcasts_clicked,kit_last_open,kit_tag_count,kit_tags,kit_first_name,kit_last_name,kit_signup_source,kit_city,kit_region,kit_country,kit_points," +
  "bookfunnel_fiction,bf_fiction_pages,bf_fiction_page_count,bf_other_pages,bf_first_claimed,bf_points," +
  "on_joy,joy_status,joy_joined_at,joy_opens_recent,joy_opens_total,joy_points";
const clean = (s: string) => s.replace(/[%_,()]/g, "");

async function isAdmin(req: Request) {
  const t = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!t) return false;
  const { data } = await admin.auth.getUser(t);
  return !!data?.user?.email && ADMINS.has(data.user.email.toLowerCase());
}
async function summary() {
  const [{ data, error }, { data: joy }] = await Promise.all([admin.rpc("admin_heat_summary"), admin.rpc("admin_joy_summary")]);
  if (error) throw error;
  return { as_of: new Date().toISOString(), ...(data as Record<string, unknown>), joy: joy || {} };
}
async function readers(p: URLSearchParams) {
  const limit = Math.min(Math.max(parseInt(p.get("limit") || "50"), 1), 500);
  const offset = Math.max(parseInt(p.get("offset") || "0"), 0);
  const sort = ["heat_score", "last_open", "total_pledged", "open_rate", "sends_opened", "kit_last_open", "kit_lifetime_opened", "bf_fiction_page_count", "joy_opens_total"].includes(p.get("sort") || "") ? p.get("sort")! : "heat_score";
  let q: any = admin.from("admin_reader_heat").select(COLS, { count: "exact" });
  if (p.get("heat")) q = q.eq("heat", p.get("heat"));
  if (p.get("segment")) q = q.eq("substack_segment", p.get("segment"));
  if (p.get("superfan") === "1") q = q.eq("superfan", true);
  if (p.get("backer") === "1") q = q.gt("projects_backed", 0);
  if (p.get("backer") === "0") q = q.is("projects_backed", null);
  if (p.get("app") === "1") q = q.eq("thread_weaver_user", true);
  if (p.get("app") === "0") q = q.eq("thread_weaver_user", false);
  if (p.get("on_list") === "1") q = q.eq("on_substack_list", true);
  if (p.get("verified") === "1") q = q.eq("opens_verified_human", "yes");
  const kit = p.get("kit");
  if (kit === "in") q = q.eq("in_kit", true);
  if (kit === "active") q = q.eq("kit_state", "active");
  if (kit === "gone") q = q.eq("in_kit", true).or("kit_state.is.null,kit_state.neq.active");
  if (kit === "none") q = q.eq("in_kit", false);
  if (p.get("kit_tag")) q = q.ilike("kit_tags", `%${clean(p.get("kit_tag")!)}%`);
  if (p.get("bf") === "1") q = q.eq("bookfunnel_fiction", true);
  if (p.get("bf") === "0") q = q.eq("bookfunnel_fiction", false);
  if (p.get("bf") === "only") q = q.eq("bookfunnel_fiction", true).not("on_substack_list", "is", true).is("projects_backed", null).eq("thread_weaver_user", false).eq("in_kit", false);
  if (p.get("joy") === "1") q = q.eq("on_joy", true);
  if (p.get("joy") === "active") q = q.eq("on_joy", true).gt("joy_opens_recent", 0);
  if (p.get("joy") === "0") q = q.not("on_joy", "is", true);
  if (p.get("bf_page")) q = q.ilike("bf_fiction_pages", `%${clean(p.get("bf_page")!)}%`);
  if (p.get("series")) q = q.gt(`series_opens->${p.get("series")!.replace(/[^a-z_0-9]/gi, "").toLowerCase()}`, 0);
  if (p.get("project")) q = q.contains("projects", [p.get("project")]);
  if (p.get("q")) q = q.ilike("email", `%${clean(p.get("q")!)}%`);
  const { data, count, error } = await q.order(sort, { ascending: false, nullsFirst: false }).range(offset, offset + limit - 1);
  if (error) throw error;
  return { total: count, limit, offset, readers: data };
}
async function reader(email: string) {
  const e = email.toLowerCase().trim();
  const [{ data: r }, { data: opens }, { data: pledges }] = await Promise.all([
    admin.from("admin_reader_heat").select(COLS).eq("email", e).maybeSingle(),
    admin.from("substack_opens").select("post_id,first_open,opens,client,human_open,substack_sends(title,series,sent_at)").eq("email", e).order("first_open", { ascending: false }).limit(500),
    admin.from("fiction_backers").select("project,reward,amount,pledged_on").eq("email", e).order("pledged_on", { ascending: false }),
  ]);
  return { reader: r, opens, pledges };
}
async function series() {
  const { data: sends } = await admin.from("substack_sends").select("post_id,series,title,sent_at,has_open_data").order("sent_at", { ascending: false });
  const by: Record<string, any> = {};
  for (const s of sends || []) {
    const b = by[s.series] ||= { series: s.series, sends: 0, sends_with_open_data: 0, first_sent: s.sent_at, last_sent: s.sent_at };
    b.sends++; if (s.has_open_data) b.sends_with_open_data++;
    if (s.sent_at < b.first_sent) b.first_sent = s.sent_at; if (s.sent_at > b.last_sent) b.last_sent = s.sent_at;
  }
  return { series: Object.values(by), recent_sends: (sends || []).slice(0, 25) };
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await isAdmin(req))) return j({ error: "forbidden" }, 403);
  const url = new URL(req.url);
  const route = url.pathname.split("/").filter(Boolean).pop();
  try {
    if (route === "summary") return j(await summary());
    if (route === "readers") return j(await readers(url.searchParams));
    if (route === "reader") return j(await reader(url.searchParams.get("email") || ""));
    if (route === "series") return j(await series());
    return j({ error: "unknown route", routes: ["summary", "readers", "reader", "series"] }, 404);
  } catch (e) { return j({ error: (e as Error).message }, 500); }
});
