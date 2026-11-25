import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Clock, Heart, Search, X } from 'lucide-react';
import type { TopicOption } from '../types';
import { PWAInstallButton } from './PWAInstallButton';

interface TopNavProps {
  topics: TopicOption[];
  activeTopicId: string;
  onSelectTopic: (topic: TopicOption) => void;
  onAddCustomTopic: (query: string) => void;
  likedCount: number;
  onOpenLiked: () => void;
}

const RECENT_SEARCHES_KEY = 'shortflow_recent_searches_v1';

const POPULAR_SEARCHES = [
  'Cricket',
  'Car Edits',
  'Standup Comedy',
  'Gym Motivation',
  'Anime Edits',
  'Coding',
  'Street Food',
  'Space Facts',
];

function loadRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 6)
      : [];
  } catch {
    return [];
  }
}

export function TopNav({
  topics,
  activeTopicId,
  onSelectTopic,
  onAddCustomTopic,
  likedCount,
  onOpenLiked,
}: TopNavProps) {
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>(loadRecentSearches);
  const [highlightedIdx, setHighlightedIdx] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const saveRecentSearch = (term: string) => {
    const next = [
      term,
      ...recentSearches.filter((item) => item.toLowerCase() !== term.toLowerCase()),
    ].slice(0, 6);
    setRecentSearches(next);
    try {
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
  };

  const removeRecentSearch = (term: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = recentSearches.filter((item) => item !== term);
    setRecentSearches(next);
    try {
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
  };

  const openSearch = () => {
    setIsSearchExpanded(true);
    setHighlightedIdx(-1);
    window.setTimeout(() => {
      inputRef.current?.focus();
    }, 25);
  };

  const closeSearch = () => {
    setIsSearchExpanded(false);
    setSearchQuery('');
    setSuggestions([]);
    setHighlightedIdx(-1);
  };

  const executeSearch = (rawTerm: string) => {
    const trimmed = rawTerm.trim();
    if (!trimmed) {
      closeSearch();
      return;
    }
    saveRecentSearch(trimmed);
    onAddCustomTopic(trimmed);
    closeSearch();
  };

  // Collapse search bar when clicking outside
  useEffect(() => {
    if (!isSearchExpanded) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setIsSearchExpanded(false);
        setHighlightedIdx(-1);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isSearchExpanded]);

  // Fetch live YouTube autocomplete suggestions as user types
  useEffect(() => {
    if (!isSearchExpanded) return;
    const trimmed = searchQuery.trim();
    if (trimmed.length < 1) {
      setSuggestions([]);
      setHighlightedIdx(-1);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.suggestions)) {
          setSuggestions(data.suggestions.slice(0, 6));
          setHighlightedIdx(-1);
        }
      } catch {
        // Ignore aborted or failed suggestion requests
      }
    }, 130);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [searchQuery, isSearchExpanded]);

  const activeItems = searchQuery.trim().length > 0 ? suggestions : recentSearches;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      closeSearch();
      return;
    }
    if (e.key === 'ArrowDown' && activeItems.length > 0) {
      e.preventDefault();
      setHighlightedIdx((idx) => (idx + 1) % activeItems.length);
    } else if (e.key === 'ArrowUp' && activeItems.length > 0) {
      e.preventDefault();
      setHighlightedIdx((idx) => (idx <= 0 ? activeItems.length - 1 : idx - 1));
    } else if (e.key === 'Enter' && highlightedIdx >= 0 && activeItems[highlightedIdx]) {
      e.preventDefault();
      executeSearch(activeItems[highlightedIdx]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (highlightedIdx >= 0 && activeItems[highlightedIdx]) {
      executeSearch(activeItems[highlightedIdx]);
      return;
    }
    executeSearch(searchQuery);
  };

  return (
    <header className="sticky top-0 z-40 h-14 w-full bg-[#09090B]/95 backdrop-blur-md border-b border-white/[0.08] px-3 sm:px-6 flex items-center justify-between gap-3 sm:gap-6">
      {/* Zone 1: Brand Wordmark */}
      <button
        type="button"
        onClick={() => onSelectTopic(topics[0])}
        className={`text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 rounded-md px-1 ${
          isSearchExpanded ? 'hidden sm:inline-flex' : 'inline-flex'
        }`}
      >
        ShortFlow
      </button>

      {/* Zone 2: Topic Selector */}
      {!isSearchExpanded && (
        <nav
          aria-label="Shorts categories"
          className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1"
        >
          {topics.map((topic) => {
            const isActive = topic.id === activeTopicId;
            return (
              <button
                key={topic.id}
                type="button"
                onClick={() => onSelectTopic(topic)}
                className={`min-h-[36px] px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 ${
                  isActive
                    ? 'bg-zinc-100 text-zinc-950'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06]'
                }`}
              >
                {topic.label}
              </button>
            );
          })}
        </nav>
      )}

      {/* Zone 3: Advanced Expandable Search Bar + Liked Counter */}
      <div
        className={`flex items-center gap-2 shrink-0 ${
          isSearchExpanded ? 'flex-1 justify-end' : ''
        }`}
      >
        <div
          ref={searchContainerRef}
          className={`relative transition-all duration-200 ease-out ${
            isSearchExpanded ? 'flex-1 max-w-xl' : 'w-auto'
          }`}
        >
          {isSearchExpanded ? (
            <>
              <form
                onSubmit={handleSubmit}
                className="flex items-center h-10 w-full rounded-xl bg-zinc-900 border border-white/20 focus-within:border-rose-500 px-3 gap-2 transition-colors"
              >
                <Search className="w-4 h-4 text-zinc-400 shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Search exact Shorts (e.g. Virat Kohli, BMW M4...)"
                  maxLength={60}
                  aria-label="Search YouTube Shorts topic"
                  aria-autocomplete="list"
                  className="flex-1 min-w-0 bg-transparent text-xs sm:text-sm text-white placeholder:text-zinc-500 focus:outline-none"
                />
                {searchQuery.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setSuggestions([]);
                      inputRef.current?.focus();
                    }}
                    aria-label="Clear search text"
                    className="min-h-[28px] min-w-[28px] flex items-center justify-center rounded-md text-zinc-400 hover:text-white cursor-pointer shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                {searchQuery.trim().length > 0 && (
                  <button
                    type="submit"
                    className="px-3 py-1 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                  >
                    Search
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeSearch}
                  aria-label="Close search"
                  className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </form>

              {/* Floating Advanced Suggestions & Recent Searches Dropdown */}
              <div className="absolute left-0 right-0 top-12 z-50 rounded-2xl bg-[#111114] border border-white/[0.1] shadow-2xl overflow-hidden">
                {searchQuery.trim().length > 0 ? (
                  <div className="py-1.5">
                    <button
                      type="button"
                      onClick={() => executeSearch(searchQuery)}
                      className="w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left text-xs sm:text-sm text-white hover:bg-white/[0.06] cursor-pointer transition-colors"
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <Search className="w-4 h-4 text-rose-400 shrink-0" />
                        <span className="truncate font-medium">
                          Search Shorts for &ldquo;{searchQuery.trim()}&rdquo;
                        </span>
                      </span>
                      <ArrowUpRight className="w-4 h-4 text-zinc-500 shrink-0" />
                    </button>

                    {suggestions.length > 0 && (
                      <div className="border-t border-white/[0.06] mt-1 pt-1">
                        {suggestions.map((item, idx) => (
                          <button
                            key={item}
                            type="button"
                            onClick={() => executeSearch(item)}
                            className={`w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left text-xs sm:text-sm cursor-pointer transition-colors ${
                              highlightedIdx === idx
                                ? 'bg-white/[0.1] text-white'
                                : 'text-zinc-300 hover:bg-white/[0.06] hover:text-white'
                            }`}
                          >
                            <span className="flex items-center gap-2.5 min-w-0">
                              <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                              <span className="truncate">{item}</span>
                            </span>
                            <ArrowUpRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-3 space-y-3">
                    {recentSearches.length > 0 && (
                      <div>
                        <p className="px-1.5 pb-1.5 text-[11px] font-medium text-zinc-400">
                          Recent searches
                        </p>
                        <div className="space-y-0.5">
                          {recentSearches.map((item, idx) => (
                            <div
                              key={item}
                              className={`flex items-center justify-between rounded-lg transition-colors ${
                                highlightedIdx === idx
                                  ? 'bg-white/[0.1]'
                                  : 'hover:bg-white/[0.06]'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => executeSearch(item)}
                                className="flex-1 px-2 py-2 flex items-center gap-2.5 text-left text-xs sm:text-sm text-zinc-200 cursor-pointer min-w-0"
                              >
                                <Clock className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                                <span className="truncate">{item}</span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => removeRecentSearch(item, e)}
                                aria-label={`Remove ${item} from recent searches`}
                                className="min-h-[32px] min-w-[32px] flex items-center justify-center text-zinc-500 hover:text-zinc-200 cursor-pointer shrink-0"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <p className="px-1.5 pb-2 text-[11px] font-medium text-zinc-400">
                        Try searching
                      </p>
                      <div className="flex flex-wrap gap-1.5 px-1">
                        {POPULAR_SEARCHES.map((term) => (
                          <button
                            key={term}
                            type="button"
                            onClick={() => executeSearch(term)}
                            className="min-h-[32px] px-3 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs font-medium text-zinc-200 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
                          >
                            {term}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={openSearch}
              aria-label="Search Shorts"
              className="min-h-[40px] px-3 py-1.5 flex items-center gap-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs sm:text-sm text-zinc-400 hover:text-zinc-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
            >
              <Search className="w-4 h-4 shrink-0" />
              <span className="hidden md:inline">Search...</span>
            </button>
          )}
        </div>

        {!isSearchExpanded && <PWAInstallButton />}

        <button
          type="button"
          onClick={onOpenLiked}
          aria-label={`View ${likedCount} liked shorts`}
          className="min-h-[40px] px-3 py-1.5 flex items-center gap-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs sm:text-sm font-medium text-zinc-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
        >
          <Heart
            className={`w-4 h-4 transition-colors ${
              likedCount > 0 ? 'fill-rose-500 text-rose-500' : 'text-zinc-400'
            }`}
          />
          <span className="hidden sm:inline">Liked</span>
          <span className="font-mono tabular-nums text-zinc-200">{likedCount}</span>
        </button>
      </div>
    </header>
  );
}
