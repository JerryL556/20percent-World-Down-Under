// Minimal helper for showing weapon sprites for the player

// Map in-repo weapon ids -> texture keys and asset paths
export const WEAPON_TEXTURES = {
  // height = desired on-screen pixel height (auto-scaled)
  // mult = per-weapon multiplier applied on top of global WEAPON_SCALE_MULT
  pistol: { key: 'weapon_pistol', path: 'assets/PS.png', height: 8, mult: 0.8 }, // slightly smaller
  rifle: { key: 'weapon_rifle', path: 'assets/AR.png', height: 8, mult: 1.45 }, // slightly larger
  battle_rifle: { key: 'weapon_battle_rifle', path: 'assets/BR.png', height: 8, mult: 1.45 },
  shotgun: { key: 'weapon_shotgun', path: 'assets/SG.png', height: 8, mult: 1.1 }, // slightly larger
  smg: { key: 'weapon_smg', path: 'assets/SMG.png', height: 8, mult: 1.2 }, // slightly larger
  railgun: { key: 'weapon_railgun', path: 'assets/RG.png', height: 8, mult: 1.3 }, // increased
  // Laser now uses dedicated art (slightly larger)
  laser: { key: 'weapon_laser', path: 'assets/Laser.png', height: 8, mult: 1.05 },
  rocket: { key: 'weapon_rocket', path: 'assets/RKT.png', height: 9, mult: 1.7 }, // slightly larger
  mgl: { key: 'weapon_mgl', path: 'assets/MGL.png', height: 9, mult: 1.35 }, // dedicated MGL art
  guided_missiles: { key: 'weapon_guided_missiles', path: 'assets/MicroMissile.png', height: 9, mult: 1.25 }, // slightly smaller guided missiles
  smart_hmg: { key: 'weapon_smart_hmg', path: 'assets/HMG.png', height: 9, mult: 1.35 }, // slightly smaller HMG
  minigun: { key: 'weapon_minigun', path: 'assets/Minigun.png', height: 9, mult: 1.6 },
};

// Global multiplier to tweak all weapon sprite sizes uniformly
// Global multiplier to tweak all weapon sprite sizes uniformly
// Scaled down to 75% of previous size (from 3 -> 2.25)
export const WEAPON_SCALE_MULT = 2.25;

// Optionally present in assets but not used as a weapon sprite here
const OPTIONAL_ASSETS = [
  { key: 'ability_ads', path: 'assets/ADS.png' },
  { key: 'ability_bit', path: 'assets/BIT.png' },
  { key: 'ability_landmine', path: 'assets/Landmines.png' },
];

// Optional per-weapon fine-tuning for muzzle alignment (in on-screen pixels)
// forward: extra distance along barrel; side: perpendicular offset (- up, + down in screen coords)
const MUZZLE_OFFSETS = {
  pistol: { forward: 0, side: -2 },
};

export function preloadWeaponAssets(scene) {
  try {
    Object.values(WEAPON_TEXTURES).forEach(({ key, path }) => {
      if (!scene.textures.exists(key)) scene.load.image(key, path);
    });
    OPTIONAL_ASSETS.forEach(({ key, path }) => {
      if (!scene.textures.exists(key)) scene.load.image(key, path);
    });
  } catch (_) { /* ignore */ }
}

export function textureKeyForWeaponId(weaponId) {
  const entry = WEAPON_TEXTURES[weaponId];
  return entry ? entry.key : null;
}

function desiredHeightForWeaponId(weaponId, fallback = 8) {
  const entry = WEAPON_TEXTURES[weaponId];
  return entry && typeof entry.height === 'number' ? entry.height : fallback;
}

function perWeaponMult(weaponId) {
  const entry = WEAPON_TEXTURES[weaponId];
  return entry && typeof entry.mult === 'number' ? entry.mult : 1;
}

function applyWeaponScale(scene, sprite, weaponId) {
  try {
    const key = sprite?.texture?.key;
    if (!key || !scene?.textures?.exists(key)) return;
    const desiredH = desiredHeightForWeaponId(weaponId);
    const tex = scene.textures.get(key);
    const src = tex.getSourceImage();
    const h = (src && (src.naturalHeight || src.height)) || tex.frames['__BASE']?.height || sprite.height;
    if (h && h > 0) {
      const scale = (desiredH / h) * WEAPON_SCALE_MULT * perWeaponMult(weaponId);
      sprite.setScale(scale);
    }
  } catch (_) { /* ignore */ }
}

export function createPlayerWeaponSprite(scene) {
  const gs = scene.registry.get('gameState') || {};
  const desired = textureKeyForWeaponId(gs.activeWeapon) || textureKeyForWeaponId('pistol');
  const hasDesired = desired && scene.textures && scene.textures.exists(desired);
  const s = scene.add.image(scene.player.x, scene.player.y, hasDesired ? desired : 'player_square');
  // Set origin near the grip so rotation looks natural
  s.setOrigin(0.15, 0.5);
  // Place clearly above beam/effects layers so beams render under weapon
  try { s.setDepth(9001); } catch (_) { s.setDepth(9001); }
  // Auto scale to a small on-screen height so it fits the 12x12 player
  applyWeaponScale(scene, s, gs.activeWeapon);
  scene.weaponSprite = s;
  return s;
}

export function syncWeaponTexture(scene, weaponId) {
  if (!scene.weaponSprite) return;
  const key = textureKeyForWeaponId(weaponId);
  if (key && scene.textures && scene.textures.exists(key) && scene.weaponSprite.texture && scene.weaponSprite.texture.key !== key) {
    try {
      scene.weaponSprite.setTexture(key);
      applyWeaponScale(scene, scene.weaponSprite, weaponId);
    } catch (_) {}
  }
}

export function updateWeaponSprite(scene) {
  if (!scene.weaponSprite || !scene.player) return;
  const ptr = scene.input?.activePointer;
  const px = scene.player.x, py = scene.player.y;
  let angle = scene.playerFacing || 0;
  try {
    if (ptr) angle = Phaser.Math.Angle.Between(px, py, ptr.worldX, ptr.worldY);
  } catch (_) {}
  scene.playerFacing = angle;

  // Reload lowering animation: lower the weapon while reloading and raise it back up after
  const isReloading = !!scene.registry?.get?.('reloadActive');
  if (scene._weaponReloadLowerT === undefined) scene._weaponReloadLowerT = 0;
  const targetT = isReloading ? 1 : 0;
  // Smoothly ease toward target (simple critically-damped-ish approach)
  scene._weaponReloadLowerT += (targetT - scene._weaponReloadLowerT) * 0.15;
  const t = scene._weaponReloadLowerT;

  // Offset in front of the player, slightly shorten while lowered
  const baseDist = 10;
  const dist = baseDist * (1 - 0.25 * t);
  let x = px + Math.cos(angle) * dist;
  // Lower vertically on-screen as t increases
  const lowerPx = 8; // max drop in pixels
  let y = py + Math.sin(angle) * dist + lowerPx * t;

  // Recoil kick: apply a brief backward offset that decays quickly
  if (scene._weaponRecoil === undefined) scene._weaponRecoil = 0;
  // Only apply recoil for non-laser weapons
  try {
    const gs = scene.registry?.get?.('gameState');
    const wid = gs?.activeWeapon;
    const isLaser = (wid === 'laser');
    if (!isLaser && scene._weaponRecoil > 0) {
      x -= Math.cos(angle) * scene._weaponRecoil;
      y -= Math.sin(angle) * scene._weaponRecoil;
      // Exponential decay toward 0
      scene._weaponRecoil *= 0.78;
      if (scene._weaponRecoil < 0.05) scene._weaponRecoil = 0;
    }
  } catch (_) {}

  scene.weaponSprite.setPosition(x, y);
  scene.weaponSprite.setRotation(angle);

  // Optional flipping if needed for your art; generally not required for top-down
  // Flip vertically when pointing left to keep sprite upright if drawn horizontally
  const deg = Phaser.Math.RadToDeg(angle);
  const pointingLeft = (deg > 90 || deg < -90);
  try { scene.weaponSprite.setFlipY(pointingLeft); } catch (_) {}
}

// Compute an approximate world-space muzzle position at the end of the barrel
// Uses the weapon sprite position, origin, displayWidth, and current facing.
// padding reduces overshoot so the spawn is slightly inside the sprite edge.
export function getWeaponMuzzleWorld(scene, padding = 2) {
  try {
    const s = scene?.weaponSprite;
    const p = scene?.player;
    if (!s || !p) return { x: p?.x ?? 0, y: p?.y ?? 0 };
    const angle = scene.playerFacing ?? s.rotation ?? 0;
    const originX = (typeof s.originX === 'number') ? s.originX : 0.5;
    const dw = (typeof s.displayWidth === 'number' && s.displayWidth > 0)
      ? s.displayWidth
      : (s.width || 0) * (s.scaleX || 1);
    const forward = Math.max(0, (1 - originX) * dw - Math.max(0, padding));
    let x = s.x + Math.cos(angle) * forward;
    let y = s.y + Math.sin(angle) * forward;
    // Apply per-weapon fine-tuning
    try {
      const wid = scene?.gs?.activeWeapon ?? scene?.registry?.get?.('gameState')?.activeWeapon ?? scene?._lastActiveWeapon;
      const off = MUZZLE_OFFSETS[wid];
      if (off) {
        if (off.forward) { x += Math.cos(angle) * off.forward; y += Math.sin(angle) * off.forward; }
        if (off.side) { const nx = -Math.sin(angle); const ny = Math.cos(angle); x += nx * off.side; y += ny * off.side; }
      }
    } catch (_) {}
    return { x, y };
  } catch (_) {
    const p = scene?.player; return { x: p?.x ?? 0, y: p?.y ?? 0 };
  }
}

// Point along the barrel from grip toward muzzle.
// t in [0,1]: 0 = at grip origin, 1 = at muzzle (same as getWeaponMuzzleWorld without padding)
export function getWeaponBarrelPoint(scene, t = 0.5, padding = 2) {
  try {
    const s = scene?.weaponSprite; const p = scene?.player; if (!s || !p) return { x: p?.x ?? 0, y: p?.y ?? 0 };
    const angle = scene.playerFacing ?? s.rotation ?? 0;
    const originX = (typeof s.originX === 'number') ? s.originX : 0.5;
    const dw = (typeof s.displayWidth === 'number' && s.displayWidth > 0) ? s.displayWidth : (s.width || 0) * (s.scaleX || 1);
    const forward = Math.max(0, (1 - originX) * dw - Math.max(0, padding));
    const dist = Math.max(0, Math.min(1, t)) * forward;
    const x = s.x + Math.cos(angle) * dist;
    const y = s.y + Math.sin(angle) * dist;
    return { x, y };
  } catch (_) { const p = scene?.player; return { x: p?.x ?? 0, y: p?.y ?? 0 }; }
}

// Generic helpers for sizing arbitrary images by desired pixel height
export function fitImageHeight(scene, sprite, desiredPx = 12) {
  try {
    const key = sprite?.texture?.key;
    if (!key || !scene?.textures?.exists(key)) return sprite;
    const tex = scene.textures.get(key);
    const src = tex.getSourceImage();
    const h = (src && (src.naturalHeight || src.height)) || tex.frames['__BASE']?.height || sprite.height;
    if (h && h > 0) {
      const scale = desiredPx / h;
      sprite.setScale(scale);
    }
  } catch (_) { /* ignore */ }
  return sprite;
}

export function createFittedImage(scene, x, y, key, desiredPx = 12) {
  const img = scene.add.image(x, y, key);
  fitImageHeight(scene, img, desiredPx);
  return img;
}
