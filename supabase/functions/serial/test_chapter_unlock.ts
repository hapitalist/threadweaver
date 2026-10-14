// Local test for the $1 chapter unlock: runs the real serial handler against in-memory stand-ins.
const UID = "u1", TOKEN = "tok";
const state: any = {
  follows: new Map<string, any>(),   // serial_id -> row
  extra: 0, ents: [] as string[], lastForm: null as URLSearchParams | null,
};
const lib = [
  { id: "ds1", title: "Dragon One", file: "ds1.epub", free: false, bundle: "dragonstrife_series", series: "Dragon Strife", genres: ["Fantasy"] },
  { id: "free1", title: "Free Book", file: "free1.epub", free: true, bundle: null, series: "Novel", genres: ["Fantasy"] },
];
const chapters = (n: number) => Array.from({ length: n }, (_, i) => ({ idx: i, title: `Chapter ${i + 1}`, words: 1000 }));
(globalThis as any).__TW_SERIAL_DEPS = {
  async library() { return lib; },
  async user(t: string) { return t === TOKEN ? { id: UID } : null; },
  async entitlements() { return state.ents; },
  async followsList() { return [...state.follows.values()]; },
  async followGet(_t: string, _u: string, sid: string) { return state.follows.get(sid) || null; },
  async followUpsert(_t: string, row: any) { state.follows.set(row.serial_id, { email: true, last_emailed_g: -1, ...state.follows.get(row.serial_id), ...row }); },
  async followDelete(_t: string, _u: string, sid: string) { state.follows.delete(sid); },
  async indexMeta(id: string) { return chapters(id.endsWith("ds1") ? 6 : 3); },
  async indexChapter(id: string, idx: number) { return { title: `Chapter ${idx + 1}`, html: `<p>text of ${id} ${idx}</p>` }; },
  async indexPut() {}, async epub() { return new Uint8Array(); },
  async secret(n: string) { return n === "admin-secret" ? "adm" : "sk"; },
  async dueFollows() { return [...state.follows.values()]; },
  async userEmail() { return "reader@example.org"; },
  async markEmailed() {}, async setEmailAdmin() { return true; }, async setEmailAsUser() {},
  async ownedBy() { return state.ents; },
  async sendKey() { return { allow: true, reason: "ok", key: null }; },
  async sendMail() { return { ok: true, id: "m1" }; }, async sesIdentity() { return {}; }, async recordSends() {},
  async extra() { return state.extra; },
  async iapReady() { return { ios: false, android: true }; },
  async stripeSession(form: URLSearchParams) { state.lastForm = form; return { url: "https://checkout.stripe.com/test" }; },
};
const realServe = Deno.serve; (Deno as any).serve = () => ({}) ;
const { handle } = await import("./index.ts");
(Deno as any).serve = realServe;
async function call(body: any, auth = true) {
  const r = await handle(new Request("https://x/functions/v1/serial", { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: "Bearer " + TOKEN } : {}), "x-admin-secret": "adm" }, body: JSON.stringify({ tz: 420, ...body }) }));
  return { status: r.status, j: await r.json() };
}
let fails = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => { console.log((ok ? "  PASS " : "  FAIL ") + name + (ok ? "" : " -- " + JSON.stringify(detail).slice(0, 300))); if (!ok) fails++; };

// follow Dragon Strife starting today (Wednesday 2026-10-14 is "today" for these date maths only via real clock; we set started_on = today)
let r = await call({ action: "follow", serial: "dragon-strife", weekday: 3 });
check("follow works", r.status === 200 && r.j.ok, r.j);
const today = new Date(Date.now() - 420 * 60000).toISOString().slice(0, 10);
state.follows.get("dragon-strife").started_on = today;

r = await call({ action: "chapter", serial: "dragon-strife", g: 0 });
check("chapter 1 readable after following", r.status === 200 && !r.j.locked && /text of/.test(r.j.html), r.j);
check("chapter 1 response offers $1 for chapter 2", r.j.next && r.j.next.ready === false && r.j.next.can_buy === true, r.j.next);

r = await call({ action: "chapter", serial: "dragon-strife", g: 1 });
check("chapter 2 locked, offered for $1 (buy_next)", r.j.locked === true && r.j.buy_next === true && r.j.chapter_price_cents === 100, r.j);
r = await call({ action: "chapter", serial: "dragon-strife", g: 2 });
check("chapter 3 locked and NOT offered (only the very next one is)", r.j.locked === true && r.j.buy_next === false, r.j);

r = await call({ action: "mine" });
const m = r.j.serials?.[0];
check("mine: next chapter not ready, can_buy true, price + iap readiness included", m && m.next_chapter.can_buy === true && r.j.chapter_price_cents === 100 && r.j.chapter_iap && r.j.chapter_iap.android === true, r.j);

r = await call({ action: "chapter_checkout", serial: "dragon-strife" });
const f = state.lastForm as URLSearchParams;
check("checkout: $1 Stripe session for chapter 2 (g=1)", r.status === 200 && r.j.url && f.get("line_items[0][price_data][unit_amount]") === "100" && f.get("metadata[kind]") === "chapter" && f.get("metadata[g]") === "1" && f.get("metadata[serial]") === "dragon-strife" && f.get("metadata[user_id]") === UID, { r: r.j, form: f && Object.fromEntries(f) });
check("checkout returns to the bought chapter", (f.get("success_url") || "").includes("serial=dragon-strife&read=1&purchase=chapter"), f.get("success_url"));

// the webhook credits one chapter
state.extra = 1;
r = await call({ action: "chapter", serial: "dragon-strife", g: 1 });
check("after paying: chapter 2 readable", r.status === 200 && !r.j.locked, r.j);
check("after paying: chapter 3 is now the one offered", r.j.next && r.j.next.can_buy === true && r.j.next.g === 2, r.j.next);
r = await call({ action: "mine" });
check("mine after paying: through = 1", r.j.serials[0].through === 1, r.j.serials[0]);

// weekly schedule continues from the bought chapter: a week later through = 2 (not 1 again)
state.follows.get("dragon-strife").started_on = new Date(Date.parse(today + "T00:00:00Z") - 7 * 86400000).toISOString().slice(0, 10);
r = await call({ action: "mine" });
check("a week later the schedule moved on: through = 2 (no paid chapter re-delivered)", r.j.serials[0].through === 2, r.j.serials[0]);

// email: due today, sends chapter 3 (g=2) with the $1 offer for chapter 4 and the series offer
r = await call({ action: "mail_run", dry_run: true, today });
const html = r.j.preview || "";
check("email: this week's chapter is g=2", r.j.items?.[0]?.g === 2, r.j.items);
check("email: '$1' next-chapter button present", html.includes("Read the next chapter — $1") && html.includes("unlock=next"), html.slice(0, 200));
check("email: whole-series option still present ($20)", html.includes("for $20") && html.includes("buy=dragonstrife_series"), "");

// owners never see the $1 offer
state.ents = ["dragonstrife_series"];
r = await call({ action: "mail_run", dry_run: true, today });
check("email for an owner: no $1 offer, 'You own this series'", !(r.j.preview || "").includes("$1") && (r.j.preview || "").includes("You own this series"), "");
r = await call({ action: "chapter_checkout", serial: "dragon-strife" });
check("checkout refused for an owner", r.status === 409 && r.j.error === "owned", r.j);
state.ents = [];

// not following -> refused with a clear message
state.follows.clear();
r = await call({ action: "chapter_checkout", serial: "dragon-strife" });
check("checkout refused when not following", r.status === 409 && r.j.error === "not following", r.j);
r = await call({ action: "chapter_checkout", serial: "dragon-strife" }, false);
check("checkout refused when signed out", r.status === 401, r.j);

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
Deno.exit(fails ? 1 : 0);
