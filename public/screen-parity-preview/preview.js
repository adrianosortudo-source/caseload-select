(() => {
  'use strict';
  const element = id => document.getElementById(id);
  const area = element('preview-area');
  const examples = element('preview-example');
  const restart = element('preview-reset');
  const sms = element('preview-sms');
  const text = element('preview-text');
  const messages = element('preview-messages');
  const form = element('preview-send');
  const host = element('preview-widget-host');
  const report = element('preview-report');
  const reportHost = element('preview-report-host');
  const template = {
    corporate: ['Business contract', 'I need a lawyer to review a contract for my business.'],
    real_estate: ['Buying a home', "I'm buying my first home and need a lawyer for the closing."],
    employment: ['Workplace change', 'My employer ended my job and I need advice about the paperwork.'],
    estates: ['Making a will', 'I would like a lawyer to help me prepare a will.'],
    family: ['Parenting arrangements', 'I need family law help with parenting arrangements after a separation.'],
  };
  let channel = 'website';
  let widget, ready = false, pending, reportObserver;

  // The website nav continues to take visitors to the public website. The
  // functional demo, its assets and the rendered brief all stay on this origin.
  document.querySelectorAll('[data-site-header] a[href^="/"], [data-site-footer] a[href^="/"]').forEach(link => {
    link.href = new URL(link.getAttribute('href'), 'https://caseloadselect.ca').href;
  });

  function discardWidget() {
    ready = false;
    pending = undefined;
    widget = undefined;
    host.replaceChildren();
    host.hidden = true;
    reportObserver?.disconnect();
    reportHost.replaceChildren();
    report.hidden = true;
  }
  function deliver(message) {
    if (ready && widget?.contentWindow) widget.contentWindow.postMessage(message, location.origin);
    else pending = message;
  }
  function mount(opener) {
    widget = document.createElement('iframe');
    widget.title = 'Interactive Screen enquiry';
    widget.scrolling = 'no';
    widget.style.height = '430px';
    const url = new URL('/tools/screen/parity', location.origin);
    url.searchParams.set('practice_area', area.value);
    url.searchParams.set('channel', channel);
    url.searchParams.set('external_report', '1');
    widget.src = url.href;
    host.replaceChildren(widget);
    host.hidden = false;
    if (opener) deliver(opener);
  }
  function reset() {
    discardWidget();
    const selected = Object.hasOwn(template, area.value);
    const workspace = element('preview-workspace');
    workspace.hidden = !selected;
    workspace.classList.toggle('with-sms', channel === 'sms');
    element('preview-prompt').hidden = selected;
    restart.disabled = !selected;
    examples.replaceChildren(new Option('Choose an example…', ''));
    examples.disabled = !selected;
    text.value = '';
    text.style.height = '';
    messages.replaceChildren();
    form.hidden = false;
    sms.hidden = channel !== 'sms';
    if (!selected) return;
    examples.add(new Option(template[area.value][0], template[area.value][1]));
    if (channel !== 'sms') mount();
  }
  function growText() {
    text.style.height = 'auto';
    text.style.height = text.scrollHeight + 2 + 'px';
  }
  area.addEventListener('change', reset);
  restart.addEventListener('click', reset);
  document.querySelectorAll('input[name="channel"]').forEach(input => {
    input.addEventListener('change', () => { channel = input.value; reset(); });
  });
  examples.addEventListener('change', () => {
    if (!examples.value) return;
    if (channel === 'sms') {
      text.value = examples.value; growText(); text.focus();
    } else {
      deliver({type: 'caseload-demo-prefill', opening: examples.value});
    }
  });
  text.addEventListener('input', growText);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const opening = text.value.trim();
    if (!opening || !area.value || channel !== 'sms') return;
    const sent = document.createElement('p');
    sent.className = 'preview-sent'; sent.textContent = opening;
    const reply = document.createElement('div');
    reply.className = 'preview-reply';
    reply.append('Thanks for your message. Please continue your enquiry using this link.');
    const link = document.createElement('a');
    link.href = '#preview-widget-host';
    link.textContent = 'Continue your enquiry';
    link.addEventListener('click', click => {
      click.preventDefault();
      if (!widget) mount({type: 'caseload-demo-start', opening, phone: '(416) 555-0148'});
      widget?.focus({preventScroll: true});
      if (window.matchMedia('(max-width: 760px)').matches) host.scrollIntoView({block: 'nearest'});
    });
    reply.append(link); messages.replaceChildren(sent, reply); form.hidden = true; examples.disabled = true;
  });
  function renderReport(html) {
    reportObserver?.disconnect();
    const frame = document.createElement('iframe');
    frame.title = 'Full lawyer brief';
    frame.scrolling = 'no';
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.addEventListener('load', () => {
      if (!frame.isConnected || !frame.contentDocument?.body) return;
      const doc = frame.contentDocument;
      const article = doc.querySelector('.brief-frame') || doc.body.firstElementChild || doc.body;
      const resize = () => {
        const bounds = article.getBoundingClientRect();
        const bottom = Math.max(bounds.bottom, bounds.top + article.scrollHeight);
        frame.style.height = Math.max(1, Math.ceil(bottom + doc.documentElement.scrollTop)) + 'px';
      };
      reportObserver = new ResizeObserver(resize);
      reportObserver.observe(article); resize();
      doc.fonts.ready.then(resize);
    });
    frame.srcdoc = html; report.hidden = false; reportHost.replaceChildren(frame);
  }
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || !widget || event.source !== widget.contentWindow) return;
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'caseload-demo-ready') {
      ready = true;
      if (pending) { const next = pending; pending = undefined; deliver(next); }
    } else if (message.type === 'caseload-widget-resize' && Number.isFinite(message.height) && message.height > 0) {
      widget.style.height = Math.ceil(message.height) + 'px';
    } else if (message.type === 'caseload-demo-report' && typeof message.html === 'string' && message.html.trim()) {
      renderReport(message.html);
    }
  });
  const initial = new URLSearchParams(location.search).get('demo');
  const allowed = [...document.querySelectorAll('input[name="channel"]')];
  const tab = allowed.find(input => input.value === (initial === 'widget' ? 'website' : initial));
  if (tab) {tab.checked = true; channel = tab.value;}
  reset();
})();
