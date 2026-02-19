/**
 * Minimal TypeScript declarations for rbush v4 (no bundled types).
 * Only declares the surface area used in objectStore.ts.
 */
declare module "rbush" {
  interface BBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }

  type EqualsFn<T> = (a: T, b: T) => boolean;

  class RBush<T extends BBox> {
    constructor(maxEntries?: number);
    /** Bulk-load items. O(N log N) — much faster than N inserts. */
    load(items: ReadonlyArray<T>): this;
    /** Insert a single item. */
    insert(item: T): this;
    /**
     * Remove an item. Defaults to strict equality; pass a custom `equals`
     * comparator to match by a specific field (e.g. `(a, b) => a.id === b.id`).
     */
    remove(item: T, equals?: EqualsFn<T>): this;
    /** Return all items in the tree. */
    all(): T[];
    /** Return all items that intersect the given bounding box. */
    search(bbox: BBox): T[];
    /** Remove all items. */
    clear(): this;
    /** Return true if the tree is empty. */
    collides(bbox: BBox): boolean;
    toJSON(): object;
    fromJSON(data: object): this;
  }

  export default RBush;
}
