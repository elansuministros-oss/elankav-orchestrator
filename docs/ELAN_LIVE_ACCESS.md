# ELAN LIVE — ACCESS POLICY

ELAN Live is a voice-first surface. It does not create a new authority.

Canonical flow:

WhatsApp identity → Orchestrator → CONNECT `/api/v1/live-access/session` → signed 15-minute link → ELANVISUAL `/elan-live` → server-side verification in CONNECT → Copilot.

Roles:

- owner: protected Owner phone authority; scopes `*`.
- seller: active `crm_sellers` record plus active ELANVISUAL platform assignment.
- worker/family/study: supported only when explicitly allowlisted in `ELAN_LIVE_ACCESS_IDENTITIES_JSON`; unknown numbers are denied.

Rules:

- Browser input never decides role or scopes.
- Every web-live Copilot request revalidates the signed session server-side.
- Unknown, expired, modified or platform-disallowed identities do not receive access.
- Seller pricing is restricted to authorized-price capability; master-price and margin permissions remain Owner-only.
- External research/reference prices may be advisory only and are not authorized quotation prices until Owner approval.
- Saying `ELAN salir`/`cerrar` ends the Live surface and clears camera/voice state.
