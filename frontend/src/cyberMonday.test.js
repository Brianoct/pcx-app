import { describe, expect, it } from 'vitest';
import { applyPercent, cyberPhase, getCampaign } from './cyberMonday';

const at = (iso) => Date.parse(iso);

describe('cyberPhase', () => {
  it('empieza el lunes 30 a medianoche de Bolivia', () => {
    expect(cyberPhase(at('2026-11-30T03:59:59Z'), '')).toBe('before');
    expect(cyberPhase(at('2026-11-30T04:00:00Z'), '')).toBe('live');
  });
  it('vale todo el miércoles 2 y termina a medianoche', () => {
    expect(cyberPhase(at('2026-12-03T03:59:59Z'), '')).toBe('live');
    expect(cyberPhase(at('2026-12-03T04:00:00Z'), '')).toBe('after');
  });
  it('se puede forzar para revisar la página', () => {
    expect(cyberPhase(at('2026-11-25T12:00:00Z'), 'live')).toBe('live');
    expect(getCampaign(at('2026-11-25T12:00:00Z'), '').live).toBe(false);
  });
});

describe('franja de anuncio', () => {
  it('no aparece antes del domingo 29 y sí desde ese día', () => {
    expect(getCampaign(at('2026-11-26T15:00:00Z'), '').teaser).toBe(false);
    expect(getCampaign(at('2026-11-29T03:59:59Z'), '').teaser).toBe(false);
    expect(getCampaign(at('2026-11-29T04:00:00Z'), '').teaser).toBe(true);
    expect(getCampaign(at('2026-11-30T04:00:00Z'), '').teaser).toBe(false);
    expect(getCampaign(at('2026-11-26T15:00:00Z'), 'before').teaser).toBe(true);
  });
});

describe('applyPercent', () => {
  it('descuenta y redondea a centavos', () => {
    expect(applyPercent(330, 20)).toBe(264);
    expect(applyPercent(84, 15)).toBe(71.4);
    expect(applyPercent(105, 20)).toBe(84);
  });
});
