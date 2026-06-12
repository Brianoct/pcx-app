import { describe, expect, it } from 'vitest';
import { buildAccessForUser, canAccessPanel, normalizeRole } from './roleAccess';

describe('normalizeRole', () => {
  it('strips accents, case, and whitespace', () => {
    expect(normalizeRole('Almacén Líder')).toBe('almacen lider');
    expect(normalizeRole('  ADMIN ')).toBe('admin');
  });
});

describe('buildAccessForUser', () => {
  it('applies role defaults when no overrides are stored', () => {
    const access = buildAccessForUser('Ventas', null);
    expect(access.cotizar).toBe(true);
    expect(access.historial_individual).toBe(true);
    expect(access.historial_global).toBe(false);
    expect(access.admin).toBe(false);
  });

  it('merges stored overrides on top of role defaults', () => {
    const access = buildAccessForUser('Ventas', { cotizar: false, admin: true });
    expect(access.cotizar).toBe(false);
    expect(access.admin).toBe(true);
  });

  it('resolves legacy/camelCase key aliases to canonical keys', () => {
    const access = buildAccessForUser('Ventas', {
      historialGlobal: true,
      inventoryIndividual: true,
      marketingCombos: true
    });
    expect(access.historial_global).toBe(true);
    expect(access.inventario_individual).toBe(true);
    expect(access.marketing_combos).toBe(true);
  });

  it('ignores unknown keys and non-object payloads', () => {
    expect(buildAccessForUser('Ventas', { bogus: true }).bogus).toBeUndefined();
    expect(buildAccessForUser('Ventas', [1, 2]).cotizar).toBe(true);
  });
});

describe('canAccessPanel', () => {
  it('supports (access, key) and (role, key) signatures', () => {
    const access = buildAccessForUser('Admin', null);
    expect(canAccessPanel(access, 'admin')).toBe(true);
    expect(canAccessPanel('Ventas', 'cotizar')).toBe(true);
    expect(canAccessPanel('Ventas', 'admin')).toBe(false);
  });

  it('resolves alias keys at lookup time', () => {
    const access = buildAccessForUser('Ventas Lider', null);
    expect(canAccessPanel(access, 'historialGlobal')).toBe(true);
    expect(canAccessPanel(access, 'history_global')).toBe(true);
  });

  it('returns false for unknown keys', () => {
    expect(canAccessPanel(buildAccessForUser('Admin', null), 'nonexistent_panel')).toBe(false);
  });
});
