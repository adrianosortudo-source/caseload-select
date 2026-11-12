// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {KadishScreenMockup} from '../KadishScreenMockup';
vi.mock('next/image',()=>({default:({unoptimized:_u,...props}:Record<string,unknown>)=><img {...props}/>}));
class Observer {observe(){} disconnect(){}}
beforeEach(()=>vi.stubGlobal('ResizeObserver',Observer));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function setup(){
 const {container}=render(<KadishScreenMockup/>);
 const frame=container.querySelector('iframe')!;
 const doc=frame.contentDocument!;
 doc.open();doc.write('<!doctype html><html><head></head><body><main id="public-demo-content"><textarea id="case-input"></textarea><button id="reset-btn">Reset</button></main></body></html>');doc.close();
 fireEvent.load(frame);
 fireEvent.load(doc.getElementById('kadish-screen-presentation')!);
 return {container,frame,doc};
}
describe('Kadish current SCREEN mockup',()=>{
 it('loads the current shared package with the explicit disability profile',()=>{
  const {frame,doc}=setup();expect(frame.getAttribute('src')).toBe('/screen-demo-app/index.html?embed=1&profile=kadish');
  expect(doc.documentElement.dataset.kadishScreenPreview).toBe('true');
  expect(doc.getElementById('kadish-screen-presentation')?.getAttribute('href')).toBe('/prospect-demos/kadish-dsouza/current-screen-frame.css');
  expect((doc.getElementById('case-input') as HTMLTextAreaElement).placeholder).toContain('disability');
 });
 it('preserves the same iframe and answers while changing views',()=>{
  const {container,frame,doc}=setup();const input=doc.getElementById('case-input') as HTMLTextAreaElement;input.value='A fictional benefits enquiry';
  fireEvent.click(screen.getByRole('button',{name:'Lawyer brief'}));expect(doc.body.dataset.kadishView).toBe('review');
  fireEvent.click(screen.getByRole('button',{name:'Side by side'}));expect(doc.body.dataset.kadishView).toBe('split');
  fireEvent.click(screen.getByRole('button',{name:'Website preview'}));expect(container.querySelectorAll('iframe')).toHaveLength(1);expect(container.querySelector('iframe')).toBe(frame);expect(input.value).toBe('A fictional benefits enquiry');
 });
 it('resets only through the existing widget control',()=>{
  const {doc}=setup();const reset=vi.fn();doc.getElementById('reset-btn')!.addEventListener('click',reset);fireEvent.click(screen.getByRole('button',{name:'Start over'}));expect(reset).toHaveBeenCalledOnce();
 });
 it('shows an error if the package does not expose the expected entry',()=>{
  const {container}=render(<KadishScreenMockup/>);fireEvent.load(container.querySelector('iframe')!);expect(screen.getByRole('status').textContent).toContain('could not load');
 });
});
