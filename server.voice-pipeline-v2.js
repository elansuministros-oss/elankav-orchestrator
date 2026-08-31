'use strict';

/**
 * Reversible bootstrap for Voice Pipeline V2.
 *
 * This file does not modify the legacy webhook module. When the feature flag is
 * true, it preloads the V2 handler under the legacy module path before loading
 * server.js. When false, server.js loads the original handler normally.
 */

const enabled = String(process.env.VOICE_PIPELINE_V2_ENABLED || '').toLowerCase() === 'true';

// Provider-candidate continuity must be installed before messageService or the
// WAHA webhook destructure CONNECT conversation helpers. This isolates Owner-
// initiated supplier exploration from the prospect/customer pipeline while
// preserving official registered-provider precedence.
require('./services/providerCandidateRelationshipPatch').installProviderCandidateRelationshipPatch();

// Candidate conversations are intentionally prevented from inheriting the
// generic sales-prospect actor. This grants no providerId and no scopes; it only
// keeps the AI in supplier-evaluation mode until Owner formalizes the relation.
require('./services/providerCandidateActorIdentityPatch').installProviderCandidateActorIdentityPatch();

// Patch Owner business customer formatting before ownerCommandService is loaded,
// so WhatsApp can honor requested official customer profile fields.
require('./services/ownerBusinessCustomerFieldsPatch');

// Preload the OWNER OPS supervisor bridge before any webhook/message service is
// required so WhatsApp Owner commands can use the external supervisor safely.
require('./services/ownerOpsSupervisorCommandPatch');

// Extend the Owner natural-language command layer with secure temporary seller
// credentials before the unified runtime imports the command service.
require('./services/ownerSellerTemporaryCredentialPatch');

// Guard seller mutations behind a persisted preview + explicit confirmation.
// This patch is intentionally loaded after the credential patch so it also
// intercepts credential delivery before any write/send occurs.
require('./services/ownerSellerPreviewConfirmationPatch');
require('./services/ownerSellerPreviewSanitizePatch');

// Mutation intent must win over incidental read-only wording such as "mostrame".
// This keeps delete/deactivate requests inside PREVIEW + CONFIRMATION.
require('./services/ownerSellerMutationPriorityPatch');

// Human-language intent adapter sits above the specialized seller guards. It
// accepts short, imperfect phrases and converts only the understood business
// intent into the same structured PREVIEW flow; it never writes directly.
require('./services/ownerHumanLanguageIntentPatch');

// Install the shared ELAN Runtime before either WAHA handler imports
// messageService. This preserves Owner OPS and the existing business gateway,
// while routing supported conversational tools through the same CONNECT executor
// used by ELAN Live.
require('./services/elanUnifiedRuntimeMessagePatch').installElanUnifiedRuntimeMessagePatch();

// Outermost Owner/candidate workflow: a short Owner instruction can recruit a
// seller, collect the candidate's data, and return to the existing SELLER preview
// confirmation gate without bypassing CONNECT or generating credentials early.
require('./services/ownerSellerRecruitmentMessagePatch').installOwnerSellerRecruitmentMessagePatch();

// Existing-seller maintenance workflow: the Owner can identify a seller by human
// name only, ELAN resolves the official CONNECT record, contacts that seller, and
// returns proposed changes through the same PREVIEW + CONFIRMATION guard. Access
// credential rotation remains a separate second preview.
require('./services/ownerSellerUpdateOutreachMessagePatch').installOwnerSellerUpdateOutreachMessagePatch();

// Final inbound wrapper for every conversational user: normalize only operational
// vocabulary (including common spelling mistakes) before any downstream router
// sees the message, while preserving the original text in the result/history.
require('./services/humanLanguageMessagePatch').installHumanLanguageMessagePatch();

// Owner-only direct outreach to an unregistered possible provider is additive and
// intentionally outermost. It can send to a supplied number, but never creates an
// official provider; the relationship remains provider_candidate until Owner
// explicitly formalizes it.
require('./services/ownerProviderCandidateOutreachMessagePatch').installOwnerProviderCandidateOutreachMessagePatch();

// Canonical supplier recruitment sits outermost: every Owner provider command
// must pass CONNECT dedupe/evidence/contact preflight before any external send.
require('./services/ownerProviderRecruitmentMessagePatch').installOwnerProviderRecruitmentMessagePatch();

if (enabled) {
  const legacyModulePath = require.resolve('./api/wahaWebhookApi');
  const v2Exports = require('./api/wahaWebhookApiV2');

  require.cache[legacyModulePath] = {
    id: legacyModulePath,
    filename: legacyModulePath,
    loaded: true,
    exports: v2Exports,
    children: [],
    paths: module.paths
  };

  console.log('[VOICE_PIPELINE_V2]', {
    stage: 'BOOTSTRAP_ENABLED',
    handler: 'api/wahaWebhookApiV2.js'
  });
} else {
  console.log('[VOICE_PIPELINE_V2]', {
    stage: 'BOOTSTRAP_DISABLED',
    handler: 'api/wahaWebhookApi.js'
  });
}

require('./server');