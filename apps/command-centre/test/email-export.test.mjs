import assert from "node:assert/strict";
import test from "node:test";
import { copyEmailBody, copyFullEmail, emailComposeUrl, emailFile } from "../src/email-export.ts";

test("manual draft export keeps the saved message and UTF-8 subject without mixing internal estimates", () => {
  const draft = { from: "owner@studio.example.test", to: "hello@cafe.example.test", subject: "An idea for Juniper Café (fictional)", text: "Hi there,\nWould you like to see the private demo?\n\nOwner (fictional)" };
  const file = emailFile({ ...draft, suggestedQuoteAud: 999, notes: "Internal pricing only" });
  assert.ok(file.startsWith("X-Unsent: 1\r\n"));
  assert.ok(file.includes("To: hello@cafe.example.test\r\n"));
  const encoded = file.match(/^Subject: =\?UTF-8\?B\?(.+)\?=$/m)?.[1];
  assert.equal(Buffer.from(encoded, "base64").toString("utf8"), draft.subject);
  assert.ok(file.endsWith(draft.text.replaceAll("\n", "\r\n")));
  assert.ok(!file.includes("999"));
  assert.ok(!file.includes("Internal pricing"));
});

test("exported email headers cannot inject recipients or extra headers", () => {
  const file = emailFile({ from: "owner@studio.example.test\r\nBcc: injected@example.test", to: "hello@cafe.example.test\nCc: injected@example.test", subject: "Fictional\r\nBcc: injected@example.test", text: "Fictional test draft" });
  assert.ok(!/^Bcc:|^Cc:/m.test(file));
  assert.equal((file.match(/^From:/gm) ?? []).length, 1);
  assert.equal((file.match(/^To:/gm) ?? []).length, 1);
  assert.equal((file.match(/^Subject:/gm) ?? []).length, 1);
});

test("missing sender or recipient remains missing in the local draft export", () => {
  const file = emailFile({ from: "", to: "", subject: "Fictional research draft", text: "No address has been guessed." });
  assert.ok(!/^From:|^To:/m.test(file));
  assert.ok(file.includes("No address has been guessed."));
});

test("one-tap draft preserves recipient, Unicode, links and line breaks without choosing the sender", () => {
  const draft = { to: "hello+bookings@fictional-cafe.example.test", subject: "Juniper Café — a website idea & a quick question", text: "Hi Juniper Café team (fictional),\n\nHere’s your preview: https://example.test/concepts/a_b-123?view=mobile&source=review\n\nCould we feature your café menu first?\nBrandon (fictional)" };
  const href = emailComposeUrl(draft);
  const uri = new URL(href);
  assert.equal(uri.protocol, "mailto:");
  assert.equal(decodeURIComponent(uri.pathname), draft.to);
  assert.equal(uri.searchParams.get("subject"), draft.subject);
  assert.equal(uri.searchParams.get("body"), draft.text.replaceAll("\n", "\r\n"));
  assert.deepEqual([...uri.searchParams.keys()], ["subject", "body"]);
  assert.ok(!href.includes("from="));
});

test("one-tap draft refuses missing content, multiple recipients and header injection", () => {
  const safe = { to: "hello@fictional.example.test", subject: "A website concept (fictional)", text: "Fictional draft only" };
  for (const to of ["", "not-an-email", "one@example.test,two@example.test", "one@example.test;two@example.test", "one@example.test\r\nBcc: other@example.test", "Name <one@example.test>"]) assert.equal(emailComposeUrl({ ...safe, to }), null, to);
  for (const subject of ["", "A draft\nBcc: other@example.test", "A draft\rBcc: other@example.test", "A draft\u0000"]) assert.equal(emailComposeUrl({ ...safe, subject }), null, subject);
  assert.equal(emailComposeUrl({ ...safe, text: "" }), null);
  assert.equal(emailComposeUrl({ ...safe, text: "Fictional\u0000" }), null);
});

test("one-tap draft encodes special characters as message content, never extra recipients", () => {
  const href = emailComposeUrl({ to: "hello@fictional.example.test", subject: "Fictional?bcc=someone@example.test", text: "&cc=someone@example.test\n100% complete + ready # 1\n\nFictional only" });
  const uri = new URL(href);
  assert.deepEqual([...uri.searchParams.keys()], ["subject", "body"]);
  assert.equal(uri.searchParams.get("bcc"), null);
  assert.equal(uri.searchParams.get("cc"), null);
  assert.ok(uri.searchParams.get("body").includes("100% complete + ready # 1"));
});

test("copy fallbacks keep the complete approved text and never send a message", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const copies = [], notices = [];
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async value => copies.push(value) } } });
  try {
    const draft = { to: "hello@fictional.example.test", subject: "Fictional preview", text: "Hi (fictional),\nhttps://example.test/preview\nReply with a useful service." };
    await copyFullEmail(draft, value => notices.push(value));
    await copyEmailBody(draft.text, value => notices.push(value));
    assert.equal(copies[0], `To: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.text}`);
    assert.equal(copies[1], draft.text);
    assert.equal(notices.length, 2);
    assert.ok(notices.every(notice => !notice.includes("Email sent")));
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
  }
});
