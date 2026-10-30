# Scenic concept preview hosting

The 20 independent scenic concepts are served at unlisted /concepts/:token URLs by apps/api/src/scenic-previews.ts. Each response verifies the manifest SHA256, publication date and expiry, uses an opaque-origin CSP sandbox, and blocks access to cookies, storage, API requests, forms and indexing. Owner API authentication remains unchanged.

The concept-previews directory contains exactly the 20 reviewed self-contained HTML files and their allowlist manifest. Include this directory in every Railway CLI release while these links remain active, through 26 January 2027. There is no public list, upload or publishing endpoint. Never include email drafts, pricing, research workbooks or owner credentials in this directory.

The 29 October 2026 publication implements Brandon’s request to put an individual working demo preview link in every sales email. It does not authorise or perform email sending. Keep exact-copy publishing review and consent checks for any subsequent campaign actions.

Canonical prepared release: /workspace/releases/atlas-scenic-preview-20261029. Prior 358 source files were checked against the last release audit; only server.ts and this new route/test were changed in application code. 605 automated tests and 503 real HTTP browser checks passed before deployment.
