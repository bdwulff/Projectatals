import { test } from "node:test";
import assert from "node:assert/strict";
import { demoMedia } from "../src/design-media.ts";

test("a photo-led concept with no genuine business assets reports its illustrative photos and concept logo", () => {
  const record = { businessProfile: { images: [] }, demo: { designBrief: { placeholderPhotoCount: 4, businessPhotoCount: 0, logoKind: "concept" } } };
  const media = demoMedia(record);
  assert.equal(media.totalPhotos, 4);
  assert.equal(media.summary, "4 illustrative photos · Concept logo");
  assert.equal(media.businessPhotos, 0);
  assert.equal(media.hasPlaceholders, true);
});

test("genuine business photography and illustrative photography remain separate even when a report arrives before records refresh", () => {
  const record = { businessProfile: { images: [{}, {}] }, demo: { designBrief: { businessPhotoCount: 2, placeholderPhotoCount: 0 } } };
  const media = demoMedia(record, { businessPhotoCount: 1, placeholderPhotoCount: 3, logoKind: "concept" });
  assert.equal(media.summary, "1 business photo · 3 illustrative photos · Concept logo");
  assert.equal(media.totalPhotos, 4);
});

test("untrusted counts cannot invent negative, fractional or unbounded photo totals", () => {
  const record = { businessProfile: { images: [{}], logo: {} }, demo: { designBrief: { businessPhotoCount: -1, placeholderPhotoCount: 999999, logoKind: "existing-claim" } } };
  const media = demoMedia(record);
  assert.equal(media.summary, "1 business photo · Business logo");
  assert.equal(media.hasPlaceholders, false);
  assert.equal(demoMedia(null, { placeholderPhotoCount: 1.5 }).totalPhotos, 0);
});

test("template references expose only bounded, unique HTTPS source and preview links", () => {
  const media = demoMedia(null, { placeholderPhotoCount: 4, templateReferences: [
    { name: "Fictional original template reference", sourceUrl: "https://templates.example.test/source", previewUrl: "https://templates.example.test/preview" },
    { name: "Duplicate", sourceUrl: "https://templates.example.test/source" },
    { name: "Unsafe", sourceUrl: "javascript:alert(1)" },
    { name: "Credential URL", sourceUrl: "https://owner:secret@templates.example.test/" },
    { name: "Good source, unsafe preview", sourceUrl: "https://templates.example.test/other", previewUrl: "data:text/html,unsafe" },
  ] });
  assert.equal(media.references.length, 2);
  assert.equal(media.references[0].previewUrl, "https://templates.example.test/preview");
  assert.equal(media.references[1].previewUrl, undefined);
});
