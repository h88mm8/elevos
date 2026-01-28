/**
 * Semaphore for controlling concurrent operations
 * Useful for rate limiting parallel API calls
 */

export class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(maxConcurrency: number) {
    this.permits = maxConcurrency;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    this.permits++;
    const next = this.waiting.shift();
    if (next) {
      this.permits--;
      next();
    }
  }

  async withPermit<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/**
 * Run multiple promises with limited concurrency
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  maxConcurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<Array<{ status: 'fulfilled'; value: R } | { status: 'rejected'; reason: unknown }>> {
  const semaphore = new Semaphore(maxConcurrency);
  
  const results = await Promise.allSettled(
    items.map((item, index) => 
      semaphore.withPermit(() => fn(item, index))
    )
  );
  
  return results;
}
