import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('public privacy copy contract', () => {
  const privacy = readSource('src/app/privacy/page.tsx');
  const deletion = readSource('src/app/data-deletion/page.tsx');
  const publicCopy = `${privacy}\n${deletion}`;

  it('limits the irreversible deletion promise to operational copies CaseLoad Select controls', () => {
    expect(publicCopy).toContain(
      'irreversibly removes message content and direct identifiers from the operational copies it controls',
    );
    expect(publicCopy).not.toContain('from its active operational systems');
  });

  it('states the retained audit boundary and the channel-event retention period without a legal de-identification conclusion', () => {
    expect(publicCopy).toContain(
      'It excludes names, contact details, message content, platform sender IDs, and platform message IDs.',
    );
    expect(publicCopy).toContain(
      'Retained channel audit events have a three-year retention period measured from the original event.',
    );
    expect(publicCopy).not.toContain('minimal non-identifying audit envelope');
    expect(publicCopy).not.toContain('de-identified row');
  });

  it('keeps platform-controlled copies and managed backups outside the local deletion proof', () => {
    expect(privacy).toContain('stores its own copy under Meta&rsquo;s own retention rules');
    expect(deletion).toContain(
      'Deleting the CaseLoad Select copy does not delete those platform-controlled copies.',
    );
    expect(publicCopy).toContain(
      'This was not a managed Supabase backup or point-in-time recovery rehearsal.',
    );
    expect(publicCopy).not.toContain('before this revised commitment is released');
  });
});
