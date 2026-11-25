import { getFastHeuristicIntent, understandSearchIntent } from './searchIntent.ts';

export interface ShortItem {
  id: string;
  title: string;
  thumbnail: string;
  views?: string;
  topic: string;
  keywords: string[];
}

interface CacheEntry {
  items: ShortItem[];
  expiresAt: number;
}

const YOUTUBE_VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const CACHE_TTL_MS = 12 * 60 * 1000;
const MAX_EMBED_CACHE = 10000;
const queryCache = new Map<string, CacheEntry>();
const inflightQueryMap = new Map<string, Promise<ShortItem[]>>();
const embedCheckCache = new Map<string, boolean>();

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'your', 'have', 'just',
  'what', 'when', 'where', 'which', 'will', 'about', 'into', 'more', 'some',
  'like', 'shorts', 'short', 'youtube', 'youtubeshorts', 'viral', 'trending',
  'fyp', 'reels', 'reel', 'video', 'videos', 'subscribe', 'watch', 'part',
  'best', 'top', 'new', 'how', 'why', 'are', 'you', 'was', 'not', 'but',
  'all', 'out', 'one', 'two', 'can', 'his', 'her', 'she', 'they', 'them',
]);

const DEFAULT_SIMPLE_TOPICS = new Set([
  'comedy',
  'tech',
  'music',
  'fitness',
  'gaming',
  'science facts',
  'cooking recipe',
]);

function extractServerKeywords(title: string, topic: string): string[] {
  const tokens = new Set<string>();
  const cleanTopic = topic.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim();
  if (cleanTopic && cleanTopic !== 'for-you' && cleanTopic !== 'foryou') {
    for (const part of cleanTopic.split(/\s+/)) {
      if (part.length >= 3 && !STOP_WORDS.has(part)) {
        tokens.add(part);
      }
    }
  }

  const hashtags = title.match(/#([a-zA-Z0-9_]{2,24})/g) || [];
  for (const tag of hashtags) {
    const clean = tag.slice(1).toLowerCase();
    if (!STOP_WORDS.has(clean) && clean.length >= 3) {
      tokens.add(clean);
    }
  }

  const words = title
    .toLowerCase()
    .replace(/#[a-z0-9_]+/gi, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/);

  for (const w of words) {
    if (w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w)) {
      tokens.add(w);
    }
  }

  return Array.from(tokens).slice(0, 8);
}

export const FALLBACK_SHORTS: Record<string, ShortItem[]> = {
  comedy: [
    { id: 'fJw33GyM8FM', title: 'Comedy moment #comedy #shorts', thumbnail: 'https://i.ytimg.com/vi/fJw33GyM8FM/oardefault.jpg', topic: 'comedy', keywords: ['comedy', 'funny'] },
    { id: 'CrX6RH3roLY', title: 'Comedy standup moment #comedy #shorts', thumbnail: 'https://i.ytimg.com/vi/CrX6RH3roLY/oardefault.jpg', topic: 'comedy', keywords: ['comedy', 'standup', 'funny'] },
    { id: 'LvUOfAyjgOM', title: 'Wait for the punchline #funny #shorts', thumbnail: 'https://i.ytimg.com/vi/LvUOfAyjgOM/oardefault.jpg', topic: 'comedy', keywords: ['comedy', 'funny', 'punchline'] },
  ],
  tech: [
    { id: 'nW-8huYNtfo', title: 'Rollable Phone vs Foldable Phone #tech #shorts', thumbnail: 'https://i.ytimg.com/vi/nW-8huYNtfo/oardefault.jpg', topic: 'tech', keywords: ['tech', 'phone', 'gadgets'] },
    { id: 'zffgMR-HRig', title: 'Next-gen smartphone hardware #tech #shorts', thumbnail: 'https://i.ytimg.com/vi/zffgMR-HRig/oardefault.jpg', topic: 'tech', keywords: ['tech', 'smartphone', 'hardware'] },
    { id: 'jt7fM86OTXE', title: 'Smart home tech #smarthome #tech #shorts', thumbnail: 'https://i.ytimg.com/vi/jt7fM86OTXE/oardefault.jpg', topic: 'tech', keywords: ['tech', 'smarthome', 'gadgets'] },
    { id: 'hr3DGNJFy8E', title: 'Future phone design #tech #shorts', thumbnail: 'https://i.ytimg.com/vi/hr3DGNJFy8E/oardefault.jpg', topic: 'tech', keywords: ['tech', 'iphone', 'design'] },
  ],
};

function parseShortsFromHtml(html: string, topic: string): ShortItem[] {
  const match = html.match(/var ytInitialData = (\{.+?\});<\/script>/);
  if (!match?.[1]) return [];

  let data: unknown;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return [];
  }

  const results: ShortItem[] = [];
  const secondaryVideos: ShortItem[] = [];
  const seen = new Set<string>();

  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') return;

    if (!Array.isArray(node)) {
      const obj = node as Record<string, unknown>;
      if (obj.shortsLockupViewModel && typeof obj.shortsLockupViewModel === 'object') {
        const s = obj.shortsLockupViewModel as Record<string, any>;
        const videoId: string | undefined =
          s?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ||
          (typeof s?.entityId === 'string'
            ? s.entityId.replace('shorts-shelf-item-', '')
            : undefined);

        if (videoId && YOUTUBE_VIDEO_ID_RE.test(videoId) && !seen.has(videoId)) {
          seen.add(videoId);
          const rawTitle: string =
            s?.overlayMetadata?.primaryText?.content ||
            s?.accessibilityText ||
            `${topic} Short`;
          const views: string | undefined = s?.overlayMetadata?.secondaryText?.content;
          const thumbSource: string | undefined =
            s?.thumbnailViewModel?.thumbnailViewModel?.image?.sources?.[0]?.url;

          results.push({
            id: videoId,
            title: rawTitle.trim(),
            thumbnail: thumbSource || `https://i.ytimg.com/vi/${videoId}/oardefault.jpg`,
            views,
            topic,
            keywords: extractServerKeywords(rawTitle, topic),
          });
        }
      } else if (obj.videoRenderer && typeof obj.videoRenderer === 'object') {
        const v = obj.videoRenderer as Record<string, any>;
        const videoId: string | undefined = v?.videoId;
        const lenText: string | undefined = v?.lengthText?.simpleText;
        const hasReelEndpoint = Boolean(v?.navigationEndpoint?.reelWatchEndpoint);
        const isShortDuration =
          typeof lenText === 'string' && /^(0:[0-5]\d|1:00)$/.test(lenText.trim());

        if (
          videoId &&
          YOUTUBE_VIDEO_ID_RE.test(videoId) &&
          !seen.has(videoId) &&
          (hasReelEndpoint || isShortDuration)
        ) {
          seen.add(videoId);
          const rawTitle: string =
            v?.title?.runs?.[0]?.text ||
            v?.title?.simpleText ||
            `${topic} Short`;
          const views: string | undefined = v?.shortViewCountText?.simpleText;
          secondaryVideos.push({
            id: videoId,
            title: rawTitle.trim(),
            thumbnail: `https://i.ytimg.com/vi/${videoId}/oardefault.jpg`,
            views,
            topic,
            keywords: extractServerKeywords(rawTitle, topic),
          });
        }
      }

      for (const val of Object.values(obj)) {
        walk(val);
      }
    } else {
      for (const item of node) {
        walk(item);
      }
    }
  }

  walk(data);
  return [...results, ...secondaryVideos];
}

function scoreQueryRelevance(
  item: ShortItem,
  queryText: string,
  semanticKeywords: string[] = []
): number {
  const rawTokens = queryText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  const semanticTokens = semanticKeywords
    .map((k) => k.toLowerCase().trim())
    .filter((k) => k.length >= 2);

  const allTokens = Array.from(new Set([...rawTokens, ...semanticTokens]));
  if (allTokens.length === 0) return 0;

  const titleLower = item.title.toLowerCase();
  const itemKwSet = new Set(item.keywords.map((k) => k.toLowerCase()));
  let score = 0;

  for (const token of rawTokens) {
    if (titleLower.includes(token)) score += 2;
    if (itemKwSet.has(token)) score += 1.5;
  }

  for (const token of semanticTokens) {
    if (titleLower.includes(token)) score += 1.25;
    if (itemKwSet.has(token)) score += 1;
  }

  const trimmedQuery = queryText.toLowerCase().trim();
  if (trimmedQuery.length >= 3 && titleLower.includes(trimmedQuery)) {
    score += 3;
  }
  return score;
}

async function isEmbeddable(videoId: string): Promise<boolean> {
  const cached = embedCheckCache.get(videoId);
  if (cached !== undefined) return cached;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 380);
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    // Reject only explicit non-embeddable/unavailable HTTP errors; treat transient timeouts as true
    const ok = res.ok || (res.status !== 401 && res.status !== 403 && res.status !== 404);
    if (embedCheckCache.size > MAX_EMBED_CACHE) {
      embedCheckCache.clear();
    }
    embedCheckCache.set(videoId, ok);
    return ok;
  } catch {
    return true;
  }
}

export async function fetchYouTubeShortsForQuery(
  searchQuery: string,
  topicLabel: string,
  useShortFilter = false
): Promise<ShortItem[]> {
  const cacheKey = `${searchQuery.toLowerCase()}::${topicLabel.toLowerCase()}::${useShortFilter}`;
  const cached = queryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.items;
  }

  const inflight = inflightQueryMap.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const task = (async () => {
    const url = new URL('https://www.youtube.com/results');
    url.searchParams.set('search_query', searchQuery);
    if (useShortFilter) {
      url.searchParams.set('sp', 'EgIYAQ%3D%3D');
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3200);

      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          Cookie: 'CONSENT=YES+cb.20210328-17-p0.en+FX+417; SOCS=CAI',
        },
      });
      clearTimeout(timer);

      if (!response.ok) {
        return [];
      }

      const html = await response.text();
      const rawItems = parseShortsFromHtml(html, topicLabel).slice(0, 26);

      // Fast parallel oEmbed check capped at 380ms per video so server responds ultra-fast
      const checks = await Promise.all(
        rawItems.map(async (item) => ({
          item,
          ok: await isEmbeddable(item.id),
        }))
      );
      const items = checks.filter((c) => c.ok).map((c) => c.item);

      if (items.length > 0) {
        queryCache.set(cacheKey, {
          items,
          expiresAt: Date.now() + CACHE_TTL_MS,
        });
      }

      return items;
    } catch {
      return [];
    }
  })();

  inflightQueryMap.set(cacheKey, task);
  try {
    return await task;
  } finally {
    inflightQueryMap.delete(cacheKey);
  }
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export async function handleShortsRequest(params: {
  rawTopic: unknown;
  rawPage: unknown;
  rawExclude: unknown;
  rawLikedTopics: unknown;
}) {
  const topicStr = typeof params.rawTopic === 'string' ? params.rawTopic.trim() : 'for-you';
  const topic = topicStr.slice(0, 140) || 'for-you';

  const pageNum = Number(params.rawPage ?? 0);
  const page = Number.isFinite(pageNum) && pageNum >= 0 ? Math.min(pageNum, 80) : 0;

  const excludeList = Array.isArray(params.rawExclude)
    ? params.rawExclude
    : typeof params.rawExclude === 'string'
      ? params.rawExclude.split(',')
      : [];
  const excludeSet = new Set(
    excludeList
      .filter((id): id is string => typeof id === 'string')
      .map((id) => id.trim())
      .filter((id) => YOUTUBE_VIDEO_ID_RE.test(id))
      .slice(-15000)
  );

  const likedKeywords = (
    Array.isArray(params.rawLikedTopics)
      ? params.rawLikedTopics.filter((k): k is string => typeof k === 'string')
      : typeof params.rawLikedTopics === 'string'
        ? params.rawLikedTopics.split(',')
        : []
  )
    .map((k) => k.trim().replace(/[^a-zA-Z0-9\s-]/g, ''))
    .filter((k) => k.length >= 2)
    .slice(0, 6);

  const forYouStarterPool = [
    { q: 'viral funny #shorts', label: 'comedy', sp: false },
    { q: 'tech gadgets #shorts', label: 'tech', sp: false },
    { q: 'science facts #shorts', label: 'science facts', sp: false },
    { q: 'music #shorts', label: 'music', sp: false },
    { q: 'amazing skills #shorts', label: 'amazing', sp: false },
    { q: 'satisfying #shorts', label: 'satisfying', sp: false },
    { q: 'sports moments #shorts', label: 'sports', sp: false },
    { q: 'nature animals #shorts', label: 'nature', sp: false },
    { q: 'cooking recipe #shorts', label: 'cooking', sp: false },
    { q: 'space universe #shorts', label: 'space', sp: false },
  ];

  const customModifiers = [
    '#shorts',
    'shorts',
    'reels #shorts',
    'edit #shorts',
    'clips #shorts',
    'best #shorts',
    'new #shorts',
    'trending #shorts',
    'highlights #shorts',
    'viral #shorts',
  ];

  // For custom/natural-language search queries, run deep intent understanding
  const isDefaultSimple =
    topic === 'for-you' || DEFAULT_SIMPLE_TOPICS.has(topic.toLowerCase());
  const searchIntent = !isDefaultSimple
    ? await understandSearchIntent(topic)
    : null;

  const buildQueriesForRound = (
    roundPage: number
  ): Array<{ q: string; label: string; sp: boolean }> => {
    const list: Array<{ q: string; label: string; sp: boolean }> = [];
    if (topic === 'for-you') {
      if (likedKeywords.length > 0) {
        const modifiers = [
          '#shorts',
          'shorts viral',
          'youtube shorts',
          'best #shorts',
          'new #shorts',
          'trending #shorts',
          'edit #shorts',
          'clips #shorts',
        ];
        const mod = modifiers[roundPage % modifiers.length];
        // Focus heavily on the top/most-recent liked keywords, plus cross-keyword combo
        for (const kw of likedKeywords.slice(0, 3)) {
          list.push({ q: `${kw} ${mod}`, label: kw, sp: roundPage % 2 === 1 });
        }
        if (likedKeywords.length >= 2) {
          list.push({
            q: `${likedKeywords[0]} ${likedKeywords[1]} #shorts`,
            label: likedKeywords[0],
            sp: false,
          });
        }
      } else {
        list.push(
          forYouStarterPool[roundPage % forYouStarterPool.length],
          forYouStarterPool[(roundPage + 1) % forYouStarterPool.length],
          forYouStarterPool[(roundPage + 3) % forYouStarterPool.length]
        );
      }
    } else if (searchIntent) {
      const baseQueries = searchIntent.searchQueries;
      const mod = customModifiers[roundPage % customModifiers.length];
      const q1 = baseQueries[roundPage % baseQueries.length];
      const q2 = baseQueries[(roundPage + 1) % baseQueries.length];
      const label = searchIntent.displayLabel || topic;

      if (roundPage === 0) {
        for (const q of baseQueries.slice(0, 3)) {
          list.push({ q, label, sp: false });
        }
      } else {
        list.push({ q: `${q1.replace(/#?shorts/gi, '').trim()} ${mod}`, label, sp: roundPage % 2 === 1 });
        if (q2 && q2 !== q1) {
          list.push({ q: `${q2.replace(/#?shorts/gi, '').trim()} ${mod}`, label, sp: false });
        }
      }

      // Real-time taste blending even during active searches when user likes reels
      if (likedKeywords.length > 0) {
        list.push({
          q: `${likedKeywords[0]} ${searchIntent.keywords[0] || ''} #shorts`.trim(),
          label,
          sp: false,
        });
      }
    } else {
      const mod1 = customModifiers[roundPage % customModifiers.length];
      const mod2 = customModifiers[(roundPage + 1) % customModifiers.length];
      list.push({ q: `${topic} ${mod1}`, label: topic, sp: false });
      list.push({ q: `${topic} ${mod2}`, label: topic, sp: true });

      if (likedKeywords.length > 0) {
        list.push({
          q: `${topic} ${likedKeywords[0]} #shorts`,
          label: topic,
          sp: false,
        });
      }
    }
    return list;
  };

  const combined: ShortItem[] = [];
  const seen = new Set<string>(excludeSet);

  const appendRound = async (roundPage: number) => {
    const queries = buildQueriesForRound(roundPage);
    const batches = await Promise.all(
      queries.map(({ q, label, sp }) => fetchYouTubeShortsForQuery(q, label, sp))
    );
    const maxLen = batches.reduce((max, b) => Math.max(max, b.length), 0);
    for (let i = 0; i < maxLen; i++) {
      for (const batch of batches) {
        const item = batch[i];
        if (item && !seen.has(item.id)) {
          seen.add(item.id);
          combined.push(item);
        }
      }
    }
  };

  await appendRound(page);

  if (combined.length < 12) {
    await appendRound(page + 2);
  }
  if (combined.length < 6) {
    await appendRound(page + 4);
  }

  let finalItems = combined;

  if (topic !== 'for-you') {
    const semanticKeywords = [
      ...(searchIntent?.keywords || []),
      ...likedKeywords.slice(0, 2),
    ];
    finalItems = [...combined].sort(
      (a, b) =>
        scoreQueryRelevance(b, topic, semanticKeywords) -
        scoreQueryRelevance(a, topic, semanticKeywords)
    );
    if (finalItems.length === 0 && FALLBACK_SHORTS[topic.toLowerCase()]) {
      finalItems = FALLBACK_SHORTS[topic.toLowerCase()].filter((item) => !seen.has(item.id));
    }
  } else {
    if (finalItems.length < 6) {
      const fallbackPool = [...FALLBACK_SHORTS.tech, ...FALLBACK_SHORTS.comedy];
      for (const item of fallbackPool) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          finalItems.push(item);
        }
      }
    }
    if (page > 0) {
      finalItems = shuffleArray(finalItems);
    }
  }

  return {
    items: finalItems.slice(0, 34),
    topic,
    intentLabel: searchIntent?.displayLabel,
    understoodKeywords: searchIntent?.keywords,
    personalized: likedKeywords.length > 0,
  };
}

export async function fetchSuggestList(rawQuery: string): Promise<string[]> {
  const rawQ = rawQuery.trim().slice(0, 100);
  if (rawQ.length < 1) {
    return [];
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1600);
    const url = new URL('https://suggestqueries.google.com/complete/search');
    url.searchParams.set('client', 'firefox');
    url.searchParams.set('ds', 'yt');
    url.searchParams.set('q', rawQ);

    const response = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as [string, unknown[]];
    return Array.isArray(data?.[1])
      ? data[1].filter((item): item is string => typeof item === 'string').slice(0, 6)
      : [];
  } catch {
    return [];
  }
}

export async function fetchSmartSuggestBundle(rawQuery: string): Promise<{
  suggestions: string[];
  intentLabel?: string;
  smartQueries: string[];
}> {
  const trimmed = rawQuery.trim().slice(0, 140);
  if (!trimmed) {
    return { suggestions: [], smartQueries: [] };
  }

  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  const heuristic = getFastHeuristicIntent(trimmed);

  // Only query YouTube autocomplete for concise phrases; long conversational Hinglish prompts
  // rely on semantic intent interpretation so suggestions stay sharp and instant.
  const ytSuggestions =
    wordCount <= 5 ? await fetchSuggestList(trimmed) : [];

  const smartQueries = Array.from(
    new Set([
      ...heuristic.suggestions,
      ...heuristic.searchQueries.map((q) => q.replace(/\s*#?shorts/gi, '').trim()),
    ])
  )
    .filter((s) => s.length >= 2 && s.toLowerCase() !== trimmed.toLowerCase())
    .slice(0, 4);

  return {
    suggestions: ytSuggestions,
    intentLabel: wordCount >= 2 ? heuristic.displayLabel : undefined,
    smartQueries,
  };
}
