import type { IncomingMessage, ServerResponse } from 'http';
import { fetchSuggestList } from '../lib/shortsService';

interface VercelReq extends IncomingMessage {
  query?: Record<string, string | string[] | undefined>;
}

export default async function handler(req: VercelReq, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  try {
    const urlObj = new URL(req.url || '/api/suggest', 'http://localhost');
    const qParam =
      typeof req.query?.q === 'string'
        ? req.query.q
        : Array.isArray(req.query?.q)
          ? req.query.q[0]
          : urlObj.searchParams.get('q') || '';

    const suggestions = await fetchSuggestList(qParam || '');
    res.statusCode = 200;
    res.end(JSON.stringify({ suggestions }));
  } catch {
    res.statusCode = 200;
    res.end(JSON.stringify({ suggestions: [] }));
  }
}
