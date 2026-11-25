import type { IncomingMessage, ServerResponse } from 'http';
import { handleShortsRequest } from '../lib/shortsService';

interface VercelReq extends IncomingMessage {
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

export default async function handler(req: VercelReq, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    const urlObj = new URL(req.url || '/api/shorts', 'http://localhost');
    let bodyObj: Record<string, unknown> = {};

    if (req.method === 'POST') {
      if (req.body && typeof req.body === 'object') {
        bodyObj = req.body as Record<string, unknown>;
      } else if (typeof req.body === 'string' && req.body.trim()) {
        bodyObj = JSON.parse(req.body) as Record<string, unknown>;
      } else {
        const raw = await readRawBody(req);
        if (raw.trim()) {
          bodyObj = JSON.parse(raw) as Record<string, unknown>;
        }
      }
    }

    const getQueryParam = (key: string): string | undefined => {
      const val = req.query?.[key];
      if (typeof val === 'string') return val;
      if (Array.isArray(val)) return val[0];
      return urlObj.searchParams.get(key) ?? undefined;
    };

    const payload = await handleShortsRequest({
      rawTopic: bodyObj.topic ?? getQueryParam('topic'),
      rawPage: bodyObj.page ?? getQueryParam('page'),
      rawExclude: bodyObj.exclude ?? getQueryParam('exclude'),
      rawLikedTopics: bodyObj.likedTopics ?? getQueryParam('likedTopics'),
    });

    res.statusCode = 200;
    res.end(JSON.stringify(payload));
  } catch {
    res.statusCode = 500;
    res.end(JSON.stringify({ items: [], error: 'Failed to load Shorts' }));
  }
}
