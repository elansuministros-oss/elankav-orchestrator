const ADMIN_ROLES = new Set(['admin', 'owner']);
const EXECUTIVE_ROLES = new Set(['ventas', 'executive']);

export function canViewQuote({ actor, quote }) {
  if (!actor || !quote) return false;
  if (ADMIN_ROLES.has(actor.role)) return true;
  if (EXECUTIVE_ROLES.has(actor.role)) {
    return quote.relations?.executiveId === actor.executiveId;
  }
  return false;
}

export function canCreateWorkOrder({ actor, quote }) {
  if (!actor || !quote) return false;
  if (![...ADMIN_ROLES, ...EXECUTIVE_ROLES].includes(actor.role)) return false;
  if (EXECUTIVE_ROLES.has(actor.role) && quote.relations?.executiveId !== actor.executiveId) return false;
  return quote.quotation?.status === 'deposit_confirmed';
}

export function canCreatePurchaseOrder({ actor, quote }) {
  if (!actor || !quote) return false;
  if (!ADMIN_ROLES.has(actor.role)) return false;
  return quote.quotation?.status === 'deposit_confirmed' && Boolean(quote.project?.projectId);
}

export function canViewInternalFinancials({ actor }) {
  return Boolean(actor && ADMIN_ROLES.has(actor.role));
}

export function filterQuoteForActor({ actor, quote }) {
  if (!canViewQuote({ actor, quote })) return null;
  if (canViewInternalFinancials({ actor })) return quote;

  const safe = structuredClone(quote);
  safe.items = safe.items.map(({ internalData, ...item }) => item);
  delete safe.internalFinancials;
  delete safe.purchaseOrders;
  delete safe.supplierAssignments;
  return safe;
}
