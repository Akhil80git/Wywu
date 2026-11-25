import { fetchSuggestList } from '../../lib/shortsService';

interface NetlifyEvent {
  queryStringParameters?: Record<string, string | undefined>;
}

export async function handler(event: NetlifyEvent) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };

  try {
    const q = event.queryStringParameters?.q || '';
    const suggestions = await fetchSuggestList(q);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ suggestions }),
    };
  } catch {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ suggestions: [] }),
    };
  }
}
