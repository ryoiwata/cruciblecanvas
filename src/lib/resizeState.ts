// Non-reactive resize signaling module.
// These flags are read synchronously by components without triggering React re-renders.
// Intentionally NOT in Zustand to avoid reconciliation during active resize.

// Set of object IDs currently being border-resized
export const borderResizingIds = new Set<string>();

// Whether a Konva Transformer transform is active
export let isTransforming = false;
export function setTransforming(value: boolean): void {
  isTransforming = value;
}
