/* property-ai.js — Reusable Property World AI advisor
 * Include with: <script src="/js/property-ai.js"></script>
 * Configure per page via: PropertyAI.configure({ ... })
 */
(function () {
  'use strict';

  /* ---------- Config (overridable via configure) ---------- */
  const config = {
    storageKey: 'pw-ai-history',
    title: 'Property AI Advisor',
    subtitle: 'Search & filter listings',
    page: null,
    greeting: "Hi — tell me what you're looking for and I'll filter the listings. Try \"villas in Portugal under $5M with a pool\".",
    placeholder: 'Ask about properties…',
    quickPrompts: [
      'Villas in Portugal under $5M',
      'Rentals in London',
      'Commercial in Dubai',
      'Vineyards in Italy'
    ],
    parseQuery: null,   // (query) => parsed|null   — parent-provided
    onSearch:   null,   // (parsed, raw) => string   — parent-provided
    onReply:    null,   // (query) => string|Promise — parent-provided fallback
    onDeleteAll:null,   // () => void
    maxMessagesPerChat: 200
  };

  /* ---------- Utils ---------- */
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2, 9));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  /* ---------- Storage ---------- */
  const store = {
    load() {
      try {
        const raw = localStorage.getItem(config.storageKey);
        if (!raw) return { conversations: [], activeId: null };
        const s = JSON.parse(raw);
        if (!Array.isArray(s.conversations)) return { conversations: [], activeId: null };
        return s;
      } catch { return { conversations: [], activeId: null }; }
    },
    save(s) {
      try { localStorage.setItem(config.storageKey, JSON.stringify(s)); } catch {}
    }
  };
  let state = store.load();

  /* ---------- Styles ---------- */
  const CSS = `
    .pw-ai-fab{position:fixed;right:18px;bottom:22px;z-index:130;display:inline-flex;align-items:center;gap:9px;background:#151515;color:#fff;padding:12px 18px;border-radius:100px;box-shadow:0 10px 30px rgba(0,0,0,.25);font:500 14px/1 'Inter',-apple-system,sans-serif;transition:.15s;border:0;cursor:pointer}
    .pw-ai-fab:hover{background:#000}
    .pw-ai-fab svg{width:17px;height:17px;stroke:currentColor;fill:none;stroke-width:1.8;flex-shrink:0}
    .pw-ai-fab .pw-ai-spark{color:#EDB458}

    .pw-ai-panel{position:fixed;right:18px;bottom:86px;width:384px;max-width:calc(100vw - 32px);height:min(560px,calc(100vh - 160px));background:#fff;border:1px solid #e0e0e0;border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.22);z-index:150;display:none;flex-direction:column;overflow:hidden;font-family:'Inter',-apple-system,sans-serif;color:#151515}
    .pw-ai-panel.open{display:flex}

    .pw-ai-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #e0e0e0;background:linear-gradient(180deg,#fff,#fafbfd);flex-shrink:0}
    .pw-ai-title{font-weight:600;font-size:14px;line-height:1.2;min-width:0}
    .pw-ai-title small{display:block;font-weight:400;color:#717171;font-size:12px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pw-ai-title .mark{color:#EDB458;margin-right:4px}
    .pw-ai-head-actions{margin-left:auto;display:flex;gap:2px;flex-shrink:0}
    .pw-ai-iconbtn{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#717171;background:none;border:0;cursor:pointer;transition:background .15s,color .15s}
    .pw-ai-iconbtn:hover{background:#f5f5f5;color:#151515}
    .pw-ai-iconbtn svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2}

    .pw-ai-body{position:relative;flex:1;min-height:0;display:flex;flex-direction:column}
    .pw-ai-view{position:absolute;inset:0;display:none;flex-direction:column;background:#fff}
    .pw-ai-view.active{display:flex}

    .pw-ai-log{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;background:#fcfcfd;min-height:120px}
    .pw-ai-msg{display:flex}
    .pw-ai-msg.me{justify-content:flex-end}
    .pw-ai-bubble{max-width:86%;padding:10px 13px;border-radius:12px;font-size:13.5px;line-height:1.5;word-wrap:break-word}
    .pw-ai-msg.ai  .pw-ai-bubble{background:#fff;border:1px solid #e0e0e0;border-bottom-left-radius:4px}
    .pw-ai-msg.me  .pw-ai-bubble{background:#245b98;color:#fff;border-bottom-right-radius:4px}
    .pw-ai-msg.typing .pw-ai-bubble{color:#adadad;letter-spacing:2px}
    .pw-ai-msg.err .pw-ai-bubble{background:#fdf2f2;border-color:#f5c2c2;color:#922b21}

    .pw-ai-quick{display:flex;gap:6px;flex-wrap:wrap;padding:10px 12px;border-top:1px solid #eee;flex-shrink:0;background:#fff}
    .pw-ai-quick button{font:400 12px/1 'Inter',-apple-system,sans-serif;padding:7px 10px;border-radius:100px;border:1px solid #e0e0e0;color:#717171;background:#fff;transition:.15s;cursor:pointer}
    .pw-ai-quick button:hover{border-color:#245b98;color:#245b98}

    .pw-ai-form{display:flex;gap:8px;padding:12px;border-top:1px solid #e0e0e0;background:#fff;flex-shrink:0}
    .pw-ai-input{flex:1;border:1px solid #e0e0e0;border-radius:100px;padding:10px 14px;font:400 13.5px/1 'Inter',-apple-system,sans-serif;outline:none;min-width:0;color:#151515}
    .pw-ai-input:focus{border-color:#245b98}
    .pw-ai-send{width:38px;height:38px;border-radius:50%;background:#245b98;color:#fff;font-size:15px;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:0;cursor:pointer}
    .pw-ai-send:hover{background:#1c4a7d}

    /* History */
    .pw-ai-history{flex:1;display:flex;flex-direction:column;min-height:0}
    .pw-ai-history-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #e0e0e0;background:#fafbfd}
    .pw-ai-history-head h3{font:600 13px/1 'Inter',-apple-system,sans-serif;margin:0;color:#151515;letter-spacing:.02em}
    .pw-ai-history-head .pw-ai-iconbtn{margin-left:auto}
    .pw-ai-history-head .pw-ai-iconbtn + .pw-ai-iconbtn{margin-left:0}
    .pw-ai-history-list{flex:1;overflow-y:auto;padding:8px}
    .pw-ai-history-item{display:flex;align-items:center;gap:8px;padding:11px 10px 11px 12px;border-radius:8px;cursor:pointer;transition:background .15s;position:relative;border:0;background:transparent;width:100%;text-align:left;font:inherit;color:inherit}
    .pw-ai-history-item:hover{background:#f5f5f5}
    .pw-ai-history-item.active{background:#eef3f9}
    .pw-ai-history-item-body{flex:1;min-width:0}
    .pw-ai-history-item-title{font:500 13.5px/1.35 'Inter',-apple-system,sans-serif;color:#151515;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pw-ai-history-item-meta{font:400 11.5px/1.3 'Inter',-apple-system,sans-serif;color:#717171;margin-top:2px}
    .pw-ai-history-item-del{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#adadad;background:none;border:0;cursor:pointer;flex-shrink:0;opacity:0;transition:opacity .15s,background .15s,color .15s}
    .pw-ai-history-item:hover .pw-ai-history-item-del,
    .pw-ai-history-item:focus-within .pw-ai-history-item-del{opacity:1}
    .pw-ai-history-item-del:hover{background:#fdf2f2;color:#c0392b}
    .pw-ai-history-item-del svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2}
    .pw-ai-history-empty{text-align:center;padding:40px 20px;color:#717171;font-size:13px;line-height:1.6}
    .pw-ai-history-empty strong{display:block;font-size:14px;color:#151515;margin-bottom:6px;font-weight:600}

    /* Confirm */
    .pw-ai-confirm{position:absolute;inset:0;background:rgba(15,15,15,.5);display:none;align-items:center;justify-content:center;padding:20px;z-index:10}
    .pw-ai-confirm.open{display:flex}
    .pw-ai-confirm-card{background:#fff;border-radius:10px;padding:20px;width:100%;max-width:300px;box-shadow:0 20px 50px rgba(0,0,0,.3)}
    .pw-ai-confirm-card h4{font:600 15px/1.3 'Inter',-apple-system,sans-serif;margin:0 0 6px;color:#151515}
    .pw-ai-confirm-card p{font:400 13px/1.5 'Inter',-apple-system,sans-serif;margin:0 0 16px;color:#717171}
    .pw-ai-confirm-actions{display:flex;gap:8px;justify-content:flex-end}
    .pw-ai-confirm-actions button{padding:9px 16px;border-radius:6px;font:600 13px/1 'Inter',-apple-system,sans-serif;cursor:pointer;border:0}
    .pw-ai-confirm-actions .cancel{background:#f5f5f5;color:#717171}
    .pw-ai-confirm-actions .danger{background:#c0392b;color:#fff}

    @media(max-width:700px){
      .pw-ai-fab{bottom:22px;right:14px;padding:0;width:46px;height:46px;justify-content:center}
      .pw-ai-fab span{display:none}
      .pw-ai-panel{right:8px;left:8px;width:auto;bottom:78px;height:calc(100vh - 160px)}
    }
  `;

  /* ---------- DOM skeleton (static; config applied after) ---------- */
  const FAB_HTML = `
    <button class="pw-ai-fab" id="pwAiFab" type="button" aria-label="Ask the AI advisor">
      <svg viewBox="0 0 24 24" class="pw-ai-spark"><path d="M12 2l1.9 5.7L20 9.5l-5.2 3.6L15.8 19 12 15.4 8.2 19l1-5.9L4 9.5l6.1-1.8z"/></svg>
      <span>Ask AI</span>
    </button>`;

  const PANEL_HTML = `
    <div class="pw-ai-panel" id="pwAiPanel" role="dialog" aria-label="Property AI advisor">
      <div class="pw-ai-head">
        <div class="pw-ai-title" id="pwAiTitle"></div>
        <div class="pw-ai-head-actions">
          <button class="pw-ai-iconbtn" id="pwAiNew" type="button" title="New chat" aria-label="New chat">
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <button class="pw-ai-iconbtn" id="pwAiHist" type="button" title="History" aria-label="Chat history">
            <svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>
          </button>
          <button class="pw-ai-iconbtn" id="pwAiClose" type="button" title="Close" aria-label="Close">
            <svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      <div class="pw-ai-body">
        <div class="pw-ai-view active" data-view="chat">
          <div class="pw-ai-log" id="pwAiLog"></div>
          <div class="pw-ai-quick" id="pwAiQuick"></div>
          <form class="pw-ai-form" id="pwAiForm">
            <input class="pw-ai-input" id="pwAiInput" autocomplete="off" aria-label="Message">
            <button class="pw-ai-send" type="submit" aria-label="Send">→</button>
          </form>
        </div>
        <div class="pw-ai-view" data-view="history">
          <div class="pw-ai-history">
            <div class="pw-ai-history-head">
              <h3>Conversations</h3>
              <button class="pw-ai-iconbtn" id="pwAiDeleteAll" type="button" title="Delete all" aria-label="Delete all conversations">
                <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              </button>
              <button class="pw-ai-iconbtn" id="pwAiBack" type="button" title="Back to chat" aria-label="Back to chat">
                <svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
              </button>
            </div>
            <div class="pw-ai-history-list" id="pwAiHistoryList"></div>
          </div>
        </div>
        <div class="pw-ai-confirm" id="pwAiConfirm">
          <div class="pw-ai-confirm-card">
            <h4 id="pwAiConfirmTitle">Delete?</h4>
            <p id="pwAiConfirmMsg">This action cannot be undone.</p>
            <div class="pw-ai-confirm-actions">
              <button class="cancel" type="button" id="pwAiConfirmNo">Cancel</button>
              <button class="danger" type="button" id="pwAiConfirmYes">Delete</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  /* ---------- Injection ---------- */
  function injectStyles() {
    if (document.getElementById('pwAiStyles')) return;
    const s = document.createElement('style');
    s.id = 'pwAiStyles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function injectDOM() {
    if (document.getElementById('pwAiRoot')) return;
    const wrap = document.createElement('div');
    wrap.id = 'pwAiRoot';
    wrap.innerHTML = FAB_HTML + PANEL_HTML;
    document.body.appendChild(wrap);
  }

  /* ---------- State helpers ---------- */
  const getActive = () => state.conversations.find(c => c.id === state.activeId) || null;

  function createConv() {
  
    return { id: uid(), title: 'New chat', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
  }

  /* Best-effort server sync — localStorage remains the source of truth. */
  const serverSync = {
    timer: null,
    inFlight: false,
    pending: null,
    schedule(conv) {
      this.pending = conv;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), 1200);
    },
    async flush() {
      if (this.inFlight || !this.pending) return;
      const conv = this.pending;
      this.pending = null;
      this.inFlight = true;
      try {
        await fetch('/api/ai/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            client_id: conv.id,
            title: conv.title,
            page: config.page || null,
            messages: conv.messages
          })
        });
      } catch (err) {
        console.warn('[PropertyAI] server sync failed', err);
      } finally {
        this.inFlight = false;
      }
    },
    flushOnUnload() {
      if (!this.pending) return;
      const conv = this.pending;
      this.pending = null;
      try {
        navigator.sendBeacon(
          '/api/ai/conversations',
          new Blob([JSON.stringify({
            client_id: conv.id,
            title: conv.title,
            page: config.page || null,
            messages: conv.messages
          })], { type: 'application/json' })
        );
      } catch {}
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    }
  };

  function persist() {
    if (state.conversations.length > 50) state.conversations = state.conversations.slice(0, 50);
    store.save(state);
    const conv = getActive();
    if (conv && conv.id && conv.messages && conv.messages.length > 0) {
      serverSync.schedule(conv);
    }
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    const days = Math.floor((now - d) / 86400000);
    if (days < 7) return days + ' days ago';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  /* ---------- Refs ---------- */
  const els = {};
  function mountRefs() {
    ['Fab','Panel','Log','Quick','Form','Input','New','Hist','Close','HistoryList','DeleteAll','Back','Confirm','ConfirmTitle','ConfirmMsg','ConfirmYes','ConfirmNo'].forEach(k => {
      els[k] = document.getElementById('pwAi' + k);
    });
    els.views = $$('.pw-ai-view', els.Panel);
  }

  function applyConfig() {
    if (!els.Panel) return;
    els.Panel.setAttribute('aria-label', config.title);
    document.getElementById('pwAiTitle').innerHTML =
      `<span class="mark">✦</span>${esc(config.title)}<small>${esc(config.subtitle)}</small>`;
    els.Input.placeholder = config.placeholder;
    renderQuick();
  }

  /* ---------- Render ---------- */
  function renderQuick() {
    els.Quick.innerHTML = '';
    (config.quickPrompts || []).forEach(q => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = q;
      b.addEventListener('click', () => sendMessage(q));
      els.Quick.appendChild(b);
    });
  }

  function appendBubble(role, text) {
    const wrap = document.createElement('div');
    wrap.className = 'pw-ai-msg ' + role;
    const b = document.createElement('div');
    b.className = 'pw-ai-bubble';
    b.textContent = text;
    wrap.appendChild(b);
    els.Log.appendChild(wrap);
    els.Log.scrollTop = els.Log.scrollHeight;
    return wrap;
  }

  function renderMessages() {
    const conv = getActive();
    els.Log.innerHTML = '';
    if (!conv || conv.messages.length === 0) {
      appendBubble('ai', config.greeting);
    } else {
      conv.messages.forEach(m => appendBubble(m.role, m.text));
    }
    els.Log.scrollTop = els.Log.scrollHeight;
  }

  function pushMessage(role, text) {
    let conv = getActive();
    if (!conv) {
      conv = createConv();
      state.conversations.unshift(conv);
      state.activeId = conv.id;
    }
    conv.messages.push({ role, text, ts: Date.now() });
    conv.updatedAt = Date.now();
    if (role === 'user' && (conv.title === 'New chat' || !conv.title)) {
      conv.title = text.length > 44 ? text.slice(0, 44) + '…' : text;
    }
    if (conv.messages.length > config.maxMessagesPerChat) {
      conv.messages = conv.messages.slice(-config.maxMessagesPerChat);
    }
    persist();
    appendBubble(role, text);
  }

  function setView(name) {
    els.views.forEach(v => v.classList.toggle('active', v.dataset.view === name));
    if (name === 'history') renderHistory();
  }

  function renderHistory() {
    els.HistoryList.innerHTML = '';
    const sorted = [...state.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    if (sorted.length === 0) {
      els.HistoryList.innerHTML = `<div class="pw-ai-history-empty"><strong>No conversations yet</strong>Start a new chat to see it here.</div>`;
      return;
    }
    sorted.forEach(c => {
      const item = document.createElement('div');
      item.className = 'pw-ai-history-item' + (c.id === state.activeId ? ' active' : '');
      item.innerHTML = `
        <div class="pw-ai-history-item-body">
          <div class="pw-ai-history-item-title">${esc(c.title || 'Untitled')}</div>
          <div class="pw-ai-history-item-meta">${fmtTime(c.updatedAt)} · ${c.messages.length} message${c.messages.length === 1 ? '' : 's'}</div>
        </div>
        <button class="pw-ai-history-item-del" type="button" aria-label="Delete conversation" title="Delete">
          <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>`;
      item.addEventListener('click', e => {
        if (e.target.closest('.pw-ai-history-item-del')) return;
        state.activeId = c.id;
        persist();
        renderMessages();
        setView('chat');
      });
      item.querySelector('.pw-ai-history-item-del').addEventListener('click', e => {
        e.stopPropagation();
        openConfirm('Delete conversation?', `“${c.title || 'Untitled'}” will be permanently removed.`, () => {
          state.conversations = state.conversations.filter(x => x.id !== c.id);
          if (state.activeId === c.id) state.activeId = state.conversations[0]?.id || null;
          persist();
          renderHistory();
          renderMessages();
        });
      });
      els.HistoryList.appendChild(item);
    });
  }

  /* ---------- Confirm ---------- */
  let pendingConfirm = null;
  function openConfirm(title, msg, onYes) {
    els.ConfirmTitle.textContent = title;
    els.ConfirmMsg.textContent = msg;
    els.Confirm.classList.add('open');
    pendingConfirm = onYes;
  }
  function closeConfirm() { els.Confirm.classList.remove('open'); pendingConfirm = null; }

  /* ---------- Chat flow ---------- */
  let sending = false;

  
  async function sendMessage(text) {
    const q = (text || '').trim();
    if (!q || sending) return;
    sending = true;

    pushMessage('user', q);
    els.Input.value = '';

    const typing = document.createElement('div');
    typing.className = 'pw-ai-msg ai typing';
    typing.innerHTML = '<div class="pw-ai-bubble">…</div>';
    els.Log.appendChild(typing);
    els.Log.scrollTop = els.Log.scrollHeight;

    try {
      const reply = await generateReply(q);
      typing.remove();
      pushMessage('ai', reply);
    } catch (err) {
      console.error('[PropertyAI]', err);
      typing.remove();
      const e = document.createElement('div');
      e.className = 'pw-ai-msg err';
      e.innerHTML = '<div class="pw-ai-bubble">Sorry, something went wrong. Please try again.</div>';
      els.Log.appendChild(e);
      els.Log.scrollTop = els.Log.scrollHeight;
    } finally {
      sending = false;
    }
  }

  async function generateReply(query) {
    /* 1. Parent page search pipeline (parse + apply) */
    if (typeof config.parseQuery === 'function' && typeof config.onSearch === 'function') {
      try {
        const parsed = config.parseQuery(query);
        const meaningful = parsed && (
          (parsed.matched && parsed.matched.length > 0) ||
          parsed.mode || parsed.category ||
          (parsed.types && parsed.types.length) ||
          (parsed.amenities && parsed.amenities.length) ||
          parsed.location || parsed.priceMax != null || parsed.priceMin != null ||
          parsed.beds || parsed.newBuild
        );
        if (meaningful) {
          const reply = await config.onSearch(parsed, query);
          if (reply) return reply;
        }
      } catch (e) { console.warn('[PropertyAI] search hook failed', e); }
    }
    /* 2. Parent page reply hook (single-listing pages, custom copy) */
    if (typeof config.onReply === 'function') {
      try {
        const r = await config.onReply(query);
        if (r) return r;
      } catch (e) { console.warn('[PropertyAI] reply hook failed', e); }
    }
    /* 3. Fallback */
    return "I can help you search listings. Try phrases like 'villas in Portugal under $5M with a pool' or 'rentals in London'. On pages with a search feature, I'll apply the filters for you.";
  }

  /* ---------- Open/close ---------- */
  function open() {
    els.Panel.classList.add('open');
    setView('chat');
    renderMessages();
    setTimeout(() => els.Input.focus(), 120);
  }
  function close() { els.Panel.classList.remove('open'); }
  function toggle() { els.Panel.classList.contains('open') ? close() : open(); }

  /* ---------- Wire ---------- */
  function wire() {
    els.Fab.addEventListener('click', toggle);
    els.Close.addEventListener('click', close);
    els.New.addEventListener('click', () => {
      const c = createConv();
      state.conversations.unshift(c);
      state.activeId = c.id;
      persist();
      renderMessages();
      setView('chat');
      els.Input.focus();
    });
    els.Hist.addEventListener('click', () => setView('history'));
    els.Back.addEventListener('click', () => setView('chat'));
    els.DeleteAll.addEventListener('click', () => {
      if (!state.conversations.length) return;
      openConfirm('Delete all conversations?', 'All chat history will be permanently removed from this browser.', () => {
        state.conversations = [];
        state.activeId = null;
        persist();
        renderHistory();
        renderMessages();
        setView('chat');
        if (typeof config.onDeleteAll === 'function') config.onDeleteAll();
      });
    });
    els.ConfirmNo.addEventListener('click', closeConfirm);
    els.ConfirmYes.addEventListener('click', () => {
      const fn = pendingConfirm; closeConfirm(); if (fn) fn();
    });
    els.Form.addEventListener('submit', e => { e.preventDefault(); sendMessage(els.Input.value); });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !els.Panel.classList.contains('open')) return;
      if (els.Confirm.classList.contains('open')) { closeConfirm(); return; }
      if (document.querySelector('.pw-ai-view[data-view="history"].active')) { setView('chat'); return; }
      close();
    });

    window.addEventListener('pagehide', () => serverSync.flushOnUnload());
    window.addEventListener('beforeunload', () => serverSync.flushOnUnload());
  }

  /* ---------- Public API ---------- */
  const API = {
    init(opts) {
      Object.assign(config, opts || {});
      injectStyles();
      injectDOM();
      mountRefs();
      applyConfig();
      wire();
      state = store.load();
      renderMessages();
      return API;
    },
    configure(opts) {
      Object.assign(config, opts || {});
      if (els.Panel) applyConfig();
      return API;
    },
    open,
    close,
    toggle,
    newChat() {
      const c = createConv();
      state.conversations.unshift(c);
      state.activeId = c.id;
      persist();
      if (els.Log) { renderMessages(); setView('chat'); }
      return c;
    },
    getConversations() { return [...state.conversations]; },
    clearHistory() {
      state.conversations = [];
      state.activeId = null;
      persist();
      if (els.Log) { renderMessages(); }
      if (els.HistoryList) renderHistory();
    },
	send(text) {
    open();
    return sendMessage(text);
  },
	say(text, opts) {
	  opts = opts || {};
	  let conv = getActive();
	  if (!conv) {
		conv = createConv();
		state.conversations.unshift(conv);
		state.activeId = conv.id;
	  }
	  conv.messages.push({ role: 'ai', text: String(text), ts: Date.now() });
	  conv.updatedAt = Date.now();
	  persist();
	  if (els.Log) {
		appendBubble('ai', text);
		if (opts.open !== false && !els.Panel.classList.contains('open')) open();
	  }
	  return conv;
	}
  };

  window.PropertyAI = API;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => API.init());
  } else {
    API.init();
  }
})();