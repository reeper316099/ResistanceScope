// Back/forward navigation history, independent of the DOM so it can be unit tested.
export class NavigationHistory<T> {
  private entries: T[] = [];
  private position = -1;

  /** Creates a history; `same` decides when a new entry equals the current one (and is ignored). */
  constructor(private readonly same: (a: T, b: T) => boolean) {}

  /** The entry currently shown, or undefined before the first push. */
  get current(): T | undefined {
    return this.entries[this.position];
  }

  get canGoBack(): boolean {
    return this.position > 0;
  }

  get canGoForward(): boolean {
    return this.position < this.entries.length - 1;
  }

  /** Records a new entry; anything "forward" of the current position is dropped. */
  push(entry: T): void {
    const current = this.current;
    if (current !== undefined && this.same(current, entry)) return;
    this.entries = [...this.entries.slice(0, this.position + 1), entry];
    this.position = this.entries.length - 1;
  }

  /** Moves back one entry and returns it (undefined if already at the start). */
  back(): T | undefined {
    if (!this.canGoBack) return undefined;
    this.position -= 1;
    return this.current;
  }

  /** Moves forward one entry and returns it (undefined if already at the end). */
  forward(): T | undefined {
    if (!this.canGoForward) return undefined;
    this.position += 1;
    return this.current;
  }
}
