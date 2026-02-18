import type Konva from "konva";

/**
 * Synchronizes the visual children of a Konva Group to match new dimensions.
 * Handles type-specific child layouts:
 *   - frame: title bar Rect height stays at 40px, background/border Rects get full w/h
 *   - stickyNote: word-wrap Text width adjusted for padding
 *   - circle: Circle center + radius recalculated
 *   - rectangle (default): all Rects get full w/h
 *
 * This MUST be called after any direct Konva dimension change (border resize,
 * Transformer scale reset) to prevent ghost frames where the Group has new
 * dimensions but children still show old sizes.
 */
export function syncKonvaChildren(
  group: Konva.Group,
  objectType: string,
  w: number,
  h: number
): void {
  const children = group.getChildren();

  switch (objectType) {
    case "frame": {
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const cls = child.getClassName();
        if (cls === "Rect") {
          const r = child as unknown as Konva.Rect;
          if (i === 1) {
            // Title bar: only update width, preserve 40px height
            r.width(w);
          } else {
            r.width(w);
            r.height(h);
          }
        } else if (cls === "Text") {
          const t = child as unknown as Konva.Text;
          t.width(w - 20);
        }
      }
      break;
    }
    case "stickyNote": {
      // Recalculate notepad line positions for new height
      const lineSpacing = 22;
      const lineStartY = 30;
      const lineMarginX = 8;
      let lineIndex = 0;

      for (const child of children) {
        const cls = child.getClassName();
        if (cls === "Rect") {
          (child as unknown as Konva.Rect).width(w);
          (child as unknown as Konva.Rect).height(h);
        } else if (cls === "Text") {
          const t = child as unknown as Konva.Text;
          if (t.wrap() === "word") {
            t.width(w - 20);
            t.height(h - 20);
          }
        } else if (cls === "Line") {
          // Update notepad line endpoints for new width and show/hide based on height
          const lineY = lineStartY + lineIndex * lineSpacing;
          const line = child as unknown as Konva.Line;
          if (lineY < h - 10) {
            line.points([lineMarginX, lineY, w - lineMarginX, lineY]);
            line.visible(true);
          } else {
            line.visible(false);
          }
          lineIndex++;
        }
      }
      break;
    }
    case "circle": {
      for (const child of children) {
        if (child.getClassName() === "Circle") {
          const c = child as unknown as Konva.Circle;
          c.x(w / 2);
          c.y(h / 2);
          c.radius(w / 2);
        }
      }
      break;
    }
    default: {
      // rectangle and other types: all Rects get full w/h
      for (const child of children) {
        if (child.getClassName() === "Rect") {
          const r = child as unknown as Konva.Rect;
          r.width(w);
          r.height(h);
        }
      }
      break;
    }
  }
}
