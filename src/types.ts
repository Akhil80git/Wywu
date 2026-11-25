export interface ShortVideo {
  id: string;
  title: string;
  thumbnail: string;
  views?: string;
  topic: string;
  keywords: string[];
}

export interface TopicOption {
  id: string;
  label: string;
  query: string;
  isCustom?: boolean;
}

export type TasteProfile = Record<string, number>;
