const API_BASE = 'https://bro-codie.vercel.app';
const tokenKey = 'aid4_token';

// ======== Auth helpers (same as timeline.js) ========
function getToken() {
  return localStorage.getItem(tokenKey) || '';
}

function requireAuth() {
  const t = getToken();
  if (!t) {
    window.location.href = 'join.html';
    return null;
  }
  return t;
}

function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
    return JSON.parse(jsonPayload);
  } catch (_) {
    return {};
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '<')
    .replaceAll('>', '>')
    .replaceAll('"', '"')
    .replaceAll("'", '&#039;');
}

function fmtTime(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts * 1000);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const opts = isToday ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    return d.toLocaleString(undefined, opts);
  } catch { return ''; }
}

function fmtDateSeparator(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  const t = getToken();
  if (t) headers['Authorization'] = `Bearer ${t}`;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(API_BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });

  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data && data.error) msg = data.error;
    } catch (_) {}
    throw new Error(msg);
  }
  return res.json().catch(() => ({}));
}

// ======== State ========
let conversations = [];
let currentConvId = null;
let currentConvUser = null;
let messagesCache = {};
let pollingInterval = null;
const POLL_INTERVAL = 3000; // 3 seconds

// ======== DOM refs ========
const convListEl = document.getElementById('convList');
const convSearchEl = document.getElementById('convSearch');
const chatPlaceholder = document.getElementById('chatPlaceholder');
const activeChat = document.getElementById('activeChat');
const chatUserName = document.getElementById('chatUserName');
const chatAvatar = document.getElementById('chatAvatar');
const chatUserStatus = document.getElementById('chatUserStatus');
const messagesArea = document.getElementById('messagesArea');
const chatForm = document.getElementById('chatForm');
const msgInput = document.getElementById('msgInput');
const backBtn = document.getElementById('backBtn');
const newChatBtn = document.getElementById('newChatBtn');
const newChatModal = document.getElementById('newChatModal');
const newChatUser = document.getElementById('newChatUser');
const newChatError = document.getElementById('newChatError');
const modalCancel = document.getElementById('modalCancel');
const modalStart = document.getElementById('modalStart');
const convSidebar = document.getElementById('convSidebar');

// ======== Load Conversations ========
async function loadConversations() {
  try {
    const data = await api('/api/messages');
    conversations = Array.isArray(data.conversations) ? data.conversations : [];
    renderConversations();
  } catch (e) {
    console.warn('Failed to load conversations:', e);
  }
}

function renderConversations() {
  const q = (convSearchEl.value || '').trim().toLowerCase();
  let filtered = conversations;
  if (q) {
    filtered = conversations.filter(c => c.withUser.toLowerCase().includes(q));
  }

  if (filtered.length === 0) {
    convListEl.innerHTML = '<div class="no-convs">' + (q ? 'No conversations found' : 'No conversations yet. Start a new chat!') + '</div>';
    return;
  }

  convListEl.innerHTML = filtered.map(c => {
    const lastMsg = c.lastMessage;
    let preview = 'No messages yet';
    if (lastMsg) {
      if (lastMsg.unsent) preview = 'Message unsent';
      else preview = lastMsg.text.substring(0, 50) + (lastMsg.text.length > 50 ? '...' : '');
    }
    const initial = c.withUser.charAt(0).toUpperCase();
    const isActive = c.conversationId === currentConvId;

    return `
      <div class="conv-item ${isActive ? 'active' : ''}" data-convid="${c.conversationId}" data-user="${c.withUser}">
        <div class="conv-avatar">${initial}</div>
        <div class="conv-info">
          <div class="conv-name">${escapeHtml(c.withUser)}</div>
          <div class="conv-preview">${escapeHtml(preview)}</div>
        <div class="conv-time">${lastMsg ? fmtTime(lastMsg.createdAt) : ''}</div>
    `;
  }).join('');

  // Click handler for conversation items
  convListEl.querySelectorAll('.conv-item').forEach(el => {
    el.addEventListener('click', () => {
      const convId = el.getAttribute('data-convid');
      const user = el.getAttribute('data-user');
      openConversation(convId, user);
    });
  });
}

// ======== Open a Conversation ========
async function openConversation(convId, withUser) {
  if (currentConvId === convId) return;

  currentConvId = convId;
  currentConvUser = withUser;

  // Update sidebar highlight
  document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('active'));
  const activeItem = document.querySelector(`.conv-item[data-convid="${convId}"]`);
  if (activeItem) activeItem.classList.add('active');

  // Switch to chat panel on mobile
  if (window.innerWidth <= 860) {
    convSidebar.classList.add('hide');
    document.getElementById('chatPanel').classList.add('show');
  }

  // Update chat header
  chatUserName.textContent = withUser;
  chatAvatar.textContent = withUser.charAt(0).toUpperCase();
  chatUserStatus.textContent = 'Online';

  // Show active chat, hide placeholder
  chatPlaceholder.style.display = 'none';
  activeChat.style.display = 'flex';

  // Load messages
  await loadMessages(convId);

  // Start polling
  startPolling(convId);
}

async function loadMessages(convId) {
  try {
    const data = await api(`/api/messages/${encodeURIComponent(convId)}?limit=100`);
    const msgs = Array.isArray(data.messages) ? data.messages : [];

    // Store in cache (reverse to show oldest first)
    messagesCache[convId] = msgs.reverse();
    renderMessages(convId);
  } catch (e) {
    console.warn('Failed to load messages:', e);
  }
}

function renderMessages(convId) {
  const msgs = messagesCache[convId] || [];
  const currentUser = parseJwt(getToken()).sub;

  if (msgs.length === 0) {
    messagesArea.innerHTML = '<div class="chat-placeholder" style="flex:1;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.25);font-size:0.9rem;">Send a message to start the conversation</div>';
    return;
  }

  let html = '';
  let lastDate = null;

  for (const msg of msgs) {
    const msgDate = fmtDateSeparator(msg.createdAt);
    if (msgDate !== lastDate) {
      html += `<div class="date-separator">${msgDate}</div>`;
      lastDate = msgDate;
    }

    const isSent = msg.from === currentUser;
    const rowClass = isSent ? 'sent' : 'received';

    if (msg.unsent) {
      html += `
        <div class="message-row ${rowClass}">
          <div class="message-unsent">${isSent ? 'You unsent a message' : 'Message was unsent'}</div>
      `;
    } else {
      html += `
        <div class="message-row ${rowClass}">
          <div class="message-bubble">
            ${escapeHtml(msg.text)}
            <div class="message-time">${fmtTime(msg.createdAt)}</div>
            ${isSent ? `<button class="unsend-btn" data-msgid="${msg.id}" title="Unsend message"><i class="fas fa-times"></i></button>` : ''}
          </div>
      `;
    }
  }

  messagesArea.innerHTML = html;
  // Scroll to bottom
  messagesArea.scrollTop = messagesArea.scrollHeight;

  // Attach unsend handlers
  messagesArea.querySelectorAll('.unsend-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const msgId = btn.getAttribute('data-msgid');
      await unsendMessage(msgId);
    });
  });
}

// ======== Poll for New Messages ========
function startPolling(convId) {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(async () => {
    if (!currentConvId || currentConvId !== convId) return;
    try {
      const data = await api(`/api/messages/${encodeURIComponent(convId)}?limit=100`);
      const msgs = Array.isArray(data.messages) ? data.messages.reverse() : [];
      const currentLen = (messagesCache[convId] || []).length;

      if (msgs.length !== currentLen) {
        messagesCache[convId] = msgs;
        renderMessages(convId);
        // Also update conversation preview
        loadConversations();
      }
    } catch {}
  }, POLL_INTERVAL);
}

// ======== Send Message ========
async function handleSendMessage(e) {
  e.preventDefault();
  const text = (msgInput.value || '').trim();
  if (!text || !currentConvUser) return;

  const currentUser = parseJwt(getToken()).sub;

  // Optimistic: add message to cache immediately
  const optimisticMsg = {
    id: 'pending',
    from: currentUser,
    to: currentConvUser,
    text: text,
    createdAt: Math.floor(Date.now() / 1000),
  };

  if (messagesCache[currentConvId]) {
    messagesCache[currentConvId].push(optimisticMsg);
  } else {
    messagesCache[currentConvId] = [optimisticMsg];
  }
  renderMessages(currentConvId);
  msgInput.value = '';

  try {
    const data = await api('/api/messages', {
      method: 'POST',
      body: { to: currentConvUser, text },
    });

    if (data && data.message) {
      // Replace optimistic message with real one
      const cache = messagesCache[currentConvId] || [];
      const idx = cache.findIndex(m => m.id === 'pending');
      if (idx !== -1) cache[idx] = data.message;
      renderMessages(currentConvId);
    }

    // Refresh conversation list to update preview
    loadConversations();
  } catch (e) {
    // Remove optimistic message on failure
    const cache = messagesCache[currentConvId] || [];
    messagesCache[currentConvId] = cache.filter(m => m.id !== 'pending');
    renderMessages(currentConvId);
    alert('Failed to send message: ' + e.message);
  }
}

// ======== Unsend Message ========
async function unsendMessage(msgId) {
  if (!confirm('Unsend this message?')) return;

  // Optimistic: mark as unsent in cache
  const cache = messagesCache[currentConvId] || [];
  const msg = cache.find(m => m.id === msgId);
  if (msg) {
    msg.unsent = true;
    delete msg.text;
    renderMessages(currentConvId);
  }

  try {
    await api(`/api/messages/${encodeURIComponent(currentConvId)}`, {
      method: 'DELETE',
      body: { msgId },
    });
    loadConversations();
  } catch {
    // Reload on failure
    loadMessages(currentConvId);
  }
}

// ======== New Chat Modal ========
newChatBtn.addEventListener('click', () => {
  newChatModal.classList.add('open');
  newChatUser.value = '';
  newChatError.style.display = 'none';
  newChatUser.focus();
});

modalCancel.addEventListener('click', () => {
  newChatModal.classList.remove('open');
});

modalStart.addEventListener('click', async () => {
  const username = (newChatUser.value || '').trim();
  if (!username) {
    newChatError.textContent = 'Please enter a username';
    newChatError.style.display = 'block';
    return;
  }

  // Check if conversation already exists
  const existing = conversations.find(c => c.withUser === username);
  if (existing) {
    newChatModal.classList.remove('open');
    openConversation(existing.conversationId, existing.withUser);
    return;
  }

  // Send a first message to create conversation
  try {
    const data = await api('/api/messages', {
      method: 'POST',
      body: { to: username, text: '👋 Hello!' },
    });

    if (data && data.ok) {
      newChatModal.classList.remove('open');
      await loadConversations();
      // Find the new conversation and open it
      const newConv = conversations.find(c => c.withUser === username);
      if (newConv) openConversation(newConv.conversationId, newConv.withUser);
    }
  } catch (e) {
    newChatError.textContent = e.message || 'Failed to start conversation';
    newChatError.style.display = 'block';
  }
});

// Enter key in modal
newChatUser.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') modalStart.click();
});

// ======== Back button (mobile) ========
backBtn.addEventListener('click', () => {
  convSidebar.classList.remove('hide');
  document.getElementById('chatPanel').classList.remove('show');
  if (pollingInterval) clearInterval(pollingInterval);
  currentConvId = null;
  currentConvUser = null;
});

// ======== Search ========
convSearchEl.addEventListener('input', () => renderConversations());

// ======== Logout ========
function handleLogout() {
  if (pollingInterval) clearInterval(pollingInterval);
  localStorage.removeItem(tokenKey);
  window.location.href = 'join.html';
}

// Add logout button to sidebar header
document.querySelector('.sidebar-header').insertAdjacentHTML('beforeend', `
  <button class="new-chat-btn" id="logoutBtnMsg" title="Logout" style="background:rgba(239,68,68,0.15);border-color:rgba(239,68,68,0.3);color:#ef4444;margin-left:auto;">
    <i class="fas fa-sign-out-alt"></i>
  </button>
`);
document.getElementById('logoutBtnMsg').addEventListener('click', handleLogout);

// ======== Init ========
window.addEventListener('DOMContentLoaded', async () => {
  requireAuth();
  await loadConversations();
});
