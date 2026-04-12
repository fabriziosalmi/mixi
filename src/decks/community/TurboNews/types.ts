export type NewsStatus = 'idle' | 'fetching' | 'playing' | 'error';
export type FxKnobId = 'drywet';

export interface NewsItem {
  title: string;
  pubDate: string;
}

export interface TurboNewsSnapshot {
  status: NewsStatus;
  feedUrl: string;
  headlines: NewsItem[];
  currentIndex: number;
  masterVolume: number; // For interface consistency, even if silent
  errorMessage?: string;
}

export function defaultFx(): Record<FxKnobId, number> {
  return {
    drywet: 1.0,
  };
}
