import type { Input } from '../core/input';
import { clamp } from '../core/math';
import { t } from '../i18n';
import { getBoon } from '../progression/boons';
import { getMutation } from '../progression/evolution';
import { type MetaProgress } from '../progression/meta';
import { getCard, RARITY } from '../progression/skills';
import { getSpecies, SPECIES, speciesBody, type Species } from '../progression/species';
import { BASE_STATS, type StatKey } from '../progression/stats';
import { drawBodyPortrait } from '../render/monster-render';
import { type UnlockCategory } from '../progression/gate';
import { remainingCost, type UnlockDef, unlockKey, unlocksInCategory } from '../progression/unlocks';
import { formatNumber, PALETTE, rect, type Ui } from './widgets';

export type LairAction = 'none' | 'back';

const CATEGORIES: readonly UnlockCategory[] = ['species', 'card', 'mutation', 'boon'];

const CATEGORY_ACCENT: Record<UnlockCategory, string> = {
  species: '#ff9d7a',
  card: '#9fd7ff',
  mutation: '#c9a0ff',
  boon: '#ffd27a',
};

/**
 * The stats worth putting on a body card.
 *
 * Four numbers, not forty: enough to tell the bodies apart at a glance, few enough
 * that the card stays a picture of a creature rather than a spreadsheet.
 */
const SPECIES_STATS: readonly StatKey[] = ['maxHp', 'damage', 'attackSpeed', 'moveSpeed'];

/** Name and description for an unlock, resolved from whichever table owns it. */
function describe(unlock: UnlockDef): { name: string; description: string; accent: string } {
  switch (unlock.category) {
    case 'card': {
      const card = getCard(unlock.refId);
      return {
        name: card?.name ?? unlock.refId,
        description: card?.description ?? '',
        accent: card ? RARITY[card.rarity].color : CATEGORY_ACCENT.card,
      };
    }
    case 'mutation': {
      const mutation = getMutation(unlock.refId);
      return {
        name: mutation?.name ?? unlock.refId,
        description: mutation?.description ?? '',
        accent: CATEGORY_ACCENT.mutation,
      };
    }
    case 'boon': {
      const boon = getBoon(unlock.refId);
      return {
        name: boon?.name ?? unlock.refId,
        description: boon?.description ?? '',
        accent: boon?.color ?? CATEGORY_ACCENT.boon,
      };
    }
    case 'species': {
      const species = getSpecies(unlock.refId);
      return {
        name: species?.name ?? unlock.refId,
        description: species?.description ?? '',
        accent: species?.body.glowColor ?? CATEGORY_ACCENT.species,
      };
    }
  }
}

/**
 * The lair: where souls turn into content.
 *
 * Souls buy *variety*, not numbers — a new legendary or a new elemental core changes
 * what a run can become, whereas "+6% damage" changes nothing a player looks forward
 * to. Everything bought here starts appearing in future runs' draws.
 *
 * Locked entries still show their name and what they do: knowing what is out there is
 * most of the pull.
 */
export function drawLair(
  ui: Ui,
  input: Input,
  meta: MetaProgress,
  state: { category: UnlockCategory; scroll: number },
  time: number,
): LairAction {
  ui.scrim(0.94);

  ui.text(t('lair.title'), ui.width / 2, 50, {
    size: 30,
    color: PALETTE.gold,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 10,
  });
  ui.text(t('lair.subtitle'), ui.width / 2, 82, {
    size: 14,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    italic: true,
  });

  // --- souls and overall progress -------------------------------------------
  ui.text(t('unit.souls', { n: Math.floor(meta.souls) }), ui.width / 2 - 150, 112, {
    size: 17,
    color: '#cfeaff',
    align: 'right',
    baseline: 'middle',
    bold: true,
  });
  ui.text(
    t('lair.progress', { owned: meta.unlockedCount, total: meta.unlockableCount }),
    ui.width / 2 + 150,
    112,
    { size: 14, color: PALETTE.muted, align: 'left', baseline: 'middle' },
  );

  // --- category tabs --------------------------------------------------------
  // Four tabs do not fit a narrow window at a fixed width; shrink rather than clip.
  const tabW = Math.min(170, (ui.width - 40 - (CATEGORIES.length - 1) * 10) / CATEGORIES.length);
  const tabsW = CATEGORIES.length * tabW + (CATEGORIES.length - 1) * 10;
  let tabX = (ui.width - tabsW) / 2;

  for (const category of CATEGORIES) {
    // Bodies count the free starters too: '2 / 4' is the honest answer to how many
    // you can play, whereas the purchasable-only count would read '0 / 2'.
    const all = category === 'species' ? SPECIES : unlocksInCategory(category);
    const owned =
      category === 'species'
        ? SPECIES.filter((sp) => meta.canUseSpecies(sp.id)).length
        : unlocksInCategory(category).filter((u) => meta.isUnlocked(u.id)).length;
    const total = all.length;
    const active = state.category === category;

    if (
      ui.button(rect(tabX, 138, tabW, 40), t(`lair.tab.${category}`), {
        accent: CATEGORY_ACCENT[category],
        active,
        size: 14,
        sub: `${owned} / ${total}`,
      })
    ) {
      state.category = category;
      state.scroll = 0;
    }
    tabX += tabW + 10;
  }

  // --- item grid ------------------------------------------------------------
  const bodies = state.category === 'species';
  const items = bodies ? [] : unlocksInCategory(state.category);
  const columns = bodies && ui.width < 700 ? 1 : 2;
  const cellW = Math.max(220, Math.min(430, (ui.width - 160) / columns - 16));
  const cellH = bodies ? 140 : 82;
  const gap = 14;
  const gridW = columns * cellW + (columns - 1) * gap;
  const gridX = (ui.width - gridW) / 2;
  const gridTop = 196;
  const gridBottom = ui.height - 84;
  const visibleRows = Math.max(1, Math.floor((gridBottom - gridTop) / (cellH + gap)));
  const totalRows = Math.ceil((bodies ? SPECIES.length : items.length) / columns);
  const maxScroll = Math.max(0, totalRows - visibleRows);

  // Wheel scrolls the grid; the list is longer than any sensible window.
  if (input.wheel !== 0) state.scroll += input.wheel > 0 ? 1 : -1;
  state.scroll = clamp(state.scroll, 0, maxScroll);

  if (bodies) {
    for (let i = 0; i < SPECIES.length; i++) {
      const slot = i - state.scroll * columns;
      if (slot < 0 || slot >= visibleRows * columns) continue;
      const x = gridX + (slot % columns) * (cellW + gap);
      const y = gridTop + Math.floor(slot / columns) * (cellH + gap);
      drawSpeciesCell(ui, meta, SPECIES[i]!, rect(x, y, cellW, cellH), time);
    }
  }

  const firstIndex = state.scroll * columns;
  const lastIndex = Math.min(items.length, firstIndex + visibleRows * columns);

  for (let i = firstIndex; i < lastIndex; i++) {
    const unlock = items[i]!;
    const slot = i - firstIndex;
    const x = gridX + (slot % columns) * (cellW + gap);
    const y = gridTop + Math.floor(slot / columns) * (cellH + gap);

    drawUnlockCell(ui, meta, unlock, rect(x, y, cellW, cellH));
  }

  // Scroll affordance.
  if (maxScroll > 0) {
    const trackH = gridBottom - gridTop;
    const thumbH = Math.max(24, (trackH * visibleRows) / totalRows);
    const thumbY = gridTop + (trackH - thumbH) * (maxScroll > 0 ? state.scroll / maxScroll : 0);
    ui.ctx.fillStyle = 'rgba(148,138,118,0.18)';
    ui.ctx.fillRect(gridX + gridW + 12, gridTop, 4, trackH);
    ui.ctx.fillStyle = 'rgba(216,161,58,0.6)';
    ui.ctx.fillRect(gridX + gridW + 12, thumbY, 4, thumbH);
  }

  // --- footer ---------------------------------------------------------------
  const remaining = remainingCost(meta.unlocked);
  if (remaining > 0) {
    ui.text(t('lair.remaining', { n: formatNumber(remaining) }), ui.width / 2, ui.height - 60, {
      size: 12,
      color: PALETTE.dim,
      align: 'center',
      baseline: 'middle',
    });
  } else {
    ui.text(t('lair.complete'), ui.width / 2, ui.height - 60, {
      size: 13,
      color: PALETTE.gold,
      align: 'center',
      baseline: 'middle',
      letterSpacing: 2,
    });
  }

  let action: LairAction = 'none';
  if (
    ui.button(rect(ui.width / 2 - 90, ui.height - 44, 180, 34), t('common.back'), {
      accent: PALETTE.muted,
      size: 13,
    }) ||
    input.consumePress('pause')
  ) {
    action = 'back';
  }

  return action;
}

/**
 * One body: a live portrait, what it plays like, and its four defining numbers.
 *
 * Buying and choosing live on the same card on purpose. A body you own but have not
 * equipped is doing nothing for you, and sending the player to a second screen to
 * finish the thought is the kind of friction that makes a feature go unused.
 */
function drawSpeciesCell(
  ui: Ui,
  meta: MetaProgress,
  species: Species,
  bounds: ReturnType<typeof rect>,
  time: number,
): void {
  const owned = meta.canUseSpecies(species.id);
  const active = meta.speciesId === species.id && owned;
  const unlock = species.price > 0 ? unlockKeyOf(species) : null;
  const affordable = !owned && meta.souls >= species.price;
  const accent = species.body.glowColor ?? CATEGORY_ACCENT.species;
  const zone = ui.hitZone(bounds);
  const actionable = active ? false : owned || affordable;

  ui.panel(bounds, {
    fill: active
      ? 'rgba(26,22,18,0.96)'
      : zone.hovered && actionable
        ? 'rgba(30,28,34,0.97)'
        : 'rgba(14,13,17,0.92)',
    border: active
      ? accent
      : owned
        ? 'rgba(127,224,138,0.4)'
        : affordable
          ? zone.hovered
            ? accent
            : 'rgba(148,138,118,0.4)'
          : 'rgba(110,104,92,0.3)',
    radius: 6,
    shadow: false,
  });

  const dim = !owned && !affordable;
  const portraitX = bounds.x + 56;
  const portraitY = bounds.y + bounds.h / 2 - 6;

  // Locked bodies are still drawn in full. Seeing the creature is the whole reason
  // to want it; a silhouette would sell nothing.
  ui.ctx.save();
  // Limbs and tails reach well past the core; clip so a stray tendril cannot trail
  // out of the card and across the one below it.
  ui.ctx.beginPath();
  ui.ctx.rect(bounds.x + 4, bounds.y + 4, bounds.w - 8, bounds.h - 8);
  ui.ctx.clip();
  if (dim) ui.ctx.globalAlpha = 0.45;
  drawBodyPortrait(ui.ctx, speciesBody(species), portraitX, portraitY, 62, time);
  ui.ctx.restore();

  const textX = bounds.x + 108;
  const textW = bounds.w - 122;

  ui.text(species.name, textX, bounds.y + 24, {
    size: 16,
    color: dim ? PALETTE.dim : accent,
    baseline: 'middle',
    bold: true,
  });
  ui.text(species.tagline, textX, bounds.y + 44, {
    size: 11,
    color: dim ? 'rgba(95,90,81,0.8)' : PALETTE.muted,
    baseline: 'middle',
    italic: true,
  });
  ui.paragraph(species.description, textX, bounds.y + 64, textW, {
    size: 11.5,
    color: dim ? 'rgba(95,90,81,0.8)' : PALETTE.muted,
    lineHeight: 15,
  });

  // --- the four numbers, coloured against the starting body -------------------
  let chipX = textX;
  for (const key of SPECIES_STATS) {
    const value = species.stats[key] ?? BASE_STATS[key];
    const delta = value - BASE_STATS[key];
    const color = dim
      ? PALETTE.dim
      : delta > 0
        ? PALETTE.good
        : delta < 0
          ? PALETTE.bad
          : PALETTE.muted;
    const shown = key === 'attackSpeed' ? value.toFixed(2) : Math.round(value).toString();

    ui.text(t(`stat.${key}`), chipX, bounds.y + bounds.h - 34, {
      size: 9,
      color: PALETTE.dim,
      baseline: 'middle',
    });
    ui.text(shown, chipX, bounds.y + bounds.h - 20, {
      size: 13,
      color,
      baseline: 'middle',
      bold: true,
    });
    chipX += Math.max(56, (textW - 74) / SPECIES_STATS.length);
  }

  // --- state badge ------------------------------------------------------------
  const badgeX = bounds.x + bounds.w - 14;
  if (active) {
    ui.text(t('species.active'), badgeX, bounds.y + 24, {
      size: 11,
      color: PALETTE.gold,
      align: 'right',
      baseline: 'middle',
      letterSpacing: 1,
    });
  } else if (owned) {
    ui.text(t('species.choose'), badgeX, bounds.y + 24, {
      size: 11,
      color: zone.hovered ? PALETTE.good : PALETTE.muted,
      align: 'right',
      baseline: 'middle',
      letterSpacing: 1,
    });
  } else {
    ui.text(`${species.price}`, badgeX, bounds.y + 24, {
      size: 18,
      color: affordable ? '#cfeaff' : PALETTE.bad,
      align: 'right',
      baseline: 'middle',
      bold: true,
    });
    ui.text(t('hud.soulsLabel'), badgeX, bounds.y + 42, {
      size: 9,
      color: PALETTE.dim,
      align: 'right',
      baseline: 'middle',
    });
  }

  if (!zone.clicked) return;
  // Buying equips straight away: nobody buys a body to leave it on the shelf.
  if (owned) meta.chooseSpecies(species.id);
  else if (unlock && meta.buy(unlock)) meta.chooseSpecies(species.id);
}

function unlockKeyOf(species: Species): string {
  return unlockKey('species', species.id);
}

/** One purchasable row: name, effect, price, and a click to buy. */
function drawUnlockCell(
  ui: Ui,
  meta: MetaProgress,
  unlock: UnlockDef,
  bounds: ReturnType<typeof rect>,
): void {
  const owned = meta.isUnlocked(unlock.id);
  const affordable = !owned && meta.souls >= unlock.price;
  const info = describe(unlock);
  const zone = owned ? { hovered: false, clicked: false } : ui.hitZone(bounds);

  ui.panel(bounds, {
    fill: owned
      ? 'rgba(18,22,18,0.85)'
      : zone.hovered && affordable
        ? 'rgba(30,28,34,0.97)'
        : 'rgba(14,13,17,0.92)',
    border: owned
      ? 'rgba(127,224,138,0.45)'
      : affordable
        ? zone.hovered
          ? info.accent
          : 'rgba(148,138,118,0.4)'
        : 'rgba(110,104,92,0.3)',
    radius: 6,
    shadow: false,
  });

  const dim = !owned && !affordable;

  ui.text(info.name, bounds.x + 14, bounds.y + 22, {
    size: 15,
    color: dim ? PALETTE.dim : info.accent,
    baseline: 'middle',
    bold: true,
  });

  ui.paragraph(info.description, bounds.x + 14, bounds.y + 44, bounds.w - 110, {
    size: 12,
    color: dim ? 'rgba(95,90,81,0.8)' : PALETTE.muted,
    lineHeight: 16,
  });

  // Price, or a tick once owned.
  if (owned) {
    ui.text(t('lair.owned'), bounds.x + bounds.w - 14, bounds.y + 22, {
      size: 12,
      color: PALETTE.good,
      align: 'right',
      baseline: 'middle',
      letterSpacing: 1,
    });
  } else {
    ui.text(`${unlock.price}`, bounds.x + bounds.w - 14, bounds.y + 24, {
      size: 19,
      color: affordable ? '#cfeaff' : PALETTE.bad,
      align: 'right',
      baseline: 'middle',
      bold: true,
    });
    ui.text(t('hud.soulsLabel'), bounds.x + bounds.w - 14, bounds.y + 44, {
      size: 10,
      color: PALETTE.dim,
      align: 'right',
      baseline: 'middle',
    });
  }

  if (zone.clicked && affordable) meta.buy(unlock.id);
}
