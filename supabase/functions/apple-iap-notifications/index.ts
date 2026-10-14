import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// apple-iap-notifications (Thread Weaver's own project, 13 Oct 2026). App Store Server Notifications V2
// for Thread Weaver only: verifies Apple's full certificate chain (root pinned), then revokes a
// one-time purchase on REFUND/REVOKE and restores it on REFUND_REVERSED. Same verification and
// Thread Weaver branch as v4 in the Hapitalist project; the Joy Looper subscription path is not here.
// 14 Oct 2026 (v2):
//  - the $0.99 chapter (com.russellnohelty.threadweaver.chapter, a consumable) is not a bundle: a refund
//    voids exactly that chapter credit (serial_chapter_purchases ref apple:<transactionId>), a reversed
//    refund restores it. Nothing is written to `purchases` for it.
//  - Apple sends to ONE address. Purchases live in two databases (this one since 1.16, the Hapitalist
//    one for older app versions), so every verified Thread Weaver notification is also passed to the
//    other project's listener, which verifies Apple's signature itself. x-tw-forwarded stops ping-pong.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PEER_URL = "https://fnioslsnlzyjpumdknva.supabase.co/functions/v1/apple-iap-notifications";
const APPLE_ROOT_G3_SHA256 = "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9579";
const TW_BUNDLE_IDS = new Set(["com.russellnohelty.threadweaver", "com.russellnohelty.questgirls"]);
const TW_PRODUCT_PREFIXES = ["com.russellnohelty.threadweaver.", "com.russellnohelty.questgirls."];
const TW_ID_ALIASES: Record<string, string> = { "all_games1": "all_games", "godsverse_series1": "godsverse_series" };
const CHAPTER_PRODUCT = "com.russellnohelty.threadweaver.chapter";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function twBundleFromProductId(pid: string): string | null {
  for (const prefix of TW_PRODUCT_PREFIXES) if (pid.startsWith(prefix)) { const raw = pid.slice(prefix.length); return TW_ID_ALIASES[raw] || raw; }
  return null;
}
function jres(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
function b64ToBytes(std: string): Uint8Array { const bin = atob(std); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
function b64urlToBytes(seg: string): Uint8Array { const s = seg.replace(/-/g, "+").replace(/_/g, "/"); const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : ""; return b64ToBytes(s + pad); }
function decodeJwsHeader(jws: string): any { return JSON.parse(new TextDecoder().decode(b64urlToBytes(jws.split(".")[0]))); }
function decodeJwsPayload(jws: string): any { return JSON.parse(new TextDecoder().decode(b64urlToBytes(jws.split(".")[1]))); }
async function sha256Hex(bytes: Uint8Array): Promise<string> { const d = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
type TLV = { tag: number; start: number; contentStart: number; contentEnd: number; end: number };
function readTLV(buf: Uint8Array, off: number): TLV {
  const tag = buf[off]; let p = off + 1; let len = buf[p++];
  if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[p++]; }
  return { tag, start: off, contentStart: p, contentEnd: p + len, end: p + len };
}
function extractSpkiFromCert(der: Uint8Array): ArrayBuffer {
  const prefix = new Uint8Array([0x30,0x59,0x30,0x13,0x06,0x07,0x2a,0x86,0x48,0xce,0x3d,0x02,0x01,0x06,0x08,0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07,0x03,0x42,0x00]);
  for (let i = 3; i < der.length - 65; i++) {
    if (der[i] === 0x04 && der[i - 3] === 0x03 && der[i - 2] === 0x42 && der[i - 1] === 0x00) {
      const point = der.slice(i, i + 65); const spki = new Uint8Array(prefix.length + point.length);
      spki.set(prefix, 0); spki.set(point, prefix.length); return spki.buffer;
    }
  }
  throw new Error("no EC public key in certificate");
}
function derEcdsaToRaw(der: Uint8Array): Uint8Array {
  const seq = readTLV(der, 0); const rI = readTLV(der, seq.contentStart); const sI = readTLV(der, rI.end);
  const norm = (a: Uint8Array) => { let b = a; while (b.length > 32 && b[0] === 0x00) b = b.slice(1); if (b.length > 32) throw new Error("bad ECDSA integer"); const out = new Uint8Array(32); out.set(b, 32 - b.length); return out; };
  const raw = new Uint8Array(64); raw.set(norm(der.slice(rI.contentStart, rI.contentEnd)), 0); raw.set(norm(der.slice(sI.contentStart, sI.contentEnd)), 32); return raw;
}
function parseCert(der: Uint8Array) {
  const outer = readTLV(der, 0); const tbs = readTLV(der, outer.contentStart); const sigAlg = readTLV(der, tbs.end); const sigBits = readTLV(der, sigAlg.end);
  const rawSig = derEcdsaToRaw(der.slice(sigBits.contentStart + 1, sigBits.contentEnd));
  let p = tbs.contentStart; const first = readTLV(der, p); if (first.tag === 0xa0) p = first.end;
  const serial = readTLV(der, p); p = serial.end; const innerSigAlg = readTLV(der, p); p = innerSigAlg.end; const issuer = readTLV(der, p); p = issuer.end;
  const validity = readTLV(der, p); const nb = readTLV(der, validity.contentStart); const na = readTLV(der, nb.end);
  const parseTime = (t: TLV) => {
    const s = new TextDecoder().decode(der.slice(t.contentStart, t.contentEnd)); let yr: number, idx: number;
    if (t.tag === 0x17) { yr = 2000 + parseInt(s.slice(0, 2), 10); idx = 2; } else { yr = parseInt(s.slice(0, 4), 10); idx = 4; }
    return Date.UTC(yr, parseInt(s.slice(idx, idx + 2), 10) - 1, parseInt(s.slice(idx + 2, idx + 4), 10), parseInt(s.slice(idx + 4, idx + 6), 10), parseInt(s.slice(idx + 6, idx + 8), 10), parseInt(s.slice(idx + 8, idx + 10), 10) || 0);
  };
  return { tbs: der.slice(tbs.start, tbs.end), rawSig, notBefore: parseTime(nb), notAfter: parseTime(na) };
}
async function ecdsaVerify(spki: ArrayBuffer, sigRaw: Uint8Array, data: Uint8Array): Promise<boolean> {
  const key = await crypto.subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sigRaw, data);
}
async function verifyAppleJws(jws: string): Promise<boolean> {
  try {
    const x5c: string[] = decodeJwsHeader(jws).x5c || [];
    if (x5c.length < 2) return false;
    const ders = x5c.map((c) => b64ToBytes(c)); const now = Date.now();
    if (await sha256Hex(ders[ders.length - 1]) !== APPLE_ROOT_G3_SHA256) return false;
    for (let i = 0; i < ders.length; i++) {
      const cert = parseCert(ders[i]);
      if (now < cert.notBefore || now > cert.notAfter) return false;
      if (!(await ecdsaVerify(extractSpkiFromCert(ders[Math.min(i + 1, ders.length - 1)]), cert.rawSig, cert.tbs))) return false;
    }
    const parts = jws.split(".");
    return await ecdsaVerify(extractSpkiFromCert(ders[0]), b64urlToBytes(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  } catch { return false; }
}

// pass a verified Thread Weaver notification to the other project's listener (best effort, never blocks Apple)
async function forwardToPeer(rawBody: string): Promise<string> {
  try {
    const r = await fetch(PEER_URL, { method: "POST", headers: { "Content-Type": "application/json", "x-tw-forwarded": "1" }, body: rawBody, signal: AbortSignal.timeout(8000) });
    return "peer " + r.status;
  } catch (e) { return "peer unreachable: " + String((e as Error)?.message || e).slice(0, 120); }
}

async function handleChapter(type: string, tx: any) {
  const isRefund = type === "REFUND" || type === "REVOKE" || !!tx.revocationDate;
  const isRestore = type === "REFUND_REVERSED";
  if (!isRefund && !isRestore) return { note: "tw_chapter_no_action", type };
  const refs = [...new Set([tx.transactionId, tx.originalTransactionId].filter(Boolean).map((t: any) => "apple:" + String(t)))];
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  let q = admin.from("serial_chapter_purchases").update({ revoked_at: isRefund ? new Date().toISOString() : null }).in("ref", refs);
  q = isRefund ? q.is("revoked_at", null) : q.not("revoked_at", "is", null);
  const { data, error } = await q.select("id, user_id, serial_id");
  const res = { kind: "chapter", action: isRefund ? "voided" : "restored", refs, rows: (data || []).length, error: error?.message ?? null };
  console.log(JSON.stringify({ tw: "chapter", type, ...res }));
  return res;
}

async function handleThreadWeaver(type: string, subtype: string | undefined, tx: any) {
  const productId = String(tx.productId || "");
  if (productId === CHAPTER_PRODUCT) return jres({ ok: true, app: "threadweaver", type, ...(await handleChapter(type, tx)) });
  const bundle = twBundleFromProductId(productId);
  if (!bundle) return jres({ ok: true, note: "tw_unknown_product", productId });
  const otid = String(tx.originalTransactionId || tx.transactionId || "");
  const isRefund = type === "REFUND" || type === "REVOKE" || !!tx.revocationDate;
  const isRestore = type === "REFUND_REVERSED";
  if (!isRefund && !isRestore) return jres({ ok: true, note: "tw_no_action", type, subtype: subtype ?? null });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  let userIds: string[] = [];
  if (otid) { const { data } = await admin.from("apple_iap_receipts").select("user_id").eq("original_transaction_id", otid); userIds = (data || []).map((r: any) => r.user_id); }
  if (!userIds.length) { const tok = String(tx.appAccountToken || ""); if (UUID_RE.test(tok)) userIds = [tok]; }
  if (!userIds.length) { console.error(JSON.stringify({ tw: "unmapped_transaction", type, productId, otid })); return jres({ ok: true, note: "tw_no_user_for_transaction", productId, otid }); }
  const results: any[] = [];
  for (const user_id of userIds) {
    if (isRefund) {
      const { error } = await admin.from("purchases").delete().eq("user_id", user_id).eq("bundle", bundle);
      if (otid) await admin.from("apple_iap_receipts").update({ revoked_at: new Date().toISOString() }).eq("original_transaction_id", otid).eq("user_id", user_id);
      results.push({ user_id, bundle, action: "revoked", error: error?.message ?? null });
    } else {
      const { error } = await admin.from("purchases").upsert({ user_id, bundle, stripe_session_id: "apple:" + productId }, { onConflict: "user_id,bundle", ignoreDuplicates: true });
      if (otid) await admin.from("apple_iap_receipts").update({ revoked_at: null }).eq("original_transaction_id", otid).eq("user_id", user_id);
      results.push({ user_id, bundle, action: "restored", error: error?.message ?? null });
    }
  }
  console.log(JSON.stringify({ tw: "handled", type, productId, otid, results }));
  return jres({ ok: true, app: "threadweaver", type, results });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jres({ ok: false }, 405);
  const raw = await req.text();
  let body: any; try { body = JSON.parse(raw); } catch { return jres({ ok: false, error: "bad_json" }, 400); }
  const signedPayload: string = body?.signedPayload;
  if (!signedPayload) return jres({ ok: false, error: "missing_signedPayload" }, 400);
  if (!(await verifyAppleJws(signedPayload))) return jres({ ok: false, error: "invalid_signature" }, 400);
  const notif = decodeJwsPayload(signedPayload);
  const data = notif.data || {};
  if (!TW_BUNDLE_IDS.has(String(data.bundleId || ""))) return jres({ ok: false, error: "unexpected_bundle" }, 400);
  const twTxJws = data.signedTransactionInfo;
  if (!twTxJws) return jres({ ok: true, note: "no_transaction_info" });
  if (!(await verifyAppleJws(twTxJws))) return jres({ ok: false, error: "invalid_transaction_signature" }, 400);
  const twTx = decodeJwsPayload(twTxJws);
  if (twTx.bundleId && !TW_BUNDLE_IDS.has(String(twTx.bundleId))) return jres({ ok: false, error: "unexpected_bundle_tx" }, 400);
  const forwarded = req.headers.get("x-tw-forwarded") === "1";
  const [res, peer] = await Promise.all([handleThreadWeaver(notif.notificationType, notif.subtype, twTx), forwarded ? Promise.resolve("") : forwardToPeer(raw)]);
  if (peer) console.log(JSON.stringify({ tw: "forwarded", type: notif.notificationType, peer }));
  return res;
});
