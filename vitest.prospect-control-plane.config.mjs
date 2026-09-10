import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default {
  root,
  test: {
    environment: 'node',
    exclude: ['node_modules/**', 'node_modules.partial-20260910/**'],
    include: [
      'src/lib/__tests__/prospect-source-registry.test.ts',
      'src/app/api/admin/prospect-operations/__tests__/prospecting-control-plane-source-route.test.ts',
      'src/app/admin/prospects/__tests__/prospecting-control-plane-ui-contract.test.ts',
      'scripts/prospecting-control-plane/__tests__/**/*.test.ts',
      'scripts/ghl-prospect-readback/__tests__/**/*.test.ts',
    ],
  },
  resolve: { alias: { '@': path.resolve(root, 'src') } },
};
