// node --conditions=react-server --import tsx scripts/assist-shadow-index.ts status <firm-uuid>
// node --conditions=react-server --import tsx scripts/assist-shadow-index.ts backfill <firm-uuid> <max-batches>
import { assistShadowReadiness, backfillAssistShadow } from '../src/lib/assist/shadow-index';

async function main() {
  const [action, firmId, limit, ...extra] = process.argv.slice(2);
  if (!firmId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(firmId) || extra.length) {
    throw new Error('Choose status or backfill and one firm UUID.');
  }
  if (action === 'status' && limit === undefined) {
    console.log(JSON.stringify(await assistShadowReadiness(firmId)));
    return;
  }
  if (action !== 'backfill' || !limit || !/^\d+$/.test(limit)) throw new Error('Backfill requires an explicit batch limit.');
  console.log(JSON.stringify(await backfillAssistShadow(firmId, Number(limit))));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Shadow index operation failed.'); process.exitCode = 1; });
