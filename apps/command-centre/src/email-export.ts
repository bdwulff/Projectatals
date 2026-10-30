export interface ManualEmailDraft { from: string; to: string; subject: string; text: string }

/** Local draft exports only: these helpers have no mail or publishing transport. */
export function emailComposeUrl(draft: Pick<ManualEmailDraft, "to" | "subject" | "text">): string | null {
  // A single sourced address only. Never let a header value create cc/bcc or a second recipient.
  const to = draft.to.trim();
  if (!to || to.length > 254 || /[\s,;<>\r\n\u0000]/.test(to) || !/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z0-9-]+$/.test(to)) return null;
  if (/[\r\n\u0000]/.test(draft.subject) || /\u0000/.test(draft.text)) return null;
  if (!draft.subject.trim() || !draft.text.trim()) return null;
  const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  const body = draft.text.replace(/\r\n|\r|\n/g, "\r\n");
  return `mailto:${encode(to).replace(/%40/gi, "@")}?subject=${encode(draft.subject)}&body=${encode(body)}`;
}

export async function copyFullEmail(draft: Pick<ManualEmailDraft, "to" | "subject" | "text">, notice: (value: string) => void) {
  try { await navigator.clipboard.writeText(`To: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.text}`); notice("Full email copied, including recipient, subject and message. Paste it into your email app and review before sending."); }
  catch { notice("Your browser could not copy this email. Use Open in email app, download the draft, or select the message text."); }
}

export async function copyEmailBody(text: string, notice: (value: string) => void) {
  try { await navigator.clipboard.writeText(text); notice("Message copied. The recipient and subject are shown above for your email app."); }
  catch { notice("Your browser could not copy the message. Select the text above or download the email draft."); }
}

export async function copyEmail(subject: string, text: string, notice: (value: string) => void) {
  try { await navigator.clipboard.writeText(`Subject: ${subject}\n\n${text}`); notice("Email copied. Review the recipient and concept link in your mail app before sending."); }
  catch { notice("Your browser could not copy this email. Download the email draft, or select the message text above."); }
}

export function emailFile(draft: ManualEmailDraft): string {
  const header = (value: string) => value.replace(/[\r\n\u0000]/g, " ").trim();
  const encodedSubject = btoa(Array.from(new TextEncoder().encode(header(draft.subject)), byte => String.fromCharCode(byte)).join(""));
  return ["X-Unsent: 1", ...(draft.from ? [`From: ${header(draft.from)}`] : []), ...(draft.to ? [`To: ${header(draft.to)}`] : []), `Subject: =?UTF-8?B?${encodedSubject}?=`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", draft.text.replace(/\r?\n/g, "\r\n")].join("\r\n");
}

export function downloadEmail(businessName: string, draft: ManualEmailDraft) {
  const url = URL.createObjectURL(new Blob([emailFile(draft)], { type: "message/rfc822" })), link = document.createElement("a");
  link.href = url; link.download = `${businessName.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80) || "business"}-email-draft.eml`; link.click(); URL.revokeObjectURL(url);
}
