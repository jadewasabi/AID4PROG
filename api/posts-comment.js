import { Redis } from '@upstash/redis';
import jwt from 'jsonwebtoken';

function authUser(req) {
  const header = req.headers?.authorization || '';
  const parts = String(header).split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
  try {
    const payload = jwt.verify(parts[1], process.env.JWT_SECRET);
    return payload?.sub || null;
  } catch (_) {
    return null;
  }
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ensure json body parsing works; Vercel does this automatically


  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const { postId, text } = req.body || {};
  const id = String(postId || '').trim();
  const t = typeof text === 'string' ? text.trim() : '';

  if (!id) return res.status(400).json({ error: 'postId required' });
  if (!t) return res.status(400).json({ error: 'comment text required' });
  if (t.length > 500) return res.status(400).json({ error: 'comment too long' });

  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  const raw = await redis.get(`post:${id}`);
  if (!raw) return res.status(404).json({ error: 'post not found' });

  const post = JSON.parse(raw);
  post.comments = Array.isArray(post.comments) ? post.comments : [];
  post.comments.push({ username: user, text: t, createdAt: Math.floor(Date.now() / 1000) });
  if (post.comments.length > 200) post.comments = post.comments.slice(-200);

  await redis.set(`post:${id}`, JSON.stringify(post));

  return res.status(200).json({ ok: true, post });
}

