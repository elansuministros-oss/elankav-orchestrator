ELANKAV Orchestrator controlled deployment marker.

Purpose: create a fresh canonical remote HEAD after repeated SUPERVISOR_REMOTE_COMMIT_MISMATCH responses from Owner Ops.
Canonical branch: orchestrator-next
Compatibility branch: main aligned to the same commit for legacy supervisor validation.
Expected deployment mechanism: Owner WhatsApp -> Orchestrator OPS gate -> external supervisor.
Deployment policy: canonical-fast-forward; no forced history rewrite.
Protected live dependencies: existing WAHA/WhatsApp session and campaign state are not changed by this marker.
Date: 2026-09-02.
