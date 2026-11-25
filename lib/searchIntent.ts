import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

export interface SearchIntent {
  rawQuery: string;
  displayLabel: string;
  searchQueries: string[];
  keywords: string[];
  suggestions: string[];
  usedAI: boolean;
}

interface IntentCacheEntry {
  intent: SearchIntent;
  expiresAt: number;
}

const INTENT_CACHE_TTL_MS = 20 * 60 * 1000;
const intentCache = new Map<string, IntentCacheEntry>();
const inflightIntentMap = new Map<string, Promise<SearchIntent>>();

let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return geminiClient;
}

const CONVERSATIONAL_FILLERS = new Set([
  'mujhe', 'mujhko', 'mere', 'meri', 'mera', 'humko', 'hume', 'aap', 'bhai', 'yaar', 'bro',
  'pls', 'please', 'plz', 'kuch', 'koi', 'ek', 'do', 'si', 'sa', 'se', 'ko', 'ka', 'ki', 'ke',
  'me', 'mein', 'pe', 'par', 'aur', 'or', 'and', 'the', 'a', 'an', 'for', 'of', 'in', 'on', 'to',
  'with', 'about', 'from', 'that', 'this', 'like', 'type', 'types', 'jaisa', 'jaisi', 'jaise',
  'wala', 'wali', 'wale', 'jisme', 'jismein', 'jis', 'jo', 'dikhao', 'dikha', 'dikhana', 'batao',
  'chahiye', 'dekhna', 'dekhni', 'dekhne', 'dekho', 'lao', 'karo', 'karna', 'ho', 'hai', 'hain',
  'acha', 'accha', 'achha', 'mast', 'badhiya', 'badiya', 'ekdum', 'bahut', 'bohot', 'zyada',
  'best', 'good', 'great', 'top', 'nice', 'super', 'show', 'give', 'find', 'search', 'want',
  'need', 'watch', 'reels', 'reel', 'shorts', 'short', 'video', 'videos', 'clip', 'clips',
  'youtube', 'yt', 'liya', 'liye', 'karke', 'krke',
]);

interface SemanticRule {
  triggers: string[];
  queries: string[];
  keywords: string[];
  label: string;
}

const SEMANTIC_RULES: SemanticRule[] = [
  {
    triggers: ['hasi', 'hasna', 'hasne', 'hansna', 'comedy', 'funny', 'joke', 'jokes', 'chutkule', 'meme', 'memes', 'roast', 'bakchodi', 'laugh', 'standup', 'hasya', 'maza', 'mazak'],
    queries: ['funny comedy #shorts', 'indian standup comedy clips #shorts', 'relatable funny memes #shorts'],
    keywords: ['comedy', 'funny', 'standup', 'memes', 'laugh', 'humor'],
    label: 'Funny & Comedy',
  },
  {
    triggers: ['desi', 'indian', 'india', 'hindi', 'hindustani', 'village', 'gaav'],
    queries: ['indian desi #shorts', 'hindi trending #shorts'],
    keywords: ['indian', 'desi', 'hindi'],
    label: 'Desi / Indian',
  },
  {
    triggers: ['barish', 'baarish', 'rain', 'mansoon', 'monsoon', 'thunder'],
    queries: ['rain aesthetic relaxing #shorts', 'monsoon rain nature vibes #shorts'],
    keywords: ['rain', 'monsoon', 'nature', 'aesthetic', 'relaxing'],
    label: 'Rain & Vibes',
  },
  {
    triggers: ['sone', 'neend', 'sleep', 'relax', 'relaxing', 'shanti', 'calm', 'peace', 'lofi', 'lo-fi', 'chill', 'raat', 'rat', 'night'],
    queries: ['relaxing lofi chill vibes #shorts', 'peaceful calm sleep music #shorts', 'night aesthetic lofi #shorts'],
    keywords: ['relaxing', 'lofi', 'chill', 'calm', 'peaceful', 'sleep', 'ambient'],
    label: 'Relaxing & Lo-Fi',
  },
  {
    triggers: ['gaana', 'gana', 'song', 'songs', 'music', 'singer', 'singing', 'tune', 'beat', 'beats', 'phonk', 'remix', 'mashup', 'arijit'],
    queries: ['trending music song #shorts', 'best singing vocals #shorts'],
    keywords: ['music', 'song', 'singing', 'remix', 'beats'],
    label: 'Music & Songs',
  },
  {
    triggers: ['gym', 'workout', 'fitness', 'body', 'muscle', 'biceps', 'abs', 'exercise', 'weight', 'lifting', 'calisthenics', 'running', 'stamina'],
    queries: ['gym workout motivation #shorts', 'fitness exercise transformation #shorts'],
    keywords: ['gym', 'workout', 'fitness', 'muscle', 'training', 'motivation'],
    label: 'Gym & Fitness',
  },
  {
    triggers: ['motivation', 'motivational', 'inspire', 'success', 'mehnat', 'hustle', 'grind', 'mindset', 'discipline', 'sigma', 'focus', 'zindagi', 'life'],
    queries: ['powerful life motivation #shorts', 'discipline mindset success #shorts'],
    keywords: ['motivation', 'mindset', 'success', 'discipline', 'inspiration'],
    label: 'Motivation & Mindset',
  },
  {
    triggers: ['cricket', 'kohli', 'virat', 'dhoni', 'rohit', 'ipl', 'six', 'sixes', 'wicket', 'yorker', 'batting', 'bowling', 'match'],
    queries: ['cricket highlights moments #shorts', 'ipl best shots sixes #shorts'],
    keywords: ['cricket', 'ipl', 'highlights', 'batting', 'match'],
    label: 'Cricket',
  },
  {
    triggers: ['football', 'soccer', 'messi', 'ronaldo', 'neymar', 'goal', 'goals', 'fifa', 'mbappe'],
    queries: ['football skills goals #shorts', 'soccer highlights edit #shorts'],
    keywords: ['football', 'soccer', 'goals', 'skills'],
    label: 'Football',
  },
  {
    triggers: ['car', 'cars', 'gadi', 'gaadi', 'supercar', 'drift', 'drifting', 'race', 'racing', 'speed', 'exhaust', 'bmw', 'porsche', 'supra', 'lamborghini', 'ferrari', 'thar', 'fortuner', 'scorpio'],
    queries: ['supercar exhaust drift #shorts', 'car edits 4k #shorts'],
    keywords: ['cars', 'supercar', 'drift', 'exhaust', 'automotive', 'speed'],
    label: 'Cars & Speed',
  },
  {
    triggers: ['bike', 'bikes', 'motorcycle', 'superbike', 'rider', 'riding', 'kawasaki', 'ninja', 'ducati', 'bullet', 'ktm', 'z900', 'hayabusa'],
    queries: ['superbike exhaust riding #shorts', 'motorcycle edits #shorts'],
    keywords: ['bike', 'superbike', 'motorcycle', 'rider', 'exhaust'],
    label: 'Bikes & Riding',
  },
  {
    triggers: ['khana', 'food', 'recipe', 'cooking', 'cook', 'street', 'biryani', 'maggi', 'chai', 'pizza', 'burger', 'momos', 'spicy', 'tasty', 'dessert', 'cake', 'kitchen'],
    queries: ['delicious street food #shorts', 'quick easy cooking recipe #shorts'],
    keywords: ['food', 'recipe', 'cooking', 'streetfood', 'tasty'],
    label: 'Food & Cooking',
  },
  {
    triggers: ['tech', 'technology', 'phone', 'mobile', 'smartphone', 'iphone', 'android', 'samsung', 'laptop', 'pc', 'setup', 'gadget', 'gadgets', 'unboxing', 'review'],
    queries: ['cool tech gadgets #shorts', 'smartphone tips review #shorts'],
    keywords: ['tech', 'gadgets', 'smartphone', 'review', 'setup'],
    label: 'Tech & Gadgets',
  },
  {
    triggers: ['ai', 'coding', 'code', 'programming', 'developer', 'software', 'python', 'javascript', 'react', 'hacking', 'cyber'],
    queries: ['coding programming tips #shorts', 'ai tools tech #shorts'],
    keywords: ['coding', 'programming', 'ai', 'developer', 'software'],
    label: 'Coding & AI',
  },
  {
    triggers: ['facts', 'fact', 'gyan', 'knowledge', 'science', 'space', 'universe', 'galaxy', 'planet', 'earth', 'rahasya', 'mystery', 'history', 'psychology'],
    queries: ['mind blowing science facts #shorts', 'amazing space universe facts #shorts'],
    keywords: ['facts', 'science', 'space', 'universe', 'mystery', 'knowledge'],
    label: 'Science & Facts',
  },
  {
    triggers: ['gaming', 'game', 'games', 'bgmi', 'pubg', 'freefire', 'minecraft', 'gta', 'valorant', 'clutch', 'esports', 'ps5'],
    queries: ['gaming pro highlights #shorts', 'insane gaming moments #shorts'],
    keywords: ['gaming', 'highlights', 'clutch', 'gameplay'],
    label: 'Gaming',
  },
  {
    triggers: ['anime', 'amv', 'naruto', 'goku', 'luffy', 'gojo', 'sukun', 'sololeveling', 'manga', 'otaku'],
    queries: ['anime edits amv 4k #shorts', 'best anime fight scenes #shorts'],
    keywords: ['anime', 'amv', 'edit', 'manga'],
    label: 'Anime Edits',
  },
  {
    triggers: ['dance', 'dancing', 'nach', 'naach', 'choreography', 'steps', 'hiphop', 'freestyle'],
    queries: ['trending dance choreography #shorts', 'insane freestyle dance #shorts'],
    keywords: ['dance', 'choreography', 'freestyle', 'moves'],
    label: 'Dance',
  },
  {
    triggers: ['travel', 'ghumna', 'trip', 'pahad', 'mountain', 'mountains', 'nature', 'waterfall', 'beach', 'sunset', 'kashmir', 'ladakh', 'manali', 'swiss'],
    queries: ['scenic travel nature aesthetic #shorts', 'breathtaking mountain views #shorts'],
    keywords: ['travel', 'nature', 'mountains', 'scenic', 'aesthetic'],
    label: 'Travel & Nature',
  },
  {
    triggers: ['bhoot', 'horror', 'scary', 'ghost', 'darawna', 'haunted', 'creepy', 'paranormal'],
    queries: ['scary horror stories #shorts', 'creepy unexplained moments #shorts'],
    keywords: ['horror', 'scary', 'ghost', 'creepy', 'paranormal'],
    label: 'Horror & Mystery',
  },
  {
    triggers: ['sad', 'dukh', 'rona', 'heartbreak', 'broken', 'alone', 'shayari', 'poetry', 'love', 'pyar', 'ishq', 'status', 'dard', 'attitude'],
    queries: ['emotional shayari status #shorts', 'deep relatable quotes #shorts'],
    keywords: ['shayari', 'emotional', 'quotes', 'status', 'poetry'],
    label: 'Mood & Shayari',
  },
  {
    triggers: ['magic', 'jaadu', 'jadu', 'illusion', 'trick', 'tricks', 'card'],
    queries: ['mind blowing magic tricks #shorts', 'street magic illusion #shorts'],
    keywords: ['magic', 'illusion', 'trick'],
    label: 'Magic & Illusions',
  },
  {
    triggers: ['art', 'drawing', 'sketch', 'painting', 'calligraphy', 'craft', 'diy', 'satisfying', 'asmr'],
    queries: ['satisfying art drawing #shorts', 'oddly satisfying asmr #shorts'],
    keywords: ['art', 'drawing', 'satisfying', 'asmr', 'craft'],
    label: 'Art & Satisfying',
  },
  {
    triggers: ['paisa', 'money', 'business', 'finance', 'stock', 'stocks', 'trading', 'crypto', 'startup', 'rich', 'wealth', 'invest'],
    queries: ['business finance money tips #shorts', 'startup entrepreneur mindset #shorts'],
    keywords: ['business', 'finance', 'money', 'investing', 'startup'],
    label: 'Business & Finance',
  },
  {
    triggers: ['padhai', 'study', 'exam', 'upsc', 'jee', 'neet', 'student', 'english', 'vocabulary'],
    queries: ['smart study tips hacks #shorts', 'student motivation focus #shorts'],
    keywords: ['study', 'tips', 'exam', 'student', 'learning'],
    label: 'Study & Learning',
  },
  {
    triggers: ['dog', 'dogs', 'cat', 'cats', 'puppy', 'kitten', 'pet', 'pets', 'animal', 'animals', 'wildlife', 'lion', 'tiger', 'cute'],
    queries: ['cute funny animals pets #shorts', 'amazing wildlife moments #shorts'],
    keywords: ['animals', 'pets', 'cute', 'wildlife', 'funny'],
    label: 'Animals & Pets',
  },
];

function toTitleCase(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function buildHeuristicIntent(rawQuery: string): SearchIntent {
  const cleaned = rawQuery.trim().slice(0, 140);
  const lower = cleaned.toLowerCase();
  const rawWords = lower
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  // Extract core content words (excluding Hinglish/English conversational fluff)
  const coreWords = rawWords.filter(
    (w) => w.length >= 2 && !CONVERSATIONAL_FILLERS.has(w)
  );

  // Detect matching semantic categories
  const matchedRules: SemanticRule[] = [];
  for (const rule of SEMANTIC_RULES) {
    const hit = rule.triggers.some(
      (trig) => rawWords.includes(trig) || (trig.length >= 4 && lower.includes(trig))
    );
    if (hit) {
      matchedRules.push(rule);
    }
  }

  const queries = new Set<string>();
  const keywordSet = new Set<string>();
  const suggestions = new Set<string>();

  const corePhrase = coreWords.join(' ').trim();

  // Combine core entity words (e.g. "virat kohli", "bmw m4", "desi") with matched semantic intents
  if (coreWords.length > 0 && coreWords.length <= 4) {
    queries.add(`${corePhrase} #shorts`);
    queries.add(`${corePhrase} shorts`);
  } else if (coreWords.length > 4) {
    queries.add(`${coreWords.slice(0, 4).join(' ')} #shorts`);
  }

  for (const w of coreWords) {
    if (w.length >= 3) keywordSet.add(w);
  }

  for (const rule of matchedRules.slice(0, 3)) {
    for (const q of rule.queries.slice(0, 2)) {
      // If user also gave specific entity/modifier words not in triggers, blend them
      const extraEntities = coreWords.filter(
        (w) => w.length >= 3 && !rule.triggers.includes(w)
      );
      if (extraEntities.length > 0 && extraEntities.length <= 2) {
        queries.add(`${extraEntities.join(' ')} ${q}`);
      }
      queries.add(q);
    }
    for (const kw of rule.keywords) {
      keywordSet.add(kw);
    }
    suggestions.add(rule.label);
  }

  // If multiple rules matched (e.g., "desi comedy" or "rain lofi"), create a blended cross-query
  if (matchedRules.length >= 2) {
    const k1 = matchedRules[0].keywords[0];
    const k2 = matchedRules[1].keywords[0];
    if (k1 && k2) {
      queries.add(`${k1} ${k2} #shorts`);
      suggestions.add(`${toTitleCase(k1)} ${toTitleCase(k2)}`);
    }
  }

  // Fallback if query had only unknown tokens or raw phrase
  if (queries.size === 0) {
    const fallbackBase = corePhrase || cleaned;
    queries.add(`${fallbackBase} #shorts`);
    queries.add(`${fallbackBase} trending #shorts`);
  }

  const displayLabel =
    coreWords.length >= 1 && coreWords.length <= 3 && matchedRules.length === 0
      ? toTitleCase(corePhrase)
      : matchedRules.length >= 2
        ? `${matchedRules[0].label.split('&')[0].trim()} · ${matchedRules[1].label.split('&')[0].trim()}`
        : matchedRules.length === 1 && coreWords.length > 2
          ? matchedRules[0].label
          : corePhrase
            ? toTitleCase(corePhrase)
            : cleaned.slice(0, 28);

  if (corePhrase && coreWords.length <= 4) {
    suggestions.add(`${corePhrase} shorts`);
  }

  return {
    rawQuery: cleaned,
    displayLabel: displayLabel || cleaned,
    searchQueries: Array.from(queries).slice(0, 4),
    keywords: Array.from(keywordSet).slice(0, 10),
    suggestions: Array.from(suggestions).slice(0, 5),
    usedAI: false,
  };
}

function isSimpleSingleKeyword(query: string): boolean {
  const words = query.trim().split(/\s+/).filter(Boolean);
  return words.length === 1 && words[0].length <= 18;
}

async function analyzeWithGemini(
  rawQuery: string,
  heuristic: SearchIntent
): Promise<SearchIntent | null> {
  const ai = getGeminiClient();
  if (!ai) return null;

  try {
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 1600)
    );

    const apiPromise = ai.models
      .generateContent({
        model: 'gemini-4-hydrogen',
        contents: `User search input for a YouTube Shorts app: "${rawQuery}"`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            'You understand English, Hindi, and Hinglish conversational user requests for YouTube Shorts. ' +
            'Convert the user request into concise, high-signal YouTube Shorts search queries (each ending with #shorts). ' +
            'Preserve exact names/entities (like Virat Kohli, BMW M4, Arijit Singh) and translate moods/intent into crisp searchable Shorts queries. ' +
            'Keep displayLabel to 2-4 words.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              displayLabel: {
                type: Type.STRING,
                description: 'Short 2-4 word clean category label for the UI tab.',
              },
              searchQueries: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '3 to 4 crisp YouTube search queries with #shorts that best match user intent.',
              },
              keywords: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '5 to 8 lowercase semantic keywords for ranking Shorts titles.',
              },
              suggestions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '3 to 4 clean refined search phrases.',
              },
            },
          },
        },
      })
      .then((res) => {
        const text = res.text?.trim();
        if (!text) return null;
        const parsed = JSON.parse(text) as {
          displayLabel?: string;
          searchQueries?: string[];
          keywords?: string[];
          suggestions?: string[];
        };
        const aiQueries = Array.isArray(parsed.searchQueries)
          ? parsed.searchQueries
              .filter((q): q is string => typeof q === 'string' && q.trim().length > 1)
              .map((q) => (q.toLowerCase().includes('short') ? q.trim() : `${q.trim()} #shorts`))
              .slice(0, 4)
          : [];
        if (aiQueries.length === 0) return null;

        const mergedKeywords = Array.from(
          new Set([
            ...(Array.isArray(parsed.keywords)
              ? parsed.keywords
                  .filter((k): k is string => typeof k === 'string')
                  .map((k) => k.toLowerCase().trim())
                  .filter((k) => k.length >= 2)
              : []),
            ...heuristic.keywords,
          ])
        ).slice(0, 10);

        const aiSuggestions = Array.isArray(parsed.suggestions)
          ? parsed.suggestions
              .filter((s): s is string => typeof s === 'string' && s.trim().length > 1)
              .slice(0, 4)
          : heuristic.suggestions;

        return {
          rawQuery,
          displayLabel: parsed.displayLabel?.trim().slice(0, 32) || heuristic.displayLabel,
          searchQueries: aiQueries,
          keywords: mergedKeywords,
          suggestions: aiSuggestions,
          usedAI: true,
        } satisfies SearchIntent;
      })
      .catch(() => null);

    return await Promise.race([apiPromise, timeoutPromise]);
  } catch {
    return null;
  }
}

export async function understandSearchIntent(
  rawQuery: string,
  options?: { allowAI?: boolean }
): Promise<SearchIntent> {
  const cleaned = rawQuery.trim().slice(0, 140);
  const cacheKey = cleaned.toLowerCase();

  const cached = intentCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.intent;
  }

  const heuristic = buildHeuristicIntent(cleaned);
  const allowAI = options?.allowAI !== false;

  // Single simple keywords don't need an LLM roundtrip unless unknown;
  // multi-word / natural-language / Hinglish queries benefit from Gemini when available.
  if (!allowAI || isSimpleSingleKeyword(cleaned) || !getGeminiClient()) {
    intentCache.set(cacheKey, {
      intent: heuristic,
      expiresAt: Date.now() + INTENT_CACHE_TTL_MS,
    });
    return heuristic;
  }

  const inflight = inflightIntentMap.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const promise = (async () => {
    const aiIntent = await analyzeWithGemini(cleaned, heuristic);
    const finalIntent = aiIntent || heuristic;
    intentCache.set(cacheKey, {
      intent: finalIntent,
      expiresAt: Date.now() + INTENT_CACHE_TTL_MS,
    });
    return finalIntent;
  })();

  inflightIntentMap.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inflightIntentMap.delete(cacheKey);
  }
}

export function getFastHeuristicIntent(rawQuery: string): SearchIntent {
  const cleaned = rawQuery.trim().slice(0, 140);
  const cacheKey = cleaned.toLowerCase();
  const cached = intentCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.intent;
  }
  return buildHeuristicIntent(cleaned);
}
