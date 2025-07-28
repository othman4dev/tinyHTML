// LRU Cache with TTL implementation
export class LRUCache<K, V> {
  private capacity: number;
  private ttl: number; // Time to live in milliseconds
  private cache: Map<K, { value: V; timestamp: number; mtime?: number }>;
  private accessOrder: K[];

  constructor(capacity: number = 100, ttl: number = 5 * 60 * 1000) { // 5 minutes default TTL
    this.capacity = capacity;
    this.ttl = ttl;
    this.cache = new Map();
    this.accessOrder = [];
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.moveToEnd(key);
    return entry.value;
  }

  set(key: K, value: V, mtime?: number): void {
    const now = Date.now();

    if (this.cache.has(key)) {
      // Update existing entry
      this.cache.set(key, { value, timestamp: now, mtime });
      this.moveToEnd(key);
    } else {
      // Add new entry
      if (this.cache.size >= this.capacity) {
        this.evictLRU();
      }
      this.cache.set(key, { value, timestamp: now, mtime });
      this.accessOrder.push(key);
    }
  }

  delete(key: K): boolean {
    if (this.cache.delete(key)) {
      const index = this.accessOrder.indexOf(key);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
      return true;
    }
    return false;
  }

  has(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.delete(key);
      return false;
    }

    return true;
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  size(): number {
    return this.cache.size;
  }

  // Check if cached entry is still valid based on file modification time
  isValid(key: K, currentMtime: number): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.delete(key);
      return false;
    }

    // Check mtime if provided
    if (entry.mtime !== undefined && entry.mtime < currentMtime) {
      this.delete(key);
      return false;
    }

    return true;
  }

  getStats(): { size: number; capacity: number; hitRatio: number; memoryUsage: string } {
    let totalMemory = 0;
    
    for (const [key, entry] of this.cache) {
      // Rough memory estimation
      totalMemory += JSON.stringify(key).length * 2;
      totalMemory += JSON.stringify(entry.value).length * 2;
      totalMemory += 16; // timestamp + mtime overhead
    }
    
    const memoryUsage = totalMemory > 1024 * 1024 
      ? `${(totalMemory / 1024 / 1024).toFixed(2)} MB`
      : `${(totalMemory / 1024).toFixed(2)} KB`;

    return {
      size: this.cache.size,
      capacity: this.capacity,
      hitRatio: 0, // Would need hit/miss tracking for accurate ratio
      memoryUsage
    };
  }

  private moveToEnd(key: K): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
      this.accessOrder.push(key);
    }
  }

  private evictLRU(): void {
    if (this.accessOrder.length > 0) {
      const lruKey = this.accessOrder.shift()!;
      this.cache.delete(lruKey);
    }
  }

  // Clean up expired entries
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.ttl) {
        this.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }
}
