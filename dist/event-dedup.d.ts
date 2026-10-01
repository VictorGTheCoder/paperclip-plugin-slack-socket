export interface EventDeduperOptions {
    /** Maximum number of keys retained before the oldest are evicted. Default 5000. */
    maxEntries?: number;
    /** Events older than this (ts vs now()) are treated as stale. Default 5 minutes. */
    maxAgeMs?: number;
    /** Injectable clock for tests. Defaults to Date.now. */
    now?: () => number;
}
export interface EventDeduper {
    /**
     * Returns false (and does not record the key) for a duplicate or stale
     * event; otherwise records the key and returns true.
     */
    shouldProcess(key: string): boolean;
}
export declare function createEventDeduper(opts?: EventDeduperOptions): EventDeduper;
