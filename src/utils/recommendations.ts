import type { ShortVideo, TasteProfile } from '../types';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'your', 'have', 'just',
  'what', 'when', 'where', 'which', 'will', 'about', 'into', 'more', 'some',
  'like', 'shorts', 'short', 'youtube', 'youtubeshorts', 'viral', 'trending',
  'fyp', 'reels', 'reel', 'video', 'videos', 'subscribe', 'watch', 'part',
  'best', 'top', 'new', 'how', 'why', 'are', 'you', 'was', 'not', 'but',
  'all', 'out', 'one', 'two', 'can', 'his', 'her', 'she', 'they', 'them',
  'hai', 'nahi', 'kya', 'mein', 'aur', 'bhi', 'kar', 'ke', 'ki', 'ka', 'ko',
  'se', 'par', 'ye', 'wo', 'toh', 'bhai', 'bro', 'wait', 'end', 'look',
]);

export function extractKeywords(title: string, topic?: string): string[] {
  const tokens = new Set<string>();

  if (topic && topic !== 'for-you') {
    const cleanTopic = topic.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim();
    if (cleanTopic.length >= 2) {
      tokens.add(cleanTopic);
      for (const part of cleanTopic.split(/\s+/)) {
        if (part.length >= 3 && !STOP_WORDS.has(part)) {
          tokens.add(part);
        }
      }
    }
  }

  // Extract hashtags first as strong signals
  const hashtagMatches = title.match(/#([a-zA-Z0-9_]{2,24})/g) || [];
  for (const tag of hashtagMatches) {
    const clean = tag.slice(1).toLowerCase();
    if (!STOP_WORDS.has(clean) && clean.length >= 3) {
      tokens.add(clean);
    }
  }

  // Extract meaningful title words
  const words = title
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/#[a-z0-9_]+/gi, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/);

  for (const word of words) {
    if (word.length >= 3 && !STOP_WORDS.has(word) && !/^\d+$/.test(word)) {
      tokens.add(word);
    }
  }

  return Array.from(tokens).slice(0, 10);
}

export function buildTasteProfile(likedVideos: ShortVideo[]): TasteProfile {
  const profile: TasteProfile = {};

  likedVideos.forEach((video, idx) => {
    // Most recently liked videos strongly steer the real-time feed
    const recencyBoost = 1 + Math.max(0, 14 - idx) * 0.25;
    const topicKey = video.topic.toLowerCase().trim();
    if (topicKey && topicKey !== 'for-you') {
      profile[topicKey] = (profile[topicKey] || 0) + 3.2 * recencyBoost;
    }

    const keywords = video.keywords?.length
      ? video.keywords
      : extractKeywords(video.title, video.topic);

    for (const kw of keywords) {
      const cleanKw = kw.toLowerCase().trim();
      if (cleanKw && !STOP_WORDS.has(cleanKw)) {
        profile[cleanKw] = (profile[cleanKw] || 0) + 1.8 * recencyBoost;
      }
    }
  });

  return profile;
}

export function buildRealtimeBoostProfile(
  justLikedVideo: ShortVideo,
  baseProfile: TasteProfile
): TasteProfile {
  const boosted: TasteProfile = { ...baseProfile };
  const topicKey = justLikedVideo.topic.toLowerCase().trim();
  if (topicKey && topicKey !== 'for-you') {
    boosted[topicKey] = (boosted[topicKey] || 0) + 12;
  }

  const freshKeywords = Array.from(
    new Set([
      ...(justLikedVideo.keywords || []),
      ...extractKeywords(justLikedVideo.title, justLikedVideo.topic),
    ])
  );

  for (const kw of freshKeywords) {
    const cleanKw = kw.toLowerCase().trim();
    if (cleanKw.length >= 2 && !STOP_WORDS.has(cleanKw)) {
      boosted[cleanKw] = (boosted[cleanKw] || 0) + 8;
    }
  }

  return boosted;
}

export function getTopTasteKeywords(profile: TasteProfile, limit = 5): string[] {
  return Object.entries(profile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => key);
}

export function scoreVideoForTaste(video: ShortVideo, profile: TasteProfile): number {
  const entries = Object.entries(profile);
  if (entries.length === 0) return 0;

  let score = 0;
  const topicKey = video.topic.toLowerCase().trim();
  if (profile[topicKey]) {
    score += profile[topicKey] * 2;
  }

  const lowerTitle = video.title.toLowerCase();
  const keywords = video.keywords?.length
    ? video.keywords
    : extractKeywords(video.title, video.topic);

  for (const kw of keywords) {
    const cleanKw = kw.toLowerCase().trim();
    if (profile[cleanKw]) {
      score += profile[cleanKw];
    }
  }

  for (const [term, weight] of entries) {
    if (term.length >= 3 && lowerTitle.includes(term)) {
      score += weight * 0.7;
    }
  }

  return score;
}

export function rerankUpcomingQueue(
  queue: ShortVideo[],
  activeIndex: number,
  profile: TasteProfile
): ShortVideo[] {
  if (Object.keys(profile).length === 0) return queue;
  // Re-rank starting immediately from the very next reel (activeIndex + 1)
  const splitAt = Math.min(activeIndex + 1, queue.length);
  const head = queue.slice(0, splitAt);
  const tail = queue.slice(splitAt);

  const scoredTail = tail
    .map((video, idx) => ({
      video,
      score: scoreVideoForTaste(video, profile),
      idx,
    }))
    .sort((a, b) => {
      if (Math.abs(b.score - a.score) > 0.15) {
        return b.score - a.score;
      }
      return a.idx - b.idx;
    })
    .map((item) => item.video);

  return [...head, ...scoredTail];
}
