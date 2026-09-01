# ELANKAV global email identities

Status: PREPARATION ONLY. No production OAuth, DNS or mailbox changes are performed by this branch.

## Goal

Use Google Workspace/Gmail API as the transport while each ELANKAV platform sends from an authorized corporate identity under `@elankav.com`.

OpenAI never receives Gmail OAuth secrets, refresh tokens or Workspace credentials.

## Logical identity model

Applications request a logical identity, never an arbitrary `From` address.

Example planning map:

```json
{
  "default": "elan@elankav.com",
  "elanvisual": "visual@elankav.com",
  "elan-go": "go@elankav.com",
  "providers": "proveedores@elankav.com",
  "quotes": "cotizaciones@elankav.com",
  "billing": "facturacion@elankav.com",
  "support": "soporte@elankav.com"
}
```

The definitive set must be created/verified in Google Workspace before any identity is enabled for production.

## Server-only configuration

Required OAuth values remain server-side:

- `GMAIL_OAUTH_CLIENT_ID`
- `GMAIL_OAUTH_CLIENT_SECRET`
- `GMAIL_OAUTH_REFRESH_TOKEN`
- `GMAIL_USER`
- `GMAIL_SENDER_IDENTITIES_JSON`

Example of the non-secret identity mapping format:

```json
{"elanvisual":"visual@elankav.com","elan-go":"go@elankav.com"}
```

Do not commit real OAuth credentials or refresh tokens.

## Execution path

```text
Platform policy in CONNECT
  -> logical fromIdentity
  -> CONNECT ChannelExecutionService
  -> Orchestrator /api/internal/channels/deliver
  -> Gmail adapter
  -> allowlisted sender identity
  -> Gmail API
```

An unknown `fromIdentity` is rejected before Gmail OAuth/API is called.

## Production prerequisites

1. Confirm Google Workspace tenant for `elankav.com`.
2. Confirm whether each address is a mailbox, group or send-as alias.
3. Configure/verify MX.
4. Configure SPF.
5. Enable DKIM and publish the generated DNS record.
6. Configure DMARC after SPF/DKIM alignment is verified.
7. Create Google Cloud OAuth client. The current send/read/reply + send-as verification design can use `https://www.googleapis.com/auth/gmail.modify`; do not request `https://mail.google.com/` unless a future function truly needs permanent-delete authority.
8. Store credentials in server secret storage, never source control.
9. Verify every sender identity in Workspace/Gmail. The adapter checks Gmail `users.settings.sendAs.list` and requires configured identities to report `verificationStatus=accepted` before the email capability becomes VERIFIED.
10. Run Gmail adapter probe.
11. Test one controlled outbound message and one inbound reply.
12. Only then mark email capability VERIFIED.

## ELANVISUAL campaign safety

The active ELANVISUAL Facebook campaign is a production dependency.

Do not modify:
- live WAHA session;
- Meta Page token;
- Meta/Instagram webhook callback;
- Facebook ad routing;
- ELANVISUAL inbound responder;
- production DNS/email routing;

until an explicit deployment order and end-to-end regression validation are completed.
