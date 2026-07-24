const VQS_PLATFORM_REGISTRY_VERSION = '1.1.0';

const platforms = {
  ELANVISUAL: {
    platformId: 'ELANVISUAL',
    canonicalPlatformId: 'elanvisual',
    platformCode: 'ELANVISUAL',
    displayName: 'ELANVISUAL',
    website: 'https://visual.elankav.com',
    ecosystemUrl: 'https://www.elankav.com/',
    logoForLightBackground: '/assets/branding/elanvisual.svg',
    logoLightUrl: '/assets/branding/elanvisual.svg',
    taxId: '4012805831001E',
    whatsapp: '+505 7882 8089',
    email: '',
    colors: {
      primary: '#111827',
      secondary: '#C9A227'
    },
    templateId: 'ELANKAV-QUOTATION',
    templateVersion: '1.0.0',
    active: true,
    paymentAccounts: [
      {
        id: 'bac-nio-01',
        bankId: 'BAC',
        bankName: 'BAC Credomatic',
        currency: 'NIO',
        accountNumber: '372105585',
        active: true,
        displayOrder: 1
      },
      {
        id: 'lafise-nio-01',
        bankId: 'LAFISE',
        bankName: 'Banco LAFISE',
        currency: 'NIO',
        accountNumber: '130093768',
        active: true,
        displayOrder: 2
      },
      {
        id: 'lafise-usd-01',
        bankId: 'LAFISE',
        bankName: 'Banco LAFISE',
        currency: 'USD',
        accountNumber: '119234795',
        active: true,
        displayOrder: 3
      },
      {
        id: 'banpro-usd-01',
        bankId: 'BANPRO',
        bankName: 'Banpro',
        currency: 'USD',
        accountNumber: '10020710081659',
        active: true,
        displayOrder: 4
      }
    ]
  }
};

module.exports = {
  VQS_PLATFORM_REGISTRY_VERSION,
  platforms
};
