export const WEB_EXPERIENCE_POLICY_CONTRACT_FIXTURE = {
  version: 1,
  canonicalJson: '{"version":1,"discovery":{"targetMinimum":5,"targetMaximum":7,"hardCap":8},"corporateRouting":{"primaryCategoryCount":4,"detailOptionCounts":{"dispute":3,"internal":2,"support":2}}}',
  sha256: 'fe1ba7c28b69b99194e32c6c855ce71a159fa5bce05f5d2a0bf1730a9454b95d',
  policy: {
    version: 1,
    discovery: {
      targetMinimum: 5,
      targetMaximum: 7,
      hardCap: 8,
    },
    corporateRouting: {
      primaryCategoryCount: 4,
      detailOptionCounts: {
        dispute: 3,
        internal: 2,
        support: 2,
      },
    },
  },
} as const;
