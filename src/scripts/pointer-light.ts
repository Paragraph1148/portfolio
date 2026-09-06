/**
 * Pointer-tracked light.
 *
 * One rAF-coalesced listener drives every keycap backlight (.cap and the
 * lighter .key) and the footer glimmer. Nothing resets its position on leave — only brightness falls
 * away, so the light dies where it stood instead of snapping to centre.
 */
type Pending = { el: HTMLElement; cx: number; cy: number; x: string; y: string };

export function initPointerLight(): void {
  let pending: Pending | null = null;
  let frame = 0;

  const apply = () => {
    frame = 0;
    if (!pending) return;
    const { el, cx, cy, x, y } = pending;
    const r = el.getBoundingClientRect();
    if (r.width && r.height) {
      el.style.setProperty(x, (((cx - r.left) / r.width) * 100).toFixed(1) + "%");
      el.style.setProperty(y, (((cy - r.top) / r.height) * 100).toFixed(1) + "%");
    }
    pending = null;
  };

  const track = (el: HTMLElement, cx: number, cy: number, x: string, y: string) => {
    pending = { el, cx, cy, x, y };
    if (!frame) frame = requestAnimationFrame(apply);
  };

  document.addEventListener(
    "pointermove",
    (e) => {
      const t = e.target as Element | null;
      if (!t || typeof t.closest !== "function") return;

      const cap = t.closest<HTMLElement>(".cap, .key");
      if (cap) {
        track(cap, e.clientX, e.clientY, "--px", "--py");
        return;
      }
      const wm = t.closest<HTMLElement>("[data-glimmer]");
      if (wm) track(wm, e.clientX, e.clientY, "--mx", "--my");
    },
    { passive: true }
  );
}
