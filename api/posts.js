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

function makeId(n) {
  return String(n);
}

function sortIdsDesc(ids) {
  return (ids || [])
    .map(String)
    .sort((a, b) => Number(b) - Number(a));
}

export default async function handler(req, res) {
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  // QUICK DEBUG to detect env mismatch immediately
  const debugEnv = {
    hasRedisUrl: Boolean(process.env.UPSTASH_REDIS_REST_URL),
    hasRedisToken: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
    jwtSecretSet: Boolean(process.env.JWT_SECRET),
  };

  if (req.method === 'GET') {
    // First: use set-based index (no reliance on list behavior)
    let effectiveIds = [];
    const setIds = await redis.smembers('posts:id');
    if (Array.isArray(setIds)) effectiveIds = sortIdsDesc(setIds);

    // Optional: also merge list ids if present
    try {
      const listIds = await redis.lrange('posts', 0, 49);
      if (Array.isArray(listIds) && listIds.length) {
        const merged = new Set([...effectiveIds, ...listIds.map(String)]);
        effectiveIds = sortIdsDesc([...merged]).slice(0, 50);
      }
    } catch {
      // ignore list issues
    }

    effectiveIds = effectiveIds.slice(0, 50);

    const posts = [];
    for (const id of effectiveIds) {
      const raw = await redis.get(`post:${id}`);
      if (!raw) continue;
      try {
        posts.push(JSON.parse(raw));
      } catch {
        // ignore
      }
    }

    return res.status(200).json({
      posts,
      env: debugEnv,
      debugIndex: {
        idsCount: effectiveIds.length,
        sampleIds: effectiveIds.slice(0, 5),
      },
    });
  }

  if (req.method === 'POST') {
    const user = authUser(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });

    const { text, imageUrl } = req.body || {};
    const t = typeof text === 'string' ? text.trim() : '';
    const img = typeof imageUrl === 'string' ? imageUrl.trim() : '';

    if (!t && !img) return res.status(400).json({ error: 'text or imageUrl required' });
    if (t.length > 2000) return res.status(400).json({ error: 'text too long' });

    const id = await redis.incr('post:id');
    const postId = makeId(id);

    const post = {
      id: postId,
      username: user,
      text: t || null,
      imageUrl: img || null,
      createdAt: Math.floor(Date.now() / 1000),
      reactions: { likes: 0, loves: 0 },
      comments: [],
    };

    await redis.set(`post:${postId}`, JSON.stringify(post));

    // Set-based index ONLY (most reliable across Redis providers)
    await redis.sadd('posts:id', postId);

    return res.status(201).json({ post, env: debugEnv });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

