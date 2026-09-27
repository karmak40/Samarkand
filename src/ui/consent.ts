import { t } from '../i18n';
import { PALETTE, rect, type Ui } from './widgets';

export type ConsentAction = 'none' | 'allow' | 'deny';

/**
 * The one-time question about anonymous statistics, over the title screen.
 *
 * Asked rather than assumed: under the GDPR an analytics id is personal data, and
 * the consent that covers it has to be an actual choice made before anything is
 * sent — a default-on switch buried in settings is not one. So nothing is sent until
 * this is answered, and the two answers are drawn as equals: same size, same
 * weight, neither pre-selected. Making "no" the harder button to find would be
 * exactly the kind of consent regulators throw out.
 *
 * Shown to everyone, not only in the EU: guessing the region would need the IP
 * address this is trying not to send yet, and one honest question is cheaper than a
 * second code path.
 */
export function drawConsent(ui: Ui): ConsentAction {
  ui.scrim(0.86);

  const w = Math.min(460, ui.width - 32);
  const x = (ui.width - w) / 2;
  const pad = 22;
  const textW = w - pad * 2;

  // Measured before drawing so the panel fits the text in every language: the
  // German body runs a third longer than the English one.
  const bodyH = measureParagraph(ui, t('consent.body'), textW, 14);
  const noteH = measureParagraph(ui, t('consent.note'), textW, 11);
  const h = pad + 34 + bodyH + 14 + noteH + 20 + 44 + pad;
  const y = Math.max(12, (ui.height - h) / 2);

  ui.panel(rect(x, y, w, h), { fill: 'rgba(16,15,19,0.97)', border: 'rgba(216,161,58,0.45)', radius: 10 });

  let cursor = y + pad;
  ui.fittedText(t('consent.title'), ui.width / 2, cursor + 12, {
    size: 20,
    color: PALETTE.gold,
    align: 'center',
    baseline: 'middle',
    maxWidth: textW,
  });
  cursor += 34;
  cursor += ui.paragraph(t('consent.body'), x + pad, cursor, textW, {
    size: 14,
    color: PALETTE.ink,
    baseline: 'top',
  });
  cursor += 14;
  cursor += ui.paragraph(t('consent.note'), x + pad, cursor, textW, {
    size: 11,
    color: PALETTE.dim,
    baseline: 'top',
  });
  cursor += 20;

  const gap = 12;
  const buttonW = (textW - gap) / 2;
  let action: ConsentAction = 'none';
  if (ui.button(rect(x + pad, cursor, buttonW, 44), t('consent.allow'), { accent: PALETTE.ink, size: 14 })) {
    action = 'allow';
  }
  if (ui.button(rect(x + pad + buttonW + gap, cursor, buttonW, 44), t('consent.deny'), { accent: PALETTE.ink, size: 14 })) {
    action = 'deny';
  }
  return action;
}

/**
 * Height `ui.paragraph` would take. It is laid out far off the canvas, which is
 * cheaper than duplicating its word-wrap here and keeps the two from drifting apart.
 */
function measureParagraph(ui: Ui, value: string, maxWidth: number, size: number): number {
  return ui.paragraph(value, -100_000, -100_000, maxWidth, { size });
}
