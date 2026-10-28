export interface ManualEmailDraft { from: string; to: string; subject: string; text: string }

/** Local draft exports only: these helpers have no mail or publishing transport. */
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
