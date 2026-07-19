// IMPORTANT: If you are hosting timeline.html on GitHub Pages / file://,
// set API_BASE to your Vercel deployment URL (origin only).
// Example: const API_BASE = 'https://aid4programmers.vercel.app';
// TODO: set this to your Vercel app origin (leave trailing slash off).
// If you deploy to Vercel, set it to: https://<YOUR_VERCE_L_APP>.vercel.app
// Use same origin so it works regardless of your Vercel URL
const API_BASE = 'https://vercel.com/jadexbun/aid-4-prog/2kgzQtC53aTsjrAvargxFTDkizyn'; // no trailing slash



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

let allPosts = [];

function renderPosts(filtered) {
  const postsEl = document.getElementById('posts');
  postsEl.innerHTML = '';

  if (!filtered.length) {
    postsEl.innerHTML = '<div class="small">No posts yet.</div>';
    return;
  }

  for (const p of filtered) {
    const el = document.createElement('div');
    el.className = 'post';

    const commentHtml = (p.comments || [])
      .slice(-5)
      .map(
        (c) =>
          `<div class="comment"><strong>${escapeHtml(c.username)}</strong>: ${escapeHtml(
            c.text
          )}</div>`
      )
      .join('');

    el.innerHTML = `
      <div class="post-head">
        <div>
          <div class="post-user">${escapeHtml(p.username)}</div>
          <div class="post-meta">${escapeHtml(fmtTime(p.createdAt))}</div>
        </div>
        <div class="post-meta">#${escapeHtml(String(p.id))}</div>
      </div>

      ${p.imageUrl ? `<div class="post-img"><img src="${escapeHtml(
        p.imageUrl
      )}" alt="post image" /></div>` : ''}

      ${p.text ? `<div class="post-content">${escapeHtml(p.text)}</div>` : ''}

      <div class="actions">
        <button class="btn react-btn" data-react="like" data-postid="${
          p.id
        }">👍 Like (<span class="likeCount">${
      p.reactions?.likes ?? 0
    }</span>)</button>
        <button class="btn react-btn" data-react="love" data-postid="${
          p.id
        }">❤️ Love (<span class="loveCount">${
      p.reactions?.loves ?? 0
    }</span>)</button>
      </div>

      <div class="comment-box">
        <div class="comment-list">${
          commentHtml || '<div class="small">No comments yet.</div>'
        }</div>
        <form class="comment-form" data-commentform="${p.id}">
          <input type="text" required maxlength="300" placeholder="Write a comment..." />
          <button class="btn" type="submit">Comment</button>
        </form>
      </div>
    `;

    postsEl.appendChild(el);
  }
}

async function loadPosts() {
  const data = await api('/api/posts');
  allPosts = Array.isArray(data.posts) ? data.posts : [];
  applySearchAndRender();
}

function applySearchAndRender() {
  const q = (document.getElementById('search').value || '').trim().toLowerCase();
  if (!q) return renderPosts(allPosts);

  const filtered = allPosts.filter((p) => {
    return (
      String(p.username || '')
        .toLowerCase()
        .includes(q) ||
      String(p.text || '')
        .toLowerCase()
        .includes(q)
    );
  });

  renderPosts(filtered);
}

async function handleCreatePost(e) {
  e.preventDefault();
  const t = requireAuth();
  if (!t) return;

  const textEl = document.getElementById('postText');
  const fileInput = document.getElementById('postImage');

  const text = (textEl.value || '').trim();
  // UI accepts a URL OR a chosen file.
  // Backend currently supports imageUrl string.
  let imageUrl = '';
  if (fileInput && fileInput.type === 'text') {
    imageUrl = (fileInput.value || '').trim();
  }

  // If file input is actually a <input type="file">, we convert to data URL.
  const maybeFiles = fileInput?.files;
  if (maybeFiles && maybeFiles[0]) {
    imageUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(maybeFiles[0]);
    });
  }

  if (!text && !imageUrl) {
    const err = document.getElementById('postError');
    err.style.display = 'block';
    err.textContent = 'Write something or provide an image URL.';
    return;
  }

  const payload = {
    text: text || null,
    imageUrl: imageUrl || null,
  };

  await api('/api/posts', { method: 'POST', body: payload });

  textEl.value = '';
  if (fileInput) fileInput.value = '';

  await loadPosts();
}

async function handleCommentSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const postId = form.getAttribute('data-commentform');
  const input = form.querySelector('input');
  const text = (input.value || '').trim();
  if (!text) return;

  await api(`/api/posts/${encodeURIComponent(postId)}/comment`, {
    method: 'POST',
    body: { text },
  });

  input.value = '';
  await loadPosts();
}

async function handleReactClick(e) {
  const btn = e.target.closest('[data-react]');
  if (!btn) return;

  const postId = btn.getAttribute('data-postid');
  const type = btn.getAttribute('data-react');

  await api(`/api/posts/${encodeURIComponent(postId)}/react`, {
    method: 'POST',
    body: { reaction: type },
  });

  await loadPosts();
}

function handleLogout() {
  localStorage.removeItem(tokenKey);
  window.location.href = 'join.html';
}

window.addEventListener('DOMContentLoaded', async () => {
  requireAuth();

  document.getElementById('postForm').addEventListener('submit', handleCreatePost);
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);
  document.getElementById('search').addEventListener('input', applySearchAndRender);
  document.getElementById('posts').addEventListener('submit', handleCommentSubmit);
  document.getElementById('posts').addEventListener('click', handleReactClick);

  await loadPosts();
});

