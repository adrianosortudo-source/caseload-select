document.documentElement.classList.add('js-ready');

(function(){
  const path=(location.pathname.replace(/\/+$/,'')||'/').toLowerCase();
  const active=(url)=>path===url.toLowerCase()||path===url.toLowerCase().replace('.html','')||(url==='/insights.html'&&path.startsWith('/insights/'));
  const nav=[
    ['/how-we-work.html','How We Work'],
    ['/tools.html','Tools'],
    ['/work/drg-law.html','Case Study'],
    ['/pricing.html','Pricing'],
    ['/insights.html','Insights'],
    ['/about.html','About']
  ];
  const actsNav=[
    ['/acts.html','□','The ACTS Method'],
    ['/authority.html','A','Authority'],
    ['/capture.html','C','Capture'],
    ['/target.html','T','Target'],
    ['/the-screen.html','S','Screen']
  ];
  const actsActive=actsNav.some(([url])=>active(url))||active('/screen.html');

  const bookingPage=document.body.classList.contains('booking-page');
  const header=document.querySelector('[data-site-header]');
  if(header){
    header.classList.add('site-nav-mount');
    const home=path==='/'||active('/index.html');
    if(home)header.setAttribute('data-home-header','');
    const directLinks=nav.map(([url,label])=>`<a href="${url}"${active(url)?' aria-current="page"':''}>${label}</a>`);
    const actsLinks=actsNav.map(([url,index,label])=>`<a class="site-acts-row" href="${url}"${active(url)||(url==='/the-screen.html'&&active('/screen.html'))?' aria-current="page"':''}><span class="site-acts-index">${index}</span><span class="site-acts-name">${label}</span><span class="site-acts-arrow" aria-hidden="true">→</span></a>`).join('');
    const mobileActsLinks=actsNav.map(([url,index,label])=>`<a class="site-mobile-acts-row" href="${url}"${active(url)||(url==='/the-screen.html'&&active('/screen.html'))?' aria-current="page"':''}><span class="site-acts-index">${index}</span><span class="site-acts-name">${label}</span></a>`).join('');
    header.innerHTML=`<a class="skip-link" href="#main">Skip to content</a><header class="site-header site-nav-header"><div class="site-nav-inner"><a class="site-nav-brand" href="/index.html" aria-label="CaseLoad Select homepage"><img src="/brand/logos/lockup-horizontal-dark-transparent.png" alt="CaseLoad Select"></a><nav class="site-primary-nav" aria-label="Main navigation">${directLinks[0]}<div class="site-acts-item${actsActive?' is-active':''}" data-acts-nav><button type="button" class="site-acts-toggle" aria-expanded="false" aria-haspopup="true" aria-controls="site-acts-menu">The ACTS Method<svg class="site-acts-caret" width="7" height="5" viewBox="0 0 7 5" fill="none" aria-hidden="true"><path d="M1 1l2.5 2.5L6 1" stroke="currentColor" stroke-width="1.2"/></svg></button><div class="site-acts-menu" id="site-acts-menu">${actsLinks}</div></div>${directLinks.slice(1).join('')}</nav><div class="site-nav-actions"><a class="site-nav-cta" href="/conversation.html">Start a conversation</a><button class="site-nav-mobile-toggle" type="button" aria-label="Open navigation menu" aria-expanded="false" aria-controls="site-mobile-nav"><svg width="22" height="16" viewBox="0 0 22 16" fill="none" aria-hidden="true"><line x1="0" y1="1" x2="22" y2="1" stroke="currentColor" stroke-width="1.5"/><line x1="0" y1="8" x2="22" y2="8" stroke="currentColor" stroke-width="1.5"/><line x1="0" y1="15" x2="22" y2="15" stroke="currentColor" stroke-width="1.5"/></svg><span class="site-nav-mobile-label">Menu</span></button></div></div></header><nav class="site-mobile-nav" id="site-mobile-nav" aria-label="Mobile navigation">${directLinks[0]}<div><span class="site-mobile-acts-heading">The ACTS Method</span>${mobileActsLinks}</div>${directLinks.slice(1).join('')}</nav>`;
    const actsRoot=header.querySelector('[data-acts-nav]');
    const actsButton=actsRoot.querySelector('.site-acts-toggle');
    const mobileButton=header.querySelector('.site-nav-mobile-toggle');
    const mobileMenu=header.querySelector('.site-mobile-nav');
    const closeActs=()=>{actsRoot.classList.remove('is-open');actsButton.setAttribute('aria-expanded','false')};
    const closeMobile=()=>{mobileMenu.classList.remove('is-open');mobileButton.setAttribute('aria-expanded','false');document.body.classList.remove('site-nav-open')};
    actsButton.addEventListener('click',event=>{event.stopPropagation();const open=!actsRoot.classList.contains('is-open');closeActs();actsRoot.classList.toggle('is-open',open);actsButton.setAttribute('aria-expanded',String(open))});
    mobileButton.addEventListener('click',()=>{const open=!mobileMenu.classList.contains('is-open');mobileMenu.classList.toggle('is-open',open);mobileButton.setAttribute('aria-expanded',String(open));document.body.classList.toggle('site-nav-open',open)});
    header.addEventListener('click',event=>{if(event.target.closest('a')){closeActs();closeMobile()}});
    document.addEventListener('click',event=>{if(!actsRoot.contains(event.target))closeActs()});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'){const actsWasOpen=actsRoot.classList.contains('is-open');const mobileWasOpen=mobileMenu.classList.contains('is-open');closeActs();closeMobile();if(actsWasOpen)actsButton.focus();else if(mobileWasOpen)mobileButton.focus()}});
    window.addEventListener('resize',()=>{if(window.innerWidth>1040)closeMobile()});
  }

  const footer=document.querySelector('[data-site-footer]');
  if(footer){
    footer.innerHTML=`<footer class="site-footer"><div class="shell footer-layout"><div><img class="footer-brand" src="/brand/logos/lockup-horizontal-dark-transparent.png" alt="CaseLoad Select"><p>Marketing for growing Ontario law firms.</p></div><nav aria-label="Footer"><a href="/screen.html">Screen</a><a href="/how-we-work.html">Complete system</a><a href="/crm-client-relationships.html">CRM</a><a href="/insights.html">Insights</a><a href="/pricing.html">Pricing</a><a href="/resources.html">Resources</a><a href="/tools.html">Tools</a><a href="/about.html">About</a></nav><div><a class="footer-contact" href="mailto:adriano@caseloadselect.ca">adriano@caseloadselect.ca</a><p><a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a> · <a href="/accessibility.html">Accessibility</a></p><p>© ${new Date().getFullYear()} CaseLoad Select. No legal advice.</p></div></div></footer>`;
  }

  const tabs=[...document.querySelectorAll('[data-screen-tab]')];
  tabs.forEach(tab=>tab.addEventListener('click',()=>{
    const id=tab.getAttribute('aria-controls');
    tabs.forEach(item=>item.setAttribute('aria-selected',String(item===tab)));
    document.querySelectorAll('[data-screen-panel]').forEach(panel=>{panel.hidden=panel.id!==id});
  }));

  const params=new URLSearchParams(location.search);
  const source=params.get('source')||'website';
  const tool=params.get('tool')||'';
  const track=(name,details={})=>{if(typeof window.gtag==='function')window.gtag('event',name,details)};
  if(bookingPage){
    const labels={desired:'Best Case Profile',paid:'Paid Search Readiness Check',design:'Website Design Review'};
    const sourceNote=document.querySelector('[data-booking-source]');
    if(source==='diagnostic'&&sourceNote){
      const name=labels[tool]||'CaseLoad Select diagnostic';
      sourceNote.textContent=`You completed the ${name}. Bring the result or question you would most like to discuss.`;
      sourceNote.hidden=false;
    }
    track('booking_page_view',{entry_source:source,diagnostic_tool:tool||undefined});
  }
  document.addEventListener('click',event=>{
    const calendar=event.target.closest('[data-booking-link]');
    if(calendar){track('booking_calendar_open',{placement:calendar.dataset.bookingLink,entry_source:source,diagnostic_tool:tool||undefined});return}
    const entry=event.target.closest('a[href^="/book-a-meeting.html"]');
    if(entry)track('booking_page_open',{placement:entry.dataset.bookingEntry||'site',source_page:location.pathname});
  });
})();


(() => {
  document.querySelectorAll('.standard-faq').forEach(section => {
    const rows = [...section.querySelectorAll('.standard-faq__item')].map(item => ({
      heading: item.querySelector('.standard-faq__question'),
      panel: item.querySelector('.standard-faq__answer'),
    }));
    if (rows.some(row => !row.heading || !row.panel)) return;

    for (const row of rows) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'standard-faq__button';
      button.id = `${row.heading.id}-control`;
      row.panel.setAttribute('role', 'region');
      row.panel.setAttribute('aria-labelledby', button.id);
      button.setAttribute('aria-controls', row.panel.id);
      button.setAttribute('aria-expanded', 'true');
      const icon = document.createElement('span');
      icon.className = 'standard-faq__icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = 'âˆ’';
      button.append(...row.heading.childNodes, icon);
      row.heading.append(button);
      row.button = button;
      row.icon = icon;
    }

    function setOpen(row, open) {
      if (!open && row.panel.contains(document.activeElement)) row.button.focus();
      row.panel.hidden = !open;
      row.button.setAttribute('aria-expanded', String(open));
      row.icon.textContent = open ? 'âˆ’' : '+';
    }

    for (const row of rows) {
      row.button.addEventListener('click', () => {
        const opening = row.panel.hidden;
        for (const other of rows) setOpen(other, false);
        if (opening) setOpen(row, true);
      });
    }
    // Content remains fully readable until the controls are initialized.
    for (const row of rows) setOpen(row, false);
  });
})();


'use strict';

const routes = {form:'Contact form', widget:'Website widget', email:'Direct email', sms:'Text message', phone:'Phone call'};
const alex = {name:'Alex Morgan', email:'alex@example.com', phone:'416 555 0148'};
const enquiry = 'A friend and I are starting a design studio. We’d like help putting our agreement in writing.';
const emailMessage = enquiry + ' We’re due to sign the studio lease on Friday.';
const dates = ['We sign the studio lease on Friday.', 'We sign the studio lease next month.'];
const ownership = ['We’ve discussed a 50/50 split. We haven’t agreed on it.', 'We haven’t discussed ownership yet.'];
const designNames = {walkthrough:'Guided walkthrough','side-by-side':'Side by side',brief:'Inside the brief'};
const caseTitle = 'Agreement for a design studio';

function attr(value) {
  return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
}
function rows(items, css = '') {
  return `<dl class="rows ${css}">${items.map(([label,value])=>`<div><dt>${label}</dt><dd>${attr(value)}</dd></div>`).join('')}</dl>`;
}
function bubble(from,words,outgoing) {
  return `<div class="bubble ${outgoing?'outgoing':''}"><small>${from}</small><p>${words}</p></div>`;
}
function scene(key,short,kind,surface,title,content,action) {
  return {key,short,kind,surface,title,content,action};
}
function choices(question,answers,selected) {
  return `<fieldset class="answer-set"><legend>${question}</legend>${answers.map((answer,i)=>`<label><input type="radio" name="sample-answer" value="${i}" ${selected===i?'checked':''}><span>${answer}</span></label>`).join('')}</fieldset>`;
}
function journey(route,branch,answer) {
  const screens=[];
  if(route==='form') {
    screens.push(scene('first','Contact form','web','Firm website','Contact the firm',
      rows([['Name',alex.name],['Email',alex.email],['Phone',alex.phone],['Message',enquiry]],'fields'),'Send enquiry'));
  }
  if(route==='widget') {
    screens.push(scene('first','Website widget','web','Firm website · CaseLoad Screen','What brings you to the firm?',
      rows([['Your name',alex.name],['Your email',alex.email],['Your message',enquiry]],'fields'),'Continue'));
  }
  if(route==='email') {
    screens.push(scene('first','Original email','mail','Mail · New message',caseTitle,
      rows([['From','Alex Morgan <alex@example.com>'],['To','Firm intake team']]) + '<div class="letter"><p>Hello,</p><p>'+emailMessage+'</p><p>Alex Morgan</p></div>','Send email'));
  }
  if(route==='sms') {
    screens.push(scene('first','Incoming text','sms','Messages · Firm intake team','Alex texts the firm',
      bubble('Alex',enquiry,true),'See text reply'));
  }
  if(route==='phone') {
    screens.push(scene('first','Incoming call','call','Phone · Firm intake line','Alex calls the firm',
      '<div class="call-mark" aria-hidden="true">☏</div><p class="call-number">416 555 0148</p><p class="center">Choose how the call continues.</p>',''));
  }
  if(route==='email'||route==='form') {
    const direct=route==='email';
    screens.push(scene('reply','Email reply','mail','Alex’s inbox · Firm intake team',direct?'Re: '+caseTitle:'Your enquiry about the studio',
      rows([['To',alex.email]]) + '<div class="letter"><p>Hi Alex,</p><p>Thanks for getting in touch. We have your message about the studio. Please answer a few questions so a lawyer can review your enquiry.</p><p>Firm intake team</p></div>','Continue my enquiry'));
  }
  if(route==='sms'||(route==='phone'&&branch==='text')) {
    const text = route==='sms'?'Thanks for your message. We’ve included it in your enquiry. Use this link to add a few details for the lawyer.':'Thanks for calling. Use this link to tell us what you’d like the lawyer to know.';
    screens.push(scene('reply','Text reply','sms','Messages · Firm intake team','A link from the firm',
      (route==='sms'?bubble('Alex',enquiry,true):'<p class="call-log">Missed call from 416 555 0148</p>')+bubble('Firm intake team',text,false),'Continue my enquiry'));
  }
  if(route==='phone'&&branch==='text') {
    screens.push(scene('describe','Describe enquiry','web','CaseLoad Screen · From the call','What brings you to the firm?',
      rows([['Callback number',alex.phone]],'carried')+rows([['Name added here',alex.name],['Your message',enquiry]],'fields'),'Continue'));
  }
  if(route==='phone'&&branch==='voice') {
    screens.push(scene('conversation','Voice conversation','call','Phone · Sample transcript','Alex stays on the line',
      bubble('AI intake assistant','I’m the firm’s AI intake assistant. What’s your name, and what would you like the lawyer to know?',false)+bubble('Alex','I’m Alex Morgan. '+enquiry,true),'Read the next exchange'));
  }
  const voice=route==='phone'&&branch==='voice';
  let known=[];
  if(route==='form') known=[['Name',alex.name],['Email',alex.email],['Phone',alex.phone],['Original message',enquiry]];
  if(route==='email') known=[['Sender',alex.email],['Original message',emailMessage]];
  if(route==='sms') known=[['Phone',alex.phone],['Original text',enquiry]];
  const question=route==='email'?'Have you discussed how to divide ownership?':'Is there a date you’d like the lawyer to know about?';
  let questionView=known.length?rows(known,'carried'):'';
  if(route==='sms') questionView+=rows([['Name added here',alex.name]],'fields');
  questionView+=choices(question,route==='email'?ownership:dates,answer);
  screens.push(scene('answer',voice?'Spoken answer':'Follow-up',voice?'call':'web',voice?'Phone · Sample transcript':'CaseLoad Screen · Follow-up',voice?'Alex answers by phone':'A question for Alex',questionView,voice?'Finish the call':'Submit for review'));
  screens.push(scene('receipt',voice?'Call confirmation':'Confirmation',voice?'call':'receipt',voice?'Phone · Sample transcript':'CaseLoad Screen',voice?'The assistant confirms the handoff':'Enquiry received',
    voice?bubble('AI intake assistant','I have your enquiry and your callback number ending in 0148. May I send this to the lawyer for review?',false)+bubble('Alex','Yes, thank you.',true):'<div class="checkmark" aria-hidden="true">✓</div><p>Thank you, Alex. A lawyer will review what you shared and decide whether to arrange a call.</p>','See the lawyer’s brief'));
  screens.push(scene('brief','Lawyer’s brief','report','Lawyer’s view','Alex Morgan','', 'Replay journey'));
  return screens;
}

function evidence(route,branch,answer) {
  const original = {form:'Contact form',widget:'Website widget',email:'Original email',sms:'Incoming text',phone:branch==='voice'?'Call transcript':'Screen after the call'}[route];
  const firstKey = route==='phone'?(branch==='voice'?'conversation':'describe'):'first';
  const replyTo = {form:alex.email+' · '+alex.phone,widget:alex.email,email:alex.email,sms:alex.phone,phone:alex.phone}[route];
  const day = route==='email'||answer===0?'Friday':'next month';
  const note = route==='email'?'Who will contribute what to the studio?':'What have the founders agreed about ownership and roles?';
  const fields=[
    {label:'Contact',value:replyTo,source:route==='phone'?'Incoming call':original,key:'first'},
    {label:'Request',value:'Help preparing a written agreement for two founders.',source:original,key:firstKey},
    {label:'Timing',value:'The founders expect to sign their lease '+(day==='Friday'?'on ':'')+day+'.',source:route==='email'?original:route==='phone'&&branch==='voice'?'Spoken answer':'Screen follow-up',key:route==='email'?'first':'answer'}
  ];
  if(route==='email') fields.push({label:'Ownership',value:ownership[answer],source:'Screen follow-up',key:'answer'});
  return {fields,note,day,original};
}

;
'use strict';

// Miniatures share the walkthrough’s routes, sample answers and brief fields.
function storyboardTile(scene, route, branch, answer, report) {
  const text = (className, value) => `<span class="${className}">${attr(value)}</span>`;
  const value = (label, content) => text('mini-label',label) + text('mini-value',content);
  const button = label => text('mini-action',label);
  const title = label => text('mini-heading',label);
  const line = message => text('mini-copy',message);
  const outgoing = message => text('mini-bubble sent',message);
  const incoming = message => text('mini-bubble',message);
  const answerText = route === 'email' ? ownership[answer] : dates[answer];
  const voice = route === 'phone' && branch === 'voice';

  let device = 'browser';
  let bar = 'Firm website';
  let label = scene.short;
  let body = '';

  switch (scene.key) {
    case 'first':
      if (route === 'phone') {
        device = 'handset call'; bar = 'Phone'; label = 'Call the firm';
        body = text('caller-initials','FI') + title('Firm intake') + line('Calling from') + line(alex.phone) + text('call-end','End call');
      } else if (route === 'sms') {
        device = 'handset messages'; bar = 'Messages'; label = 'Send a text';
        body = title('Firm intake') + outgoing(enquiry);
      } else if (route === 'email') {
        device = 'mailer'; bar = 'New message'; label = 'Email the firm';
        body = text('mini-meta','To · Firm intake') + title(caseTitle) + line('A friend and I are starting a design studio.') + line('We’re due to sign the studio lease on Friday.') + button('Send email');
      } else {
        label = route === 'widget' ? 'Open the widget' : 'Send the form';
        bar = route === 'widget' ? 'CaseLoad Screen' : 'Firm website';
        body = title(route === 'widget' ? 'Your enquiry' : 'Contact the firm') + value('Name',alex.name) + value('Email',alex.email) + (route === 'form' ? value('Phone',alex.phone) : '') + value('Message',enquiry.split('. ')[0]+'.') + button(scene.action);
      }
      break;
    case 'reply':
      if (scene.kind === 'mail') {
        device = 'mailer'; bar = 'Inbox'; label = 'Open the email';
        body = text('mini-meta','From · Firm intake') + title(scene.title) + line('Hi Alex,') + line('Please answer a few questions so a lawyer can review your enquiry.') + button('Continue my enquiry');
      } else {
        device = 'handset messages'; bar = 'Messages'; label = 'Open the text link';
        body = title('Firm intake') + (route === 'sms' ? outgoing('We’d like help putting our agreement in writing.') : text('mini-meta','Missed call')) + incoming(route === 'sms' ? 'Thanks for your message.' : 'Thanks for calling.') + text('mini-link','Continue my enquiry');
      }
      break;
    case 'describe':
      bar = 'CaseLoad Screen'; label = 'Describe the matter';
      body = title('Your enquiry') + value('Number from your call',alex.phone) + line('A friend and I are starting a design studio.') + button('Continue');
      break;
    case 'conversation':
      device = 'handset transcript'; bar = 'Call transcript'; label = 'Talk with the assistant';
      body = text('mini-meta','AI assistant') + incoming('What would you like the lawyer to know?') + text('mini-meta','Alex') + outgoing('I’m Alex Morgan. A friend and I are starting a design studio.');
      break;
    case 'answer': {
      device = voice ? 'handset transcript' : 'widget'; bar = voice ? 'Call transcript' : 'CaseLoad Screen';
      label = voice ? 'Answer by phone' : 'Answer a follow-up';
      const contact = route === 'form' ? [alex.name,alex.email,alex.phone].join(' · ') : route === 'email' ? alex.email : route === 'sms' ? alex.phone : '';
      const context = contact ? text('mini-prefill-title','Already filled in') + text('mini-prefill',contact) : '';
      body = context + title(route === 'email' ? 'How will you divide ownership?' : 'What timing matters?') + (voice ? outgoing(answerText) : text('mini-answer',answerText)) + (voice ? '' : button('Submit for review'));
      break;
    }
    case 'receipt':
      device = voice ? 'handset transcript' : 'receipt'; bar = voice ? 'Call transcript' : 'CaseLoad Screen'; label = voice ? 'Confirm on the call' : 'Get confirmation';
      body = voice ? text('mini-meta','AI assistant') + incoming('May I send this to the lawyer for review?') + outgoing('Yes, thank you.') : text('mini-check','✓') + title('Enquiry received') + line('Thank you, Alex. A lawyer will review what you shared.');
      break;
    case 'brief':
      device = 'document'; bar = 'Lawyer’s brief'; label = 'Read the brief';
      body = title(alex.name) + text('mini-meta','Business setup') + value('Request','Founders’ agreement') + value('Lease signing',report.day) + text('mini-citation',report.fields.find(f=>f.label==='Timing').source);
      break;
  }
  return {label, markup:`<span class="mini-device mini-${device.replaceAll(' ',' mini-')}"><span class="mini-toolbar"><i aria-hidden="true"></i>${attr(bar)}</span><span class="mini-body">${body}</span></span>`};
}

function storyboard(screens, position, route, branch, answer, report) {
  return renderStoryboard(screens.map(scene=>storyboardTile(scene, route, branch, answer, report)),position);
}

function renderStoryboard(previews, position) {
  const tiles = previews.map((tile, index) => {
    return `<li><button type="button" class="story-tile" data-board="${index}" aria-controls="step-detail" aria-label="Step ${index+1} of ${previews.length}. ${attr(tile.label)}" ${index===position?'aria-current="step"':''}><span class="step-tag" aria-hidden="true"><span>${index+1}</span></span><span class="tile-label">${tile.label}</span><span class="device-stage" aria-hidden="true">${tile.markup}</span></button></li>`;
  }).join('');
  return `<section class="story-overview" aria-label="Screen-by-screen journey"><ol class="story-strip" style="--step-count:${previews.length}">${tiles}</ol><div class="board-controls"><div class="board-pager"><button type="button" data-board="${position-1}" aria-label="Previous screen" ${position===0?'disabled':''}>‹</button><span aria-live="polite">Step ${position+1} of ${previews.length}</span><button type="button" data-board="${position+1}" aria-label="Next screen" ${position===previews.length-1?'disabled':''}>›</button></div><a href="#step-detail">Inspect this step</a></div></section>`;
}

;
'use strict';

(() => {
  const controls = document.getElementById('journey-controls');
  const stripHost = document.getElementById('journey-strip');
  const detail = document.getElementById('step-detail');
  const params = new URLSearchParams(location.search);
  const state = {
    route: Object.hasOwn(routes,params.get('route')) ? params.get('route') : 'form',
    call: params.get('call') === 'text' ? 'text' : 'voice',
    step: 0, answer: 0
  };

  const channelNames = {widget:'Website widget',form:'Contact form',email:'Direct email',sms:'SMS',phone:'Phone call'};
  const field = (label,value,id='')=>({kind:'field',label,value,id});
  const message = (label,value,id='',out=false)=>({kind:'message',label,value,id,out});
  const note = value=>({kind:'note',value});
  const choice = (label,options,id)=>({kind:'choice',label,options,id});
  const step = (key,label,device,bar,title,items,action)=>({key,label,device,bar,title,items,action});
  const contact = 'Contact details';
  const request = 'Original request';
  const timing = 'Timing';

  function buildModel(){
    const {route,call,answer}=state;
    const onCall=route==='phone';
    const voice=onCall&&call==='voice';
    const email=route==='email';
    const steps=[];
    if(route==='form'){
      steps.push(step('first','Send the form','browser','Firm website','Contact the firm',[
        field('Name',alex.name,contact),field('Email',alex.email,contact),field('Phone',alex.phone,contact),
        field('Message',enquiry,request)],'Send enquiry'));
    } else if(route==='widget'){
      steps.push(step('first','Open the widget','widget','CaseLoad Screen','What brings you to the firm?',[
        field('Contact','Name and email supplied',contact),field('Your message','Request described',request)],'Continue'));
    } else if(email){
      steps.push(step('first','Email the firm','mailer','New message','Consultation enquiry',[
        field('From','Sender address supplied',contact),field('To','Firm intake team'),
        field('Message','Request described',request),field('Timing','Included in the message',timing)],'Send email'));
    } else if(route==='sms'){
      steps.push(step('first','Send a text','handset messages','Messages','Firm intake',[
        field('From','Sending number',contact),message('Prospective consultee','Message describing the request',request,true)],'See the reply'));
    } else {
      steps.push(step('first','Call the firm','handset call','Phone','Firm intake line',[
        field('Caller ID','Callback number',contact),note(voice?'The AI intake assistant answers.':'The call goes unanswered.')],
        voice?'Read the conversation':'See the text reply'));
    }

    if(email||route==='form'){
      steps.push(step('reply','Open the email','mailer','Inbox',email?'Re: Consultation enquiry':'Your enquiry',[
        field('From','Firm intake team'),message('Reply from the firm','Thank you for getting in touch. Please use the link to answer a few questions for the lawyer.')],'Continue my enquiry'));
    }
    if(route==='sms'||(onCall&&!voice)){
      steps.push(step('reply','Open the text link','handset messages','Messages','Firm intake',[
        message('Firm intake team',onCall?'Thanks for calling. Use this link to tell us what you need.':'Thanks for your message. Use this link to add a few details for the lawyer.')],'Continue my enquiry'));
    }
    if(onCall&&!voice){
      steps.push(step('describe','Describe the request','widget','CaseLoad Screen','What brings you to the firm?',[
        field('Already filled in','Callback number'),field('Name','Name added here'),field('Your message','Request described',request)],'Continue'));
    }
    if(voice){
      steps.push(step('talk','Talk to the assistant','handset transcript','Call transcript','AI intake assistant',[
        message('AI assistant','What would you like the lawyer to know?'),message('Prospective consultee','Name and request supplied by voice',request,true)],'Continue the call'));
    }
    const answerId=email?'Documents':timing;
    const question=email?'Is there a document for the lawyer to review?':'Is there a date the lawyer should know about?';
    const dateAnswer=route==='form'?'Lease signing on Friday at 2 p.m.':'Date supplied';
    const options=email?['Document available','Still to confirm']:[dateAnswer,'Timing to confirm'];
    const follow=[];
    if(route==='form')follow.push(field('Already filled in','Name, email, phone, and original message'));
    if(email)follow.push(field('From the email','Sender address, original message, and timing'));
    if(route==='sms')follow.push(field('From the text','Sending number and original message'));
    follow.push(choice(question,options,answerId));
    steps.push(step('answer',voice?'Answer by voice':'Answer a follow-up',voice?'handset transcript':'widget',voice?'Call transcript':'CaseLoad Screen',voice?'Spoken follow-up':'Follow-up question',follow,voice?'Finish the call':'Submit for review'));
    steps.push(step('receipt',voice?'Confirm on the call':'Get confirmation',voice?'handset transcript':'receipt',voice?'Call transcript':'CaseLoad Screen',voice?'Call confirmation':'Enquiry received',[
      voice?message('AI intake assistant','Your enquiry is ready for the lawyer to review.'):note('Thank you. A lawyer will review the information you shared.')],'See the lawyer’s brief'));

    const original=onCall?(voice?'Call transcript':'Screen after the call'):channelNames[route];
    const requestKey=onCall?(voice?'talk':'describe'):'first';
    const fields=[
      {id:contact,value:route==='form'?'Name, email and phone':route==='widget'?'Name and email':email?'Sender address':'Phone number',source:onCall?'Caller ID':channelNames[route],key:'first'},
      {id:request,value:'Request described',source:original,key:requestKey},
      {id:timing,value:email?'Included in the email':options[answer],source:email?'Original email':voice?'Spoken follow-up':'Screen follow-up',key:email?'first':'answer'}
    ];
    if(email)fields.push({id:'Documents',value:options[answer],source:'Screen follow-up',key:'answer'});
    steps.push(step('brief','Read the brief','document','Lawyer’s brief','Enquiry for review',[
      field('Source',original),field('Timing',fields[2].value),note('Lawyer to confirm the next action.')],'Replay journey'));
    return {steps,fields};
  }

  function content(item,mini){
    const v=attr(item.value??'');
    const label=attr(item.label??'');
    const tag=mini?'span':'div';
    const cls=(c,txt)=>`<span class="${c}">${txt}</span>`;
    if(item.kind==='field')return `<${tag} class="datum">${cls(mini?'mini-label':'field-name',label)}${cls(mini?'mini-value':'field-value',v)}</${tag}>`;
    if(item.kind==='message')return `<${tag} class="utterance">${cls(mini?'mini-meta':'field-name',label)}${cls(mini?'mini-bubble'+(item.out?' sent':''):'spoken',v)}</${tag}>`;
    if(item.kind==='choice'){
      if(mini)return cls('mini-label',label)+cls('mini-answer',attr(item.options[state.answer]));
      return `<fieldset class="demo-options"><legend>${label}</legend>${item.options.map((o,i)=>`<label><input type="radio" name="schematic-answer" value="${i}" ${state.answer===i?'checked':''}>${attr(o)}</label>`).join('')}</fieldset>`;
    }
    return cls(mini?'mini-copy':'scene-note',v);
  }
  function preview(s){
    const device=s.device.replaceAll(' ',' mini-');
    const check=s.device==='receipt'?'<span class="mini-check">✓</span>':'';
    const act=s.key==='brief'?'':`<span class="mini-action">${attr(s.action)}</span>`;
    const markup=`<span class="mini-device mini-${device}"><span class="mini-toolbar"><i></i>${attr(s.bar)}</span><span class="mini-body">${check}<span class="mini-heading">${attr(s.title)}</span>${s.items.map(i=>content(i,true)).join('')}${act}</span></span>`;
    return {label:s.label,markup};
  }
  function button(label,action,secondary=false){
    return `<button class="fp-btn${secondary?' ghost-btn':''}" type="button" data-action="${action}">${label}</button>`;
  }
  function render(){
    const model=buildModel();
    const {steps,fields}=model;
    const i=state.step,s=steps[i];
    controls.innerHTML=`<div class="channel-bar" role="group" aria-label="First contact">${Object.entries(channelNames).map(([key,label])=>`<button type="button" data-route="${key}" aria-pressed="${key===state.route}">${label}</button>`).join('')}</div>`+
      (state.route==='phone'?`<div class="call-bar" role="group" aria-label="Phone outcome"><span>Call outcome</span>${[['voice','AI conversation'],['text','Missed call with SMS']].map(([key,label])=>`<button type="button" data-call="${key}" aria-pressed="${key===state.call}">${label}</button>`).join('')}</div>`:'');
    stripHost.innerHTML=renderStoryboard(steps.map(preview),i);
    const known=fields.filter(f=>steps.findIndex(step=>step.key===f.key)<i);
    const open=fields.filter(f=>!known.includes(f)).map(f=>f.id.toLowerCase()).join(', ');
    const end=s.key==='brief';
    detail.innerHTML=`<div class="scene-panel"><p class="kicker">${end?'Lawyer’s view':'Prospective consultee’s view'} · Step ${i+1}</p><h3>${attr(s.title)}</h3><div class="scene-data">${s.items.map(item=>content(item,false)).join('')}</div><div class="scene-actions">${end?'<a class="fp-btn" href="#live-demo">Try the live demo</a>':''}${button(s.action,end?'restart':'next') }${i?button('Previous step','back',true):''}</div></div><div class="record-panel"><p class="kicker">Information received</p><h3>${end?'Ready for lawyer review':i?'In the enquiry so far':'Before first contact'}</h3>${known.length?`<dl class="received">${known.map(f=>`<div><dt>${f.id}</dt><dd>${attr(f.value)}<small>${f.source}</small></dd></div>`).join('')}</dl>`:'<p>The firm receives the first details when the prospective consultee contacts it.</p>'}${open?`<p class="open-fields">Still to come · ${open}</p>`:'<p class="open-fields">The lawyer decides how the firm responds.</p>'}</div>`;
  }
  function updateFocus(selector){
    render();
    document.querySelector(selector)?.focus({preventScroll:true});
  }
  function go(i){state.step=i;}
  document.addEventListener('click',event=>{
    const b=event.target.closest('button');
    if(!b)return;
    if(b.dataset.route){
      state.route=b.dataset.route;state.call='voice';state.answer=0;go(0);
      updateFocus(`[data-route="${state.route}"]`);
    }else if(b.dataset.call){
      state.call=b.dataset.call;state.answer=0;go(0);updateFocus(`[data-call="${state.call}"]`);
    }else if(b.hasAttribute('data-board')){
      const direction=b.closest('.board-pager')&&b.getAttribute('aria-label');
      go(Number(b.dataset.board));render();
      const pager=direction&&stripHost.querySelector(`[aria-label="${direction}"]:not(:disabled)`);
      (pager||stripHost.querySelector('[aria-current="step"]')).focus({preventScroll:true});
    }else if(b.dataset.action){
      go(b.dataset.action==='restart'?0:state.step+(b.dataset.action==='back'?-1:1));
      updateFocus('.scene-actions button');
      if(detail.getBoundingClientRect().top<0)detail.scrollIntoView({block:'start'});
    }
  });
  detail.addEventListener('change',event=>{
    if(event.target.name!=='schematic-answer')return;
    state.answer=Number(event.target.value);updateFocus('input[name="schematic-answer"]:checked');
  });
  document.addEventListener('keydown',e=>{
    if(e.key!=='Escape')return;
    const menu=document.querySelector('.fp-header details[open]');
    if(menu){menu.open=false;menu.querySelector('summary').focus();}
  });
  document.addEventListener('click',e=>{
    document.querySelectorAll('.fp-header details[open]').forEach(m=>{if(!m.contains(e.target)||e.target.closest('a'))m.open=false;});
  });

  render();
})();
