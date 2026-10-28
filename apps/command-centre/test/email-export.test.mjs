import assert from "node:assert/strict";
import test from "node:test";
import { emailFile } from "../src/email-export.ts";

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
