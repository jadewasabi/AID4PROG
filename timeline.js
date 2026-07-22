const API_BASE = 'https://aid-4-prog.vercel.app';

const tokenKey = 'aid4_token';

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

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  const t = getToken();
  if (t) headers['Authorization'] = `Bearer ${t}`;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

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
    return new Date(ts * 1000).toLocaleString();
  } catch (_) {
    return '';
  }
}

function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (_) {
    return {};
  }
}

// ======== In-Memory Cache ========
let allPosts = [];
let postsCache = { ids: [], timestamp: 0 };
const CACHE_TTL = 5000; // 5 seconds before refresh
let pendingCommentFetches = {};

// ======== Debounce Utility ========
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ======== Load Posts with Cache ========
async function loadPosts(forceRefresh = false) {
  const now = Date.now();
  const cached = postsCache;

  // Stale-while-revalidate: show cached data if fresh, refresh in background
  if (!forceRefresh && cached.ids.length > 0 && now - cached.timestamp < CACHE_TTL) {
    return applySearchAndRender();
  }

  // Refresh in background even if cache is slightly stale
  if (!forceRefresh && cached.ids.length > 0 && now - cached.timestamp < CACHE_TTL * 2) {
    applySearchAndRender(); // show current cache
    // Refresh in background
    fetchAndUpdatePosts();
    return;
  }

  await fetchAndUpdatePosts();
}

async function fetchAndUpdatePosts() {
  try {
    const data = await api('/api/posts?limit=50');
    allPosts = Array.isArray(data.posts) ? data.posts : [];
    postsCache = {
      ids: allPosts.map(p => p.id),
      timestamp: Date.now(),
    };
    applySearchAndRender();
  } catch (e) {
    console.warn('Failed to fetch posts:', e);
  }
}

// ======== Lazy Load Comments ========
async function loadCommentsForPost(postId, commentListEl) {
  if (pendingCommentFetches[postId]) return;
  pendingCommentFetches[postId] = true;

  try {
    const data = await api(`/api/posts/${encodeURIComponent(postId)}/comment?limit=10`);
    const comments = Array.isArray(data.comments) ? data.comments : [];

    // Update local cache
    const post = allPosts.find(p => String(p.id) === String(postId));
    if (post) post._comments = comments;

    // Render comments into the list element
    renderComments(commentListEl, comments);
  } catch (e) {
    console.warn('Failed to load comments:', e);
  } finally {
    delete pendingCommentFetches[postId];
  }
}

function renderComments(commentListEl, comments) {
  if (!comments || comments.length === 0) {
    commentListEl.innerHTML = '<div class="small">No comments yet.</div>';
    return;
  }
  commentListEl.innerHTML = comments
    .slice(-5)
    .reverse()
    .map(
      (c) =>
        `<div class="comment"><strong>${escapeHtml(c.username)}</strong>: ${escapeHtml(
          c.text
        )}</div>`
    )
    .join('');
}

// ======== Render Posts ========
function renderPosts(filtered) {
  const postsEl = document.getElementById('posts');
  postsEl.innerHTML = '';

  if (!filtered.length) {
    postsEl.innerHTML = '<div class="small">No posts yet.</div>';
    return;
  }

  const currentUser = parseJwt(getToken()).sub;

  for (const p of filtered) {
    const el = document.createElement('div');
    el.className = 'post';

    const isOwner = currentUser === p.username;
    const commentCount = p.commentCount || 0;

    el.innerHTML = `
      <div class="post-head">
        <div>
          <div class="post-user">${escapeHtml(p.username)}</div>
          <div class="post-meta">${escapeHtml(fmtTime(p.createdAt))}</div>
        </div>
        <div class="post-meta" style="display:flex;gap:8px;align-items:center;">
          <span>#${escapeHtml(String(p.id))}</span>
          ${isOwner ? `<button class="btn delete-btn" data-delete="${p.id}" title="Delete your post">🗑️ Delete</button>` : ''}
        </div>
      </div>

      ${p.imageUrl ? `<div class="post-img"><img src="${escapeHtml(p.imageUrl)}" alt="post image" /></div>` : ''}

      ${p.text ? `<div class="post-content">${escapeHtml(p.text)}</div>` : ''}

      <div class="actions">
        <button class="btn react-btn upvote-btn" data-react="upvote" data-postid="${p.id}" title="Upvote to push to top">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="18 15 12 9 6 15"></polyline>
          </svg>
          Upvote
        </button>
      </div>

      <div class="comment-box">
        <div class="comment-list" data-commentlist="${p.id}">
          <div class="small">Loading comments... ${commentCount > 0 ? `(${commentCount} total)` : ''}</div>
        </div>
        <form class="comment-form" data-commentform="${p.id}">
          <input type="text" required maxlength="300" placeholder="Write a comment..." />
          <button class="btn" type="submit">Comment</button>
        </form>
      </div>
    `;

    postsEl.appendChild(el);

    // Lazy load comments
    const commentListEl = el.querySelector(`[data-commentlist="${p.id}"]`);
    if (commentListEl) {
      // If we already have cached comments, show them immediately
      if (p._comments) {
        renderComments(commentListEl, p._comments);
      } else {
        loadCommentsForPost(p.id, commentListEl);
      }
    }
  }
}

function applySearchAndRender() {
  const q = (document.getElementById('search').value || '').trim().toLowerCase();
  if (!q) return renderPosts(allPosts);

  const filtered = allPosts.filter((p) => {
    return (
      String(p.username || '').toLowerCase().includes(q) ||
      String(p.text || '').toLowerCase().includes(q)
    );
  });

  renderPosts(filtered);
}

// Debounced search
const debouncedSearch = debounce(applySearchAndRender, 200);

// ======== Optimistic Update Helpers ========
function updatePostInCache(postId, updater) {
  const idx = allPosts.findIndex(p => String(p.id) === String(postId));
  if (idx === -1) return null;
  allPosts[idx] = updater(allPosts[idx]);
  return allPosts[idx];
}

// ======== Handlers ========
async function handleCreatePost(e) {
  e.preventDefault();
  const t = requireAuth();
  if (!t) return;

  const textEl = document.getElementById('postText');
  const fileInput = document.getElementById('postImage');

  const text = (textEl.value || '').trim();
  let imageUrl = '';

  const maybeFiles = fileInput?.files;
  if (maybeFiles && maybeFiles[0]) {
    imageUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(maybeFiles[0]);
    });
  } else if (fileInput && fileInput.type === 'text') {
    imageUrl = (fileInput.value || '').trim();
  }

  if (!text && !imageUrl) {
    const err = document.getElementById('postError');
    err.style.display = 'block';
    err.textContent = 'Write something or provide an image URL.';
    return;
  }

  // Optimistic: add post immediately before server responds
  const optimisticPost = {
    id: '...',
    username: parseJwt(getToken()).sub,
    text: text || null,
    imageUrl: imageUrl || null,
    createdAt: Math.floor(Date.now() / 1000),
    reactions: { likes: 0, loves: 0 },
    _comments: [],
    commentCount: 0,
  };
  allPosts.unshift(optimisticPost);
  applySearchAndRender();

  try {
    const data = await api('/api/posts', { method: 'POST', body: { text: text || null, imageUrl: imageUrl || null } });
    textEl.value = '';
    if (fileInput) fileInput.value = '';
    document.getElementById('postError').style.display = 'none';

    // Replace optimistic post with real one
    if (data && data.post) {
      const idx = allPosts.findIndex(p => p.id === '...');
      if (idx !== -1) {
        data.post._comments = [];
        data.post.commentCount = 0;
        allPosts[idx] = data.post;
      }
    }
    applySearchAndRender();
  } catch (e) {
    // Remove optimistic post on failure
    allPosts = allPosts.filter(p => p.id !== '...');
    applySearchAndRender();
    const err = document.getElementById('postError');
    err.style.display = 'block';
    err.textContent = e.message || 'Failed to create post.';
  }
}

async function handleCommentSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const postId = form.getAttribute('data-commentform');
  const input = form.querySelector('input');
  const text = (input.value || '').trim();
  if (!text) return;

  const currentUser = parseJwt(getToken()).sub;

  // Optimistic: add comment to cache immediately
  const optimisticComment = { username: currentUser, text, createdAt: Math.floor(Date.now() / 1000) };
  const post = updatePostInCache(postId, p => {
    const comments = p._comments || [];
    p._comments = [...comments, optimisticComment];
    p.commentCount = (p.commentCount || 0) + 1;
    return p;
  });

  // Update UI immediately
  const commentListEl = document.querySelector(`[data-commentlist="${postId}"]`);
  if (commentListEl && post) renderComments(commentListEl, post._comments);

  input.value = '';

  try {
    await api(`/api/posts/${encodeURIComponent(postId)}/comment`, {
      method: 'POST',
      body: { text },
    });
  } catch (e) {
    // Rollback on failure
    updatePostInCache(postId, p => {
      p._comments = (p._comments || []).filter(c => c !== optimisticComment);
      p.commentCount = Math.max(0, (p.commentCount || 1) - 1);
      return p;
    });
    if (commentListEl && post) renderComments(commentListEl, post._comments);
  }
}

async function handleReactClick(e) {
  const btn = e.target.closest('[data-react]');
  if (!btn) return;

  const postId = btn.getAttribute('data-postid');
  const type = btn.getAttribute('data-react');

  if (type !== 'upvote') return; // only upvote supported in UI

  // Optimistic: bump post to top immediately
  const post = updatePostInCache(postId, p => {
    p.createdAt = Math.floor(Date.now() / 1000);
    return p;
  });

  if (post) {
    // Move to top
    allPosts.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    applySearchAndRender();
  }

  try {
    await api(`/api/posts/${encodeURIComponent(postId)}/react`, {
      method: 'POST',
      body: { reaction: type },
    });
    // Silently refresh in background
    setTimeout(() => loadPosts(true), 2000);
  } catch {
    // Revert on failure
    await loadPosts(true);
  }
}

async function handleDeleteClick(e) {
  const btn = e.target.closest('[data-delete]');
  if (!btn) return;

  const postId = btn.getAttribute('data-delete');
  if (!confirm('Are you sure you want to delete this post?')) return;

  // Optimistic: remove from UI
  allPosts = allPosts.filter(p => String(p.id) !== String(postId));
  applySearchAndRender();

  try {
    await api(`/api/posts/${encodeURIComponent(postId)}/delete`, { method: 'DELETE' });
  } catch {
    await loadPosts(true); // reload on failure
  }
}

function handleLogout() {
  localStorage.removeItem(tokenKey);
  window.location.href = 'join.html';
}

window.addEventListener('DOMContentLoaded', async () => {
  requireAuth();

  document.getElementById('postForm').addEventListener('submit', handleCreatePost);
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);
  document.getElementById('search').addEventListener('input', debouncedSearch);
  document.getElementById('posts').addEventListener('submit', handleCommentSubmit);
  document.getElementById('posts').addEventListener('click', handleReactClick);
  document.getElementById('posts').addEventListener('click', handleDeleteClick);

  await loadPosts();
});
