import { NextResponse } from 'next/server';
import { getCrmAgentReadSession } from '@/lib/crm-agent-auth';
import { getOperatorSession } from '@/lib/portal-auth';
import { getProspectContactReport } from '@/lib/prospect-operations';

export async function GET(request: Request) {
  if (!(await getOperatorSession()) && !(await getCrmAgentReadSession(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { return NextResponse.json({ report: await getProspectContactReport() }); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 500 }); }
}
