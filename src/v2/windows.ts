import type { SettingsV2, WindowLayout } from './types';
export interface WindowSpec {
  title: string;
  subtitle?: string;
  width?: number;
  height?: number;
  choice?: boolean;
  onClose?: () => void;
}
const safe = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export class WindowManager {
  private panels = new Map<string, { el: HTMLElement; spec: WindowSpec; layout: WindowLayout }>();
  private z = 30;
  private observer: ResizeObserver;
  private saveTimer = 0;
  constructor(
    private host: HTMLElement,
    private dock: HTMLElement,
    private settings: () => SettingsV2,
    private changed: () => void,
  ) {
    this.observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.window!;
        const p = this.panels.get(id);
        if (!p || p.layout.minimized || p.layout.maximized || p.layout.docked || p.el.hidden)
          continue;
        const bounds = p.el.getBoundingClientRect();
        // Hidden panels have no geometry; never persist a zero-sized observation.
        if (bounds.width <= 0 || bounds.height <= 0) continue;
        p.layout.width = bounds.width;
        p.layout.height = bounds.height;
        this.remember(id);
      }
    });
    window.addEventListener('resize', () => {
      for (const id of this.panels.keys()) this.apply(id);
    });
  }
  has(id: string) {
    return this.panels.has(id);
  }
  visible(id: string) {
    const p = this.panels.get(id);
    return !!p && !p.layout.minimized;
  }
  choicesPause() {
    return (
      this.settings().autoPauseChoices &&
      [...this.panels.values()].some((p) => p.spec.choice && !p.layout.minimized)
    );
  }
  open(id: string, spec: WindowSpec, body: string) {
    const existing = this.panels.get(id);
    if (existing) {
      existing.spec = spec;
      existing.el.querySelector('.window-bar h2')!.textContent = spec.title;
      existing.el.querySelector('.window-bar small')!.textContent = spec.subtitle ?? 'LAST SPIRE';
      existing.el.setAttribute('aria-label', spec.title);
      existing.layout.minimized = false;
      this.body(id, body);
      this.apply(id);
      existing.el.style.zIndex = String(++this.z);
      return;
    }
    const narrow = innerWidth < 700,
      w = Math.min(spec.width ?? 510, innerWidth - 24),
      h = Math.min(spec.height ?? 650, innerHeight - 180);
    const stored = this.settings().windows[id];
    const offset = this.panels.size * 24;
    const layout: WindowLayout = stored
      ? { ...stored, minimized: false }
      : {
          x: narrow ? 12 : Math.max(18, (innerWidth - w) / 2 + offset),
          y: narrow
            ? Math.max(90, innerHeight - h - 95)
            : Math.max(94, (innerHeight - h) / 2 + offset),
          width: w,
          height: h,
          minimized: false,
          maximized: false,
          docked: false,
        };
    const el = document.createElement('section');
    el.className = 'spire-window';
    el.dataset.window = id;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-label', spec.title);
    el.innerHTML = `<header class="window-bar" tabindex="0" title="Drag to move · Alt + arrow keys to move by keyboard"><div><small>${safe(spec.subtitle ?? 'LAST SPIRE')}</small><h2>${safe(spec.title)}</h2></div><div class="window-actions"><button data-action="minimize" aria-label="Minimize ${safe(spec.title)}" title="Minimize">−</button><button data-action="dock" aria-label="Dock ${safe(spec.title)}" title="Dock to side">⇥</button><button data-action="maximize" aria-label="Maximize ${safe(spec.title)}" title="Maximize">□</button><button data-action="close" aria-label="Close ${safe(spec.title)}" title="Close">×</button></div></header><div class="window-body">${body}</div><div class="resize-corner" aria-hidden="true"></div>`;
    this.panels.set(id, { el, spec, layout });
    this.host.append(el);
    this.apply(id);
    this.observer.observe(el);
    el.addEventListener('pointerdown', () => {
      el.style.zIndex = String(++this.z);
    });
    const bar = el.querySelector<HTMLElement>('.window-bar')!;
    bar.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button,input,select') || layout.maximized) return;
      // Start from the displayed geometry, including a panel dragged out of its dock.
      const bounds = el.getBoundingClientRect();
      layout.x = bounds.x;
      layout.y = bounds.y;
      layout.width = bounds.width;
      layout.height = bounds.height;
      const start = { x: e.clientX, y: e.clientY, left: layout.x, top: layout.y };
      bar.setPointerCapture(e.pointerId);
      layout.docked = false;
      const move = (v: PointerEvent) => {
        layout.x = start.left + v.clientX - start.x;
        layout.y = start.top + v.clientY - start.y;
        this.apply(id);
      };
      const end = () => {
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', end);
        bar.removeEventListener('pointercancel', end);
        this.remember(id);
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', end);
      bar.addEventListener('pointercancel', end);
    });
    bar.addEventListener('keydown', (e) => {
      if (!e.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      layout.docked = false;
      layout.maximized = false;
      layout.x += e.key === 'ArrowLeft' ? -20 : e.key === 'ArrowRight' ? 20 : 0;
      layout.y += e.key === 'ArrowUp' ? -20 : e.key === 'ArrowDown' ? 20 : 0;
      this.apply(id);
      this.remember(id);
    });
    el.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(
      (button) =>
        (button.onclick = () => {
          const action = button.dataset.action;
          if (action === 'close') {
            this.close(id);
            return;
          }
          if (action === 'minimize') layout.minimized = true;
          if (action === 'maximize') {
            layout.maximized = !layout.maximized;
            layout.docked = false;
          }
          if (action === 'dock') {
            layout.docked = !layout.docked;
            layout.maximized = false;
          }
          this.apply(id);
          this.remember(id);
        }),
    );
    bar.focus();
  }
  body(id: string, html: string) {
    const panel = this.panels.get(id);
    if (panel) {
      const body = panel.el.querySelector<HTMLElement>('.window-body')!;
      const scroll = body.scrollTop;
      body.innerHTML = html;
      body.scrollTop = scroll;
    }
  }
  element(id: string) {
    return this.panels.get(id)?.el;
  }
  close(id: string) {
    const p = this.panels.get(id);
    if (!p) return;
    this.remember(id);
    this.observer.unobserve(p.el);
    p.el.remove();
    this.panels.delete(id);
    this.renderDock();
    p.spec.onClose?.();
  }
  closeAll() {
    for (const id of [...this.panels.keys()]) this.close(id);
  }
  restore(id: string) {
    const p = this.panels.get(id);
    if (!p) return;
    p.layout.minimized = false;
    this.apply(id);
    p.el.style.zIndex = String(++this.z);
    this.remember(id);
  }
  private apply(id: string) {
    const p = this.panels.get(id);
    if (!p) return;
    const { el, layout: l } = p;
    const scale = this.settings().uiScale / 100;
    const roomHeight = Math.max(200, innerHeight - 168);
    const maxWidth = Math.max(280, innerWidth - 24);
    const minWidth = Math.min(340, maxWidth);
    let w = Math.max(minWidth, Math.min(l.width, maxWidth)),
      h = Math.max(Math.min(240, roomHeight), Math.min(l.height, roomHeight));
    let x = l.x,
      y = l.y;
    if (l.maximized) {
      w = maxWidth;
      h = roomHeight;
      x = 12;
      y = 84;
    } else if (l.docked) {
      w = Math.min(550 * scale, maxWidth);
      h = roomHeight;
      x = innerWidth - w - 12;
      y = 84;
    } else {
      x = Math.max(12, Math.min(x, innerWidth - w - 12));
      y = Math.max(84, Math.min(y, innerHeight - h - 84));
      l.x = x;
      l.y = y;
    }
    el.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;z-index:${++this.z};`;
    el.hidden = l.minimized;
    el.classList.toggle('maximized', l.maximized);
    el.classList.toggle('docked', l.docked);
    this.renderDock();
  }
  private remember(id: string) {
    const p = this.panels.get(id);
    if (!p) return;
    this.settings().windows[id] = { ...p.layout };
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(this.changed, 450);
  }
  private renderDock() {
    this.dock.replaceChildren();
    for (const [id, p] of this.panels) {
      if (!p.layout.minimized) continue;
      const b = document.createElement('button');
      b.className = 'dock-tab';
      b.textContent = p.spec.title;
      b.onclick = () => this.restore(id);
      this.dock.append(b);
    }
  }
}
