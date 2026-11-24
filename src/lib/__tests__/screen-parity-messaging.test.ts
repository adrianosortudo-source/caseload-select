import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runFictionalMessage, type MessagingCursor } from '../screen-parity-messaging';

const mocks = vi.hoisted(() => ({
  db: vi.fn(() => { throw new Error('Fictional enquiry touched the database'); }),
  send: vi.fn(() => { throw new Error('Fictional enquiry tried to send a message'); }),
  notify: vi.fn(() => { throw new Error('Fictional enquiry tried to notify a firm'); }),
  ai: vi.fn(), map: vi.fn(),
}));
vi.mock('../supabase-admin', () => ({supabaseAdmin: {from: mocks.db}}));
vi.mock('../channel-send', async original => ({...await original<typeof import('../channel-send')>(), sendChannelMessage:mocks.send}));
vi.mock('../lead-notify', () => ({notifyLawyersOfNewLead:mocks.notify}));
vi.mock('../screen-llm-server', () => ({llmExtractServer:mocks.ai}));
vi.mock('../llm-option-map', () => ({llmMapOptionReply:mocks.map}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ai.mockResolvedValue({mode:'live',extracted:{},tokens:{input:100,output:8}});
  mocks.map.mockResolvedValue({mode:'live',value:null});
});

describe('fictional messages use the operational channel processor with isolated delivery', () => {
  it.each(['whatsapp','instagram','facebook'] as const)('receives and resumes %s through the actual question flow',async channel=>{
    let cursor: MessagingCursor = {channel,practiceArea:'corporate',session:null,turns:0,expires:Date.now()+3600000};
    let text = 'My client owes my company money for a delivered order.';
    let complete = false;
    for(let i=0;i<26;i++) {
      const turn=await runFictionalMessage(cursor,text);
      expect(turn.unavailable).toBe(false);
      if(turn.report){
        expect(turn.report.html).toContain('class="brief-cover"');
        expect(turn.report.report.matter_snapshot).toBeTruthy();
        complete=true;
        break;
      }
      expect(turn.ended).toBe(false);
      expect(turn.replies.length).toBeGreaterThan(0);
      cursor=turn.cursor;
      text = cursor.session?.engine_state.contactCaptureStarted && !cursor.session.engine_state.slots.client_name
        ? 'My name is Alex Example. My email is alex@example.com.' : '1';
    }
    expect(complete).toBe(true);
    expect(mocks.ai).toHaveBeenCalled();
    expect(mocks.db).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it('reports an unavailable interpreter on the turn it failed',async()=>{
    mocks.ai.mockResolvedValue({mode:'disabled',extracted:{}});
    const turn=await runFictionalMessage({channel:'whatsapp',practiceArea:'family',session:null,turns:0,expires:Date.now()+90000},'she doesnt allow me to see the kids');
    expect(turn.unavailable).toBe(true);
    expect(mocks.db).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
