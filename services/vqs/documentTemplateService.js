const { getPlatformBrand } = require('../../adapters/vqs/brandRegistryAdapter');
const { getExecutive } = require('../../adapters/vqs/executiveRegistryAdapter');

function assertQuotationDocument(document) {
  const errors = [];

  if (!document || typeof document !== 'object') {
    return ['document es obligatorio'];
  }

  if (document.documentType !== 'quotation') errors.push('documentType debe ser quotation');
  if (!document.platformId) errors.push('platformId es obligatorio');
  if (!document.quotationNumber) errors.push('quotationNumber es obligatorio');
  if (!document.customer?.name) errors.push('customer.name es obligatorio');
  if (!Array.isArray(document.items) || document.items.length === 0) errors.push('items debe contener al menos un elemento');
  if (!document.currency) errors.push('currency es obligatoria');
  if (!Number.isFinite(Number(document.totals?.total))) errors.push('totals.total debe ser numérico');
  if (!document.executive?.executiveId) errors.push('executive.executiveId es obligatorio');

  const installments = document.paymentTerms?.installments || [];
  if (document.paymentTerms?.type === 'custom') {
    const sum = installments.reduce((total, item) => total + Number(item.percentage || 0), 0);
    if (Math.abs(sum - 100) > 0.001) errors.push('los pagos personalizados deben sumar 100%');
  }

  return errors;
}

function resolveQuotationTemplate(document) {
  const errors = assertQuotationDocument(document);
  if (errors.length) {
    const error = new Error('QuotationDocument inválido');
    error.code = 'VQS_INVALID_DOCUMENT';
    error.details = errors;
    throw error;
  }

  const brand = getPlatformBrand(document.platformId);
  if (!brand) {
    const error = new Error(`Plataforma no registrada: ${document.platformId}`);
    error.code = 'VQS_PLATFORM_NOT_FOUND';
    throw error;
  }

  const executive = getExecutive(document.executive.executiveId, document.platformId);
  if (!executive) {
    const error = new Error(`Ejecutivo no registrado o no autorizado: ${document.executive.executiveId}`);
    error.code = 'VQS_EXECUTIVE_NOT_FOUND';
    throw error;
  }

  const executiveSnapshot = {
    executiveId: executive.executiveId,
    name: executive.name,
    role: executive.role,
    phone: executive.phone,
    email: executive.email,
    photoUrl: executive.photoUrl,
    commissionEligible: executive.commissionEligible,
    commissionPolicyId: executive.commissionPolicyId,
    registryVersion: executive.registryVersion
  };

  return {
    schemaVersion: document.schemaVersion || '1.0.0',
    documentType: 'quotation',
    platformId: brand.platformId,
    quotationNumber: document.quotationNumber,
    brandSnapshot: brand,
    executiveSnapshot,
    template: {
      templateId: document.template?.templateId || brand.templateId,
      templateVersion: document.template?.templateVersion || brand.templateVersion,
      layoutMode: document.template?.layoutMode || 'automatic'
    },
    publicDocument: {
      ...document,
      brandSnapshot: brand,
      executive: executiveSnapshot,
      internalData: undefined,
      paymentAccountsSnapshot: document.paymentAccountsSnapshot?.length
        ? document.paymentAccountsSnapshot
        : brand.paymentAccounts
    }
  };
}

module.exports = {
  assertQuotationDocument,
  resolveQuotationTemplate
};
