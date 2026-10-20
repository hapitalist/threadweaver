// ses.ts (Thread Weaver, ported from Joy Looper 20 Oct 2026) - one email out through Amazon SES (v2 API), signed with the send-only key in the vault.
// Shared by nl-seq-send (one-offs and sequences) and nl-unsubscribe. Configuration set "wannabepress-email" sends every event to
// SNS topic "wannabepress-email-events" -> nl-ses-events in this project.
import { AwsClient } from "npm:aws4fetch@1.0.20";

export const SES_REGION = "us-east-1";
export const CONFIG_SET = "wannabepress-email";
export const FN_BASE = Deno.env.get("SUPABASE_URL") + "/functions/v1";
export const PAGE_UNSUB = "https://thread.wannabepress.com/email-unsubscribe.html";
// Where Amazon emails its bounce and complaint notices (Russell, 1 Oct: "my_dmarc_report@hapitalist.com is where my
// DMARC shit goes, like complaints and unsubs"). Without this they went to the From address, russell@. The app also
// gets every bounce and complaint through SNS (nl-ses-events) and takes those people off the list itself.
export const FEEDBACK_TO = "my_dmarc_report@hapitalist.com";

let client: AwsClient | null = null;
export async function ses(admin: any): Promise<AwsClient> {
  if (client) return client;
  const [{ data: id }, { data: sec }] = await Promise.all([
    admin.rpc("read_secret", { secret_name: "ses-newsletter-key-id" }),
    admin.rpc("read_secret", { secret_name: "ses-newsletter-secret" }),
  ]);
  if (typeof id !== "string" || typeof sec !== "string" || !id || !sec) throw new Error("the SES key is not in the vault");
  client = new AwsClient({ accessKeyId: id.trim(), secretAccessKey: sec.trim(), service: "ses", region: SES_REGION });
  return client;
}

export type Outcome = { ok: boolean; message_id?: string; error?: string; retry?: boolean; stop?: boolean; code?: string };

export function personalise(s: string, token: string) {
  return s.split("%%UNSUB_URL%%").join(PAGE_UNSUB + "?t=" + token);
}

// The plain-text part of the email (mail programs that do not show HTML, and spam filters, read it). The <head>
// (its <title> would repeat the subject) and the hidden preview line are left out.
export function textFrom(html: string) {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<div[^>]*display:none[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|h[1-6]|li|div|tr|blockquote|figcaption|figure|table)>/gi, "\n\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, h, t) => {
      const tt = t.replace(/<[^>]+>/g, "").trim();
      return tt && !h.startsWith("mailto:") ? `${tt} (${h})` : tt;
    })
    .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&zwnj;|&#847;|\u200c|\u034f/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function sendOne(aws: AwsClient, m: {
  to: string; fromName: string; fromEmail: string; replyTo?: string | null; subject: string; html: string; text: string;
  token: string; sendId: number | string; kind?: string;
}): Promise<Outcome> {
  const oneClick = `${FN_BASE}/nl-unsubscribe?t=${m.token}`;
  const body = {
    FromEmailAddress: `"${m.fromName.replace(/"/g, "")}" <${m.fromEmail}>`,
    Destination: { ToAddresses: [m.to] },
    ReplyToAddresses: m.replyTo ? [m.replyTo] : undefined,
    FeedbackForwardingEmailAddress: FEEDBACK_TO,
    ConfigurationSetName: CONFIG_SET,
    EmailTags: [{ Name: "send_id", Value: String(m.sendId) }, { Name: "kind", Value: m.kind || "newsletter" }],
    Content: {
      Simple: {
        Subject: { Data: m.subject, Charset: "UTF-8" },
        Body: { Html: { Data: personalise(m.html, m.token), Charset: "UTF-8" }, Text: { Data: personalise(m.text, m.token), Charset: "UTF-8" } },
        Headers: [
          { Name: "List-Unsubscribe", Value: `<${oneClick}>` },
          { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
        ],
      },
    },
  };
  let r: Response;
  try {
    r = await aws.fetch(`https://email.${SES_REGION}.amazonaws.com/v2/email/outbound-emails`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  } catch (e) {
    // The request may have reached SES before the connection dropped; not retried, so nobody gets it twice.
    return { ok: false, retry: false, error: "network: " + String((e as Error)?.message || e).slice(0, 200) };
  }
  const t = await r.text();
  let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = null; }
  if (r.ok && j?.MessageId) return { ok: true, message_id: j.MessageId };
  const code = (r.headers.get("x-amzn-errortype") || j?.__type || "").split(":")[0].split("#").pop() || ("HTTP" + r.status);
  const msg = String(j?.message || j?.Message || t || "").slice(0, 240);
  if (code === "TooManyRequestsException" || r.status === 429 || r.status >= 500) return { ok: false, retry: true, code, error: code + ": " + msg };
  if (code === "LimitExceededException") return { ok: false, retry: true, stop: true, code, error: code + ": " + msg };
  if (code === "SendingPausedException" || code === "AccountSuspendedException" || code === "MailFromDomainNotVerifiedException" || code === "AccessDeniedException")
    return { ok: false, retry: true, stop: true, code, error: code + ": " + msg };
  return { ok: false, code, error: code + ": " + msg };
}
