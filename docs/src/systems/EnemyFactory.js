// Global visual scale for enemy textures (keeps physics bodies unchanged)
const ENEMY_SPRITE_VISUAL_MULT = 2.0; // 200% of body height visually

// Known enemy texture paths for lazy loading if scene enters directly (skips BootScene)
const ENEMY_TEXTURE_PATHS = {
  enemy_shredder: 'assets/Shredder.png',
  enemy_charger: 'assets/Charger.png',
  enemy_gunner: 'assets/Gunner.png',
  enemy_machine_gunner: 'assets/MachineGunner.png',
  enemy_rocketeer: 'assets/Rocketeer.png',
  enemy_sniper: 'assets/Sniper.png',
  enemy_prism: 'assets/Prism.png',
  enemy_commander: 'assets/Commander.png',
  enemy_rook: 'assets/Rook.png',
  enemy_bombardier: 'assets/Bombardier.png',
  enemy_bombardier_special: 'assets/BombardierSpecial.png',
  enemy_heal_drone: 'assets/HealDrone.png',
  enemy_laser_drone: 'assets/LaserDrone.png',
  turret_base: 'assets/Turret Base.png',
  turret_head: 'assets/Turret Head.png',
  turret_vulcan: 'assets/Vulcan Turret.png',
};

function _ensureEnemyTexture(scene, key, onLoaded) {
  try {
    if (!key || !scene) return;
    if (scene.textures?.exists?.(key)) { if (onLoaded) onLoaded(); return; }
    const path = ENEMY_TEXTURE_PATHS[key];
    if (!path) return; // no known path
    // Avoid duplicate queueing
    if (!scene._enemyTexLoading) scene._enemyTexLoading = new Set();
    if (scene._enemyTexLoading.has(key)) return;
    scene._enemyTexLoading.add(key);
    scene.load.image(key, path);
    if (typeof onLoaded === 'function') {
      const handler = () => { try { onLoaded(); } catch (_) {} try { scene.load.off('complete', handler); } catch (_) {} };
      scene.load.on('complete', handler);
    }
    scene.load.start();
  } catch (_) {}
}

function _fitSpriteToBody(sprite, desiredPx) {
  try {
    const bodyH = (sprite.body && sprite.body.height) ? sprite.body.height : desiredPx || sprite.displayHeight || 12;
    const key = sprite.texture?.key; if (!key) return;
    const tex = sprite.scene.textures.get(key);
    const src = tex?.getSourceImage?.();
    const h = (src && (src.naturalHeight || src.height)) || tex?.frames?.['__BASE']?.height || sprite.height || 1;
    if (h > 0) {
      const scale = (bodyH / h) * ENEMY_SPRITE_VISUAL_MULT;
      sprite.setScale(scale);
    }
  } catch (_) {}
}

function _applyTextureAndScale(e, key, bodyW, bodyH) {
  // New approach: keep physics sprite as-is; render a separate visual image following the body
  try {
    if (!e || !e.scene || !key) return;
    const sc = e.scene;
    const buildImage = () => {
      try {
        if (e._vis && e._vis.texture?.key === key) return; // already set
        if (e._vis) { try { e._vis.destroy(); } catch (_) {} e._vis = null; }
        const img = sc.add.image(e.x, e.y, key);
        try { img.setOrigin(0.5, 0.5); img.setDepth(8000); } catch (_) {}
        // Scale image to body height with visual multiplier
        try {
          const tex = sc.textures.get(key);
          const src = tex?.getSourceImage?.();
          const h = (src && (src.naturalHeight || src.height)) || tex?.frames?.['__BASE']?.height || img.height || 1;
          const bodyHNow = (e.body && e.body.height) ? e.body.height : (bodyH || 12);
          const mul = (typeof e._visMult === 'number' && e._visMult > 0) ? e._visMult : 1;
          if (h > 0) img.setScale((bodyHNow / h) * ENEMY_SPRITE_VISUAL_MULT * mul);
        } catch (_) {}
        e._vis = img;
        // Ensure the underlying physics sprite is invisible
        try { e.setVisible(false); } catch (_) {}
        // Create/update separate physics hitbox that matches the visual size for bullet overlap
        try {
          if (!e._hitbox) {
            const hb = sc.physics.add.image(e.x, e.y, 'bullet');
            hb.setVisible(false);
            hb.setImmovable(true);
            hb.body.allowGravity = false;
            hb._owner = e;
            e._hitbox = hb;
            if (sc.enemyHitboxes && sc.enemyHitboxes.add) sc.enemyHitboxes.add(hb);
            // Lazily bind bullet overlap against this hitbox if bullets group exists
            try {
              if (sc.bullets && !e._hbOverlapBound) {
                sc.physics.add.overlap(sc.bullets, hb, (b, hitb) => {
                  try {
                    if (!b?.active || !hitb?.active) return;
                    const owner = hitb._owner; if (!owner?.active) return;
                    // Rook shield block (simplified)
                    if (owner.isRook && !b._rail) {
                      try {
                        const r = (owner._shieldRadius || 60);
                        const gap = 35; const off = (gap - r);
                        const cx = owner.x + Math.cos(owner._shieldAngle || 0) * off;
                        const cy = owner.y + Math.sin(owner._shieldAngle || 0) * off;
                        const angToBullet = Math.atan2(b.y - cy, b.x - cx);
                        const shieldAng = owner._shieldAngle || 0;
                        const diff = Math.abs(Phaser.Math.Angle.Wrap(angToBullet - shieldAng));
                        const half = Phaser.Math.DegToRad(45);
                        const dxr = b.x - cx, dyr = b.y - cy; const d2 = dxr * dxr + dyr * dyr;
                        if (diff <= half && d2 >= (r * r * 0.9)) {
                          try { if (b.body) b.body.checkCollision.none = true; } catch (_) {}
                          try { b.setActive(false).setVisible(false); } catch (_) {}
                          sc.time.delayedCall(0, () => { try { b.destroy(); } catch (_) {} });
                          return;
                        }
                      } catch (_) {}
                    }
                    // Damage
                    const baseDmg = b.damage || 10;
                    if (owner.isDummy) {
                      const primaryDmg = (b._core === 'blast' && !b._rocket) ? Math.ceil(baseDmg * 0.8) : baseDmg;
                      sc._dummyDamage = (sc._dummyDamage || 0) + primaryDmg;
                    } else {
                      if (typeof owner.hp !== 'number') owner.hp = owner.maxHp || 20;
                      owner.hp -= baseDmg;
                      try { sc._flashEnemyHit?.(owner); } catch (_) {}
                    }
                    const nowT = sc.time.now;
                    if (!owner.isDummy && b._igniteOnHit > 0) { owner._igniteValue = Math.min(10, (owner._igniteValue || 0) + b._igniteOnHit); if ((owner._igniteValue || 0) >= 10) { owner._ignitedUntil = nowT + 2000; owner._igniteValue = 0; } }
                    if (!owner.isDummy && b._toxinOnHit > 0) { owner._toxinValue = Math.min(10, (owner._toxinValue || 0) + b._toxinOnHit); if ((owner._toxinValue || 0) >= 10) { owner._toxinedUntil = nowT + 2000; owner._toxinValue = 0; } }
                    if (!owner.isDummy && b._stunOnHit > 0) { owner._stunValue = Math.min(10, (owner._stunValue || 0) + b._stunOnHit); if ((owner._stunValue || 0) >= 10) { owner._stunnedUntil = nowT + 200; owner._stunValue = 0; } }
                    if (b._core === 'blast') {
                      const radius = b._blastRadius || 20; const r2 = radius * radius;
                      const arr = sc.enemies?.getChildren?.() || [];
                      for (let i = 0; i < arr.length; i += 1) {
                        const other = arr[i]; if (!other?.active) continue; const dx = other.x - b.x; const dy = other.y - b.y; if (dx * dx + dy * dy <= r2) { if (typeof other.hp !== 'number') other.hp = other.maxHp || 20; other.hp -= b._rocket ? (b._aoeDamage || b.damage || 10) : Math.ceil((b.damage || 10) * 0.5); try { sc._flashEnemyHit?.(other); } catch (_) {} if (other.hp <= 0) sc.killEnemy?.(other); }
                      }
                      sc.damageSoftBarricadesInRadius?.(b.x, b.y, radius, (b.damage || 10));
                    }
                    if (b._core === 'pierce' && (b._pierceLeft || 0) > 0) { b._pierceLeft -= 1; }
                    else { try { if (b.body) b.body.checkCollision.none = true; } catch (_) {} try { b.setActive(false).setVisible(false); } catch (_) {} sc.time.delayedCall(0, () => { try { b.destroy(); } catch (_) {} }); }
                    if (owner.hp <= 0 && !owner.isDummy) sc.killEnemy?.(owner);
                  } catch (_) {}
                }, null, sc);
                e._hbOverlapBound = true;
              }
            } catch (_) {}
          }
          if (e._hitbox && e._vis) {
            const w = Math.max(1, Math.round(e._vis.displayWidth || 12));
            const h = Math.max(1, Math.round(e._vis.displayHeight || 12));
            try { e._hitbox.body.setSize(w, h, true); } catch (_) {}
            try { e._hitbox.setPosition(e.x, e.y); } catch (_) {}
          }
        } catch (_) {}
      } catch (_) {}
    };
    if (sc.textures?.exists?.(key)) buildImage(); else _ensureEnemyTexture(sc, key, buildImage);
  } catch (_) {}
}

function _resetBodySize(e) {
  try {
    if (e && e.body && e._bodyW && e._bodyH) {
      // Center body on the sprite using the origin by passing center=true
      e.body.setSize(e._bodyW, e._bodyH, true);
    }
  } catch (_) {}
}

function _attachEnemyVisuals(e, keyNormal, keyCharge = null, bodyW = null, bodyH = null, visMult = 1) {
  // Remember intended physics body size to keep collisions stable regardless of display scale
  if (bodyW && bodyH) { e._bodyW = bodyW; e._bodyH = bodyH; }
  try { e._visMult = (typeof visMult === 'number' && visMult > 0) ? visMult : 1; } catch (_) {}
  try {
    if (keyNormal) {
      const applyNormal = () => { try { _applyTextureAndScale(e, keyNormal, bodyW, bodyH); _resetBodySize(e); } catch (_) {} };
      if (e.scene?.textures?.exists?.(keyNormal)) applyNormal();
      else _ensureEnemyTexture(e.scene, keyNormal, applyNormal);
      // Proactively load charge texture if provided to avoid swap gaps
      if (keyCharge) _ensureEnemyTexture(e.scene, keyCharge);
    }
  } catch (_) {}
  // Orientation + optional charge swap per-frame
  const onUpdate = () => {
      try {
        const sc = e.scene;
        if (!sc || !e.active) return;
        // For Heal Drones, face their owner boss; otherwise face the player like other enemies
        const ownerBoss = (e.isHealDrone && e._ownerBoss && e._ownerBoss.active) ? e._ownerBoss : null;
        const target = ownerBoss || (sc.getEnemyTarget ? sc.getEnemyTarget() : sc.player);
        if (!target) return;
        const faceLeft = (target.x < e.x);
        try { e._vis?.setFlipX?.(faceLeft); } catch (_) {}
        try { if (e._vis) e._vis.setPosition(e.x, e.y); } catch (_) {}
      try {
        if (e._hitbox && e._vis) {
          const w = Math.max(1, Math.round(e._vis.displayWidth || 12));
          const h = Math.max(1, Math.round(e._vis.displayHeight || 12));
          e._hitbox.body.setSize(w, h, true);
          e._hitbox.setPosition(e.x, e.y);
        }
      } catch (_) {}
      if (keyCharge && e.isGrenadier) {
        const wantKey = e._charging ? keyCharge : keyNormal;
        if (e._vis && e._vis.texture && e._vis.texture.key !== wantKey) {
          const applySwap = () => { try { _applyTextureAndScale(e, wantKey, bodyW, bodyH); } catch (_) {} };
          if (e.scene.textures.exists(wantKey)) applySwap();
          else _ensureEnemyTexture(e.scene, wantKey, applySwap);
        }
      }
      // Enhance sniper bullets: add tracer and slight speed boost (decorate once)
      try {
        const arrB = e.scene?.enemyBullets?.getChildren?.();
        if (arrB && arrB.length) {
          for (let i = 0; i < arrB.length; i += 1) {
            const b = arrB[i]; if (!b?.active) continue;
            if (!b._sniper || b._decorated) continue;
            // One-time velocity boost
            try {
              if (!b._sniperBoosted && b.body && b.body.velocity) {
                const mul = 1.15; // +15%
                b.body.velocity.x *= mul; b.body.velocity.y *= mul;
                b._sniperBoosted = true;
              }
            } catch (_) {}
            // Add tracer graphics behind bullet, wrapping existing update method
            try {
              const g = e.scene.add.graphics();
              try { g.setDepth(8000); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
              const prevUpdate = b.update;
              b.update = () => {
                try {
                  // Draw tail along motion vector
                  g.clear();
                  const vx0 = b.body?.velocity?.x || 0; const vy0 = b.body?.velocity?.y || 0;
                  const ang = Math.atan2(vy0, vx0);
                  const tail = 14;
                  const tx = b.x - Math.cos(ang) * tail; const ty = b.y - Math.sin(ang) * tail;
                  g.lineStyle(3, 0xff3333, 0.8).beginPath().moveTo(tx, ty).lineTo(b.x, b.y).strokePath();
                  g.lineStyle(1, 0xffffff, 0.9).beginPath().moveTo(tx + Math.cos(ang) * 2, ty + Math.sin(ang) * 2).lineTo(b.x, b.y).strokePath();
                } catch (_) {}
                if (typeof prevUpdate === 'function') prevUpdate();
              };
              b.on('destroy', () => { try { g.destroy(); } catch (_) {} });
            } catch (_) {}
            b._decorated = true;
          }
        }
      } catch (_) {}
    } catch (_) {}
  };
  try { e.scene?.events?.on?.('update', onUpdate); } catch (_) {}
  try {
    e.on('destroy', () => {
      try { e.scene?.events?.off?.('update', onUpdate); } catch (_) {}
      try { e._vis?.destroy?.(); e._vis = null; } catch (_) {}
      try { e._hitbox?.destroy?.(); e._hitbox = null; } catch (_) {}
      // Common VFX cleanups used by snipers/prisms/melee
      try { e._aimG?.clear?.(); e._aimG?.destroy?.(); e._aimG = null; } catch (_) {}
      try { e._laserG?.clear?.(); e._laserG?.destroy?.(); e._laserG = null; } catch (_) {}
      try { if (e._meleeLine?.cleanup) e._meleeLine.cleanup(); else e._meleeLine?.g?.destroy?.(); e._meleeLine = null; } catch (_) {}
      // Indicators
      try { e._g?.destroy(); } catch (_) {}
      try { e._igniteIndicator?.destroy(); e._igniteIndicator = null; } catch (_) {}
      try { e._toxinIndicator?.destroy(); e._toxinIndicator = null; } catch (_) {}
      try { e._stunIndicator?.destroy(); e._stunIndicator = null; } catch (_) {}
      // If in a boss room, also clear any dash hint graphics stored on the scene
      try { const sc = e.scene; if (sc && sc._dashSeq) { sc._dashSeq._hintG?.destroy?.(); sc._dashSeq = null; } } catch (_) {}
    });
  } catch (_) {}
}

export function createEnemy(scene, x, y, hp = 100, damage = 10, speed = 60) {
  const e = scene.physics.add.sprite(x, y, 'enemy_square');
  e.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
  e.hp = hp;
  e.maxHp = hp;
  e.damage = damage;
  e.speed = speed;
  e.isEnemy = true;
  e.isMelee = true;
  _attachEnemyVisuals(e, 'enemy_shredder', null, 12, 12);
  return e;
}

// Fast melee "runner" enemy: 2x speed, ~30% less HP
export function createRunnerEnemy(scene, x, y, hp = 60, damage = 10, speed = 120) {
  const r = scene.physics.add.sprite(x, y, 'enemy_square');
  r.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
  r.hp = hp;
  r.maxHp = hp;
  r.damage = damage;
  r.speed = speed;
  r.isEnemy = true;
  r.isMelee = true;
  r.isRunner = true;
  _attachEnemyVisuals(r, 'enemy_charger', null, 12, 12, 0.9);
  return r;
}

export function createBoss(scene, x, y, hp = 600, damage = 20, speed = 50, textureKey = null) {
  const b = scene.physics.add.sprite(x, y, textureKey || 'enemy_square');
  // Use the standard 12x12 hitbox like other enemies
  b.setSize(36, 36).setOffset(0, 0).setCollideWorldBounds(true);
  b.hp = hp;
  b.maxHp = hp;
  b.damage = damage;
  b.speed = speed;
  b.isBoss = true;
  // Boss melee: separate config that currently mirrors Rook melee, but can diverge later.
  // Auto-melee uses this config + a detection radius when the player gets close.
  try {
    b._bossMeleeCfg = {
      range: 90,
      half: Phaser.Math.DegToRad ? Phaser.Math.DegToRad(75) : (Math.PI / 4),
      wind: 250,
      sweep: 90,
      recover: 650,
    };
    b._bossMeleeRadius = 110; // detection radius; slightly larger than swing range
    b._bossMeleeEnabled = true;
  } catch (_) {}
  try {
    // Attach visual sprite using the provided boss asset key and scale to fit the hitbox.
    // ENEMY_SPRITE_VISUAL_MULT is 2.0, so pass visMult = 0.5 to net to 1.0x body height.
    if (textureKey) _attachEnemyVisuals(b, textureKey, null, 36, 36, 0.8);
  } catch (_) {}
  b.on('destroy', () => b._g?.destroy());
  return b;
}

// Ranged shooter enemy: fires single bullets at intervals
export function createShooterEnemy(scene, x, y, hp = 90, damage = 8, speed = 45, fireRateMs = 900) {
  const s = scene.physics.add.sprite(x, y, 'enemy_square');
  s.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
  s.hp = hp;
  s.maxHp = hp;
  s.damage = damage;
  s.speed = speed;
  s.isEnemy = true;
  s.isShooter = true;
  s.fireRateMs = fireRateMs;
  s.lastShotAt = 0;
  _attachEnemyVisuals(s, 'enemy_gunner', null, 12, 12, 1.15);
  return s;
}

// Rocketeer: fires explosive rockets at 0.5/s, moderate HP, slow speed
export function createRocketeerEnemy(scene, x, y, hp = 80, damage = 12, speed = 40, fireRateMs = 2000) {
  const r = scene.physics.add.sprite(x, y, 'enemy_square');
  r.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
  r.hp = hp;
  r.maxHp = hp;
  r.damage = damage;
  r.speed = speed;
  r.isEnemy = true;
  r.isShooter = true;
  r.isRocketeer = true;
  r.fireRateMs = fireRateMs;
  r.lastShotAt = 0;
  _attachEnemyVisuals(r, 'enemy_rocketeer', null, 12, 12);
  return r;
}

// MachineGunner: tougher than shooter, slower movement, fires 12-bullet volleys
export function createMachineGunnerEnemy(
  scene,
  x,
  y,
  hp = 140,
  damage = 5,
  speed = 35,
  fireRateMs = 1100,
  burstCount = 15,
  spreadDeg = 14,
) {
  const m = scene.physics.add.sprite(x, y, 'enemy_square');
  m.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
  m.hp = hp;
  m.maxHp = hp;
  m.damage = damage;
  m.speed = speed;
  m.isEnemy = true;
  m.isShooter = true;
  m.isMachineGunner = true;
  m.fireRateMs = fireRateMs;
  m.burstCount = burstCount; // bullets per burst
  m.burstGapMs = 70; // time between shots in a burst
  m.spreadDeg = spreadDeg; // small cone while spraying
  m.lastShotAt = 0;
  _attachEnemyVisuals(m, 'enemy_machine_gunner', null, 12, 12);
  return m;
}

// Sniper enemy: aims with a red laser for 1s, then fires a high-speed, high-damage shot.
export function createSniperEnemy(scene, x, y, hp = 80, damage = 24, speed = 40) {
  const sn = scene.physics.add.sprite(x, y, 'enemy_square');
  sn.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
  sn.hp = hp;
  sn.maxHp = hp;
  sn.damage = damage;
  sn.speed = speed;
  sn.isEnemy = true;
  sn.isSniper = true;
  sn.aiming = false;
  sn.aimStartedAt = 0;
  sn.lastShotAt = 0;
  sn.aimDurationMs = 1000;
  sn.cooldownMs = 2000; // after shot
  sn._wanderChangeAt = 0;
  sn._wanderVX = 0;
  sn._wanderVY = 0;
  _attachEnemyVisuals(sn, 'enemy_sniper', null, 12, 12);
  return sn;
}

  // Prism (elite): laser specialist with sweeping beam and locked beam ability
export function createPrismEnemy(scene, x, y, hp = 180, damage = 16, speed = 46) {
  const p = scene.physics.add.sprite(x, y, 'enemy_square');
  p.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
  p.hp = hp;
  p.maxHp = hp;
  p.damage = damage;
  p.speed = speed;
  p.isEnemy = true;
  p.isShooter = true; // use shooter-style movement + pathfinding
  p.isPrism = true;
  // Visual distinction
  try { p.setScale(1.15); } catch (_) {}
  _attachEnemyVisuals(p, 'enemy_prism', null, 12, 12, 1.3);
  return p;
}

// Snitch (elite): fast kiter, calls reinforcements, shotgun burst when close
export function createSnitchEnemy(scene, x, y, hp = 100, damage = 6, speed = 60) {
  const s = scene.physics.add.sprite(x, y, 'enemy_square');
  s.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
  s.hp = hp; s.maxHp = hp; s.damage = damage; s.speed = speed;
  s.isEnemy = true; s.isShooter = true; s.isSnitch = true;
  _attachEnemyVisuals(s, 'enemy_commander', null, 12, 12, 1.3);
  return s;
}

// Rook (elite melee): slow, tanky melee with frontal shield that blocks bullets
export function createRookEnemy(scene, x, y, hp = 300, damage = 25, speed = 35) {
  const r = scene.physics.add.sprite(x, y, 'enemy_square');
  r.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
  r.hp = hp; r.maxHp = hp; r.damage = damage; r.speed = speed;
  r.isEnemy = true; r.isMelee = true; r.isRook = true;
  _attachEnemyVisuals(r, 'enemy_rook', null, 12, 12, 1.15);
  // Shield state: front arc (90 deg), slow turning
  r._shieldAngle = 0; // radians, facing right initially
  r._shieldG = null;
  // Bring shield closer to Rook, keep size constant
  r._shieldOffset = 2;
  r._shieldRadius = 60; // increased visual radius; offset unchanged
  r._shieldHalf = Phaser.Math.DegToRad ? Phaser.Math.DegToRad(45) : (Math.PI/4);
  r.on('destroy', () => { try { r._g?.destroy(); } catch (_) {} try { r._shieldG?.destroy(); r._shieldG = null; } catch (_) {} try { r._shieldFillG?.destroy(); r._shieldFillG = null; } catch (_) {} try { r._igniteIndicator?.destroy(); r._igniteIndicator = null; } catch (_) {} try { r._toxinIndicator?.destroy(); r._toxinIndicator = null; } catch (_) {} try { r._stunIndicator?.destroy(); r._stunIndicator = null; } catch (_) {} });
  // Ensure shield zone is cleaned up if managed by scene
  try { r.on('destroy', () => { try { r._shieldZone?.destroy?.(); r._shieldZone = null; } catch (_) {} }); } catch (_) {}
  return r;
}

// Grenadier (elite): lobs grenades in 3-round volleys, slightly larger body
export function createGrenadierEnemy(scene, x, y, hp = 260, damage = 10, speed = 48, burstCooldownMs = 2000) {
  const g = scene.physics.add.sprite(x, y, 'enemy_square');
  g.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
  g.hp = hp;
  g.maxHp = hp;
  g.damage = damage;
  g.speed = speed;
  g.isEnemy = true;
  g.isGrenadier = true;
  // Mark as shooter for movement heuristics, but custom fire logic will handle attacks
  g.isShooter = true;
  g.burstCooldownMs = burstCooldownMs;
  g.lastShotAt = 0;
  // Proximity detonation trigger radius (must be < explosion radius)
  g.detonateTriggerRadius = 55;
  // Explosion radius used for damage and VFX (keep in sync)
  g.explosionRadius = 70;
  _attachEnemyVisuals(g, 'enemy_bombardier', 'enemy_bombardier_special', 12, 12, 1.2);
  return g;
}

// Stationary turret enemy: built by Bigwig, cannot move, fires continuous bursts at the player
  export function createTurretEnemy(scene, x, y, hp = 80, damage = 10) {
  const t = scene.physics.add.sprite(x, y, 'enemy_square');
  t.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
  t.hp = hp;
  t.maxHp = hp;
  t.damage = damage;
  t.speed = 0;
  t.isEnemy = true;
  t.isTurret = true;
  // Stationary: never moves, even under repulsion
  try {
    t.body.setImmovable(true);
    t.body.moves = false;
  } catch (_) {}
  try { t.setVisible(false); } catch (_) {}
  // Visual base
  try {
    const base = scene.add.image(x, y, 'turret_base');
    base.setOrigin(0.5, 0.5);
    base.setDepth(8000);
    // Scale base roughly to 12px body height, but keep sprite visually taller than the hitbox
    try {
      const tex = scene.textures.get('turret_base');
      const src = tex?.getSourceImage?.();
      const h = (src && (src.naturalHeight || src.height)) || tex?.frames?.['__BASE']?.height || base.height || 1;
      if (h > 0) {
        const scale = (12 / h) * 2.4;
        base.setScale(scale);
      }
    } catch (_) {}
    t._turretBase = base;
  } catch (_) {}
  // Visual head
  try {
    const head = scene.add.image(x, y, 'turret_head');
    // Slightly forward origin (to the right) so rotation pivots a bit behind the barrel
    head.setOrigin(0.6, 0.5);
    head.setDepth(8005);
    try {
      const texH = scene.textures.get('turret_head');
      const srcH = texH?.getSourceImage?.();
      const h2 = (srcH && (srcH.naturalHeight || srcH.height)) || texH?.frames?.['__BASE']?.height || head.height || 1;
      if (h2 > 0) {
        // Head is even smaller than before but keeps its proportions
        const scaleH = (12 / h2) * 0.8;
        head.setScale(scaleH);
      }
    } catch (_) {}
    t._turretHead = head;
    // Precompute muzzle offset based on head width
    try {
      const mw = head.displayWidth || head.width || 12;
      t._turretMuzzleOffset = (mw / 2) * 0.9;
    } catch (_) {
      t._turretMuzzleOffset = 10;
    }
  } catch (_) {}
  // Cleanup visuals when turret dies
  try {
    t.on('destroy', () => {
      try { t._turretBase?.destroy(); } catch (_) {}
      try { t._turretHead?.destroy(); } catch (_) {}
      try { t._turretAimG?.destroy(); } catch (_) {}
      t._turretBase = null;
      t._turretHead = null;
      t._turretAimG = null;
    });
  } catch (_) {}
    return t;
  }

  // Heal Drone: support enemy that orbits a boss and fires heal beams
  export function createHealDroneEnemy(scene, x, y, hp = 30, ownerBoss = null) {
    const d = scene.physics.add.sprite(x, y, 'enemy_square');
    // 10x10 hitbox for all weapons; visuals are handled via attached sprite and _hitbox like other enemies
    d.setSize(10, 10).setOffset(0, 0).setCollideWorldBounds(true);
    d.hp = hp;
    d.maxHp = hp;
    d.damage = 0;
    d.speed = 0;
    d.isEnemy = true;
    d.isHealDrone = true;
    d._ownerBoss = ownerBoss || null;
    // Orbit/heal state
    d._hdAngle = 0;
    d._hdRadius = 48;
    d._hdSpawnAt = scene.time.now;
    d._hdFirstHealAt = d._hdSpawnAt + 2000;
    d._hdNextHealAt = d._hdFirstHealAt;
    // Attach visuals using the same helper as other enemies so sprite + hitbox follow the physics body
    try { _attachEnemyVisuals(d, 'enemy_heal_drone', null, 10, 10, 1.0); } catch (_) {}
    return d;
  }

  // Laser Drone: offensive drone that orbits Hazel and sweeps a laser at the player
  export function createLaserDroneEnemy(scene, x, y, hp = 20, ownerBoss = null) {
    const d = scene.physics.add.sprite(x, y, 'enemy_square');
    // 10x10 hitbox, same as HealDrone
    d.setSize(10, 10).setOffset(0, 0).setCollideWorldBounds(true);
    d.hp = hp;
    d.maxHp = hp;
    d.damage = 0;
    d.speed = 0;
    d.isEnemy = true;
    d.isLaserDrone = true;
    d._ownerBoss = ownerBoss || null;
    // Orbit/laser state (initialized lazily in scene update)
    d._ldSpawnAt = scene.time.now;
    // Attach visuals using the same helper as other enemies so sprite + hitbox follow the physics body
    try { _attachEnemyVisuals(d, 'enemy_laser_drone', null, 10, 10, 1.0); } catch (_) {}
    return d;
  }
