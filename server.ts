import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';

interface ShortItem {
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

const PORT = Number(process.env.PORT) || 3000;
const YOUTUBE_VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const CACHE_TTL_MS = 10 * 60 * 1000;
const queryCache = new Map<string, CacheEntry>();
const embedCheckCache = new Map<string, boolean>();

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'your', 'have', 'just',
  'what', 'when', 'where', 'which', 'will', 'about', 'into', 'more', 'some',
  'like', 'shorts', 'short', 'youtube', 'youtubeshorts', 'viral', 'trending',
  'fyp', 'reels', 'reel', 'video', 'videos', 'subscribe', 'watch', 'part',
  'best', 'top', 'new', 'how', 'why', 'are', 'you', 'was', 'not', 'but',
  'all', 'out', 'one', 'two', 'can', 'his', 'her', 'she', 'they', 'them',
]);

function extractServerKeywords(title: string, topic: string): string[] {
  const tokens = new Set<string>();
  const cleanTopic = topic.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim();
  if (cleanTopic && cleanTopic !== 'for-you' && cleanTopic !== 'foryou') {
    tokens.add(cleanTopic);
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

const FALLBACK_SHORTS: Record<string, ShortItem[]> = {
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

function scoreQueryRelevance(item: ShortItem, queryText: string): number {
  const tokens = queryText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return 0;

  const titleLower = item.title.toLowerCase();
  let matched = 0;
  for (const token of tokens) {
    if (titleLower.includes(token)) {
      matched += 1;
    }
  }
  // Exact phrase match bonus
  const phraseBonus = titleLower.includes(queryText.toLowerCase().trim()) ? 2 : 0;
  return matched + phraseBonus;
}

async function isEmbeddable(videoId: string): Promise<boolean> {
  const cached = embedCheckCache.get(videoId);
  if (cached !== undefined) return cached;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 900);
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    const ok = res.ok;
    embedCheckCache.set(videoId, ok);
    return ok;
  } catch {
    return true;
  }
}

async function fetchYouTubeShortsForQuery(
  searchQuery: string,
  topicLabel: string,
  useShortFilter = false
): Promise<ShortItem[]> {
  const cacheKey = `${searchQuery.toLowerCase()}::${topicLabel.toLowerCase()}::${useShortFilter}`;
  const cached = queryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.items;
  }

  const url = new URL('https://www.youtube.com/results');
  url.searchParams.set('search_query', searchQuery);
  if (useShortFilter) {
    url.searchParams.set('sp', 'EgIYAQ%3D%3D');
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);

    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    clearTimeout(timer);

    if (!response.ok) {
      return [];
    }

    const html = await response.text();
    const rawItems = parseShortsFromHtml(html, topicLabel).slice(0, 32);

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
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Pre-warm default topics in background so category switches respond in <3ms
async function prewarmDefaultTopics() {
  const warmupQueries = [
    { q: 'viral funny #shorts', label: 'comedy' },
    { q: 'tech gadgets #shorts', label: 'tech' },
    { q: 'comedy #shorts', label: 'comedy' },
    { q: 'tech #shorts', label: 'tech' },
    { q: 'music #shorts', label: 'music' },
    { q: 'fitness #shorts', label: 'fitness' },
    { q: 'gaming #shorts', label: 'gaming' },
    { q: 'science facts #shorts', label: 'science facts' },
    { q: 'cooking recipe #shorts', label: 'cooking recipe' },
  ];

  await Promise.allSettled(
    warmupQueries.map(({ q, label }) => fetchYouTubeShortsForQuery(q, label))
  );
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/suggest', async (req, res) => {
    const rawQ = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
    if (rawQ.length < 1) {
      res.json({ suggestions: [] });
      return;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const url = new URL('https://suggestqueries.google.com/complete/search');
      url.searchParams.set('client', 'firefox');
      url.searchParams.set('ds', 'yt');
      url.searchParams.set('q', rawQ);

      const response = await fetch(url.toString(), { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) {
        res.json({ suggestions: [] });
        return;
      }

      const data = (await response.json()) as [string, unknown[]];
      const list = Array.isArray(data?.[1])
        ? data[1]
            .filter((item): item is string => typeof item === 'string')
            .slice(0, 6)
        : [];
      res.json({ suggestions: list });
    } catch {
      res.json({ suggestions: [] });
    }
  });

  async function handleShortsRequest(params: {
    rawTopic: unknown;
    rawPage: unknown;
    rawExclude: unknown;
    rawLikedTopics: unknown;
  }) {
    const topicStr = typeof params.rawTopic === 'string' ? params.rawTopic.trim() : 'for-you';
    const topic = topicStr.slice(0, 60) || 'for-you';

    const pageNum = Number(params.rawPage ?? 0);
    const page = Number.isFinite(pageNum) && pageNum >= 0 ? Math.min(pageNum, 50) : 0;

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
        .slice(-2000)
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
      .slice(0, 4);

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

    const buildQueriesForRound = (roundPage: number): Array<{ q: string; label: string; sp: boolean }> => {
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
          ];
          const mod = modifiers[roundPage % modifiers.length];
          for (const kw of likedKeywords.slice(0, 3)) {
            list.push({ q: `${kw} ${mod}`, label: kw, sp: roundPage % 2 === 1 });
          }
          if (roundPage % 2 === 1) {
            list.push({ q: 'amazing #shorts', label: 'trending', sp: false });
          }
        } else {
          list.push(
            forYouStarterPool[roundPage % forYouStarterPool.length],
            forYouStarterPool[(roundPage + 1) % forYouStarterPool.length],
            forYouStarterPool[(roundPage + 3) % forYouStarterPool.length]
          );
        }
      } else {
        const mod1 = customModifiers[roundPage % customModifiers.length];
        const mod2 = customModifiers[(roundPage + 1) % customModifiers.length];
        list.push({ q: `${topic} ${mod1}`, label: topic, sp: false });
        list.push({ q: `${topic} ${mod2}`, label: topic, sp: true });
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

    // If most items in this round were already watched, automatically look deeper
    if (combined.length < 10) {
      await appendRound(page + 2);
    }
    if (combined.length < 6) {
      await appendRound(page + 4);
    }

    let finalItems = combined;

    if (topic !== 'for-you') {
      finalItems = [...combined].sort(
        (a, b) => scoreQueryRelevance(b, topic) - scoreQueryRelevance(a, topic)
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

    // Background pre-warm next page modifier for this topic
    if (topic !== 'for-you') {
      const nextMod = customModifiers[(page + 1) % customModifiers.length];
      void fetchYouTubeShortsForQuery(`${topic} ${nextMod}`, topic, false);
    }

    return {
      items: finalItems.slice(0, 32),
      topic,
      personalized: likedKeywords.length > 0,
    };
  }

  app.get('/api/shorts', async (req, res) => {
    const payload = await handleShortsRequest({
      rawTopic: req.query.topic,
      rawPage: req.query.page,
      rawExclude: req.query.exclude,
      rawLikedTopics: req.query.likedTopics,
    });
    res.json(payload);
  });

  app.post('/api/shorts', async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const payload = await handleShortsRequest({
      rawTopic: body.topic,
      rawPage: body.page,
      rawExclude: body.exclude,
      rawLikedTopics: body.likedTopics,
    });
    res.json(payload);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ShortFlow server listening on http://0.0.0.0:${PORT}`);
    // Warm up default category feeds in background for instant <3ms first loads
    void prewarmDefaultTopics();
  });
}

startServer();
