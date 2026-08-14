import type { Input } from '../core/input';
import { TAU } from '../core/math';
import { t } from '../i18n';
import { type Curse, curseDescription, curseName } from '../progression/curses';
import { RARITY, type SkillCard } from '../progression/skills';
import { type MapNode, type NodeKind, type RunMap } from '../world/runmap';
import { hexAlpha } from '../render/monster-render';
import { PALETTE, rect, type Ui } from './widgets';

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
 * adjacent lanes — so the whole route is readable without panning. Only the nodes
 * connected to where you stand are clickable; everything else is dimmed to make the
 * commitment obvious.
 */
export function drawRunMap(
  ui: Ui,
  input: Input,
  map: RunMap,
  context: {
    currentNodeId: number | null;
    reachable: readonly MapNode[];
    visited: ReadonlySet<number>;
    time: number;
  },
): number {
  ui.scrim(0.9);

  ui.text(t('map.title'), ui.width / 2, 54, {
    size: 30,
    color: PALETTE.ink,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 10,
  });
  ui.text(t('map.subtitle'), ui.width / 2, 88, {
    size: 14,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    italic: true,
  });

  const margin = 70;
  const top = 140;
  const bottom = ui.height - 170;
  const usableW = ui.width - margin * 2;
  const stepX = usableW / Math.max(1, map.depths - 1);
  const laneH = (bottom - top) / Math.max(1, map.lanes - 1);

  const position = (node: MapNode): { x: number; y: number } => ({
    x: margin + node.depth * stepX,
    y: top + node.lane * laneH,
  });

  const reachableIds = new Set(context.reachable.map((n) => n.id));
  const ctx = ui.ctx;

  // --- edges ----------------------------------------------------------------
  for (const node of map.nodes) {
    const from = position(node);
    for (const nextId of node.next) {
      const target = map.nodes[nextId]!;
      const to = position(target);

      // Highlight only the edges leading out of where the player stands.
      const live = node.id === context.currentNodeId && reachableIds.has(nextId);
      const walked = context.visited.has(node.id) && context.visited.has(nextId);

      ctx.strokeStyle = live
        ? 'rgba(216,161,58,0.9)'
        : walked
          ? 'rgba(216,161,58,0.4)'
          : 'rgba(150,142,124,0.32)';
      ctx.lineWidth = live ? 2.6 : 1.4;
      ctx.setLineDash(live ? [] : [5, 6]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      // A shallow S-curve reads as a road rather than a wiring diagram. Control
      // points sit close to each end so a lane change stays a short kink.
      const lean = (to.x - from.x) * 0.34;
      ctx.bezierCurveTo(from.x + lean, from.y, to.x - lean, to.y, to.x, to.y);
      ctx.stroke();
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
    const zone = isReachable ? ui.hitZone(hit) : { hovered: ui.isHovered(hit), clicked: false };
    if (zone.hovered) hoveredNode = node;
    if (zone.clicked) picked = node.id;

    // Reachable nodes breathe so the eye goes straight to the live choices.
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

    ctx.fillStyle = bright ? 'rgba(16,14,20,0.95)' : 'rgba(15,14,18,0.9)';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, TAU);
    ctx.fill();

    // Distant stops keep their own colour, just muted — the player should be able
    // to see that an elite waits three depths away.
    ctx.strokeStyle = bright ? style.color : hexAlpha(style.color, 0.5);
    ctx.lineWidth = isCurrent ? 3 : 2;
    ctx.stroke();

    drawNodeGlyph(ctx, node.kind, pos.x, pos.y, radius, bright ? style.glow : hexAlpha(style.glow, 0.55));

    // Visited nodes get a slash so the travelled route is obvious at a glance.
    if (isVisited && !isCurrent) {
      ctx.strokeStyle = 'rgba(216,161,58,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pos.x - radius * 0.5, pos.y + radius * 0.5);
      ctx.lineTo(pos.x + radius * 0.5, pos.y - radius * 0.5);
      ctx.stroke();
    }

    if (isCurrent) {
      ui.text(t('map.current'), pos.x, pos.y + radius + 14, {
        size: 10,
        color: PALETTE.gold,
        align: 'center',
        baseline: 'middle',
        letterSpacing: 1,
      });
    }
  });

  // Depth ruler along the bottom.
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
    });
  });

  return picked;
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

/** A distinct mark per stop type, so colour is never the only cue. */
function drawNodeGlyph(
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
  ctx.lineWidth = 2;
  const r = radius * 0.5;

  switch (kind) {
    case 'battle':
      // Crossed blades.
      ctx.beginPath();
      ctx.moveTo(-r, -r);
      ctx.lineTo(r, r);
      ctx.moveTo(r, -r);
      ctx.lineTo(-r, r);
      ctx.stroke();
      break;

    case 'elite': {
      // A crown: three peaks.
      ctx.beginPath();
      ctx.moveTo(-r, r * 0.6);
      ctx.lineTo(-r, -r * 0.2);
      ctx.lineTo(-r * 0.5, r * 0.2);
      ctx.lineTo(0, -r * 0.8);
      ctx.lineTo(r * 0.5, r * 0.2);
      ctx.lineTo(r, -r * 0.2);
      ctx.lineTo(r, r * 0.6);
      ctx.closePath();
      ctx.stroke();
      break;
    }

    case 'market':
      // Coin.
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.8, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.3, 0, TAU);
      ctx.fill();
      break;

    case 'cursed':
      // Inverted horns.
      ctx.beginPath();
      ctx.moveTo(-r, -r * 0.6);
      ctx.quadraticCurveTo(-r * 0.3, r * 0.8, 0, -r * 0.2);
      ctx.quadraticCurveTo(r * 0.3, r * 0.8, r, -r * 0.6);
      ctx.stroke();
      break;

    case 'boss':
      // A skull-ish mark: two sockets over a jaw line.
      ctx.beginPath();
      ctx.arc(-r * 0.4, -r * 0.25, r * 0.26, 0, TAU);
      ctx.arc(r * 0.4, -r * 0.25, r * 0.26, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, r * 0.5);
      ctx.lineTo(r * 0.5, r * 0.5);
      ctx.stroke();
      break;
  }

  ctx.restore();
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

  ui.text(t('market.title'), ui.width / 2, 66, {
    size: 28,
    color: '#9fd7ff',
    align: 'center',
    baseline: 'middle',
    letterSpacing: 8,
  });
  ui.text(t('market.subtitle'), ui.width / 2, 100, {
    size: 14,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    italic: true,
  });
  ui.text(t('market.souls', { n: Math.floor(souls) }), ui.width / 2, 128, {
    size: 15,
    color: '#cfeaff',
    align: 'center',
    baseline: 'middle',
    bold: true,
  });

  const cardW = Math.max(150, Math.min(250, (ui.width - 140) / Math.max(1, offers.length) - 22));
  const cardH = Math.max(190, Math.min(280, ui.height - 340));
  const gap = 22;
  const totalW = offers.length * cardW + (offers.length - 1) * gap;
  const startX = (ui.width - totalW) / 2;
  const y = ui.height / 2 - cardH / 2 + 30;

  offers.forEach((offer, i) => {
    const x = startX + i * (cardW + gap);
    const affordable = !offer.sold && souls >= offer.price;
    const bounds = rect(x, y, cardW, cardH);
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

  const slots = ['slot1', 'slot2', 'slot3'] as const;
  offers.forEach((offer, i) => {
    const key = slots[i];
    if (!key || offer.sold) return;
    if (input.wasPressed(key) && souls >= offer.price) result.bought = i;
  });

  if (
    ui.button(rect(ui.width / 2 - 100, y + cardH + 34, 200, 44), t('market.leave'), {
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

  ui.text(t('cursed.title'), ui.width / 2, 62, {
    size: 28,
    color: '#b06cff',
    align: 'center',
    baseline: 'middle',
    letterSpacing: 9,
  });
  ui.text(t('cursed.subtitle'), ui.width / 2, 96, {
    size: 14,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    italic: true,
  });

  const cardW = Math.max(200, Math.min(340, (ui.width - 160) / Math.max(1, offers.length) - 24));
  const cardH = Math.max(240, Math.min(360, ui.height - 300));
  const gap = 30;
  const totalW = offers.length * cardW + (offers.length - 1) * gap;
  const startX = (ui.width - totalW) / 2;
  const y = ui.height / 2 - cardH / 2 + 24;

  offers.forEach((offer, i) => {
    const x = startX + i * (cardW + gap);
    const bounds = rect(x, y, cardW, cardH);
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

  const slots = ['slot1', 'slot2', 'slot3'] as const;
  offers.forEach((_, i) => {
    const key = slots[i];
    if (key && input.wasPressed(key)) result.taken = i;
  });

  if (
    ui.button(rect(ui.width / 2 - 120, y + cardH + 28, 240, 44), t('cursed.leave'), {
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


