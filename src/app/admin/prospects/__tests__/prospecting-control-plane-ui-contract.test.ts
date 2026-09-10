import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({ useEffect: vi.fn(), useMemo: vi.fn(), useState: vi.fn() }));
vi.mock('react/jsx-runtime', () => ({ Fragment: Symbol('Fragment'), jsx: vi.fn(), jsxs: vi.fn() }));
vi.mock('react/jsx-dev-runtime', () => ({ Fragment: Symbol('Fragment'), jsxDEV: vi.fn() }));

const component = readFileSync(resolve(process.cwd(), 'src/app/admin/prospects/ProspectingControlPlaneRegistry.tsx'), 'utf8');
const page = readFileSync(resolve(process.cwd(), 'src/app/admin/prospects/page.tsx'), 'utf8');

describe('prospecting Control Plane operator surface', () => {
  it('transforms the client component successfully', async () => {
    const module = await import('../ProspectingControlPlaneRegistry');
    expect(module.default).toBeTypeOf('function');
  });

  it('integrates alongside the existing GTA and Brazilian prospect surfaces', () => {
    expect(page).toContain('<ProspectingControlPlaneRegistry />');
    expect(page).toContain('<ReconciledProspects />');
    expect(page).toContain('Open Brazilian lawyer research overlay');
  });

  it('shows the source identity, payload, journey state, history, and receipt without send controls', () => {
    expect(component).toContain('prospecting_control_plane');
    expect(component).toContain('record.sourceRecordKey');
    expect(component).toContain('JSON.stringify(record.sourcePayload');
    expect(component).toContain('record.provisioningReceipt');
    expect(component).toContain('Read activity history');
    expect(component).toContain('record.conversation?.nextAction');
    expect(component).toContain('History not reconciled');
    expect(component).toContain('record.highLevel.contactId');
    expect(component).toContain('record.highLevel.smartListId');
    expect(component).toContain('record.highLevel.workflowIds');
    expect(component).toContain('Current stage');
    expect(component).not.toContain('?? "not_contacted"');
    expect(component).not.toMatch(/send message|send email|activate workflow/i);
  });

  it('uses responsive full-width copy markers and contains no em dash', () => {
    expect(component).toContain('data-ui-component-content="prospecting-control-plane-registry"');
    expect(component).toContain('data-ui-copy="heading"');
    expect(component).toContain('data-ui-copy="body"');
    expect(component).toContain('w-full');
    expect(component).toContain('sm:grid-cols-2');
    expect(component).toContain('lg:grid-cols-3');
    expect(component).not.toContain('—');
  });
});
