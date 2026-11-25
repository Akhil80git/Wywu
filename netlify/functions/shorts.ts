import { handleShortsRequest } from '../../lib/shortsService';

interface NetlifyEvent {
  httpMethod?: string;
  queryStringParameters?: Record<string, string | undefined>;
  body?: string | null;
}

export async function handler(event: NetlifyEvent) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  try {
    let bodyObj: Record<string, unknown> = {};
    if (event.httpMethod === 'POST' && event.body) {
      bodyObj = JSON.parse(event.body) as Record<string, unknown>;
    }

    const qs = event.queryStringParameters || {};
    const payload = await handleShortsRequest({
      rawTopic: bodyObj.topic ?? qs.topic,
      rawPage: bodyObj.page ?? qs.page,
      rawExclude: bodyObj.exclude ?? qs.exclude,
      rawLikedTopics: bodyObj.likedTopics ?? qs.likedTopics,
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(payload),
    };
  } catch {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ items: [], error: 'Failed to load Shorts' }),
    };
  }
}
