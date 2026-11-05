// Shared selection ("selection sync"): choosing a gene or country in one chart highlights it in the others.
export interface Selection {
  geneId: string | null;
  country: string | null;
}

type Listener = (selection: Selection) => void;

export class SelectionStore {
  private state: Selection = { geneId: null, country: null };
  private readonly listeners = new Set<Listener>();

  get value(): Selection {
    return this.state;
  }

  /** Updates part of the selection and tells every listener (does nothing if nothing changed). */
  set(patch: Partial<Selection>): void {
    const next = { ...this.state, ...patch };
    if (next.geneId === this.state.geneId && next.country === this.state.country) return;
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }

  /** Clears the selection. */
  clear(): void {
    this.set({ geneId: null, country: null });
  }

  /** Subscribes to changes; returns the function that unsubscribes. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
