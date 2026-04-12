import { TurboNewsBus } from './TurboNewsBus';
import { NewsItem, NewsStatus } from './types';

export type DeckId = 'A' | 'B';

export class TurboNewsEngine {
  readonly deckId: DeckId;
  private ctx!: AudioContext;
  
  public bus!: TurboNewsBus;

  private _status: NewsStatus = 'idle';
  private _feedUrl: string = '';
  private _headlines: NewsItem[] = [];
  private _masterVolume = 1.0;

  public onStatusChange?: (status: NewsStatus, err?: string) => void;
  public onHeadlinesLoaded?: (headlines: NewsItem[]) => void;

  constructor(deckId: DeckId) {
    this.deckId = deckId;
  }

  init(ctx: AudioContext) {
    this.ctx = ctx;
    this.bus = new TurboNewsBus(this.ctx);
  }

  destroy() {
    this.stop();
    this.bus.destroy();
  }

  private setStatus(s: NewsStatus, err?: string) {
    this._status = s;
    if (this.onStatusChange) this.onStatusChange(s, err);
  }

  async loadFeed(url: string) {
    this._feedUrl = url;
    this.setStatus('fetching');
    
    try {
      // Use rss2json as a free CORS proxy for any XML RSS feed
      const proxyUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`;
      const res = await fetch(proxyUrl);
      const data = await res.json();
      
      if (data.status === 'ok') {
        const items = data.items.map((item: Record<string, string>) => ({
          title: item.title,
          pubDate: item.pubDate
        }));
        this._headlines = items;
        if (this.onHeadlinesLoaded) this.onHeadlinesLoaded(items);
        this.setStatus('playing');
      } else {
        throw new Error(data.message || 'Failed to parse RSS');
      }
    } catch (err: unknown) {
      this.setStatus('error', err instanceof Error ? err.message : String(err));
    }
  }

  stop() {
    this._feedUrl = '';
    this._headlines = [];
    this.setStatus('idle');
  }

  get status() { return this._status; }
  get feedUrl() { return this._feedUrl; }
  get headlines() { return this._headlines; }
  
  get masterVolume() { return this._masterVolume; }
  set masterVolume(v: number) {
    this._masterVolume = v;
    this.bus.setVolume(v);
  }
}
