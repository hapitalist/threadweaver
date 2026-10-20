// seq_email.ts (Thread Weaver, ported from Joy Looper 20 Oct 2026) - one email from Russell's one-offs and sequences
// (nl_sequences, edited on the Thread Weaver admin email pages), made ready to send. Used by nl-seq-send for the page's
// "See it as an email", "Send me a test", and the real run, so the preview, the test and the real thing are the same email.
//
// A letter, not an article: the body Russell wrote in a 600-pixel column, then the footer every email needs: why they are
// getting it, "stop these emails" (just this sequence), unsubscribe from everything (one click, not tracked) and the
// postal address. Merge tags like {{ first_name }} (and Kit's {{ subscriber.first_name | default: "friend" }}) are filled in.
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const ADDRESS = "Wannabe Press, 5572 Myrtle Avenue, Long Beach, CA 90805";
export const SITE = "https://thread.wannabepress.com";
export const SEQ_FROM = { email: "russell@wannabepress.com", name: "Russell Nohelty" };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const escText = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

export class SeqEmailProblem extends Error {}

function plain(html: string) {
  return html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\{%[^%]*%\}/g, "").replace(/\s+/g, " ").trim();
}

// A one-off email is not part of a run of emails, so its footer has no "Stop these emails".
export function seqEmail(e: { subject?: string | null; preview_text?: string | null; body_html?: string | null }, oneoff = false) {
  const subject = String(e.subject || "").trim();
  if (!subject) throw new SeqEmailProblem("this email has no subject line yet");
  const body = String(e.body_html || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<a\b[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/a>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "");
  const text = plain(body);
  if (!text.replace(/\{\{[^}]*\}\}/g, "").trim()) throw new SeqEmailProblem("this email has nothing in it yet");
  const preview = (String(e.preview_text || "").trim() || text).slice(0, 150);
  const inner = body +
    '<hr style="border:0;border-top:1px solid #e5eaed;margin:36px 0 20px">' +
    '<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#738a94">You\'re getting this because you\'re on Russell Nohelty\'s Wannabe Press list. ' +
    (oneoff ? "" : '<a ses:no-track href="%%SEQ_LEAVE_URL%%" style="color:#738a94;text-decoration:underline">Stop these emails</a> &middot; ') +
    '<a ses:no-track href="%%UNSUB_URL%%" style="color:#738a94;text-decoration:underline">Unsubscribe from everything</a></p>' +
    '<p style="margin:0;font-size:13px;line-height:1.5;color:#738a94">' + esc(ADDRESS) + "</p>";
  const html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>" + escText(subject) + '</title></head><body style="margin:0;padding:0;background:#ffffff">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">' + escText(preview) + "&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff"><tr><td align="center" style="padding:24px 14px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px"><tr>' +
    '<td style="font-family:' + FONT + ';font-size:17px;line-height:1.6;color:#15212a">' + inner + "</td></tr></table></td></tr></table></body></html>";
  return { subject, preview_text: preview, html };
}

// The parts that differ person to person (the unsubscribe link is filled in by ses.ts from their token).
export function fillIn(s: string, p: { first?: string | null; leaveUrl: string }, isHtml = true) {
  const GAP = "\u0001";
  const out = s
    .replace(/\{\{\s*(?:subscriber\.)?first_name\s*(?:\|\s*default\s*:\s*["']([^"']*)["']\s*)?\}\}/gi, (_m, d) => {
      const v = (p.first || d || "").trim();
      return v ? (isHtml ? esc(v) : v) : GAP;
    })
    .replace(/\{\{[^}]*\}\}|\{%[^%]*%\}/g, GAP)
    .replace(/[ \t]*\u0001+[ \t]*(?=[,.!?;:])/g, "")
    .replace(/\u0001/g, "")
    .split("%%SEQ_LEAVE_URL%%").join(p.leaveUrl);
  return isHtml ? out : out.replace(/\s{2,}/g, " ").trim();
}

export const leaveUrl = (token: string, seqId: string) => SITE + "/email-leave.html?t=" + encodeURIComponent(token) + "&s=" + encodeURIComponent(seqId);
