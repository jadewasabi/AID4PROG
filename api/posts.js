import { Redis } from '@upstash/redis';
import jwt from 'jsonwebtoken';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

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
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  const debugEnv = {
    hasRedisUrl: Boolean(process.env.UPSTASH_REDIS_REST_URL),
    hasRedisToken: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
    jwtSecretSet: Boolean(process.env.JWT_SECRET),
  };

  if (req.method === 'GET') {
    let effectiveIds = [];

    const setIds = await redis.smembers('posts:id');
    if (Array.isArray(setIds)) effectiveIds = sortIdsDesc(setIds);

    try {
      const listIds = await redis.lrange('posts', 0, 49);
      if (Array.isArray(listIds) && listIds.length) {
        const merged = new Set([...effectiveIds, ...listIds.map(String)]);
        effectiveIds = sortIdsDesc([...merged]).slice(0, 50);
      }
    } catch {
      // ignore
    }

    effectiveIds = effectiveIds.slice(0, 50);

    const posts = [];
    let missingPostObjects = 0;
    let parseFailures = 0;
    let firstMissingId = null;
    let firstParseFail = null;

    for (const id of effectiveIds) {
      const raw = await redis.get(`post:${id}`);
      if (!raw) {
        missingPostObjects++;
        if (!firstMissingId) firstMissingId = id;
        continue;
      }

      try {
        if (typeof raw === 'string') posts.push(JSON.parse(raw));
        else posts.push(raw);
      } catch (e) {
        parseFailures++;
        if (!firstParseFail) firstParseFail = { id, rawSnippet: String(raw).slice(0, 120) };
      }
    }

    return res.status(200).json({
      posts,
      env: debugEnv,
      debugIndex: {
        idsCount: effectiveIds.length,
        sampleIds: effectiveIds.slice(0, 5),
        missingPostObjects,
        parseFailures,
        firstMissingId,
        firstParseFail,
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
    await redis.sadd('posts:id', postId);

    return res.status(201).json({ post, env: debugEnv });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

