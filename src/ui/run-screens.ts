import type { Input } from '../core/input';
import { clamp, TAU } from '../core/math';
import { RNG } from '../core/rng';
import { TAP_SLOP } from '../core/touch';
import { t } from '../i18n';
import { type Curse, curseDescription, curseName } from '../progression/curses';
import { RARITY, type SkillCard } from '../progression/skills';
import { type MapNode, type NodeKind, type RunMap } from '../world/runmap';
import { hexAlpha } from '../render/monster-render';
import { layoutCardSlots, PALETTE, rect, type Ui } from './widgets';

interface NodeStyle {
  readonly color: string;
  readonly glow: string;
  /** Radius in pixels; elites and the boss read as bigger threats. */
  readonly radius: number;
}

const NODE_STYLE: Record<NodeKind, NodeStyle> = {
  battle: { color: '#a8232a', glow: '#e0655f', radius: 15 },
  elite: { color: '#d8a13a', glow: '#ffe28a', radius: 19 },
  market: { color: '#5ea8d8', glow: '#a8dcff', radius: 15 },
  cursed: { color: '#a774e0', glow: '#dcbcff', radius: 15 },
  boss: { color: '#e0483f', glow: '#ff8a7a', radius: 24 },
};

/**
 * Fixed pixel gap between depth columns, independent of screen width — a long run
 * simply gets wider than the screen and pans, rather than squeezing every node and
 * label together to force-fit whatever viewport happened to open.
 */
const STEP_X = 150;

export function nodeKindName(kind: NodeKind): string {
  return t(`node.${kind}.name`);
}

export function nodeKindDescription(kind: NodeKind): string {
  return t(`node.${kind}.desc`);
}

/**
 * The run map.
 *
 * Depth runs left to right, lanes stack vertically, and edges only ever join
 * adjacent lanes — so the route is readable at a glance. Columns keep a fixed,
 * comfortable spacing rather than being squeezed to fit the screen, so a long run
 * pans horizontally instead of cramming together. Only the nodes connected to where
 * you stand are clickable; everything else is dimmed to make the commitment obvious.
 */
export interface RunMapResult {
  /** Id of the node the player chose to travel to, or -1 for none this frame. */
  picked: number;
  /** The player asked to abandon the run from here instead of picking a stop. */
  back: boolean;
}

/**
 * Persisted pan state for the run map, owned by the caller (one per run) so the
 * scroll position and drag gesture survive across frames and screen re-visits.
 */
export interface MapViewState {
  scrollX: number;
  /** Node last auto-centered on; re-centers only when this changes. */
  centeredNodeId: number | null;
  dragging: boolean;
  pressX: number;
  pressScrollX: number;
  /** Total horizontal travel since the press, to tell a tap from a drag. */
  travel: number;
  /** `input.mouseDown` as of the previous frame, to detect press/release edges. */
  wasDown: boolean;
}

export function initMapViewState(): MapViewState {
  return {
    scrollX: 0,
    centeredNodeId: null,
    dragging: false,
    pressX: 0,
    pressScrollX: 0,
    travel: 0,
    wasDown: false,
  };
}

export function drawRunMap(
  ui: Ui,
  input: Input,
  map: RunMap,
  view: MapViewState,
  context: {
    currentNodeId: number | null;
    reachable: readonly MapNode[];
    visited: ReadonlySet<number>;
    time: number;
    /** Which half of the run this map belongs to — the war-camp reads the terrain too. */
    biome: 1 | 2;
  },
): RunMapResult {
  const margin = 70;
  const top = 140;
  const bottom = ui.height - 170;
  const stepX = STEP_X;
  const laneH = (bottom - top) / Math.max(1, map.lanes - 1);
  const logicalW = margin * 2 + stepX * Math.max(0, map.depths - 1);
  const maxScrollX = Math.max(0, logicalW - ui.width);

  // Re-center whenever where the player stands changes (a fresh map, or just arrived
  // after a room) — otherwise a long map could open scrolled away from the one node
  // that matters right now.
  if (context.currentNodeId !== view.centeredNodeId) {
    view.centeredNodeId = context.currentNodeId;
    const node = context.currentNodeId !== null ? map.nodes[context.currentNodeId] : null;
    view.scrollX = clamp(node ? margin + node.depth * stepX - ui.width / 2 : 0, 0, maxScrollX);
  }

  // Press/drag/tap tracking, done by hand rather than via `ui.hitZone`'s click: a real
  // mouse's `mouseClicked` fires the instant `mousedown` lands (no travel gating,
  // unlike touch, which `Input` already tap-gates at release) — so pressing a node to
  // *start* a drag would otherwise fire an instant, unintended travel to that room.
  const pressedNow = input.mouseDown && !view.wasDown;
  const releasedNow = !input.mouseDown && view.wasDown;
  if (pressedNow) {
    view.dragging = true;
    view.pressX = input.mouse.x;
    view.pressScrollX = view.scrollX;
    view.travel = 0;
  }
  if (view.dragging && input.mouseDown) {
    const dx = input.mouse.x - view.pressX;
    view.travel = Math.max(view.travel, Math.abs(dx));
    view.scrollX = clamp(view.pressScrollX - dx, 0, maxScrollX);
  }
  let tapped = false;
  if (releasedNow) {
    tapped = view.travel <= TAP_SLOP;
    view.dragging = false;
  }
  view.wasDown = input.mouseDown;
  if (input.wheel !== 0) view.scrollX = clamp(view.scrollX + input.wheel, 0, maxScrollX);
  // A resize (rotating a phone, resizing the window) can shrink maxScrollX below a
  // scroll position that was valid a frame ago — reclamp every frame, not just on
  // the input events that would otherwise be the only thing touching scrollX.
  view.scrollX = clamp(view.scrollX, 0, maxScrollX);

  const position = (node: MapNode): { x: number; y: number } => ({
    x: margin + node.depth * stepX - view.scrollX,
    y: top + node.lane * laneH,
  });

  ui.ctx.drawImage(mapBackdrop(map, logicalW, ui.height, context.biome), -view.scrollX, 0);

  // A painted map is busy everywhere, unlike the plain dark screens elsewhere — the
  // title needs a banner under it, not just an outline, or it gets lost over a green
  // hillside.
  const bannerW = Math.min(560, ui.width - 40);
  ui.panel(rect(ui.width / 2 - bannerW / 2, 22, bannerW, 78), {
    fill: 'rgba(24,19,12,0.6)',
    border: 'rgba(216,161,58,0.35)',
    radius: 6,
    shadow: false,
  });

  ui.fittedText(context.biome === 2 ? t('map.titleAct2') : t('map.title'), ui.width / 2, 54, {
    size: 30,
    color: PALETTE.ink,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 10,
    maxWidth: bannerW - 32,
  });
  ui.fittedText(context.biome === 2 ? t('map.subtitleAct2') : t('map.subtitle'), ui.width / 2, 88, {
    size: 14,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    italic: true,
    maxWidth: bannerW - 32,
  });

  const reachableIds = new Set(context.reachable.map((n) => n.id));
  const ctx = ui.ctx;

  // --- roads ------------------------------------------------------------
  for (const node of map.nodes) {
    const from = position(node);
    for (const nextId of node.next) {
      const target = map.nodes[nextId]!;
      const to = position(target);

      // Highlight only the edges leading out of where the player stands.
      const live = node.id === context.currentNodeId && reachableIds.has(nextId);
      const walked = context.visited.has(node.id) && context.visited.has(nextId);
      drawRoad(ctx, from, to, live, walked);
    }
  }
  ctx.setLineDash([]);

  // --- nodes ----------------------------------------------------------------
  let picked = -1;
  let hoveredNode: MapNode | null = null;

  map.nodes.forEach((node) => {
    const pos = position(node);
    const style = NODE_STYLE[node.kind];
    const isCurrent = node.id === context.currentNodeId;
    const isReachable = reachableIds.has(node.id);
    const isVisited = context.visited.has(node.id);

    const hit = rect(pos.x - style.radius - 6, pos.y - style.radius - 6, style.radius * 2 + 12, style.radius * 2 + 12);
    // `.clicked` is intentionally unused here — a press that turns into a map drag
    // must not also travel to whatever node it happened to start on top of. `tapped`
    // (computed above) already carries the low-travel gate; `.hovered` just says
    // where the release landed.
    const zone = isReachable ? ui.hitZone(hit) : { hovered: ui.isHovered(hit), clicked: false };
    if (zone.hovered) hoveredNode = node;
    if (tapped && zone.hovered) picked = node.id;

    // Reachable settlements breathe so the eye goes straight to the live choices.
    // A burnt one stands dead still — the one thing left here that doesn't move is
    // the smoke, drawn inside drawRuin itself.
    const pulse = isReachable ? 1 + Math.sin(context.time * 4 + node.lane) * 0.08 : 1;
    const radius = style.radius * pulse;
    const bright = isCurrent || isReachable || isVisited;

    if (isReachable) {
      ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, radius * 2.6);
      halo.addColorStop(0, style.glow);
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = zone.hovered ? 0.5 : 0.28;
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius * 2.6, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // A soft shadow so the badge reads as a marker sitting on the map, not a hole
    // painted into it.
    ctx.fillStyle = 'rgba(10,8,6,0.35)';
    ctx.beginPath();
    ctx.ellipse(pos.x + 2, pos.y + radius * 0.5, radius * 0.85, radius * 0.32, 0, 0, TAU);
    ctx.fill();

    // A cleared settlement is ash: the ground plate itself goes dark and cold, no
    // longer tinted by what it used to be.
    ctx.fillStyle = isVisited
      ? 'rgba(11,10,9,0.95)'
      : bright
        ? 'rgba(16,14,20,0.95)'
        : 'rgba(15,14,18,0.9)';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, TAU);
    ctx.fill();

    // Distant stops keep their own colour, just muted — the player should be able
    // to see that an elite waits three depths away.
    ctx.strokeStyle = isVisited ? 'rgba(80,70,58,0.6)' : bright ? style.color : hexAlpha(style.color, 0.5);
    ctx.lineWidth = isCurrent ? 3 : 2;
    ctx.stroke();

    if (isVisited) {
      drawRuin(ctx, pos.x, pos.y, radius, context.time);
    } else {
      drawSettlement(ctx, node.kind, pos.x, pos.y, radius, bright ? style.glow : hexAlpha(style.glow, 0.55));
    }

    if (isCurrent) {
      ui.text(t('map.current'), pos.x, pos.y + radius + 14, {
        size: 10,
        color: PALETTE.gold,
        align: 'center',
        baseline: 'middle',
        letterSpacing: 1,
        outline: true,
      });
    }
  });

  drawPanHint(ctx, ui.width, top, bottom, view.scrollX, maxScrollX);

  // A second banner for the ruler and the inspector line — same reasoning as the
  // title: this text sits over open terrain and needs its own dark ground.
  const footW = Math.min(620, ui.width - 40);
  ui.panel(rect(ui.width / 2 - footW / 2, bottom + 26, footW, 78), {
    fill: 'rgba(24,19,12,0.6)',
    border: 'rgba(216,161,58,0.3)',
    radius: 6,
    shadow: false,
  });

  ui.text(
    t('map.depth', {
      n: (context.currentNodeId !== null ? map.nodes[context.currentNodeId]!.depth + 1 : 1),
      total: map.depths,
    }),
    ui.width / 2,
    bottom + 46,
    { size: 12, color: PALETTE.dim, align: 'center', baseline: 'middle', letterSpacing: 1.5 },
  );

  drawNodeInspector(ui, hoveredNode, context.reachable, bottom + 76);

  // Number keys pick among the reachable nodes, ordered top to bottom.
  const ordered = [...context.reachable].sort((a, b) => a.lane - b.lane);
  const slots = ['slot1', 'slot2', 'slot3'] as const;
  ordered.forEach((node, i) => {
    const key = slots[i];
    if (key && input.wasPressed(key)) picked = node.id;

    const pos = position(node);
    ui.text(`${i + 1}`, pos.x, pos.y - NODE_STYLE[node.kind].radius - 15, {
      size: 12,
      color: PALETTE.gold,
      align: 'center',
      baseline: 'middle',
      bold: true,
      outline: true,
    });
  });

  const back = ui.button(rect(ui.width / 2 - 90, ui.height - 44, 180, 34), t('common.back'), {
    accent: PALETTE.muted,
    size: 13,
  });

  return { picked, back };
}

/**
 * A soft edge fade plus a small arrow wherever the map keeps going off-screen, so a
 * screen that has simply run out of width doesn't read the same as one with nothing
 * left to show. Screen-space — drawn after the pan offset is already baked into
 * every node position, so this never scrolls with the content.
 */
function drawPanHint(
  ctx: CanvasRenderingContext2D,
  width: number,
  top: number,
  bottom: number,
  scrollX: number,
  maxScrollX: number,
): void {
  const fadeW = 46;
  const midY = (top + bottom) / 2;

  const drawEdge = (onLeft: boolean) => {
    const x0 = onLeft ? 0 : width;
    const x1 = onLeft ? fadeW : width - fadeW;
    const gradient = ctx.createLinearGradient(x0, 0, x1, 0);
    gradient.addColorStop(0, 'rgba(10,8,6,0.55)');
    gradient.addColorStop(1, 'rgba(10,8,6,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(Math.min(x0, x1), top, fadeW, bottom - top);

    const arrowX = onLeft ? 16 : width - 16;
    const dir = onLeft ? -1 : 1;
    ctx.fillStyle = 'rgba(216,196,138,0.6)';
    ctx.beginPath();
    ctx.moveTo(arrowX + dir * 5, midY - 8);
    ctx.lineTo(arrowX - dir * 5, midY);
    ctx.lineTo(arrowX + dir * 5, midY + 8);
    ctx.closePath();
    ctx.fill();
  };

  if (scrollX > 0) drawEdge(true);
  if (scrollX < maxScrollX) drawEdge(false);
}

/** Hovering explains a stop; with nothing hovered, the live options are listed. */
function drawNodeInspector(
  ui: Ui,
  hovered: MapNode | null,
  reachable: readonly MapNode[],
  y: number,
): void {
  if (hovered) {
    const style = NODE_STYLE[hovered.kind];
    ui.text(nodeKindName(hovered.kind), ui.width / 2, y, {
      size: 17,
      color: style.glow,
      align: 'center',
      baseline: 'middle',
      bold: true,
    });
    ui.text(nodeKindDescription(hovered.kind), ui.width / 2, y + 22, {
      size: 13,
      color: PALETTE.muted,
      align: 'center',
      baseline: 'middle',
    });
    return;
  }

  const labels = [...reachable]
    .sort((a, b) => a.lane - b.lane)
    .map((node, i) => `${i + 1} · ${nodeKindName(node.kind)}`);
  ui.text(labels.join('     '), ui.width / 2, y + 10, {
    size: 14,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
  });
}

// ---------------------------------------------------------------------------

/**
 * A living settlement, drawn as a tiny huddle of roofs rather than an abstract
 * glyph — the map should read as places, not a legend of icons. Shape carries the
 * kind; colour (passed in by the caller, bright or dimmed) carries distance and
 * reachability the same way it always did.
 */
function drawSettlement(
  ctx: CanvasRenderingContext2D,
  kind: NodeKind,
  x: number,
  y: number,
  radius: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, radius * 0.09);
  const r = radius * 0.62;

  switch (kind) {
    case 'battle':
      // A pair of huts — the plainest stop on the road.
      drawHut(ctx, -r * 0.5, r * 0.55, r * 0.85, r * 1.3);
      drawHut(ctx, r * 0.42, r * 0.62, r * 0.7, r * 1.05);
      break;

    case 'elite':
      // A watchtower next to its hut: this stop is guarded.
      drawHut(ctx, -r * 0.55, r * 0.6, r * 0.72, r * 1.05);
      drawTower(ctx, r * 0.4, r * 0.62, r * 0.48, r * 1.9);
      break;

    case 'market': {
      // A merchant's canopy on two poles.
      ctx.beginPath();
      ctx.moveTo(-r * 0.95, r * 0.25);
      ctx.lineTo(0, -r * 1.05);
      ctx.lineTo(r * 0.95, r * 0.25);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, r * 0.25);
      ctx.lineTo(-r * 0.6, r * 1.15);
      ctx.moveTo(r * 0.6, r * 0.25);
      ctx.lineTo(r * 0.6, r * 1.15);
      ctx.stroke();
      break;
    }

    case 'cursed':
      // A leaning, cracked monolith — wrong in a way a hut never is.
      ctx.save();
      ctx.rotate(-0.14);
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, r * 1.15);
      ctx.lineTo(-r * 0.55, -r * 0.55);
      ctx.lineTo(0, -r * 1.3);
      ctx.lineTo(r * 0.35, -r * 0.45);
      ctx.lineTo(r * 0.28, r * 1.15);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      break;

    case 'boss':
      // A small keep: two flanking towers, a wall, and a taller one behind it.
      drawTower(ctx, -r * 0.85, r * 0.65, r * 0.5, r * 1.55);
      drawTower(ctx, r * 0.85, r * 0.65, r * 0.5, r * 1.55);
      ctx.beginPath();
      ctx.rect(-r * 0.6, -r * 0.05, r * 1.2, r * 0.75);
      ctx.fill();
      drawTower(ctx, 0, -r * 0.05, r * 0.55, r * 1.85);
      break;
  }

  ctx.restore();
}

/** A simple house: a wall block under a peaked roof, in the current fill/stroke. */
function drawHut(ctx: CanvasRenderingContext2D, cx: number, groundY: number, w: number, h: number): void {
  const wallH = h * 0.55;
  const bodyTop = groundY - wallH;
  ctx.beginPath();
  ctx.rect(cx - w / 2, bodyTop, w, wallH);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.62, bodyTop);
  ctx.lineTo(cx, groundY - h);
  ctx.lineTo(cx + w * 0.62, bodyTop);
  ctx.closePath();
  ctx.fill();
}

/** A narrow tower with a capstone, taller than any hut on the same map. */
function drawTower(ctx: CanvasRenderingContext2D, cx: number, groundY: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.rect(cx - w / 2, groundY - h, w, h);
  ctx.fill();
  ctx.fillRect(cx - w * 0.65, groundY - h - w * 0.35, w * 1.3, w * 0.35);
}

/**
 * What's left once a settlement is cleared: a dead mound of rubble, a couple of
 * wall stumps leaning off true, and the two things that still move — a slow
 * drift of smoke and a few embers still breathing under the ash.
 */
function drawRuin(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, time: number): void {
  ctx.save();
  ctx.translate(x, y);
  const r = radius * 0.62;

  ctx.fillStyle = 'rgba(20,18,16,0.92)';
  ctx.beginPath();
  ctx.moveTo(-r * 0.9, r * 0.7);
  ctx.lineTo(-r * 0.3, r * 0.1);
  ctx.lineTo(r * 0.1, r * 0.5);
  ctx.lineTo(r * 0.9, r * 0.62);
  ctx.lineTo(r * 0.75, r * 1.1);
  ctx.lineTo(-r * 0.8, r * 1.1);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(10,9,8,0.95)';
  ctx.lineWidth = Math.max(1.5, r * 0.18);
  ctx.beginPath();
  ctx.moveTo(-r * 0.5, r * 0.5);
  ctx.lineTo(-r * 0.62, -r * 0.55);
  ctx.moveTo(r * 0.35, r * 0.55);
  ctx.lineTo(r * 0.15, -r * 0.35);
  ctx.stroke();

  // Smoke drifting sideways, slow enough that it reads as still rising rather
  // than blowing away.
  const drift = Math.sin(time * 0.4) * r * 0.3;
  const wisp = ctx.createLinearGradient(0, -r * 0.4, drift, -r * 2.8);
  wisp.addColorStop(0, 'rgba(150,148,142,0.3)');
  wisp.addColorStop(1, 'rgba(150,148,142,0)');
  ctx.fillStyle = wisp;
  ctx.beginPath();
  ctx.ellipse(drift * 0.4, -r * 1.5, r * 0.55, r * 1.35, 0, 0, TAU);
  ctx.fill();

  // Embers still breathing under the ash.
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) {
    const phase = time * 2.2 + i * 2.1;
    const ex = Math.sin(phase * 0.6 + i) * r * 0.5;
    const ey = r * 0.55 - Math.abs(Math.sin(phase)) * r * 0.12;
    ctx.globalAlpha = 0.3 + Math.sin(phase) * 0.22;
    ctx.fillStyle = '#ff8a3c';
    ctx.beginPath();
    ctx.arc(ex, ey, Math.max(1, r * 0.08), 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  ctx.restore();
}

/** A worn dirt road: a wide dark track with a lighter, broken tread down the middle. */
function drawRoad(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  live: boolean,
  walked: boolean,
): void {
  // A shallow S-curve reads as a road rather than a wiring diagram. Control points
  // sit close to each end so a lane change stays a short kink.
  const lean = (to.x - from.x) * 0.34;
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.bezierCurveTo(from.x + lean, from.y, to.x - lean, to.y, to.x, to.y);
  };

  ctx.setLineDash([]);
  ctx.strokeStyle = live ? 'rgba(70,52,28,0.9)' : walked ? 'rgba(52,42,30,0.72)' : 'rgba(44,40,32,0.6)';
  ctx.lineWidth = live ? 7 : 5;
  path();
  ctx.stroke();

  ctx.strokeStyle = live ? 'rgba(230,178,68,0.95)' : walked ? 'rgba(206,180,120,0.55)' : 'rgba(230,222,196,0.4)';
  ctx.lineWidth = live ? 2.2 : 1.2;
  ctx.setLineDash(live ? [] : [3, 7]);
  path();
  ctx.stroke();
  ctx.setLineDash([]);
}

// ---------------------------------------------------------------------------

/** Cached per run: the terrain never changes once a map is generated. */
let cachedBackdrop: {
  forMap: RunMap;
  width: number;
  height: number;
  biome: 1 | 2;
  canvas: HTMLCanvasElement;
} | null = null;

function mapBackdrop(map: RunMap, width: number, height: number, biome: 1 | 2): HTMLCanvasElement {
  if (
    cachedBackdrop &&
    cachedBackdrop.forMap === map &&
    cachedBackdrop.width === width &&
    cachedBackdrop.height === height &&
    cachedBackdrop.biome === biome
  ) {
    return cachedBackdrop.canvas;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const ctx = canvas.getContext('2d');
  if (ctx) paintBackdrop(ctx, canvas.width, canvas.height, new RNG(), biome);

  cachedBackdrop = { forMap: map, width, height, biome, canvas };
  return canvas;
}

interface Biome {
  readonly key: 'forest' | 'plains' | 'mountain' | 'water' | 'sand';
  readonly fill: string;
  readonly edge: string;
  /** Relative chance of an anchor rolling this biome. */
  readonly weight: number;
}

const BIOMES: readonly Biome[] = [
  { key: 'plains', fill: '#b6ab6c', edge: '#8f8352', weight: 3 },
  { key: 'forest', fill: '#5c7a45', edge: '#3c5730', weight: 3 },
  { key: 'mountain', fill: '#8d7c68', edge: '#5b4d3f', weight: 2 },
  { key: 'water', fill: '#4f8892', edge: '#33616a', weight: 2 },
  { key: 'sand', fill: '#d9c48a', edge: '#b29a5c', weight: 1 },
];

/** The war-camp's map: dominated by sand and stony highlands, with only a rare oasis. */
const WAR_CAMP_BIOMES: readonly Biome[] = [
  { key: 'sand', fill: '#d9c48a', edge: '#b29a5c', weight: 4 },
  { key: 'plains', fill: '#c2a968', edge: '#9c8350', weight: 3 },
  { key: 'mountain', fill: '#8d7c68', edge: '#5b4d3f', weight: 3 },
  { key: 'forest', fill: '#5c7a45', edge: '#3c5730', weight: 1 },
  { key: 'water', fill: '#4f8892', edge: '#33616a', weight: 0.6 },
];

interface BiomeAnchor {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly biome: Biome;
}

/**
 * A painted region map, in the style of a fantasy-game world map: soft irregular
 * biome patches — forest, plains, stony highlands, water, sand — each with its own
 * hand-drawn texture, rather than the abstract dark war-table this replaced. Baked
 * once per run into an offscreen canvas, since none of it depends on where the
 * player has been; only the settlements and roads drawn on top change frame to
 * frame.
 */
function paintBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, rng: RNG, mapBiome: 1 | 2): void {
  const palette = mapBiome === 2 ? WAR_CAMP_BIOMES : BIOMES;

  ctx.fillStyle = mapBiome === 2 ? '#c2a968' : '#b6ab6c';
  ctx.fillRect(0, 0, w, h);

  const anchors: BiomeAnchor[] = [];
  // Scales with width, not a flat count — the map screen now bakes this at the full
  // logical (pannable) width rather than the screen width, and a flat count of
  // patches would thin out into gaps on a long run.
  const count = Math.max(10, Math.round(w / 90));
  for (let i = 0; i < count; i++) {
    anchors.push({
      x: rng.range(w * -0.05, w * 1.05),
      y: rng.range(h * -0.1, h * 1.1),
      r: rng.range(Math.min(w, h) * 0.16, Math.min(w, h) * 0.3),
      biome: rng.pickWeighted(palette, (b) => b.weight),
    });
  }
  // Water settles into the low ground first; everything else is painted over it,
  // the way a coastline reads as land overlapping a sea rather than the reverse.
  const ordered = [...anchors].sort((a, b) => (a.biome.key === 'water' ? -1 : 0) - (b.biome.key === 'water' ? -1 : 0));

  for (const anchor of ordered) paintBiomeBlob(ctx, anchor, rng);
  for (const anchor of ordered) paintBiomeTexture(ctx, anchor, rng);

  paintGrain(ctx, w, h, rng);

  // Vignette, so the edges recede and the route through the middle stays the focus.
  const vignette = ctx.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.4,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.75,
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(20,14,8,0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  paintMapFrame(ctx, w, h);
}

/** One soft-edged biome patch — a jittered polygon, blurred so it blends into its neighbours. */
function paintBiomeBlob(ctx: CanvasRenderingContext2D, anchor: BiomeAnchor, rng: RNG): void {
  const points = 10 + rng.int(0, 4);
  ctx.save();
  ctx.filter = `blur(${Math.max(10, anchor.r * 0.22)}px)`;
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = anchor.biome.fill;
  ctx.beginPath();
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * TAU;
    const rad = anchor.r * (0.7 + rng.next() * 0.5);
    const px = anchor.x + Math.cos(a) * rad;
    const py = anchor.y + Math.sin(a) * rad * 0.82;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** The hand-drawn detail that tells one biome apart from another at a glance. */
function paintBiomeTexture(ctx: CanvasRenderingContext2D, anchor: BiomeAnchor, rng: RNG): void {
  const density = Math.round((anchor.r / 22) ** 1.3);

  switch (anchor.biome.key) {
    case 'forest':
      for (let i = 0; i < density * 3; i++) {
        const { x, y } = jitterWithin(anchor, rng);
        drawTreeGlyph(ctx, x, y, rng.range(7, 13));
      }
      break;

    case 'mountain':
      for (let i = 0; i < density; i++) {
        const { x, y } = jitterWithin(anchor, rng, 0.75);
        drawMountainGlyph(ctx, x, y, rng.range(16, 30));
      }
      break;

    case 'water':
      ctx.strokeStyle = 'rgba(210,236,238,0.35)';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < density * 2; i++) {
        const { x, y } = jitterWithin(anchor, rng);
        const len = rng.range(8, 18);
        ctx.beginPath();
        ctx.moveTo(x - len / 2, y);
        ctx.quadraticCurveTo(x, y - 3, x + len / 2, y);
        ctx.stroke();
      }
      break;

    case 'sand':
      ctx.fillStyle = 'rgba(140,116,64,0.3)';
      for (let i = 0; i < density * 4; i++) {
        const { x, y } = jitterWithin(anchor, rng);
        ctx.beginPath();
        ctx.arc(x, y, rng.range(1, 2.4), 0, TAU);
        ctx.fill();
      }
      break;

    case 'plains':
      ctx.strokeStyle = 'rgba(230,220,150,0.3)';
      ctx.lineWidth = 1;
      for (let i = 0; i < density * 3; i++) {
        const { x, y } = jitterWithin(anchor, rng);
        const h = rng.range(3, 7);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + rng.range(-2, 2), y - h);
        ctx.stroke();
      }
      break;
  }
}

function jitterWithin(anchor: BiomeAnchor, rng: RNG, fill = 0.9): { x: number; y: number } {
  const a = rng.next() * TAU;
  const rad = anchor.r * fill * Math.sqrt(rng.next());
  return { x: anchor.x + Math.cos(a) * rad, y: anchor.y + Math.sin(a) * rad * 0.82 };
}

function drawMountainGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.fillStyle = '#6e6052';
  ctx.strokeStyle = 'rgba(40,32,24,0.55)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x - s, y + s * 0.6);
  ctx.lineTo(x - s * 0.15, y - s);
  ctx.lineTo(x + s * 0.25, y - s * 0.3);
  ctx.lineTo(x + s, y + s * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // A pale scree line on the sunlit face gives the peak volume rather than a
  // flat silhouette.
  ctx.fillStyle = 'rgba(226,218,198,0.5)';
  ctx.beginPath();
  ctx.moveTo(x - s * 0.15, y - s);
  ctx.lineTo(x + s * 0.25, y - s * 0.3);
  ctx.lineTo(x - s * 0.05, y - s * 0.15);
  ctx.closePath();
  ctx.fill();
}

function drawTreeGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.fillStyle = '#3f5730';
  for (let i = 0; i < 3; i++) {
    const ox = x + (i - 1) * s * 0.5;
    const oy = y - Math.abs(i - 1) * s * 0.15;
    ctx.beginPath();
    ctx.moveTo(ox, oy - s);
    ctx.lineTo(ox - s * 0.4, oy + s * 0.3);
    ctx.lineTo(ox + s * 0.4, oy + s * 0.3);
    ctx.closePath();
    ctx.fill();
  }
}

/** A faint stipple over everything, so flat-filled blobs read as painted, not vector. */
function paintGrain(ctx: CanvasRenderingContext2D, w: number, h: number, rng: RNG): void {
  const count = Math.round((w * h) / 900);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = rng.bool(0.5) ? 'rgba(255,248,220,0.035)' : 'rgba(20,14,6,0.035)';
    ctx.fillRect(rng.range(0, w), rng.range(0, h), 1, 1);
  }
}

/** A simple painted border, like the ruled edge of a map spread on a table. */
function paintMapFrame(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const inset = 10;
  ctx.strokeStyle = 'rgba(36,26,16,0.5)';
  ctx.lineWidth = 3;
  ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
  ctx.strokeStyle = 'rgba(216,196,138,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(inset + 5, inset + 5, w - (inset + 5) * 2, h - (inset + 5) * 2);
}

// ---------------------------------------------------------------------------

export type MarketOfferKind = 'card' | 'heal' | 'maxHp' | 'cure';

export interface MarketOffer {
  kind: MarketOfferKind;
  price: number;
  /** Filled in for offers whose text needs a number. */
  amount: number;
  sold: boolean;
}

export interface MarketResult {
  /** Index of the offer bought this frame, or -1. */
  bought: number;
  left: boolean;
}

/**
 * The scavenger's den.
 *
 * No combat: souls are the only currency and every slot is a straight trade. Sold
 * slots stay visible but struck through, so the player can see what they spent on.
 */
export function drawMarket(
  ui: Ui,
  input: Input,
  offers: readonly MarketOffer[],
  souls: number,
): MarketResult {
  ui.scrim(0.9);
  const result: MarketResult = { bought: -1, left: false };

  ui.fittedText(t('market.title'), ui.width / 2, 66, {
    size: 28,
    color: '#9fd7ff',
    align: 'center',
    baseline: 'middle',
    letterSpacing: 8,
    maxWidth: ui.width - 48,
  });
  ui.fittedText(t('market.subtitle'), ui.width / 2, 100, {
    size: 14,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    italic: true,
    maxWidth: ui.width - 48,
  });
  ui.text(t('market.souls', { n: Math.floor(souls) }), ui.width / 2, 128, {
    size: 15,
    color: '#cfeaff',
    align: 'center',
    baseline: 'middle',
    bold: true,
  });

  // Same overflow as the card draft below this width, same fix: stack instead of
  // forcing a floor width that would run three offers off both edges.
  const layout = layoutCardSlots(ui, offers.length, {
    stackedBreakpoint: 620,
    grid: { minW: 150, maxW: 250, sideMargin: 140, minH: 190, maxH: 280, heightMargin: 340, gap: 22, centerOffset: 30 },
    stacked: { margin: 20, gap: 10, top: 148, minRowH: 78, maxRowH: 120, bottomMargin: 90 },
  });
  const offersBottom = layout.bottom;

  if (!layout.stacked) {
    offers.forEach((offer, i) => {
      const affordable = !offer.sold && souls >= offer.price;
      const bounds = layout.slots[i]!.bounds;
      const zone = offer.sold ? { hovered: false, clicked: false } : ui.hitZone(bounds);

      ui.panel(bounds, {
        fill: offer.sold
          ? 'rgba(12,11,15,0.6)'
          : zone.hovered && affordable
            ? 'rgba(26,32,40,0.97)'
            : 'rgba(16,15,19,0.95)',
        border: offer.sold
          ? 'rgba(90,86,78,0.3)'
          : affordable
            ? zone.hovered
              ? '#a8dcff'
              : '#5ea8d8'
            : 'rgba(110,104,92,0.4)',
        radius: 8,
      });

      const dim = offer.sold || !affordable;

      ui.text(t(`offer.${offer.kind}.name`), bounds.x + bounds.w / 2, bounds.y + 40, {
        size: 19,
        color: dim ? PALETTE.dim : PALETTE.ink,
        align: 'center',
        baseline: 'middle',
        bold: true,
      });

      ui.paragraph(
        t(`offer.${offer.kind}.desc`, { n: offer.amount }),
        bounds.x + 18,
        bounds.y + 78,
        bounds.w - 36,
        { size: 13, color: dim ? PALETTE.dim : PALETTE.muted, lineHeight: 19 },
      );

      if (offer.sold) {
        ui.text(t('market.sold'), bounds.x + bounds.w / 2, bounds.y + bounds.h - 44, {
          size: 15,
          color: PALETTE.dim,
          align: 'center',
          baseline: 'middle',
          letterSpacing: 3,
        });
      } else {
        ui.text(`${offer.price}`, bounds.x + bounds.w / 2, bounds.y + bounds.h - 50, {
          size: 22,
          color: affordable ? '#cfeaff' : PALETTE.bad,
          align: 'center',
          baseline: 'middle',
          bold: true,
        });
        ui.text(
          affordable ? t('hud.soulsLabel') : t('market.tooPoor'),
          bounds.x + bounds.w / 2,
          bounds.y + bounds.h - 28,
          { size: 11, color: PALETTE.dim, align: 'center', baseline: 'middle' },
        );
        ui.text(`${i + 1}`, bounds.x + bounds.w / 2, bounds.y + bounds.h - 12, {
          size: 11,
          color: PALETTE.dim,
          align: 'center',
          baseline: 'middle',
        });
      }

      if (zone.clicked && affordable) result.bought = i;
    });
  } else {
    offers.forEach((offer, i) => {
      const affordable = !offer.sold && souls >= offer.price;
      const bounds = layout.slots[i]!.bounds;
      const zone = offer.sold ? { hovered: false, clicked: false } : ui.hitZone(bounds);
      const dim = offer.sold || !affordable;

      ui.panel(bounds, {
        fill: offer.sold
          ? 'rgba(12,11,15,0.6)'
          : zone.hovered && affordable
            ? 'rgba(26,32,40,0.97)'
            : 'rgba(16,15,19,0.95)',
        border: offer.sold
          ? 'rgba(90,86,78,0.3)'
          : affordable
            ? zone.hovered
              ? '#a8dcff'
              : '#5ea8d8'
            : 'rgba(110,104,92,0.4)',
        radius: 8,
      });

      const textW = bounds.w - 96;
      ui.fittedText(t(`offer.${offer.kind}.name`), bounds.x + 16, bounds.y + 20, {
        size: 16,
        color: dim ? PALETTE.dim : PALETTE.ink,
        baseline: 'middle',
        bold: true,
        maxWidth: textW,
      });
      ui.paragraph(t(`offer.${offer.kind}.desc`, { n: offer.amount }), bounds.x + 16, bounds.y + 40, textW, {
        size: 12,
        color: dim ? PALETTE.dim : PALETTE.muted,
        lineHeight: 15,
      });

      const priceX = bounds.x + bounds.w - 16;
      if (offer.sold) {
        ui.text(t('market.sold'), priceX, bounds.y + bounds.h / 2, {
          size: 12,
          color: PALETTE.dim,
          align: 'right',
          baseline: 'middle',
          letterSpacing: 2,
        });
      } else {
        ui.text(`${offer.price}`, priceX, bounds.y + bounds.h / 2 - 9, {
          size: 17,
          color: affordable ? '#cfeaff' : PALETTE.bad,
          align: 'right',
          baseline: 'middle',
          bold: true,
        });
        ui.text(`${i + 1}`, priceX, bounds.y + bounds.h / 2 + 11, {
          size: 10,
          color: PALETTE.dim,
          align: 'right',
          baseline: 'middle',
        });
      }

      if (zone.clicked && affordable) result.bought = i;
    });
  }

  const slots = ['slot1', 'slot2', 'slot3'] as const;
  offers.forEach((offer, i) => {
    const key = slots[i];
    if (!key || offer.sold) return;
    if (input.wasPressed(key) && souls >= offer.price) result.bought = i;
  });

  if (
    ui.button(rect(ui.width / 2 - 100, offersBottom + 34, 200, 44), t('market.leave'), {
      accent: PALETTE.gold,
    }) ||
    input.consumePress('pause')
  ) {
    result.left = true;
  }

  return result;
}

// ---------------------------------------------------------------------------

/** One bargain at a cursed altar: a card you can see, for a curse you can see. */
export interface CursedOffer {
  card: SkillCard;
  curse: Curse;
}

export interface CursedResult {
  taken: number;
  left: boolean;
}

/**
 * The cursed altar.
 *
 * Both halves of the bargain are shown up front — reward above, price below. Nothing
 * is hidden, because the interest is in weighing a known cost against a known gain,
 * not in gambling.
 */
export function drawCursedAltar(
  ui: Ui,
  input: Input,
  offers: readonly CursedOffer[],
): CursedResult {
  ui.scrim(0.92);
  const result: CursedResult = { taken: -1, left: false };

  ui.fittedText(t('cursed.title'), ui.width / 2, 62, {
    size: 28,
    color: '#b06cff',
    align: 'center',
    baseline: 'middle',
    letterSpacing: 9,
    maxWidth: ui.width - 48,
  });
  ui.fittedText(t('cursed.subtitle'), ui.width / 2, 96, {
    size: 14,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    italic: true,
    maxWidth: ui.width - 48,
  });

  // Two stacked halves per card already ask for real width; below this a floor
  // width would run the row off both edges rather than just feeling snug.
  const layout = layoutCardSlots(ui, offers.length, {
    stackedBreakpoint: 640,
    grid: { minW: 200, maxW: 340, sideMargin: 160, minH: 240, maxH: 360, heightMargin: 300, gap: 30, centerOffset: 24 },
    stacked: { margin: 20, gap: 12, top: 130, minRowH: 130, maxRowH: 220, bottomMargin: 90 },
  });
  const cardsBottom = layout.bottom;

  if (!layout.stacked) {
    offers.forEach((offer, i) => {
      const bounds = layout.slots[i]!.bounds;
      const zone = ui.hitZone(bounds);
      const rarity = RARITY[offer.card.rarity];

      ui.panel(bounds, {
        fill: zone.hovered ? 'rgba(34,24,42,0.97)' : 'rgba(18,14,22,0.95)',
        border: zone.hovered ? '#d4a8ff' : '#6b3fa0',
        radius: 8,
      });

      // Reward half.
      ui.heading(t('cursed.rewardLabel'), bounds.x + 20, bounds.y + 28, bounds.w - 40, rarity.color);
      ui.text(offer.card.name, bounds.x + bounds.w / 2, bounds.y + 60, {
        size: 20,
        color: rarity.glow,
        align: 'center',
        baseline: 'middle',
        bold: true,
      });
      ui.paragraph(offer.card.description, bounds.x + 20, bounds.y + 88, bounds.w - 40, {
        size: 13,
        color: PALETTE.muted,
        lineHeight: 19,
      });

      // Divider.
      const midY = bounds.y + bounds.h * 0.56;
      ui.ctx.strokeStyle = 'rgba(148,138,118,0.25)';
      ui.ctx.lineWidth = 1;
      ui.ctx.beginPath();
      ui.ctx.moveTo(bounds.x + 20, midY);
      ui.ctx.lineTo(bounds.x + bounds.w - 20, midY);
      ui.ctx.stroke();

      // Price half.
      ui.heading(t('cursed.priceLabel'), bounds.x + 20, midY + 20, bounds.w - 40, PALETTE.bad);
      ui.text(curseName(offer.curse), bounds.x + bounds.w / 2, midY + 50, {
        size: 18,
        color: PALETTE.bad,
        align: 'center',
        baseline: 'middle',
        bold: true,
      });
      ui.paragraph(curseDescription(offer.curse), bounds.x + 20, midY + 76, bounds.w - 40, {
        size: 13,
        color: PALETTE.muted,
        lineHeight: 18,
      });

      ui.text(`${i + 1}`, bounds.x + bounds.w / 2, bounds.y + bounds.h - 14, {
        size: 12,
        color: zone.hovered ? '#d4a8ff' : PALETTE.dim,
        align: 'center',
        baseline: 'middle',
        bold: true,
      });

      if (zone.clicked) result.taken = i;
    });
  } else {
    offers.forEach((offer, i) => {
      const bounds = layout.slots[i]!.bounds;
      const zone = ui.hitZone(bounds);
      const rarity = RARITY[offer.card.rarity];

      ui.panel(bounds, {
        fill: zone.hovered ? 'rgba(34,24,42,0.97)' : 'rgba(18,14,22,0.95)',
        border: zone.hovered ? '#d4a8ff' : '#6b3fa0',
        radius: 8,
      });

      const colW = (bounds.w - 40) / 2;
      const leftX = bounds.x + 16;
      const rightX = bounds.x + bounds.w / 2 + 8;

      ui.heading(t('cursed.rewardLabel'), leftX, bounds.y + 20, colW, rarity.color);
      ui.fittedText(offer.card.name, leftX, bounds.y + 40, {
        size: 15,
        color: rarity.glow,
        baseline: 'middle',
        bold: true,
        maxWidth: colW,
      });
      ui.paragraph(offer.card.description, leftX, bounds.y + 58, colW, {
        size: 11.5,
        color: PALETTE.muted,
        lineHeight: 15,
      });

      ui.ctx.strokeStyle = 'rgba(148,138,118,0.25)';
      ui.ctx.lineWidth = 1;
      ui.ctx.beginPath();
      ui.ctx.moveTo(bounds.x + bounds.w / 2, bounds.y + 12);
      ui.ctx.lineTo(bounds.x + bounds.w / 2, bounds.y + bounds.h - 12);
      ui.ctx.stroke();

      ui.heading(t('cursed.priceLabel'), rightX, bounds.y + 20, colW, PALETTE.bad);
      ui.fittedText(curseName(offer.curse), rightX, bounds.y + 40, {
        size: 15,
        color: PALETTE.bad,
        baseline: 'middle',
        bold: true,
        maxWidth: colW,
      });
      ui.paragraph(curseDescription(offer.curse), rightX, bounds.y + 58, colW, {
        size: 11.5,
        color: PALETTE.muted,
        lineHeight: 15,
      });

      ui.text(`${i + 1}`, bounds.x + bounds.w - 14, bounds.y + bounds.h - 14, {
        size: 11,
        color: zone.hovered ? '#d4a8ff' : PALETTE.dim,
        align: 'right',
        baseline: 'middle',
        bold: true,
      });

      if (zone.clicked) result.taken = i;
    });
  }

  const slots = ['slot1', 'slot2', 'slot3'] as const;
  offers.forEach((_, i) => {
    const key = slots[i];
    if (key && input.wasPressed(key)) result.taken = i;
  });

  if (
    ui.button(rect(ui.width / 2 - 120, cardsBottom + 28, 240, 44), t('cursed.leave'), {
      accent: PALETTE.muted,
    }) ||
    input.consumePress('pause')
  ) {
    result.left = true;
  }

  return result;
}

/** Compact curse list for the build sheet. */
export function drawCurseList(
  ui: Ui,
  curses: readonly Curse[],
  x: number,
  y: number,
  width: number,
): number {
  let cursor = y;
  ui.heading(t('curse.list'), x, cursor, width, PALETTE.bad);
  cursor += 24;

  if (curses.length === 0) {
    ui.text(t('curse.none'), x, cursor, {
      size: 13,
      color: PALETTE.dim,
      italic: true,
      baseline: 'middle',
    });
    return cursor + 20;
  }

  for (const curse of curses) {
    ui.swatch(x + 5, cursor, PALETTE.bad, 4);
    ui.text(curseName(curse), x + 16, cursor, {
      size: 13,
      color: PALETTE.ink,
      baseline: 'middle',
    });
    cursor += 20;
  }
  return cursor;
}


