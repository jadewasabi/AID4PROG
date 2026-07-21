import { Redis } from '@upstash/redis';
import jwt from 'jsonwebtoken';

function authUser(req) {
  const header = req.headers?.authorization || '';
  const parts = String(header).split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
  try {
    const payload = jwt.verify(parts[1], process.env.JWT_SECRET);
    return payload?.sub || null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  // Extract post ID from URL path: /api/posts/{id}/comment
  const id = String(req.query.id || req.body?.postId || '').trim();
  const t = typeof req.body?.text === 'string' ? req.body.text.trim() : '';

  if (!id) return res.status(400).json({ error: 'postId required' });
  if (!t) return res.status(400).json({ error: 'text required' });
  if (t.length > 300) return res.status(400).json({ error: 'text too long' });

  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  const raw = await redis.get(`post:${id}`);
  if (!raw) return res.status(404).json({ error: 'post not found' });
  const post = typeof raw === 'string' ? JSON.parse(raw) : raw;

  post.comments = Array.isArray(post.comments) ? post.comments : [];
  post.comments.push({ username: user, text: t, createdAt: Math.floor(Date.now() / 1000) });
  // keep last 50 comments
  post.comments = post.comments.slice(-50);

  await redis.set(`post:${id}`, JSON.stringify(post));
  return res.status(200).json({ ok: true, post });
}
