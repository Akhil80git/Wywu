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

  return Array.from(tokens).slice(0, 8);
}

export function buildTasteProfile(likedVideos: ShortVideo[]): TasteProfile {
  const profile: TasteProfile = {};
  const total = likedVideos.length;

  likedVideos.forEach((video, idx) => {
    // Most recently liked videos get slightly stronger weight
    const recencyBoost = 1 + (total - idx) * 0.08;
    const topicKey = video.topic.toLowerCase().trim();
    if (topicKey && topicKey !== 'for-you') {
      profile[topicKey] = (profile[topicKey] || 0) + 3 * recencyBoost;
    }

    const keywords = video.keywords?.length
      ? video.keywords
      : extractKeywords(video.title, video.topic);

    for (const kw of keywords) {
      profile[kw] = (profile[kw] || 0) + 1.5 * recencyBoost;
    }
  });

  return profile;
}

export function getTopTasteKeywords(profile: TasteProfile, limit = 4): string[] {
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
    if (profile[kw]) {
      score += profile[kw];
    }
  }

  for (const [term, weight] of entries) {
    if (term.length >= 3 && lowerTitle.includes(term)) {
      score += weight * 0.6;
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
  const splitAt = Math.min(activeIndex + 3, queue.length);
  const head = queue.slice(0, splitAt);
  const tail = queue.slice(splitAt);

  const scoredTail = tail
    .map((video, idx) => ({
      video,
      score: scoreVideoForTaste(video, profile),
      idx,
    }))
    .sort((a, b) => {
      if (Math.abs(b.score - a.score) > 0.25) {
        return b.score - a.score;
      }
      return a.idx - b.idx;
    })
    .map((item) => item.video);

  return [...head, ...scoredTail];
}
