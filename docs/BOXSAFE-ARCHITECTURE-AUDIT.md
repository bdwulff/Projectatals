# BoxSafe read-only architecture findings

Inspected GitHub bdwulff/boxsafe main at commit 5696f8bc48d1b2e8c96c4a698cc775d255976a7c. This is source evidence, not deployment confirmation. No app function, mutation, build, or email was invoked. A metadata-only Lovable SELECT of pg_policies stalled and returned no result; no live RLS verification is available.

## Exact generated schema

Source: src/integrations/supabase/types.ts

orders Row fields: admin_notes:string|null; billing_address:Json|null; carrier:string|null; created_at:string; delivered_at:string|null; fulfilled_at:string|null; fulfillment_notes:string|null; fulfillment_status:string; guest_address:Json|null; guest_email:string|null; guest_name:string|null; guest_phone:string|null; id:string; migrated_at:string|null; packed_at:string|null; paid_at:string|null; picked_at:string|null; receipt_email_sent:boolean; shipped_at:string|null; shipping:number; shipping_address:Json|null; shipping_method:string|null; status:string; stripe_checkout_session_id:string|null; stripe_payment_intent_id:string|null; subtotal:number; tax:number; ticket_email_sent:boolean; total:number; tracking_number:string|null; updated_at:string; user_id:string|null; wp_order_id:number|null; wp_order_status:string|null.

order_items Row fields: attendee_names:string[]|null; created_at:string; id:string; order_id:string; product_id:string|null; quantity:number; supporting_competitor:string|null; total_price:number; unit_price:number; variant_id:string|null; variant_label:string|null; wp_line_item_id:number|null; wp_product_id:number|null.

products relevant Row fields: category:string; course_id:string|null; hidden_from_shop:boolean; id:string; is_active:boolean; is_digital:boolean; is_made_to_order:boolean; is_preorder:boolean; league_id:string|null; name:string; price:number; product_tags:string[]|null; requires_shipping:boolean; shared_league_ids:string[]; stock_quantity:number; stock_tracked:boolean; stripe_price_id:string|null; stripe_product_id:string|null; tickets_per_unit:number. No low_stock_threshold appears on products in the generated schema.

product_variants Row fields: color:string|null; created_at:string; display_order:number; id:string; is_available:boolean; low_stock_threshold:number|null; price_adjustment:number|null; product_id:string; reserved_stock:number|null; size:string|null; sku:string|null; stock_quantity:number; stock_tracked:boolean.

inventory_movements fields: actor_id:string|null; created_at:string; delta:number; id:string; note:string|null; order_id:string|null; product_id:string|null; reason:string; stock_after:number|null; stock_before:number|null; variant_id:string|null.

league_participants relevant fields: id, user_id, league_id, role, discipline, status, status_reason, registration_paid, registered_at, expires_at, source_order_id, source_product_id, superseded_by, superseded_at, tier. Superseded records must be excluded from actionable membership alerts without deleting history.

## Existing endpoints and limitations

supabase/functions/system-reconciliation/index.ts: explicitly read-only, requires verified user and owner role. Reads counts and integrity issues. Some detailed reads have no pagination; count errors may become -1 and data errors can resemble empty data. Not adequate as authoritative all-clear without error/pagination fixes.

supabase/functions/order-fulfillment-audit/index.ts: requires verified admin/owner. Default mode audit, but mode repair writes memberships, enrolments, tickets and may grant access. Scans only latest 2000 paid orders and returns first500 gaps. Paid statuses are paid/completed/processing/shipped/delivered. Its user+league registration test is weaker than current exact payment evidence rules.

supabase/functions/reconcile-pending-orders/index.ts: DO NOT invoke for monitoring. No in-function auth. Defaults dryRun=false and writes order status, fulfils registrations/courses/tickets, clears carts. supabase/config.toml explicitly sets functions.reconcile-pending-orders verify_jwt=false. A safe monitor must use independent read-only Stripe comparisons.

supabase/functions/run-self-test/index.ts: DO NOT invoke as generic health check. Default action run creates test users, leagues, products, orders, documents, grants roles and performs writes. Other seed/cleanup actions mutate too.

supabase/functions/stripe-webhook/index.ts: verifies Stripe signature. Uses audit_log action stripe_webhook_{event.id} for duplicate detection, recording attempt before processing. An audit entry is not proof processing succeeded. Commits stock reservation deductions; calls shared fulfilment; can send notifications. Never invoke for an audit.

supabase/functions/_shared/providerHealth.ts: non-sending provider checks exist (Twilio purchased SMS-capable sender check, Resend domain check). Requires configured server credentials. No standalone generic unauthenticated website health endpoint identified.

## Registration and stock semantics

AGENTS.md: scheduled edge callers use private credential in scheduler_credentials via x-scheduler-secret, never anon keys or body role claims. Do not read scheduler credential secret values. One-off service-role maintenance uses _shared/ownerOnly.ts requireOwner before reads.

Root and supabase/functions/AGENTS.md require league scoped document and medical access; member medical/document bodies should not enter broad Atlas monitoring. Registration status has no rollout hold; use canonical computed status and linked applicable requirements.

drizzle/migrations/0059_payment_evidence_product_scope.sql: valid registration payment evidence must match league+role+discipline, or an appropriate bundle child. Source orders, migration cutoff, verified Stripe IDs, free products, and required courses affect payment evidence. Do not flag mismatch from generic user+league joins or infer unpaid solely from a missing Stripe ID on legacy orders. sync_registration_payment mutates and is not an audit operation.

src/components/admin/InventoryDashboard.tsx: available variant stock=max(0, stock_quantity-reserved_stock); exclude stock_tracked=false and is_made_to_order products from stock alerts. Variant low threshold uses low_stock_threshold, product-level UI fallback is5. Use the same taxonomy helpers in src/lib/shopCategories.ts: categories vary casing/pluralisation; uniforms/apparel and merchandise need physical-order handling.

Initial RLS source migration supabase/migrations/20260119000137_44478d70-5a3a-4327-81e8-e70307e924cb.sql enables RLS; products active publicly readable; owner/league_admin manage products; users read own orders/items. A later migration 20260211224908_a4c83a58-6fbf-40ce-8810-43f209bdbb46.sql added own-order UPDATE. These historical policies are not a verified final policy inventory.

## Safe monitor requirements

Use dedicated read-only credentials/projections; paginate all reads; distinguish unavailable/error/truncated data from zero results. Creation-window filters alone miss old paid-but-unshipped physical orders; examine current actionable order state independent of a90-day created_at cutoff. Include product physical flags/category and order_items.variant_id to judge shipping/stock. Preserve guest orders (user_id nullable) and legacy order provenance. Stripe source access is needed for authoritative Stripe-to-order comparison; database fields alone establish only local consistency.

Website checker replacement is now implemented in packages/core/src/adapters/live/website-checker.ts with address/DNS checks, IP-pinned Node HTTP(S) transport, redirect revalidation and bounded timeout/body. Targeted checks pass; parent must replace the legacy class export before release.
