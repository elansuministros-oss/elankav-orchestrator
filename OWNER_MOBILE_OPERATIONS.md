# OWNER MOBILE OPERATIONS — CANONICAL RUNBOOK

**Status: mandatory operating rule for Owner workflows.**

This document prevents future operators, assistants, or chats from treating PC/SSH as the normal production workflow.

## Canonical flow

```text
ChatGPT / technical operator prepares and audits changes
        ↓
GitHub commit is created and verified
        ↓
Owner sends a short WhatsApp command
        ↓
Orchestrator prepares a sensitive OPS operation
        ↓
Owner confirms OPS
        ↓
External supervisor executes outside Orchestrator
        ↓
Owner asks ELAN for OPS status
        ↓
ELAN returns verified result
```

For Orchestrator deployments:

```text
ELAN despliega ORCHESTRATOR commit <FULL_SHA>
```

For CONNECT deployments:

```text
ELAN despliega CONNECT commit <FULL_SHA>
```

Expected interaction:

```text
ELAN → Operación sensible preparada: OPS-...
Owner → CONFIRMAR OPS-...
ELAN → Operación autorizada y delegada al supervisor externo
Owner → ELAN estado OPS-...
ELAN → Resultado verificado del supervisor externo
```

## Mandatory assistant/operator behavior

1. Prepare the audit, implementation, repository changes, migrations, tests/checks, and final GitHub commit with available tooling.
2. Do not ask the Owner to paste long SSH, shell, PowerShell, Node, SQL, curl, or diagnostic blocks during normal operations.
3. When ready, give the Owner the shortest WhatsApp deployment command with the exact full SHA.
4. The Owner confirms the OPS and checks status from WhatsApp.
5. SSH is emergency/bootstrap-only, never the default.
6. Never create a parallel deploy system when Owner → WhatsApp → Orchestrator → external supervisor already supports the action.
7. Do not send the Owner to a PC just to gather information available through GitHub, CONNECT, Supabase, Orchestrator, the supervisor, or connected tools.

## Preserved architecture

```text
WhatsApp Owner
   ↓
WAHA
   ↓
Orchestrator
   ↓
CONNECT
   ↓
Supabase / official platform authorities
```

Sensitive execution path:

```text
WhatsApp Owner
   ↓
Orchestrator OPS gate
   ↓
External supervisor
   ↓
repository deploy / dependency install / build / restart / verification
```

The supervisor intentionally executes outside the Orchestrator process so Orchestrator itself can be safely deployed/restarted.

## Emergency exception

Request PC/SSH only if the required action is not supported by OPS/supervisor, no connected tool can perform or inspect it, that limitation has been verified rather than assumed, and the Owner explicitly accepts emergency/manual execution.

If a recurring action is unsupported, extend the controlled supervisor/OPS capability so future executions remain mobile-first instead of normalizing SSH.

## Instruction to future chats

Before instructing the Owner to approach a PC or paste terminal commands, treat this file as the established production operating contract.

**Default: prepare everything yourself; the Owner only sends the WhatsApp deployment command, confirms OPS, and asks for status.**
