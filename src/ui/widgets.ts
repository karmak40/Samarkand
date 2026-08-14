import type { SoundBank } from '../audio/sfx';
import { clamp, type Rect, rectContains, TAU } from '../core/math';
import type { Input } from '../core/input';
import { t } from '../i18n';

export const FONT = 'Georgia, "Times New Roman", serif';

export const PALETTE = {
  ink: '#e8e2d4',
  muted: '#8b8578',
  dim: '#5f5a51',
  blood: '#a8232a',
  bloodBright: '#d94b52',
  gold: '#d8a13a',
  panel: 'rgba(14,13,17,0.92)',
  panelSoft: 'rgba(22,20,26,0.85)',
  border: 'rgba(148,138,118,0.35)',
  borderStrong: 'rgba(216,161,58,0.7)',
  good: '#7fe08a',
  bad: '#e0655f',
} as const;

export interface TextOptions {
  size?: number;
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  bold?: boolean;
  italic?: boolean;
  /** Draws a dark outline behind the glyphs, for text over busy backgrounds. */
  outline?: boolean;
  maxWidth?: number;
  letterSpacing?: number;
  alpha?: number;
}

export interface ButtonOptions {
  disabled?: boolean;
  accent?: string;
  /** Secondary line rendered under the label. */
  sub?: string;
  size?: number;
  /** Draw as selected/active. */
  active?: boolean;
}

/**
 * Immediate-mode canvas UI.
 *
 * Every widget both draws and reports interaction in the same call, so screens are
 * written as straight-line code with no retained widget tree. `frame()` must be
 * called once per frame before any widget.
 */
export class Ui {
  readonly ctx: CanvasRenderingContext2D;
  private input!: Input;
  width = 0;
  height = 0;

  /** Set while any widget is hovered, so the cursor can change. */
  hoveringInteractive = false;

  /** Assigned by the game; widgets click and hover through it. */
  sound: SoundBank | null = null;

  /** Widget ids hovered last frame, so the hover chirp fires only on entry. */
  private hoveredLastFrame = new Set<string>();
  private hoveredThisFrame = new Set<string>();
  private zoneCounter = 0;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  frame(input: Input, width: number, height: number): void {
    this.input = input;
    this.width = width;
    this.height = height;
    this.hoveringInteractive = false;

    // Swap the hover sets so this frame can compare against the previous one.
    const previous = this.hoveredLastFrame;
    this.hoveredLastFrame = this.hoveredThisFrame;
    this.hoveredThisFrame = previous;
    this.hoveredThisFrame.clear();
    this.zoneCounter = 0;
  }

  /**
   * Register interaction with a widget and play its sounds.
   *
   * Hover is edge-triggered against the previous frame — widgets are drawn in a
   * stable order, so their index is a good enough identity without threading keys
   * through every call site.
   */
  private registerInteraction(rect: Rect, hovered: boolean): boolean {
    const id = `${this.zoneCounter++}:${Math.round(rect.x)},${Math.round(rect.y)}`;
    if (hovered) {
      this.hoveredThisFrame.add(id);
      if (!this.hoveredLastFrame.has(id)) this.sound?.uiHover();
    }
    const clicked = hovered && this.input.mouseClicked;
    if (clicked) this.sound?.uiClick();
    return clicked;
  }

  get mouseX(): number {
    return this.input.mouse.x;
  }

  get mouseY(): number {
    return this.input.mouse.y;
  }

  /** Held state, for widgets that scrub rather than click (the volume bar). */
  get isMouseDown(): boolean {
    return this.input.mouseDown;
  }

  // ---- primitives ----------------------------------------------------------

  text(value: string, x: number, y: number, options: TextOptions = {}): number {
    const {
      size = 15,
      color = PALETTE.ink,
      align = 'left',
      baseline = 'alphabetic',
      bold = false,
      italic = false,
      outline = false,
      maxWidth,
      letterSpacing = 0,
      alpha = 1,
    } = options;

    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;

    if (letterSpacing !== 0) {
      // Manual tracking: canvas letterSpacing isn't universally supported yet.
      this.drawTracked(value, x, y, letterSpacing, align, color, outline);
      const width = ctx.measureText(value).width + letterSpacing * (value.length - 1);
      ctx.restore();
      return width;
    }

    if (outline) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(value, x, y, maxWidth);
    }
    ctx.fillStyle = color;
    ctx.fillText(value, x, y, maxWidth);
    const width = ctx.measureText(value).width;
    ctx.restore();
    return width;
  }

  private drawTracked(
    value: string,
    x: number,
    y: number,
    spacing: number,
    align: CanvasTextAlign,
    color: string,
    outline: boolean,
  ): void {
    const ctx = this.ctx;
    const total = ctx.measureText(value).width + spacing * (value.length - 1);
    let cursor = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;

    ctx.textAlign = 'left';
    for (const char of value) {
      if (outline) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.strokeText(char, cursor, y);
      }
      ctx.fillStyle = color;
      ctx.fillText(char, cursor, y);
      cursor += ctx.measureText(char).width + spacing;
    }
  }

  /** Word-wrapped paragraph. Returns the height consumed. */
  paragraph(
    value: string,
    x: number,
    y: number,
    maxWidth: number,
    options: TextOptions & { lineHeight?: number } = {},
  ): number {
    const { size = 14, lineHeight = (options.size ?? 14) * 1.4 } = options;
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `${options.bold ? 'bold ' : ''}${size}px ${FONT}`;

    const words = value.split(' ');
    const lines: string[] = [];
    let line = '';

    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    ctx.restore();

    lines.forEach((text, i) => {
      this.text(text, x, y + i * lineHeight, options);
    });

    return lines.length * lineHeight;
  }

  roundRect(rect: Rect, radius: number): void {
    const ctx = this.ctx;
    // A degenerate rect (tiny or inverted viewport) must not throw: arcTo rejects
    // negative radii, which would take down the whole frame.
    if (rect.w <= 0 || rect.h <= 0) {
      ctx.beginPath();
      return;
    }
    const r = Math.max(0, Math.min(radius, rect.w / 2, rect.h / 2));
    ctx.beginPath();
    ctx.moveTo(rect.x + r, rect.y);
    ctx.arcTo(rect.x + rect.w, rect.y, rect.x + rect.w, rect.y + rect.h, r);
    ctx.arcTo(rect.x + rect.w, rect.y + rect.h, rect.x, rect.y + rect.h, r);
    ctx.arcTo(rect.x, rect.y + rect.h, rect.x, rect.y, r);
    ctx.arcTo(rect.x, rect.y, rect.x + rect.w, rect.y, r);
    ctx.closePath();
  }

  panel(rect: Rect, options: { fill?: string; border?: string; radius?: number; shadow?: boolean } = {}): void {
    const { fill = PALETTE.panel, border = PALETTE.border, radius = 6, shadow = true } = options;
    const ctx = this.ctx;

    ctx.save();
    if (shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 5;
    }
    this.roundRect(rect, radius);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();

    if (border) {
      this.roundRect(rect, radius);
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /** Horizontal progress bar with an optional trailing "damage ghost". */
  bar(
    rect: Rect,
    fraction: number,
    options: {
      color?: string;
      background?: string;
      ghost?: number;
      ghostColor?: string;
      border?: boolean;
      radius?: number;
    } = {},
  ): void {
    const {
      color = PALETTE.blood,
      background = 'rgba(0,0,0,0.55)',
      ghost,
      ghostColor = 'rgba(216,161,58,0.35)',
      border = true,
      radius = 3,
    } = options;

    const ctx = this.ctx;
    this.roundRect(rect, radius);
    ctx.fillStyle = background;
    ctx.fill();

    if (ghost !== undefined && ghost > fraction) {
      ctx.save();
      this.roundRect(rect, radius);
      ctx.clip();
      ctx.fillStyle = ghostColor;
      ctx.fillRect(rect.x, rect.y, rect.w * clamp(ghost, 0, 1), rect.h);
      ctx.restore();
    }

    const filled = clamp(fraction, 0, 1);
    if (filled > 0) {
      ctx.save();
      this.roundRect(rect, radius);
      ctx.clip();
      ctx.fillStyle = color;
      ctx.fillRect(rect.x, rect.y, rect.w * filled, rect.h);
      // Subtle top highlight so the bar reads as filled volume, not a flat block.
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(rect.x, rect.y, rect.w * filled, rect.h * 0.4);
      ctx.restore();
    }

    if (border) {
      this.roundRect(rect, radius);
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // ---- interaction ---------------------------------------------------------

  isHovered(rect: Rect): boolean {
    return rectContains(rect, this.mouseX, this.mouseY);
  }

  /** Draws a button and returns true on the frame it is clicked. */
  button(rect: Rect, label: string, options: ButtonOptions = {}): boolean {
    const { disabled = false, accent = PALETTE.gold, sub, size = 16, active = false } = options;
    const hovered = !disabled && this.isHovered(rect);
    if (hovered) this.hoveringInteractive = true;

    const clicked = this.registerInteraction(rect, hovered);

    this.panel(rect, {
      fill: disabled
        ? 'rgba(20,19,23,0.7)'
        : hovered
          ? 'rgba(46,40,36,0.95)'
          : active
            ? 'rgba(38,33,30,0.95)'
            : PALETTE.panelSoft,
      border: disabled ? 'rgba(90,86,78,0.25)' : hovered || active ? accent : PALETTE.border,
      radius: 5,
      shadow: !disabled,
    });

    const color = disabled ? PALETTE.dim : hovered ? PALETTE.ink : PALETTE.ink;
    const centerY = sub ? rect.y + rect.h * 0.42 : rect.y + rect.h / 2;

    this.text(label, rect.x + rect.w / 2, centerY, {
      size,
      color,
      align: 'center',
      baseline: 'middle',
      bold: true,
    });

    if (sub) {
      this.text(sub, rect.x + rect.w / 2, rect.y + rect.h * 0.74, {
        size: size * 0.75,
        color: disabled ? PALETTE.dim : PALETTE.muted,
        align: 'center',
        baseline: 'middle',
      });
    }

    return clicked;
  }

  /** A clickable region with fully custom drawing. Returns hover + click state. */
  hitZone(rect: Rect): { hovered: boolean; clicked: boolean } {
    const hovered = this.isHovered(rect);
    if (hovered) this.hoveringInteractive = true;
    return { hovered, clicked: this.registerInteraction(rect, hovered) };
  }

  // ---- decoration ----------------------------------------------------------

  /** Full-screen dim, for modal screens. */
  scrim(alpha = 0.72): void {
    const ctx = this.ctx;
    ctx.fillStyle = `rgba(4,4,6,${alpha})`;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  /** Section heading with a rule to its right. */
  heading(label: string, x: number, y: number, width: number, color: string = PALETTE.gold): void {
    const textWidth = this.text(label, x, y, {
      size: 13,
      color,
      bold: true,
      letterSpacing: 2.2,
      baseline: 'middle',
    });

    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(148,138,118,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + textWidth + 12, y);
    ctx.lineTo(x + width, y);
    ctx.stroke();
  }

  /** Label on the left, value on the right, within a given width. */
  statRow(
    label: string,
    value: string,
    x: number,
    y: number,
    width: number,
    options: { color?: string; size?: number; muted?: boolean } = {},
  ): void {
    const { color = PALETTE.ink, size = 14, muted = false } = options;
    this.text(label, x, y, { size, color: muted ? PALETTE.dim : PALETTE.muted, baseline: 'middle' });
    this.text(value, x + width, y, {
      size,
      color,
      align: 'right',
      baseline: 'middle',
      bold: true,
    });
  }

  /** Small filled circle used as a bullet/legend swatch. */
  swatch(x: number, y: number, color: string, radius = 5): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
  }

  /** Horizontal stacked bar: [{value, color}]. Used for damage-by-type breakdowns. */
  stackedBar(rect: Rect, segments: ReadonlyArray<{ value: number; color: string }>): void {
    const total = segments.reduce((sum, s) => sum + s.value, 0);
    const ctx = this.ctx;

    this.roundRect(rect, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fill();

    if (total <= 0) return;

    ctx.save();
    this.roundRect(rect, 3);
    ctx.clip();

    let cursor = rect.x;
    for (const segment of segments) {
      if (segment.value <= 0) continue;
      const w = (segment.value / total) * rect.w;
      ctx.fillStyle = segment.color;
      ctx.fillRect(cursor, rect.y, w, rect.h);
      cursor += w;
    }
    ctx.restore();
  }

  /** Simple filled line chart. Values are sampled evenly across the rect. */
  lineChart(
    rect: Rect,
    values: readonly number[],
    options: { color?: string; fill?: string; label?: string } = {},
  ): void {
    const { color = PALETTE.gold, fill = 'rgba(216,161,58,0.18)' } = options;
    const ctx = this.ctx;

    this.panel(rect, { fill: 'rgba(10,9,12,0.7)', radius: 4, shadow: false });

    if (values.length < 2) {
      this.text(t('chart.noData'), rect.x + rect.w / 2, rect.y + rect.h / 2, {
        size: 12,
        color: PALETTE.dim,
        align: 'center',
        baseline: 'middle',
        italic: true,
      });
      return;
    }

    let max = 0;
    for (const v of values) if (v > max) max = v;
    if (max <= 0) max = 1;

    const pointAt = (i: number): [number, number] => {
      const x = rect.x + (i / (values.length - 1)) * rect.w;
      const y = rect.y + rect.h - (values[i]! / max) * rect.h * 0.88 - rect.h * 0.06;
      return [x, y];
    };

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(rect.x, rect.y + rect.h);
    for (let i = 0; i < values.length; i++) {
      const [x, y] = pointAt(i);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(rect.x + rect.w, rect.y + rect.h);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < values.length; i++) {
      const [x, y] = pointAt(i);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();

    this.text(t('chart.peak', { n: Math.round(max) }), rect.x + rect.w - 8, rect.y + 12, {
      size: 11,
      color: PALETTE.dim,
      align: 'right',
      baseline: 'middle',
    });
  }
}

/** Convenience: build a rect. */
export function rect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, w, h };
}

/** Seconds -> "M:SS". */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Large numbers -> "12.4k". */
export function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(2)}k`;
  if (value >= 10) return value.toFixed(0);
  return value.toFixed(1);
}
