import { NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { getProspectContactReport } from '@/lib/prospect-operations';

export async function GET() {
  if (!(await getOperatorSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { return NextResponse.json({ report: await getProspectContactReport() }); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 500 }); }
}
