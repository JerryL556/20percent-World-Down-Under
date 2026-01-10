import { getWeaponById } from './Weapons.js';
import { weaponMods, weaponCores, armourMods } from './Mods.js';

// Ensure weapon mod selections are valid per rules:
// - No duplicate mod IDs on the same weapon
// - Only one magazine-type mod (ids starting with 'w_mag_') per weapon
function sanitizeWeaponMods(modIds = []) {
  const seen = new Set();
  let magTaken = false;
  return (modIds || []).map((id) => {
    if (!id) return null;
    if (seen.has(id)) return null;
    const isMag = String(id).startsWith('w_mag_');
    if (isMag) {
      if (magTaken) return null;
      magTaken = true;
    }
    seen.add(id);
    return id;
  });
}

function applyList(base, list, ids = []) {
  let w = { ...base };
  ids.forEach((id) => {
    const mod = list.find((m) => m.id === id) || list[0];
    w = mod.apply(w);
  });
  return w;
}

export function getEffectiveWeapon(gs, weaponId) {
  const base = getWeaponById(weaponId);
  const build = (gs.weaponBuilds && gs.weaponBuilds[weaponId]) || { mods: [null, null, null], core: null };
  let safeMods = sanitizeWeaponMods(build.mods || []);
  let coreId = build.core || null;
  if (base?.isFlamethrower) {
    const allowed = new Set([null, 'w_dmg_up', 'w_mag_improved', 'w_mag_extended']);
    safeMods = safeMods.map((id) => (allowed.has(id) ? id : null));
    if (coreId !== 'core_flame_compression') coreId = null;
  }
  const withMods = applyList(base, weaponMods, safeMods);
  const withCore = applyList(withMods, weaponCores, [coreId]);
  return withCore;
}

export function getPlayerEffects(gs) {
  const eff0 = { bonusHp: 0, moveSpeedMult: 1, dashRegenMs: gs?.dashRegenMs || 6000 };
  const mods = (gs?.armour?.mods) || [];
  let eff = { ...eff0 };
  mods.forEach((id) => {
    const m = armourMods.find((x) => x.id === id);
    if (m && typeof m.applyEffect === 'function') {
      eff = m.applyEffect(eff);
    }
  });
  // Apply base armour-type effects
  try {
    const armourId = gs?.armour?.id || null;
    if (armourId === 'proto_thrusters') {
      // Prototype Thrusters: +30% move speed, reduce dash recharge time (~30%)
      eff.moveSpeedMult = (eff.moveSpeedMult || 1) * 1.3;
      const baseDash = gs?.dashRegenMs || 6000;
      eff.dashRegenMs = Math.min(eff.dashRegenMs || baseDash, Math.floor(baseDash * 0.7));
      // HP and Shield baselines are handled on equip (UIScene); effects layer stays additive
    }
  } catch (_) {}
  return eff;
}
