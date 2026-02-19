import { SceneKeys } from '../core/SceneKeys.js';
import { InputManager } from '../core/Input.js';
import { SaveManager } from '../core/SaveManager.js';
import { generateRoom, generateBarricades } from '../systems/ProceduralGen.js';
import { createEnemy, createShooterEnemy, createRunnerEnemy, createSniperEnemy, createMachineGunnerEnemy, createRocketeerEnemy, createBoss, createGrenadierEnemy, createPrismEnemy, createSnitchEnemy, createRookEnemy, createTurretEnemy, createHealDroneEnemy, createLaserDroneEnemy, createSwarmHealDroneEnemy, createSwarmLaserDroneEnemy, createSwarmShooterDroneEnemy } from '../systems/EnemyFactory.js';
import { weaponDefs } from '../core/Weapons.js';
import { impactBurst, bitSpawnRing, pulseSpark, muzzleFlash, muzzleFlashSplit, ensureCircleParticle, ensurePixelParticle, pixelSparks, spawnDeathVfxForEnemy, getScrapTintForEnemy, teleportSpawnVfx, bossSignalBeam, spawnBombardmentMarker } from '../systems/Effects.js';
import { getEffectiveWeapon, getPlayerEffects } from '../core/Loadout.js';
import { buildNavGrid, worldToGrid, findPath } from '../systems/Pathfinding.js';
import { preloadWeaponAssets, createPlayerWeaponSprite, syncWeaponTexture, updateWeaponSprite, createFittedImage, getWeaponMuzzleWorld, getWeaponBarrelPoint, fitImageHeight } from '../systems/WeaponVisuals.js';
import { drawPanel } from '../ui/Panels.js';
import { makeTextButton } from '../ui/Buttons.js';

const DISABLE_WALLS = true; // Temporary: remove concrete walls

export default class CombatScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Combat);
    // Cluster bomblet travel tuning (independent of explosion radius)
    this.CLUSTER_MIN_TRAVEL = 8;
    this.CLUSTER_MAX_TRAVEL = 20;
    // Caustic Cluster (ability) bomblet travel range (increased)
    this.CC_MIN_TRAVEL = 20;
    this.CC_MAX_TRAVEL = 40;
  }
  init(data) {
    this._isBossRoom = !!(data && data.bossRoom);
    this._bossId = data && data.bossId ? String(data.bossId) : null;
  }
  preload() {
    // Ensure weapon images are loaded even if entering this scene directly
    try { preloadWeaponAssets(this); } catch (_) {}
    try {
      if (!this.textures.exists('turret_base')) this.load.image('turret_base', 'assets/Turret Base.png');
      if (!this.textures.exists('turret_vulcan')) this.load.image('turret_vulcan', 'assets/Vulcan Turret.png');
    } catch (_) {}
  }

  // Shared helper: brief red flash on an enemy's visual sprite when it takes damage
  _flashEnemyHit(target) {
    try {
      if (!target) return;
      const sprite = target._vis || target;
      if (!sprite) return;
      const tex = sprite.texture;
      const key = tex && tex.key;
      if (!key) return;

      // Create a faint, overlay copy of the same texture so the flash matches the asset silhouette exactly.
      const overlay = this.add.image(sprite.x, sprite.y, key);
      try {
        overlay.setOrigin(sprite.originX ?? 0.5, sprite.originY ?? 0.5);
        overlay.setScale(sprite.scaleX ?? 1, sprite.scaleY ?? 1);
        if (sprite.flipX) overlay.setFlipX(true);
        if (sprite.flipY) overlay.setFlipY(true);
        overlay.setDepth((sprite.depth ?? 0) + 1);
        overlay.setBlendMode(Phaser.BlendModes.ADD);
      } catch (_) {}
      try { overlay.setTintFill(0xffffff); } catch (_) {}
      overlay.setAlpha(0.22);

      const startTime = this.time.now;
      const duration = 80;
      const updatePos = () => {
        try {
          if (!overlay.active || !sprite.active) return;
          overlay.x = sprite.x;
          overlay.y = sprite.y;
        } catch (_) {}
      };
      this.events.on('update', updatePos, this);

      this.tweens.add({
        targets: overlay,
        alpha: { from: 0.22, to: 0 },
        duration,
        ease: 'Quad.easeOut',
        onUpdate: () => { updatePos(); },
        onComplete: () => {
          try { this.events.off('update', updatePos, this); } catch (_) {}
          try { overlay.destroy(); } catch (_) {}
        },
      });
    } catch (_) {}
  }

  // Small spark burst when an enemy bullet hits the player; color matches the bullet tint
  _spawnEnemyBulletHitPlayerVfx(b) {
    try {
      if (!b) return;
      const x = b.x;
      const y = b.y;
      // Derive color from bullet tint; fall back to a generic enemy bullet yellow
      let color = 0xffcc00;
      try {
        const tint = (typeof b.tintTopLeft === 'number') ? b.tintTopLeft : null;
        if (tint && tint !== 0xffffff) color = tint;
      } catch (_) {}
      // Use bullet velocity to orient sparks so they streak along the incoming direction
      let ang = 0;
      try {
        const vx = b.body?.velocity?.x || 0;
        const vy = b.body?.velocity?.y || 0;
        ang = Math.atan2(vy, vx || 1);
      } catch (_) {}
      try {
        pixelSparks(this, x, y, {
          angleRad: ang,
          count: 4,
          spreadDeg: 40,
          speedMin: 220,
          speedMax: 360,
          lifeMs: 160,
          color,
          size: 2,
          alpha: 0.9,
        });
      } catch (_) {}
    } catch (_) {}
  }

  // Brief overlay flash on the player sprite when hit by an enemy bullet; tinted to the bullet color
  _flashPlayerHitFromBullet(b) {
    try {
      const sprite = this.player;
      if (!sprite || !sprite.active) return;
      const tex = sprite.texture;
      const key = tex && tex.key;
      if (!key) return;
      let color = 0xffaa66;
      try {
        const tint = (typeof b?.tintTopLeft === 'number') ? b.tintTopLeft : null;
        if (tint && tint !== 0xffffff) color = tint;
      } catch (_) {}
      const overlay = this.add.image(sprite.x, sprite.y, key);
      try {
        overlay.setOrigin(sprite.originX ?? 0.5, sprite.originY ?? 0.5);
        overlay.setScale(sprite.scaleX ?? 1, sprite.scaleY ?? 1);
        if (sprite.flipX) overlay.setFlipX(true);
        if (sprite.flipY) overlay.setFlipY(true);
        overlay.setDepth((sprite.depth ?? 0) + 1);
        overlay.setBlendMode(Phaser.BlendModes.ADD);
      } catch (_) {}
      try { overlay.setTintFill(color); } catch (_) {}
      overlay.setAlpha(0.22);

      const updatePos = () => {
        try {
          if (!overlay.active || !sprite.active) return;
          overlay.x = sprite.x;
          overlay.y = sprite.y;
        } catch (_) {}
      };
      this.events.on('update', updatePos, this);

      this.tweens.add({
        targets: overlay,
        alpha: { from: 0.22, to: 0 },
        duration: 80,
        ease: 'Quad.easeOut',
        onUpdate: () => { updatePos(); },
        onComplete: () => {
          try { this.events.off('update', updatePos, this); } catch (_) {}
          try { overlay.destroy(); } catch (_) {}
        },
      });
    } catch (_) {}
  }

  openTerminalPanel() {
    if (this.panel) return;
    const { width } = this.scale;
    // Larger terminal; clamp to viewport height so it doesn't run off-screen
    const desiredW = 720; const desiredH = 520; const margin = 20;
    const panelW = Math.min(desiredW, Math.max(360, width - margin * 2));
    const maxH = Math.max(260, this.scale.height - margin * 2);
    const panelH = Math.min(desiredH, maxH);
    const panelY = Math.max(margin, Math.floor((this.scale.height - panelH) / 2));
    this.panel = drawPanel(this, width / 2 - panelW / 2, panelY, panelW, panelH);
    this.panel._type = 'terminal';
    const title = this.add.text(width / 2, 80, 'Terminal - Spawn', { fontFamily: 'monospace', fontSize: 16, color: '#ffffff' }).setOrigin(0.5);
    const y0 = 105; const line = 26; const cx = width / 2;
    const addBtn = (ix, label, fn) => makeTextButton(this, cx, y0 + ix * line, label, fn);
    const addBtnAt = (x, y, label, fn) => makeTextButton(this, x, y, label, fn);
    const sp = (fn) => {
      const px = this.player.x + Phaser.Math.Between(-40, 40);
      const py = this.player.y + Phaser.Math.Between(-40, 40);
      return fn(this, px, py);
    };
    // EXPANDED TERMINAL: wider layout with three categories
    const colGap = 220; // widen columns spacing
    const col1X = width / 2 - colGap;  // Mass-Produced Drones
    const col2X = width / 2;           // Elite Drones
    const col3X = width / 2 + colGap;  // Misc
    const r0 = y0 + 2;
    const rLine = 32; // taller line spacing to prevent overlap

    const headerStyle = { fontFamily: 'monospace', fontSize: 16, color: '#ffff66' };
    const h1 = this.add.text(col1X, r0, 'Mass-Produced Drones', headerStyle).setOrigin(0.5, 0);
    const h2 = this.add.text(col2X, r0, 'Elite Drones', headerStyle).setOrigin(0.5, 0);
    const h3 = this.add.text(col3X, r0, 'Misc', headerStyle).setOrigin(0.5, 0);

    const nodes = [title, h1, h2, h3];
    // Difficulty modifiers for spawning range enemies (HP/damage scale)
    const mods = this.gs?.getDifficultyMods?.() || { enemyHp: 1, enemyDamage: 1 };
    let r = 1;
      // Mass-Produced (normal) - use same difficulty-scaled stats as regular rooms
      nodes.push(addBtnAt(col1X, r0 + rLine * (r + 0), 'Shredder', () => {
      this.enemies.add(sp((sc, x, y) => {
        const meleeDmg = Math.floor(Math.floor(10 * (mods.enemyDamage || 1)) * 1.5);
        return createEnemy(sc, x, y, Math.floor(100 * (mods.enemyHp || 1)), meleeDmg, 60);
      }));
    }));
      nodes.push(addBtnAt(col1X, r0 + rLine * (r + 1), 'Charger', () => {
      this.enemies.add(sp((sc, x, y) => {
        const meleeDmg = Math.floor(Math.floor(10 * (mods.enemyDamage || 1)) * 1.5);
        return createRunnerEnemy(sc, x, y, Math.floor(60 * (mods.enemyHp || 1)), meleeDmg, 120);
      }));
    }));
      nodes.push(addBtnAt(col1X, r0 + rLine * (r + 2), 'Gunner', () => {
      this.enemies.add(sp((sc, x, y) => createShooterEnemy(
        sc,
        x,
        y,
        Math.floor(90 * (mods.enemyHp || 1)),
        Math.floor(8 * (mods.enemyDamage || 1)),
        50,
        900,
      )));
    }));
      nodes.push(addBtnAt(col1X, r0 + rLine * (r + 3), 'MachineGunner', () => {
      this.enemies.add(sp((sc, x, y) => createMachineGunnerEnemy(
        sc,
        x,
        y,
        Math.floor(140 * (mods.enemyHp || 1)),
        Math.floor(5 * (mods.enemyDamage || 1)),
        35,
        1100,
        12,
        24,
      )));
    }));
    nodes.push(addBtnAt(col1X, r0 + rLine * (r + 4), 'Rocketeer', () => {
      this.enemies.add(sp((sc, x, y) => createRocketeerEnemy(
        sc,
        x,
        y,
        Math.floor(80 * (mods.enemyHp || 1)),
        Math.floor(12 * (mods.enemyDamage || 1)),
        40,
        2000,
      )));
    }));
    nodes.push(addBtnAt(col1X, r0 + rLine * (r + 5), 'Sniper', () => {
      this.enemies.add(sp((sc, x, y) => createSniperEnemy(
        sc,
        x,
        y,
        Math.floor(80 * (mods.enemyHp || 1)),
        Math.floor(18 * (mods.enemyDamage || 1)),
        40,
      )));
    }));

      // Elite - use same difficulty-scaled stats as regular rooms
      nodes.push(addBtnAt(col2X, r0 + rLine * (r + 0), 'Bombardier', () => {
      this.enemies.add(sp((sc, x, y) => createGrenadierEnemy(
        sc,
        x,
        y,
        Math.floor(260 * (mods.enemyHp || 1)),
        Math.floor(10 * (mods.enemyDamage || 1)),
        48,
        2000,
      )));
    }));
    nodes.push(addBtnAt(col2X, r0 + rLine * (r + 1), 'Prism', () => {
      this.enemies.add(sp((sc, x, y) => createPrismEnemy(
        sc,
        x,
        y,
        Math.floor(180 * (mods.enemyHp || 1)),
        Math.floor(16 * (mods.enemyDamage || 1)),
        46,
      )));
    }));
      nodes.push(addBtnAt(col2X, r0 + rLine * (r + 2), 'Commander', () => {
      this.enemies.add(sp((sc, x, y) => createSnitchEnemy(
        sc,
        x,
        y,
        Math.floor(100 * (mods.enemyHp || 1)),
        Math.floor(6 * (mods.enemyDamage || 1)),
        60,
      )));
    }));
    nodes.push(addBtnAt(col2X, r0 + rLine * (r + 3), 'Rook', () => {
      this.enemies.add(sp((sc, x, y) => createRookEnemy(
        sc,
        x,
        y,
        Math.floor(300 * (mods.enemyHp || 1)),
        Math.floor(25 * (mods.enemyDamage || 1)),
        35,
      )));
    }));
    // Boss only when not in Range
    if (!this.gs?.shootingRange) {
      nodes.push(addBtnAt(col2X, r0 + rLine * (r + 5), 'Spawn Boss', () => {
        this.enemies.add(sp((sc, x, y) => { const e = createBoss(sc, x, y, 600, 20, 50); e.isEnemy = true; return e; }));
      }));
    }

    //

    // Misc
    let miscRow = 0;
    if (this.gs?.shootingRange) {
      if (typeof this._rangeInvincible !== 'boolean') this._rangeInvincible = false;
      const label = () => (this._rangeInvincible ? 'Invincibility: On' : 'Invincibility: Off');
      const bInv = addBtnAt(col3X, r0 + rLine * (miscRow++ + r), label(), () => {
        this._rangeInvincible = !this._rangeInvincible;
        try { bInv.setText(label()); } catch (_) {}
      });
      nodes.push(bInv);
      if (typeof this._rangeNoAbilityCd !== 'boolean') this._rangeNoAbilityCd = false;
      const labelCd = () => (this._rangeNoAbilityCd ? 'Ability CD: Off' : 'Ability CD: On');
      const bCd = addBtnAt(col3X, r0 + rLine * (miscRow++ + r), labelCd(), () => {
        this._rangeNoAbilityCd = !this._rangeNoAbilityCd;
        try { bCd.setText(labelCd()); } catch (_) {}
      });
      nodes.push(bCd);
      if (typeof this._rangeInfiniteAmmo !== 'boolean') this._rangeInfiniteAmmo = false;
      const labelAmmo = () => (this._rangeInfiniteAmmo ? 'Mag Ammo: Infinite' : 'Mag Ammo: Normal');
      const bAmmo = addBtnAt(col3X, r0 + rLine * (miscRow++ + r), labelAmmo(), () => {
        this._rangeInfiniteAmmo = !this._rangeInfiniteAmmo;
        try { bAmmo.setText(labelAmmo()); } catch (_) {}
      });
      nodes.push(bAmmo);
    }
    const bClear = addBtnAt(col3X, r0 + rLine * (miscRow++ + r), 'Clear Enemies', () => {
      try { const list = (this.enemies?.getChildren?.() || []).slice(); list.forEach((e) => { try { if (e && e.active && !e.isDummy) e.destroy(); } catch (_) {} }); } catch (_) {}
    });
    nodes.push(bClear);

    // Prototype Drones (Bosses) 闂?allow spawning bosses in training ground (no cutscene)
    if (this.gs?.shootingRange) {
      const protoY = r0 + rLine * (miscRow + r + 1.0);
      const protoHeader = this.add.text(col3X, protoY, 'Prototype Drones', headerStyle).setOrigin(0.5, 0);
      nodes.push(protoHeader);
      const spawnBossAt = (bossId) => {
        try {
          // Prevent multiple bosses at once
          if (this.boss && this.boss.active) return;
          const anyBoss = (this.enemies?.getChildren?.() || []).some((e) => e?.active && e.isBoss);
          if (anyBoss) return;
          const { width } = this.scale;
          const mods = this.gs?.getDifficultyMods?.() || {};
          const cx = Math.floor(width / 2); const cy = 100;
          // Per-boss base HP (Normal difficulty) before difficulty scaling
          const baseBossHp = bossId === 'Bigwig' ? 2200 : (bossId === 'Dandelion' ? 1200 : 2000);
          const baseBossSpeed = 80;
          const hpScaled = Math.floor(baseBossHp * (mods.enemyHp || 1));
          const dmgScaled = Math.floor(10 * (mods.enemyDamage || 1));
          const boss = createBoss(this, cx, cy, hpScaled, dmgScaled, baseBossSpeed, bossId);
          boss.isEnemy = true; boss.isBoss = true; boss.isShooter = true; boss.bossType = bossId;
          boss.maxHp = hpScaled;
          boss.hp = hpScaled;
          // Dandelion gets higher base speed; other bosses use baseBossSpeed
          boss.speed = (bossId === 'Dandelion') ? 120 : baseBossSpeed;
          boss.damage = dmgScaled;
          boss._nextNormalAt = 0;
          boss._nextSpecialAt = this.time.now + 2500;
          boss._state = 'idle';
          this.boss = boss; this.enemies.add(boss);
          // No cutscene in training ground; ensure HUD shows
          try {
            this.registry.set('bossName', bossId);
            this.registry.set('bossHp', boss.hp);
            this.registry.set('bossHpMax', boss.maxHp);
            this.registry.set('bossActive', true);
            this.registry.set('cinematicActive', false);
          } catch (_) {}
        } catch (_) {}
      };
      nodes.push(addBtnAt(col3X, protoY + rLine * 1.2, 'Bigwig (Boss)', () => spawnBossAt('Bigwig')));
      nodes.push(addBtnAt(col3X, protoY + rLine * 2.2, 'Dandelion (Boss)', () => spawnBossAt('Dandelion')));
      nodes.push(addBtnAt(col3X, protoY + rLine * 3.2, 'Hazel (Boss)', () => spawnBossAt('Hazel')));
    }

    // Close button at the very bottom
    const close = makeTextButton(this, width / 2, panelY + panelH - 20, 'Close', () => this.closePanel([...nodes, close]));
    this.panel._extra = [...nodes, close];
  }

  closePanel(extra = []) {
    const extras = [
      ...(Array.isArray(extra) ? extra : []),
      ...(this.panel && Array.isArray(this.panel._extra) ? this.panel._extra : []),
    ];
    if (this.panel) { try { this.panel.destroy(); } catch (_) {} this.panel = null; }
    extras.forEach((o) => { try { o?.destroy?.(); } catch (_) {} });
  }

  // Player melee implementation: 150闂?cone, 48px range, 10 damage (90ms swing, 45ms hit)
  performPlayerMelee() {
    const caster = this.player;
    if (!caster) return;
    const breakingStealth = this.isStealthed();
    if (breakingStealth) this.endStealthDecoy();
    const meleeDmg = breakingStealth ? 100 : 10;
    const ptr = this.inputMgr.pointer;
    const ang = Math.atan2(ptr.worldY - caster.y, ptr.worldX - caster.x);
    const totalDeg = 150; const half = Phaser.Math.DegToRad(totalDeg / 2);
    const range = 48;
    this._meleeAlt = !this._meleeAlt;
    // Simple transparent fan to indicate affected area (white by default, blue on stealth-break)
    // Swing VFX length 90ms to match enemy
    try {
      const color = breakingStealth ? 0x66ccff : 0xffffff;
      this.spawnMeleeVfx(caster, ang, totalDeg, 90, color, range, this._meleeAlt);
    } catch (_) {}
    // Damage check against enemies (~45ms after start)
    try {
      this.time.delayedCall(45, () => {
        const enemies = this.enemies?.getChildren?.() || [];
        enemies.forEach((e) => {
          if (!e?.active || !e.isEnemy || !caster?.active) return;
          const dx = e.x - caster.x; const dy = e.y - caster.y;
          const d = Math.hypot(dx, dy) || 1;
          const pad = (e.body?.halfWidth || 6);
          if (d > (range + pad)) return;
          const dir = Math.atan2(dy, dx);
          const diff = Math.abs(Phaser.Math.Angle.Wrap(dir - ang));
          if (diff <= half) {
            if (e.isDummy) {
              this._dummyDamage = (this._dummyDamage || 0) + meleeDmg;
              // Show universal hit VFX for dummy in shooting range
              try { impactBurst(this, e.x, e.y, { color: 0xffffff, size: 'small' }); } catch (_) {}
            } else {
              if (typeof e.hp !== 'number') e.hp = e.maxHp || 20;
              e.hp -= meleeDmg;
              try { this._flashEnemyHit(e); } catch (_) {}
              if (e.hp <= 0) { try { this.killEnemy(e); } catch (_) {} }
              // Universal melee hit VFX on enemy
              try { impactBurst(this, e.x, e.y, { color: 0xffffff, size: 'small' }); } catch (_) {}
            }
          }
        });
      });
    } catch (_) {}
  }


  // Centralized damage application that respects Energy Shield and overrun
  applyPlayerDamage(amount) {
    try {
      // Shooting Range invincibility toggle: ignore all incoming damage when enabled
      try { if (this.gs?.shootingRange && this._rangeInvincible) return; } catch (_) {}
      const gs = this.gs; if (!gs) return;
      const dmg = Math.max(0, Math.floor(amount || 0)); if (dmg <= 0) return;
      let remaining = dmg;
      const s = Math.max(0, Math.floor(gs.shield || 0));
      const hadShield = s > 0;
      let shieldBroke = false;
      let shieldDamaged = false;
      if (s > 0) {
        const absorbed = Math.min(s, remaining);
        if (absorbed > 0) shieldDamaged = true;
        gs.shield = s - absorbed;
        remaining -= absorbed;
        if (s > 0 && gs.shield === 0) shieldBroke = true;
      }
      const beforeHp = gs.hp | 0;
      if (remaining > 0) {
        let allow = (gs.allowOverrun !== false);
        try { const eff = getPlayerEffects(gs) || {}; if (hadShield && eff.preventShieldOverflow) allow = false; } catch (_) {}
        if (allow) gs.hp = Math.max(0, (gs.hp | 0) - remaining);
      }
        // If shield just broke and the Emergency Pulse mod is active, auto-release a Repulsion Pulse
        try {
          if (shieldBroke) {
          const eff = getPlayerEffects(gs) || {};
          if (eff.preventShieldOverflow) {
            const nowT = this.time.now;
            // Hidden cooldown: trigger at most once every 12s
            if (nowT >= (this._emPulseCdUntil || 0)) {
              this._emPulseCdUntil = nowT + 12000;
              const blue = { trail: 0x66aaff, outer: 0x66aaff, inner: 0x99ccff, spark: 0x66aaff, pixel: 0x66aaff, impact: 0x66aaff };
              this.deployRepulsionPulse(blue);
            }
          }
        }
      } catch (_) {}
      gs.lastDamagedAt = this.time.now;
      // On death in Deep Dive: record best then reset run so level/stage restart when returning to hub
      try {
        const afterHp = gs.hp | 0;
        // Trigger HP-hit screen vignette only if HP actually went down this frame
        try {
          if (afterHp < beforeHp) {
            const ui = this.scene.get(SceneKeys.UI);
            if (ui && typeof ui.showHpHitVfx === 'function') ui.showHpHitVfx();
          }
        } catch (_) {}
        // Trigger subtle blue vignette if only shield took damage (no HP loss)
        try {
          const afterHp = gs.hp | 0;
          if (shieldDamaged && afterHp === beforeHp) {
            const ui = this.scene.get(SceneKeys.UI);
            if (ui && typeof ui.showShieldHitVfx === 'function') ui.showShieldHitVfx();
          }
        } catch (_) {}
        if (afterHp <= 0 && gs.gameMode === 'DeepDive') {
          try {
            const cur = gs.deepDive || { level: 1, stage: 1 };
            const best = gs.deepDiveBest || { level: 0, stage: 0 };
            if (cur.level > best.level || (cur.level === best.level && cur.stage > best.stage)) {
              gs.deepDiveBest = { level: cur.level, stage: cur.stage };
              SaveManager.saveToLocal(gs);
            }
          } catch (_) {}
          gs.deepDive = { level: 1, stage: 1, baseNormal: 5, baseElite: 1 };
        } else if (afterHp <= 0 && gs.gameMode === 'Swarm') {
          try {
            const cur = gs.swarm || { level: 1 };
            const best = gs.swarmBest || { level: 0 };
            if ((cur.level || 0) > (best.level || 0)) {
              gs.swarmBest = { level: cur.level };
              SaveManager.saveToLocal(gs);
            }
          } catch (_) {}
          gs.swarm = { level: 1 };
        }
      } catch (_) {}
    } catch (_) {}
  }

  // Shared melee VFX: simple transparent fan (sector) showing affected area; follows caster position
  spawnMeleeVfx(caster, baseAngle, totalDeg, durationMs, color, range, altStart) {
    try {
      if (caster._meleeFan?.cleanup) { caster._meleeFan.cleanup(); }
      else if (caster._meleeFan?.g) { caster._meleeFan.g.destroy(); }
    } catch (_) {}
    const g = this.add.graphics({ x: caster.x, y: caster.y });
    try { g.setDepth(9000); } catch (_) {}
    const half = Phaser.Math.DegToRad(totalDeg / 2);
    const a1 = baseAngle - half;
    const a2 = baseAngle + half;
    const r = Math.max(1, Math.floor(range));
    const col = (typeof color === 'number') ? color : 0xffffff;
    const alpha = 0.22;
    try {
      g.fillStyle(col, alpha);
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, r, a1, a2, false);
      g.closePath();
      g.fillPath();
    } catch (_) {}
    const onUpdate = () => { try { g.x = caster.x; g.y = caster.y; } catch (_) {} };
    this.events.on('update', onUpdate, this);
    const cleanupFan = () => { try { this.events.off('update', onUpdate, this); } catch (_) {} try { g.destroy(); } catch (_) {} caster._meleeFan = null; };
    const dur = Math.max(1, (durationMs | 0) || 100);
    const guardFan = this.time.delayedCall(dur, cleanupFan);
    caster._meleeFan = { g, guard: guardFan, cleanup: cleanupFan };
    // Remove any prior swinging line overlay if present (ensure listener removal)
    try {
      if (caster._meleeLine?.cleanup) { caster._meleeLine.cleanup(); }
      else if (caster._meleeLine?.g) { caster._meleeLine.g.destroy(); }
      caster._meleeLine = null;
    } catch (_) {}

    // Add a bright additive "beam" line that sweeps across the melee fan during the swing
    try {
      const beam = this.add.graphics({ x: caster.x, y: caster.y });
      try { beam.setDepth?.(9500); } catch (_) {}
      try { beam.setBlendMode?.(Phaser.BlendModes.ADD); } catch (_) {}
      const start = altStart ? (baseAngle + half) : (baseAngle - half);
      const end = altStart ? (baseAngle - half) : (baseAngle + half);
      const startAt = this.time.now;
      const endAt = startAt + dur;
      const thick = Math.max(2, Math.floor(r * 0.08));
      // Base-white accent near origin for readability on enemies (short segment)
      let lastSparkAt = 0;
      let lastBurstAt = 0;
      let lastAng = start;
      const updateBeam = () => {
        try {
          if (!caster?.active) { cleanupBeam(); return; }
          // Follow caster
          beam.x = caster.x; beam.y = caster.y;
          const now = this.time.now;
          const t = Phaser.Math.Clamp((now - startAt) / Math.max(1, dur), 0, 1);
          // Linear interpolate angles (range is <= 180闂? safe for lerp)
          const cur = start + (end - start) * t;
          const tipX = Math.cos(cur) * r;
          const tipY = Math.sin(cur) * r;
          beam.clear();
          // Outer colored stroke
          beam.lineStyle(thick, col, 0.95);
          beam.beginPath(); beam.moveTo(0, 0); beam.lineTo(tipX, tipY); beam.strokePath();
          // White base segment for the first ~1/3 of beam length
          const baseFrac = 0.35;
          beam.lineStyle(Math.max(1, thick - 1), 0xffffee, 0.98);
          beam.beginPath(); beam.moveTo(0, 0); beam.lineTo(tipX * baseFrac, tipY * baseFrac); beam.strokePath();
          // Inner core using the beam color for the rest
          beam.lineStyle(Math.max(1, thick - 1), col, 0.95);
          beam.beginPath(); beam.moveTo(0, 0); beam.lineTo(tipX * 0.85, tipY * 0.85); beam.strokePath();
          // Tip bloom
          beam.fillStyle(col, 0.85).fillCircle(tipX, tipY, Math.max(2, Math.floor(thick * 0.6)));

          // Particle trail: follow beam tip and spray opposite to sweep movement direction
          if (!lastSparkAt || (now - lastSparkAt > 14)) {
            lastSparkAt = now;
            const dAng = Phaser.Math.Angle.Wrap(cur - lastAng);
            const sprayDir = cur + (dAng >= 0 ? -Math.PI / 2 : Math.PI / 2);
            lastAng = cur;
            try {
              pixelSparks(this, caster.x + tipX, caster.y + tipY, {
                angleRad: sprayDir,
                count: 4,
                spreadDeg: 28,
                speedMin: 200,
                speedMax: 360,
                lifeMs: 230,
                color: col,
                size: 2,
                alpha: 0.95,
              });
            } catch (_) {}
          }
          // Periodic mini-burst for extra intensity
          if (!lastBurstAt || (now - lastBurstAt > 60)) {
            lastBurstAt = now;
            const dAng = Phaser.Math.Angle.Wrap(cur - lastAng);
            const sprayDir = cur + (dAng >= 0 ? -Math.PI / 2 : Math.PI / 2);
            try {
              pixelSparks(this, caster.x + tipX, caster.y + tipY, {
                angleRad: sprayDir,
                count: 6,
                spreadDeg: 36,
                speedMin: 220,
                speedMax: 380,
                lifeMs: 260,
                color: col,
                size: 2,
                alpha: 0.95,
              });
            } catch (_) {}
          }

          if (now >= endAt) { cleanupBeam(); return; }
        } catch (_) {}
      };
      this.events.on('update', updateBeam, this);
      const cleanupBeam = () => {
        try { this.events.off('update', updateBeam, this); } catch (_) {}
        try { this.tweens.killTweensOf(beam); } catch (_) {}
        try { beam.clear(); beam.visible = false; } catch (_) {}
        try { beam.destroy(); } catch (_) {}
        try { if (caster && caster._meleeLine && caster._meleeLine.g === beam) caster._meleeLine = null; } catch (_) {}
      };
      // Store handle for potential early cleanup next swing
      caster._meleeLine = { g: beam, cleanup: cleanupBeam };
      // Safety guard in case scene stops updating
      this.time.delayedCall(dur, cleanupBeam);
    } catch (_) {}
  }

  create() {
    const { width, height } = this.scale;
    // Fallback: if init() wasn't called with data, read from scene settings
    try {
      const d = this.scene?.settings?.data;
      if (d && typeof d === 'object') {
        if (this._isBossRoom !== true && d.bossRoom) this._isBossRoom = true;
        if (!this._bossId && d.bossId) this._bossId = String(d.bossId);
      }
    } catch (_) {}
    // Infer boss room from GameState if not provided (robustness for chained transitions)
    try {
      if (!this._isBossRoom && this.gs?.gameMode === 'BossRush') {
        this._isBossRoom = true;
        if (!this._bossId && typeof this.gs.chooseBossType === 'function') this._bossId = this.gs.chooseBossType();
      }
      if (!this._isBossRoom && this.gs?.nextScene === 'Boss') {
        this._isBossRoom = true;
        if (!this._bossId && typeof this.gs.chooseBossType === 'function') this._bossId = this.gs.chooseBossType();
      }
    } catch (_) {}
    
    // Ensure no stale boss reference carries over between boss rooms
    this.boss = null;

    // Debug overlay for boss-room state
    
    
    
    
    
    
    
    
    this.physics.world.setBounds(0, 0, width, height);
    try { this.physics.world.setBoundsCollision(true, true, true, true); } catch (_) {}
    // Ensure UI overlay is active during combat
    this.scene.launch(SceneKeys.UI);
    try { this.scene.bringToTop(SceneKeys.UI); } catch (_) {}
    // Background: use boss background if in boss room, else normal
    try {
      const bgKey = this._isBossRoom && this.textures?.exists('bg_boss') ? 'bg_boss' : 'bg_normal';
      if (this.textures?.exists(bgKey)) {
        const bg = this.add.image(width / 2, height / 2, bgKey);
        const tex = this.textures.get('bg_normal');
        const src = tex.getSourceImage?.() || {};
        const iw = src.naturalWidth || src.width || tex.frames['__BASE']?.width || bg.width || width;
        const ih = src.naturalHeight || src.height || tex.frames['__BASE']?.height || bg.height || height;
        const scale = Math.max(width / iw, height / ih);
        bg.setScale(scale);
        bg.setScrollFactor?.(0);
        try { bg.setDepth(-1000); } catch (_) {}
        this._bg = bg;
      }
    } catch (_) {}
    // Pull latest GameState from registry (shared across scenes)
    this.gs = this.registry.get('gameState');
    // Guard against stale boss-room flags leaking from previous runs:
    // if we're not about to play a boss encounter according to GameState,
    // force this room to be treated as a normal combat room.
    try {
      const isBossMode = this.gs?.gameMode === 'BossRush' || this.gs?.nextScene === 'Boss';
      if (!isBossMode) {
        this._isBossRoom = false;
        // Clear any leftover boss id unless the caller explicitly marked this room as a boss room
        const d2 = this.scene?.settings?.data;
        const explicitBoss = d2 && typeof d2 === 'object' && d2.bossRoom;
        if (!explicitBoss) this._bossId = null;
      }
    } catch (_) {}
    // Ensure Deep Dive tracker text exists in UI scene (create deterministically)
    try {
      const ensureDeepDiveLabel = () => {
        const ui = this.scene.get(SceneKeys.UI);
        if (!ui) return;
        if (!ui.deepDiveText || !ui.deepDiveText.active) {
          ui.deepDiveText = ui.add.text(12, 28, '', { fontFamily: 'monospace', fontSize: 12, color: '#66ffcc' }).setOrigin(0, 0).setAlpha(0.95);
        }
        if (this.gs?.gameMode === 'DeepDive' && this.gs.deepDive) {
          const L = Math.max(1, this.gs.deepDive.level || 1);
          const S = Math.max(1, Math.min(4, this.gs.deepDive.stage || 1));
          ui.deepDiveText.setText(`Deep Dive ${L}-${S}`);
          ui.deepDiveText.setVisible(true);
        } else {
          ui.deepDiveText.setVisible(false);
        }
      };
      // Attempt immediately and after a short delay in case UI is still booting
      ensureDeepDiveLabel();
      this.time.delayedCall(50, ensureDeepDiveLabel);
      this.time.delayedCall(150, ensureDeepDiveLabel);
    } catch (_) {}
    // Swarm tracker text in UI scene
    try {
      const ensureSwarmLabel = () => {
        const ui = this.scene.get(SceneKeys.UI);
        if (!ui) return;
        if (!ui.swarmText || !ui.swarmText.active) {
          ui.swarmText = ui.add.text(12, 28, '', { fontFamily: 'monospace', fontSize: 12, color: '#66ffcc' }).setOrigin(0, 0).setAlpha(0.95);
        }
        if (this.gs?.gameMode === 'Swarm' && this.gs.swarm) {
          const L = Math.max(1, this.gs.swarm.level || 1);
          ui.swarmText.setText(`Swarm ${L}`);
          ui.swarmText.setVisible(true);
        } else {
          ui.swarmText.setVisible(false);
        }
      };
      ensureSwarmLabel();
      this.time.delayedCall(50, ensureSwarmLabel);
      this.time.delayedCall(150, ensureSwarmLabel);
    } catch (_) {}
    // Campaign (Normal) label in Combat: show "Campaign S-L" where L is 1..3 for rooms
    try {
      const ensureCampaignLabel = () => {
        const ui = this.scene.get(SceneKeys.UI);
        if (!ui) return;
        if (!ui.campaignText || !ui.campaignText.active) {
          // Place to match Deep Dive label position in Combat
          ui.campaignText = ui.add.text(12, 28, '', { fontFamily: 'monospace', fontSize: 12, color: '#66ffcc' }).setOrigin(0, 0).setAlpha(0.95);
        }
        if (this.gs?.gameMode === 'Normal' && !this.gs?.shootingRange) {
          const S = Math.max(1, this.gs?.campaignSelectedStage || 1);
          const L = Math.max(1, Math.min(3, (this.gs?.roomsClearedInCycle || 0) + 1));
          ui.campaignText.setText(`Campaign ${S}-${L}`);
          ui.campaignText.setVisible(true);
        } else {
          ui.campaignText.setVisible(false);
        }
      };
      ensureCampaignLabel();
      this.time.delayedCall(50, ensureCampaignLabel);
      this.time.delayedCall(150, ensureCampaignLabel);
    } catch (_) {}
    // Boss Rush label in Combat (for completeness; visible if BossRush combat ever used)
    try {
      const ensureBossRushLabel = () => {
        const ui = this.scene.get(SceneKeys.UI);
        if (!ui) return;
        if (!ui.bossRushText || !ui.bossRushText.active) {
          ui.bossRushText = ui.add.text(12, 28, '', { fontFamily: 'monospace', fontSize: 12, color: '#66ffcc' }).setOrigin(0, 0).setAlpha(0.95);
        }
        if (this.gs?.gameMode === 'BossRush') {
          const total = 3;
          const left = Array.isArray(this.gs?.bossRushQueue) ? this.gs.bossRushQueue.length : 0;
          const idx = Math.max(1, Math.min(3, total - left + 1));
          ui.bossRushText.setText(`Boss Rush ${idx}`);
          ui.bossRushText.setVisible(true);
        } else {
          ui.bossRushText.setVisible(false);
        }
      };
      ensureBossRushLabel();
      this.time.delayedCall(50, ensureBossRushLabel);
      this.time.delayedCall(150, ensureBossRushLabel);
    } catch (_) {}
    // Ensure shield is full on scene start
    try {
      if (typeof this.gs.shieldMax !== "number") this.gs.shieldMax = 20;
      this.gs.shield = this.gs.shieldMax;
    } catch (_) {}
    this.inputMgr = new InputManager(this);

    // Player (Inle art, scaled to 12px height)
    this.player = this.physics.add.sprite(width / 2, height / 2, 'player_inle').setCollideWorldBounds(true);
    try { fitImageHeight(this, this.player, 24); } catch (_) {}
    this.player.setSize(12, 12);
    // Dedicated 12x12 collider proxy for barricades/walls
    try {
      this.playerCollider = this.physics.add.sprite(this.player.x, this.player.y, 'player_square')
        .setVisible(false).setActive(true).setCollideWorldBounds(true);
      this.playerCollider.setSize(12, 12).setOffset(0, 0);
      this.playerCollider.body.allowGravity = false;
      if (this.player?.body) this.player.body.checkCollision.none = true;
    } catch (_) {}
    // Player hitbox placeholder (invisible) for consistent bullet collisions
    try {
      this.playerHitbox = this.physics.add.sprite(this.player.x, this.player.y, 'player_square')
        .setVisible(false).setActive(true);
      this.playerHitbox.setSize(12, 12).setOffset(0, 0);
      this.playerHitbox.body.allowGravity = false;
      this.playerHitbox.body.setImmovable(true);
    } catch (_) {}
    this.player.iframesUntil = 0;
    this.playerFacing = 0; // radians

    // Visualize currently equipped weapon in the player's hands
    try { createPlayerWeaponSprite(this); } catch (_) {}

    // Dash state
    this.dash = { active: false, until: 0, cooldownUntil: 0, vx: 0, vy: 0, charges: 0, regen: [] };
    this.dash.charges = this.gs.dashMaxCharges;
    this.registry.set('dashCharges', this.dash.charges);
    this.registry.set('dashRegenProgress', 1);

    // Ammo tracking per-weapon for this scene
    this._lastActiveWeapon = this.gs.activeWeapon;
    this.ammoByWeapon = {};
    this.reload = { active: false, until: 0, duration: 0 };
    const cap0 = this.getActiveMagCapacity();
    this.ensureAmmoFor(this._lastActiveWeapon, cap0);
    this.registry.set('ammoInMag', this.ammoByWeapon[this._lastActiveWeapon] ?? cap0);
    this.registry.set('magSize', cap0);
    this.registry.set('reloadActive', false);
    // Persistent WASP BITS (armour)
    this._wasps = [];
    // Laser state
    this.laser = { heat: 0, firing: false, overheat: false, startedAt: 0, coolDelayUntil: 0, g: null, lastTickAt: 0 };
    // Persistent fire fields from MGL core
    this._firefields = [];
    this.registry.set('reloadProgress', 0);

    // Keep weapon sprite updated every frame without touching existing update()
    try {
      this.events.on('update', () => {
        // Update position/rotation
        updateWeaponSprite(this);
        // Always try to sync texture in case it finished loading after create
        if (this.gs) syncWeaponTexture(this, this.gs.activeWeapon);
        this._lastActiveWeapon = this.gs?.activeWeapon;
        // Face player left/right based on cursor X
        try {
          const ptr = this.input?.activePointer;
          if (ptr && this.player) this.player.setFlipX(ptr.worldX < this.player.x);
          // Make shooting-range dummy face the player and keep invisible placeholder in sync
          if (this.gs?.shootingRange && this.dummy && this.dummy.active) {
            this.dummy.setFlipX(this.player.x < this.dummy.x);
            try { if (this.dummyPlaceholder) this.dummyPlaceholder.setPosition(this.dummy.x, this.dummy.y); } catch (_) {}
          }
      // Keep collider proxy and invisible bullet hitbox in sync
      try { if (this.playerCollider && this.player) this.player.setPosition(this.playerCollider.x, this.playerCollider.y); } catch (_) {}
      try { if (this.playerHitbox && this.player) this.playerHitbox.setPosition(this.player.x, this.player.y); } catch (_) {}
        } catch (_) {}
        // Shield regeneration (regens even from 0 after a delay)
        // Shield VFX: subtle blue ring when shield > 0; break animation on 0
        try {
          const gs = this.gs; if (!gs || !this.player) return;
          // Maintain short history of player positions for lagged targeting (e.g., Dandelion special)
          try {
            if (!this._playerPosHistory) this._playerPosHistory = [];
            const hist = this._playerPosHistory;
            hist.push({ t: this.time.now, x: this.player.x, y: this.player.y });
            const cutoff = this.time.now - 1000; // keep last 1s
            while (hist.length && hist[0].t < cutoff) hist.shift();
          } catch (_) {}
          const hasShield = (gs.shield || 0) > 0.0001;
          if (hasShield) {
            if (!this._shieldRingG || !this._shieldRingG.active) {
              this._shieldRingG = this.add.graphics({ x: this.player.x, y: this.player.y });
              try { this._shieldRingG.setDepth(8800); } catch (_) {}
              try { this._shieldRingG.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
            }
            const g = this._shieldRingG; g.clear();
            const t = (this.time.now % 1000) / 1000;
            const radius = 13 + Math.sin(t * Math.PI * 2) * 1.0; const s = Math.max(0, gs.shield || 0); const smax = Math.max(1e-6, gs.shieldMax || 0); const p = Math.max(0, Math.min(1, s / smax)); const alpha = (0.12 + 0.28 * p) + Math.sin(t * Math.PI * 2) * 0.04 * p;
            g.lineStyle(3, 0x66ccff, 0.55 + 0.4 * p).strokeCircle(0, 0, radius);
            g.lineStyle(2, 0x99ddff, 0.3 + 0.4 * p).strokeCircle(0, 0, Math.max(11, radius - 2.5));
            try { g.setAlpha(alpha); } catch (_) {}
            g.x = this.player.x; g.y = this.player.y;
          } else {
            if (this._shieldRingG) {
              const old = this._shieldRingG; this._shieldRingG = null;
              try {
                this.tweens.add({ targets: old, alpha: 0, scale: 1.6, duration: 160, ease: 'Cubic.Out', onComplete: () => { try { old.destroy(); } catch (_) {} } });
              } catch (_) { try { old.destroy(); } catch (_) {} }
              try {
                const cx = this.player.x, cy = this.player.y;
                for (let i = 0; i < 18; i += 1) {
                  const a = (i / 12) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.05, 0.05);
                  pixelSparks(this, cx, cy, { angleRad: a, count: 1, spreadDeg: 10, speedMin: 160, speedMax: 280, lifeMs: 220, color: 0x66ccff, size: 2, alpha: 0.95 });
                }
                const br = this.add.graphics({ x: cx, y: cy });
                try { br.setDepth(8800); br.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
                br.lineStyle(3, 0x66ccff, 1.0).strokeCircle(0, 0, 12);
                this.tweens.add({ targets: br, alpha: 0, scale: 2.0, duration: 220, ease: 'Cubic.Out', onComplete: () => { try { br.destroy(); } catch (_) {} } });
              } catch (_) {}
            }
          }
        } catch (_) {}
        try {
          const gs = this.gs; if (!gs) return;
          const now = this.time.now;
          const since = now - (gs.lastDamagedAt || 0);
          if (since >= (gs.shieldRegenDelayMs || 4000) && (gs.shield || 0) < (gs.shieldMax || 0)) {
            const dt = ((this.game?.loop?.delta) || 16) / 1000;
            const inc = ((gs.shieldRegenPerSec || 0) + ((getPlayerEffects(this.gs)||{}).shieldRegenBonus || 0)) * dt;
            gs.shield = Math.min((gs.shield || 0) + inc, (gs.shieldMax || 0));
          }
        } catch (_) {}
        // Deep Dive tracker update in UI scene
        try {
          const ui = this.scene.get(SceneKeys.UI);
          if (ui && ui.deepDiveText) {
            if (this.gs?.gameMode === 'DeepDive' && this.gs.deepDive) {
              const L = Math.max(1, this.gs.deepDive.level || 1);
              const S = Math.max(1, Math.min(4, this.gs.deepDive.stage || 1));
              ui.deepDiveText.setText(`Deep Dive ${L}-${S}`);
              ui.deepDiveText.setVisible(true);
            } else {
              ui.deepDiveText.setVisible(false);
            }
          }
        } catch (_) {}
        // Swarm tracker update in UI scene
        try {
          const ui = this.scene.get(SceneKeys.UI);
          if (ui && ui.swarmText) {
            if (this.gs?.gameMode === 'Swarm' && this.gs.swarm) {
              const L = Math.max(1, this.gs.swarm.level || 1);
              ui.swarmText.setText(`Swarm ${L}`);
              ui.swarmText.setVisible(true);
            } else {
              ui.swarmText.setVisible(false);
            }
          }
        } catch (_) {}
        // Landmine Dispenser: manage mine travel + arming + detection globally so behavior is consistent
        try {
          if (Array.isArray(this._mines) && this._mines.length) {
            const nowT = this.time.now;
            this._mines = this._mines.filter((m) => m && m.active);
            const enemies = this.enemies?.getChildren?.() || [];
            for (let i = 0; i < this._mines.length; i += 1) {
              const m = this._mines[i]; if (!m?.active) continue;
              // Unarmed: let physics move the mine, and once it reaches stop radius, start arm delay
              if (!m._armed) {
                // Stop and start arm delay once reaching stop radius
                try {
                  const dx = (m.x - (m._ox || 0)); const dy = (m.y - (m._oy || 0));
                  if ((dx * dx + dy * dy) >= (m._travelMax2 || 3600)) {
                    try { m.setVelocity(0, 0); m.body.setVelocity(0, 0); m.body.moves = false; m.body.setImmovable(true); } catch (_) {}
                    if (!m._armingUntil) m._armingUntil = nowT + 500; // 0.5s delay before armed
                  }
                } catch (_) {}
                // Promote to armed after delay and update visuals
                if (m._armingUntil && nowT >= m._armingUntil) {
                  m._armed = true; m._armingUntil = 0;
                  try { m.setTint(0x33ff66); } catch (_) {}
                  if (!m._armG) {
                    try {
                      const g = this.add.graphics({ x: m.x, y: m.y });
                      g.setDepth(8000);
                      g.setBlendMode(Phaser.BlendModes.ADD);
                      m._armG = g;
                    } catch (_) {}
                  }
                }
              } else {
                // Armed: maintain glow and trigger when enemy enters detection radius (skip dummy)
                try {
                  if (m._armG) {
                    const g = m._armG;
                    g.clear();
                    g.setPosition(m.x, m.y);
                    g.fillStyle(0x66ff99, 0.6).fillRect(-4, -4, 8, 8);
                    g.lineStyle(1, 0xffffff, 0.9).strokeRect(-4, -4, 8, 8);
                  }
                } catch (_) {}
                const r = m._detRadius || 40; const r2 = r * r;
                for (let k = 0; k < enemies.length; k += 1) {
                  const e = enemies[k]; if (!e?.active || e.isDummy) continue;
                  const dx = e.x - m.x; const dy = e.y - m.y;
                  if ((dx * dx + dy * dy) <= r2) { m._explodeFn?.(m); break; }
                }
              }
            }
          }
        } catch (_) {}
        // Campaign tracker update in UI scene (Normal mode)
        try {
          const ui = this.scene.get(SceneKeys.UI);
          if (ui && ui.campaignText) {
            if (this.gs?.gameMode === 'Normal' && !this.gs?.shootingRange) {
              const S = Math.max(1, this.gs?.campaignSelectedStage || 1);
              const L = Math.max(1, Math.min(3, (this.gs?.roomsClearedInCycle || 0) + 1));
              ui.campaignText.setText(`Campaign ${S}-${L}`);
              ui.campaignText.setVisible(true);
            } else {
              ui.campaignText.setVisible(false);
            }
          }
        } catch (_) {}
        // Boss Rush tracker update in UI scene
        try {
          const ui = this.scene.get(SceneKeys.UI);
          if (ui && ui.bossRushText) {
            if (this.gs?.gameMode === 'BossRush') {
              const total = 3;
              const left = Array.isArray(this.gs?.bossRushQueue) ? this.gs.bossRushQueue.length : 0;
              const idx = Math.max(1, Math.min(3, total - left + 1));
              ui.bossRushText.setText(`Boss Rush ${idx}`);
              ui.bossRushText.setVisible(true);
            } else {
              ui.bossRushText.setVisible(false);
            }
          }
        } catch (_) {}
      });
    } catch (_) {}

    // Bullets group (use Arcade.Image for proper pooling)
    this.bullets = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Image,
      maxSize: 256,
      runChildUpdate: true,
    });

    // Enemies (must be a physics group so overlaps work reliably)
    this.enemies = this.physics.add.group();
    // Ensure boss HUD is cleared when this scene shuts down (e.g., player death -> Hub)
    try {
      this.events.once('shutdown', () => {
        try { this.registry.set('bossActive', false); this.registry.set('bossName', ''); this.registry.set('bossHp', 0); this.registry.set('bossHpMax', 0); this.registry.set('cinematicActive', false); } catch (_) {}
      });
    } catch (_) {}
    // Reset exit state at scene start
    this.exitActive = false;
    this._swarmState = null;
    try { this.exitG?.clear?.(); } catch (_) {}
    try { this.prompt?.setText?.(''); } catch (_) {}
    // If this is a boss room, spawn the boss ASAP so exit logic doesn't trigger prematurely
    try {
            if (this._isBossRoom && !this.boss) {
                const mods = this.gs?.getDifficultyMods?.() || {};
        const cx = width / 2; const cy = 100;
        let bossType = this._bossId || (typeof this.gs?.chooseBossType === 'function' ? this.gs.chooseBossType() : 'Dandelion');
        // Per-boss base HP (Normal difficulty) before difficulty scaling
        const baseBossHp = bossType === 'Bigwig' ? 2200 : (bossType === 'Dandelion' ? 1200 : 2000);
        // Create boss with base HP, then apply difficulty scaling
        let boss = createBoss(this, cx, cy, baseBossHp, 10, 60, bossType);
        boss.isEnemy = true; boss.isBoss = true; boss.isShooter = true; boss.bossType = bossType;
        boss.maxHp = Math.floor(baseBossHp * (mods.enemyHp || 1)); boss.hp = boss.maxHp;
        // Dandelion gets higher base speed; other bosses stay at standard speed.
        const baseBossSpeed = 60;
        boss.speed = (bossType === 'Dandelion') ? 120 : baseBossSpeed;
        boss.damage = Math.floor(10 * (mods.enemyDamage || 1));
        // visual comes from asset via createBoss catch (_) {} }
        boss._nextNormalAt = 0; boss._nextSpecialAt = this.time.now + 2500; boss._state = 'idle';
        // Visual scaling is handled by EnemyFactory helper; keep physics body at 12x12
        this.boss = boss; this.enemies.add(boss);
        try { this.registry.set('bossName', bossType); this.registry.set('bossHp', boss.hp); this.registry.set('bossHpMax', boss.maxHp); this.registry.set('bossActive', true); } catch (_) {}
        
        try { this.startBossIntro?.(bossType); } catch (_) {}
      }
    } catch (err) { }
    const mods = this.gs.getDifficultyMods();
    const room = generateRoom(this.gs.rng, this.gs.currentDepth);
    this.room = room;
    if (!DISABLE_WALLS) {
      this.createArenaWalls(room);
    } else {
      // Expand arena to full screen when walls are disabled
      const { width, height } = this.scale;
      this.arenaRect = new Phaser.Geom.Rectangle(0, 0, width, height);
      this.walls = null;
    }
    // Barricades: indestructible (hard) and destructible (soft)
    this.barricadesHard = this.physics.add.staticGroup();
    this.barricadesSoft = this.physics.add.staticGroup();
    if (!this.gs?.shootingRange) {
      if (this._isBossRoom) {
        // Boss rooms: only soft barricades, and fewer than the normal-room 'soft_many' variant.
        const rng = this.gs.rng;
        const all = generateBarricades(rng, this.arenaRect, 'soft_many') || [];
        const softOnly = all.filter((b) => b && b.kind === 'soft');
        // Reduce count to ~20% of soft_many (at least 2 for some cover)
        const target = Math.max(2, Math.floor(softOnly.length * 0.20));
        const used = new Set();
        const picks = [];
        for (let i = 0; i < target && softOnly.length > 0; i += 1) {
          let idx = rng.int(0, Math.max(0, softOnly.length - 1));
          // Ensure unique picks; fallback to sequential if too many collisions
          let guard = 0;
          while (used.has(idx) && guard < 10) { idx = rng.int(0, Math.max(0, softOnly.length - 1)); guard += 1; }
          if (used.has(idx)) { // fallback
            for (let j = 0; j < softOnly.length; j += 1) { if (!used.has(j)) { idx = j; break; } }
          }
          used.add(idx);
          picks.push(softOnly[idx]);
        }
        picks.forEach((b) => {
          const s = this.physics.add.staticImage(b.x, b.y, 'barricade_soft');
          s.setData('destructible', true);
          s.setData('hp', 20);
          this.barricadesSoft.add(s);
        });
      } else if (this.gs?.gameMode === 'Swarm') {
        const barricades = generateBarricades(this.gs.rng, this.arenaRect, 'hard_sparse') || [];
        barricades.forEach((b) => {
          if (b.kind === 'hard') {
            const s = this.physics.add.staticImage(b.x, b.y, 'barricade_hard');
            s.setData('destructible', false);
            this.barricadesHard.add(s);
          } else {
            const s = this.physics.add.staticImage(b.x, b.y, 'barricade_hard');
            s.setData('destructible', false);
            this.barricadesHard.add(s);
          }
        });
      } else {
        // Normal rooms: slightly reduce intensity of soft-only layouts
        const brRoll = this.gs.rng.next();
        let variant = (brRoll < 0.5) ? 'normal' : (brRoll < 0.75) ? 'soft_many' : 'hard_sparse';
        let barricades = generateBarricades(this.gs.rng, this.arenaRect, variant);
        // If using the soft_many pattern, randomly drop some tiles to reduce density
        if (variant === 'soft_many' && Array.isArray(barricades) && barricades.length) {
          const rng = this.gs.rng;
          const filtered = [];
          for (let i = 0; i < barricades.length; i += 1) {
            const b = barricades[i];
            // Keep hard tiles (should not appear in soft_many, but safe) and randomly skip some soft tiles
            if (b.kind === 'hard') {
              filtered.push(b);
            } else {
              // Keep ~50% of soft tiles, drop ~50% to slightly thin out the maze
              if (rng.next() < 0.5) filtered.push(b);
            }
          }
          barricades = filtered;
        }
        barricades.forEach((b) => {
          if (b.kind === 'hard') {
            const s = this.physics.add.staticImage(b.x, b.y, 'barricade_hard');
            s.setData('destructible', false);
            this.barricadesHard.add(s);
          } else {
            const s = this.physics.add.staticImage(b.x, b.y, 'barricade_soft');
            s.setData('destructible', true);
            // Base HP for destructible tiles
            s.setData('hp', 20);
            this.barricadesSoft.add(s);
          }
        });
      }
    }
    // Helper: pick a spawn on screen edges/corners, far from player
    const pickEdgeSpawn = () => {
      const pad = 12;
      const { width: W, height: H } = this.scale;
      const px = this.player.x, py = this.player.y;
      const minDist = 180;
      for (let tries = 0; tries < 12; tries += 1) {
        const r = Math.random();
        let sx = pad, sy = pad;
        if (r < 0.125) { sx = pad; sy = pad; } // TL corner
        else if (r < 0.25) { sx = W - pad; sy = pad; } // TR
        else if (r < 0.375) { sx = pad; sy = H - pad; } // BL
        else if (r < 0.5) { sx = W - pad; sy = H - pad; } // BR
        else if (r < 0.625) { sx = Phaser.Math.Between(pad, W - pad); sy = pad; } // top
        else if (r < 0.75) { sx = Phaser.Math.Between(pad, W - pad); sy = H - pad; } // bottom
        else if (r < 0.875) { sx = pad; sy = Phaser.Math.Between(pad, H - pad); } // left
        else { sx = W - pad; sy = Phaser.Math.Between(pad, H - pad); } // right
        const dx = sx - px, dy = sy - py;
        if ((dx * dx + dy * dy) >= (minDist * minDist)) return { x: sx, y: sy };
      }
      // Fallback: farthest corner from player
      const sx = (px < this.scale.width / 2) ? (this.scale.width - pad) : pad;
      const sy = (py < this.scale.height / 2) ? (this.scale.height - pad) : pad;
      return { x: sx, y: sy };
    };

    // Helpers for spawns
    const spawnOneNormal = () => {
      const sp = pickEdgeSpawn();
      const roll = this.gs.rng.next();
      let e;
      if (roll < 0.10) {
        e = createSniperEnemy(this, sp.x, sp.y, Math.floor(80 * mods.enemyHp), Math.floor(18 * mods.enemyDamage), 40);
      } else if (roll < 0.30) {
        e = createShooterEnemy(this, sp.x, sp.y, Math.floor(90 * mods.enemyHp), Math.floor(8 * mods.enemyDamage), 50, 900);
      } else if (roll < 0.40) {
        e = createMachineGunnerEnemy(this, sp.x, sp.y, Math.floor(140 * mods.enemyHp), Math.floor(5 * mods.enemyDamage), 35, 1100, 12, 24);
      } else if (roll < 0.50) {
        e = createRocketeerEnemy(this, sp.x, sp.y, Math.floor(80 * mods.enemyHp), Math.floor(12 * mods.enemyDamage), 40, 2000);
      } else if (roll < 0.70) {
        const meleeDmg = Math.floor(Math.floor(10 * mods.enemyDamage) * 1.5);
        e = createRunnerEnemy(this, sp.x, sp.y, Math.floor(60 * mods.enemyHp), meleeDmg, 120);
      } else {
        const meleeDmg = Math.floor(Math.floor(10 * mods.enemyDamage) * 1.5);
        e = createEnemy(this, sp.x, sp.y, Math.floor(100 * mods.enemyHp), meleeDmg, 60);
      }
      this.enemies.add(e);
    };
    const spawnOneElite = () => {
      const spE = pickEdgeSpawn();
      const pick = Math.random();
      if (pick < (1/4)) {
        this.enemies.add(createGrenadierEnemy(this, spE.x, spE.y, Math.floor(260 * mods.enemyHp), Math.floor(10 * mods.enemyDamage), 48, 2000));
      } else if (pick < (2/4)) {
        this.enemies.add(createPrismEnemy(this, spE.x, spE.y, Math.floor(180 * mods.enemyHp), Math.floor(16 * mods.enemyDamage), 46));
      } else if (pick < (3/4)) {
        this.enemies.add(createSnitchEnemy(this, spE.x, spE.y, Math.floor(100 * mods.enemyHp), Math.floor(6 * mods.enemyDamage), 60));
      } else {
        this.enemies.add(createRookEnemy(this, spE.x, spE.y, Math.floor(300 * mods.enemyHp), Math.floor(25 * mods.enemyDamage), 35));
      }
    };

      if (!this.gs?.shootingRange) {
        if (this.gs?.gameMode === 'DeepDive') {
          const dd = this.gs.deepDive || {};
          const baseN = Math.max(1, dd.baseNormal || 5);
          const baseE = Math.max(1, dd.baseElite || 1);
          const stage = Math.max(1, Math.min(4, dd.stage || 1));
          const stageNormal = baseN + Math.min(stage - 1, 2);
          const stageElite = (stage === 4) ? (baseE * 2) : baseE;
          if (!this._isBossRoom) {
            for (let i = 0; i < stageNormal; i += 1) spawnOneNormal();
            for (let i = 0; i < stageElite; i += 1) spawnOneElite();
          }
        } else if (this.gs?.gameMode === 'Swarm') {
          const sw = this.gs.swarm || { level: 1 };
          const level = Math.max(1, sw.level || 1);
          const laserCount = 8 + (level - 1) * 2;
          const healCount = 2 + Math.floor((level - 1) / 2);
          const swarmHpMult = 1 + (level - 1) * 0.1;
          const spawnSwarmEnemy = (kind) => {
            const sp = pickEdgeSpawn();
            const spawnFn = () => {
              if (kind === 'heal') {
                const hp = Math.floor(30 * (mods.enemyHp || 1) * swarmHpMult);
                const d = createSwarmHealDroneEnemy(this, sp.x, sp.y, hp);
                d._swarmLevel = level;
                d._swarmHealMult = swarmHpMult;
                this.enemies.add(d);
              } else if (kind === 'shooter') {
                const hp = Math.floor(20 * (mods.enemyHp || 1) * swarmHpMult);
                const d = createSwarmShooterDroneEnemy(this, sp.x, sp.y, hp);
                d._swarmLevel = level;
                d._swarmDmgMult = (mods.enemyDamage || 1);
                this.enemies.add(d);
              } else {
                const hp = Math.floor(20 * (mods.enemyHp || 1) * swarmHpMult);
                const d = createSwarmLaserDroneEnemy(this, sp.x, sp.y, hp);
                d._swarmLevel = level;
                d._swarmDpsMult = swarmHpMult * (mods.enemyDamage || 1);
                this.enemies.add(d);
              }
            };
            try {
              teleportSpawnVfx(this, sp.x, sp.y, { onSpawn: spawnFn });
            } catch (_) {
              spawnFn();
            }
          };
          const spawnSwarmWave = () => {
            for (let i = 0; i < laserCount; i += 1) {
              const roll = this.gs?.rng?.next?.() ?? Math.random();
              spawnSwarmEnemy(roll < 0.5 ? 'shooter' : 'laser');
            }
            for (let i = 0; i < healCount; i += 1) spawnSwarmEnemy('heal');
          };
          if (!this._isBossRoom) {
            this._swarmState = {
              level,
              totalWaves: 3,
              wavesSpawned: 0,
              waveTimes: [0, 10000, 20000],
              startedAt: this.time.now,
            };
            const spawnWaveWithTimer = (delayMs) => {
              this.time.delayedCall(delayMs, () => {
                if (!this.scene?.isActive?.(SceneKeys.Combat)) return;
                spawnSwarmWave();
                if (this._swarmState) this._swarmState.wavesSpawned += 1;
              });
            };
            this._swarmState.wavesSpawned = 0;
            spawnWaveWithTimer(0);
            spawnWaveWithTimer(10000);
            spawnWaveWithTimer(20000);
          }
        } else {
          // Campaign (Normal) game: composition based on depth for normals, elites by stage
          if (!this._isBossRoom) {
          // Fixed normal enemy counts per stage/room in Campaign mode:
          // Stage 1: 4, 5, 5  (rooms 1-1,1-2,1-3)
          // Stage 2: 6, 7, 7  (rooms 2-1,2-2,2-3)
          // Stage 3: 7, 7, 7  (rooms 3-1,3-2,3-3)
          const stage = Math.max(1, Math.min(3, this.gs?.campaignSelectedStage || this.gs?.campaignStage || 1));
          const roomIndex = Math.max(1, Math.min(3, (this.gs?.roomsClearedInCycle || 0) + 1));
          let normals = 4;
          if (stage === 1) {
            const table = [4, 5, 5];
            normals = table[Math.min(roomIndex - 1, table.length - 1)];
          } else if (stage === 2) {
            const table = [6, 7, 7];
            normals = table[Math.min(roomIndex - 1, table.length - 1)];
          } else {
            const table = [7, 7, 7];
            normals = table[Math.min(roomIndex - 1, table.length - 1)];
          }
          for (let i = 0; i < normals; i += 1) spawnOneNormal();
          }
          // Default 1 elite; Stage 3 uses 2 elites
          let eliteCount = 1;
          try {
            const st = Math.max(1, this.gs?.campaignSelectedStage || this.gs?.campaignStage || 1);
          if (st === 3) eliteCount = 2;
        } catch (_) {}
        if (!this._isBossRoom) {
          for (let i = 0; i < eliteCount; i += 1) spawnOneElite();
        }
      }
    }

    // Shooting Range setup: terminal, dummy, and portal to hub
      if (this.gs?.shootingRange) {
        // Terminal (left side)
        this.terminalZone = this.add.zone(60, height / 2, 36, 36);
        this.physics.world.enable(this.terminalZone);
        this.terminalZone.body.setAllowGravity(false);
        this.terminalZone.body.setImmovable(true);
        this.terminalG = this.add.graphics();
        // Shooting Range terminal sprite (Terminal.png)
        try {
          this.terminalSprite = this.add.image(this.terminalZone.x, this.terminalZone.y, 'diff_terminal');
          this.terminalSprite.setOrigin(0.5);
          fitImageHeight(this, this.terminalSprite, 24);
        } catch (_) {}

      // Persistent dummy target in the center-right
      this._dummyDamage = 0;
      this.dummy = this.physics.add.sprite(width / 2 + 120, height / 2, 'dummy_target');
      try { fitImageHeight(this, this.dummy, 24); } catch (_) {}
      // Match player visual scale and ensure overlaps/collisions register robustly
      this.dummy.setSize(24, 24).setOffset(0, 0).setCollideWorldBounds(true);
      this.dummy.isEnemy = true;
      this.dummy.isDummy = true;
      this.dummy.maxHp = 999999;
      this.dummy.hp = this.dummy.maxHp;
      // Do not add the visual dummy to enemies; use an invisible placeholder instead
      this.dummyLabel = this.add.text(this.dummy.x, this.dummy.y - 16, 'DMG: 0', { fontFamily: 'monospace', fontSize: 12, color: '#ffff66' }).setOrigin(0.5);

      // Invisible placeholder enemy (exactly like before), used for bullet collisions and AoE logic
      try {
        this.dummyPlaceholder = this.physics.add.sprite(this.dummy.x, this.dummy.y, 'enemy_square');
        this.dummyPlaceholder.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
        this.dummyPlaceholder.setTint(0xffff00).setVisible(false).setActive(true);
        this.dummyPlaceholder.isEnemy = true;
        this.dummyPlaceholder.isDummy = true;
        this.dummyPlaceholder.maxHp = 999999;
        this.dummyPlaceholder.hp = this.dummyPlaceholder.maxHp;
        try { this.dummyPlaceholder.body.setImmovable(true); this.dummyPlaceholder.body.moves = false; } catch (_) {}
        this.enemies.add(this.dummyPlaceholder);
      } catch (_) {}

      // Portal back to Hub (right side)
      const px = width - 40; const py = height / 2;
      this.portal = this.physics.add.staticImage(px, py, 'hub_drill');
      this.portal.setSize(24, 24).setOffset(0, 0);
      try {
        this.portal.setOrigin(0.5, 0.5);
        this.portal.setFlipX(true);
        fitImageHeight(this, this.portal, 64);
        this.portal.setDepth(9000);
      } catch (_) {}
      // Helper text
      this.rangeText = this.add.text(width / 2, 28, 'Shooting Range: E near Terminal/Dummy/Drill', { fontFamily: 'monospace', fontSize: 14, color: '#ffffff' }).setOrigin(0.5);
    }

    // Colliders
    if (this.walls) {
      const pCol = this.playerCollider || this.player;
      this.physics.add.collider(pCol, this.walls);
    this.physics.add.collider(this.enemies, this.walls);
    }
    // Colliders with barricades (block movement and bullets)
    {
      const pCol = this.playerCollider || this.player;
      this.physics.add.collider(pCol, this.barricadesHard);
      this.physics.add.collider(pCol, this.barricadesSoft);
    }
    this.physics.add.collider(
      this.enemies,
      this.barricadesHard,
      undefined,
      (e, s) => {
        // Heal/Laser Drones ignore hard barricade collisions
        try {
          if (e?.isHealDrone || e?.isLaserDrone) return false;
        } catch (_) {}
        // Let Dandelion ignore hard barricade collision response while dashing/assaulting
        try {
          if (e?.isBoss && (e.bossType === 'Dandelion' || e._bossId === 'Dandelion')) {
            const st = e._dnAssaultState || 'idle';
            const assaultDash = st === 'dashIn' || st === 'dashOut';
            const normalDash = e._dnDashState === 'dashing';
            if (assaultDash || normalDash) return false;
          }
        } catch (_) {}
        return true;
      },
      this,
    );
    this.physics.add.collider(
      this.enemies,
      this.barricadesSoft,
      undefined,
      (e, s) => {
        // Heal/Laser Drones ignore soft barricade collisions
        try {
          if (e?.isHealDrone || e?.isLaserDrone) return false;
        } catch (_) {}
        // Let Dandelion ignore barricade collision response while dashing/assaulting;
        // soft barricades it touches are explicitly destroyed in _dandelionBreakSoftBarricades.
        try {
          if (e?.isBoss && (e.bossType === 'Dandelion' || e._bossId === 'Dandelion')) {
            const st = e._dnAssaultState || 'idle';
            const assaultDash = st === 'dashIn' || st === 'dashOut';
            const normalDash = e._dnDashState === 'dashing';
            if (assaultDash || normalDash) return false;
          }
        } catch (_) {}
        return true;
      },
      this,
    );
    // Enemies can break destructible barricades by pushing into them (non-Dandelion enemies)
    this.physics.add.collider(
      this.enemies,
      this.barricadesSoft,
      (e, s) => this.onEnemyHitBarricade(e, s),
      (e, s) => {
        // Heal/Laser Drones ignore soft barricade break-on-push logic
        try {
          if (e?.isHealDrone || e?.isLaserDrone) return false;
        } catch (_) {}
        // While Dandelion is dashing/assault-dashing, ignore soft barricade collision resolution here too
        try {
          if (e?.isBoss && (e.bossType === 'Dandelion' || e._bossId === 'Dandelion')) {
            const st = e._dnAssaultState || 'idle';
            const assaultDash = st === 'dashIn' || st === 'dashOut';
            const normalDash = e._dnDashState === 'dashing';
            if (assaultDash || normalDash) return false;
          }
        } catch (_) {}
        return true;
      },
      this,
    );
    // For rail bullets, skip physics separation so they don't get stuck
    this.physics.add.collider(
      this.bullets,
      this.barricadesHard,
      (b, s) => this.onBulletHitBarricade(b, s),
      // Skip generic handler for rail and caustic grenades (primary/cluster)
      (b, s) => !(b && (b._rail || b._cc || b._ccCluster)),
      this,
    );
    this.physics.add.collider(
      this.bullets,
      this.barricadesSoft,
      (b, s) => this.onBulletHitBarricade(b, s),
      (b, s) => {
        if (!b || !s) return false;
        // rail pierces; caustic handled by specialized handler
        if (b._rail || b._cc || b._ccCluster) return false;
        if (b._core === 'pierce') {
          try {
            const dmg = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 10;
            const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 20;
            const hp1 = hp0 - dmg;
            try { impactBurst(this, b.x, b.y, { color: 0xC8A165, size: 'small' }); } catch (_) {}
            if (hp1 <= 0) { try { s.destroy(); } catch (_) {} } else { s.setData('hp', hp1); }
          } catch (_) {}
          return false;
        }
        return true;
      },
      this,
    );

    // Shield hitboxes for Rook (separate from body)
    this.rookShieldGroup = this.physics.add.group();
    this.physics.add.overlap(this.bullets, this.rookShieldGroup, (b, z) => {
      try {
        if (!b?.active || !z?.active) return;
        if (b._rail) return; // rail pierces shields
        const e = z._owner; if (!e?.active || !e.isRook) return;
        const cx = z.x, cy = z.y; const r = (e._shieldRadius || 60);
        const angToBullet = Math.atan2(b.y - cy, b.x - cx);
        const shieldAng = e._shieldAngle || 0; const half = Phaser.Math.DegToRad(45);
        const diff = Math.abs(Phaser.Math.Angle.Wrap(angToBullet - shieldAng));
        if (diff <= half) {
          const dxr = b.x - cx, dyr = b.y - cy; const d2 = dxr * dxr + dyr * dyr; const r2 = r * r;
          if (d2 >= (r2 * 0.7)) {
            const hitX = cx + Math.cos(angToBullet) * r;
            const hitY = cy + Math.sin(angToBullet) * r;
            try { impactBurst(this, hitX, hitY, { color: 0xff3333, size: 'small' }); } catch (_) {}
            try { if (b.body) b.body.checkCollision.none = true; } catch (_) {}
            try { b.setActive(false).setVisible(false); } catch (_) {}
            this.time.delayedCall(0, () => { try { b.destroy(); } catch (_) {} });
          }
        }
      } catch (_) {}
    }, null, this);
    // Rook shield zone overlap disabled; blocking handled in bullets vs enemies outer-arc check

    this.physics.add.overlap(this.bullets, this.enemies, (b, e) => {
      if (!b.active || !e.active) return;
      // Caustic Cluster grenades: on contact, detonate instead of default bullet removal
      if (b._cc || b._ccCluster) {
        const ex = b.x; const ey = b.y; const r = b._blastRadius || 60; const r2 = r * r;
        try { impactBurst(this, ex, ey, { color: 0x33ff66, size: 'large', radius: r }); } catch (_) {}
        // Apply small explosive damage in radius
        try {
          const arr = this.enemies?.getChildren?.() || [];
          for (let i = 0; i < arr.length; i += 1) {
            const t = arr[i]; if (!t?.active) continue; const dx = t.x - ex; const dy = t.y - ey;
            if ((dx * dx + dy * dy) <= r2) {
              const dmg = b._aoeDamage || 5; if (t.isDummy) { this._dummyDamage = (this._dummyDamage || 0) + dmg; }
              else { if (typeof t.hp !== 'number') t.hp = t.maxHp || 20; t.hp -= dmg; if (t.hp <= 0) { this.killEnemy(t); } }
            }
          }
        } catch (_) {}
        // Spawn toxin field (6s)
        try { this.spawnToxinField(ex, ey, r, 6000, 20); } catch (_) {}
        // If primary, spawn 5 clusters
        if (b._cc) {
          const count = 5; const minD = Math.max(60, Math.floor(r * 1.2)); const maxD = Math.max(minD + 1, Math.floor(r * 2.0));
          for (let i = 0; i < count; i += 1) {
            const base = (i / count) * Math.PI * 2; const jitter = Phaser.Math.FloatBetween(-0.25, 0.25); const ang = base + jitter;
 const dist = Phaser.Math.Between(Math.max(8, Math.floor(r * 1.30)), Math.max(Math.max(8, Math.floor(r * 1.30)) + 1, Math.floor(r * 1.80))); const spd = 420; const vx2 = Math.cos(ang) * spd; const vy2 = Math.sin(ang) * spd;
            const c = this.bullets.get(ex, ey, 'bullet'); if (!c) continue;
            c.setActive(true).setVisible(true); c.setCircle(4).setOffset(-4, -4); try { c.setScale(1.1); } catch (_) {}
            c.setVelocity(vx2, vy2); c.setTint(0x33ff66); c._ccCluster = true; c._startX = ex; c._startY = ey; c._travelMax2 = dist * dist; c._blastRadius = r; c._aoeDamage = 5;
            c.update = () => {
              try {
                const mx = c.x - c._startX; const my = c.y - c._startY; const travel2 = (mx * mx) + (my * my); let collide2 = false;
                // Early detonation on enemy or barricade contact (ignore bosses for travel; they are hit by AoE)
                try {
                  const enemies2 = this.enemies?.getChildren?.() || [];
                  for (let k = 0; k < enemies2.length; k += 1) {
                    const e2 = enemies2[k]; if (!e2?.active) continue;
                    if (e2.isBoss) continue;
                    const rect2 = e2.getBounds?.() || new Phaser.Geom.Rectangle(e2.x - 6, e2.y - 6, 12, 12);
                    if (Phaser.Geom.Intersects.CircleToRectangle(new Phaser.Geom.Circle(c.x, c.y, 6), rect2)) { collide2 = true; break; }
                  }
                } catch (_) {}
                try {
                  const scanBarr = (grp) => {
                    const arr2 = grp?.getChildren?.() || [];
                    for (let k = 0; k < arr2.length && !collide2; k += 1) {
                      const s2 = arr2[k]; if (!s2?.active) continue;
                      const rectB = s2.getBounds?.() || new Phaser.Geom.Rectangle(s2.x - 8, s2.y - 8, 16, 16);
                      if (Phaser.Geom.Intersects.CircleToRectangle(new Phaser.Geom.Circle(c.x, c.y, 6), rectB)) { collide2 = true; break; }
                    }
                  };
                  scanBarr(this.barricadesHard); scanBarr(this.barricadesSoft);
                } catch (_) {}
                if ((mx * mx + my * my) >= c._travelMax2 || collide2) {
                  const cx = c.x; const cy = c.y; const rr = c._blastRadius || 60; const r2c = rr * rr;
                  try { impactBurst(this, cx, cy, { color: 0x33ff66, size: 'large', radius: rr }); } catch (_) {}
                  try { this.spawnToxinField(cx, cy, rr, 6000, 20); } catch (_) {}
                  try {
                    const arr3 = this.enemies?.getChildren?.() || [];
                    for (let m = 0; m < arr3.length; m += 1) {
                      const t2 = arr3[m]; if (!t2?.active) continue; const ddx = t2.x - cx; const ddy = t2.y - cy; if ((ddx * ddx + ddy * ddy) <= r2c) {
                        const dmg2 = c._aoeDamage || 5; if (t2.isDummy) { this._dummyDamage = (this._dummyDamage || 0) + dmg2; } else { if (typeof t2.hp !== 'number') t2.hp = t2.maxHp || 20; t2.hp -= dmg2; if (t2.hp <= 0) { this.killEnemy(t2); } }
                      }
                    }
                  } catch (_) {}
                  try { c.destroy(); } catch (_) {}
                }
              } catch (_) { try { c.destroy(); } catch (__ ) {} }
            };
          }
        }
        try { b.destroy(); } catch (_) {}
        return;
      }
      // Rook shield: block non-rail bullets (including rockets) within 90闂?front arc
      if (e.isRook && !b._rail) {
        try {
          const r = (e._shieldRadius || 60);
          const gap = 35; const off = (gap - r);
          const cx = e.x + Math.cos(e._shieldAngle || 0) * off;
          const cy = e.y + Math.sin(e._shieldAngle || 0) * off;
          const angToBullet = Math.atan2(b.y - cy, b.x - cx);
          const shieldAng = e._shieldAngle || 0;
          const diff = Math.abs(Phaser.Math.Angle.Wrap(angToBullet - shieldAng));
          const half = Phaser.Math.DegToRad(45);
          // r: using fixed shield radius above
          // Compute hit on outside arc boundary along direction from shield center to bullet
          const hitX = cx + Math.cos(angToBullet) * r;
          const hitY = cy + Math.sin(angToBullet) * r;
          // Only block if bullet is within arc sector and outside/at radius (ensures boundary hit)
          const dxr = b.x - cx, dyr = b.y - cy; const d2 = dxr * dxr + dyr * dyr;
          if (diff <= half && d2 >= (r * r * 0.9)) {
            // Spark exactly on the arc boundary
            try { impactBurst(this, hitX, hitY, { color: 0xff3333, size: 'small' }); } catch (_) {}
            // Destroy projectile without applying damage or AoE
            try { if (b._g) { b._g.destroy(); b._g = null; } } catch (_) {}
            try { if (b.body) b.body.checkCollision.none = true; } catch (_) {}
            try { b.setActive(false).setVisible(false); } catch (_) {}
            this.time.delayedCall(0, () => { try { b.destroy(); } catch (_) {} });
            return;
          }
        } catch (_) {}
      }
      // Only track per-target hits for piercing bullets to allow shotgun pellets to stack normally
      if (b._core === 'pierce') {
        if (!b._hitSet) b._hitSet = new Set();
        if (b._hitSet.has(e)) return;
        b._hitSet.add(e);
      }
      // Dummy target: accumulate damage and do not die
      if (e.isDummy) {
        const baseDmg = b.damage || 10;
        const primaryDmg = (b._core === 'blast' && !b._rocket) ? Math.ceil(baseDmg * 0.8) : baseDmg;
        this._dummyDamage = (this._dummyDamage || 0) + primaryDmg;
        // Reflect on-hit status effects in Range: build ignite/toxin values on dummy
        if (b._igniteOnHit && b._igniteOnHit > 0) {
          e._igniteValue = Math.min(10, (e._igniteValue || 0) + b._igniteOnHit);
          if ((e._igniteValue || 0) >= 10) {
            e._ignitedUntil = this.time.now + 2000;
            e._igniteValue = 0; // reset on trigger
            // Create/position ignite indicator for dummy
            if (!e._igniteIndicator) {
              e._igniteIndicator = this.add.graphics();
              try { e._igniteIndicator.setDepth(9000); } catch (_) {}
              e._igniteIndicator.fillStyle(0xff3333, 1).fillCircle(0, 0, 2);
            }
            try { e._igniteIndicator.setPosition(e.x, e.y - 14); } catch (_) {}
          }
        }
        if (b._toxinOnHit && b._toxinOnHit > 0) {
          e._toxinValue = Math.min(10, (e._toxinValue || 0) + b._toxinOnHit);
          if ((e._toxinValue || 0) >= 10) {
            e._toxinedUntil = this.time.now + 2000;
            e._toxinValue = 0; // reset on trigger
            // Create/position toxin indicator for dummy
            if (!e._toxinIndicator) {
              e._toxinIndicator = this.add.graphics();
              try { e._toxinIndicator.setDepth(9000); } catch (_) {}
              e._toxinIndicator.fillStyle(0x33ff33, 1).fillCircle(0, 0, 2);
            }
            try { e._toxinIndicator.setPosition(e.x, e.y - 18); } catch (_) {}
          }
        }
        if (b._stunOnHit && b._stunOnHit > 0) {
          const nowS = this.time.now;
          e._stunValue = Math.min(10, (e._stunValue || 0) + b._stunOnHit);
          if ((e._stunValue || 0) >= 10) {
            e._stunnedUntil = nowS + 200;
            e._stunValue = 0;
            if (!e._stunIndicator) { e._stunIndicator = this.add.graphics(); try { e._stunIndicator.setDepth(9000); } catch (_) {} e._stunIndicator.fillStyle(0xffff33, 1).fillCircle(0, 0, 2); }
            try { e._stunIndicator.setPosition(e.x, e.y - 22); } catch (_) {}
          }
        }
      } else {
        if (typeof e.hp !== 'number') e.hp = e.maxHp || 20;
        // Apply damage (Explosive Core reduces primary to 80%; explosive projectiles keep 100%)
        {
          let baseDmg = b.damage || 10;
          if (b._vulcan && e.isBoss) baseDmg = 1;
          const primaryDmg = (b._core === 'blast' && !b._rocket) ? Math.ceil(baseDmg * 0.8) : baseDmg;
          if (primaryDmg > 0) e.hp -= primaryDmg;
        }
        // Brief per-enemy hit feedback: flash sprite + small directional spark at impact
        try {
          this._flashEnemyHit(e);
          // Small spark burst at the bullet impact point
          try {
            pixelSparks(this, b.x, b.y, {
              angleRad: Math.atan2(b.body?.velocity?.y || 0, b.body?.velocity?.x || 1),
              count: 4,
              spreadDeg: 40,
              speedMin: 220,
              speedMax: 360,
              lifeMs: 160,
              color: 0xffffcc,
              size: 2,
              alpha: 0.9,
            });
          } catch (_) {}
        } catch (_) {}
        // Apply ignite buildup from special cores (e.g., Rifle Incendiary)
        if (b._igniteOnHit && b._igniteOnHit > 0 && !(b._vulcan && e.isBoss)) {
          const add = b._igniteOnHit;
          e._igniteValue = Math.min(10, (e._igniteValue || 0) + add);
          if ((e._igniteValue || 0) >= 10) {
            const nowT = this.time.now;
            e._ignitedUntil = nowT + 2000;
            e._igniteValue = 0; // reset on trigger
            if (!e._igniteIndicator) {
              e._igniteIndicator = this.add.graphics();
              try { e._igniteIndicator.setDepth(9000); } catch (_) {}
              e._igniteIndicator.fillStyle(0xff3333, 1).fillCircle(0, 0, 2);
            }
            try { e._igniteIndicator.setPosition(e.x, e.y - 14); } catch (_) {}
          }
        }
        // Apply toxin buildup from special cores (e.g., SMG Toxic Rounds)
        if (b._toxinOnHit && b._toxinOnHit > 0 && !(b._vulcan && e.isBoss)) {
          const addT = b._toxinOnHit;
          e._toxinValue = Math.min(10, (e._toxinValue || 0) + addT);
          if ((e._toxinValue || 0) >= 10) {
            const nowT = this.time.now;
            e._toxinedUntil = nowT + 2000;
            e._toxinValue = 0; // reset on trigger
            if (!e._toxinIndicator) {
              e._toxinIndicator = this.add.graphics();
              try { e._toxinIndicator.setDepth(9000); } catch (_) {}
              e._toxinIndicator.fillStyle(0x33ff33, 1).fillCircle(0, 0, 2);
            }
            try { e._toxinIndicator.setPosition(e.x, e.y - 18); } catch (_) {}
          }
        }
        // Apply stun buildup from stun ammunition (normal enemies)
        if (b._stunOnHit && b._stunOnHit > 0 && !(b._vulcan && e.isBoss)) {
          const nowS = this.time.now;
          e._stunValue = Math.min(10, (e._stunValue || 0) + b._stunOnHit);
          if ((e._stunValue || 0) >= 10) {
            e._stunnedUntil = nowS + 200;
            e._stunValue = 0;
            if (!e._stunIndicator) { e._stunIndicator = this.add.graphics(); try { e._stunIndicator.setDepth(9000); } catch (_) {} e._stunIndicator.fillStyle(0xffff33, 1).fillCircle(0, 0, 2); }
            try { e._stunIndicator.setPosition(e.x, e.y - 22); } catch (_) {}
          }
        }
      }
      // Visual impact effect by core type (small unless blast)
      try {
        const core = b._core || null;
        if (core === 'blast') {
          const radius = b._blastRadius || 20;
          impactBurst(this, b.x, b.y, { color: 0xffaa33, size: 'large', radius });
        } else if (core === 'pierce') impactBurst(this, b.x, b.y, { color: 0x66aaff, size: 'small' });
        else impactBurst(this, b.x, b.y, { color: 0xffffff, size: 'small' });
      } catch (_) {}
      // Apply blast splash before removing the bullet
      if (b._core === 'blast') {
        const radius = b._blastRadius || 20;
        this.enemies.getChildren().forEach((other) => {
          if (!other.active) return;
          const isPrimary = (other === e);
          if (isPrimary && !b._rocket) return; // do not double-hit primary for core-only blasts
          const dx = other.x - b.x; const dy = other.y - b.y;
          if (dx * dx + dy * dy <= radius * radius) {
            const splashDmg = b._rocket ? (b._aoeDamage || b.damage || 10) : Math.ceil((b.damage || 10) * 0.5);
            if (other.isDummy) {
              this._dummyDamage = (this._dummyDamage || 0) + splashDmg;
            } else {
              if (typeof other.hp !== 'number') other.hp = other.maxHp || 20;
              other.hp -= splashDmg;
              try { this._flashEnemyHit(other); } catch (_) {}
              if (other.hp <= 0) { this.killEnemy(other); }
            }
          }
        });
        // Splash to barricades now 100%
        this.damageSoftBarricadesInRadius(b.x, b.y, radius, (b.damage || 10));
        // Cluster Bomb: emit 8 bomblets on enemy impact
        if (b._rocket && b._clusterBomb) {
          const ex = b.x; const ey = b.y;
          const spawnedOnBoss = !!(e && e.isBoss);
          const count = 8; const minD = Math.max(60, Math.floor(radius * 1.2)); const maxD = Math.max(minD + 1, Math.floor(radius * 2.0));
          for (let i = 0; i < count; i += 1) {
            const base = (i / count) * Math.PI * 2; const jitter = Phaser.Math.FloatBetween(-0.25, 0.25);
            const ang = base + jitter;
 const dist = Phaser.Math.Between(Math.max(8, Math.floor(radius * 0.60)), Math.max(Math.max(8, Math.floor(radius * 0.60)) + 1, Math.floor(radius * 1.30))); const spd = 420; const vx2 = Math.cos(ang) * spd; const vy2 = Math.sin(ang) * spd;
            const c = this.bullets.get(ex, ey, 'bullet'); if (!c) continue;
            c.setActive(true).setVisible(true); c.setCircle(4).setOffset(-4, -4); try { c.setScale(1.1); } catch (_) {}
            c.setVelocity(vx2, vy2); c.setTint(0xffaa33); c._clusterChild = true; c._startX = ex; c._startY = ey; c._travelMax2 = dist * dist; c._blastRadius = 52; c._aoeDamage = 20; c._ignoreBossForTravel = spawnedOnBoss;
            c.update = () => {
              try {
                const mx = c.x - c._startX; const my = c.y - c._startY; const travel2 = (mx * mx) + (my * my); let collide2 = false;
                try {
                  const enemies2 = this.enemies?.getChildren?.() || [];
                  for (let k = 0; k < enemies2.length; k += 1) {
                    const e2 = enemies2[k]; if (!e2?.active) continue;
                    if (e2.isBoss && c._ignoreBossForTravel) continue;
                    let rect2;
                    if (e2.isBoss) {
                      try {
                        const hb2 = (e2._hitbox && e2._hitbox.body) ? e2._hitbox.body : e2.body;
                        const w2 = Math.max(1, Math.floor((hb2 && hb2.width) ? hb2.width : 36));
                        const h2 = Math.max(1, Math.floor((hb2 && hb2.height) ? hb2.height : 36));
                        rect2 = new Phaser.Geom.Rectangle(Math.floor(e2.x - w2 / 2), Math.floor(e2.y - h2 / 2), w2, h2);
                      } catch (_) {
                        rect2 = new Phaser.Geom.Rectangle(e2.x - 18, e2.y - 18, 36, 36);
                      }
                    } else {
                      rect2 = e2.getBounds?.() || new Phaser.Geom.Rectangle(e2.x - 6, e2.y - 6, 12, 12);
                    }
                    if (Phaser.Geom.Intersects.CircleToRectangle(new Phaser.Geom.Circle(c.x, c.y, 6), rect2)) { collide2 = true; break; }
                  }
                } catch (_) {}
                try { const scanBarr = (grp) => { const arr2 = grp?.getChildren?.() || []; for (let k = 0; k < arr2.length && !collide2; k += 1) { const s2 = arr2[k]; if (!s2?.active) continue; const rectB = s2.getBounds?.() || new Phaser.Geom.Rectangle(s2.x - 8, s2.y - 8, 16, 16); if (Phaser.Geom.Intersects.CircleToRectangle(new Phaser.Geom.Circle(c.x, c.y, 6), rectB)) { collide2 = true; break; } } }; scanBarr(this.barricadesHard); scanBarr(this.barricadesSoft); } catch (_) {}
                if (travel2 >= c._travelMax2 || collide2) {
                  const cx = c.x; const cy = c.y; const rr = c._blastRadius || 60; const r2c = rr * rr;
                  try { impactBurst(this, cx, cy, { color: 0xffaa33, size: 'large', radius: rr }); } catch (_) {}
                  try { const list = this.enemies?.getChildren?.() || []; for (let m = 0; m < list.length; m += 1) { const t = list[m]; if (!t?.active) continue; const ddx = t.x - cx; const ddy = t.y - cy; if ((ddx * ddx + ddy * ddy) <= r2c) { const dmg2 = c._aoeDamage || 20; if (t.isDummy) { this._dummyDamage = (this._dummyDamage || 0) + dmg2; } else { if (typeof t.hp !== 'number') t.hp = t.maxHp || 20; t.hp -= dmg2; if (t.hp <= 0) { this.killEnemy(t); } } } } } catch (_) {}
                  try { c.destroy(); } catch (_) {}
                }
              } catch (_) { try { c.destroy(); } catch (__ ) {} }
            };
          }
        }
        // Drop fire field on any explosive detonation, not just when reaching target
        try {
          if (b._firefield) {
            this.spawnFireField(b.x, b.y, radius);
            // Napalm: apply immediate ignite buildup (+5) to enemies in radius
            const r2 = radius * radius; const nowT = this.time.now;
            this.enemies.getChildren().forEach((other) => {
              if (!other?.active || other.isDummy) return;
              const dx2 = other.x - b.x; const dy2 = other.y - b.y;
              if ((dx2 * dx2 + dy2 * dy2) <= r2) {
                other._igniteValue = Math.min(10, (other._igniteValue || 0) + 5);
                if ((other._igniteValue || 0) >= 10) {
                  other._ignitedUntil = nowT + 2000; other._igniteValue = 0;
                  if (!other._igniteIndicator) { other._igniteIndicator = this.add.graphics(); try { other._igniteIndicator.setDepth(9000); } catch (_) {} other._igniteIndicator.fillStyle(0xff3333, 1).fillCircle(0, 0, 2); }
                  try { other._igniteIndicator.setPosition(other.x, other.y - 14); } catch (_) {}
                }
              }
            });
          }
        } catch (_) {}
      }
      // Handle pierce core: allow one extra target without removing the bullet
      if (b._core === 'pierce' && (b._pierceLeft || 0) > 0) {
        b._pierceLeft -= 1;
      } else {
        // Defer removal to end of tick to avoid skipping other overlaps this frame
        try { if (b._g) { b._g.destroy(); b._g = null; } } catch (_) {}
        try { if (b.body) b.body.checkCollision.none = true; } catch (_) {}
        try { b.setActive(false).setVisible(false); } catch (_) {}
        this.time.delayedCall(0, () => { try { b.destroy(); } catch (_) {} });
      }
      // Check primary enemy death after damage
      if (e.hp <= 0) { this.killEnemy(e); }
    });

    const overlapPlayerRef = this.playerCollider || this.player;
    this.physics.add.overlap(overlapPlayerRef, this.enemies, (p, e) => {
      // Touching enemies (including bosses/elites) no longer deals damage;
      // all enemy damage must come from explicit attacks (bullets, grenades, beams, melee cones, etc.).
      return;
    });

    // Enemy bullets (for shooters)
    this.enemyBullets = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Image,
      maxSize: 64,
      runChildUpdate: true,
    });
    // Enemy grenades (for elite Grenadiers)
    this.enemyGrenades = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Image,
      maxSize: 24,
      runChildUpdate: true,
    });
    // Boss bombardment bombs (Bigwig ability) - independent of barricades
    this.bossBombs = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Image,
      maxSize: 32,
      runChildUpdate: true,
    });
    // Grenades collide with barricades (respect cover)
    this.physics.add.collider(this.enemyGrenades, this.barricadesHard, (b, s) => this.onEnemyGrenadeHitBarricade(b, s));
    this.physics.add.collider(this.enemyGrenades, this.barricadesSoft, (b, s) => this.onEnemyGrenadeHitBarricade(b, s));
    this.physics.add.overlap(overlapPlayerRef, this.enemyBullets, (p, b) => {
      if (this._directionalShieldBlocksProjectile(b)) {
        this._directionalShieldAbsorb(b.damage || 8);
        try { impactBurst(this, b.x, b.y, { color: 0xffee66, size: 'small' }); } catch (_) {}
        try { b.destroy(); } catch (_) {}
        return;
      }
      const inIframes = this.time.now < this.player.iframesUntil;
      if (b?._rocket) {
        // Rocket: explode on contact, apply AoE to player
      const ex = b.x; const ey = b.y; const radius = b._blastRadius || 70; const r2 = radius * radius;
        const pdx = this.player.x - ex; const pdy = this.player.y - ey;
        if ((pdx * pdx + pdy * pdy) <= r2 && !inIframes) {
          let dmg = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 12; try { const eff = getPlayerEffects(this.gs) || {}; const mul = eff.enemyExplosionDmgMul || 1; dmg = Math.ceil(dmg * mul); } catch (_) {} this.applyPlayerDamage(dmg);
          // Short i-frames vs explosive rockets
          this.player.iframesUntil = this.time.now + 50;
          if (this.gs.hp <= 0) {
            const eff = getPlayerEffects(this.gs);
            this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
            this.gs.nextScene = SceneKeys.Hub;
            SaveManager.saveToLocal(this.gs);
            this.scene.start(SceneKeys.Hub);
          }
        }
        try { impactBurst(this, ex, ey, { color: 0xff3333, size: 'large', radius }); } catch (_) {}
        // Chip nearby destructible barricades
        this.damageSoftBarricadesInRadius(ex, ey, radius, (b.damage || 12));
        try {
          try { b._hzTrailG?.destroy(); } catch (_) {}
          b.destroy();
        } catch (_) {}
        return;
      }
      const gs = this.gs;
      const beforeHp = gs ? (gs.hp | 0) : 0;
      const beforeShield = gs ? Math.max(0, (gs.shield | 0)) : 0;
      if (!inIframes) {
        const dmg = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 8; // default shooter damage
        this.applyPlayerDamage(dmg);
        // Short i-frames vs enemy bullets
        this.player.iframesUntil = this.time.now + 50;
        if (this.gs.hp <= 0) {
          const eff = getPlayerEffects(this.gs);
          this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
          this.gs.nextScene = SceneKeys.Hub;
          SaveManager.saveToLocal(this.gs);
          this.scene.start(SceneKeys.Hub);
        }
      }
      // Visual hit feedback should appear even during i-frames
      try { this._flashPlayerHitFromBullet(b); } catch (_) {}
      // Only spawn impact particles when the hit actually reaches HP
      try {
        let shieldBlocked = false;
        if (gs) {
          const afterHp = gs.hp | 0;
          const afterShield = Math.max(0, (gs.shield | 0));
          shieldBlocked = (beforeShield > 0 && afterHp === beforeHp && afterShield < beforeShield);
        }
        if (!shieldBlocked) this._spawnEnemyBulletHitPlayerVfx(b);
      } catch (_) {}
      // Always destroy enemy bullet on contact, even during i-frames
      try {
        try { b._hzTrailG?.destroy(); } catch (_) {}
        b.destroy();
      } catch (_) {}
    });
    // Mirror overlap for invisible player hitbox (guard creation to avoid undefined references)
    if (this.playerHitbox && this.enemyBullets) this.physics.add.overlap(this.playerHitbox, this.enemyBullets, (_hb, b) => {
      if (this._directionalShieldBlocksProjectile(b)) {
        this._directionalShieldAbsorb(b.damage || 8);
        try { impactBurst(this, b.x, b.y, { color: 0xffee66, size: 'small' }); } catch (_) {}
        try { b.destroy(); } catch (_) {}
        return;
      }
      const inIframes = this.time.now < this.player.iframesUntil;
      if (b?._rocket) {
        const ex = b.x; const ey = b.y; const radius = b._blastRadius || 70; const r2 = radius * radius;
        const pdx = this.player.x - ex; const pdy = this.player.y - ey;
        if ((pdx * pdx + pdy * pdy) <= r2 && !inIframes) {
          let dmg = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 12; try { const eff = getPlayerEffects(this.gs) || {}; const mul = eff.enemyExplosionDmgMul || 1; dmg = Math.ceil(dmg * mul); } catch (_) {} this.applyPlayerDamage(dmg);
          // Short i-frames vs explosive rockets
          this.player.iframesUntil = this.time.now + 50;
          if (this.gs.hp <= 0) {
            const eff = getPlayerEffects(this.gs);
            this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
            this.gs.nextScene = SceneKeys.Hub;
            SaveManager.saveToLocal(this.gs);
            this.scene.start(SceneKeys.Hub);
          }
        }
        try { impactBurst(this, ex, ey, { color: 0xff3333, size: 'large', radius }); } catch (_) {}
        this.damageSoftBarricadesInRadius(ex, ey, radius, (b.damage || 12));
        try { b.destroy(); } catch (_) {}
        return;
      }
      const gs = this.gs;
      const beforeHp = gs ? (gs.hp | 0) : 0;
      const beforeShield = gs ? Math.max(0, (gs.shield | 0)) : 0;
      if (!inIframes) {
        const dmg = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 8;
        this.applyPlayerDamage(dmg);
        // Short i-frames vs enemy bullets
        this.player.iframesUntil = this.time.now + 50;
        if (this.gs.hp <= 0) {
          const eff = getPlayerEffects(this.gs);
          this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
          this.gs.nextScene = SceneKeys.Hub;
          SaveManager.saveToLocal(this.gs);
          this.scene.start(SceneKeys.Hub);
        }
      }
      // Visual hit feedback should appear even during i-frames
      try { this._flashPlayerHitFromBullet(b); } catch (_) {}
      // Only spawn impact particles when the hit actually reaches HP
      try {
        let shieldBlocked = false;
        if (gs) {
          const afterHp = gs.hp | 0;
          const afterShield = Math.max(0, (gs.shield | 0));
          shieldBlocked = (beforeShield > 0 && afterHp === beforeHp && afterShield < beforeShield);
        }
        if (!shieldBlocked) this._spawnEnemyBulletHitPlayerVfx(b);
      } catch (_) {}
      try {
        try { b._hzTrailG?.destroy(); } catch (_) {}
        b.destroy();
      } catch (_) {}
    });
    // Enemy bullets blocked by barricades as well
    this.physics.add.collider(this.enemyBullets, this.barricadesHard, (b, s) => this.onEnemyBulletHitBarricade(b, s));
    this.physics.add.collider(this.enemyBullets, this.barricadesSoft, (b, s) => this.onEnemyBulletHitBarricade(b, s));
    // Player bullets vs hard barricades: use overlap so railgun shots can pierce without being physically stopped.
    this.physics.add.overlap(this.bullets, this.barricadesHard, (b, s) => this.onPlayerBulletHitBarricade(b, s));
    this.physics.add.overlap(this.bullets, this.barricadesSoft, (b, s) => {
      if (!b || !s) return;
      // Special caustic projectiles handled elsewhere
      if (b._cc || b._ccCluster) return;
      const isPierce = b._core === 'pierce';
      if (isPierce) {
        // Damage this soft barricade once, but let the bullet continue through
        try {
          if (!b._softHitSet) b._softHitSet = new Set();
          if (b._softHitSet.has(s)) return;
          b._softHitSet.add(s);
          const dmg = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 10;
          const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 20;
          const hp1 = hp0 - dmg;
          try { impactBurst(this, b.x, b.y, { color: 0xC8A165, size: 'small' }); } catch (_) {}
          if (hp1 <= 0) { try { s.destroy(); } catch (_) {} } else { s.setData('hp', hp1); }
        } catch (_) {}
        return;
      }
      // Non-piercing bullets: behave like normal barricade hits (block + damage)
      try { this.onPlayerBulletHitBarricade(b, s); } catch (_) {}
    });

    // Exit appears when all enemies dead
    this.exitActive = false;
    this.exitG = this.add.graphics();
    // Clear any previous exit sprite between rooms (e.g., DeepDive)
    try {
      if (this.exitSprite) {
        this.exitSprite.destroy();
        this.exitSprite = null;
      }
    } catch (_) {}
    // In-game prompt; hide default hint in boss rooms
    const defaultPrompt = this._isBossRoom ? '' : 'Clear enemies';
    this.prompt = this.add.text(width / 2, 40, defaultPrompt, { fontFamily: 'monospace', fontSize: 14, color: '#ffffff' }).setOrigin(0.5);
    // Keybinds hint (bottom-right, small font)
    const binds = [
  'W/A/S/D: Move',
  'Space: Dash',
  'E: Interact',
  'C: Melee',
  'LMB: Shoot',
  'F: Ability',
  'Q: Swap Weapon',
  'Tab: Loadout',
].join('\n');

    this.add.text(width - 10, height - 10, binds, { fontFamily: 'monospace', fontSize: 12, color: '#cccccc' })
      .setOrigin(1, 1)
      .setAlpha(0.9);

    // Init nav state for enemy pathfinding
    this._nav = { grid: null, builtAt: 0 };
    // Ability system state (cooldown etc.)
    this._gadgets = [];
    this.ability = { onCooldownUntil: 0 };
    this._stealth = { active: false, until: 0, decoy: null };
    this._energySiphon = { active: false, until: 0, ratio: 0.25, killHeal: 5, trackedHp: new Map(), nextAmbientAt: 0 };
    this._siphonPackets = [];
    this._bulletCasings = [];
    this._dirShield = { active: false, hp: 0, maxHp: 1000, decayPerSec: 100, g: null, breakG: null };
    this._vulcanTurrets = [];
    
  }

  _explodeHazelMissile(m) {
    if (!m || !m.active || m._hzExploded) return;
    m._hzExploded = true;
    const ex = m.x; const ey = m.y;
    const radius = 40;
    // Explosion VFX (purple tone)
    try { impactBurst(this, ex, ey, { color: 0xaa66ff, size: 'large', radius }); } catch (_) {}
    // Damage player within radius (no enemy damage; only player + soft barricades)
    try {
      const r2 = radius * radius;
      const pdx = this.player.x - ex; const pdy = this.player.y - ey;
      if ((pdx * pdx + pdy * pdy) <= r2) {
        let dmg = 20;
        try {
          const mods = this.gs?.getDifficultyMods?.() || {};
          const mul = (typeof mods.enemyDamage === 'number') ? mods.enemyDamage : 1;
          dmg = Math.max(1, Math.round(20 * mul));
        } catch (_) {}
        const now = this.time.now;
        if (now >= (this.player.iframesUntil || 0)) {
          try {
            let finalDmg = dmg;
            try {
              const eff = getPlayerEffects(this.gs) || {};
              const mul2 = eff.enemyExplosionDmgMul || 1;
              finalDmg = Math.ceil(finalDmg * mul2);
            } catch (_) {}
            this.applyPlayerDamage(finalDmg);
          } catch (_) {}
          // Short i-frames vs Hazel missiles (explosives)
          this.player.iframesUntil = now + 50;
          if (this.gs && this.gs.hp <= 0) {
            try {
              const eff = getPlayerEffects(this.gs);
              this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
              this.gs.nextScene = SceneKeys.Hub;
              SaveManager.saveToLocal(this.gs);
              this.scene.start(SceneKeys.Hub);
            } catch (_) {}
          }
        }
      }
    } catch (_) {}
    // Also damage soft (destructible) barricades in radius
    try {
      this.damageSoftBarricadesInRadius(ex, ey, radius, 30);
    } catch (_) {}
    // Cleanup visuals and destroy missile
    try { m._vis?.destroy(); } catch (_) {}
    try { m._trailG?.destroy(); } catch (_) {}
    try { m.destroy(); } catch (_) {}
  }

  _spawnHazelMissile(boss) {
    if (!this.enemies) return;
    const m = this.physics.add.sprite(boss.x, boss.y, 'bullet');
    // Spawn at a random position in a small ring around Hazel (360闂?
    try {
      const ang = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const dist = Phaser.Math.Between(10, 26);
      m.setPosition(boss.x + Math.cos(ang) * dist, boss.y + Math.sin(ang) * dist);
    } catch (_) {}
    m.setActive(true).setVisible(true);
    m.setCircle(4).setOffset(-4, -4); // 8x8 hitbox
    try { m.setTint(0xaa66ff); m.setScale(2); } catch (_) {} // visually match 8x8
    m.hp = 20;
    m.maxHp = 20;
    m.isEnemy = true;
    m.isHazelMissile = true;
    const now = this.time.now;
    m._hzSpawnAt = now;
    // Initial facing is random; missile will fly straight along this angle for a short time before homing
    m._angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    m._hzStraightUntil = now + 300; // ms of straight travel before enabling turn
    m._speed = 230; // px/s
    m._maxTurn = Phaser.Math.DegToRad(2); // further reduced turn rate (~2闂?frame baseline, time-scaled)
    this.enemies.add(m);
    // Purple guided-missile-style tracer
    try {
      const trail = this.add.graphics();
      try { trail.setDepth(8790); trail.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
      m._trailG = trail;
    } catch (_) {}
    // Collide with barricades: explode on impact
    try {
      if (this.barricadesHard) {
        this.physics.add.collider(m, this.barricadesHard, (missile, s) => { this._explodeHazelMissile(missile); });
      }
      if (this.barricadesSoft) {
        this.physics.add.collider(m, this.barricadesSoft, (missile, s) => { this._explodeHazelMissile(missile); });
      }
    } catch (_) {}
  }

  // Helper: destroy a support enemy (turret/drone) without drops, but with standard death VFX
  _destroySupportEnemy(e) {
    if (!e) return;
    try { spawnDeathVfxForEnemy(this, e); } catch (_) {}
    try { e.destroy(); } catch (_) {}
  }

  // Centralized enemy death handler to keep removal tied to HP system
  killEnemy(e) {
    // Hazel missiles: custom explosion and no drops
    try {
      if (e?.isHazelMissile) {
        this._explodeHazelMissile(e);
        return;
      }
      // Dandelion mines: explode via custom handler when destroyed by player
      if (e?.isDnMine) {
        try { e._explodeFn?.(e); } catch (_) {}
        return;
      }
    } catch (_) {}
    // Dandelion special aim line: ensure it's cleared if Dandelion dies via any damage source
    try {
      if (e?.isBoss && (e.bossType === 'Dandelion' || e._bossId === 'Dandelion')) {
        if (e._dnAimG) { e._dnAimG.clear(); e._dnAimG.destroy(); e._dnAimG = null; }
      }
    } catch (_) {}
    if (!e || !e.active) return;
    try {
      // Ensure HP reflects death for any downstream logic
      if (typeof e.hp === 'number' && e.hp > 0) e.hp = 0;
    } catch (_) {}
    // Energy Siphon: heal on enemy death while effect is active
    try {
      const siphon = this._energySiphon;
      if (siphon?.active && this.time.now < (siphon.until || 0) && !e.isDummy) {
        try { this._spawnSiphonTrace(e.x, e.y, 30, true); } catch (_) {}
        const eff = getPlayerEffects(this.gs) || {};
        const maxHp = Math.max(1, (this.gs?.maxHp || 0) + (eff.bonusHp || 0));
        this.gs.hp = Math.min(maxHp, (this.gs?.hp || 0) + (siphon.killHeal || 5));
      }
    } catch (_) {}
    try { if (e._igniteIndicator) { e._igniteIndicator.destroy(); e._igniteIndicator = null; } } catch (_) {}
    try { if (e._toxinIndicator) { e._toxinIndicator.destroy(); e._toxinIndicator = null; } } catch (_) {}
    try { if (e._stunIndicator) { e._stunIndicator.destroy(); e._stunIndicator = null; } } catch (_) {}
    // When any boss dies, clear all support enemies (turrets, HealDrones, LaserDrones) with death VFX
    try {
      if (e.isBoss) {
        let found = true;
        while (found) {
          found = false;
          const arr = this.enemies?.getChildren?.() || [];
          for (let i = 0; i < arr.length; i += 1) {
            const d = arr[i];
            if (!d?.active) continue;
            if (d.isTurret || d.isHealDrone || d.isLaserDrone) {
              try { this._destroySupportEnemy(d); } catch (_) {}
              found = true;
            }
          }
        }
      }
    } catch (_) {}
    // Bigwig: destroy all active turrets on boss death so player does not have to clear them
    try {
      if (e.isBoss && (e.bossType === 'Bigwig' || e._bossId === 'Bigwig')) {
        let found = true;
        while (found) {
          found = false;
          const arr = this.enemies?.getChildren?.() || [];
          for (let i = 0; i < arr.length; i += 1) {
            const t = arr[i];
            if (!t?.active || !t.isTurret) continue;
            try { this._destroySupportEnemy(t); } catch (_) {}
            found = true;
          }
        }
      }
    } catch (_) {}
    // Grenadier: explode on death
    try {
      if (e.isGrenadier && !e._exploded) {
        const ex = e.x; const ey = e.y; const radius = (e.explosionRadius || 60); // visual matches damage AoE
        try { impactBurst(this, ex, ey, { color: 0xff3333, size: 'large', radius }); } catch (_) {}
        // Damage player if within radius
        const r2 = radius * radius; const pdx = this.player.x - ex; const pdy = this.player.y - ey;
        if ((pdx * pdx + pdy * pdy) <= r2) {
          const now = this.time.now;
          if (now >= (this.player.iframesUntil || 0)) {
            // Grenadier death explosion: fixed 15 base damage (scaled by difficulty + explosion mul)
            let dmg = 15;
            try {
              const mods = this.gs?.getDifficultyMods?.() || {};
              const mulD = (typeof mods.enemyDamage === 'number') ? mods.enemyDamage : 1;
              dmg = Math.max(1, Math.round(15 * mulD));
            } catch (_) {}
            try {
              const eff = getPlayerEffects(this.gs) || {};
              const mul = eff.enemyExplosionDmgMul || 1;
              dmg = Math.ceil(dmg * mul);
            } catch (_) {}
            this.applyPlayerDamage(dmg);
            // Short i-frames vs Grenadier death explosion
            this.player.iframesUntil = now + 50;
            if (this.gs.hp <= 0) {
              const eff = getPlayerEffects(this.gs);
              this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
              this.gs.nextScene = SceneKeys.Hub;
              SaveManager.saveToLocal(this.gs);
              this.scene.start(SceneKeys.Hub);
            }
          }
        }
        // Also chip destructible barricades
        this.damageSoftBarricadesInRadius(ex, ey, radius, (e.damage || 10));
        e._exploded = true;
      }
    } catch (_) {}
    // Reward resources on kill (normal vs elite)
    try {
      if (!e.isDummy) {
        const ui = (() => { try { return this.scene.get(SceneKeys.UI); } catch (_) { return null; } })();
        const isElite = !!(e.isPrism || e.isSnitch || e.isRook || e.isGrenadier);
        const goldGain = isElite ? 20 : 10;
        this.gs.gold = (this.gs.gold || 0) + goldGain;
        if (ui?.showResourceHint) ui.showResourceHint(`+${goldGain} Gold`);
        const roll = Phaser.Math.Between(1, 100);
        const chance = isElite ? 50 : 10;
        if (roll <= chance) {
          this.gs.droneCores = (this.gs.droneCores || 0) + 1;
          if (ui?.showResourceHint) ui.showResourceHint(`+1 Drone Core`);
        }
      }
    } catch (_) {}
      // If Dandelion died, destroy all remaining Dandelion mines so the arena can clear
      try {
        if (e?.isBoss && (e.bossType === 'Dandelion' || e._bossId === 'Dandelion')) {
          if (this._dnMines && this._dnMines.length) {
            for (let i = 0; i < this._dnMines.length; i += 1) {
              const m = this._dnMines[i];
              if (!m) continue;
              try { m._g?.destroy?.(); } catch (_) {}
              try { m.destroy?.(); } catch (_) {}
            }
          }
          this._dnMines = [];
        }
      } catch (_) {}
      // If Hazel died, destroy any remaining Laser Drones it spawned
      try {
        if (e?.isBoss && (e.bossType === 'Hazel' || e._bossId === 'Hazel')) {
          const arr = this.enemies?.getChildren?.() || [];
          for (let i = 0; i < arr.length; i += 1) {
            const d = arr[i];
            if (!d?.active || !d.isLaserDrone) continue;
            try { this._destroySupportEnemy(d); } catch (_) {}
          }
        }
      } catch (_) {}
    // Death VFX (purely visual)
    try { spawnDeathVfxForEnemy(this, e); } catch (_) {}
    // Destroy the enemy sprite
    try { e.destroy(); } catch (_) {}
  }

  _spawnHazelPulse(x, y) {
    if (!this._hzPulses) this._hzPulses = [];
    const g = this.add.graphics({ x, y });
    try { g.setDepth(9000); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
    const pulse = { x, y, r: 0, maxR: 260, band: 22, speed: 260, g, atMaxSince: null };
    this._hzPulses.push(pulse);
  }

  _hazelTeleportAway(e) {
    try {
      const rect = this.arenaRect || new Phaser.Geom.Rectangle(16, 16, this.scale.width - 32, this.scale.height - 32);
      const px = this.player.x; const py = this.player.y;
      let tx = e.x; let ty = e.y;
      let found = false;
      const minDist = 360;
      for (let i = 0; i < 18; i += 1) {
        let candX = Phaser.Math.Between(rect.left + 24, rect.right - 24);
        let candY = Phaser.Math.Between(rect.top + 24, rect.bottom - 24);
        const dxp = candX - px; const dyp = candY - py;
        const d = Math.hypot(dxp, dyp) || 0;
        if (d >= minDist) { tx = candX; ty = candY; found = true; break; }
      }
      if (!found) {
        const dx0 = e.x - px; const dy0 = e.y - py;
        const len0 = Math.hypot(dx0, dy0) || 1;
        const ux = -dx0 / len0; const uy = -dy0 / len0;
        const r = minDist;
        tx = px + ux * r; ty = py + uy * r;
        tx = Phaser.Math.Clamp(tx, rect.left + 24, rect.right - 24);
        ty = Phaser.Math.Clamp(ty, rect.top + 24, rect.bottom - 24);
      }
      try {
        if (e.body && e.body.reset) e.body.reset(tx, ty);
        else e.setPosition(tx, ty);
      } catch (_) {
        try { e.setPosition(tx, ty); } catch (_) {}
      }
      e.x = tx; e.y = ty;
      try { e.body?.setVelocity?.(0, 0); } catch (_) { try { e.setVelocity(0, 0); } catch (_) {} }
      try { this._spawnHazelPulse(tx, ty); } catch (_) {}
      // Spawn two LaserDrones to Hazel's left and right after each teleport (generic Hazel-style teleport VFX)
      try {
        const offset = 48;
        const spots = [
          { x: tx - offset, y: ty },
          { x: tx + offset, y: ty },
        ];
        for (let i = 0; i < spots.length; i += 1) {
          const sx = Phaser.Math.Clamp(spots[i].x, rect.left + 24, rect.right - 24);
          const sy = Phaser.Math.Clamp(spots[i].y, rect.top + 24, rect.bottom - 24);
          teleportSpawnVfx(this, sx, sy, {
            color: 0xaa66ff,
            onSpawn: () => {
              try {
                const d = createLaserDroneEnemy(this, sx, sy, 20, e);
                if (d) this.enemies.add(d);
              } catch (_) {}
            },
          });
        }
      } catch (_) {}
    } catch (_) {}
  }

  _spawnHazelPhaseBomb(x, y) {
    if (!this._hzPhaseBombs) this._hzPhaseBombs = [];
    const g = this.add.graphics({ x, y });
    try { g.setDepth(9000); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
    const bomb = { x, y, spawnedAt: this.time.now, g };
    this._hzPhaseBombs.push(bomb);
  }

  _explodeHazelPhaseBomb(bomb) {
    if (!bomb) return;
    const ex = bomb.x; const ey = bomb.y;
    const radius = 70;
    // Visual explosion
    try { impactBurst(this, ex, ey, { color: 0xaa66ff, size: 'large', radius }); } catch (_) {}
    // Damage only the player within radius
    try {
      const r2 = radius * radius;
      const pdx = this.player.x - ex; const pdy = this.player.y - ey;
      if ((pdx * pdx + pdy * pdy) <= r2) {
        let dmg = 30;
        try {
          const mods = this.gs?.getDifficultyMods?.() || {};
          const mul = (typeof mods.enemyDamage === 'number') ? mods.enemyDamage : 1;
          dmg = Math.max(1, Math.round(30 * mul));
        } catch (_) {}
        const now = this.time.now;
        if (now >= (this.player.iframesUntil || 0)) {
          try {
            let finalDmg = dmg;
            try {
              const eff = getPlayerEffects(this.gs) || {};
              const mul2 = eff.enemyExplosionDmgMul || 1;
              finalDmg = Math.ceil(finalDmg * mul2);
            } catch (_) {}
            this.applyPlayerDamage(finalDmg);
          } catch (_) {}
          // Short i-frames vs Hazel Phase Bomb explosions
          this.player.iframesUntil = now + 50;
          if (this.gs && this.gs.hp <= 0) {
            try {
              const eff = getPlayerEffects(this.gs);
              this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
              this.gs.nextScene = SceneKeys.Hub;
              SaveManager.saveToLocal(this.gs);
              this.scene.start(SceneKeys.Hub);
            } catch (_) {}
          }
        }
      }
    } catch (_) {}
    // Also damage nearby destructible (soft) barricades
    try { this.damageSoftBarricadesInRadius(ex, ey, radius, 30); } catch (_) {}
    // Cleanup graphics
    try { bomb.g?.destroy(); } catch (_) {}
  }

  // Player bullet hits a barricade (hard or soft)
  onBulletHitBarricade(b, s) {
    if (!b || !b.active || !s) return;
    // Railgun bullets pierce and do not affect barricades
    if (b._rail) return;
    const isSoft = !!s.getData('destructible');
    const dmg = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 10;
    // Apply damage to destructible tiles
    if (isSoft) {
      const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 20;
      const hp1 = hp0 - dmg;
      // Small brown puff for soft hits
      try { impactBurst(this, b.x, b.y, { color: 0xC8A165, size: 'small' }); } catch (_) {}
      if (hp1 <= 0) {
        try { s.destroy(); } catch (_) {}
      } else {
        s.setData('hp', hp1);
      }
    } else {
      // Grey puff on hard
      try { impactBurst(this, b.x, b.y, { color: 0xBBBBBB, size: 'small' }); } catch (_) {}
    }
    // Rockets: explode on barricade contact and splash enemies
    if (b._core === 'blast') {
      const radius = b._blastRadius || 20;
      try { impactBurst(this, b.x, b.y, { color: 0xffaa33, size: 'large', radius }); } catch (_) {}
      const r2 = radius * radius; const ex = b.x; const ey = b.y;
      this.enemies.getChildren().forEach((other) => {
        if (!other?.active) return;
        const dx = other.x - ex; const dy = other.y - ey;
        if (dx * dx + dy * dy <= r2) {
          const splashDmg = b._rocket ? (b._aoeDamage || b.damage || 10) : Math.ceil((b.damage || 10) * 0.5);
          if (other.isDummy) {
            this._dummyDamage = (this._dummyDamage || 0) + splashDmg;
          } else {
            if (typeof other.hp !== 'number') other.hp = other.maxHp || 20;
            other.hp -= splashDmg;
            if (other.hp <= 0) this.killEnemy(other);
          }
        }
      });
      // Also damage nearby destructible barricades
      this.damageSoftBarricadesInRadius(ex, ey, radius, (b.damage || 10));
      // Cluster Bomb: spawn 8 bomblets (orange) on barricade impact
      if (b._rocket && b._clusterBomb) {
        const count = 8; const minD = Math.max(60, Math.floor(radius * 1.2)); const maxD = Math.max(minD + 1, Math.floor(radius * 2.0));
        for (let i = 0; i < count; i += 1) {
          const base = (i / count) * Math.PI * 2; const jitter = Phaser.Math.FloatBetween(-0.25, 0.25); const ang = base + jitter;
 const dist = Phaser.Math.Between(Math.max(8, Math.floor(radius * 0.60)), Math.max(Math.max(8, Math.floor(radius * 0.60)) + 1, Math.floor(radius * 1.30))); const spd = 420; const vx2 = Math.cos(ang) * spd; const vy2 = Math.sin(ang) * spd;
          const c = this.bullets.get(ex, ey, 'bullet'); if (!c) continue;
          c.setActive(true).setVisible(true); c.setCircle(4).setOffset(-4, -4); try { c.setScale(1.1); } catch (_) {}
          c.setVelocity(vx2, vy2); c.setTint(0xffaa33); c._clusterChild = true; c._startX = ex; c._startY = ey; c._travelMax2 = dist * dist; c._blastRadius = 52; c._aoeDamage = 20;
          c.update = () => {
            try {
              const mx = c.x - c._startX; const my = c.y - c._startY; const travel2 = (mx * mx) + (my * my); let collide2 = false;
              try {
                const enemies2 = this.enemies?.getChildren?.() || [];
                for (let k = 0; k < enemies2.length; k += 1) {
                  const e2 = enemies2[k]; if (!e2?.active) continue;
                  if (e2.isBoss && c._ignoreBossForTravel) continue;
                  let rect2;
                  if (e2.isBoss) {
                    try {
                      const hb2 = (e2._hitbox && e2._hitbox.body) ? e2._hitbox.body : e2.body;
                      const w2 = Math.max(1, Math.floor((hb2 && hb2.width) ? hb2.width : 36));
                      const h2 = Math.max(1, Math.floor((hb2 && hb2.height) ? hb2.height : 36));
                      rect2 = new Phaser.Geom.Rectangle(Math.floor(e2.x - w2 / 2), Math.floor(e2.y - h2 / 2), w2, h2);
                    } catch (_) {
                      rect2 = new Phaser.Geom.Rectangle(e2.x - 18, e2.y - 18, 36, 36);
                    }
                  } else {
                    rect2 = e2.getBounds?.() || new Phaser.Geom.Rectangle(e2.x - 6, e2.y - 6, 12, 12);
                  }
                  if (Phaser.Geom.Intersects.CircleToRectangle(new Phaser.Geom.Circle(c.x, c.y, 6), rect2)) { collide2 = true; break; }
                }
              } catch (_) {}
              try { const scanBarr = (grp) => { const arr2 = grp?.getChildren?.() || []; for (let k = 0; k < arr2.length && !collide2; k += 1) { const s2 = arr2[k]; if (!s2?.active) continue; const rectB = s2.getBounds?.() || new Phaser.Geom.Rectangle(s2.x - 8, s2.y - 8, 16, 16); if (Phaser.Geom.Intersects.CircleToRectangle(new Phaser.Geom.Circle(c.x, c.y, 6), rectB)) { collide2 = true; break; } } }; scanBarr(this.barricadesHard); scanBarr(this.barricadesSoft); } catch (_) {}
              if (travel2 >= c._travelMax2 || collide2) {
                const cx = c.x; const cy = c.y; const rr = c._blastRadius || 60; const r2c = rr * rr;
                try { impactBurst(this, cx, cy, { color: 0xffaa33, size: 'large', radius: rr }); } catch (_) {}
                try { const list = this.enemies?.getChildren?.() || []; for (let m = 0; m < list.length; m += 1) { const t = list[m]; if (!t?.active) continue; const ddx = t.x - cx; const ddy = t.y - cy; if ((ddx * ddx + ddy * ddy) <= r2c) { const dmg2 = c._aoeDamage || 20; if (t.isDummy) { this._dummyDamage = (this._dummyDamage || 0) + dmg2; } else { if (typeof t.hp !== 'number') t.hp = t.maxHp || 20; t.hp -= dmg2; if (t.hp <= 0) { this.killEnemy(t); } } } } } catch (_) {}
                try { c.destroy(); } catch (_) {}
              }
            } catch (_) { try { c.destroy(); } catch (__ ) {} }
          };
        }
      }
      // Ensure fire field spawns on barricade detonation as well
      try { if (b._firefield) this.spawnFireField(ex, ey, radius); } catch (_) {}
    }
    // Always destroy player bullet on barricade collision
    try { b.destroy(); } catch (_) {}
  }

  // Enemy bullet hits a barricade
  onEnemyBulletHitBarricade(b, s) {
    if (!b || !s) return;
    const isSoft = !!s.getData('destructible');
    // Explosive rockets: detonate on barricade contact, chip soft barricades in radius
    if (b._rocket) {
      const ex = b.x; const ey = b.y; const radius = b._blastRadius || 70;
      try { impactBurst(this, ex, ey, { color: 0xff3333, size: 'large', radius }); } catch (_) {}
      this.damageSoftBarricadesInRadius(ex, ey, radius, (b.damage || 12));
      // Napalm immediate ignite around barricade impact for MGL rockets
      if (b._firefield) {
        const nowI = this.time.now;
        this.enemies.getChildren().forEach((other) => {
          if (!other?.active || other.isDummy) return;
          const dxn = other.x - ex; const dyn = other.y - ey;
          if ((dxn * dxn + dyn * dyn) <= r2) {
            other._igniteValue = Math.min(10, (other._igniteValue || 0) + 5);
            if ((other._igniteValue || 0) >= 10) {
              other._ignitedUntil = nowI + 2000; other._igniteValue = 0;
              if (!other._igniteIndicator) { other._igniteIndicator = this.add.graphics(); try { other._igniteIndicator.setDepth(9000); } catch (_) {} other._igniteIndicator.fillStyle(0xff3333, 1).fillCircle(0, 0, 2); }
              try { other._igniteIndicator.setPosition(other.x, other.y - 14); } catch (_) {}
            }
          }
        });
      }
      try {
        try { b._hzTrailG?.destroy(); } catch (_) {}
        b.destroy();
      } catch (_) {}
      return;
    }
    const dmg = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 8;
    if (isSoft) {
      const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 20;
      const hp1 = hp0 - dmg;
      if (hp1 <= 0) { try { s.destroy(); } catch (_) {} }
      else s.setData('hp', hp1);
    }
    try {
      try { b._hzTrailG?.destroy(); } catch (_) {}
      b.destroy();
    } catch (_) {}
  }

  // Utility: damage all destructible barricades within radius
  damageSoftBarricadesInRadius(x, y, radius, dmg) {
    try {
      const r2 = radius * radius;
      const arr = this.barricadesSoft?.getChildren?.() || [];
      for (let i = 0; i < arr.length; i += 1) {
        const s = arr[i]; if (!s?.active) continue;
        const dx = s.x - x; const dy = s.y - y;
        if ((dx * dx + dy * dy) <= r2) {
      const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 20;
          const hp1 = hp0 - dmg;
          if (hp1 <= 0) { try { s.destroy(); } catch (_) {} } else { s.setData('hp', hp1); }
        }
      }
    } catch (_) {}
  }

  // Boss: damage any nearby soft barricades in a 37x37 square centered on the boss.
  damageNearbySoftBarricadesForBoss(boss) {
    if (!boss || !boss.active) return;
    const arr = this.barricadesSoft?.getChildren?.() || [];
    if (!arr.length) return;
    const now = this.time.now;
    // Use a slightly larger square so that, given boss (36x36) and barricade (~16x16) separation,
    // their centers still fall inside when the bodies visually touch.
    const half = 30; // 60x60 square centered on boss
    const bx = boss.x;
    const by = boss.y;
    for (let i = 0; i < arr.length; i += 1) {
      const s = arr[i];
      if (!s || !s.active) continue;
      if (!s.getData('destructible')) continue;
      const dx = s.x - bx;
      const dy = s.y - by;
      if (Math.abs(dx) > half || Math.abs(dy) > half) continue;
      const last = s.getData('_lastBossNearbyHitAt') || 0;
      if (now - last < 150) continue; // 150ms per-barricade rate
      s.setData('_lastBossNearbyHitAt', now);
      const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 20;
      const dmg = 10; // fixed damage for boss vs soft barricade
      const hp1 = hp0 - dmg;
      if (hp1 <= 0) {
        try { s.destroy(); } catch (_) {}
      } else {
        s.setData('hp', hp1);
      }
    }
  }

  // Enemy body tries to push through a destructible barricade: damage over time
  onEnemyHitBarricade(e, s) {
    if (!s?.active) return;
    if (!s.getData('destructible')) return;
    const now = this.time.now;
    const last = s.getData('_lastMeleeHurtAt') || 0;
    const minInterval = (e && e.isBoss) ? 100 : 250; // bosses hit barricades more frequently
    if (now - last < minInterval) return; // throttle
    s.setData('_lastMeleeHurtAt', now);
    let dmg = Math.max(4, Math.floor((e?.damage || 8) * 0.6));
    if (e && e.isBoss) {
      dmg *= 3; // bosses break soft barricades faster
    }
    const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 20;
    const hp1 = hp0 - dmg;
    if (hp1 <= 0) { try { s.destroy(); } catch (_) {} }
    else s.setData('hp', hp1);
  }

  // Enemy grenade hits a barricade: detonate and apply AoE
  onEnemyGrenadeHitBarricade(b, s) {
    if (!b || !b.active) return;
    const ex = b.x; const ey = b.y;
    const radius = b._grenadeRadius || 60;
    try { impactBurst(this, ex, ey, { color: 0xff3333, size: 'large', radius }); } catch (_) {}
    // Damage player if within radius
    try {
      const r2 = radius * radius; const pdx = this.player.x - ex; const pdy = this.player.y - ey;
      if ((pdx * pdx + pdy * pdy) <= r2) {
        const now = this.time.now;
        if (now >= (this.player.iframesUntil || 0)) {
          let dmg = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 14; try { const eff = getPlayerEffects(this.gs) || {}; const mul = eff.enemyExplosionDmgMul || 1; dmg = Math.ceil(dmg * mul); } catch (_) {} this.applyPlayerDamage(dmg);
          // Short i-frames vs enemy grenade explosions
          this.player.iframesUntil = now + 50;
          if (this.gs.hp <= 0) {
            const eff = getPlayerEffects(this.gs);
            this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
            this.gs.nextScene = SceneKeys.Hub;
            SaveManager.saveToLocal(this.gs);
            this.scene.start(SceneKeys.Hub);
          }
        }
      }
    } catch (_) {}
    // Damage soft barricades
    try { this.damageSoftBarricadesInRadius(ex, ey, radius, (b.damage || 10)); } catch (_) {}
    try { b.destroy(); } catch (_) {}
  }

  // Returns true if a straight line between two points hits any barricade
  isLineBlocked(x1, y1, x2, y2) {
    try {
      const line = new Phaser.Geom.Line(x1, y1, x2, y2);
      const checkGroup = (grp) => {
        if (!grp) return false;
        const arr = grp.getChildren?.() || [];
        for (let i = 0; i < arr.length; i += 1) {
          const s = arr[i]; if (!s?.active) continue;
          const rect = s.getBounds();
          if (Phaser.Geom.Intersects.LineToRectangle(line, rect)) return true;
        }
        return false;
      };
      if (checkGroup(this.barricadesHard)) return true;
      if (checkGroup(this.barricadesSoft)) return true;
      return false;
    } catch (_) {
      return false;
    }

    // If boss room: spawn exactly one boss at center-top and set up intro/UI hooks
    if (this._isBossRoom && !this.boss) {
      const mods = this.gs.getDifficultyMods?.() || {};
      const cx = width / 2; const cy = 100;
      // Default boss if not provided by caller
      let bossType = this._bossId || (typeof this.gs?.chooseBossType === 'function' ? this.gs.chooseBossType() : 'Dandelion');
        // Create boss with per-boss base HP (Normal difficulty), then apply difficulty scaling
        const baseBossHp = bossType === 'Bigwig' ? 2200 : (bossType === 'Dandelion' ? 1200 : 2000);
        let boss = createBoss(this, cx, cy, baseBossHp, 10, 60, bossType);
        boss.isEnemy = true; boss.isBoss = true; boss.isShooter = true; boss.bossType = bossType;
        boss.maxHp = Math.floor(baseBossHp * (mods.enemyHp || 1)); boss.hp = boss.maxHp; boss.speed = 60; boss.damage = Math.floor(10 * (mods.enemyDamage || 1));
      // Visual hint per boss type (tint)
      // visual comes from asset via createBoss catch (_) {} }
      // Initialize boss AI timers
      boss._nextNormalAt = 0; boss._nextSpecialAt = this.time.now + 2500; boss._state = 'idle';
        // Visual scaling is handled by EnemyFactory helper; keep physics body at 12x12
      this.boss = boss; this.enemies.add(boss);
      
      // Inform UI about boss
      try { this.registry.set('bossName', bossType); this.registry.set('bossHp', boss.hp); this.registry.set('bossHpMax', boss.maxHp); this.registry.set('bossActive', true); } catch (_) {}
      // Start intro cinematic and freeze gameplay
      try { this.startBossIntro?.(bossType); } catch (_) {}
    }
  }

  startBossIntro(bossId) {
    const { width, height } = this.scale;
    // Freeze physics and inputs during intro
    try { this.physics.world.pause(); } catch (_) {}
    this._cinematicUntil = this.time.now + 2000;
    this._cinematicActive = true;
    try { this.registry.set('cinematicActive', true); } catch (_) {}
    // Create visuals
    const artKey = bossId;
    let art = null;
    try { if (this.textures?.exists(artKey)) art = this.add.image(width + 200, height / 2, artKey); } catch (_) {}
    // Large, outlined boss name (pixel-style: simple stroke outline)
    const nameText = this.add.text(-200, 60, bossId, {
      fontFamily: 'monospace',
      fontSize: 56,
      color: '#ffffff'
    }).setOrigin(0.5, 0.5);
    try { nameText.setStroke('#000000', 6); } catch (_) {}
    // Precompute name tag metrics and a shared skew to use for both name tag and asset background
    const nb = nameText.getBounds();
    const tagPadX = 18, tagPadY = 10;
    const nameTagW = Math.max(60, nb.width + tagPadX * 2);
    const nameTagH = Math.max(34, nb.height + tagPadY * 2);
    const skewPx = Math.max(6, Math.min(14, Math.floor(nameTagH * 0.35)));
    // Depth ordering: background panels below their respective foregrounds
    // Asset BG < Asset < Name Tag < Name
    const zBgAsset = 8990, zAsset = 9000, zNameTag = 9005, zName = 9010;
    try { art?.setDepth(zAsset); nameText.setDepth(zName); } catch (_) {}
    // Half-transparent black background that travels with the asset (parallelogram)
    const assetBg = this.add.graphics();
    try { assetBg.setDepth(zBgAsset); assetBg.clear(); assetBg.fillStyle(0x000000, 0.5); } catch (_) {}
    const assetBgW = width, assetBgH = height; // full-screen overlay behind art
    try {
      const halfWb = assetBgW / 2;
      const halfHb = assetBgH / 2;
      // Opposite direction and stronger skew than name tag
      const k = Math.max(skewPx + 8, Math.min(Math.floor(assetBgH * 0.45), skewPx * 2));
      assetBg.beginPath();
      // Top edge skewed left, bottom edge skewed right (opposite of name tag)
      assetBg.moveTo(-halfWb - k, -halfHb);
      assetBg.lineTo( halfWb - k, -halfHb);
      assetBg.lineTo( halfWb + k,  halfHb);
      assetBg.lineTo(-halfWb + k,  halfHb);
      assetBg.closePath();
      assetBg.fillPath();
    } catch (_) {}
    try { assetBg.setPosition(width + 200, height / 2); } catch (_) {}
    // Opaque name tag background that follows the name
    const nameTag = this.add.graphics();
    // Use the same tint as debris/scrap on boss death for consistency
    let nameTagTint = 0x888888;
    try { nameTagTint = getScrapTintForEnemy({ isBoss: true, bossType: bossId }); } catch (_) {}
    try { nameTag.setDepth(zNameTag); nameTag.clear(); nameTag.fillStyle(nameTagTint, 1); } catch (_) {}
    // Draw a parallelogram (same height) instead of a rectangle
    try {
      const halfW = nameTagW / 2;
      const halfH = nameTagH / 2;
      const k = skewPx; // use same skew as asset background
      nameTag.beginPath();
      nameTag.moveTo(-halfW + k, -halfH);   // top-left skewed right
      nameTag.lineTo( halfW + k, -halfH);   // top-right skewed right
      nameTag.lineTo( halfW - k,  halfH);   // bottom-right skewed left
      nameTag.lineTo(-halfW - k,  halfH);   // bottom-left skewed left
      nameTag.closePath();
      nameTag.fillPath();
    } catch (_) {}
    try { nameTag.setPosition(-200, 60); } catch (_) {}
    // Slide in
    try { this.tweens.add({ targets: [assetBg, art], x: width / 2 + 140, duration: 600, ease: 'Cubic.easeOut' }); } catch (_) {}
    try { this.tweens.add({ targets: [nameTag, nameText], x: width / 2, duration: 600, ease: 'Cubic.easeOut' }); } catch (_) {}
    // Hold then slide out
    this.time.delayedCall(600 + 800, () => {
      try { this.tweens.add({ targets: [assetBg, art], x: width + 200, duration: 600, ease: 'Cubic.easeIn' }); } catch (_) {}
      try { this.tweens.add({ targets: [nameTag, nameText], x: -200, duration: 600, ease: 'Cubic.easeIn', onComplete: () => { try { nameText.destroy(); } catch (_) {} try { nameTag.destroy(); } catch (_) {} } }); } catch (_) {}
    });
    // Unfreeze after 2s
    this.time.delayedCall(2000, () => {
      this._cinematicActive = false; this._cinematicUntil = 0; try { this.physics.world.resume(); } catch (_) {}
      try { if (art) art.destroy(); } catch (_) {}
      try { assetBg.destroy(); } catch (_) {}
      try { this.registry.set('cinematicActive', false); } catch (_) {}
    });
  }

  shoot() {
    if (this.isStealthed()) this.endStealthDecoy();
    const gs = this.gs;
    const weapon = getEffectiveWeapon(gs, gs.activeWeapon);
    // Trigger per-weapon recoil kick (no recoil for laser handled elsewhere)
    try {
      const wid = gs.activeWeapon;
      const least = new Set(['smg', 'rifle']);
      const medium = new Set(['pistol', 'mgl', 'battle_rifle', 'guided_missiles', 'smart_hmg']);
      const high = new Set(['railgun', 'shotgun', 'rocket']);
      let kick = 0;
      if (least.has(wid)) kick = 2.0;      // least tier
      else if (medium.has(wid)) kick = 3.5; // medium tier
      else if (high.has(wid)) kick = 5.5;   // highest tier
      this._weaponRecoil = Math.max(this._weaponRecoil || 0, kick);
    } catch (_) {}
    const baseAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, this.inputMgr.pointer.worldX, this.inputMgr.pointer.worldY);
    this.playerFacing = baseAngle;
    const muzzle = getWeaponMuzzleWorld(this, 3);
    const startX = muzzle.x;
    const startY = muzzle.y;
    try {
      const wid = gs.activeWeapon;
      const allowed = new Set(['pistol','mgl','rifle','battle_rifle','shotgun','smg','guided_missiles','smart_hmg','minigun','rocket']);
      if (allowed.has(wid)) {
        const heavy = new Set(['smart_hmg','guided_missiles','minigun','rocket','shotgun','mgl']);
        if (heavy.has(wid)) muzzleFlashSplit(this, startX, startY, { angle: baseAngle, color: 0xffee66, count: 3, spreadDeg: 24, length: 16, thickness: 4 });
        else if (wid === 'battle_rifle') muzzleFlash(this, startX, startY, { angle: baseAngle, color: 0xffee66, length: 14, thickness: 4 });
        else muzzleFlash(this, startX, startY, { angle: baseAngle, color: 0xffee66, length: 10, thickness: 3 });
        // Add yellow pixel spray from muzzle (wider angle overall; special tuning for heavy and battle rifle)
        const base = baseAngle;
        if (heavy.has(wid)) {
          const burst = { spreadDeg: 36, speedMin: 130, speedMax: 260, lifeMs: 190, color: 0xffee66, size: 2, alpha: 0.75 };
          pixelSparks(this, startX, startY, { angleRad: base, count: 14, ...burst });
        } else if (wid === 'battle_rifle') {
          const burst = { spreadDeg: 30, speedMin: 125, speedMax: 230, lifeMs: 185, color: 0xffee66, size: 2, alpha: 0.85 };
          pixelSparks(this, startX, startY, { angleRad: base, count: 11, ...burst });
        } else {
          const burst = { spreadDeg: 28, speedMin: 100, speedMax: 190, lifeMs: 165, color: 0xffee66, size: 1, alpha: 0.7 };
          pixelSparks(this, startX, startY, { angleRad: base, count: 9, ...burst });
        }
      }
    } catch (_) {}
    try { this._spawnBulletCasing(gs.activeWeapon); } catch (_) {}
    const pellets = weapon.pelletCount || 1;
    // Dynamic spread: increases while holding fire, recovers when released
    let totalSpreadRad = 0;
    if (weapon.isMinigun) {
      const t = Math.max(0, Math.min(1, this._minigunSpreadT || 0));
      const maxDeg = (typeof weapon.maxSpreadDeg === 'number') ? weapon.maxSpreadDeg : 7;
      const minDeg = (typeof weapon.spreadDeg === 'number') ? weapon.spreadDeg : 2;
      const spreadDeg = Phaser.Math.Linear(maxDeg, minDeg, t);
      totalSpreadRad = Phaser.Math.DegToRad(spreadDeg);
    } else {
      const heat = this._spreadHeat || 0;
      const maxExtra = (typeof weapon.maxSpreadDeg === 'number') ? weapon.maxSpreadDeg : 20;
      const extraDeg = weapon.singleFire ? 0 : (maxExtra * heat);
      totalSpreadRad = Phaser.Math.DegToRad((weapon.spreadDeg || 0) + extraDeg);
    }
    // Smart HMG bullets: limited homing toward enemies (non-explosive)
    if (weapon.projectile === 'smart') {
      const angle0 = baseAngle;
      const b = this.bullets.get(startX, startY, 'bullet');
      if (b) {
        b.setActive(true).setVisible(true);
        b.setCircle(2).setOffset(-2, -2);
        b.setTint(weapon.color || 0xffaa33);
        b.damage = weapon.damage;
        b._core = null; // non-explosive
        b._stunOnHit = weapon._stunOnHit || 0;

        // Homing params (more limited than Smart Missiles core)
        b._angle = angle0;
        b._speed = Math.max(40, weapon.bulletSpeed | 0);
        b._maxTurn = Phaser.Math.DegToRad(2) * 0.1; // ~0.2闂?frame (more limited)
        b._fov = Phaser.Math.DegToRad(60); // narrower lock cone
        // Slightly increase Smart HMG homing: ~0.75闂傚倸鍊峰ù鍥р枖閺囥垹绐楅柟鐗堟緲閸戠姴鈹戦悩瀹犲缂?frame (~45闂傚倸鍊峰ù鍥р枖閺囥垹绐楅柟鐗堟緲閸戠姴鈹戦悩瀹犲缂?s)
        b._maxTurn = Phaser.Math.DegToRad(0.75);
        b._noTurnUntil = this.time.now + 120; // brief straight launch
        // Override: interpret _maxTurn as deg/s for time-based turn; 0.75 deg/frame @60 FPS 闂?45 deg/s
        b._maxTurn = Phaser.Math.DegToRad(45);

        b.setVelocity(Math.cos(b._angle) * b._speed, Math.sin(b._angle) * b._speed);

        // Small orange tracer similar to micro rockets but shorter
        const g = this.add.graphics(); b._g = g; try { g.setDepth(8000); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
        b.update = () => {
          const view = this.cameras?.main?.worldView; if (view && !view.contains(b.x, b.y)) { try { b.destroy(); } catch (_) {} return; }
          try {
            let desired = b._angle; const nowG = this.time.now;
            if (nowG >= (b._noTurnUntil || 0)) {
              const enemies = this.enemies?.getChildren?.() || [];
              const half = (b._fov || Math.PI / 2) / 2; const norm = (a) => Phaser.Math.Angle.Wrap(a); const ang = norm(b._angle);
              const valid = (t) => { if (!t?.active) return false; const a2 = Phaser.Math.Angle.Between(b.x, b.y, t.x, t.y); return Math.abs(norm(a2 - ang)) <= half; };
              if (!valid(b._target)) {
                b._target = null; let best=null, bestD2=Infinity;
                for (let i = 0; i < enemies.length; i += 1) { const e = enemies[i]; if (!e?.active) continue; const a2 = Phaser.Math.Angle.Between(b.x, b.y, e.x, e.y); const dAng = Math.abs(norm(a2 - ang)); if (dAng > half) continue; const dx=e.x-b.x, dy=e.y-b.y; const d2=dx*dx+dy*dy; if (d2 < bestD2) { best=e; bestD2=d2; } }
                b._target = best;
              }
              if (b._target && b._target.active) { desired = Phaser.Math.Angle.Between(b.x, b.y, b._target.x, b._target.y); }
            }
            const dtHmg = (this.game?.loop?.delta || 16.7) / 1000;
            b._angle = Phaser.Math.Angle.RotateTo(b._angle, desired, (b._maxTurn || 0) * dtHmg);
            const vx = Math.cos(b._angle) * b._speed; const vy = Math.sin(b._angle) * b._speed; b.setVelocity(vx, vy);
          } catch (_) {}
          try {
            g.clear();
            const headX = b.x + Math.cos(b._angle) * 1.5; const headY = b.y + Math.sin(b._angle) * 1.5;
            const tailX = b.x - Math.cos(b._angle) * 6; const tailY = b.y - Math.sin(b._angle) * 6;
            g.lineStyle(2, 0xff8800, 0.95).beginPath().moveTo(tailX + Math.cos(b._angle) * 3, tailY + Math.sin(b._angle) * 3).lineTo(headX, headY).strokePath();
            g.lineStyle(1, 0xffddaa, 0.9).beginPath().moveTo(tailX, tailY).lineTo(b.x, b.y).strokePath();
          } catch (_) {}
        };
        b.on('destroy', () => { try { b._g?.destroy(); } catch (_) {} });
      }
      return;
    }

    // Guided micro-missiles: home toward the cursor with limited turn rate
    if (weapon.projectile === 'guided') {
      const angle0 = baseAngle;
      const b = this.bullets.get(startX, startY, 'bullet');
      if (b) {
        b.setActive(true).setVisible(true);
        b.setCircle(2).setOffset(-2, -2);
        b.setTint(weapon.color || 0xffaa33);
        // Stats and explosive behavior
        b.damage = weapon.damage;
        b._aoeDamage = (typeof weapon.aoeDamage === 'number') ? weapon.aoeDamage : weapon.damage;
        b._core = 'blast';
        b._blastRadius = weapon.blastRadius || 40;
        b._rocket = true; // treat as explosive projectile for AoE rules
        b._stunOnHit = weapon._stunOnHit || 0;

        // Homing parameters
        b._angle = angle0;
        b._speed = Math.max(40, weapon.bulletSpeed | 0); // low velocity
        // Max turn per frame baseline is increased for no-core missiles (effectively time-scaled later)
        // Drastically higher base homing for no-core: 8 deg/frame (~480闂傚倸鍊峰ù鍥р枖閺囥垹绐楅柟鐗堟緲閸戠姴鈹戦悩瀹犲缂?s at 60 FPS)
        b._maxTurn = Phaser.Math.DegToRad(8);
        // Apply optional guided turn-rate multiplier from cores
        if (typeof weapon._guidedTurnMult === 'number') {
          const mul = Math.max(0.1, weapon._guidedTurnMult);
          b._maxTurn *= mul;
        }
        // Smart Missiles core: enable enemy-seeking and reduce turn further
        b._smart = !!weapon._smartMissiles;
        if (b._smart) {
          const mult = (typeof weapon._smartTurnMult === 'number') ? Math.max(0.1, weapon._smartTurnMult) : 0.5;
          b._maxTurn = b._maxTurn * mult; // e.g., 1闂?frame
          b._fov = Phaser.Math.DegToRad(90); // 90闂?cone total
        }
        // Preserve Smart Core homing but treat as time-based: fixed 120 deg/s, scaled by smartTurnMult if provided
        if (b._smart) {
          const mult2 = (typeof weapon._smartTurnMult === 'number') ? Math.max(0.1, weapon._smartTurnMult) : 1;
          b._maxTurn = Phaser.Math.DegToRad(120) * mult2; // radians per second
        } else {
          // Non-smart guided missiles: keep existing high turn rate baseline converted to rad/s
          b._maxTurn = (b._maxTurn || 0) * 60;
        }
        // Initial straight flight window (no steering)
        b._noTurnUntil = this.time.now + 200; // ms

        // Initial velocity
        b.setVelocity(Math.cos(b._angle) * b._speed, Math.sin(b._angle) * b._speed);

        // Tracer/visual tail
        const g = this.add.graphics();
        b._g = g; try { g.setDepth(8000); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}

        b.update = () => {
          // Offscreen cleanup
          const view = this.cameras?.main?.worldView;
          if (view && !view.contains(b.x, b.y)) { try { b.destroy(); } catch (_) {} return; }

          // Guidance
          try {
            let desired = b._angle;
            const nowG = this.time.now;
            if (nowG >= (b._noTurnUntil || 0)) {
              if (b._smart) {
                // Maintain/refresh target within FOV; otherwise go straight
                const enemies = this.enemies?.getChildren?.() || [];
                const half = (b._fov || Math.PI / 2) / 2; // 45闂?half-angle
                const norm = (a) => Phaser.Math.Angle.Wrap(a);
                const ang = norm(b._angle);
                // Validate existing target
                const validExisting = (t) => {
                  if (!t?.active) return false;
                  const a2 = Phaser.Math.Angle.Between(b.x, b.y, t.x, t.y);
                  const d = Math.abs(norm(a2 - ang));
                  return d <= half;
                };
                if (!validExisting(b._target)) {
                  b._target = null;
                  // Find nearest within FOV cone
                  let best = null; let bestD2 = Infinity;
                  for (let i = 0; i < enemies.length; i += 1) {
                    const e = enemies[i]; if (!e?.active) continue;
                    const a2 = Phaser.Math.Angle.Between(b.x, b.y, e.x, e.y);
                    const dAng = Math.abs(norm(a2 - ang));
                    if (dAng > half) continue;
                    const dx = e.x - b.x; const dy = e.y - b.y; const d2 = dx * dx + dy * dy;
                    if (d2 < bestD2) { best = e; bestD2 = d2; }
                  }
                  b._target = best;
                }
                if (b._target && b._target.active) {
                  desired = Phaser.Math.Angle.Between(b.x, b.y, b._target.x, b._target.y);
                } else {
                  // No target in cone: keep heading
                  desired = b._angle;
                }
              } else {
                // Follow cursor (default guided behavior)
                const ptr = this.inputMgr?.pointer;
                const tx = ptr?.worldX ?? (this.player.x + Math.cos(this.playerFacing) * 2000);
                const ty = ptr?.worldY ?? (this.player.y + Math.sin(this.playerFacing) * 2000);
                desired = Phaser.Math.Angle.Between(b.x, b.y, tx, ty);
              }
            } // else: within straight-flight window; keep current desired (= b._angle)
            const dt = (this.game?.loop?.delta || 16.7) / 1000;
            const maxTurn = (b._maxTurn || 0) * dt;
            if (b._smart) {
              // Smart missiles: keep existing RotateTo behavior
              b._angle = Phaser.Math.Angle.RotateTo(b._angle, desired, maxTurn);
            } else {
              // Non-smart guided missiles: apply capped step with manual unwrap
              if (typeof b._angle === 'number') {
                const current = b._angle;
                const diff = Phaser.Math.Angle.Wrap(desired - current);
                const step = Math.sign(diff) * Math.min(Math.abs(diff), maxTurn);
                b._angle = current + step;
              } else {
                b._angle = desired;
              }
            }
            const vx = Math.cos(b._angle) * b._speed;
            const vy = Math.sin(b._angle) * b._speed;
            b.setVelocity(vx, vy);
            // Proximity detonation vs enemies: auto-explode when within 15px
            try {
              const senseR = 15;
              const senseR2 = senseR * senseR;
              const enemies = this.enemies?.getChildren?.() || [];
              let close = false;
              for (let i = 0; i < enemies.length; i += 1) {
                const e = enemies[i];
                if (!e?.active || e.isDummy) continue;
                const dx = e.x - b.x;
                const dy = e.y - b.y;
                if ((dx * dx + dy * dy) <= senseR2) { close = true; break; }
              }
              if (close) {
                const ex = b.x;
                const ey = b.y;
                const radius = b._blastRadius || 40;
                try { impactBurst(this, ex, ey, { color: 0xffaa33, size: 'large', radius }); } catch (_) {}
                // Apply blast splash to enemies (reuse generic blast logic)
                try {
                  const arrE = this.enemies?.getChildren?.() || [];
                  const r2 = radius * radius;
                  for (let i = 0; i < arrE.length; i += 1) {
                    const other = arrE[i];
                    if (!other?.active) continue;
                    const dx = other.x - ex;
                    const dy = other.y - ey;
                    if ((dx * dx + dy * dy) <= r2) {
                      const splashDmg = b._aoeDamage || b.damage || 10;
                      if (other.isDummy) {
                        this._dummyDamage = (this._dummyDamage || 0) + splashDmg;
                      } else {
                        if (typeof other.hp !== 'number') other.hp = other.maxHp || 20;
                        other.hp -= splashDmg;
                        try { this._flashEnemyHit(other); } catch (_) {}
                        if (other.hp <= 0) { this.killEnemy(other); }
                      }
                    }
                  }
                } catch (_) {}
                // Damage soft barricades in radius
                try { this.damageSoftBarricadesInRadius(ex, ey, radius, (b.damage || 10)); } catch (_) {}
                try { b.destroy(); } catch (_) {}
                return;
              }
            } catch (_) {}
          } catch (_) {}

          // Draw small elongated orange body + tracer tail
          try {
            g.clear();
            const headX = b.x + Math.cos(b._angle) * 2;
            const headY = b.y + Math.sin(b._angle) * 2;
            const tailX = b.x - Math.cos(b._angle) * 8;
            const tailY = b.y - Math.sin(b._angle) * 8;
            // Body (thicker, short)
            const headMul = b._fullSize ? 3.5 : 2;
            const tailMul = b._fullSize ? 14 : 8;
            const bodyThick = b._fullSize ? 4 : 3;
            const tracerThick = b._fullSize ? 2 : 1;
            const headX2 = b.x + Math.cos(b._angle) * headMul;
            const headY2 = b.y + Math.sin(b._angle) * headMul;
            const tailX2 = b.x - Math.cos(b._angle) * tailMul;
            const tailY2 = b.y - Math.sin(b._angle) * tailMul;
            g.lineStyle(bodyThick, 0xff8800, 0.95);
            g.beginPath(); g.moveTo(tailX2 + Math.cos(b._angle) * 4, tailY2 + Math.sin(b._angle) * 4); g.lineTo(headX2, headY2); g.strokePath();
            g.lineStyle(tracerThick, 0xffddaa, 0.9);
            g.beginPath(); g.moveTo(tailX2, tailY2); g.lineTo(b.x, b.y); g.strokePath();
          } catch (_) {}
        };
        b.on('destroy', () => { try { b._g?.destroy(); } catch (_) {} });
      }
      return;
    }

    // Rocket projectile: explode on hit or when reaching click position
    if (weapon.projectile === 'rocket') {
      const targetX = this.inputMgr.pointer.worldX;
      const targetY = this.inputMgr.pointer.worldY;
      const angle = baseAngle;
      const vx = Math.cos(angle) * weapon.bulletSpeed;
      const vy = Math.sin(angle) * weapon.bulletSpeed;
      const b = this.bullets.get(startX, startY, 'bullet');
      if (b) {
        b.setActive(true).setVisible(true);
        // Larger rocket visual + hitbox
        b.setCircle(6).setOffset(-6, -6);
        try { b.setScale(1.8); } catch (_) {}
        b.setVelocity(vx, vy);
        b.setTint(weapon.color || 0xff5533);
        // Use weapon.damage for direct-hit; carry AoE damage separately
        b.damage = weapon.damage;
        b._aoeDamage = (typeof weapon.aoeDamage === 'number') ? weapon.aoeDamage : weapon.damage;
        b._core = 'blast';
        b._blastRadius = weapon.blastRadius || 70;
        b._rocket = true;
        // Carry stun-on-hit value for direct impacts (from Stun Ammunitions)
        b._stunOnHit = weapon._stunOnHit || 0;
        // Smart Explosives core flags
        b._smartExplosives = !!weapon._smartExplosives;
        b._firefield = !!weapon._firefield;
        // Cluster Bomb core
        b._clusterBomb = !!weapon._clusterBomb;
        if (b._smartExplosives) {
          const scale = (typeof weapon._detectScale === 'number') ? weapon._detectScale : 0.65;
          b._detectR = Math.max(8, Math.floor((b._blastRadius || 70) * scale));
        }
        b._startX = startX; b._startY = startY;
        b._targetX = targetX; b._targetY = targetY;
        const sx = targetX - startX; const sy = targetY - startY;
        b._targetLen2 = sx * sx + sy * sy;
        b.update = () => {
          // Lifetime via camera view when walls are disabled
          const view = this.cameras?.main?.worldView;
          if (view && !view.contains(b.x, b.y)) {
            // Do not cull mines off-screen; allow them to persist
            if (!b._mine) { try { b.destroy(); } catch (_) {} return; }
          }
          // Napalm (MGL incendiary) rocket: add orange tracer particles behind projectile
          try {
            if (b._firefield) {
              const vx0 = b.body?.velocity?.x || 0; const vy0 = b.body?.velocity?.y || 0;
              const spd2 = (vx0*vx0 + vy0*vy0) || 0;
              if (spd2 > 1) {
                const back = Math.atan2(vy0, vx0) + Math.PI;
                const ex = b.x + Math.cos(back) * 6; const ey = b.y + Math.sin(back) * 6;
                pixelSparks(this, ex, ey, { angleRad: back, count: 2, spreadDeg: 8, speedMin: 90, speedMax: 180, lifeMs: 110, color: 0xffaa33, size: 2, alpha: 0.95 });
              }
            }
          } catch (_) {}
          // Smart Explosives: proximity detection and mine behavior
          if (b._smartExplosives) {
            const detR = b._detectR || Math.max(8, Math.floor((b._blastRadius || 70) * 0.65));
            const detR2 = detR * detR;
            const now = this.time.now;
            // If deployed as a mine, sit until enemy enters detection or expiry
            if (b._mine) {
              if (now >= (b._mineExpireAt || 0)) {
                // Expire by detonating rather than disappearing silently
                const ex = b.x; const ey = b.y;
                try { impactBurst(this, ex, ey, { color: 0xffaa33, size: 'large', radius: b._blastRadius || 40 }); } catch (_) {}
                const radius = b._blastRadius || 70; const r2 = radius * radius;
                this.enemies.getChildren().forEach((other) => {
                  if (!other.active) return; const ddx = other.x - ex; const ddy = other.y - ey;
                  if ((ddx * ddx + ddy * ddy) <= r2) {
                    const aoe = (b._aoeDamage || b.damage || 10);
                    if (other.isDummy) { this._dummyDamage = (this._dummyDamage || 0) + aoe; }
                    else { if (typeof other.hp !== 'number') other.hp = other.maxHp || 20; other.hp -= aoe; try { this._flashEnemyHit(other); } catch (_) {} if (other.hp <= 0) { this.killEnemy(other); } }
                  }
                });
                this.damageSoftBarricadesInRadius(ex, ey, radius, (b._aoeDamage || b.damage || 10));
                // Cluster Bomb: spawn 8 orange bomblets (no toxin)
                if (b._clusterBomb) {
                  const count = 8; const minD = Math.max(60, Math.floor(radius * 1.2)); const maxD = Math.max(minD + 1, Math.floor(radius * 2.0));
                  for (let i = 0; i < count; i += 1) {
                    const base = (i / count) * Math.PI * 2; const jitter = Phaser.Math.FloatBetween(-0.25, 0.25); const ang = base + jitter;
 const dist = Phaser.Math.Between(Math.max(8, Math.floor(radius * 0.60)), Math.max(Math.max(8, Math.floor(radius * 0.60)) + 1, Math.floor(radius * 1.30))); const spd = 420; const vx2 = Math.cos(ang) * spd; const vy2 = Math.sin(ang) * spd;
                    const c = this.bullets.get(ex, ey, 'bullet'); if (!c) continue;
                    c.setActive(true).setVisible(true); c.setCircle(4).setOffset(-4, -4); try { c.setScale(1.1); } catch (_) {}
                    c.setVelocity(vx2, vy2); c.setTint(0xffaa33); c._clusterChild = true; c._startX = ex; c._startY = ey; c._travelMax2 = dist * dist; c._blastRadius = 52; c._aoeDamage = 20;
                    c.update = () => {
                      try {
                        const mx = c.x - c._startX; const my = c.y - c._startY; const travel2 = (mx * mx) + (my * my); let collide2 = false;
                        try {
                          const enemies2 = this.enemies?.getChildren?.() || [];
                          for (let k = 0; k < enemies2.length; k += 1) {
                            const e2 = enemies2[k]; if (!e2?.active) continue;
                            if (e2.isBoss && c._ignoreBossForTravel) continue;
                            let rect2;
                            if (e2.isBoss) {
                              try {
                                const hb2 = (e2._hitbox && e2._hitbox.body) ? e2._hitbox.body : e2.body;
                                const w2 = Math.max(1, Math.floor((hb2 && hb2.width) ? hb2.width : 36));
                                const h2 = Math.max(1, Math.floor((hb2 && hb2.height) ? hb2.height : 36));
                                rect2 = new Phaser.Geom.Rectangle(Math.floor(e2.x - w2 / 2), Math.floor(e2.y - h2 / 2), w2, h2);
                              } catch (_) {
                                rect2 = new Phaser.Geom.Rectangle(e2.x - 18, e2.y - 18, 36, 36);
                              }
                            } else {
                              rect2 = e2.getBounds?.() || new Phaser.Geom.Rectangle(e2.x - 6, e2.y - 6, 12, 12);
                            }
                            if (Phaser.Geom.Intersects.CircleToRectangle(new Phaser.Geom.Circle(c.x, c.y, 6), rect2)) { collide2 = true; break; }
                          }
                        } catch (_) {}
                        try { const scanBarr = (grp) => { const arr2 = grp?.getChildren?.() || []; for (let k = 0; k < arr2.length && !collide2; k += 1) { const s2 = arr2[k]; if (!s2?.active) continue; const rectB = s2.getBounds?.() || new Phaser.Geom.Rectangle(s2.x - 8, s2.y - 8, 16, 16); if (Phaser.Geom.Intersects.CircleToRectangle(new Phaser.Geom.Circle(c.x, c.y, 6), rectB)) { collide2 = true; break; } } }; scanBarr(this.barricadesHard); scanBarr(this.barricadesSoft); } catch (_) {}
                        if (travel2 >= c._travelMax2 || collide2) {
                          const cx = c.x; const cy = c.y; const rr = c._blastRadius || 60; const r2c = rr * rr;
                          try { impactBurst(this, cx, cy, { color: 0xffaa33, size: 'large', radius: rr }); } catch (_) {}
                          try { const list = this.enemies?.getChildren?.() || []; for (let m = 0; m < list.length; m += 1) { const t = list[m]; if (!t?.active) continue; const ddx = t.x - cx; const ddy = t.y - cy; if ((ddx * ddx + ddy * ddy) <= r2c) { const dmg2 = c._aoeDamage || 20; if (t.isDummy) { this._dummyDamage = (this._dummyDamage || 0) + dmg2; } else { if (typeof t.hp !== 'number') t.hp = t.maxHp || 20; t.hp -= dmg2; if (t.hp <= 0) { this.killEnemy(t); } } } } } catch (_) {}
                          try { c.destroy(); } catch (_) {}
                        }
                      } catch (_) { try { c.destroy(); } catch (__ ) {} }
                    };
                  }
                }
                if (b._firefield) {
                  this.spawnFireField(ex, ey, radius);
                  const r2n = radius * radius; const nowI = this.time.now;
                  this.enemies.getChildren().forEach((other) => {
                    if (!other?.active || other.isDummy) return;
                    const dxn = other.x - ex; const dyn = other.y - ey;
                    if ((dxn * dxn + dyn * dyn) <= r2n) {
                      other._igniteValue = Math.min(10, (other._igniteValue || 0) + 5);
                      if ((other._igniteValue || 0) >= 10) {
                        other._ignitedUntil = nowI + 2000; other._igniteValue = 0;
                        if (!other._igniteIndicator) { other._igniteIndicator = this.add.graphics(); try { other._igniteIndicator.setDepth(9000); } catch (_) {} other._igniteIndicator.fillStyle(0xff3333, 1).fillCircle(0, 0, 2); }
                        try { other._igniteIndicator.setPosition(other.x, other.y - 14); } catch (_) {}
                      }
                    }
                  });
                }
                try { b.destroy(); } catch (_) {}
                return;
              }
              const arr = this.enemies?.getChildren?.() || [];
              for (let i = 0; i < arr.length; i += 1) {
                const e = arr[i]; if (!e?.active) continue;
                const dx = e.x - b.x; const dy = e.y - b.y;
                if ((dx * dx + dy * dy) <= detR2) {
                  const ex = b.x; const ey = b.y;
                  try { impactBurst(this, ex, ey, { color: 0xffaa33, size: 'large', radius: b._blastRadius || 40 }); } catch (_) {}
                  const radius = b._blastRadius || 70; const r2 = radius * radius;
                  this.enemies.getChildren().forEach((other) => {
                    if (!other.active) return; const ddx = other.x - ex; const ddy = other.y - ey;
                    if ((ddx * ddx + ddy * ddy) <= r2) {
                      const aoe = (b._aoeDamage || b.damage || 10);
                      if (other.isDummy) { this._dummyDamage = (this._dummyDamage || 0) + aoe; }
                      else { if (typeof other.hp !== 'number') other.hp = other.maxHp || 20; other.hp -= aoe; if (other.hp <= 0) { this.killEnemy(other); } }
                    }
                  });
                  this.damageSoftBarricadesInRadius(ex, ey, radius, (b._aoeDamage || b.damage || 10));
                  if (b._clusterBomb) {
                    const count = 8; const minD = Math.max(60, Math.floor(radius * 1.2)); const maxD = Math.max(minD + 1, Math.floor(radius * 2.0));
                    for (let i = 0; i < count; i += 1) {
                      const base = (i / count) * Math.PI * 2; const jitter = Phaser.Math.FloatBetween(-0.25, 0.25); const ang = base + jitter;
 const dist = Phaser.Math.Between(Math.max(8, Math.floor(radius * 0.60)), Math.max(Math.max(8, Math.floor(radius * 0.60)) + 1, Math.floor(radius * 1.30))); const spd = 420; const vx2 = Math.cos(ang) * spd; const vy2 = Math.sin(ang) * spd;
                      const c = this.bullets.get(ex, ey, 'bullet'); if (!c) continue;
                      c.setActive(true).setVisible(true); c.setCircle(4).setOffset(-4, -4); try { c.setScale(1.1); } catch (_) {}
                      c.setVelocity(vx2, vy2); c.setTint(0xffaa33); c._clusterChild = true; c._startX = ex; c._startY = ey; c._travelMax2 = dist * dist; c._blastRadius = 52; c._aoeDamage = 20;
                      c.update = () => {
                        try {
                          const mx = c.x - c._startX; const my = c.y - c._startY; const travel2 = (mx * mx) + (my * my); let collide2 = false;
                          try {
                            const enemies2 = this.enemies?.getChildren?.() || [];
                            for (let k = 0; k < enemies2.length; k += 1) {
                              const e2 = enemies2[k]; if (!e2?.active) continue;
                              let rect2;
                              if (e2.isBoss) {
                                try {
                                  const hb2 = (e2._hitbox && e2._hitbox.body) ? e2._hitbox.body : e2.body;
                                  const w2 = Math.max(1, Math.floor((hb2 && hb2.width) ? hb2.width : 36));
                                  const h2 = Math.max(1, Math.floor((hb2 && hb2.height) ? hb2.height : 36));
                                  rect2 = new Phaser.Geom.Rectangle(Math.floor(e2.x - w2 / 2), Math.floor(e2.y - h2 / 2), w2, h2);
                                } catch (_) {
                                  rect2 = new Phaser.Geom.Rectangle(e2.x - 18, e2.y - 18, 36, 36);
                                }
                              } else {
                                rect2 = e2.getBounds?.() || new Phaser.Geom.Rectangle(e2.x - 6, e2.y - 6, 12, 12);
                              }
                              if (Phaser.Geom.Intersects.CircleToRectangle(new Phaser.Geom.Circle(c.x, c.y, 6), rect2)) { collide2 = true; break; }
                            }
                          } catch (_) {}
                          try { const scanBarr = (grp) => { const arr2 = grp?.getChildren?.() || []; for (let k = 0; k < arr2.length && !collide2; k += 1) { const s2 = arr2[k]; if (!s2?.active) continue; const rectB = s2.getBounds?.() || new Phaser.Geom.Rectangle(s2.x - 8, s2.y - 8, 16, 16); if (Phaser.Geom.Intersects.CircleToRectangle(new Phaser.Geom.Circle(c.x, c.y, 6), rectB)) { collide2 = true; break; } } }; scanBarr(this.barricadesHard); scanBarr(this.barricadesSoft); } catch (_) {}
                          if (travel2 >= c._travelMax2 || collide2) {
                            const cx = c.x; const cy = c.y; const rr = c._blastRadius || 60; const r2c = rr * rr;
                            try { impactBurst(this, cx, cy, { color: 0xffaa33, size: 'large', radius: rr }); } catch (_) {}
                            try { const arr2 = this.enemies?.getChildren?.() || []; for (let m = 0; m < arr2.length; m += 1) { const t = arr2[m]; if (!t?.active) continue; const ddx = t.x - cx; const ddy = t.y - cy; if ((ddx * ddx + ddy * ddy) <= r2c) { const dmg2 = c._aoeDamage || 20; if (t.isDummy) { this._dummyDamage = (this._dummyDamage || 0) + dmg2; } else { if (typeof t.hp !== 'number') t.hp = t.maxHp || 20; t.hp -= dmg2; if (t.hp <= 0) { this.killEnemy(t); } } } } } catch (_) {}
                            try { c.destroy(); } catch (_) {}
                          }
                        } catch (_) { try { c.destroy(); } catch (__ ) {} }
                      };
                    }
                  }
                  if (b._firefield) {
                    this.spawnFireField(ex, ey, radius);
                    const r2n = radius * radius; const nowI = this.time.now;
                    this.enemies.getChildren().forEach((other) => {
                      if (!other?.active || other.isDummy) return;
                      const dxn = other.x - ex; const dyn = other.y - ey;
                      if ((dxn * dxn + dyn * dyn) <= r2n) {
                        other._igniteValue = Math.min(10, (other._igniteValue || 0) + 5);
                        if ((other._igniteValue || 0) >= 10) {
                          other._ignitedUntil = nowI + 2000; other._igniteValue = 0;
                          if (!other._igniteIndicator) { other._igniteIndicator = this.add.graphics(); try { other._igniteIndicator.setDepth(9000); } catch (_) {} other._igniteIndicator.fillStyle(0xff3333, 1).fillCircle(0, 0, 2); }
                          try { other._igniteIndicator.setPosition(other.x, other.y - 14); } catch (_) {}
                        }
                      }
                    });
                  }
                  try { b.destroy(); } catch (_) {}
                  return;
                }
              }
              // Stay as mine this frame
              return;
            }
            // While flying: proximity-detonate if any enemy within detect radius
            {
              const arr = this.enemies?.getChildren?.() || [];
              for (let i = 0; i < arr.length; i += 1) {
                const e = arr[i]; if (!e?.active) continue;
                const dx = e.x - b.x; const dy = e.y - b.y;
                if ((dx * dx + dy * dy) <= detR2) {
                  const ex = b.x; const ey = b.y;
                  try { impactBurst(this, ex, ey, { color: 0xffaa33, size: 'large', radius: b._blastRadius || 40 }); } catch (_) {}
                  const radius = b._blastRadius || 70; const r2 = radius * radius;
                  this.enemies.getChildren().forEach((other) => {
                    if (!other.active) return; const ddx = other.x - ex; const ddy = other.y - ey;
                    if ((ddx * ddx + ddy * ddy) <= r2) {
                      const aoe = (b._aoeDamage || b.damage || 10);
                      if (other.isDummy) { this._dummyDamage = (this._dummyDamage || 0) + aoe; }
                      else { if (typeof other.hp !== 'number') other.hp = other.maxHp || 20; other.hp -= aoe; if (other.hp <= 0) { this.killEnemy(other); } }
                    }
                  });
                  this.damageSoftBarricadesInRadius(ex, ey, radius, (b._aoeDamage || b.damage || 10));
                  if (b._clusterBomb) {
                    const count = 8; const minD = Math.max(60, Math.floor(radius * 1.2)); const maxD = Math.max(minD + 1, Math.floor(radius * 2.0));
                    for (let i = 0; i < count; i += 1) {
                      const base = (i / count) * Math.PI * 2; const jitter = Phaser.Math.FloatBetween(-0.25, 0.25); const ang = base + jitter;
 const dist = Phaser.Math.Between(Math.max(8, Math.floor(radius * 0.60)), Math.max(Math.max(8, Math.floor(radius * 0.60)) + 1, Math.floor(radius * 1.30))); const spd = 420; const vx2 = Math.cos(ang) * spd; const vy2 = Math.sin(ang) * spd;
                      const c = this.bullets.get(ex, ey, 'bullet'); if (!c) continue;
                      c.setActive(true).setVisible(true); c.setCircle(4).setOffset(-4, -4); try { c.setScale(1.1); } catch (_) {}
                      c.setVelocity(vx2, vy2); c.setTint(0xffaa33); c._clusterChild = true; c._startX = ex; c._startY = ey; c._travelMax2 = dist * dist; c._blastRadius = 52; c._aoeDamage = 20;
                      c.update = () => {
                        try {
                          const mx = c.x - c._startX; const my = c.y - c._startY; const travel2 = (mx * mx) + (my * my); let collide2 = false;
                          try { const enemies2 = this.enemies?.getChildren?.() || []; for (let k = 0; k < enemies2.length; k += 1) { const e2 = enemies2[k]; if (!e2?.active) continue; if (e2.isBoss && travel2 < (16 * 16)) continue; const rect2 = e2.getBounds?.() || new Phaser.Geom.Rectangle(e2.x - 6, e2.y - 6, 12, 12); if (Phaser.Geom.Intersects.CircleToRectangle(new Phaser.Geom.Circle(c.x, c.y, 6), rect2)) { collide2 = true; break; } } } catch (_) {}
                          try { const scanBarr = (grp) => { const arr2 = grp?.getChildren?.() || []; for (let k = 0; k < arr2.length && !collide2; k += 1) { const s2 = arr2[k]; if (!s2?.active) continue; const rectB = s2.getBounds?.() || new Phaser.Geom.Rectangle(s2.x - 8, s2.y - 8, 16, 16); if (Phaser.Geom.Intersects.CircleToRectangle(new Phaser.Geom.Circle(c.x, c.y, 6), rectB)) { collide2 = true; break; } } }; scanBarr(this.barricadesHard); scanBarr(this.barricadesSoft); } catch (_) {}
                          if ((mx * mx + my * my) >= c._travelMax2 || collide2) {
                            const cx = c.x; const cy = c.y; const rr = c._blastRadius || 60; const r2c = rr * rr;
                            try { impactBurst(this, cx, cy, { color: 0xffaa33, size: 'large', radius: rr }); } catch (_) {}
                            try { const arr2 = this.enemies?.getChildren?.() || []; for (let m = 0; m < arr2.length; m += 1) { const t = arr2[m]; if (!t?.active) continue; const ddx = t.x - cx; const ddy = t.y - cy; if ((ddx * ddx + ddy * ddy) <= r2c) { const dmg2 = c._aoeDamage || 20; if (t.isDummy) { this._dummyDamage = (this._dummyDamage || 0) + dmg2; } else { if (typeof t.hp !== 'number') t.hp = t.maxHp || 20; t.hp -= dmg2; if (t.hp <= 0) { this.killEnemy(t); } } } } } catch (_) {}
                            try { c.destroy(); } catch (_) {}
                          }
                        } catch (_) { try { c.destroy(); } catch (__ ) {} }
                      };
                    }
                  }
                  if (b._firefield) {
                    this.spawnFireField(ex, ey, radius);
                    const r2n = radius * radius; const nowI = this.time.now;
                    this.enemies.getChildren().forEach((other) => {
                      if (!other?.active || other.isDummy) return;
                      const dxn = other.x - ex; const dyn = other.y - ey;
                      if ((dxn * dxn + dyn * dyn) <= r2n) {
                        other._igniteValue = Math.min(10, (other._igniteValue || 0) + 5);
                        if ((other._igniteValue || 0) >= 10) {
                          other._ignitedUntil = nowI + 2000; other._igniteValue = 0;
                          if (!other._igniteIndicator) { other._igniteIndicator = this.add.graphics(); try { other._igniteIndicator.setDepth(9000); } catch (_) {} other._igniteIndicator.fillStyle(0xff3333, 1).fillCircle(0, 0, 2); }
                          try { other._igniteIndicator.setPosition(other.x, other.y - 14); } catch (_) {}
                        }
                      }
                    });
                  }
                  try { b.destroy(); } catch (_) {}
                  return;
                }
              }
            }
          }
          // Check if reached or passed target point
          const dxs = (b.x - b._startX); const dys = (b.y - b._startY);
          const prog = dxs * (sx) + dys * (sy);
          const dx = b.x - b._targetX; const dy = b.y - b._targetY;
          const nearTarget = (dx * dx + dy * dy) <= 64; // within 8px
          const passed = prog >= b._targetLen2 - 1;
          if (nearTarget || passed) {
            if (b._smartExplosives) {
              // Become a mine if no enemy in detection radius
              b._mine = true;
              b._mineExpireAt = this.time.now + 8000; // safety timeout
              try { b.setVelocity(0, 0); } catch (_) {}
              try { b.body?.setVelocity?.(0, 0); } catch (_) {}
              try { b.setTint(0x55ff77); } catch (_) {}
              return;
            }
            // Explode at target/current pos
            const ex = b.x; const ey = b.y;
            try { impactBurst(this, ex, ey, { color: 0xffaa33, size: 'large', radius: b._blastRadius || 40 }); } catch (_) {}
            const radius = b._blastRadius || 70; const r2 = radius * radius;
            this.enemies.getChildren().forEach((other) => {
              if (!other.active) return;
              const ddx = other.x - ex; const ddy = other.y - ey;
              if ((ddx * ddx + ddy * ddy) <= r2) {
                const aoe = (b._aoeDamage || b.damage || 10);
                if (other.isDummy) {
                  this._dummyDamage = (this._dummyDamage || 0) + aoe;
                } else {
                  if (typeof other.hp !== 'number') other.hp = other.maxHp || 20;
                  other.hp -= aoe;
                  if (other.hp <= 0) { this.killEnemy(other); }
                }
              }
            });
            // Also damage nearby destructible barricades
            this.damageSoftBarricadesInRadius(ex, ey, radius, (b._aoeDamage || b.damage || 10));
            // Cluster Bomb: emit 8 child bomblets
            if (b._clusterBomb) {
              const count = 8; const minD = Math.max(60, Math.floor(radius * 1.2)); const maxD = Math.max(minD + 1, Math.floor(radius * 2.0));
              for (let i = 0; i < count; i += 1) {
                const base = (i / count) * Math.PI * 2; const jitter = Phaser.Math.FloatBetween(-0.25, 0.25);
                const ang = base + jitter;
 const dist = Phaser.Math.Between(Math.max(8, Math.floor(radius * 0.60)), Math.max(Math.max(8, Math.floor(radius * 0.60)) + 1, Math.floor(radius * 1.30))); const spd = 420; const vx2 = Math.cos(ang) * spd; const vy2 = Math.sin(ang) * spd;
                const c = this.bullets.get(ex, ey, 'bullet'); if (!c) continue;
                c.setActive(true).setVisible(true); c.setCircle(4).setOffset(-4, -4); try { c.setScale(1.1); } catch (_) {}
                c.setVelocity(vx2, vy2); c.setTint(0xffaa33); c._clusterChild = true; c._startX = ex; c._startY = ey; c._travelMax2 = dist * dist; c._blastRadius = 52; c._aoeDamage = 20;
                c.update = () => {
                  try {
                    const mx = c.x - c._startX; const my = c.y - c._startY; const travel2 = (mx * mx) + (my * my); let collide2 = false;
                    try {
                      const enemies2 = this.enemies?.getChildren?.() || [];
                      for (let k = 0; k < enemies2.length; k += 1) {
                        const e2 = enemies2[k]; if (!e2?.active) continue;
                        if (e2.isBoss && c._ignoreBossForTravel) continue;
                        let rect2;
                        if (e2.isBoss) {
                          try {
                            const hb2 = (e2._hitbox && e2._hitbox.body) ? e2._hitbox.body : e2.body;
                            const w2 = Math.max(1, Math.floor((hb2 && hb2.width) ? hb2.width : 36));
                            const h2 = Math.max(1, Math.floor((hb2 && hb2.height) ? hb2.height : 36));
                            rect2 = new Phaser.Geom.Rectangle(Math.floor(e2.x - w2 / 2), Math.floor(e2.y - h2 / 2), w2, h2);
                          } catch (_) {
                            rect2 = new Phaser.Geom.Rectangle(e2.x - 18, e2.y - 18, 36, 36);
                          }
                        } else {
                          rect2 = e2.getBounds?.() || new Phaser.Geom.Rectangle(e2.x - 6, e2.y - 6, 12, 12);
                        }
                        if (Phaser.Geom.Intersects.CircleToRectangle(new Phaser.Geom.Circle(c.x, c.y, 6), rect2)) { collide2 = true; break; }
                      }
                    } catch (_) {}
                    try { const scanBarr = (grp) => { const arr2 = grp?.getChildren?.() || []; for (let k = 0; k < arr2.length && !collide2; k += 1) { const s2 = arr2[k]; if (!s2?.active) continue; const rectB = s2.getBounds?.() || new Phaser.Geom.Rectangle(s2.x - 8, s2.y - 8, 16, 16); if (Phaser.Geom.Intersects.CircleToRectangle(new Phaser.Geom.Circle(c.x, c.y, 6), rectB)) { collide2 = true; break; } } }; scanBarr(this.barricadesHard); scanBarr(this.barricadesSoft); } catch (_) {}
                    if (travel2 >= c._travelMax2 || collide2) {
                      const cx = c.x; const cy = c.y; const rr = c._blastRadius || 60; const r2c = rr * rr;
                      try { impactBurst(this, cx, cy, { color: 0xffaa33, size: 'large', radius: rr }); } catch (_) {}
                      try { const list = this.enemies?.getChildren?.() || []; for (let m = 0; m < list.length; m += 1) { const t = list[m]; if (!t?.active) continue; const ddx = t.x - cx; const ddy = t.y - cy; if ((ddx * ddx + ddy * ddy) <= r2c) { const dmg2 = c._aoeDamage || 20; if (t.isDummy) { this._dummyDamage = (this._dummyDamage || 0) + dmg2; } else { if (typeof t.hp !== 'number') t.hp = t.maxHp || 20; t.hp -= dmg2; if (t.hp <= 0) { this.killEnemy(t); } } } } } catch (_) {}
                      try { c.destroy(); } catch (_) {}
                    }
                  } catch (_) { try { c.destroy(); } catch (__ ) {} }
                };
              }
            }
            if (b._firefield) {
              this.spawnFireField(ex, ey, radius);
              const r2n = radius * radius; const nowI = this.time.now;
              this.enemies.getChildren().forEach((other) => {
                if (!other?.active || other.isDummy) return;
                const dxn = other.x - ex; const dyn = other.y - ey;
                if ((dxn * dxn + dyn * dyn) <= r2n) {
                  other._igniteValue = Math.min(10, (other._igniteValue || 0) + 5);
                  if ((other._igniteValue || 0) >= 10) {
                    other._ignitedUntil = nowI + 2000; other._igniteValue = 0;
                    if (!other._igniteIndicator) { other._igniteIndicator = this.add.graphics(); try { other._igniteIndicator.setDepth(9000); } catch (_) {} other._igniteIndicator.fillStyle(0xff3333, 1).fillCircle(0, 0, 2); }
                    try { other._igniteIndicator.setPosition(other.x, other.y - 14); } catch (_) {}
                  }
                }
              });
            }
            try { b.destroy(); } catch (_) {}
          }
        };
        b.on('destroy', () => b._g?.destroy());
      }
      return;
    }
    for (let i = 0; i < pellets; i += 1) {
      let angle = baseAngle;
      if (pellets === 1) {
        // Single bullet: apply random deviation within the total spread cone
        const off = Phaser.Math.FloatBetween(-0.5, 0.5) * totalSpreadRad;
        angle += off;
      } else {
        // Multi-pellet: distribute across the total spread with slight jitter
        const t = (i / (pellets - 1)) - 0.5;
        angle += t * totalSpreadRad;
        if (totalSpreadRad > 0) angle += Phaser.Math.FloatBetween(-0.1, 0.1) * totalSpreadRad;
      }
      // Increase bullet speed for all non-rocket projectiles
      const effSpeed = (weapon.projectile === 'rocket') ? weapon.bulletSpeed : Math.floor((weapon.bulletSpeed || 0) * 1.25);
      const vx = Math.cos(angle) * effSpeed;
      const vy = Math.sin(angle) * effSpeed;
      const b = this.bullets.get(startX, startY, 'bullet');
      if (!b) continue;
      b.setActive(true).setVisible(true);
      b.setCircle(2).setOffset(-2, -2);
      b.setVelocity(vx, vy);
      // Bullet tint: default white; Explosive Core uses orange bullets
      if (weapon._core === 'blast') b.setTint(0xff8800); else b.setTint(0xffffff);
      b.damage = weapon.damage;
      b._core = weapon._core || null;
      b._igniteOnHit = weapon._igniteOnHit || 0;
      b._toxinOnHit = weapon._toxinOnHit || 0;
      b._stunOnHit = weapon._stunOnHit || 0;
      if (b._core === 'pierce') { b._pierceLeft = 1; }
      // Tracer setup: particle thruster for stun/toxin/incendiary; blue line for pierce core
      try {
        // Particle tracer colors
        const tracerColor = (() => {
          if (b._toxinOnHit > 0) return 0x33ff66; // green
          if (b._igniteOnHit > 0) return 0xffaa33; // orange
          if (b._stunOnHit > 0) return 0xffee66; // yellow
          return null;
        })();
        if (b._core === 'pierce') {
          const g = this.add.graphics(); b._g = g; try { g.setDepth(8000); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
          b.update = () => {
            const view = this.cameras?.main?.worldView;
            if (view && !view.contains(b.x, b.y)) { b.destroy(); return; }
            try {
              g.clear();
              const vx0 = b.body?.velocity?.x || vx; const vy0 = b.body?.velocity?.y || vy;
              const ang = Math.atan2(vy0, vx0);
              const tail = 10;
              const tx = b.x - Math.cos(ang) * tail; const ty = b.y - Math.sin(ang) * tail;
              g.lineStyle(3, 0x2266ff, 0.5).beginPath().moveTo(tx, ty).lineTo(b.x, b.y).strokePath();
              g.lineStyle(1, 0xaaddff, 0.9).beginPath().moveTo(tx + Math.cos(ang) * 2, ty + Math.sin(ang) * 2).lineTo(b.x, b.y).strokePath();
            } catch (_) {}
          };
          b.on('destroy', () => { try { b._g?.destroy(); } catch (_) {} });
        } else if (tracerColor && weapon._core !== 'blast') {
          // Emit stronger thruster-like particles behind the bullet each frame
          b.update = () => {
            const view = this.cameras?.main?.worldView;
            if (view && !view.contains(b.x, b.y)) { b.destroy(); return; }
            try {
              const vx0 = b.body?.velocity?.x || vx; const vy0 = b.body?.velocity?.y || vy;
              const back = Math.atan2(vy0, vx0) + Math.PI;
              const ex = b.x + Math.cos(back) * 5; const ey = b.y + Math.sin(back) * 5;
              // Scale tracer strength by effect type
              const isIgnite = (b._igniteOnHit || 0) > 0;
              const isToxin  = (b._toxinOnHit  || 0) > 0;
              const isStun   = (b._stunOnHit   || 0) > 0;
              let count = 2, size = 2, lifeMs = 100, speedMin = 90, speedMax = 180, alpha = 0.9;
              if (isIgnite) { count = 3; size = 2; lifeMs = 120; speedMin = 100; speedMax = 200; alpha = 0.95; }
              else if (isToxin) { count = 2; size = 2; lifeMs = 110; speedMin = 90; speedMax = 190; alpha = 0.92; }
              else if (isStun) { count = 2; size = 2; lifeMs = 100; speedMin = 90; speedMax = 180; alpha = 0.9; }
              pixelSparks(this, ex, ey, { angleRad: back, count, spreadDeg: 8, speedMin, speedMax, lifeMs, color: tracerColor, size, alpha });
            } catch (_) {}
          };
          b.on('destroy', () => b._g?.destroy());
        } else {
          b.update = () => {
            const view = this.cameras?.main?.worldView;
            if (view && !view.contains(b.x, b.y)) { b.destroy(); return; }
          };
          b.on('destroy', () => b._g?.destroy());
        }
      } catch (_) {
        b.update = () => {
          const view = this.cameras?.main?.worldView;
          if (view && !view.contains(b.x, b.y)) { b.destroy(); return; }
        };
      }
      b.on('destroy', () => b._g?.destroy());
    }
    // Burst Fire core: schedule additional shots within a short window
    if (weapon._burstN && weapon._burstN > 1) {
      const wid = this.gs.activeWeapon;
      const ang = baseAngle;
      const perGap = Math.max(30, weapon._burstGapMs || 70);
      for (let k = 1; k < weapon._burstN; k += 1) {
        this.time.delayedCall(perGap * k, () => {
          if (this.gs.activeWeapon !== wid) return;
          const cap = this.getActiveMagCapacity();
          this.ensureAmmoFor(wid, cap);
          const ammo = this.ammoByWeapon[wid] ?? 0;
          if (ammo <= 0 || this.reload.active) return;
          const effSpeed = Math.floor((weapon.bulletSpeed || 0) * 1.25);
          const vx = Math.cos(ang) * effSpeed;
          const vy = Math.sin(ang) * effSpeed;
          const m = getWeaponMuzzleWorld(this, 3);
          try {
            const wid = this.gs.activeWeapon;
            const allowed = new Set(['pistol','mgl','rifle','battle_rifle','shotgun','smg','guided_missiles','smart_hmg','minigun','rocket']);
            if (allowed.has(wid)) {
              const heavy = new Set(['smart_hmg','guided_missiles','minigun','rocket','shotgun','mgl']);
              if (heavy.has(wid)) muzzleFlashSplit(this, m.x, m.y, { angle: ang, color: 0xffee66, count: 3, spreadDeg: 24, length: 16, thickness: 4 });
              else if (wid === 'battle_rifle') muzzleFlash(this, m.x, m.y, { angle: ang, color: 0xffee66, length: 14, thickness: 4 });
              else muzzleFlash(this, m.x, m.y, { angle: ang, color: 0xffee66, length: 10, thickness: 3 });
              // Burst yellow muzzle pixels for bursts (wider overall, special battle rifle)
              const base = ang;
              if (heavy.has(wid)) {
                const burst = { spreadDeg: 36, speedMin: 130, speedMax: 260, lifeMs: 180, color: 0xffee66, size: 2, alpha: 0.75 };
                pixelSparks(this, m.x, m.y, { angleRad: base, count: 12, ...burst });
              } else if (wid === 'battle_rifle') {
                const burst = { spreadDeg: 30, speedMin: 125, speedMax: 230, lifeMs: 185, color: 0xffee66, size: 2, alpha: 0.85 };
                pixelSparks(this, m.x, m.y, { angleRad: base, count: 10, ...burst });
              } else {
                const burst = { spreadDeg: 28, speedMin: 100, speedMax: 190, lifeMs: 165, color: 0xffee66, size: 1, alpha: 0.7 };
                pixelSparks(this, m.x, m.y, { angleRad: base, count: 8, ...burst });
              }
            }
          } catch (_) {}
          try { this._spawnBulletCasing(this.gs.activeWeapon); } catch (_) {}
          const bN = this.bullets.get(m.x, m.y, 'bullet');
          if (!bN) return;
          bN.setActive(true).setVisible(true);
          bN.setCircle(2).setOffset(-2, -2);
          bN.setVelocity(vx, vy);
          bN.setTint(0xffffff);
          bN.damage = weapon.damage;
          bN._core = weapon._core || null;
          bN._igniteOnHit = weapon._igniteOnHit || 0;
          bN._toxinOnHit = weapon._toxinOnHit || 0;
          bN._stunOnHit = weapon._stunOnHit || 0;
          if (bN._core === 'pierce') { bN._pierceLeft = 1; }
          bN.update = () => {
            const view = this.cameras?.main?.worldView;
            if (view && !view.contains(bN.x, bN.y)) { try { bN.destroy(); } catch (_) {} }
          };
          bN.on('destroy', () => bN._g?.destroy());
          // consume ammo and sync UI
          this.ammoByWeapon[wid] = Math.max(0, ammo - 1);
          this.registry.set('ammoInMag', this.ammoByWeapon[wid]);
        });
      }
    }
    // 2Tap Trigger: schedule an automatic second accurate shot shortly after
    if (weapon._twoTap) {
      const wid = this.gs.activeWeapon;
      const angle2 = baseAngle;
      this.time.delayedCall(70, () => {
        if (this.gs.activeWeapon !== wid) return;
        const cap = this.getActiveMagCapacity();
        this.ensureAmmoFor(wid, cap);
        const ammo = this.ammoByWeapon[wid] ?? 0;
        if (ammo <= 0 || this.reload.active) return;
        const effSpeed = Math.floor((weapon.bulletSpeed || 0) * 1.25);
        const vx = Math.cos(angle2) * effSpeed;
        const vy = Math.sin(angle2) * effSpeed;
        const m2 = getWeaponMuzzleWorld(this, 3);
        try {
          const wid = this.gs.activeWeapon;
          const allowed = new Set(['pistol','mgl','rifle','battle_rifle','shotgun','smg','guided_missiles','smart_hmg','minigun','rocket']);
          if (allowed.has(wid)) {
            const heavy = new Set(['smart_hmg','guided_missiles','minigun','rocket','shotgun','mgl']);
            if (heavy.has(wid)) muzzleFlashSplit(this, m2.x, m2.y, { angle: angle2, color: 0xffee66, count: 3, spreadDeg: 24, length: 16, thickness: 4 });
            else if (wid === 'battle_rifle') muzzleFlash(this, m2.x, m2.y, { angle: angle2, color: 0xffee66, length: 14, thickness: 4 });
            else muzzleFlash(this, m2.x, m2.y, { angle: angle2, color: 0xffee66, length: 10, thickness: 3 });
            const base = angle2;
            if (heavy.has(wid)) {
              const burst = { spreadDeg: 36, speedMin: 130, speedMax: 260, lifeMs: 180, color: 0xffee66, size: 2, alpha: 0.75 };
              pixelSparks(this, m2.x, m2.y, { angleRad: base, count: 12, ...burst });
            } else if (wid === 'battle_rifle') {
              const burst = { spreadDeg: 30, speedMin: 125, speedMax: 230, lifeMs: 185, color: 0xffee66, size: 2, alpha: 0.85 };
              pixelSparks(this, m2.x, m2.y, { angleRad: base, count: 10, ...burst });
            } else {
              const burst = { spreadDeg: 28, speedMin: 100, speedMax: 190, lifeMs: 165, color: 0xffee66, size: 1, alpha: 0.7 };
              pixelSparks(this, m2.x, m2.y, { angleRad: base, count: 8, ...burst });
            }
          }
        } catch (_) {}
        try { this._spawnBulletCasing(this.gs.activeWeapon); } catch (_) {}
        const b2 = this.bullets.get(m2.x, m2.y, 'bullet');
        if (!b2) return;
        b2.setActive(true).setVisible(true);
        b2.setCircle(2).setOffset(-2, -2);
        b2.setVelocity(vx, vy);
         // Tint rules match primary: Explosive Core turns bullet orange
         if (weapon._core === 'blast') b2.setTint(0xff8800); else b2.setTint(0xffffff);
         b2.damage = weapon.damage;
         b2._core = weapon._core || null;
         b2._igniteOnHit = weapon._igniteOnHit || 0;
         b2._toxinOnHit = weapon._toxinOnHit || 0;
         b2._stunOnHit = weapon._stunOnHit || 0;
         if (b2._core === 'pierce') { b2._pierceLeft = 1; }
        try {
          const tracerColor2 = (() => {
            if (b2._toxinOnHit > 0) return 0x33ff66; // green
            if (b2._igniteOnHit > 0) return 0xffaa33; // orange
            if (b2._stunOnHit > 0) return 0xffee66; // yellow
            return null;
          })();
          if (b2._core === 'pierce') {
            const g2 = this.add.graphics(); b2._g = g2; try { g2.setDepth(8000); g2.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
            b2.update = () => {
              const view = this.cameras?.main?.worldView; if (view && !view.contains(b2.x, b2.y)) { try { b2.destroy(); } catch (_) {} return; }
              try {
                g2.clear();
                const vx0 = b2.body?.velocity?.x || vx; const vy0 = b2.body?.velocity?.y || vy;
                const ang = Math.atan2(vy0, vx0);
                const tail = 10;
                const tx = b2.x - Math.cos(ang) * tail; const ty = b2.y - Math.sin(ang) * tail;
                g2.lineStyle(3, 0x2266ff, 0.5).beginPath().moveTo(tx, ty).lineTo(b2.x, b2.y).strokePath();
                g2.lineStyle(1, 0xaaddff, 0.9).beginPath().moveTo(tx + Math.cos(ang) * 2, ty + Math.sin(ang) * 2).lineTo(b2.x, b2.y).strokePath();
              } catch (_) {}
            };
            b2.on('destroy', () => { try { b2._g?.destroy(); } catch (_) {} });
          } else if (tracerColor2 && weapon._core !== 'blast') {
            // Stronger tracer on burst bullets too
            b2.update = () => {
              const view = this.cameras?.main?.worldView; if (view && !view.contains(b2.x, b2.y)) { try { b2.destroy(); } catch (_) {} return; }
              try {
                const vx0 = b2.body?.velocity?.x || vx; const vy0 = b2.body?.velocity?.y || vy;
                const back = Math.atan2(vy0, vx0) + Math.PI;
                const ex = b2.x + Math.cos(back) * 5; const ey = b2.y + Math.sin(back) * 5;
                const isIgnite = (b2._igniteOnHit || 0) > 0;
                const isToxin  = (b2._toxinOnHit  || 0) > 0;
                const isStun   = (b2._stunOnHit   || 0) > 0;
                let count = 2, size = 2, lifeMs = 100, speedMin = 90, speedMax = 180, alpha = 0.9;
                if (isIgnite) { count = 3; size = 2; lifeMs = 120; speedMin = 100; speedMax = 200; alpha = 0.95; }
                else if (isToxin) { count = 2; size = 2; lifeMs = 110; speedMin = 90; speedMax = 190; alpha = 0.92; }
                else if (isStun) { count = 2; size = 2; lifeMs = 100; speedMin = 90; speedMax = 180; alpha = 0.9; }
                pixelSparks(this, ex, ey, { angleRad: back, count, spreadDeg: 8, speedMin, speedMax, lifeMs, color: tracerColor2, size, alpha });
              } catch (_) {}
            };
            b2.on('destroy', () => b2._g?.destroy());
          } else {
            b2.update = () => {
              const view = this.cameras?.main?.worldView;
              if (view && !view.contains(b2.x, b2.y)) { try { b2.destroy(); } catch (_) {} }
            };
            b2.on('destroy', () => b2._g?.destroy());
          }
        } catch (_) {
          b2.update = () => {
            const view = this.cameras?.main?.worldView; if (view && !view.contains(b2.x, b2.y)) { try { b2.destroy(); } catch (_) {} }
          };
        }
        b2.on('destroy', () => b2._g?.destroy());
        // consume ammo and sync UI
        this.ammoByWeapon[wid] = Math.max(0, ammo - 1);
        this.registry.set('ammoInMag', this.ammoByWeapon[wid]);
      });
    }
  }

  _spawnCasingAt(x, y, angle, weaponId = 'rifle') {
    try {
      const allowed = new Set(['pistol', 'rifle', 'battle_rifle', 'shotgun', 'smg', 'minigun']);
      if (!allowed.has(weaponId)) return;
      const ang = (typeof angle === 'number') ? angle : (this.playerFacing || 0);
      const backX = -Math.cos(ang);
      const backY = -Math.sin(ang);
      const color = (weaponId === 'shotgun') ? 0xcc3333 : 0xffee66;
      const w = (weaponId === 'shotgun') ? 4 : 3;
      const h = (weaponId === 'shotgun') ? 2 : 1.5;
      const g = this.add.rectangle(x, y, w, h, color, 0.9);
      try { g.setDepth(9050); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
      if (!this._bulletCasings) this._bulletCasings = [];
      const backKick = Phaser.Math.FloatBetween(30, 46); // slightly stronger push to gun-back direction
      const upKick = Phaser.Math.FloatBetween(42, 66);   // stronger upward pop
      this._bulletCasings.push({
        g,
        x,
        y,
        vx: backX * backKick,
        vy: (backY * backKick) - upKick,
        ax: 0,
        ay: Phaser.Math.FloatBetween(1400, 1900), // accelerates down
        bornAt: this.time.now,
        lifeMs: 200,
        fading: false,
      });
    } catch (_) {}
  }

  _spawnBulletCasing(weaponId) {
    try {
      const p = getWeaponBarrelPoint(this, 0.5, 2);
      this._spawnCasingAt(p.x, p.y, this.playerFacing || 0, weaponId);
    } catch (_) {}
  }

  update() {
    // During intro cinematic, block player movement/actions
    const nowIntro = this.time.now;
    if (this._cinematicActive && nowIntro < (this._cinematicUntil || 0)) {
      try { (this.playerCollider || this.player)?.setVelocity(0, 0); } catch (_) {}
      try { if (this.player) this.player.body.moves = false; } catch (_) {}
      // Keep boss HUD updated while frozen
      if (this.boss && this.boss.active) {
        try { this.registry.set('bossHp', this.boss.hp); this.registry.set('bossHpMax', this.boss.maxHp); this.registry.set('bossActive', true); this.registry.set('bossName', this.boss.bossType || this._bossId || ''); } catch (_) {}
      }
      return;
    } else {
      try { if (this.player) this.player.body.moves = true; } catch (_) {}
    }
    // Update dash charge display for UI
    this.registry.set('dashCharges', this.dash.charges);
    // Dash regen progress for UI (0..1) for the next slot
    let prog = 0;
    const eff = getPlayerEffects(this.gs);
    if (this.dash.charges < this.gs.dashMaxCharges && this.dash.regen.length) {
      const now = this.time.now;
      const nextReady = Math.min(...this.dash.regen);
      const remaining = Math.max(0, nextReady - now);
      const denom = (eff.dashRegenMs || this.gs.dashRegenMs || 1000);
      prog = 1 - Math.min(1, remaining / denom);
    } else {
      prog = 1;
    }
    this.registry.set('dashRegenProgress', prog);
    // Boss AI updates (attacks driven here; movement via shooter pathing)
    try { if (this.boss && this.boss.active && !this._cinematicActive) this.updateBossAI(); } catch (_) {}
    // Boss HUD sync
    if (this.boss && this.boss.active) {
      try { this.registry.set('bossHp', this.boss.hp); this.registry.set('bossHpMax', this.boss.maxHp); this.registry.set('bossActive', true); this.registry.set('bossName', this.boss.bossType || this._bossId || ''); } catch (_) {}
    } else {
      try { this.registry.set('bossActive', false); } catch (_) {}
    }

    // Dash handling
    const now = this.time.now;
    if (this.inputMgr.pressedDash && now >= this.dash.cooldownUntil && this.dash.charges > 0) {
      const dir = this.inputMgr.moveVec;
      const angle = (dir.x !== 0 || dir.y !== 0) ? Math.atan2(dir.y, dir.x) : this.playerFacing;
      const dashSpeed = 520;
      const dur = 180;
      this.dash.active = true;
      this.dash.until = now + dur;
      this.dash.cooldownUntil = now + 600;
      this.dash.vx = Math.cos(angle) * dashSpeed;
      this.dash.vy = Math.sin(angle) * dashSpeed;
      this.player.iframesUntil = now + dur; // i-frames while dashing
      // Initialize dash trail start
      this._dashTrailLast = { x: this.player.x, y: this.player.y };
      // consume charge and queue regen
      this.dash.charges -= 1;
      this.dash.regen.push(now + (eff.dashRegenMs || this.gs.dashRegenMs));
    }

    if (this.dash.active && now < this.dash.until) {
      // Draw a fading white tracer behind the player while dashing
      try {
        if (this._dashTrailLast) {
          const g = this.add.graphics();
          try { g.setDepth(9800); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
          g.lineStyle(4, 0xffffff, 0.9);
          g.beginPath(); g.moveTo(this._dashTrailLast.x, this._dashTrailLast.y); g.lineTo(this.player.x, this.player.y); g.strokePath();
          this.tweens.add({ targets: g, alpha: 0, duration: 220, ease: 'Quad.easeOut', onComplete: () => { try { g.destroy(); } catch (_) {} } });
          this._dashTrailLast.x = this.player.x; this._dashTrailLast.y = this.player.y;
        }
      } catch (_) {}
      (this.playerCollider || this.player).setVelocity(this.dash.vx, this.dash.vy);
    } else {
      this.dash.active = false;
      this._dashTrailLast = null;
      const mv = this.inputMgr.moveVec;
      let firingSlow = 1;
      if (this._minigunFiringUntil && now < this._minigunFiringUntil) {
        const w = getEffectiveWeapon(this.gs, this.gs.activeWeapon);
        firingSlow = (typeof w._firingMoveMult === 'number') ? w._firingMoveMult : 0.3;
      }
      const speed = 200 * (eff.moveSpeedMult || 1) * firingSlow;
      (this.playerCollider || this.player).setVelocity(mv.x * speed, mv.y * speed);
    }

    // Regen charges
    if (this.dash.regen.length) {
      const ready = this.dash.regen.filter((t) => now >= t);
      if (ready.length) {
        const remaining = this.dash.regen.filter((t) => now < t);
        this.dash.regen = remaining;
        this.dash.charges = Math.min(this.dash.charges + ready.length, this.gs.dashMaxCharges);
      }
    }

    // Shooting with LMB per weapon fireRate
    const weapon = getEffectiveWeapon(this.gs, this.gs.activeWeapon);
    const isRail = !!weapon.isRailgun;
    const isLaser = !!weapon.isLaser;
    const isFlame = !!weapon.isFlamethrower;
    if (this.gs?.shootingRange && this._rangeInfiniteAmmo) {
      try {
        const wid = this.gs.activeWeapon;
        const cap = this.getActiveMagCapacity();
        this.ensureAmmoFor(wid, cap, true);
        this.ammoByWeapon[wid] = cap;
        this.registry.set('ammoInMag', cap);
        this.registry.set('magSize', cap);
        this.reload.active = false;
        this.reload.duration = 0;
        this.registry.set('reloadActive', false);
        this.registry.set('reloadProgress', 1);
      } catch (_) {}
    }
    // Finish reload if timer elapsed; update reload progress for UI
    if (this.reload?.active) {
      const now = this.time.now;
      const remaining = Math.max(0, this.reload.until - now);
      const dur = Math.max(1, this.reload.duration || this.getActiveReloadMs());
      const prog = 1 - Math.min(1, remaining / dur);
      this.registry.set('reloadActive', true);
      this.registry.set('reloadProgress', prog);
      if (now >= this.reload.until) {
        const wid = this.gs.activeWeapon;
        const cap = this.getActiveMagCapacity();
        this.ensureAmmoFor(wid, cap);
        this.ammoByWeapon[wid] = cap;
        this.registry.set('ammoInMag', this.ammoByWeapon[wid]);
        this.registry.set('magSize', cap);
        this.reload.active = false;
        this.reload.duration = 0;
        this.registry.set('reloadActive', false);
        this.registry.set('reloadProgress', 1);
      }
    } else {
      this.registry.set('reloadActive', false);
    }

    // Stealth decoy timeout cleanup
    if (this.isStealthed()) {
      if (!this._stealth?.decoy?.active || now >= (this._stealth?.until || 0)) {
        this.endStealthDecoy();
      }
    }

    // Shooting Range interactions
    if (this.gs?.shootingRange) {
      // Update dummy label position and text
      if (this.dummy && this.dummyLabel) {
        try {
          this.dummyLabel.setPosition(this.dummy.x, this.dummy.y - 16);
          this.dummyLabel.setText(`DMG: ${this._dummyDamage | 0}`);
        } catch (_) {}
      }
      // Context prompts
      const playerRect = this.player.getBounds();
      const nearTerminal = this.terminalZone && Phaser.Geom.Intersects.RectangleToRectangle(playerRect, this.terminalZone.getBounds());
      const nearPortal = this.portal && Phaser.Geom.Intersects.RectangleToRectangle(playerRect, this.portal.getBounds());
      // Expand dummy interaction to a radius around it instead of strict sprite-bounds overlap
      const nearDummy = !!(this.dummy && (() => { const dx = this.player.x - this.dummy.x; const dy = this.player.y - this.dummy.y; const r = 72; return (dx * dx + dy * dy) <= (r * r); })());
      if (nearTerminal) this.prompt.setText('E: Open Terminal');
      else if (nearDummy) this.prompt.setText('E: Reset Dummy Damage/Effects');
      else if (nearPortal) this.prompt.setText('E: Return to Hub');
      else this.prompt.setText('Shooting Range');

      if (this.inputMgr.pressedInteract) {
        if (nearTerminal) this.openTerminalPanel?.();
        if (nearDummy) {
          this._dummyDamage = 0;
          if (this.dummy?.active) {
            const d = this.dummy;
            d._igniteValue = 0; d._toxinValue = 0; d._stunValue = 0;
            d._ignitedUntil = 0; d._toxinedUntil = 0; d._stunnedUntil = 0;
            d._toxinPartial = 0;
            try { if (d._igniteIndicator) { d._igniteIndicator.destroy(); } } catch (_) {}
            try { if (d._toxinIndicator) { d._toxinIndicator.destroy(); } } catch (_) {}
            try { if (d._stunIndicator) { d._stunIndicator.destroy(); } } catch (_) {}
            d._igniteIndicator = null; d._toxinIndicator = null; d._stunIndicator = null;
          }
        }
        if (nearPortal) {
          this.gs.nextScene = SceneKeys.Hub;
          SaveManager.saveToLocal(this.gs);
          this.scene.start(SceneKeys.Hub);
        }
      }
    }
    // Track and update ammo registry on weapon change or capacity change
    if (this._lastActiveWeapon !== this.gs.activeWeapon) {
      this._lastActiveWeapon = this.gs.activeWeapon;
      this._minigunSpin = 0;
      this._minigunSpreadT = 0;
      this._minigunFiringUntil = 0;
      try {
        if (this._flame?.coneG) { this._flame.coneG.destroy(); }
      } catch (_) {}
      this._flame = null;
      const cap = this.getActiveMagCapacity();
      this.ensureAmmoFor(this._lastActiveWeapon, cap);
      this.registry.set('ammoInMag', this.ammoByWeapon[this._lastActiveWeapon]);
      this.registry.set('magSize', cap);
    } else {
      // Keep registry in sync in case mods/cores change capacity
      const cap = this.getActiveMagCapacity();
      this.ensureAmmoFor(this._lastActiveWeapon, cap, true);
      this.registry.set('magSize', cap);
      this.registry.set('ammoInMag', this.ammoByWeapon[this._lastActiveWeapon]);
    }
    // Detect if the loadout menu is open in the UI scene; when open, suppress firing.
    let loadoutOpen = false;
    try {
      const uiScene = this.scene.get(SceneKeys.UI);
      if (uiScene && uiScene.loadout && uiScene.loadout.panel) loadoutOpen = true;
    } catch (_) {}

    // Update spread heat each frame based on whether player is holding fire
    const dt = (this.game?.loop?.delta || 16.7) / 1000;
    if (weapon.isMinigun) {
      if (this._minigunSpin === undefined) this._minigunSpin = 0;
      if (this._minigunSpreadT === undefined) this._minigunSpreadT = 0;
      const holding = !loadoutOpen && this.inputMgr.isLMBDown;
      const spinMult = (typeof weapon._spinUpMult === 'number') ? weapon._spinUpMult : 1;
      const spinUpPerSec = 10 * spinMult; // 0 -> 10 in 1s
      const spinDownPerSec = 5; // 10 -> 0 in 2s
      if (holding) this._minigunSpin = Math.min(10, this._minigunSpin + spinUpPerSec * dt);
      else this._minigunSpin = Math.max(0, this._minigunSpin - spinDownPerSec * dt);
      const tightenPerSec = 1; // spread tightens to min in ~1s
      const loosenPerSec = 1;
      const firingNow = (this._minigunFiringUntil && now < this._minigunFiringUntil);
      if (firingNow) this._minigunSpreadT = Math.min(1, this._minigunSpreadT + tightenPerSec * dt);
      else this._minigunSpreadT = Math.max(0, this._minigunSpreadT - loosenPerSec * dt);
      // Barrel spin "breeze" VFX near the muzzle
      if (this._minigunSpin > 0) {
        if (!this._minigunSpinFxAt) this._minigunSpinFxAt = 0;
        if (now >= this._minigunSpinFxAt) {
          const p = getWeaponBarrelPoint(this, 0.9, 1);
          pixelSparks(this, p.x, p.y, { angleRad: Phaser.Math.FloatBetween(0, Math.PI * 2), count: 3, spreadDeg: 60, speedMin: 20, speedMax: 60, lifeMs: 140, color: 0xffffff, size: 1, alpha: 0.6 });
          this._minigunSpinFxAt = now + 70;
        }
      }
    } else {
      this._minigunSpin = 0;
      this._minigunSpreadT = 0;
    }
    if (this._spreadHeat === undefined) this._spreadHeat = 0;
    const rampPerSec = 0.7; // time to max ~1.4s holding
    const coolPerSec = 1.2; // cool to 0 in ~0.8s
    if (!loadoutOpen && this.inputMgr.isLMBDown && !weapon.singleFire && !isRail && !isLaser && !isFlame) {
      this._spreadHeat = Math.min(1, this._spreadHeat + rampPerSec * dt);
    } else {
      this._spreadHeat = Math.max(0, this._spreadHeat - coolPerSec * dt);
    }
    // Robust single-click detect: Phaser pointer.justDown or edge from previous frame
    const ptr = this.inputMgr.pointer;
    if (this._lmbWasDown === undefined) this._lmbWasDown = false;
    const edgeDown = (!this._lmbWasDown) && !!ptr.isDown && ((ptr.buttons & 1) === 1);
    const wantsClick = !!ptr.justDown || edgeDown;
    if (!loadoutOpen) {
      if (this.isStealthed() && this.inputMgr.isLMBDown) this.endStealthDecoy();
      if (isRail) {
        this.handleRailgunCharge(this.time.now, weapon, ptr);
      }
      // Laser handling (continuous)
      if (isLaser) {
        this.handleLaser(this.time.now, weapon, ptr, dt);
      }
      // Flamethrower handling (continuous)
      if (isFlame) {
        this.handleFlamethrower(this.time.now, weapon, ptr, dt);
      }
      const wantsShot = (!isRail && !isLaser && !isFlame) && (weapon.singleFire ? wantsClick : this.inputMgr.isLMBDown);
      const minigunReady = !weapon.isMinigun || (this._minigunSpin >= 10);
      if (wantsShot && minigunReady && (!this.lastShot || this.time.now - this.lastShot > weapon.fireRateMs)) {
        const cap = this.getActiveMagCapacity();
        const wid = this.gs.activeWeapon;
        this.ensureAmmoFor(wid, cap);
        const ammo = this.ammoByWeapon[wid] ?? 0;
        if (ammo <= 0 || this.reload.active) {
          // Start auto-reload when empty (or continue if already reloading)
          if (!this.reload.active) {
            this.reload.active = true;
            this.reload.duration = this.getActiveReloadMs();
            this.reload.until = this.time.now + this.reload.duration;
            this.registry.set('reloadActive', true);
            this.registry.set('reloadProgress', 0);
          }
        } else {
          this.shoot();
          this.lastShot = this.time.now;
          this.ammoByWeapon[wid] = Math.max(0, ammo - 1);
          this.registry.set('ammoInMag', this.ammoByWeapon[wid]);
          if (weapon.isMinigun) this._minigunFiringUntil = this.time.now + 120;
          // Auto-reload for rocket launcher (mag size 1)
          if (wid === 'rocket' && this.ammoByWeapon[wid] <= 0) {
            if (!this.reload.active) {
              this.reload.active = true;
              this.reload.duration = this.getActiveReloadMs();
              this.reload.until = this.time.now + this.reload.duration;
              this.registry.set('reloadActive', true);
              this.registry.set('reloadProgress', 0);
            }
          }
        }
      }
    }
    this._lmbWasDown = !!ptr.isDown;

    // Swap weapons with Q (only when two are equipped)
    if (Phaser.Input.Keyboard.JustDown(this.inputMgr.keys.q)) {
      const slots = this.gs.equippedWeapons || [];
      const a = this.gs.activeWeapon;
      if (slots[0] && slots[1]) {
        this.gs.activeWeapon = a === slots[0] ? slots[1] : slots[0];
        // Cancel any in-progress reload on weapon swap
        this.reload.active = false;
        this.reload.duration = 0;
        this.registry.set('reloadActive', false);
        // Cancel rail charging/aim if any
        try { if (this.rail?.charging) this.rail.charging = false; } catch (_) {}
        this.endRailAim?.();
        // Clear laser beams if present
        try {
          const lasers = this.laserByWeapon || {};
          Object.values(lasers).forEach((lz) => {
            try { lz?.g?.clear?.(); } catch (_) {}
            try { lz?.mg?.clear?.(); } catch (_) {}
          });
        } catch (_) {}
      }
    }

    // Manual reload (R)
    if (Phaser.Input.Keyboard.JustDown(this.inputMgr.keys.r)) {
      const cap = this.getActiveMagCapacity();
      const wid = this.gs.activeWeapon;
      this.ensureAmmoFor(wid, cap);
      if (!weapon.isLaser && !this.reload.active && (this.ammoByWeapon[wid] ?? 0) < cap) {
        this.reload.active = true;
        this.reload.duration = this.getActiveReloadMs();
        this.reload.until = this.time.now + this.reload.duration;
        this.registry.set('reloadActive', true);
        this.registry.set('reloadProgress', 0);
      }
      // For laser: allow manual cooldown cancel if overheated
      if (weapon.isLaser && this.laser?.overheat) {
        // no-op: keep forced cooldown
      }
    }

    // Ability activation (F)
    if (this.inputMgr.pressedAbility) {
      const nowT = this.time.now;
      const noCd = !!(this.gs?.shootingRange && this._rangeNoAbilityCd);
      if (nowT >= (this.ability.onCooldownUntil || 0)) {
        const abilityId = this.gs?.abilityId || 'ads';
        if (abilityId === 'ads') {
          this.deployADS();
          this.ability.cooldownMs = noCd ? 1 : 10000;
          this.ability.onCooldownUntil = noCd ? nowT : nowT + this.ability.cooldownMs;
        } else if (abilityId === 'bits') {
          this.deployBITs();
          this.ability.cooldownMs = noCd ? 1 : 14000;
          this.ability.onCooldownUntil = noCd ? nowT : nowT + this.ability.cooldownMs;
        } else if (abilityId === 'repulse') {
          this.deployRepulsionPulse();
          this.ability.cooldownMs = noCd ? 1 : 6000; // 6s for Repulsion Pulse
          this.ability.onCooldownUntil = noCd ? nowT : nowT + this.ability.cooldownMs;
        } else if (abilityId === 'caustic_cluster') {
          this.deployCausticCluster();
          this.ability.cooldownMs = noCd ? 1 : 10000;
          this.ability.onCooldownUntil = noCd ? nowT : nowT + this.ability.cooldownMs;
        } else if (abilityId === 'landmine_dispenser') {
          this.deployLandmineDispenser();
          this.ability.cooldownMs = noCd ? 1 : 15000; // 15s
          this.ability.onCooldownUntil = noCd ? nowT : nowT + this.ability.cooldownMs;
        } else if (abilityId === 'stealth_decoy') {
          this.startStealthDecoy();
          this.ability.cooldownMs = noCd ? 1 : 10000;
          this.ability.onCooldownUntil = noCd ? nowT : nowT + this.ability.cooldownMs;
        } else if (abilityId === 'directional_shield') {
          this.startDirectionalShield();
          this.ability.cooldownMs = noCd ? 1 : 15000;
          this.ability.onCooldownUntil = noCd ? nowT : nowT + this.ability.cooldownMs;
        } else if (abilityId === 'vulcan_turret') {
          this.deployVulcanTurret();
          this.ability.cooldownMs = noCd ? 1 : 20000;
          this.ability.onCooldownUntil = noCd ? nowT : nowT + this.ability.cooldownMs;
        } else if (abilityId === 'energy_siphon') {
          if (!this._energySiphon) this._energySiphon = { active: false, until: 0, ratio: 0.25, killHeal: 5, trackedHp: new Map(), nextAmbientAt: 0 };
          this._energySiphon.active = true;
          this._energySiphon.until = nowT + 8000;
          this._energySiphon.ratio = 0.25;
          this._energySiphon.killHeal = 5;
          this._energySiphon.nextAmbientAt = nowT;
          try { this._spawnSiphonAbsorbBurst(); } catch (_) {}
          if (!(this._energySiphon.trackedHp instanceof Map)) this._energySiphon.trackedHp = new Map();
          this._energySiphon.trackedHp.clear();
          try {
            const arr = this.enemies?.getChildren?.() || [];
            for (let i = 0; i < arr.length; i += 1) {
              const e = arr[i];
              if (!e?.active || e.isDummy) continue;
              if (typeof e.hp !== 'number') continue;
              this._energySiphon.trackedHp.set(e, Math.max(0, e.hp || 0));
            }
          } catch (_) {}
          this.ability.cooldownMs = noCd ? 1 : 14000;
          this.ability.onCooldownUntil = noCd ? nowT : nowT + this.ability.cooldownMs;
        }
      }
    }

    // Energy Siphon update: convert dealt damage to shield while active
    try {
      const siphon = this._energySiphon;
      if (siphon?.active) {
        const nowS = this.time.now;
        if (nowS >= (siphon.until || 0)) {
          siphon.active = false;
          siphon.nextAmbientAt = 0;
          try { siphon.trackedHp?.clear?.(); } catch (_) {}
        } else {
          if (nowS >= (siphon.nextAmbientAt || 0)) {
            try { this._spawnSiphonAbsorbBurst(); } catch (_) {}
            siphon.nextAmbientAt = nowS + Phaser.Math.Between(90, 150);
          }
          if (!(siphon.trackedHp instanceof Map)) siphon.trackedHp = new Map();
          const seen = new Set();
          let dealt = 0;
          const arr = this.enemies?.getChildren?.() || [];
          for (let i = 0; i < arr.length; i += 1) {
            const e = arr[i];
            if (!e?.active || e.isDummy) continue;
            if (typeof e.hp !== 'number') continue;
            const cur = Math.max(0, e.hp || 0);
            const prev = siphon.trackedHp.has(e) ? Math.max(0, siphon.trackedHp.get(e) || 0) : cur;
            if (cur < prev) {
              const delta = (prev - cur);
              dealt += delta;
              try { this._spawnSiphonTrace(e.x, e.y, delta, false); } catch (_) {}
            }
            siphon.trackedHp.set(e, cur);
            seen.add(e);
          }
          for (const key of siphon.trackedHp.keys()) {
            if (!key?.active || !seen.has(key)) siphon.trackedHp.delete(key);
          }
          if (dealt > 0) {
            const gain = dealt * (siphon.ratio || 0.25);
            const maxS = Math.max(0, this.gs?.shieldMax || 0);
            this.gs.shield = Math.min(maxS, Math.max(0, (this.gs?.shield || 0) + gain));
          }
        }
      }
    } catch (_) {}
    // Siphon packet update: home to player each frame until reaching them
    try {
      if (this._siphonPackets && this._siphonPackets.length) {
        const dtS = ((this.game?.loop?.delta) || 16.7) / 1000;
        const nowP = this.time.now;
        this._siphonPackets = this._siphonPackets.filter((p) => {
          if (!p?.g || !p.g.active || !this.player?.active) { try { p?.g?.destroy?.(); } catch (_) {} return false; }
          if ((nowP - (p.bornAt || nowP)) >= 500) { try { p.g.destroy(); } catch (_) {} return false; }
          const tx = this.player.x; const ty = this.player.y;
          const dx = tx - p.x; const dy = ty - p.y;
          const d = Math.hypot(dx, dy) || 1;
          const speed = p.speed || 320;
          const step = speed * dtS;
          if (d <= Math.max(6, step)) {
            try { p.g.destroy(); } catch (_) {}
            return false;
          }
          p.x += (dx / d) * step;
          p.y += (dy / d) * step;
          try { p.g.setPosition(p.x, p.y); } catch (_) {}
          return true;
        });
      }
    } catch (_) {}
    // Bullet casing VFX update: ballistic-like drop straight down with acceleration.
    try {
      if (this._bulletCasings && this._bulletCasings.length) {
        const dtC = ((this.game?.loop?.delta) || 16.7) / 1000;
        const nowC = this.time.now;
        this._bulletCasings = this._bulletCasings.filter((c) => {
          if (!c?.g || !c.g.active) { try { c?.g?.destroy?.(); } catch (_) {} return false; }
          const age = nowC - (c.bornAt || nowC);
          if (age >= (c.lifeMs || 500)) {
            if (!c.fading) {
              c.fading = true;
              try {
                this.tweens.add({
                  targets: c.g,
                  alpha: 0,
                  duration: 120,
                  ease: 'Cubic.Out',
                  onComplete: () => { try { c.g.destroy(); } catch (_) {} },
                });
              } catch (_) { try { c.g.destroy(); } catch (_) {} }
            }
            return false;
          }
          c.vx = (c.vx || 0) + ((c.ax || 0) * dtC);
          c.vy = (c.vy || 0) + ((c.ay || 0) * dtC);
          c.x += (c.vx || 0) * dtC;
          c.y += (c.vy || 0) * dtC;
          try { c.g.setPosition(c.x, c.y); } catch (_) {}
          return true;
        });
      }
    } catch (_) {}

    // Update active gadgets (ADS)
    if (this._gadgets && this._gadgets.length) {
      const nowT = this.time.now;
      this._gadgets = this._gadgets.filter((g) => {
        if (nowT >= (g.until || 0)) { try { g.g?.destroy(); } catch (_) {} return false; }
        // Zap nearest enemy projectile within radius, at most 5/s
        if (nowT >= (g.nextZapAt || 0)) {
          const radius = g.radius || 120; const r2 = radius * radius;
          let best = null; let bestD2 = Infinity;
          const arrB = this.enemyBullets?.getChildren?.() || [];
          const arrG = this.enemyGrenades?.getChildren?.() || [];
          for (let i = 0; i < arrB.length; i += 1) {
            const b = arrB[i]; if (!b?.active) continue;
            const dx = b.x - g.x; const dy = b.y - g.y; const d2 = dx * dx + dy * dy;
            if (d2 <= r2 && d2 < bestD2) { best = b; bestD2 = d2; }
          }
          for (let i = 0; i < arrG.length; i += 1) {
            const b = arrG[i]; if (!b?.active) continue;
            const dx = b.x - g.x; const dy = b.y - g.y; const d2 = dx * dx + dy * dy;
            if (d2 <= r2 && d2 < bestD2) { best = b; bestD2 = d2; }
          }
          if (best) {
            // Draw instant blue laser then destroy the projectile
            try {
              const lg = this.add.graphics();
              lg.setDepth(9000);
              lg.lineStyle(1, 0x66aaff, 1);
              const sx = g.x, sy = g.y - 4;
              lg.beginPath(); lg.moveTo(sx, sy); lg.lineTo(best.x, best.y); lg.strokePath();
              lg.setAlpha(1);
              try {
                this.tweens.add({ targets: lg, alpha: 0, duration: 320, ease: 'Quad.easeOut', onComplete: () => { try { lg.destroy(); } catch (_) {} } });
              } catch (_) {
                this.time.delayedCall(320, () => { try { lg.destroy(); } catch (__ ) {} });
              }
              // Tiny blue particle at impact point
              try { impactBurst(this, best.x, best.y, { color: 0x66aaff, size: 'small' }); } catch (_) {}
              // Blue pixel spray at laser origin (shorter but much wider)
              try { const ang = Phaser.Math.Angle.Between(sx, sy, best.x, best.y); pixelSparks(this, sx, sy, { angleRad: ang, count: 6, spreadDeg: 60, speedMin: 90, speedMax: 140, lifeMs: 110, color: 0x66aaff, size: 2, alpha: 0.9 }); } catch (_) {}
            } catch (_) {}
            try { best.destroy(); } catch (_) {}
            g.nextZapAt = nowT + 100; // 10 per second
          }
        }
        return true;
      });
    }

    // Ability cooldown progress for UI
    try {
      const noCd = !!(this.gs?.shootingRange && this._rangeNoAbilityCd);
      if (noCd) {
        this.registry.set('abilityCooldownActive', false);
        this.registry.set('abilityCooldownProgress', 1);
      } else {
        const nowT2 = this.time.now;
        const until = this.ability?.onCooldownUntil || 0;
        const active = nowT2 < until;
        const denom = this.ability?.cooldownMs || 10000;
        const remaining = Math.max(0, until - nowT2);
        const prog = active ? (1 - Math.min(1, remaining / denom)) : 1;
        this.registry.set('abilityCooldownActive', active);
        this.registry.set('abilityCooldownProgress', prog);
      }
    } catch (_) {}

    // Directional Shield update: decay + render
    try {
      if (this._dirShield?.active) {
        const dt = (this.game?.loop?.delta || 16.7) / 1000;
        const decay = (this._dirShield.decayPerSec || 100) * dt;
        this._dirShield.hp = Math.max(0, (this._dirShield.hp || 0) - decay);
        if (this._dirShield.hp <= 0) {
          this.stopDirectionalShield(true);
        } else {
          const g = this._dirShield.g || this.add.graphics();
          this._dirShield.g = g;
          const ptr = this.inputMgr?.pointer || this.input?.activePointer;
          const ang = ptr ? Math.atan2(ptr.worldY - this.player.y, ptr.worldX - this.player.x) : this.playerFacing;
          const radius = 48;
          const half = Phaser.Math.DegToRad(45);
          const t = Math.max(0, Math.min(1, (this._dirShield.hp || 0) / (this._dirShield.maxHp || 1000)));
          const alpha = 0.15 + 0.75 * t; // lighter as HP drops
          try {
            g.clear();
            g.setDepth(8800);
            g.lineStyle(4, 0xffee66, alpha);
            g.beginPath();
            g.arc(this.player.x, this.player.y, radius, ang - half, ang + half);
            g.strokePath();
            g.lineStyle(2, 0xffdd66, alpha * 0.9);
            g.beginPath();
            g.arc(this.player.x, this.player.y, radius - 4, ang - half, ang + half);
            g.strokePath();
          } catch (_) {}
          // Block enemy bullets within the arc (rook-style)
          try {
            const arrB = this.enemyBullets?.getChildren?.() || [];
            for (let i = 0; i < arrB.length; i += 1) {
              const b = arrB[i];
              if (!b?.active || b._dsBlocked) continue;
              if (!this._directionalShieldBlocksProjectile(b)) continue;
              b._dsBlocked = true;
              this._directionalShieldAbsorb(b.damage || 8);
              try { impactBurst(this, b.x, b.y, { color: 0xffee66, size: 'small' }); } catch (_) {}
              try { b.destroy(); } catch (_) {}
            }
          } catch (_) {}
        }
      } else {
        try { this._dirShield?.g?.clear?.(); } catch (_) {}
      }
    } catch (_) {}

    // Vulcan turret update: target closest enemy and fire
    try {
      if (this._vulcanTurrets && this._vulcanTurrets.length) {
        const nowT = this.time.now;
        const rpmMs = 60000 / 2000; // 2000 RPM
        const enemies = this.enemies?.getChildren?.() || [];
        const hasEnemies = enemies.some((e) => e?.active && !e.isDummy);
        this._vulcanTurrets = this._vulcanTurrets.filter((t) => {
          if (!t) return false;
          if (nowT >= (t.until || 0)) {
            try { t.base?.destroy(); } catch (_) {}
            try { t.head?.destroy(); } catch (_) {}
            try { t._aimG?.destroy(); } catch (_) {}
            return false;
          }
          if (!this.gs?.shootingRange && !hasEnemies) {
            try { t.base?.destroy(); } catch (_) {}
            try { t.head?.destroy(); } catch (_) {}
            try { t._aimG?.destroy(); } catch (_) {}
            return false;
          }
          // Find closest target to turret (dummy allowed in range)
          let best = null;
          let bestD2 = Infinity;
          for (let i = 0; i < enemies.length; i += 1) {
            const e = enemies[i];
            if (!e?.active) continue;
            if (!this.gs?.shootingRange && e.isDummy) continue;
            const dx = e.x - t.x; const dy = e.y - t.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) { bestD2 = d2; best = e; }
          }
          if (t.base) {
            t.base.setPosition(t.x, t.y);
            const facingRight = (best && best.x >= t.x);
            const sx = facingRight ? -Math.abs(t.base.scaleX || 1) : Math.abs(t.base.scaleX || 1);
            t.base.scaleX = sx;
          }
          if (best) {
            const baseH = t.base ? (t.base.displayHeight || t.base.height || 12) : 12;
            const headY = t.y - baseH * 0.14;
            const desired = Math.atan2(best.y - headY, best.x - t.x);
            const diff = Phaser.Math.Angle.Wrap(desired - (t.angle || 0));
            const dtTurn = Math.max(0, (nowT - (t._lastTurnAt || nowT)) / 1000);
            const maxTurn = Phaser.Math.DegToRad(300) * dtTurn;
            const step = Phaser.Math.Clamp(diff, -maxTurn, maxTurn);
            t.angle = (t.angle || 0) + step;
            t._lastTurnAt = nowT;
          }
          if (t.head) {
            const baseH = t.base ? (t.base.displayHeight || t.base.height || 12) : 12;
            t.head.setPosition(t.x, t.y - baseH * 0.14);
            const facingRight = (best && best.x >= t.x);
            const sy = facingRight ? -Math.abs(t.head.scaleY || 1) : Math.abs(t.head.scaleY || 1);
            t.head.scaleY = sy;
            t.head.rotation = (t.angle || 0) + Math.PI;
            const off = (t.head.displayWidth || t.head.width || 12) * 0.45;
            t._muzzleX = t.head.x + Math.cos(t.angle) * off;
            t._muzzleY = t.head.y + Math.sin(t.angle) * off;
          }
          // Red aim line (uncapped, points directly to target)
          if (!t._aimG) {
            try {
              t._aimG = this.add.graphics();
              t._aimG.setDepth(8610);
            } catch (_) {}
          }
          if (t._aimG) {
            try {
              t._aimG.clear();
              if (best) {
                const sx = (typeof t._muzzleX === 'number') ? t._muzzleX : t.x;
                const sy = (typeof t._muzzleY === 'number') ? t._muzzleY : t.y;
                t._aimG.lineStyle(1, 0xff2222, 1);
                t._aimG.beginPath();
                t._aimG.moveTo(sx, sy);
                t._aimG.lineTo(best.x, best.y);
                t._aimG.strokePath();
              }
            } catch (_) {}
          }
          if (nowT >= (t.warmUntil || 0) && best && nowT >= (t.lastShotAt || 0) + rpmMs) {
            const sx = (typeof t._muzzleX === 'number') ? t._muzzleX : t.x;
            const sy = (typeof t._muzzleY === 'number') ? t._muzzleY : t.y;
            const spread = Phaser.Math.DegToRad(3);
            const ang = (t.angle || 0) + Phaser.Math.FloatBetween(-spread / 2, spread / 2);
            // Match player's minigun muzzle look (split flash + dense yellow muzzle pixels)
            try {
              muzzleFlashSplit(this, sx, sy, { angle: ang, color: 0xffee66, count: 3, spreadDeg: 24, length: 16, thickness: 4 });
              const burst = { spreadDeg: 36, speedMin: 130, speedMax: 260, lifeMs: 190, color: 0xffee66, size: 2, alpha: 0.75 };
              pixelSparks(this, sx, sy, { angleRad: ang, count: 14, ...burst });
            } catch (_) {}
            // Eject a casing with the same behavior as player ballistic casings.
            try {
              const cx = (t.head?.x ?? t.x);
              const cy = (t.head?.y ?? t.y);
              this._spawnCasingAt(cx, cy, ang, 'minigun');
            } catch (_) {}
            const b = this.bullets.get(sx, sy, 'bullet');
            if (b) {
              b.setActive(true).setVisible(true);
              b.setCircle(2).setOffset(-2, -2);
              b.setVelocity(Math.cos(ang) * 900, Math.sin(ang) * 900);
              b.damage = 8;
              b._vulcan = true;
              b.setTint(0xffee66);
              b.update = () => {
                const view = this.cameras?.main?.worldView;
                if (view && !view.contains(b.x, b.y)) { try { b.destroy(); } catch (_) {} }
              };
            }
            t.lastShotAt = nowT;
          }
          return true;
        });
      }
    } catch (_) {}

    // Ignite burn ticking (global): apply burn DPS to ignited enemies
    this._igniteTickAccum = (this._igniteTickAccum || 0) + dt;
    const burnTick = 0.1; // 10 Hz for smoothness without perf hit
    if (this._igniteTickAccum >= burnTick) {
      const step = this._igniteTickAccum; // accumulate any leftover
      this._igniteTickAccum = 0;
      const enemies = this.enemies?.getChildren?.() || [];
      const burnDps = 30;
      const dmg = Math.max(0, Math.round(burnDps * step));
      const nowT = this.time.now;
      for (let i = 0; i < enemies.length; i += 1) {
        const e = enemies[i]; if (!e?.active) continue;
        if (e._ignitedUntil && nowT < e._ignitedUntil) {
          if (!e.isDummy) {
            if (typeof e.hp !== 'number') e.hp = e.maxHp || 20;
            e.hp -= dmg;
            try { this._flashEnemyHit(e); } catch (_) {}
            if (e.hp <= 0) this.killEnemy(e);
          } else {
            this._dummyDamage = (this._dummyDamage || 0) + dmg;
          }
          // maintain indicator position
          if (e._igniteIndicator?.setPosition) {
            try { e._igniteIndicator.setPosition(e.x, e.y - 14); } catch (_) {}
          }
        } else {
          // hide indicator if present
          if (e._igniteIndicator) { try { e._igniteIndicator.destroy(); } catch (_) {} e._igniteIndicator = null; }
        }
      }
    }

    // Toxin ticking (global): apply 3 DPS and manage indicator/disorientation window
    this._toxinTickAccum = (this._toxinTickAccum || 0) + dt;
    const toxinTick = 0.1;
    if (this._toxinTickAccum >= toxinTick) {
      const step = this._toxinTickAccum; this._toxinTickAccum = 0;
      const dps = 3;
      const nowT = this.time.now;
      const enemies = this.enemies?.getChildren?.() || [];
      for (let i = 0; i < enemies.length; i += 1) {
        const e = enemies[i]; if (!e?.active) continue;
        if (e._toxinedUntil && nowT < e._toxinedUntil) {
          // Accumulate fractional toxin damage per-entity to avoid rounding-away low DPS
          const prev = (e._toxinPartial || 0);
          const inc = dps * step;
          const total = prev + inc;
          const dmgInt = Math.floor(total);
          e._toxinPartial = total - dmgInt;
          if (dmgInt > 0) {
            if (e.isDummy) {
              this._dummyDamage = (this._dummyDamage || 0) + dmgInt;
            } else {
              if (typeof e.hp !== 'number') e.hp = e.maxHp || 20;
              e.hp -= dmgInt;
              try { this._flashEnemyHit(e); } catch (_) {}
              if (e.hp <= 0) this.killEnemy(e);
            }
          }
          // Maintain indicator position
          if (e._toxinIndicator?.setPosition) { try { e._toxinIndicator.setPosition(e.x, e.y - 18); } catch (_) {} }
        } else {
          // Cleanup indicator
          if (e._toxinIndicator) { try { e._toxinIndicator.destroy(); } catch (_) {} e._toxinIndicator = null; }
          // Reset partial accumulator when effect ends
          e._toxinPartial = 0;
        }
      }
    }

    // Stun indicator maintenance (no DPS; ensures indicator position and cleanup)
    this._stunTickAccum = (this._stunTickAccum || 0) + dt;
    const stunTick = 0.1;
    if (this._stunTickAccum >= stunTick) {
      this._stunTickAccum = 0;
      const nowT = this.time.now;
      const enemies = this.enemies?.getChildren?.() || [];
      for (let i = 0; i < enemies.length; i += 1) {
        const e = enemies[i]; if (!e?.active) continue;
        if (e._stunnedUntil && nowT < e._stunnedUntil) {
          if (!e._stunIndicator) { e._stunIndicator = this.add.graphics(); try { e._stunIndicator.setDepth(9000); } catch (_) {} e._stunIndicator.fillStyle(0xffff33, 1).fillCircle(0, 0, 2); }
          try { e._stunIndicator.setPosition(e.x, e.y - 22); } catch (_) {}
        } else {
          if (e._stunIndicator) { try { e._stunIndicator.destroy(); } catch (_) {} e._stunIndicator = null; }
        }
      }
    }

    // Update fire fields (ignite zones)
    if (!this._ffTickAccum) this._ffTickAccum = 0;
    this._ffTickAccum += dt;
    const ffTick = 0.1;
    if (this._ffTickAccum >= ffTick) {
      const step = this._ffTickAccum; this._ffTickAccum = 0;
      const ignitePerSec = 60; const igniteAdd = ignitePerSec * step;
      const nowT = this.time.now;
      this._firefields = (this._firefields || []).filter((f) => {
        if (nowT >= f.until) { try { f.g?.destroy(); } catch (_) {} try { f.pm?.destroy(); } catch (_) {} return false; }
        // Visual flicker/pulse + redraw
        try {
          f._pulse = (f._pulse || 0) + step;
          const pulse = 0.9 + 0.2 * Math.sin(f._pulse * 6.0);
          const jitter = Phaser.Math.Between(-2, 2);
          const r0 = Math.max(4, Math.floor(f.r * 0.50 * pulse));
          const r1 = Math.max(6, Math.floor(f.r * 0.85 + jitter));
          f.g.clear();
          f.g.fillStyle(0xff6622, 0.22).fillCircle(f.x, f.y, r0);
          f.g.fillStyle(0xffaa33, 0.14).fillCircle(f.x, f.y, r1);
          f.g.lineStyle(2, 0xffaa33, 0.45).strokeCircle(f.x, f.y, f.r + jitter);
        } catch (_) {}
        // Orange pixel sparks rising from the field (railgun/muzzle-style particles)
        try {
          if (!f._sparkAt || nowT >= f._sparkAt) {
            f._sparkAt = nowT + Phaser.Math.Between(40, 80);
            for (let i = 0; i < 2; i += 1) {
              const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
              const rr = Phaser.Math.FloatBetween(0, f.r * 0.7);
              const px = f.x + Math.cos(a) * rr;
              const py = f.y + Math.sin(a) * rr;
              pixelSparks(this, px, py, { angleRad: -Math.PI / 2, count: 1, spreadDeg: 24, speedMin: 50, speedMax: 110, lifeMs: 200, color: 0xffaa66, size: 2, alpha: 0.95 });
            }
          }
        } catch (_) {}
        // Tick ignite within radius
        const r2 = f.r * f.r; const arr = this.enemies?.getChildren?.() || [];
        for (let i = 0; i < arr.length; i += 1) {
          const e = arr[i]; if (!e?.active) continue;
          const dx = e.x - f.x; const dy = e.y - f.y; if ((dx * dx + dy * dy) <= r2) {
            e._igniteValue = Math.min(10, (e._igniteValue || 0) + igniteAdd);
            if ((e._igniteValue || 0) >= 10) {
              e._ignitedUntil = nowT + 2000; // refresh while inside
              e._igniteValue = 0; // reset on trigger
              if (!e._igniteIndicator) { e._igniteIndicator = this.add.graphics(); try { e._igniteIndicator.setDepth(9000); } catch (_) {} e._igniteIndicator.fillStyle(0xff3333, 1).fillCircle(0, 0, 2); }
              try { e._igniteIndicator.setPosition(e.x, e.y - 14); } catch (_) {}
            }
          }
        }
        return true;
      });
    }

    // Update toxin fields (toxin zones)
    if (!this._txfTickAccum) this._txfTickAccum = 0;
    this._txfTickAccum += dt;
    const txfTick = 0.1;
    if (this._txfTickAccum >= txfTick) {
      const step = this._txfTickAccum; this._txfTickAccum = 0;
      const nowT = this.time.now;
      this._toxfields = (this._toxfields || []).filter((f) => {
        if (nowT >= f.until) { try { f.g?.destroy(); } catch (_) {} try { f.pm?.destroy(); } catch (_) {} return false; }
        try {
          f._pulse = (f._pulse || 0) + step;
          const pulse = 0.9 + 0.2 * Math.sin(f._pulse * 5.5);
          const jitter = Phaser.Math.Between(-2, 2);
          const r0 = Math.max(4, Math.floor(f.r * 0.50 * pulse));
          const r1 = Math.max(6, Math.floor(f.r * 0.85 + jitter));
          f.g.clear();
          f.g.fillStyle(0x22aa66, 0.22).fillCircle(f.x, f.y, r0);
          f.g.fillStyle(0x33ff66, 0.14).fillCircle(f.x, f.y, r1);
          f.g.lineStyle(2, 0x33ff66, 0.45).strokeCircle(f.x, f.y, f.r + jitter);
        } catch (_) {}
        // Periodic green pixel sparks like fire field
        try {
          if (!f._sparkAt || nowT >= f._sparkAt) {
            f._sparkAt = nowT + Phaser.Math.Between(40, 80);
            for (let i = 0; i < 2; i += 1) {
              const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
              const rr = Phaser.Math.FloatBetween(0, f.r * 0.7);
              const px = f.x + Math.cos(a) * rr;
              const py = f.y + Math.sin(a) * rr;
              pixelSparks(this, px, py, { angleRad: -Math.PI / 2, count: 1, spreadDeg: 24, speedMin: 50, speedMax: 110, lifeMs: 200, color: 0x66ff99, size: 2, alpha: 0.95 });
            }
          }
        } catch (_) {}
        // Apply toxin buildup while inside
        const add = (f.toxPerSec || 20) * step; const r2 = f.r * f.r; const arr = this.enemies?.getChildren?.() || [];
        for (let i = 0; i < arr.length; i += 1) {
          const e = arr[i]; if (!e?.active) continue;
          const dx = e.x - f.x; const dy = e.y - f.y; if ((dx * dx + dy * dy) <= r2) {
            e._toxinValue = Math.min(10, (e._toxinValue || 0) + add);
            if ((e._toxinValue || 0) >= 10) {
              e._toxinedUntil = nowT + 2000; e._toxinValue = 0;
              if (!e._toxinIndicator) { e._toxinIndicator = this.add.graphics(); try { e._toxinIndicator.setDepth(9000); } catch (_) {} e._toxinIndicator.fillStyle(0x33ff33, 1).fillCircle(0, 0, 2); }
              try { e._toxinIndicator.setPosition(e.x, e.y - 18); } catch (_) {}
            }
          }
        }
        return true;
      });
    }

    // Update Repulsion Pulse effects (block enemy projectiles and push enemies)
    if (this._repulses && this._repulses.length) {
      const dt2 = (this.game?.loop?.delta || 16.7) / 1000;
      this._repulses = this._repulses.filter((rp) => {
        rp.r += rp.speed * dt2;
        try {
          rp.g.clear();
          rp.g.setBlendMode?.(Phaser.BlendModes.ADD);
          // Trail cache of previous radii for drag effect
          const now = this.time.now;
          if (rp._lastTrailR === undefined) rp._lastTrailR = 0;
          if (!rp._trail) rp._trail = [];
          if ((rp.r - rp._lastTrailR) > 10) { rp._trail.push({ r: rp.r, t: now }); rp._lastTrailR = rp.r; }
          // Keep last few rings
          while (rp._trail.length > 6) rp._trail.shift();
          // Draw trail rings (older = fainter)
          const colTrail = (rp.colTrail !== undefined ? rp.colTrail : 0xffaa33);
          const colOuter = (rp.colOuter !== undefined ? rp.colOuter : 0xffaa33);
          const colInner = (rp.colInner !== undefined ? rp.colInner : 0xffdd88);
          const colSpark = (rp.colSpark !== undefined ? rp.colSpark : 0xffaa66);
          const colPixel = (rp.colPixel !== undefined ? rp.colPixel : 0xffaa33);
          const colImpact = (rp.colImpact !== undefined ? rp.colImpact : 0xffaa33);
          for (let i = 0; i < rp._trail.length; i += 1) {
            const it = rp._trail[i];
            const age = (now - it.t) / 300; // 0..~
            const a = Math.max(0, 0.22 * (1 - Math.min(1, age)));
            if (a <= 0) continue;
            rp.g.lineStyle(6, colTrail, a).strokeCircle(0, 0, it.r);
          }
          // Current ring: bright thin edge + faint outer halo
          rp.g.lineStyle(8, colOuter, 0.20).strokeCircle(0, 0, rp.r);
          rp.g.lineStyle(3, colInner, 0.95).strokeCircle(0, 0, Math.max(1, rp.r - 1));
          // Periodic sparks along the band (denser for a lively pulse)
          if (!rp._nextSparkAt) rp._nextSparkAt = now;
          if (now >= rp._nextSparkAt) {
            const sparks = 8;
            for (let s = 0; s < sparks; s += 1) {
              const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
              const sx = rp.x + Math.cos(a) * rp.r;
              const sy = rp.y + Math.sin(a) * rp.r;
              try { pulseSpark(this, sx, sy, { color: colSpark, size: 2, life: 180 }); } catch (_) {}
              try { pixelSparks(this, sx, sy, { angleRad: a, count: 1, spreadDeg: 6, speedMin: 90, speedMax: 160, lifeMs: 160, color: colPixel, size: 2, alpha: 0.8 }); } catch (_) {}
            }
            rp._nextSparkAt = now + 28; // faster cadence
          }
        } catch (_) {}
        const band = rp.band;
        const r2min = (rp.r - band) * (rp.r - band);
        const r2max = (rp.r + band) * (rp.r + band);
        // Block enemy bullets in the band
        try {
          const arrB = this.enemyBullets?.getChildren?.() || [];
          for (let i = 0; i < arrB.length; i += 1) {
            const b = arrB[i]; if (!b?.active) continue; const dx = b.x - rp.x; const dy = b.y - rp.y; const d2 = dx * dx + dy * dy;
            if (d2 >= r2min && d2 <= r2max) {
              try { impactBurst(this, b.x, b.y, { color: colImpact, size: 'small' }); } catch (_) {}
              try {
                try { b._hzTrailG?.destroy(); } catch (_) {}
                b.destroy();
              } catch (_) {}
            }
          }
        } catch (_) {}
        // Push Hazel missiles that enter the band instead of destroying them
        try {
          const arrE = this.enemies?.getChildren?.() || [];
          for (let i = 0; i < arrE.length; i += 1) {
            const m = arrE[i]; if (!m?.active || !m.isHazelMissile) continue;
            const dxm = m.x - rp.x; const dym = m.y - rp.y; const d2m = dxm * dxm + dym * dym;
            if (d2m >= r2min && d2m <= r2max) {
              const d = Math.sqrt(d2m) || 1; const nx = dxm / d; const ny = dym / d;
              const power = (m._speed || 230);
              // Redirect missile velocity outward from pulse center
              m._angle = Math.atan2(ny, nx);
              const vxm = Math.cos(m._angle) * power;
              const vym = Math.sin(m._angle) * power;
              try { m.body?.setVelocity?.(vxm, vym); } catch (_) { try { m.setVelocity(vxm, vym); } catch (_) {} }
            }
          }
        } catch (_) {}
          // Push enemies and apply 5 dmg once per enemy per pulse
          try {
            if (!rp._hitSet) rp._hitSet = new Set();
            if (!rp._pushedSet) rp._pushedSet = new Set();
            const arrE = this.enemies?.getChildren?.() || [];
            for (let i = 0; i < arrE.length; i += 1) {
              const e = arrE[i]; if (!e?.active) continue;
              // Turrets are anchored structures: do not push them with Repulsion
              if (e.isTurret) continue;
              // Dandelion mines are stationary hazards: do not push them either
              if (e.isDnMine) continue;
            // If already pushed by this pulse, skip entirely; also skip while under any active knockback window
            const nowPush = this.time.now;
            if (rp._pushedSet.has(e)) continue;
            if (nowPush < (e._repulseUntil || 0)) continue;
            const dx = e.x - rp.x; const dy = e.y - rp.y; const d2 = dx * dx + dy * dy; if (d2 >= r2min && d2 <= r2max) {
              const d = Math.sqrt(d2) || 1; const nx = dx / d; const ny = dy / d; const power = 240;
              // Apply 1s knockback velocity; let physics/barricades handle collisions
              if (!e.isDummy) {
                e._repulseUntil = nowPush + 1000;
                e._repulseVX = nx * power; e._repulseVY = ny * power;
                try { e.body?.setVelocity?.(e._repulseVX, e._repulseVY); } catch (_) { try { e.setVelocity(e._repulseVX, e._repulseVY); } catch (_) {} }
              }
              // If Dandelion is currently drawing its laser aim line, clear it when repulsed
              try {
                if (e.isBoss && (e.bossType === 'Dandelion' || e._bossId === 'Dandelion')) {
                  if (e._dnAimG) { e._dnAimG.clear(); e._dnAimG.destroy(); e._dnAimG = null; }
                  if (e._dnSpecialState === 'aim') {
                    e._dnSpecialState = 'idle';
                    e._dnSpecialAimUntil = 0;
                  }
                }
              } catch (_) {}
              // Mark this enemy as pushed for this pulse so re-contacts do not refresh/pile up
              rp._pushedSet.add(e);
              if (!rp._hitSet.has(e)) {
                rp._hitSet.add(e);
                if (e.isDummy) { this._dummyDamage = (this._dummyDamage || 0) + 5; }
                else {
                  if (typeof e.hp !== 'number') e.hp = e.maxHp || 20;
                  e.hp -= 5;
                  try { this._flashEnemyHit(e); } catch (_) {}
                  if (e.hp <= 0) { try { this.killEnemy(e); } catch (_) {} }
                }
              }
            }
          }
        } catch (_) {}
        if (rp.r >= rp.maxR) { try { rp.g.destroy(); } catch (_) {} return false; }
        return true;
      });
    }

    // Update BIT units
    if (!this._bits) this._bits = [];
    if (this._bits.length) {
      const dt = (this.game?.loop?.delta || 16.7) / 1000;
      const now = this.time.now;
      const enemiesArr = this.enemies?.getChildren?.() || [];
      this._bits = this._bits.filter((bit) => {
        // Expire: return to player then disappear
        if (now >= (bit.despawnAt || 0)) {
          // Return-to-player phase: despawn immediately on contact
          let dx = this.player.x - bit.x; let dy = this.player.y - bit.y;
          let len = Math.hypot(dx, dy) || 1;
          if (len < 12) { try { bit.g.destroy(); } catch (_) {} try { bit._thr?.destroy?.(); } catch (_) {} return false; }
          const sp = 420;
          bit.vx = (dx / len) * sp; bit.vy = (dy / len) * sp;
          bit.x += bit.vx * dt; bit.y += bit.vy * dt;           try { bit.g.setPosition(bit.x, bit.y); } catch (_) {}
          // Smooth sprite rotation to reduce jitter while hovering
          try {
            const targetAng = (trg ? Math.atan2(trg.y - bit.y, trg.x - bit.x) + Math.PI : Math.atan2(bit.vy, bit.vx));
            bit._rot = (typeof bit._rot === 'number') ? Phaser.Math.Angle.RotateTo(bit._rot, targetAng, Phaser.Math.DegToRad(12)) : targetAng;
            bit.g.setRotation(bit._rot);
          } catch (_) {}
          // Thruster draw
          try {
            const g = bit._thr; if (g) {
              const vx = bit.vx || 0, vy = bit.vy || 0; const spd = Math.hypot(vx, vy) || 0; g.clear();
              if (spd > 40) {
                const tAng = Math.atan2(vy, vx);
                bit._thrAng = (typeof bit._thrAng === 'number') ? Phaser.Math.Angle.RotateTo(bit._thrAng, tAng, Phaser.Math.DegToRad(10)) : tAng;
                const ux = Math.cos(bit._thrAng), uy = Math.sin(bit._thrAng);
                const tail = 8, stub = 4;
                const tx = bit.x - ux * tail, ty = bit.y - uy * tail;
                const sx2 = bit.x - ux * stub, sy2 = bit.y - uy * stub;
                try { const back = tAng + Math.PI; const ex = bit.x + Math.cos(back) * 6; const ey = bit.y + Math.sin(back) * 6; pixelSparks(this, ex, ey, { angleRad: back, count: 1, spreadDeg: 4, speedMin: 60, speedMax: 110, lifeMs: 50, color: 0xffee66, size: 1, alpha: 0.8 }); } catch (_) {}
                // removed static blue thruster lines (use particles only)
                // Yellow compact thruster particles (smaller/shorter)
                try { const back = tAng + Math.PI; const ex = bit.x + Math.cos(back) * 6; const ey = bit.y + Math.sin(back) * 6; pixelSparks(this, ex, ey, { angleRad: back, count: 1, spreadDeg: 4, speedMin: 60, speedMax: 110, lifeMs: 50, color: 0xffee66, size: 1, alpha: 0.8 }); } catch (_) {}
              }
            }
          } catch (_) {}
          dx = this.player.x - bit.x; dy = this.player.y - bit.y; len = Math.hypot(dx, dy) || 1;
          if (len < 12) { try { bit.g.destroy(); } catch (_) {} try { bit._thr?.destroy?.(); } catch (_) {} return false; }
          return true;
        }
        // Spawn scatter animation: keep initial outward motion briefly before any idle/lock logic
        if (bit.spawnScatterUntil && now < bit.spawnScatterUntil) {
          bit.x += (bit.vx || 0) * dt; bit.y += (bit.vy || 0) * dt;           try { bit.g.setPosition(bit.x, bit.y); } catch (_) {}
          // Smooth rotation during scatter
          try {
            const targetAng = (trg ? Math.atan2(trg.y - bit.y, trg.x - bit.x) + Math.PI : Math.atan2((bit.vy || 0), (bit.vx || 0)));
            bit._rot = (typeof bit._rot === 'number') ? Phaser.Math.Angle.RotateTo(bit._rot, targetAng, Phaser.Math.DegToRad(14)) : targetAng;
            bit.g.setRotation(bit._rot);
          } catch (_) {}
          // Thruster draw
          try {
            const g = bit._thr; if (g) {
              const vx = bit.vx || 0, vy = bit.vy || 0; const spd = Math.hypot(vx, vy) || 0; g.clear();
              if (spd > 40) {
                const tAng = Math.atan2(vy, vx);
                bit._thrAng = (typeof bit._thrAng === 'number') ? Phaser.Math.Angle.RotateTo(bit._thrAng, tAng, Phaser.Math.DegToRad(10)) : tAng;
                const ux = Math.cos(bit._thrAng), uy = Math.sin(bit._thrAng);
                // removed static blue thruster lines (use particles only)
                try { const back = tAng + Math.PI; const ex = bit.x + Math.cos(back) * 6; const ey = bit.y + Math.sin(back) * 6; pixelSparks(this, ex, ey, { angleRad: back, count: 1, spreadDeg: 4, speedMin: 60, speedMax: 110, lifeMs: 50, color: 0xffee66, size: 1, alpha: 0.8 }); } catch (_) {}
              }
            }
          } catch (_) {}
          return true;
        }
        // Acquire or validate target (short lock range)
        const lockR = 180; const lockR2 = lockR * lockR;
        if (!bit.target || !bit.target.active) {
          // nearest enemy within lock range only
          let best = null; let bestD2 = Infinity;
          for (let i = 0; i < enemiesArr.length; i += 1) {
            const e = enemiesArr[i]; if (!e?.active) continue;
            const dx = e.x - bit.x; const dy = e.y - bit.y; const d2 = dx * dx + dy * dy;
            if (d2 <= lockR2 && d2 < bestD2) { best = e; bestD2 = d2; }
          }
          bit.target = best;
        } else {
          // Drop target if it moved out of lock range
          const dx = bit.target.x - bit.x; const dy = bit.target.y - bit.y; const d2 = dx * dx + dy * dy;
          if (d2 > lockR2) bit.target = null;
        }
        const trg = bit.target;
        if (!trg) {
          // Idle: hover closely around the player in a small orbit until a target enters lock range
          if (bit._idleAngle === undefined) bit._idleAngle = Phaser.Math.FloatBetween(0, Math.PI * 2);
          if (bit._idleRadius === undefined) bit._idleRadius = Phaser.Math.Between(28, 48);
          if (bit._idleSpeed === undefined) bit._idleSpeed = Phaser.Math.FloatBetween(2.0, 3.2); // rad/s
          bit._idleAngle += bit._idleSpeed * dt;
          const px = this.player.x; const py = this.player.y;
          const tx = px + Math.cos(bit._idleAngle) * bit._idleRadius;
          const ty = py + Math.sin(bit._idleAngle) * bit._idleRadius;
          const dx = tx - bit.x; const dy = ty - bit.y; const len = Math.hypot(dx, dy) || 1;
          const sp = 260;
          bit.vx = (dx / len) * sp; bit.vy = (dy / len) * sp;
          bit.x += bit.vx * dt; bit.y += bit.vy * dt;
          try { bit.g.setPosition(bit.x, bit.y); } catch (_) {}
          // In idle, face along orbit tangent to avoid jitter from small velocity changes
          try {
            const tangent = Math.atan2(ty - py, tx - px) + Math.PI / 2;
            bit._rot = (typeof bit._rot === 'number') ? Phaser.Math.Angle.RotateTo(bit._rot, tangent, Phaser.Math.DegToRad(12)) : tangent;
            bit.g.setRotation(bit._rot);
          } catch (_) {}
          // Thruster tail aligned with facing (single-sided)
          try {
            const g = bit._thr; if (g) {
              g.clear();
              const ux = Math.cos(bit._rot), uy = Math.sin(bit._rot);
              const tail = 8, stub = 4;
              const tx2 = bit.x - ux * tail, ty2 = bit.y - uy * tail;
              const sx2 = bit.x - ux * stub, sy2 = bit.y - uy * stub;
                try { const back = tAng + Math.PI; pixelSparks(this, bit.x, bit.y, { angleRad: back, count: 1, spreadDeg: 4, speedMin: 60, speedMax: 110, lifeMs: 50, color: 0xffee66, size: 1, alpha: 0.8 }); } catch (_) {}
              // Only yellow compact thruster particles in idle orbit
              try { const back = bit._rot + Math.PI; const ex = bit.x + Math.cos(back) * 6; const ey = bit.y + Math.sin(back) * 6; pixelSparks(this, ex, ey, { angleRad: back, count: 1, spreadDeg: 4, speedMin: 60, speedMax: 110, lifeMs: 50, color: 0xffee66, size: 1, alpha: 0.8 }); } catch (_) {}
            }
          } catch (_) {}
          return true;
        }
        // Firing hold
        if (now < (bit.holdUntil || 0)) {
          // stay still; face target if present
          if (trg) { try { bit.g.setRotation(Math.atan2(trg.y - bit.y, trg.x - bit.x) + Math.PI); } catch (_) {} }
          // emit compact yellow thruster while attacking (opposite the laser/enemy direction)
          try {
            const laserAng = trg ? Math.atan2(trg.y - bit.y, trg.x - bit.x) : Math.atan2(bit.vy || 0, bit.vx || 0);
            const back = laserAng + Math.PI;
            { const ex = bit.x + Math.cos(back) * 6; const ey = bit.y + Math.sin(back) * 6; pixelSparks(this, ex, ey, { angleRad: back, count: 1, spreadDeg: 4, speedMin: 60, speedMax: 110, lifeMs: 50, color: 0xffee66, size: 1, alpha: 0.8 }); }
          } catch (_) {}
          return true;
        }
        // Decide next action
        if (!bit.moveUntil || now >= bit.moveUntil) {
          // Either fire (if in range) or choose a new dash around target
          const fireR = 180; const fireR2 = fireR * fireR;
          const ddx = trg.x - bit.x; const ddy = trg.y - bit.y; const dd2 = ddx * ddx + ddy * ddy;
          if ((!bit.lastShotAt || (now - bit.lastShotAt > 500)) && dd2 <= fireR2) {
            // Fire: draw laser and damage
            try {
              const lg = this.add.graphics(); lg.setDepth(9000);
              lg.lineStyle(1, 0x66aaff, 1);
              lg.beginPath(); lg.moveTo(bit.x, bit.y); lg.lineTo(trg.x, trg.y); lg.strokePath();
              this.tweens.add({ targets: lg, alpha: 0, duration: 320, ease: 'Quad.easeOut', onComplete: () => { try { lg.destroy(); } catch (_) {} } });
            } catch (_) {}
            // Blue pixel spray at bit laser origin (shorter, much wider, and more intense)
            try { const ang = Phaser.Math.Angle.Between(bit.x, bit.y, trg.x, trg.y); pixelSparks(this, bit.x, bit.y, { angleRad: ang, count: 12, spreadDeg: 70, speedMin: 110, speedMax: 200, lifeMs: 110, color: 0x66aaff, size: 2, alpha: 0.95 }); } catch (_) {}
            try { impactBurst(this, trg.x, trg.y, { color: 0x66aaff, size: 'small' }); } catch (_) {}
            try { bit.g.setRotation(Math.atan2(trg.y - bit.y, trg.x - bit.x) + Math.PI); } catch (_) {}
            // Apply damage (count on dummy instead of reducing HP)
            if (trg.isDummy) {
              this._dummyDamage = (this._dummyDamage || 0) + 7;
            } else {
              if (typeof trg.hp !== 'number') trg.hp = trg.maxHp || 20;
              trg.hp -= 7; if (trg.hp <= 0) { try { this.killEnemy(trg); } catch (_) {} }
            }
            bit.lastShotAt = now;
            bit.holdUntil = now + 400; // hold for 0.4s
            bit.moveUntil = now + 400; // next plan after hold
            return true;
          }
          // Plan a quick straight movement around target
          const angTo = Math.atan2(bit.y - trg.y, bit.x - trg.x);
          const off = Phaser.Math.FloatBetween(-Math.PI / 2, Math.PI / 2);
          const r = Phaser.Math.Between(40, 120);
          const tx = trg.x + Math.cos(angTo + off) * r;
          const ty = trg.y + Math.sin(angTo + off) * r;
          const dx = tx - bit.x; const dy = ty - bit.y; const len = Math.hypot(dx, dy) || 1;
          const sp = 380; bit.vx = (dx / len) * sp; bit.vy = (dy / len) * sp;
          bit.moveUntil = now + Phaser.Math.Between(240, 420);
        } else {
          // Move step
          bit.x += bit.vx * dt; bit.y += bit.vy * dt;          try { bit.g.setPosition(bit.x, bit.y); } catch (_) {}
          try {
            const targetAng = (trg ? Math.atan2(trg.y - bit.y, trg.x - bit.x) + Math.PI : Math.atan2(bit.vy, bit.vx));
            bit._rot = (typeof bit._rot === 'number') ? Phaser.Math.Angle.RotateTo(bit._rot, targetAng, Phaser.Math.DegToRad(12)) : targetAng;
            bit.g.setRotation(bit._rot);
          } catch (_) {}
          // Thruster draw
          try {
            const g = bit._thr; if (g) {
              const vx = bit.vx || 0, vy = bit.vy || 0; const spd = Math.hypot(vx, vy) || 0; g.clear();
              if (spd > 40) {
                const tAng = Math.atan2(vy, vx);
                bit._thrAng = (typeof bit._thrAng === 'number') ? Phaser.Math.Angle.RotateTo(bit._thrAng, tAng, Phaser.Math.DegToRad(10)) : tAng;
                const ux = Math.cos(bit._thrAng), uy = Math.sin(bit._thrAng);
                const tail = 8, stub = 4; const tx = bit.x - ux * tail, ty = bit.y - uy * tail; const sx2 = bit.x - ux * stub, sy2 = bit.y - uy * stub;
                try { const back = tAng + Math.PI; const ex = bit.x + Math.cos(back) * 6; const ey = bit.y + Math.sin(back) * 6; pixelSparks(this, ex, ey, { angleRad: back, count: 1, spreadDeg: 4, speedMin: 60, speedMax: 110, lifeMs: 50, color: 0xffee66, size: 1, alpha: 0.8 }); } catch (_) {}
                // particles-only thruster (remove static blue lines)\r
                try { const back = tAng + Math.PI; pixelSparks(this, bit.x, bit.y, { angleRad: back, count: 1, spreadDeg: 4, speedMin: 60, speedMax: 110, lifeMs: 50, color: 0xffee66, size: 1, alpha: 0.8 }); } catch (_) {}
              }
            }
          } catch (_) {}
        }
        return true;
      });
    }

    // Update WASP BITS (armour-driven, persistent)
    const hasWaspArmour = (this.gs?.armour?.id === 'wasp_bits');
    if (!hasWaspArmour) {
      // Clean up if armour unequipped
      if (this._wasps && this._wasps.length) {
        try { this._wasps.forEach((w) => { try { w?.g?.destroy?.(); } catch (_) {} try { w?._thr?.destroy?.(); } catch (_) {} }); } catch (_) {}
        this._wasps = [];
      }
    } else {
      if (!this._wasps) this._wasps = [];
      // Ensure exactly 2 wasps exist
      const need = 2 - this._wasps.length;
      for (let i = 0; i < need; i += 1) {
        const g = createFittedImage(this, this.player.x, this.player.y, 'ability_bit', 14);
        try { g.setDepth(9000); g.setTint(0xffff66); } catch (_) {}
        const w = { x: this.player.x, y: this.player.y, vx: 0, vy: 0, g,
          state: 'idle', target: null,
          hoverUntil: 0, dashUntil: 0, lastDashAt: 0, dashHit: false, didFinalDash: false,
          _hoverAngle: Phaser.Math.FloatBetween(0, Math.PI * 2), _hoverR: Phaser.Math.Between(16, 36), _hoverChangeAt: 0 };
        try { w._thr = this.add.graphics(); w._thr.setDepth(8800); w._thr.setBlendMode?.(Phaser.BlendModes.ADD); } catch (_) {}
        this._wasps.push(w);
      }
      // Update each wasp
      if (this._wasps.length) {
        const dt = (this.game?.loop?.delta || 16.7) / 1000;
        const now = this.time.now;
        // Reduced detection radius per request
        const detectR = 200; const detectR2 = detectR * detectR;
        const enemiesArr = this.enemies?.getChildren?.() || [];
        this._wasps = this._wasps.filter((w) => {
          if (!w?.g?.active) { try { w?._thr?.destroy?.(); } catch (_) {} return false; }
          // Acquire/validate target based on player-centric radius
          if (!w.target || !w.target.active) {
            w.target = null; w.didFinalDash = false;
            let best = null; let bestD2 = Infinity;
            for (let i = 0; i < enemiesArr.length; i += 1) {
              const e = enemiesArr[i]; if (!e?.active) continue; if (e.isBoss) continue;
              const dxp = e.x - this.player.x; const dyp = e.y - this.player.y; const d2p = dxp * dxp + dyp * dyp;
              if (d2p <= detectR2) {
                const dx = e.x - w.x; const dy = e.y - w.y; const d2 = dx * dx + dy * dy;
                if (d2 < bestD2) { best = e; bestD2 = d2; }
              }
            }
            w.target = best;
          } else {
            const dxp = w.target.x - this.player.x; const dyp = w.target.y - this.player.y; const d2p = dxp * dxp + dyp * dyp;
            if (d2p > detectR2) {
              // Target left detection radius: mark for one final dash
              if (!w.didFinalDash) {
                // will be handled by dash planner below
              } else {
                w.target = null; w.state = 'idle'; w.didFinalDash = false;
              }
            }
          }

          const t = w.target;
          // Dash update when active (straight line)
          if (w.state === 'dashing') {
            const px = w.x; const py = w.y;
            w.x += (w.vx || 0) * dt; w.y += (w.vy || 0) * dt; try { w.g.setPosition(w.x, w.y); } catch (_) {}
            try { w.g.setRotation(Math.atan2(w.y - py, w.x - px) + Math.PI); } catch (_) {}
            // Thruster while dashing as well (subtle)
            try { const g = w._thr; if (g) { g.clear(); const vx = w.vx || 0, vy = w.vy || 0; const spd = Math.hypot(vx, vy) || 1; const ux = vx / spd, uy = vy / spd; const tail = 10; const stub = 5; const tx = w.x - ux * tail; const ty = w.y - uy * tail; const sx = w.x - ux * stub; const sy = w.y - uy * stub; try { const g = w._thr; if (g) { g.clear(); } } catch (_) {} } } catch (_) {}
            // Yellow compact thruster particles behind WASP bit while dashing (emit from rear with smoothing)
            try {
              const sp2 = (w.vx||0)*(w.vx||0) + (w.vy||0)*(w.vy||0);
              const desired = (sp2 > 1) ? (Math.atan2(w.vy || 0, w.vx || 0) + Math.PI) : ((w._rot || 0) + Math.PI);
              w._thrBackAng = (typeof w._thrBackAng === 'number') ? Phaser.Math.Angle.RotateTo(w._thrBackAng, desired, Phaser.Math.DegToRad(12)) : desired;
              const ex = w.x + Math.cos(w._thrBackAng) * 6;
              const ey = w.y + Math.sin(w._thrBackAng) * 6;
              pixelSparks(this, ex, ey, { angleRad: w._thrBackAng, count: 1, spreadDeg: 4, speedMin: 70, speedMax: 120, lifeMs: 50, color: 0xffee66, size: 1, alpha: 0.8 });
            } catch (_) {}
            // Ensure visible blue spark trail as fallback
            if (!w._lastSparkAt || (now - w._lastSparkAt) >= 20) {
              try { pulseSpark(this, w.x, w.y, { color: 0x66aaff, size: 2, life: 140 }); } catch (_) {}
              w._lastSparkAt = now;
            }
            // Fading blue line segment along dash path
            try {
              if (!w._lastLineAt || (now - w._lastLineAt) >= 16) {
                const lg = this.add.graphics();
                try { lg.setDepth(9850); lg.setBlendMode?.(Phaser.BlendModes.ADD); } catch (_) {}
                lg.lineStyle(2, 0x66aaff, 0.95);
                lg.beginPath(); lg.moveTo(px, py); lg.lineTo(w.x, w.y); lg.strokePath();
                this.tweens.add({ targets: lg, alpha: 0, duration: 240, ease: 'Quad.easeOut', onComplete: () => { try { lg.destroy(); } catch (_) {} } });
                w._lastLineAt = now;
              }
            } catch (_) {}
            // Hit check
            if (t && t.active && !w.dashHit) {
              const dx = t.x - w.x; const dy = t.y - w.y; const len = Math.hypot(dx, dy) || 1;
              if (len < 14) {
              // Apply damage and stun
              if (t.isDummy) {
                  this._dummyDamage = (this._dummyDamage || 0) + 3.5;
                  // Stun build-up for dummy as well
                  t._stunValue = Math.min(10, (t._stunValue || 0) + 2.5);
                  if ((t._stunValue || 0) >= 10) {
                    t._stunnedUntil = now + 200;
                    t._stunValue = 0; // reset on trigger
                    if (!t._stunIndicator) { t._stunIndicator = this.add.graphics(); try { t._stunIndicator.setDepth(9000); } catch (_) {} t._stunIndicator.fillStyle(0xffff33, 1).fillCircle(0, 0, 2); }
                    try { t._stunIndicator.setPosition(t.x, t.y - 22); } catch (_) {}
                  }
                } else {
                  if (typeof t.hp !== 'number') t.hp = t.maxHp || 20;
                  t.hp -= 3.5; if (t.hp <= 0) { this.killEnemy(t); }
                  // Stun build-up: +2.5 per hit, stun at 10 (0.2s), applies to all (boss too)
                  t._stunValue = Math.min(10, (t._stunValue || 0) + 2.5);
                  if ((t._stunValue || 0) >= 10) {
                    t._stunnedUntil = now + 200;
                    t._stunValue = 0; // reset on trigger
                    if (!t._stunIndicator) { t._stunIndicator = this.add.graphics(); try { t._stunIndicator.setDepth(9000); } catch (_) {} t._stunIndicator.fillStyle(0xffff33, 1).fillCircle(0, 0, 2); }
                    try { t._stunIndicator.setPosition(t.x, t.y - 22); } catch (_) {}
                    // Interrupt actions
                    try { if (t.isSniper) { t.aiming = false; t._aimG?.clear?.(); t._aimG?.destroy?.(); t._aimG = null; } } catch (_) {}
                    try { t._burstLeft = 0; } catch (_) {}
                  }
                }
                w.dashHit = true;
              }
            }
            if (now >= (w.dashUntil || 0)) {
              // End dash
              w.state = (t && t.active && (!w.didFinalDash)) ? 'locked' : 'idle';
              if (t && t.active) {
                const dxp = t.x - this.player.x; const dyp = t.y - this.player.y; const d2p = dxp * dxp + dyp * dyp;
                if (d2p > detectR2) { w.target = null; w.didFinalDash = false; }
              } else { w.target = null; w.didFinalDash = false; }
              w.vx = 0; w.vy = 0; w.dashHit = false; w._dash = null; // do not snap back to original
              // Stop and cleanup trail shortly after dash ends
              try {
                if (w._trailEmitter) { w._trailEmitter.on = false; }
                if (w._trailMgr) {
                  this.time.delayedCall(260, () => { try { w._trailMgr.destroy(); } catch (_) {} w._trailMgr = null; w._trailEmitter = null; });
                }
              } catch (_) {}
              // Retain current offset around base to avoid snapping back
              const bx = (t && t.active) ? t.x : this.player.x;
              const by = (t && t.active) ? t.y : this.player.y;
              const ox = w.x - bx; const oy = w.y - by;
              const d = Math.hypot(ox, oy) || 1;
              w._hoverR = Phaser.Math.Clamp(d, (t && t.active) ? 28 : 22, (t && t.active) ? 52 : 42);
              w._hoverAngle = Math.atan2(oy, ox);
              w._hoverChangeAt = now + Phaser.Math.Between(280, 560);
            }
            return true;
          }

          // Hover behavior (wasp-like jitter) around target or player
          const baseX = t && t.active ? t.x : this.player.x;
          const baseY = t && t.active ? t.y : this.player.y;
          if (now >= (w._hoverChangeAt || 0)) {
            w._hoverChangeAt = now + Phaser.Math.Between(220, 520);
            // small random offset radius and angle step
            const addR = Phaser.Math.Between(-6, 6);
            w._hoverR = Phaser.Math.Clamp((w._hoverR || (t && t.active ? 32 : 26)) + addR, (t && t.active) ? 28 : 22, (t && t.active) ? 52 : 42);
            w._hoverAngle += Phaser.Math.FloatBetween(-0.9, 0.9);
          }
          // Use larger hover distance when around a target vs around player
          const baseR = t && t.active ? (w._hoverR || 32) : (w._hoverR || 26);
          const hx = baseX + Math.cos(w._hoverAngle) * baseR;
          const hy = baseY + Math.sin(w._hoverAngle) * baseR;
          const dxh = hx - w.x; const dyh = hy - w.y; const llen = Math.hypot(dxh, dyh) || 1;
          const hsp = t ? 320 : 280;
          w.vx = (dxh / llen) * hsp; w.vy = (dyh / llen) * hsp;
          w.x += w.vx * dt; w.y += w.vy * dt; try { w.g.setPosition(w.x, w.y); } catch (_) {}
          // Smooth hover rotation
          try { const tAng = Math.atan2(w.vy, w.vx); w._rot = (typeof w._rot === 'number') ? Phaser.Math.Angle.RotateTo(w._rot, tAng, Phaser.Math.DegToRad(12)) : tAng; w.g.setRotation(w._rot); } catch (_) {}
          // Thruster draw (yellowish) with smoothing and speed threshold
          try { const g = w._thr; if (g) { const vx = w.vx || 0, vy = w.vy || 0; const spd = Math.hypot(vx, vy) || 0; g.clear(); if (spd > 40) { const tAng2 = Math.atan2(vy, vx); w._thrAng = (typeof w._thrAng === 'number') ? Phaser.Math.Angle.RotateTo(w._thrAng, tAng2, Phaser.Math.DegToRad(10)) : tAng2; const ux = Math.cos(w._thrAng), uy = Math.sin(w._thrAng); const tail = 10, stub = 5; const tx = w.x - ux * tail, ty = w.y - uy * tail; const sx2 = w.x - ux * stub, sy2 = w.y - uy * stub; try { const g = w._thr; if (g) { g.clear(); } } catch (_) {} } } } catch (_) {}
          // Yellow compact thruster particles during hover (emit from rear with smoothing; fallback to facing when nearly stationary)
          try {
            const sp2 = (w.vx||0)*(w.vx||0) + (w.vy||0)*(w.vy||0);
            const base = (sp2 > 1) ? Math.atan2(w.vy || 0, w.vx || 0) : (w._rot || 0);
            const desired = base + Math.PI;
            w._thrBackAng = (typeof w._thrBackAng === 'number') ? Phaser.Math.Angle.RotateTo(w._thrBackAng, desired, Phaser.Math.DegToRad(12)) : desired;
            const ex = w.x + Math.cos(w._thrBackAng) * 6;
            const ey = w.y + Math.sin(w._thrBackAng) * 6;
            pixelSparks(this, ex, ey, { angleRad: w._thrBackAng, count: 1, spreadDeg: 4, speedMin: 70, speedMax: 120, lifeMs: 50, color: 0xffee66, size: 1, alpha: 0.8 });
          } catch (_) {}

          // Plan dash when locked
          if (t && t.active) {
            const dxp = t.x - this.player.x; const dyp = t.y - this.player.y; const outOfRadius = (dxp * dxp + dyp * dyp) > detectR2;
            // Increased dash cooldown
            const dashReady = (!w.lastDashAt || (now - w.lastDashAt >= 900));
            if (dashReady && (!outOfRadius || !w.didFinalDash)) {
              // Start straight dash toward target, from varied approach angles and shorter range
              const sx = w.x; const sy = w.y; const tx = t.x; const ty = t.y;
              const dx0 = tx - sx; const dy0 = ty - sy; const baseAng = Math.atan2(dy0, dx0);
              if (w._approachSign === undefined) w._approachSign = (Math.random() < 0.5 ? -1 : 1);
              w._approachSign *= -1; // alternate sides each dash (opposite angle)
              const angOff = Phaser.Math.FloatBetween(0.4, 0.7) * w._approachSign; // vary entry angle
              const rOff = Phaser.Math.Between(10, 24); // aim near enemy, not center
              let ex = tx + Math.cos(baseAng + angOff) * rOff;
              let ey = ty + Math.sin(baseAng + angOff) * rOff;
              // Randomize dash length and duration, with overall faster speed
              let dx = ex - sx; let dy = ey - sy; let len = Math.hypot(dx, dy) || 1;
              const minDashLen = 90; const maxDashLen = 140;
              const desired = Math.min(len, Phaser.Math.Between(minDashLen, maxDashLen));
              const ux = dx / len; const uy = dy / len; ex = sx + ux * desired; ey = sy + uy * desired; dx = ex - sx; dy = ey - sy; len = Math.hypot(dx, dy) || 1;
              const dur = Phaser.Math.Between(90, 130); // randomized duration
              const sp = ((len * 1000) / Math.max(1, dur)) * 1.2; // +20% speed boost
              w.vx = (dx / len) * sp; w.vy = (dy / len) * sp;
              w._dash = null;
              w.dashUntil = now + dur; w.lastDashAt = now; w.state = 'dashing'; w.dashHit = false;
              // Blue trail while dashing (more intense and visible)
              try {
                const texKey = 'bit_trail_particle_bold';
                if (!this.textures || !this.textures.exists(texKey)) {
                  const tg = this.make.graphics({ x: 0, y: 0, add: false });
                  tg.clear(); tg.fillStyle(0x66aaff, 1); tg.fillCircle(7, 7, 7);
                  tg.generateTexture(texKey, 14, 14); tg.destroy();
                }
                if (w._trailMgr) { try { w._trailMgr.destroy(); } catch (_) {} w._trailMgr = null; }
                w._trailMgr = this.add.particles(texKey);
                try { w._trailMgr.setDepth?.(9800); } catch (_) {}
                const emitter = w._trailMgr.createEmitter({
                  speed: { min: 0, max: 20 },
                  lifespan: { min: 260, max: 420 },
                  alpha: { start: 1.0, end: 0 },
                  scale: { start: 1.0, end: 0.1 },
                  quantity: 9,
                  frequency: 6,
                  tint: 0x66aaff,
                  blendMode: Phaser.BlendModes.ADD,
                });
                try { emitter.startFollow(w.g); } catch (_) {}
                w._trailEmitter = emitter;
              } catch (_) {}
              if (outOfRadius) w.didFinalDash = true; // one last dash then drop
            }
          }
          return true;
        });
      }
    }

    // Player melee: C key, 150闂? 48px, 10 dmg
    try {
      if (this.inputMgr?.pressedMelee) this.performPlayerMelee?.();
    } catch (_) {}

    // Rebuild nav grid periodically so enemies can re-route around obstacles
    if (!this._nav) this._nav = { grid: null, builtAt: 0 };
    if (!this._nav.grid || (this.time.now - this._nav.builtAt > 1200)) {
      try {
        this._nav.grid = buildNavGrid(this, this.arenaRect, 16);
        this._nav.builtAt = this.time.now;
      } catch (_) {}
    }

    // Hazel Phase Bomb ability: target-following line + timed bombs
    try {
      const plan = this._hzPhasePlan;
      if (plan && plan.active) {
        const now = this.time.now;
        const target = this.getEnemyTarget();
        const tx = (target && typeof target.x === 'number') ? target.x : this.player.x;
        const ty = (target && typeof target.y === 'number') ? target.y : this.player.y;
        // Ensure player-following purple line appears after 0.5s
        if (!this._hzPhasePlayerLine && now >= (plan.startedAt || 0) + 500) {
          const g = this.add.graphics();
          try { g.setDepth(9600); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
          this._hzPhasePlayerLine = g;
        }
        // Update player line to follow the player from top of screen
        if (this._hzPhasePlayerLine) {
          try {
            const g = this._hzPhasePlayerLine;
            const x = tx;
            const rect = this.arenaRect || new Phaser.Geom.Rectangle(0, 0, this.scale.width, this.scale.height);
            g.clear();
            const segTop = Math.max(rect.top + 4, ty - 32);
            const segBottom = Math.max(segTop, ty - 8);
            g.lineStyle(2, 0xaa66ff, 0.9);
            g.beginPath();
            g.moveTo(x, segTop);
            g.lineTo(x, segBottom);
            g.strokePath();
          } catch (_) {}
        }
        // Spawn up to 20 bombs around the player
        if (plan.bombsSpawned < 20 && now >= (plan.nextBombAt || 0)) {
          const ang = Phaser.Math.FloatBetween(0, Math.PI * 2);
          const r = Phaser.Math.Between(60, 140);
          let px = tx + Math.cos(ang) * r;
          let py = ty + Math.sin(ang) * r;
          try {
            const rect = this.arenaRect || new Phaser.Geom.Rectangle(16, 16, this.scale.width - 32, this.scale.height - 32);
            px = Phaser.Math.Clamp(px, rect.left + 8, rect.right - 8);
            py = Phaser.Math.Clamp(py, rect.top + 8, rect.bottom - 8);
          } catch (_) {}
          try {
            teleportSpawnVfx(this, px, py, {
              color: 0xaa66ff,
              onSpawn: () => { try { this._spawnHazelPhaseBomb(px, py); } catch (_) {} },
            });
          } catch (_) {
            try { this._spawnHazelPhaseBomb(px, py); } catch (_) {}
          }
          plan.bombsSpawned += 1;
          plan.nextBombAt = now + 375; // 0.375s between bombs
        }
        // End plan after final bomb's gap; clear player line
        if (plan.bombsSpawned >= 20 && now >= (plan.nextBombAt || 0)) {
          plan.active = false;
          try { this._hzPhasePlayerLine?.destroy(); } catch (_) {}
          this._hzPhasePlayerLine = null;
        }
      }
    } catch (_) {}

    // Update Hazel Phase Bomb instances (visuals + timed explosions)
    if (this._hzPhaseBombs && this._hzPhaseBombs.length) {
      const now = this.time.now;
      this._hzPhaseBombs = this._hzPhaseBombs.filter((bomb) => {
        if (!bomb || !bomb.g) return false;
        const age = now - (bomb.spawnedAt || 0);
        if (age >= 1500) {
          this._explodeHazelPhaseBomb(bomb);
          try { bomb.g?.destroy(); } catch (_) {}
          return false;
        }
        const g = bomb.g;
        try {
          g.clear();
          const baseSize = 12;
          if (age < 1000) {
            // First 1s: darker purple, slower glow
            const t = age / 1000;
            const pulse = 1.0 + 0.18 * Math.sin(t * Math.PI * 2.0);
            const size = baseSize * pulse;
            g.fillStyle(0xaa66ff, 0.9);
            g.fillRect(-size / 2, -size / 2, size, size);
          } else {
            // Last 0.5s: lighter purple, faster glow
            const t = (age - 1000) / 500;
            const pulse = 1.0 + 0.35 * Math.sin(t * Math.PI * 6.0);
            const size = baseSize * (1.1 + 0.3 * t) * pulse;
            g.fillStyle(0xddaaff, 0.95);
            g.fillRect(-size / 2, -size / 2, size, size);
          }
        } catch (_) {}
        return true;
      });
    }

    // Update Dandelion mines (player-triggered red mines laid during assault dash-out)
    if (this._dnMines && this._dnMines.length) {
      const now = this.time.now;
      const px = this.player?.x || 0;
      const py = this.player?.y || 0;
      this._dnMines = this._dnMines.filter((m) => m && m.active);
      for (let i = 0; i < this._dnMines.length; i += 1) {
        const m = this._dnMines[i]; if (!m?.active) continue;
        const dx = px - m.x; const dy = py - m.y;
        const r = m._sensorRadius || 50; const r2 = r * r;
        const dist2 = (dx * dx + dy * dy);
        // Handle sensor trigger
        if (!m._sensorTriggered && dist2 <= r2) {
          m._sensorTriggered = true;
          m._sensorTriggerAt = now;
        }
        // Update glow graphics
        try {
          if (!m._g) {
            const g = this.add.graphics({ x: m.x, y: m.y });
            g.setDepth(9000);
            g.setBlendMode(Phaser.BlendModes.ADD);
            m._g = g;
          }
          const g = m._g;
          g.clear();
          g.setPosition(m.x, m.y);
          const baseSize = 12;
          if (m._sensorTriggered) {
            const age = now - (m._sensorTriggerAt || 0);
            const t = Phaser.Math.Clamp(age / 200, 0, 1);
            const pulse = 1.0 + 0.6 * Math.sin(t * Math.PI * 8.0);
            const size = baseSize * (1.0 + 0.4 * t) * pulse;
            g.fillStyle(0xff6666, 0.95);
            g.fillRect(-size / 2, -size / 2, size, size);
          } else {
            const t = (now % 400) / 400;
            const pulse = 1.0 + 0.2 * Math.sin(t * Math.PI * 2.0);
            const size = baseSize * pulse;
            g.fillStyle(0xff3333, 0.9);
            g.fillRect(-size / 2, -size / 2, size, size);
          }
        } catch (_) {}
        // Explosion timing for sensor-triggered mines
        if (m._sensorTriggered && now >= (m._sensorTriggerAt || 0) + 200) {
          if (typeof m._explodeFn === 'function') m._explodeFn(m);
        }
      }
    }

    // Update Hazel teleport pulses (expanding shield-like rings)
    if (this._hzPulses && this._hzPulses.length) {
      const dt = (this.game?.loop?.delta || 16.7) / 1000;
      const bullets = this.bullets?.getChildren?.() || [];
      this._hzPulses = this._hzPulses.filter((p) => {
        if (!p || !p.g) return false;
        const maxR = p.maxR || 100;
        const stayMs = 1200; // time to remain at max radius before collapsing

        // Grow until max radius
        if (!p.atMaxSince) {
          p.r += (p.speed || 300) * dt;
          if (p.r >= maxR) {
            p.r = maxR;
            p.atMaxSince = this.time.now;
          }
        } else {
          // At max radius: hold for stayMs, then start collapsing
          const elapsed = this.time.now - (p.atMaxSince || 0);
          if (elapsed <= stayMs) {
            p.r = maxR;
          } else {
            // Collapse phase after staying at max
            const collapseSpeed = (p.speed || 300) * 1.4;
            p.r -= collapseSpeed * dt;
            if (p.r <= 0) {
              try { p.g.destroy(); } catch (_) {}
              return false;
            }
          }
        }

        const g = p.g;
        try {
          g.clear();
          const band = p.band || 12;
          const inner = Math.max(4, p.r - band);
          const outer = p.r;
          // Alpha based on collapse progress: fully opaque at max, fade only while shrinking
          let alpha = 0.9;
          if (p.atMaxSince) {
            const elapsed = this.time.now - (p.atMaxSince || 0);
            if (elapsed > stayMs) {
              const collapseFrac = Math.max(0, Math.min(1, 1 - (p.r / maxR)));
              alpha = 0.9 * (1 - collapseFrac * 0.7);
            }
          }
          // Hollow ring similar to player pulse, but purple and wider
          g.lineStyle(4, 0xaa66ff, alpha).strokeCircle(0, 0, outer);
          g.lineStyle(2, 0xddaaff, alpha).strokeCircle(0, 0, inner);
        } catch (_) {}
        // Block player bullets in the band, like a 360闂?Rook shield (skip railgun)
        try {
          const cx = p.x; const cy = p.y;
          const band = p.band || 12;
          const rInner2 = Math.max(0, (p.r - band) * (p.r - band));
          const rOuter2 = p.r * p.r;
          for (let i = 0; i < bullets.length; i += 1) {
            const b = bullets[i]; if (!b?.active || b._rail) continue;
            const dx = b.x - cx; const dy = b.y - cy;
            const d2 = dx * dx + dy * dy;
            if (d2 >= rInner2 && d2 <= rOuter2) {
              // Small spark where the bullet hits the ring
              try { impactBurst(this, b.x, b.y, { color: 0xaa66ff, size: 'small' }); } catch (_) {}
              try { if (b._g) { b._g.destroy(); b._g = null; } } catch (_) {}
              try { if (b.body) b.body.checkCollision.none = true; } catch (_) {}
              try { b.setActive(false).setVisible(false); } catch (_) {}
              try { this.time.delayedCall(0, () => { try { b.destroy(); } catch (_) {} }); } catch (_) {}
            }
          }
        } catch (_) {}
        return true;
      });
    }

    // Update enemies: melee chase; shooters chase gently and fire at intervals; snipers aim then fire
    this.enemies.getChildren().forEach((e) => {
      if (!e.active) return;
      if (e.isDummy) { try { e.body.setVelocity(0, 0); } catch (_) {} return; }
      // Dandelion mines: completely stationary hazards (no movement or AI)
      if (e.isDnMine) { try { e.body?.setVelocity?.(0, 0); } catch (_) {} return; }
      const now = this.time.now;
      const dt = (this.game?.loop?.delta || 16.7) / 1000; // seconds
      const target = this.getEnemyTarget();
      const targetX = (target && typeof target.x === 'number') ? target.x : this.player.x;
      const targetY = (target && typeof target.y === 'number') ? target.y : this.player.y;
      // Bigwig/Dandelion/Hazel: freeze completely during certain boss abilities (movement handled in boss AI)
      try {
        const isBigwig = e.isBoss && (e.bossType === 'Bigwig' || e._bossId === 'Bigwig');
        const channelingBigwig = isBigwig && ((e._bwAbilityState === 'channel') || (e._bwTurretState === 'turretChannel'));
        const isDandelion = e.isBoss && (e.bossType === 'Dandelion' || e._bossId === 'Dandelion');
        const usingDnSpecial = isDandelion && (e._dnSpecialState === 'aim' || e._dnSpecialState === 'burst');
        // Treat Dandelion assault as movement-owned only during windup/dashIn/melee/dashOut.
        // During 'recover', allow generic movement to resume (attacks are still gated in boss AI).
        const dnAssaultActive = isDandelion
          && e._dnAssaultState
          && e._dnAssaultState !== 'idle'
          && e._dnAssaultState !== 'recover';
        const isHazel = e.isBoss && (e.bossType === 'Hazel' || e._bossId === 'Hazel');
        // Hazel: freeze only during Phase Bomb channel; allow movement during missile special
        const channelingHazel = isHazel && (e._hzPhaseState === 'channel');
        const dandelionDashing = isDandelion && e._dnDashState === 'dashing';
        // Special/channel states: zero velocity and skip generic movement
        if (channelingBigwig || usingDnSpecial || channelingHazel) {
          e.body?.setVelocity?.(0, 0);
          return;
        }
        // Dandelion dash/assault: let updateBossAI control velocity; just skip generic movement
        if (dandelionDashing || dnAssaultActive) {
          return;
        }
      } catch (_) {}
      // Hazel missiles: custom homing behavior, no nav/pathfinding
        if (e.isHazelMissile) {
          try {
            if (this._directionalShieldBlocksProjectile(e)) {
              this._directionalShieldAbsorb(20);
              try { impactBurst(this, e.x, e.y, { color: 0xffee66, size: 'small' }); } catch (_) {}
              try { e._vis?.destroy(); } catch (_) {}
              try { e._trailG?.destroy(); } catch (_) {}
              try { e.destroy(); } catch (_) {}
              return;
            }
            const dtMs = (this.game?.loop?.delta || 16.7);
          const dtHz = dtMs / 1000;
          const nowHz = this.time.now;
          const straightUntil = e._hzStraightUntil || 0;
          // During initial straight phase, keep current angle; afterwards, enable homing turn toward player
          if (!straightUntil || nowHz >= straightUntil) {
            const dxm = targetX - e.x;
            const dym = targetY - e.y;
            let desired = Math.atan2(dym, dxm);
            // Unwrap desired relative to current angle to avoid sudden flips around ±π
            if (typeof e._angle === 'number') {
              const current = e._angle;
              const diffWrapped = Phaser.Math.Angle.Wrap(desired - current);
              desired = current + diffWrapped;
            }
            // Hazel missile turn rate: fixed 100 deg/s (time-based)
            const baseTurn = Phaser.Math.DegToRad(100);
            const maxTurn = baseTurn * dtHz; // radians this frame
            if (typeof e._angle === 'number') {
              const current = e._angle;
              let diff = Phaser.Math.Angle.Wrap(desired - current);
              const step = Math.sign(diff) * Math.min(Math.abs(diff), maxTurn);
              e._angle = current + step;
            } else {
              e._angle = desired;
            }
          } else if (typeof e._angle !== 'number') {
            // Failsafe: ensure we have some angle even during straight phase
            const dxm = targetX - e.x;
            const dym = targetY - e.y;
            e._angle = Math.atan2(dym, dxm);
          }
          const vx = Math.cos(e._angle) * (e._speed || 160);
          const vy = Math.sin(e._angle) * (e._speed || 160);
          try { e.body?.setVelocity?.(vx, vy); } catch (_) { try { e.setVelocity(vx, vy); } catch (_) {} }
          // Barricade collision: explode on contact (fallback in case collider misses)
          try {
            let collideBarr = false;
            const circle = new Phaser.Geom.Circle(e.x, e.y, 4);
            const scanBarr = (grp) => {
              const arr = grp?.getChildren?.() || [];
              for (let i = 0; i < arr.length && !collideBarr; i += 1) {
                const s = arr[i]; if (!s?.active) continue;
                const rect = s.getBounds?.() || new Phaser.Geom.Rectangle(s.x - 8, s.y - 8, 16, 16);
                if (Phaser.Geom.Intersects.CircleToRectangle(circle, rect)) { collideBarr = true; break; }
              }
            };
            scanBarr(this.barricadesHard);
            scanBarr(this.barricadesSoft);
            if (collideBarr) {
              this._explodeHazelMissile(e);
              return;
            }
          } catch (_) {}
          // Lifetime cap: explode after 6s
          if (this.time.now - (e._hzSpawnAt || 0) >= 6000) {
            this._explodeHazelMissile(e);
            return;
          }
          // Proximity detonation: 15px sensor radius
          const rSense = 15; const rSense2 = rSense * rSense;
          const pdx = targetX - e.x; const pdy = targetY - e.y;
          if ((pdx * pdx + pdy * pdy) <= rSense2) {
            this._explodeHazelMissile(e);
            return;
          }
            // Update visuals: glowing square + particle-based tracer
          try {
            // Subtle glow pulse on the missile sprite itself
            try {
              const tGlow = ((this.time?.now || 0) % 600) / 600;
              const pulse = 1.0 + 0.15 * Math.sin(tGlow * Math.PI * 2);
              e.setScale(2 * pulse);
              e.setDepth(8800);
              e.setBlendMode(Phaser.BlendModes.ADD);
            } catch (_) {}
            // Particle exhaust only (no static line)
            const back = e._angle + Math.PI;
            const tail = 6;
            const tx = e.x + Math.cos(back) * tail;
            const ty = e.y + Math.sin(back) * tail;
            try {
              pixelSparks(this, tx, ty, {
                angleRad: back,
                count: 2,
                spreadDeg: 26,
                speedMin: 70,
                speedMax: 150,
                lifeMs: 180,
                color: 0xaa66ff,
                size: 3,
                alpha: 0.95,
              });
            } catch (_) {}
            } catch (_) {}
          } catch (_) {}
          return;
        }
        // Swarm Heal Drones: heal closest damaged Swarm drone (heal or laser)
          if (e.isSwarmHealDrone) {
            try {
              const dt = (this.game?.loop?.delta || 16.7) / 1000;
              const nowHd = this.time.now;

              // Initialize idle orbit state once
              if (e._hdIdleAngle === undefined) e._hdIdleAngle = Phaser.Math.FloatBetween(0, Math.PI * 2);
              if (e._hdIdleRadius === undefined) e._hdIdleRadius = Phaser.Math.Between(70, 100);
              if (e._hdIdleSpeed === undefined) e._hdIdleSpeed = Phaser.Math.FloatBetween(0.9, 1.4);
              if (typeof e._hdHoldUntil !== 'number') e._hdHoldUntil = 0;

              // Find up to 3 closest damaged Swarm drones (excluding self)
              const targets = [];
              const arr = this.enemies?.getChildren?.() || [];
              for (let i = 0; i < arr.length; i += 1) {
                const d = arr[i];
                if (!d?.active || d === e) continue;
                if (!(d.isSwarmHealDrone || d.isSwarmLaserDrone || d.isSwarmShooterDrone)) continue;
                const maxHp = Math.max(1, d.maxHp || 1);
                const curHp = Math.max(0, d.hp || 0);
                if (curHp >= maxHp) continue;
                const dx = d.x - e.x; const dy = d.y - e.y;
                const d2 = dx * dx + dy * dy;
                targets.push({ d, d2 });
              }
              targets.sort((a, b) => a.d2 - b.d2);
              const healTargets = targets.slice(0, 3);
              const primaryTarget = healTargets.length ? healTargets[0].d : null;

              // Movement: hold while healing, otherwise move to target or orbit player
              if (nowHd < (e._hdHoldUntil || 0)) {
                try { e.body?.setVelocity?.(0, 0); } catch (_) { try { e.setVelocity(0, 0); } catch (_) {} }
              } else if (primaryTarget) {
                const dx = primaryTarget.x - e.x;
                const dy = primaryTarget.y - e.y;
                const dist = Math.hypot(dx, dy) || 1;
                const sp = 180;
                try { e.body?.setVelocity?.((dx / dist) * sp, (dy / dist) * sp); } catch (_) { try { e.setVelocity((dx / dist) * sp, (dy / dist) * sp); } catch (_) {} }
              } else {
                const player = target;
                if (player && player.active) {
                  e._hdIdleAngle += e._hdIdleSpeed * dt;
                  const r = e._hdIdleRadius || 80;
                  const tx = player.x + Math.cos(e._hdIdleAngle) * r;
                  const ty = player.y + Math.sin(e._hdIdleAngle) * r;
                  const dx = tx - e.x;
                  const dy = ty - e.y;
                  const len = Math.hypot(dx, dy) || 1;
                  const sp = 160;
                  try { e.body?.setVelocity?.((dx / len) * sp, (dy / len) * sp); } catch (_) { try { e.setVelocity((dx / len) * sp, (dy / len) * sp); } catch (_) {} }
                }
              }

              // Healing logic
              if (healTargets.length) {
                const firstAt = e._hdFirstHealAt || 0;
                const nextAt = e._hdNextHealAt || 0;
                const healR = 120;
                if (nowHd >= firstAt && nowHd >= nextAt) {
                  let healedAny = false;
                  for (let i = 0; i < healTargets.length; i += 1) {
                    const tgt = healTargets[i].d;
                    const d2 = healTargets[i].d2;
                    if (d2 > (healR * healR)) continue;
                    const maxHp = Math.max(1, tgt.maxHp || 1);
                    const curHp = Math.max(0, tgt.hp || 0);
                    if (curHp >= maxHp) continue;
                    const heal = Math.max(1, Math.floor(15 * (e._swarmHealMult || 1)));
                    tgt.hp = Math.min(maxHp, curHp + heal);
                    healedAny = true;
                    // Yellow heal beam
                    try {
                      const g = this.add.graphics();
                      try { g.setDepth(9050); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
                      try {
                        g.lineStyle(3, 0xffee66, 0.98).beginPath();
                        g.moveTo(e.x, e.y - 1);
                        g.lineTo(tgt.x, tgt.y - 4);
                        g.strokePath();
                      } catch (_) {}
                      try {
                        this.tweens.add({
                          targets: g,
                          alpha: 0,
                          duration: 200,
                          ease: 'Quad.easeOut',
                          onComplete: () => { try { g.destroy(); } catch (_) {} },
                        });
                      } catch (_) { try { g.destroy(); } catch (_) {} }
                    } catch (_) {}
                  }
                  if (healedAny) e._hdHoldUntil = nowHd + 200;
                  e._hdNextHealAt = nowHd + 1000;
                }
              }
            } catch (_) {}
            return;
          }
        // Heal Drones: BIT-style hover around their owner boss and periodically heal them
          if (e.isHealDrone) {
            try {
              const boss = e._ownerBoss;
              if (!boss || !boss.active || boss.hp <= 0) {
                try { this._destroySupportEnemy(e); } catch (_) {}
                return;
              }
              const dt = (this.game?.loop?.delta || 16.7) / 1000;
              const nowHd = this.time.now;

              // Initialize BIT-like idle/orbit state once
              if (e._hdIdleAngle === undefined) e._hdIdleAngle = Phaser.Math.FloatBetween(0, Math.PI * 2);
              // Keep HealDrones in a modest ring around Dandelion, but within heal range
              if (e._hdIdleRadius === undefined) e._hdIdleRadius = Phaser.Math.Between(48, 72);
              if (e._hdIdleSpeed === undefined) e._hdIdleSpeed = Phaser.Math.FloatBetween(0.8, 1.4); // rad/s, slower than BITs
              if (typeof e._hdHoldUntil !== 'number') e._hdHoldUntil = 0;

              const dxBoss = boss.x - e.x;
              const dyBoss = boss.y - e.y;
              const distBoss2 = dxBoss * dxBoss + dyBoss * dyBoss;
              const distBoss = Math.sqrt(distBoss2) || 1;

              // Movement: if currently holding to fire, stay still; otherwise hover like BIT idle around Dandelion
              if (nowHd < (e._hdHoldUntil || 0)) {
                try { e.body?.setVelocity?.(0, 0); } catch (_) { try { e.setVelocity(0, 0); } catch (_) {} }
              } else {
                // If too far from boss, move straight back toward them
                const maxDist = (e._hdIdleRadius || 60) + 24;
                if (distBoss > maxDist) {
                  const sp = 150; // slower than BITs (260)
                  const vx = (dxBoss / distBoss) * sp;
                  const vy = (dyBoss / distBoss) * sp;
                  try { e.body?.setVelocity?.(vx, vy); } catch (_) { try { e.setVelocity(vx, vy); } catch (_) {} }
                } else {
                  // Idle orbit around boss, BIT-style but slower and closer
                  e._hdIdleAngle += e._hdIdleSpeed * dt;
                  const r = e._hdIdleRadius || 32;
                  const tx = boss.x + Math.cos(e._hdIdleAngle) * r;
                  const ty = boss.y + Math.sin(e._hdIdleAngle) * r;
                  const dx = tx - e.x;
                  const dy = ty - e.y;
                  const len = Math.hypot(dx, dy) || 1;
                  const sp = 140;
                  const vx = (dx / len) * sp;
                  const vy = (dy / len) * sp;
                  try { e.body?.setVelocity?.(vx, vy); } catch (_) { try { e.setVelocity(vx, vy); } catch (_) {} }
                }
              }

              // Healing logic: wait 2s after spawn, then heal 15 HP at 1/s while boss is not at max HP,
              // with a much shorter heal range than BITs' attack range.
              const firstAt = e._hdFirstHealAt || 0;
              const nextAt = e._hdNextHealAt || 0;
              const healR = 72;
              const canHealRange = distBoss2 <= (healR * healR);
              if (nowHd >= firstAt && nowHd >= nextAt && canHealRange) {
                const maxHp = Math.max(1, boss.maxHp || 1);
                const curHp = Math.max(0, boss.hp || 0);
                if (curHp < maxHp) {
                  const heal = 15;
                  boss.hp = Math.min(maxHp, curHp + heal);
                  // Yellow heal beam from drone to boss
                  try {
                    const g = this.add.graphics();
                    try { g.setDepth(9050); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
                    try {
                      g.lineStyle(3, 0xffee66, 0.98).beginPath();
                      g.moveTo(e.x, e.y - 1);
                      g.lineTo(boss.x, boss.y - 4);
                      g.strokePath();
                    } catch (_) {}
                    try {
                      this.tweens.add({
                        targets: g,
                        alpha: 0,
                        duration: 200,
                        ease: 'Quad.easeOut',
                        onComplete: () => { try { g.destroy(); } catch (_) {} },
                      });
                    } catch (_) { try { g.destroy(); } catch (_) {} }
                  } catch (_) {}
                  // Hold briefly in place while "firing" heal laser, BIT-style
                  e._hdHoldUntil = nowHd + 200;
                }
                e._hdNextHealAt = nowHd + 1000;
              }
            } catch (_) {}
            return;
          }
        // Swarm Shooter Drones: hover around player and fire burst shots
        if (e.isSwarmShooterDrone) {
          try {
            const player = target;
            if (!player || !player.active) {
              try { e.destroy(); } catch (_) {}
              return;
            }
            const dt = (this.game?.loop?.delta || 16.7) / 1000;
            const nowSd = this.time.now;

            if (e._sdIdleAngle === undefined) e._sdIdleAngle = Phaser.Math.FloatBetween(0, Math.PI * 2);
            if (e._sdIdleRadius === undefined) e._sdIdleRadius = Phaser.Math.Between(120, 160);
            if (e._sdIdleSpeed === undefined) e._sdIdleSpeed = Phaser.Math.FloatBetween(1.4, 1.8);
            if (typeof e._sdNextBurstAt !== 'number') e._sdNextBurstAt = nowSd + Phaser.Math.Between(800, 1400);

            if (e._sdFiring) {
              try { e.body?.setVelocity?.(0, 0); } catch (_) { try { e.setVelocity(0, 0); } catch (_) {} }
            } else {
              e._sdIdleAngle += e._sdIdleSpeed * dt;
              const r = e._sdIdleRadius || 140;
              const tx = player.x + Math.cos(e._sdIdleAngle) * r;
              const ty = player.y + Math.sin(e._sdIdleAngle) * r;
              const dx = tx - e.x;
              const dy = ty - e.y;
              const len = Math.hypot(dx, dy) || 1;
              const sp = 220;
              try { e.body?.setVelocity?.((dx / len) * sp, (dy / len) * sp); } catch (_) { try { e.setVelocity((dx / len) * sp, (dy / len) * sp); } catch (_) {} }
            }

            if (!e._sdFiring && nowSd >= (e._sdNextBurstAt || 0)) {
              e._sdFiring = true;
              e._sdAimUntil = nowSd + 750;
              e._sdBurstRoundsLeft = 2;
              e._sdShotsLeft = 0;
              e._sdNextShotAt = 0;
              if (!e._aimG) {
                try {
                  e._aimG = this.add.graphics();
                  e._aimG.setDepth(8000);
                  e._aimG.setBlendMode(Phaser.BlendModes.ADD);
                } catch (_) {}
              }
            }

            if (e._sdFiring) {
              if (nowSd < (e._sdAimUntil || 0)) {
                const gAim = e._aimG;
                if (gAim) {
                  try {
                    gAim.clear();
                    gAim.lineStyle(1, 0xff3333, 1);
                    gAim.beginPath();
                    gAim.moveTo(e.x, e.y);
                    gAim.lineTo(player.x, player.y);
                    gAim.strokePath();
                  } catch (_) {}
                }
              } else {
                if (e._sdAimUntil) {
                  e._sdAimUntil = 0;
                  try { e._aimG?.clear(); } catch (_) {}
                  e._sdShotsLeft = 5;
                  e._sdNextShotAt = nowSd;
                }
                if (e._sdShotsLeft > 0 && nowSd >= (e._sdNextShotAt || 0)) {
                  const spread = Phaser.Math.DegToRad(7);
                  const angBase = Math.atan2(player.y - e.y, player.x - e.x);
                  const ang = angBase + Phaser.Math.FloatBetween(-spread / 2, spread / 2);
                  const b = this.enemyBullets.get(e.x, e.y, 'bullet');
                  if (b) {
                    b.setActive(true).setVisible(true);
                    b.setCircle(2).setOffset(-2, -2);
                    b.setVelocity(Math.cos(ang) * 400, Math.sin(ang) * 400);
                    b.damage = Math.max(1, Math.floor(8 * (e._swarmDmgMult || 1)));
                    b.setTint(0xff3333);
                    b.update = () => {
                      const view = this.cameras?.main?.worldView;
                      if (view && !view.contains(b.x, b.y)) { try { b.destroy(); } catch (_) {} }
                    };
                  }
                  e._sdShotsLeft -= 1;
                  e._sdNextShotAt = nowSd + 80;
                }
                if (e._sdShotsLeft <= 0 && e._sdBurstRoundsLeft > 0) {
                  e._sdBurstRoundsLeft -= 1;
                  if (e._sdBurstRoundsLeft > 0) {
                    e._sdShotsLeft = 5;
                    e._sdNextShotAt = nowSd + 120;
                  } else {
                    e._sdFiring = false;
                    e._sdNextBurstAt = nowSd + Phaser.Math.Between(1600, 2600);
                  }
                }
              }
            }
          } catch (_) {}
          return;
        }
        // Swarm Laser Drones: hover around player and sweep a laser
        if (e.isSwarmLaserDrone) {
          try {
            const player = target;
            if (!player || !player.active) {
              try { e.destroy(); } catch (_) {}
              return;
            }
            const dt = (this.game?.loop?.delta || 16.7) / 1000;
            const nowLd = this.time.now;

            if (e._ldIdleAngle === undefined) e._ldIdleAngle = Phaser.Math.FloatBetween(0, Math.PI * 2);
            if (e._ldIdleRadius === undefined) e._ldIdleRadius = Phaser.Math.Between(120, 160);
            if (e._ldIdleSpeed === undefined) e._ldIdleSpeed = Phaser.Math.FloatBetween(1.4, 1.8);
            if (typeof e._ldNextSweepAt !== 'number') e._ldNextSweepAt = nowLd + Phaser.Math.Between(800, 1400);

            if (e._ldSweepActive) {
              try { e.body?.setVelocity?.(0, 0); } catch (_) { try { e.setVelocity(0, 0); } catch (_) {} }
            } else {
              e._ldIdleAngle += e._ldIdleSpeed * dt;
              const r = e._ldIdleRadius || 140;
              const tx = player.x + Math.cos(e._ldIdleAngle) * r;
              const ty = player.y + Math.sin(e._ldIdleAngle) * r;
              const dx = tx - e.x;
              const dy = ty - e.y;
              const len = Math.hypot(dx, dy) || 1;
              const sp = 220;
              try { e.body?.setVelocity?.((dx / len) * sp, (dy / len) * sp); } catch (_) { try { e.setVelocity((dx / len) * sp, (dy / len) * sp); } catch (_) {} }
            }

            if (!e._ldSweepActive && nowLd >= (e._ldNextSweepAt || 0)) {
              e._ldSweepActive = true;
              e._ldAimUntil = nowLd + 750;
              e._ldSweepDuration = 750;
              e._ldSweepT = 0;
              e._ldSweepDir = (Math.random() < 0.5) ? -1 : 1;
              if (!e._aimG) {
                try {
                  e._aimG = this.add.graphics();
                  e._aimG.setDepth(8000);
                  e._aimG.setBlendMode(Phaser.BlendModes.ADD);
                } catch (_) {}
              }
              if (!e._laserG) {
                try {
                  e._laserG = this.add.graphics();
                  e._laserG.setDepth(8000);
                  e._laserG.setBlendMode(Phaser.BlendModes.ADD);
                } catch (_) {}
              }
              e._beamTickAccum = 0;
            }

            if (e._ldSweepActive) {
              const dtMs = (this.game?.loop?.delta || 16.7);
              if (nowLd < (e._ldAimUntil || 0)) {
                const gAim = e._aimG;
                if (gAim) {
                  try {
                    gAim.clear();
                    gAim.lineStyle(1, 0xaa66ff, 1);
                    gAim.beginPath();
                    gAim.moveTo(e.x, e.y);
                    gAim.lineTo(player.x, player.y);
                    gAim.strokePath();
                  } catch (_) {}
                }
              } else {
                if (e._ldAimUntil) {
                  e._ldAimUntil = 0;
                  try { e._aimG?.clear(); } catch (_) {}
                  const base = Math.atan2(player.y - e.y, player.x - e.x);
                  e._ldSweepFrom = base - Phaser.Math.DegToRad(20);
                  e._ldSweepTo = base + Phaser.Math.DegToRad(20);
                  e._ldSweepT = 0;
                }
                e._ldSweepT += dtMs;
                const t = Phaser.Math.Clamp(e._ldSweepT / (e._ldSweepDuration || 750), 0, 1);
                const tt = (e._ldSweepDir === -1) ? (1 - t) : t;
                const ang = e._ldSweepFrom + (e._ldSweepTo - e._ldSweepFrom) * tt;
                const dps = 30 * (e._swarmDpsMult || 1);
                this.renderPrismBeam(e, ang, dtMs / 1000, {
                  applyDamage: true,
                  damagePlayer: true,
                  target,
                  dps,
                  tick: 0.05,
                });
                if (t >= 1) {
                  e._ldSweepActive = false;
                  e._ldNextSweepAt = nowLd + Phaser.Math.Between(1600, 2600);
                  try { e._laserG?.clear(); } catch (_) {}
                  try { e._aimG?.clear(); } catch (_) {}
                }
              }
            }
          } catch (_) {}
          return;
        }
        // Laser Drones: BIT-style hover around the player and sweep a Prism-style laser
        if (e.isLaserDrone) {
          try {
            const player = target;
            if (!player || !player.active) {
              try { e.destroy(); } catch (_) {}
              return;
            }
            const dt = (this.game?.loop?.delta || 16.7) / 1000;
            const nowLd = this.time.now;

            // Initialize BIT-like idle/orbit state once, centered on player
            if (e._ldIdleAngle === undefined) e._ldIdleAngle = Phaser.Math.FloatBetween(0, Math.PI * 2);
            if (e._ldIdleRadius === undefined) e._ldIdleRadius = Phaser.Math.Between(120, 160);
            if (e._ldIdleSpeed === undefined) e._ldIdleSpeed = Phaser.Math.FloatBetween(1.4, 1.8); // faster than HealDrones
            if (typeof e._ldNextSweepAt !== 'number') e._ldNextSweepAt = nowLd + Phaser.Math.Between(800, 1400);

            const dxP = player.x - e.x;
            const dyP = player.y - e.y;
            const distP2 = dxP * dxP + dyP * dyP;

            // Movement: if currently aiming or sweeping, stay still; otherwise hover around player at preferred distance
            if (e._ldSweepActive) {
              try { e.body?.setVelocity?.(0, 0); } catch (_) { try { e.setVelocity(0, 0); } catch (_) {} }
            } else {
              // Idle orbit around player, BIT-style but a bit faster and farther out
              e._ldIdleAngle += e._ldIdleSpeed * dt;
              const r = e._ldIdleRadius || 140;
              const tx = player.x + Math.cos(e._ldIdleAngle) * r;
              const ty = player.y + Math.sin(e._ldIdleAngle) * r;
              const dx = tx - e.x;
              const dy = ty - e.y;
              const len = Math.hypot(dx, dy) || 1;
              const sp = 220;
              const vx = (dx / len) * sp;
              const vy = (dy / len) * sp;
              try { e.body?.setVelocity?.(vx, vy); } catch (_) { try { e.setVelocity(vx, vy); } catch (_) {} }
            }

            // Laser sweep logic: narrower arc than Prism, with a brief aim phase first
            if (!e._ldSweepActive && nowLd >= (e._ldNextSweepAt || 0)) {
              e._ldSweepActive = true;
              // Total hold time while stationary remains 1500ms: 750ms aim + 750ms sweep
              e._ldAimUntil = nowLd + 750;
              e._ldSweepDuration = 750; // ms for actual laser sweep
              e._ldSweepT = 0;
              // Randomize sweep direction each attack (-1 or 1)
              e._ldSweepDir = (Math.random() < 0.5) ? -1 : 1;
              // Create/reuse aim line and laser graphics
              if (!e._aimG) {
                try {
                  e._aimG = this.add.graphics();
                  e._aimG.setDepth(8000);
                  e._aimG.setBlendMode(Phaser.BlendModes.ADD);
                } catch (_) {}
              }
              if (!e._laserG) {
                try {
                  e._laserG = this.add.graphics();
                  e._laserG.setDepth(8000);
                  e._laserG.setBlendMode(Phaser.BlendModes.ADD);
                } catch (_) {}
              }
              e._beamTickAccum = 0;
            }

            if (e._ldSweepActive) {
              const dtMs = (this.game?.loop?.delta || 16.7);
              // Aim phase: draw a lock-on line toward the player, no damage yet
              if (nowLd < (e._ldAimUntil || 0)) {
                const gAim = e._aimG;
                if (gAim) {
                  try {
                    gAim.clear();
                    gAim.lineStyle(1, 0xaa66ff, 1);
                    gAim.beginPath();
                    gAim.moveTo(e.x, e.y);
                    gAim.lineTo(player.x, player.y);
                    gAim.strokePath();
                  } catch (_) {}
                }
              } else {
                // Transition into sweep if just leaving aim phase
                if (e._ldAimUntil) {
                  e._ldAimUntil = 0;
                  // Clear aim graphics once when starting sweep
                  try { e._aimG?.clear(); } catch (_) {}
                  // Lock sweep arc based on player position at sweep start
                  const base = Math.atan2(player.y - e.y, player.x - e.x);
                  // Sweeping beam: 40 degrees total (±20)
                  e._ldSweepFrom = base - Phaser.Math.DegToRad(20);
                  e._ldSweepTo = base + Phaser.Math.DegToRad(20);
                  e._ldSweepT = 0;
                }
                // Sweeping phase: apply damage with narrower arc
                e._ldSweepT += dtMs;
                const t = Phaser.Math.Clamp(e._ldSweepT / (e._ldSweepDuration || 750), 0, 1);
                const tt = (e._ldSweepDir === -1) ? (1 - t) : t;
                const ang = e._ldSweepFrom + (e._ldSweepTo - e._ldSweepFrom) * tt;
                // Sweeping beam: slightly lower DPS than Prism
                this.renderPrismBeam(e, ang, dtMs / 1000, {
                  applyDamage: true,
                  damagePlayer: true,
                  target,
                  dps: 30,
                  tick: 0.05,
                });
                if (t >= 1) {
                  e._ldSweepActive = false;
                  e._ldNextSweepAt = nowLd + Phaser.Math.Between(1600, 2600);
                  try { e._laserG?.clear(); } catch (_) {}
                  try { e._aimG?.clear(); } catch (_) {}
                }
              }
            }
          } catch (_) {}
          return;
        }
        // Turrets: fully stationary enemies with custom firing + aim logic
        if (e.isTurret) {
        const nowT = this.time.now;
        const dxT = targetX - e.x;
        const dyT = targetY - e.y;
        const distT = Math.hypot(dxT, dyT) || 1;
        const fwdX = dxT / distT;
        const fwdY = dyT / distT;
          const angToPlayer = Math.atan2(dyT, dxT);
        // Maintain visuals (base + head)
          try {
            const base = e._turretBase;
            const head = e._turretHead;
            if (base) {
              base.x = e.x; base.y = e.y;
          }
          if (head) {
            const baseH = base ? (base.displayHeight || base.height || 12) : 12;
            head.x = e.x;
            // Place head slightly above the base center (original 0.14 offset)
            head.y = e.y - baseH * 0.14;
          }
          // Flip base horizontally depending on player side (asset faces left by default)
          const facingRight = targetX >= e.x;
          const sx = facingRight ? -Math.abs(base?.scaleX || 1) : Math.abs(base?.scaleX || 1);
          if (base) base.scaleX = sx;
          // Flip head vertically when player is on the right so its silhouette matches both sides
          if (head) {
            const sy = facingRight ? -Math.abs(head.scaleY || 1) : Math.abs(head.scaleY || 1);
            head.scaleY = sy;
          }
          // Rotate head to face player exactly; asset faces left by default, so add PI
          if (head) head.rotation = angToPlayer + Math.PI;
        } catch (_) {}
        // Always-on sniper-style aim line from head tip
        try {
          if (!e._turretAimG) {
            e._turretAimG = this.add.graphics();
            try { e._turretAimG.setDepth?.(8610); } catch (_) {}
          }
          const g = e._turretAimG;
          g.clear();
          const head = e._turretHead;
          const off = typeof e._turretMuzzleOffset === 'number' ? e._turretMuzzleOffset : 10;
          // Muzzle sits at the tip of the head in the forward (to-player) direction
          const hx = head ? head.x + fwdX * off : e.x;
          const hy = head ? head.y + fwdY * off : e.y;
          g.lineStyle(1, 0xff2222, 1);
          g.beginPath();
          g.moveTo(hx, hy);
          g.lineTo(targetX, targetY);
          g.strokePath();
          e._turretMuzzleX = hx;
          e._turretMuzzleY = hy;
        } catch (_) {}
        // Firing: very fast 5-shot bursts, tighter spacing and shorter pauses
        const burstShots = 5;
        const burstDurationMs = 400;
        const interBurstMs = 600; // shorter pause between bursts
        const shotGapMs = Math.floor(burstDurationMs / Math.max(1, burstShots - 1)); // ~100ms
        if (!e._tBurstLeft) e._tBurstLeft = 0;
        if (!e._tBurstCooldownUntil) e._tBurstCooldownUntil = 0;
        if (e._tBurstLeft <= 0 && nowT >= (e._tBurstCooldownUntil || 0)) {
          e._tBurstLeft = burstShots;
          e._tNextShotAt = nowT;
          e._tBurstCooldownUntil = nowT + burstDurationMs + interBurstMs;
        }
        if (e._tBurstLeft > 0 && nowT >= (e._tNextShotAt || 0)) {
          const head = e._turretHead;
          const hx = (typeof e._turretMuzzleX === 'number') ? e._turretMuzzleX : (head ? head.x : e.x);
          const hy = (typeof e._turretMuzzleY === 'number') ? e._turretMuzzleY : (head ? head.y : e.y);
          // Precise aim: no spread for turret shots
          const angShot = Math.atan2(targetY - hy, targetX - hx);
          const speed = 420; // much faster turret bullets
          const vx = Math.cos(angShot) * speed;
          const vy = Math.sin(angShot) * speed;
          const b = this.enemyBullets.get(hx, hy, 'bullet');
          if (b) {
            b.setActive(true).setVisible(true);
            b.setCircle(2).setOffset(-2, -2);
            b.setVelocity(vx, vy);
            b.setTint(0xffff00); // same as shooter bullets
            b.damage = e.damage; // same damage as shooter
            b.update = () => {
              const view = this.cameras?.main?.worldView;
              if (view && !view.contains(b.x, b.y)) { try { b.destroy(); } catch (_) {} }
            };
          }
          e._tBurstLeft -= 1;
          if (e._tBurstLeft > 0) {
            e._tNextShotAt = nowT + shotGapMs;
          }
        }
        // Turrets never move
        try { e.body?.setVelocity?.(0, 0); } catch (_) { try { e.setVelocity(0, 0); } catch (_) {} }
        return;
      }
      // Stun: freeze movement and actions during stun window
      if (e._stunnedUntil && now < e._stunnedUntil) {
        try { e.body?.setVelocity?.(0, 0); } catch (_) { try { e.setVelocity(0, 0); } catch (_) {} }
        return;
      }
      // If under repulsion knockback, override movement for 1s to respect barricade physics
      // Disorientation (toxin) overrides movement briefly
      if (!e.isBoss && e._toxinedUntil && now < e._toxinedUntil) {
        if (!e._wanderChangeAt || now >= e._wanderChangeAt) {
          e._wanderChangeAt = now + Phaser.Math.Between(300, 700);
          const ang = Phaser.Math.FloatBetween(0, Math.PI * 2);
          const mag = Phaser.Math.FloatBetween(0.3, 1.0);
          e._wanderVX = Math.cos(ang) * e.speed * mag;
          e._wanderVY = Math.sin(ang) * e.speed * mag;
        }
        const vx = e._wanderVX || 0; const vy = e._wanderVY || 0;
        try { e.body?.setVelocity?.(vx, vy); } catch (_) { try { e.setVelocity(vx, vy); } catch (_) {} }
        // Do not return; allow shooter logic to run while disoriented
      }
      if (now < (e._repulseUntil || 0)) {
        const vx = e._repulseVX || 0; const vy = e._repulseVY || 0;
        try { e.body?.setVelocity?.(vx, vy); } catch (_) { try { e.setVelocity(vx, vy); } catch (_) {} }
        // Keep Rook shield graphics/collider attached while being pushed
        try {
          if (e.isRook) {
            const r = (e._shieldRadius || 60);
            const gap = 35; const off = (gap - r);
            const cx = e.x + Math.cos(e._shieldAngle || 0) * off;
            const cy = e.y + Math.sin(e._shieldAngle || 0) * off;
            if (e._shieldG) { e._shieldG.setPosition(cx, cy); }
            if (e._shieldZone) {
              const z = e._shieldZone;
              z.setPosition(cx, cy);
              const zoneR = Math.max(8, Math.floor(r));
              try { z.body?.setCircle?.(zoneR); } catch (_) { try { z.body?.setSize?.(Math.ceil(zoneR * 2), Math.ceil(zoneR * 2)); } catch (_) {} }
            }
          }
        } catch (_) {}
        // Interrupt sniper aiming if being repulsed so aim line is cleared
        try {
          if (e.isSniper && e.aiming) {
            e.aiming = false;
            if (e._aimG) { e._aimG.clear?.(); e._aimG.destroy?.(); e._aimG = null; }
          }
        } catch (_) {}
        // Interrupt Prism laser/aim states when knocked by Repulsion Pulse
        try {
          if (e.isPrism) {
            if (e._prismState === 'aim' || e._prismState === 'beam') {
              e._prismState = 'idle';
              if (e._aimG) { e._aimG.clear?.(); e._aimG.destroy?.(); e._aimG = null; }
              if (e._laserG) { e._laserG.clear?.(); e._laserG.destroy?.(); e._laserG = null; }
              e._beamUntil = 0;
            }
            if (e._sweepActive) {
              e._sweepActive = false;
              if (e._laserG) { e._laserG.clear?.(); }
            }
          }
        } catch (_) {}
        return;
      }
      const dx = targetX - e.x;
      const dy = targetY - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      const nx = dx / dist;
      const ny = dy / dist;

      // Movement logic by type
      // Snipers: move like shooters when not aiming, freeze only during aim
      if (!e.isSniper || (e.isSniper && !e.aiming)) {
        let vx = 0, vy = 0;
        let speed = e.speed || 60;
        // Global speed boost for all enemies
        speed *= 1.5;
        // Rook: update and draw shield; turn slowly toward player (30闂?s)
        if (e.isRook) {
          try {
            const targetAng = Math.atan2(dy, dx);
            const maxTurn = Phaser.Math.DegToRad(30) * dt; // rad/s * dt
            const cur = e._shieldAngle || 0;
            const delta = Phaser.Math.Angle.Wrap(targetAng - cur);
            const step = Phaser.Math.Clamp(delta, -maxTurn, maxTurn);
            e._shieldAngle = cur + step;
            if (!e._shieldG) { e._shieldG = this.add.graphics(); try { e._shieldG.setDepth(8500); e._shieldG.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {} }
            const g = e._shieldG; const half = Phaser.Math.DegToRad(45);
            const r = (e._shieldRadius || 60);
          const gap = 35; const off = (gap - r);
            const baseR = r;
            const cx = e.x + Math.cos(e._shieldAngle) * off;
            const cy = e.y + Math.sin(e._shieldAngle) * off;
            // Match player shield VFX style: pulsing radius and alpha, two stroke layers
            const t = ((this.time?.now || 0) % 1000) / 1000;
            const radius = baseR + Math.sin(t * Math.PI * 2) * 1.0;
            const p = 1; // no shield HP for enemies; use full visual strength
            const alpha = (0.12 + 0.28 * p) + Math.sin(t * Math.PI * 2) * 0.04 * p;
            try {
              g.clear(); g.setPosition(cx, cy);
              // Exact player shield style but as an arc and red palette
              g.lineStyle(3, 0xff6666, 0.55 + 0.4 * p).beginPath(); g.arc(0, 0, radius, e._shieldAngle - half, e._shieldAngle + half, false); g.strokePath();
              g.lineStyle(2, 0xff9999, 0.3 + 0.4 * p).beginPath(); g.arc(0, 0, Math.max(11, radius - 2.5), e._shieldAngle - half, e._shieldAngle + half, false); g.strokePath();
              try { g.setAlpha(alpha); } catch (_) {}
            } catch (_) {}

            // Transparent red sector from Rook to arc (visual coverage area)
            // Connector lines from Rook center to arc endpoints (transparent red)
            try {
              const rx = e.x - cx, ry = e.y - cy; // rook center in shield local coords
              const a1 = e._shieldAngle - half; const a2 = e._shieldAngle + half;
              const ex1 = Math.cos(a1) * radius, ey1 = Math.sin(a1) * radius;
              const ex2 = Math.cos(a2) * radius, ey2 = Math.sin(a2) * radius;
              g.lineStyle(1, 0xff3333, 0.22).beginPath(); g.moveTo(rx, ry); g.lineTo(ex1, ey1); g.strokePath();
              g.lineStyle(1, 0xff3333, 0.22).beginPath(); g.moveTo(rx, ry); g.lineTo(ex2, ey2); g.strokePath();
            } catch (_) {}

                        try {
              const r = (e._shieldRadius || 60);
              const gap = 35; const off = (gap - r);
              const cx = e.x + Math.cos(e._shieldAngle || 0) * off;
              const cy = e.y + Math.sin(e._shieldAngle || 0) * off;
              const zoneR = Math.max(8, Math.floor(r));
              if (!e._shieldZone || !e._shieldZone.body) {
                const z = this.add.zone(cx, cy, Math.ceil(zoneR * 2), Math.ceil(zoneR * 2));
                this.physics.world.enable(z);
                z.body.setAllowGravity(false);
                z.body.setImmovable(true);
                try { z.body.setCircle(zoneR); } catch (_) { try { z.body.setSize(Math.ceil(zoneR * 2), Math.ceil(zoneR * 2)); } catch (_) {} }
                z._owner = e; e._shieldZone = z; this.rookShieldGroup.add(z);
              } else {
                const z = e._shieldZone; z.setPosition(cx, cy);
                try { z.body.setCircle(zoneR); } catch (_) { try { z.body.setSize(Math.ceil(zoneR * 2), Math.ceil(zoneR * 2)); } catch (_) {} }
              }
            } catch (_) {}
          } catch (_) {}
        }
        // Melee attack state machine (for base + runner + rook)
        if (e.isMelee && !e.isShooter && !e.isSniper && !e.isGrenadier) {
          // Align enemy melee FOV with player melee (150闂?total => 75闂?half-angle)
          // Shorter timings for snappier combat: reduced windup, sweep, and recovery
          let cfg = e.isRunner ? { range: 64, half: Phaser.Math.DegToRad(75), wind: 170, sweep: 90, recover: 420 } : { range: 56, half: Phaser.Math.DegToRad(75), wind: 120, sweep: 90, recover: 500 };
          if (e.isRook) { cfg = { range: 90, half: Phaser.Math.DegToRad(75), wind: 250, sweep: 90, recover: 650 }; }
          if (!e._mState) e._mState = 'idle';
          // Enter windup if player close
          if (e._mState === 'idle') {
            if (dist <= (cfg.range + 8)) {
              e._mState = 'windup'; e._meleeUntil = now + cfg.wind; e._meleeFacing = Math.atan2(dy, dx); e._meleeAlt = !e._meleeAlt;
            }
          }
          // Freeze during windup
          if (e._mState === 'windup') {
            vx = 0; vy = 0;
            if (now >= (e._meleeUntil || 0)) {
              // Start sweep (VFX matches player's 150闂?cone)
              e._mState = 'sweep'; e._meleeDidHit = false; e._meleeUntil = now + cfg.sweep;
              // Enemy slash VFX fixed at 90ms to match player
              try { this.spawnMeleeVfx(e, e._meleeFacing, 150, 90, 0xff3333, cfg.range, e._meleeAlt); } catch (_) {}
              // Damage tick ~45ms after sweep begins
              this.time.delayedCall(45, () => {
                if (!e.active || e._mState !== 'sweep') return;
                const pdx = this.player.x - e.x; const pdy = this.player.y - e.y;
                const dd = Math.hypot(pdx, pdy) || 1;
                const angP = Math.atan2(pdy, pdx);
                const diff = Math.abs(Phaser.Math.Angle.Wrap(angP - (e._meleeFacing || 0)));
                if (dd <= cfg.range && diff <= cfg.half && !e._meleeDidHit) {
                  this.applyPlayerDamage((e.damage || 10));
                  // Short melee-specific i-frames so multiple melee hits don't stack instantly
                  this.player.iframesUntil = this.time.now + 75;
                  try { impactBurst(this, this.player.x, this.player.y, { color: 0xff3333, size: 'small' }); } catch (_) {}
                  e._meleeDidHit = true;
                  if (this.gs && this.gs.hp <= 0) {
                    try {
                      const eff = getPlayerEffects(this.gs);
                      this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
                      this.gs.nextScene = SceneKeys.Hub;
                      SaveManager.saveToLocal(this.gs);
                      this.scene.start(SceneKeys.Hub);
                    } catch (_) {}
                    return;
                  }
                }
              });
            }
          }
          // During sweep, stand still
          if (e._mState === 'sweep') {
            vx = 0; vy = 0;
            if (now >= (e._meleeUntil || 0)) {
              e._mState = 'recover'; e._meleeUntil = now + cfg.recover; e._meleeSlowUntil = now + 280;
            }
          }
          // Recovery: reduced movement speed, then back to idle
          if (e._mState === 'recover') {
            // Slowdown applied later to smoothed velocity
            if (now >= (e._meleeUntil || 0)) { e._mState = 'idle'; }
          }
        }
        // Boss: constantly damage soft barricades in a 37x37 square around their body
        if (e.isBoss) {
          try { this.damageNearbySoftBarricadesForBoss(e); } catch (_) {}
        }
        // Boss melee: auto-trigger a Rook-style melee when the player gets close,
        // using a separate state machine so existing boss AI remains unchanged.
        if (e.isBoss && e._bossMeleeEnabled) {
          const cfg = e._bossMeleeCfg || { range: 90, half: Phaser.Math.DegToRad(75), wind: 250, sweep: 90, recover: 650 };
          const detect = typeof e._bossMeleeRadius === 'number' ? e._bossMeleeRadius : (cfg.range + 8);
          if (!e._bmState) e._bmState = 'idle';
          // Enter windup if player is within detection radius
          if (e._bmState === 'idle') {
            if (dist <= detect) {
              e._bmState = 'windup';
              e._bmUntil = now + cfg.wind;
              e._bmFacing = Math.atan2(dy, dx);
              e._bmAlt = !e._bmAlt;
            }
          }
          // Freeze during windup
          if (e._bmState === 'windup') {
            vx = 0; vy = 0;
            if (now >= (e._bmUntil || 0)) {
              // Start sweep using the same VFX as enemy melee/Rook
              e._bmState = 'sweep';
              e._bmDidHit = false;
              e._bmUntil = now + cfg.sweep;
              try { this.spawnMeleeVfx(e, e._bmFacing, 150, 90, 0xff3333, cfg.range, e._bmAlt); } catch (_) {}
              // Damage tick ~45ms after sweep begins, matching existing melee timing
              this.time.delayedCall(45, () => {
                if (!e.active || e._bmState !== 'sweep') return;
                const pdx = this.player.x - e.x; const pdy = this.player.y - e.y;
                const dd = Math.hypot(pdx, pdy) || 1;
                const angP = Math.atan2(pdy, pdx);
                const diff = Math.abs(Phaser.Math.Angle.Wrap(angP - (e._bmFacing || 0)));
                if (dd <= cfg.range && diff <= cfg.half && !e._bmDidHit) {
                  this.applyPlayerDamage((e.damage || 10));
                  this.player.iframesUntil = this.time.now + 75;
                  try { impactBurst(this, this.player.x, this.player.y, { color: 0xff3333, size: 'small' }); } catch (_) {}
                  e._bmDidHit = true;
                  if (this.gs && this.gs.hp <= 0) {
                    try {
                      const eff = getPlayerEffects(this.gs);
                      this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
                      this.gs.nextScene = SceneKeys.Hub;
                      SaveManager.saveToLocal(this.gs);
                      this.scene.start(SceneKeys.Hub);
                    } catch (_) {}
                    return;
                  }
                }
              });
            }
          }
          // During sweep, stand still
          if (e._bmState === 'sweep') {
            vx = 0; vy = 0;
            if (now >= (e._bmUntil || 0)) {
              e._bmState = 'recover';
              e._bmUntil = now + cfg.recover;
              // Reuse melee slowdown window so bosses briefly move slower after a swing
              e._meleeSlowUntil = now + 280;
            }
          }
          // Recovery: then back to idle
          if (e._bmState === 'recover') {
            if (now >= (e._bmUntil || 0)) { e._bmState = 'idle'; }
          }
        }
        // Pathfinding when LOS to player is blocked
        let usingPath = false;
        const losBlocked = this.isLineBlocked(e.x, e.y, targetX, targetY);
        if (losBlocked && this._nav?.grid) {
          const needRepath = (!e._path || (e._pathIdx == null) || (e._pathIdx >= e._path.length) || (now - (e._lastPathAt || 0) > ((e.isGrenadier && e._charging) ? 300 : 800)));
          if (needRepath) {
            try {
              const [sgx, sgy] = worldToGrid(this._nav.grid, e.x, e.y);
              const [ggx, ggy] = worldToGrid(this._nav.grid, targetX, targetY);
              e._path = findPath(this._nav.grid, sgx, sgy, ggx, ggy) || null;
              e._pathIdx = 0; e._lastPathAt = now;
            } catch (_) {}
          }
          const wp = (e._path && e._path[e._pathIdx || 0]) || null;
          if (wp) {
            const tx = wp[0], ty = wp[1];
            const pdx = tx - e.x; const pdy = ty - e.y;
            const pd = Math.hypot(pdx, pdy) || 1;
            if (pd < 10) { e._pathIdx = (e._pathIdx || 0) + 1; }
            else { const px = pdx / pd; const py = pdy / pd; vx = px * speed; vy = py * speed; usingPath = true; }
          }
        }
        // Snitch custom kiting movement
        if (e.isSnitch) {
          const desired = 280; const minD = 200; const maxD = 360;
          // Choose a retreat target when too close, or orbit when in band
          if (dist < minD) {
            // Find a point away from player within arena
            const backX = Phaser.Math.Clamp(e.x - nx * 180, 16, this.scale.width - 16);
            const backY = Phaser.Math.Clamp(e.y - ny * 180, 16, this.scale.height - 16);
            let tx = backX, ty = backY;
            // Use pathfinding if LOS blocked
            if (this._nav?.grid) {
              try {
                const [sgx, sgy] = worldToGrid(this._nav.grid, e.x, e.y);
                const [ggx, ggy] = worldToGrid(this._nav.grid, tx, ty);
                const path = findPath(this._nav.grid, sgx, sgy, ggx, ggy) || null;
                if (path && path.length) {
                  const wp = path[0];
                  const pdx = wp[0] - e.x; const pdy = wp[1] - e.y;
                  const pd = Math.hypot(pdx, pdy) || 1;
                  const px = pdx / pd; const py = pdy / pd;
                  vx = px * speed; vy = py * speed; usingPath = true;
                }
              } catch (_) {}
            }
            if (!usingPath) { vx = -nx * speed; vy = -ny * speed; }
          } else if (dist > maxD) {
            // Approach back into desired band
            vx = nx * speed * 0.8; vy = ny * speed * 0.8;
          } else {
            // Strafe/orbit around player
            const px = -ny, py = nx;
            const dir = (e._strafeDir === -1) ? -1 : 1; e._strafeDir = dir;
            vx = px * speed * 0.7 * dir; vy = py * speed * 0.7 * dir;
            if (!e._nextStrafeFlip || now - e._nextStrafeFlip > 1600) { e._strafeDir = (Math.random() < 0.5) ? -1 : 1; e._nextStrafeFlip = now + Phaser.Math.Between(1600, 2600); }
          }
        }
        // Treat snipers like shooters for movement behavior (exclude Snitch's custom logic)
        if (!usingPath && ((e.isShooter && !e.isSnitch) || e.isSniper)) {
          // Random wander; approach if far, back off if too close
          if (!e._wanderChangeAt || now >= e._wanderChangeAt) {
            // Longer hold times to avoid twitching
            e._wanderChangeAt = now + Phaser.Math.Between(1400, 2600);
            const ang = Phaser.Math.FloatBetween(0, Math.PI * 2);
            const mag = Phaser.Math.FloatBetween(0.6, 1.0);
            e._wanderVX = Math.cos(ang) * speed * mag;
            e._wanderVY = Math.sin(ang) * speed * mag;
          }
          // Desired velocity combines wander and a gentle bias toward/away from player
          vx = (e._wanderVX || 0);
          vy = (e._wanderVY || 0);
          // Bias towards player direction even when not far
          vx += nx * speed * 0.2; vy += ny * speed * 0.2;
          const far = dist > 280, tooClose = dist < 140;
          if (far) { vx += nx * speed * 0.75; vy += ny * speed * 0.75; }
          else if (tooClose) { vx -= nx * speed * 0.65; vy -= ny * speed * 0.65; }
        } else if (!usingPath) {
          // Melee: zig-zag sometimes; otherwise straight chase, with occasional wander/flee
          if (!e._zigPhase) e._zigPhase = Phaser.Math.FloatBetween(0, Math.PI * 2);
          if (!e._mode || now >= (e._modeUntil || 0)) {
            const r = Math.random();
            if (r < 0.55) e._mode = 'straight';
            else if (r < 0.75) e._mode = 'zig';
            else if (r < 0.90) e._mode = 'wander';
            else e._mode = 'flee';
            e._modeUntil = now + Phaser.Math.Between(900, 2200);
            if (e._mode === 'wander') {
              const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
              e._wanderVX = Math.cos(a) * speed * 0.6;
              e._wanderVY = Math.sin(a) * speed * 0.6;
            }
            if (e._mode === 'zig') {
              // Choose a smooth frequency and strafe amplitude for this zig session
              e._zigFreq = Phaser.Math.FloatBetween(1.0, 2.0); // Hz
              e._zigAmp = Phaser.Math.FloatBetween(0.5, 0.75); // strafe weight (slightly reduced)
            }
          }
          if (e._mode === 'zig') {
            // Perpendicular wiggle to dodge
            const px = -ny, py = nx;
            if (!e._lastZigT) e._lastZigT = now;
            const dtMs = Math.max(1, now - e._lastZigT);
            // Smooth continuous phase advance based on frequency
            const freq = e._zigFreq || 1.5; // Hz
            e._zigPhase += (Math.PI * 2) * freq * (dtMs / 1000);
            e._lastZigT = now;
            const w = Math.sin(e._zigPhase);
            const zigSpeed = speed * 1.5; // 150% of normal during zig-zag
            const amp = e._zigAmp || 0.75;
            vx = nx * zigSpeed * (0.85 + 0.10 * Math.sin(e._zigPhase * 0.5)) + px * zigSpeed * amp * w;
            vy = ny * zigSpeed * (0.85 + 0.10 * Math.sin(e._zigPhase * 0.5)) + py * zigSpeed * amp * w;
          } else if (e._mode === 'wander') {
            vx = (e._wanderVX || 0) * 0.9; vy = (e._wanderVY || 0) * 0.9;
          } else if (e._mode === 'straight') {
            vx = nx * speed; vy = ny * speed;
          } else { // flee
            vx = -nx * speed * 0.9; vy = -ny * speed * 0.9;
          }
        }
        // If disoriented by toxin, override with wander velocity but still allow firing logic later
        if (!e.isBoss && e._toxinedUntil && now < e._toxinedUntil) {
          vx = (e._wanderVX || 0);
          vy = (e._wanderVY || 0);
        }
        // Grenadier enrage: charge player under 25% HP and explode on contact
        if (e.isGrenadier && !e._charging && (typeof e.hp === 'number') && (typeof e.maxHp === 'number') && e.hp <= 0.25 * e.maxHp) {
          e._charging = true;
        }
        if (e.isGrenadier && e._charging) {
          // Prefer pathing around obstacles while charging if a path exists
          const chargeMul = 4.0; // faster suicide run
          if (!usingPath) {
            const ang = Math.atan2(dy, dx);
            const sp = (e.speed || 40) * chargeMul;
            vx = Math.cos(ang) * sp; vy = Math.sin(ang) * sp;
          } else {
            // Scale the path-follow velocity up to match charge speed
            vx *= chargeMul; vy *= chargeMul;
          }
        }
        // Smooth velocity to avoid twitching (inertia/acceleration)
        const smooth = 0.12; // approaching target ~12% per frame
        if (e._svx === undefined) e._svx = 0;
        if (e._svy === undefined) e._svy = 0;
        e._svx += (vx - e._svx) * smooth;
        e._svy += (vy - e._svy) * smooth;
        // Post-sweep slow for melee enemies (reduced slowdown: 60% speed)
        if ((e.isMelee || e.isBoss) && e._meleeSlowUntil && now < e._meleeSlowUntil) { e._svx *= 0.6; e._svy *= 0.6; }
        e.body.setVelocity(e._svx, e._svy);
        // Separate, lightweight hover effect: only when overlapping player, nudge position outward
        // This does not alter movement modes or velocities; we only correct penetration
        try {
          if (e.isMelee) {
            const pBody = this.player.body || {};
            const eBody = e.body || {};
            const pr = Math.max(4, Math.max(pBody.halfWidth || 0, pBody.halfHeight || 0) || 6);
            const er = Math.max(4, Math.max(eBody.halfWidth || 0, eBody.halfHeight || 0) || 6);
            const minSep = pr + er - 1; // require a small gap; treat below as overlap
            const dxs = e.x - this.player.x; const dys = e.y - this.player.y;
            const d2 = dxs * dxs + dys * dys;
            if (d2 < (minSep * minSep)) {
              const d = Math.max(1e-3, Math.sqrt(d2));
              let ux = dxs / d, uy = dys / d;
              if (!isFinite(ux) || !isFinite(uy)) { ux = 1; uy = 0; }
              const push = (minSep - d) + 0.5; // add a tiny buffer
              e.x += ux * push; e.y += uy * push;
            }
          }
        } catch (_) {}
        // Stuck detection triggers repath (more aggressive during Grenadier charge)
        if (e._lastPosT === undefined) { e._lastPosT = now; e._lx = e.x; e._ly = e.y; }
        if (now - e._lastPosT > 400) {
          const md = Math.hypot((e.x - (e._lx || e.x)), (e.y - (e._ly || e.y)));
          e._lx = e.x; e._ly = e.y; e._lastPosT = now;
          const stuckWhileCharging = (e.isGrenadier && e._charging && md < 3); if ((md < 2 && this.isLineBlocked(e.x, e.y, targetX, targetY)) || stuckWhileCharging) { e._path = null; e._pathIdx = 0; e._lastPathAt = 0; }
        }
      }
      // Grenadier: detonate if player within trigger radius while charging
      if (e.isGrenadier && e._charging) {
        const dxp = targetX - e.x; const dyp = targetY - e.y;
        const trig = (e.detonateTriggerRadius || 40);
        if ((dxp * dxp + dyp * dyp) <= (trig * trig)) {
          try { this.killEnemy(e); } catch (_) {}
        }
      }
      // Clamp enemies to screen bounds as a failsafe
      try {
        const pad = (e.body?.halfWidth || 6);
        const w = this.scale.width, h = this.scale.height;
        e.x = Phaser.Math.Clamp(e.x, pad, w - pad);
        e.y = Phaser.Math.Clamp(e.y, pad, h - pad);
      } catch (_) {}

      if (e.isShooter) {
        if (!e.lastShotAt) e.lastShotAt = 0;
        // Boss: custom AI drives firing; skip default shooter logic
        if (e.isBoss) {
          // handled in updateBossAI()
        } else if (e.isPrism) {
          const nowT = this.time.now;
          // Prism: two behaviors 闂?sweeping beam, and special aim-then-beam
          // Freeze during aim/beam
          if (e._prismState === 'aim' || e._prismState === 'beam') {
            try { e.body?.setVelocity?.(0, 0); } catch (_) {}
            // Ensure sweep is cancelled while aiming or beaming
            if (e._sweepActive) { e._sweepActive = false; try { e._laserG?.clear(); } catch (_) {} }
          }
          // End aim -> start beam
          if (e._prismState === 'aim' && nowT >= (e._aimUntil || 0)) {
            e._prismState = 'beam';
            e._beamUntil = nowT + 1500; // 1.5s
            // Lock beam angle at start toward player
            e._beamAngle = Math.atan2((targetY - e.y), (targetX - e.x));
            try { e._aimG?.clear(); } catch (_) {}
            if (!e._laserG) { e._laserG = this.add.graphics(); try { e._laserG.setDepth(8000); e._laserG.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {} }
            e._beamTickAccum = 0;
          }
          // Finish beam
          if (e._prismState === 'beam' && nowT >= (e._beamUntil || 0)) {
            e._prismState = 'idle';
            try { e._laserG?.clear(); } catch (_) {}
            // Visual-only cooldown: brief exhaust after beam stops
            try { e._prismCoolUntil = nowT + 750; } catch (_) {}
            // Reset sweep counter and delay next sweep so resuming isn't immediate
            e._sweepsSinceAbility = 0;
            e._nextSweepAt = nowT + Phaser.Math.Between(2500, 3500);
          }
          // Trigger special ability after 3 completed sweeps (handled via idle -> pending aim)
          // Update aim line
          if (e._prismState === 'aim') {
            if (e._aimG) {
              try { e._aimG.clear(); e._aimG.lineStyle(1, 0xff2222, 1); e._aimG.beginPath(); e._aimG.moveTo(e.x, e.y); e._aimG.lineTo(targetX, targetY); e._aimG.strokePath(); } catch (_) {}
            }
          }
          // Draw and apply beam damage (beam follows player during fire)
          if (e._prismState === 'beam') {
            // Continuous narrow beam (aimed at player)
            e._beamAngle = Math.atan2((targetY - e.y), (targetX - e.x));
                this.renderPrismBeam(e, e._beamAngle, (this.game?.loop?.delta || 16.7) / 1000, {
                  applyDamage: true,
                  damagePlayer: true,
                  target,
                  // Focused beam: lower DPS
                  dps: 5,
                  tick: 0.05,
                });
          }
          // Sweeping laser while idle
          if (e._prismState === 'idle' || !e._prismState) {
            if (!e._sweepActive && nowT >= (e._nextSweepAt || 0)) {
              if (e._pendingAim) {
                // Start special aim phase after standard sweep delay
                e._pendingAim = false;
                e._sweepsSinceAbility = 0;
                e._prismState = 'aim';
                e._aimUntil = nowT + 1750; // lock for 1.75s
                if (!e._aimG) e._aimG = this.add.graphics();
                try {
                  e._aimG.clear();
                  e._aimG.lineStyle(1, 0xff2222, 1);
                  e._aimG.beginPath();
                  e._aimG.moveTo(e.x, e.y);
                  e._aimG.lineTo(targetX, targetY);
                  e._aimG.strokePath();
                } catch (_) {}
              } else {
                e._sweepActive = true;
                const base = Math.atan2(targetY - e.y, targetX - e.x);
                // Sweeping beam: 80 degrees total, slower
                e._sweepFrom = base - Phaser.Math.DegToRad(40);
                e._sweepTo = base + Phaser.Math.DegToRad(40);
                e._sweepT = 0; e._sweepDuration = 1500; // ms
                // Alternate sweep direction each time: 1 then -1 then 1 ...
                e._sweepDir = (e._sweepDir === -1) ? 1 : -1;
                if (!e._laserG) { e._laserG = this.add.graphics(); try { e._laserG.setDepth(8000); e._laserG.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {} }
                e._sweepTickAccum = 0;
              }
            }
            if (e._sweepActive) {
              const dtMs = (this.game?.loop?.delta || 16.7);
              e._sweepT += dtMs;
              const t = Phaser.Math.Clamp(e._sweepT / (e._sweepDuration || 900), 0, 1);
              const tt = (e._sweepDir === -1) ? (1 - t) : t;
              const ang = e._sweepFrom + (e._sweepTo - e._sweepFrom) * tt;
              // Sweeping beam: higher DPS than narrow beam
              this.renderPrismBeam(e, ang, dtMs / 1000, {
                applyDamage: true,
                damagePlayer: true,
                target,
                // Sweeping beam: increased DPS with faster ticks
                dps: 60,
                tick: 0.025,
              });
              if (t >= 1) {
                e._sweepActive = false; try { e._laserG?.clear(); } catch (_) {}
                // Visual-only cooldown: Hazel-style exhaust from Prism backside for 0.75s
                try { e._prismCoolUntil = nowT + 750; } catch (_) {}
                // Count completed sweep and schedule next unless ability will fire immediately
                e._sweepsSinceAbility = (e._sweepsSinceAbility || 0) + 1;
                if (e._sweepsSinceAbility >= 3) {
                  // After third sweep, schedule special aim to start after normal sweep gap
                  e._pendingAim = true;
                  e._nextSweepAt = nowT + Phaser.Math.Between(1200, 1800);
                } else {
                  e._nextSweepAt = nowT + Phaser.Math.Between(1200, 1800);
                }
              }
            }
            // When Prism is not firing a laser, draw brief exhaust if cooling timer is active
            if ((e._prismCoolUntil || 0) > nowT && e._prismState !== 'beam') {
              try {
                const facingRight = targetX >= e.x;
                const back = facingRight ? Math.PI : 0;
                const tail = 10;
                const tx = e.x + Math.cos(back) * tail;
                const ty = e.y + Math.sin(back) * tail;
                pixelSparks(this, tx, ty, {
                  angleRad: back,
                  count: 2,
                  spreadDeg: 26,
                  speedMin: 70,
                  speedMax: 150,
                  lifeMs: 180,
                  color: 0xffffff,
                  size: 3,
                  alpha: 0.95,
                });
              } catch (_) {}
            }
          }
        } else if (e.isSnitch) {
          const nowT = this.time.now;
          // Ability: call reinforcements every 8s
          if (nowT >= (e._callNextAt || 0)) {
            e._callNextAt = nowT + 8000;
            // Spawn 1 reinforcement near the Snitch
            const mods = (this.gs?.getDifficultyMods?.() || { enemyHp: 1, enemyDamage: 1 });
            for (let k = 0; k < 1; k += 1) {
              const ang = Phaser.Math.FloatBetween(0, Math.PI * 2);
              const r = Phaser.Math.Between(60, 120);
              const sx = Phaser.Math.Clamp(e.x + Math.cos(ang) * r, 16, this.scale.width - 16);
              const sy = Phaser.Math.Clamp(e.y + Math.sin(ang) * r, 16, this.scale.height - 16);
              const roll = Math.random();
              let spawnFn;
              if (roll < 0.15) spawnFn = (sc, x, y) => createSniperEnemy(sc, x, y, Math.floor(80 * mods.enemyHp), Math.floor(18 * mods.enemyDamage), 40);
              else if (roll < 0.35) spawnFn = (sc, x, y) => createShooterEnemy(sc, x, y, Math.floor(90 * mods.enemyHp), Math.floor(8 * mods.enemyDamage), 50, 900);
              else if (roll < 0.50) spawnFn = (sc, x, y) => createMachineGunnerEnemy(sc, x, y, Math.floor(140 * mods.enemyHp), Math.floor(5 * mods.enemyDamage), 35, 1100, 12, 24);
              else if (roll < 0.65) spawnFn = (sc, x, y) => createRocketeerEnemy(sc, x, y, Math.floor(80 * mods.enemyHp), Math.floor(12 * mods.enemyDamage), 40, 2000);
              else if (roll < 0.85) spawnFn = (sc, x, y) => { const meleeDmg = Math.floor(Math.floor(10 * mods.enemyDamage) * 1.5); return createRunnerEnemy(sc, x, y, Math.floor(60 * mods.enemyHp), meleeDmg, 120); };
              else spawnFn = (sc, x, y) => { const meleeDmg = Math.floor(Math.floor(10 * mods.enemyDamage) * 1.5); return createEnemy(sc, x, y, Math.floor(100 * mods.enemyHp), meleeDmg, 60); };
              // Teleport-style spawn VFX: descending purple line, then ring + enemy spawn together
              try {
                teleportSpawnVfx(this, sx, sy, {
                  color: 0xaa66ff,
                  onSpawn: () => {
                    try {
                      const ally = spawnFn(this, sx, sy);
                      if (ally) this.enemies.add(ally);
                    } catch (_) {}
                    try { impactBurst(this, sx, sy, { color: 0xaa66ff, size: 'small' }); } catch (_) {}
                  },
                });
              } catch (_) {
                // Fallback: spawn instantly if VFX fails for any reason
                try {
                  const ally = spawnFn(this, sx, sy);
                  if (ally) this.enemies.add(ally);
                } catch (_) {}
              }
            }
          }
          // Shotgun: only when close
          const close = dist < 220;
          const canShoot = close && (nowT - e.lastShotAt > 1000);
          if (canShoot) {
            e.lastShotAt = nowT;
            const pellets = 3; const spreadDeg = 24;
            const base = Math.atan2(dy, dx);
            for (let pi = 0; pi < pellets; pi += 1) {
              const t = (pellets === 1) ? 0 : (pi / (pellets - 1) - 0.5);
              const ang = base + Phaser.Math.DegToRad(spreadDeg) * t;
              const speedB = 260;
              const vx = Math.cos(ang) * speedB; const vy = Math.sin(ang) * speedB;
              const b = this.enemyBullets.get(e.x, e.y, 'bullet');
              if (b) {
                b.setActive(true).setVisible(true);
                b.setCircle(2).setOffset(-2, -2);
                b.setVelocity(vx, vy);
                b.setTint(0xffcc00);
                b.damage = e.damage;
                b.update = () => { const view = this.cameras?.main?.worldView; if (view && !view.contains(b.x, b.y)) { b.destroy(); } };
              }
            }
          }
        } else if (e.isGrenadier) {
          const nowT = this.time.now;
          // On grenade mode unless charging; throw 3-grenade burst every 2s
          if (!e._charging) {
            if (!e._castingGrenades && nowT >= (e._grenadeNextAt || 0)) {
              e._castingGrenades = true;
              for (let i = 0; i < 3; i += 1) {
                this.time.delayedCall(i * 300, () => {
                  if (!e.active) return;
                  const tx = targetX; const ty = targetY;
                  this.throwEnemyGrenade(e, tx, ty);
                  if (i === 2) { e._castingGrenades = false; }
                });
              }
              e._grenadeNextAt = nowT + (e.burstCooldownMs || 2000);
            }
          }
        } else if (e.isMachineGunner) {
          const nowT = this.time.now;
          // Start a new burst if cooled down and not currently bursting
          if ((!e._burstLeft || e._burstLeft <= 0) && (nowT - e.lastShotAt > (e.fireRateMs || 1100))) {
            e._burstLeft = e.burstCount || 15;
            e._nextBurstShotAt = nowT;
            e._sprayPhase = 0;
          }
          // Fire next bullet in the burst if it's time
          if (e._burstLeft && e._burstLeft > 0 && nowT >= (e._nextBurstShotAt || 0)) {
            const base = Math.atan2(dy, dx);
            const spreadRad = Phaser.Math.DegToRad(e.spreadDeg || 14);
            // Slight walk within spread over the burst
            const t = ((e.burstCount || 15) - e._burstLeft) / Math.max(1, (e.burstCount || 15) - 1);
            let ang = base + (t - 0.5) * spreadRad * 0.9;
            if (e._toxinedUntil && now < e._toxinedUntil) {
              const extra = Phaser.Math.DegToRad(50);
              ang += Phaser.Math.FloatBetween(-extra/2, extra/2);
            }
            ang += Phaser.Math.FloatBetween(-0.05, 0.05) * spreadRad;
            const speed = 250;
            const vx = Math.cos(ang) * speed;
            const vy = Math.sin(ang) * speed;
            const b = this.enemyBullets.get(e.x, e.y, 'bullet');
            if (b) {
              b.setActive(true).setVisible(true);
              b.setCircle(2).setOffset(-2, -2);
              b.setVelocity(vx, vy);
              b.setTint(0xffcc00);
              b.damage = e.damage;
              b.update = () => {
                const view = this.cameras?.main?.worldView;
                if (view && !view.contains(b.x, b.y)) { b.destroy(); }
              };
            }
            e._burstLeft -= 1;
            if (e._burstLeft <= 0) {
              e.lastShotAt = nowT; // end of burst
            } else {
              e._nextBurstShotAt = nowT + (e.burstGapMs || 70);
            }
          }
        } else if (e.isRocketeer) {
          const nowT = this.time.now;
          if (nowT - e.lastShotAt > (e.fireRateMs || 2000)) {
            e.lastShotAt = nowT;
            let ang = Math.atan2(dy, dx);
            if (e._toxinedUntil && nowT < e._toxinedUntil) {
              const extra = Phaser.Math.DegToRad(50);
              ang += Phaser.Math.FloatBetween(-extra / 2, extra / 2);
            }
            const speed = 300;
            const vx = Math.cos(ang) * speed;
            const vy = Math.sin(ang) * speed;
            const b = this.enemyGrenades?.get(e.x, e.y, 'bullet');
            if (b) {
              b.setActive(true).setVisible(true);
              // Use a slightly larger body like before
              b.setCircle(6).setOffset(-6, -6);
              try { b.setScale(1.4); } catch (_) {}
              b.setVelocity(vx, vy);
              b.setTint(0xff8844);
              // Treat Rocketeer rockets as long-range grenades
              b.damage = e.damage;
              b._grenade = true;
              b._grenadeRadius = 70; // keep previous rocket blast radius
              b._spawnAt = nowT;
              // Much longer lifetime than regular grenades so they effectively have map-wide range
              b._lifeMs = 6000;
              b.update = () => {
                if (!b.active) return;
                const now = this.time.now;
                if (this._directionalShieldBlocksProjectile(b)) {
                  this._directionalShieldAbsorb(b.damage || 12);
                  try { impactBurst(this, b.x, b.y, { color: 0xffee66, size: 'small' }); } catch (_) {}
                  try { b.destroy(); } catch (_) {}
                  return;
                }
                const ex = b.x; const ey = b.y;
                const radius = b._grenadeRadius || 70;
                const r2 = radius * radius;
                // Check proximity to player
                let explode = false;
                try {
                  const pdx = this.player.x - ex; const pdy = this.player.y - ey;
                  if ((pdx * pdx + pdy * pdy) <= r2) explode = true;
                } catch (_) {}
                // Expire off-screen or after long lifetime
                const view = this.cameras?.main?.worldView;
                const off = view && !view.contains(ex, ey);
                if (!explode) {
                  const expired = (now - (b._spawnAt || 0)) >= (b._lifeMs || 6000);
                  if (off || expired) explode = true;
                }
                if (!explode) return;
                try { impactBurst(this, ex, ey, { color: 0xff3333, size: 'large', radius }); } catch (_) {}
                // Apply player damage in radius
                try {
                  const pdx = this.player.x - ex; const pdy = this.player.y - ey;
                  if ((pdx * pdx + pdy * pdy) <= r2) {
                    const inIframes = now < (this.player.iframesUntil || 0);
                    if (!inIframes) {
                      let dmg = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 12;
                      try {
                        const eff = getPlayerEffects(this.gs) || {};
                        const mul = eff.enemyExplosionDmgMul || 1;
                        dmg = Math.ceil(dmg * mul);
                      } catch (_) {}
                      this.applyPlayerDamage(dmg);
                      // Short i-frames vs Rocketeer rockets (now grenades)
                      this.player.iframesUntil = now + 50;
                      if (this.gs.hp <= 0) {
                        const eff = getPlayerEffects(this.gs);
                        this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
                        this.gs.nextScene = SceneKeys.Hub;
                        SaveManager.saveToLocal(this.gs);
                        this.scene.start(SceneKeys.Hub);
                      }
                    }
                  }
                } catch (_) {}
                // Also chip destructible barricades
                try { this.damageSoftBarricadesInRadius(ex, ey, radius, (b.damage || 12)); } catch (_) {}
                try { b.destroy(); } catch (_) {}
              };
            }
          }
        } else {
          const nowT = this.time.now;
          // Shooter: 2-round burst (one at a time)
          if ((!e._burstLeft || e._burstLeft <= 0) && (nowT - e.lastShotAt > (e.fireRateMs || 900))) {
            e._burstLeft = 2;
            e._nextBurstShotAt = nowT;
            e._burstGapMsS = e._burstGapMsS || 110; // per-shot gap within burst
          }
          if (e._burstLeft && e._burstLeft > 0 && nowT >= (e._nextBurstShotAt || 0)) {
            let ang = Math.atan2(dy, dx);
            if (e._toxinedUntil && nowT < e._toxinedUntil) {
              const extra = Phaser.Math.DegToRad(50);
              ang += Phaser.Math.FloatBetween(-extra/2, extra/2);
            }
            const vx = Math.cos(ang) * 240;
            const vy = Math.sin(ang) * 240;
            const b = this.enemyBullets.get(e.x, e.y, 'bullet');
            if (b) {
              b.setActive(true).setVisible(true);
              b.setCircle(2).setOffset(-2, -2);
              b.setVelocity(vx, vy);
              b.setTint(0xffff00); // enemy bullets are yellow
              b.damage = e.damage;
              b.update = () => {
                const view = this.cameras?.main?.worldView;
                if (view && !view.contains(b.x, b.y)) { b.destroy(); }
              };
            }
            e._burstLeft -= 1;
            if (e._burstLeft <= 0) {
              e.lastShotAt = nowT; // burst complete
            } else {
              e._nextBurstShotAt = nowT + (e._burstGapMsS || 110);
            }
          }
        }
      }

      // Sniper behavior
      if (e.isSniper) {
        const now = this.time.now;
        // If aiming, freeze movement and draw/update red aim line
        if (e.aiming) {
          e.body.setVelocity(0, 0);
          if (!e._aimG) e._aimG = this.add.graphics();
          try {
            e._aimG.clear();
            e._aimG.lineStyle(1, 0xff2222, 1); // thinner sniper aim line
            e._aimG.beginPath();
            e._aimG.moveTo(e.x, e.y);
            e._aimG.lineTo(targetX, targetY);
            e._aimG.strokePath();
          } catch (_) {}
          if (now - (e.aimStartedAt || 0) >= (e.aimDurationMs || 1000)) {
            // Fire a slower, high-damage shot
            let angle = Math.atan2(dy, dx);
            if (e._toxinedUntil && now < e._toxinedUntil) {
              const extra = Phaser.Math.DegToRad(50);
              angle += Phaser.Math.FloatBetween(-extra/2, extra/2);
            }
              const snipeSpeed = 1350;
            const vx = Math.cos(angle) * snipeSpeed;
            const vy = Math.sin(angle) * snipeSpeed;
            const b = this.enemyBullets.get(e.x, e.y, 'bullet');
            if (b) {
              b.setActive(true).setVisible(true);
              // Slightly larger hitbox to avoid tunneling at extreme speed
              b.setCircle(3).setOffset(-3, -3);
              b.setVelocity(vx, vy);
              b.damage = Math.max(35, Math.floor((e.damage || 20) * 2.0)); // higher sniper damage
              b.setTint(0xff3333);
              b._sniper = true;
              b._px = b.x; b._py = b.y;
              b.update = () => {
                // Manual ray-style collision to prevent tunneling at extreme speed
                try {
                  const line = new Phaser.Geom.Line(b._px || b.x, b._py || b.y, b.x, b.y);
                  const playerRect = this.player.getBounds();
                  if (Phaser.Geom.Intersects.LineToRectangle(line, playerRect)) {
                    const inIframes = this.time.now < this.player.iframesUntil;
                    if (!inIframes) {
                      const dmg = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 8;
                      this.applyPlayerDamage(dmg);
                      // Short i-frames vs high-speed enemy bullets
                      this.player.iframesUntil = this.time.now + 50;
                      if (this.gs.hp <= 0) {
                        const eff = getPlayerEffects(this.gs);
                        this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
                        this.gs.nextScene = SceneKeys.Hub;
                        SaveManager.saveToLocal(this.gs);
                        this.scene.start(SceneKeys.Hub);
                      }
                    }
                    try { b.destroy(); } catch (_) {}
                    return;
                  }
                } catch (_) {}
                // Lifetime via camera view when walls are disabled
                const view = this.cameras?.main?.worldView;
                if (view && !view.contains(b.x, b.y)) { b.destroy(); return; }
                // Update previous position for next frame
                b._px = b.x; b._py = b.y;
              };
            }
            // End aiming and start cooldown; remove laser
            e.aiming = false;
            e.lastShotAt = now;
            try { e._aimG?.clear(); e._aimG?.destroy(); e._aimG = null; } catch (_) {}
          }
        } else {
          // Not aiming: use normal movement like other shooters; only manage aim trigger
          // Start aiming if cooldown passed
          if (!e.lastShotAt) e.lastShotAt = 0;
          if (now - e.lastShotAt >= (e.cooldownMs || 2000)) {
            e.aiming = true;
            e.aimStartedAt = now;
          }
        }
      }
    });

    // Check clear (count only enemies that are active AND have HP left)
    const alive = this.enemies.getChildren().filter((e) => e.active && (typeof e.hp === 'number' ? e.hp > 0 : true)).length;
    const swarmPending = !!(this.gs?.gameMode === 'Swarm' && this._swarmState && (this._swarmState.wavesSpawned || 0) < (this._swarmState.totalWaves || 0));
    if (alive === 0 && !this.exitActive && !swarmPending) {
      this.exitActive = true;
      this.prompt.setText('Room clear! E to exit');
      this.exitRect = new Phaser.Geom.Rectangle(this.scale.width - 50, this.scale.height / 2 - 30, 40, 60);
      try {
        const cx = this.exitRect.x + this.exitRect.width / 2;
        const cy = this.exitRect.y + this.exitRect.height / 2;
        if (!this.exitSprite) {
          this.exitSprite = this.add.image(cx, cy, 'hub_drill');
          this.exitSprite.setOrigin(0.5);
          this.exitSprite.setFlipX(true);
          fitImageHeight(this, this.exitSprite, 64);
        } else {
          this.exitSprite.setPosition(cx, cy);
          this.exitSprite.setVisible(true);
        }
        this.exitSprite.setDepth(9000);
      } catch (_) {}

      this.exitG.clear();
    }

    if (this.exitActive) {
      const playerRect = this.player.getBounds();
      if (Phaser.Geom.Intersects.RectangleToRectangle(playerRect, this.exitRect)) {
        if (this.inputMgr.pressedInteract) {
          if (this._isBossRoom) this.gs.progressAfterBoss(); else this.gs.progressAfterCombat();
          SaveManager.saveToLocal(this.gs);
          if (this.gs.nextScene === 'Boss') {
            let bossId = 'Dandelion';
            try { if (typeof this.gs.chooseBossType === 'function') bossId = this.gs.chooseBossType(); } catch (_) {}
            this.scene.start(SceneKeys.Combat, { bossRoom: true, bossId });
          } else if (this.gs.nextScene === 'Hub') {
            this.scene.start(SceneKeys.Hub);
          } else {
            this.scene.start(SceneKeys.Combat);
          }
      }
    }
  }
  }

  createArenaWalls(room) {
    const { width, height } = this.scale;
    const tile = 16;
    const w = Math.min(room.width * tile, width - 80);
    const h = Math.min(room.height * tile, height - 80);
    const x = (width - w) / 2;
    const y = (height - h) / 2;
    this.arenaRect = new Phaser.Geom.Rectangle(x, y, w, h);

    // Visual wall tiles and physics
    this.walls = this.physics.add.staticGroup();
    const tilesX = Math.ceil(w / tile);
    const tilesY = Math.ceil(h / tile);
    // Top & Bottom rows
    for (let i = 0; i < tilesX; i += 1) {
      const wx = x + i * tile + tile / 2;
      const top = this.physics.add.staticImage(wx, y + tile / 2, 'wall_tile');
      const bot = this.physics.add.staticImage(wx, y + h - tile / 2, 'wall_tile');
      this.walls.add(top); this.walls.add(bot);
    }
    // Left & Right cols
    for (let j = 1; j < tilesY - 1; j += 1) {
      const wy = y + j * tile + tile / 2;
      const left = this.physics.add.staticImage(x + tile / 2, wy, 'wall_tile');
      const right = this.physics.add.staticImage(x + w - tile / 2, wy, 'wall_tile');
      this.walls.add(left); this.walls.add(right);
    }
  }

  // Returns the effective magazine capacity for the currently active weapon
  getActiveMagCapacity() {
    try {
      const w = getEffectiveWeapon(this.gs, this.gs.activeWeapon);
      const useCeil = !!w._magRoundUp;
      const raw = (w.magSize || 1);
      const cap = Math.max(1, useCeil ? Math.ceil(raw) : Math.floor(raw));
      return cap;
    } catch (_) {
      return 1;
    }
  }

  // Enemy grenade helper (Grenadier)
  throwEnemyGrenade(e, targetX, targetY) {
    const b = this.enemyGrenades.get(e.x, e.y, 'bullet');
    if (!b) return;
    b.setActive(true).setVisible(true);
    // Visual: slightly larger red projectile
    b.setCircle(3).setOffset(-3, -3);
    try { b.setScale(1.2); } catch (_) {}
    b.setTint(0xff4444);
    const angle = Math.atan2(targetY - e.y, targetX - e.x);
    const speed = 280; // increased range and speed
    const vx = Math.cos(angle) * speed; const vy = Math.sin(angle) * speed;
    b.setVelocity(vx, vy);
    b._spawnAt = this.time.now;
    b._lifeMs = 1200; // longer flight lifetime for greater range
    b._targetX = targetX; b._targetY = targetY;
    b._grenade = true; b._grenadeRadius = 60; b.damage = (e?.damage || 10);
    b.update = () => {
      if (this._directionalShieldBlocksProjectile(b)) {
        this._directionalShieldAbsorb(b.damage || 10);
        try { impactBurst(this, b.x, b.y, { color: 0xffee66, size: 'small' }); } catch (_) {}
        try { b.destroy(); } catch (_) {}
        return;
      }
      const now = this.time.now;
      const dx = b.x - b._targetX; const dy = b.y - b._targetY;
      const near = (dx * dx + dy * dy) <= 18 * 18;
      const expired = (now - (b._spawnAt || 0)) >= (b._lifeMs || 800);
      const view = this.cameras?.main?.worldView; const off = view && !view.contains(b.x, b.y);
      if (near || expired || off) {
        const ex = b.x; const ey = b.y; const radius = 60; // smaller radius vs boss
        try { impactBurst(this, ex, ey, { color: 0xff3333, size: 'large', radius }); } catch (_) {}
        // Player damage if within radius
        const r2 = radius * radius; const pdx = this.player.x - ex; const pdy = this.player.y - ey;
          if ((pdx * pdx + pdy * pdy) <= r2) {
        if (now >= (this.player.iframesUntil || 0)) {
            { let dmg=(e?.damage||10); try{ const eff=getPlayerEffects(this.gs)||{}; const mul=eff.enemyExplosionDmgMul||1; dmg=Math.ceil(dmg*mul);}catch(_){} this.applyPlayerDamage(dmg); }
            // Short i-frames vs enemy grenades (Grenadier/Bigwig special)
            this.player.iframesUntil = now + 50;
            if (this.gs.hp <= 0) {
              const eff = getPlayerEffects(this.gs);
              this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
              this.gs.nextScene = SceneKeys.Hub;
              SaveManager.saveToLocal(this.gs);
              this.scene.start(SceneKeys.Hub);
            }
          }
        }
        // Also damage destructible barricades
        this.damageSoftBarricadesInRadius(ex, ey, radius, (e.damage || 10));
        try { b.destroy(); } catch (_) {}
      }
    };
  }

  // Bigwig bombardment bomb: spawned off-screen and driven toward an impact point, ignoring barricades.
  _spawnBigwigBomb(e, targetX, targetY, opts = {}) {
    if (!this.bossBombs) return;
    const bomb = this.bossBombs.get(targetX, targetY, 'bullet');
    if (!bomb) return;
    bomb.setActive(true).setVisible(true);
    bomb.setCircle(4).setOffset(-4, -4);
    try { bomb.setScale(1.3); } catch (_) {}
    bomb.setTint(0xff8844);
    // Start from off-screen top-left along a 45-degree style path toward target
    const pad = Math.max(this.scale.width, this.scale.height) + 40;
    const sx = targetX - pad;
    const sy = targetY - pad;
    bomb.setPosition(sx, sy);
    const dx = targetX - sx;
    const dy = targetY - sy;
    const len = Math.max(1, Math.hypot(dx, dy));
    const speed = opts.speed || 420;
    const vx = (dx / len) * speed;
    const vy = (dy / len) * speed;
    bomb.setVelocity(vx, vy);
    // Simple red tracer line to show incoming path
    try {
      const tracer = this.add.graphics();
      try { tracer.setDepth?.(9550); tracer.setBlendMode?.(Phaser.BlendModes.ADD); } catch (_) {}
      bomb._tracerG = tracer;
    } catch (_) { bomb._tracerG = null; }
    bomb._bwBomb = true;
    bomb._bwTargetX = targetX;
    bomb._bwTargetY = targetY;
    bomb._spawnAt = this.time.now;
    bomb._lifeMs = opts.lifeMs || 6000;
    // Bombardment explosion base damage: 40 on Normal, scaled by difficulty
    let bombDmg = 40;
    try {
      const mods = this.gs?.getDifficultyMods?.() || {};
      const mul = (typeof mods.enemyDamage === 'number') ? mods.enemyDamage : 1;
      bombDmg = Math.max(1, Math.round(40 * mul));
    } catch (_) {}
    bomb.damage = (typeof opts.damage === 'number') ? opts.damage : bombDmg;
    bomb._blastRadius = opts.radius || 80; // match Bigwig's enhanced grenades
    bomb.update = () => {
      const now = this.time.now;
      if (!bomb.active) return;
      const dx2 = bomb.x - bomb._bwTargetX;
      const dy2 = bomb.y - bomb._bwTargetY;
      const near = (dx2 * dx2 + dy2 * dy2) <= 18 * 18;
      const expired = (now - (bomb._spawnAt || 0)) >= (bomb._lifeMs || 6000);
      // Update tracer visual
      if (bomb._tracerG) {
        try {
          const g = bomb._tracerG;
          g.clear();
          const lenSeg = 26;
          const vxN = vx / Math.max(1, Math.hypot(vx, vy));
          const vyN = vy / Math.max(1, Math.hypot(vx, vy));
          g.lineStyle(2, 0xff3333, 0.9);
          g.beginPath();
          g.moveTo(bomb.x, bomb.y);
          g.lineTo(bomb.x - vxN * lenSeg, bomb.y - vyN * lenSeg);
          g.strokePath();
        } catch (_) {}
      }
      if (near || expired) {
        const ex = bomb.x; const ey = bomb.y;
        const radius = bomb._blastRadius || 70;
        try { impactBurst(this, ex, ey, { color: 0xff3333, size: 'large', radius }); } catch (_) {}
        // Player damage in radius
        try {
          const r2 = radius * radius;
          const pdx = this.player.x - ex; const pdy = this.player.y - ey;
          if ((pdx * pdx + pdy * pdy) <= r2) {
            if (now >= (this.player.iframesUntil || 0)) {
              let dmg = (typeof bomb.damage === 'number' && bomb.damage > 0) ? bomb.damage : 14;
              try {
                const eff = getPlayerEffects(this.gs) || {};
                const mul = eff.enemyExplosionDmgMul || 1;
                dmg = Math.ceil(dmg * mul);
              } catch (_) {}
              this.applyPlayerDamage(dmg);
              // Short i-frames vs Bigwig bombardment explosions
              this.player.iframesUntil = now + 50;
              if (this.gs.hp <= 0) {
                const eff = getPlayerEffects(this.gs);
                this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
                this.gs.nextScene = SceneKeys.Hub;
                SaveManager.saveToLocal(this.gs);
                this.scene.start(SceneKeys.Hub);
              }
            }
          }
        } catch (_) {}
        // Also damage destructible barricades
        try { this.damageSoftBarricadesInRadius(ex, ey, radius, (bomb.damage || 40)); } catch (_) {}
        if (bomb._tracerG) { try { bomb._tracerG.destroy(); } catch (_) {} bomb._tracerG = null; }
        try { bomb.destroy(); } catch (_) {}
      }
    };
  }

  // Prism beam renderer: draws thick laser and applies damage to player
  renderPrismBeam(e, angle, dt, opts = {}) {
    const applyDamage = opts.applyDamage !== undefined ? opts.applyDamage : true;
    const damagePlayer = opts.damagePlayer !== undefined ? opts.damagePlayer : true;
    const dps = (typeof opts.dps === 'number') ? opts.dps : 34;
    const tick = (typeof opts.tick === 'number' && opts.tick > 0) ? opts.tick : dt; // default to per-frame
    const target = opts.target || this.player;
    try { if (!e._laserG) { e._laserG = this.add.graphics(); e._laserG.setDepth(8000); e._laserG.setBlendMode(Phaser.BlendModes.ADD); } } catch (_) {}
    const g = e._laserG;
    try { g.clear(); } catch (_) {}
    // Compute end vs barricades, then render thicker dual-color beam
    const hit = this.computeEnemyLaserEnd(e.x, e.y, angle);
    let ex = hit.ex, ey = hit.ey;
    const shieldHit = this._directionalShieldLineHit(e.x, e.y, ex, ey);
    const shieldBlocked = !!shieldHit;
    if (shieldHit) { ex = shieldHit.x; ey = shieldHit.y; }
    // Clip beam visually to player if it hits them, so the beam doesn't draw past the hit point
    try {
      const lineFull = new Phaser.Geom.Line(e.x, e.y, ex, ey);
      const rectTFull = target?.getBounds?.() || new Phaser.Geom.Rectangle((target?.x || 0) - 6, (target?.y || 0) - 6, 12, 12);
      const pts = Phaser.Geom.Intersects.GetLineToRectangle(lineFull, rectTFull);
      if (pts && pts.length) {
        ex = pts[0].x;
        ey = pts[0].y;
      }
    } catch (_) {}
    // Choose beam colors: default red/blue for Prism, Hazel-style purple for LaserDrones
    let outerColor = 0xff3333;
    let innerColor = 0x66aaff;
    let impactColor = 0xff4455;
    try {
      if (e && (e.isLaserDrone || e.isSwarmLaserDrone)) {
        outerColor = 0xaa66ff;
        innerColor = 0xaa66ff;
        impactColor = 0xaa66ff;
      }
    } catch (_) {}
    try {
      g.lineStyle(5, outerColor, 0.95).beginPath(); g.moveTo(e.x, e.y); g.lineTo(ex, ey); g.strokePath();
      g.lineStyle(2, innerColor, 1).beginPath(); g.moveTo(e.x, e.y - 1); g.lineTo(ex, ey); g.strokePath();
    } catch (_) {}
    // Particles at endpoint
    try { impactBurst(this, ex, ey, { color: impactColor, size: 'small' }); } catch (_) {}
    // Damage ticking to player if intersecting beam
    if (applyDamage) {
      e._beamTickAccum = (e._beamTickAccum || 0) + dt;
      while (e._beamTickAccum >= tick) {
        e._beamTickAccum -= tick;
        // Check if beam line (clipped) hits player's bounds
        const line = new Phaser.Geom.Line(e.x, e.y, ex, ey);
        const rect = this.player.getBounds?.() || new Phaser.Geom.Rectangle(this.player.x - 6, this.player.y - 6, 12, 12);
        if (!shieldBlocked && damagePlayer && Phaser.Geom.Intersects.LineToRectangle(line, rect)) {
            if (this.time.now >= (this.player.iframesUntil || 0)) {
            const dmg = Math.max(1, Math.round(dps * tick));
            this.applyPlayerDamage(dmg);
            this.player.iframesUntil = this.time.now; // no extra i-frames vs continuous laser
            if (this.gs.hp <= 0) {
              const eff = getPlayerEffects(this.gs);
              this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
              this.gs.nextScene = SceneKeys.Hub;
              SaveManager.saveToLocal(this.gs);
              this.scene.start(SceneKeys.Hub);
            }
          }
        }
        if (shieldBlocked) {
          this._directionalShieldAbsorb(Math.max(1, Math.round(dps * tick)));
        }
        // Damage soft barricades intersecting the (clipped) beam
        try {
          const arr = this.barricadesSoft?.getChildren?.() || [];
          for (let i = 0; i < arr.length; i += 1) {
            const s = arr[i]; if (!s?.active) continue;
            if (!s.getData('destructible')) continue;
            const sRect = s.getBounds?.() || new Phaser.Geom.Rectangle(s.x - 8, s.y - 8, 16, 16);
            if (Phaser.Geom.Intersects.LineToRectangle(line, sRect)) {
              const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 20;
              // Dandelion lasers do reduced damage to barricades (50% of player DPS);
              // all other beams using this helper (including Prism) keep full DPS.
              const isDandelion = !!(e && e.bossType === 'Dandelion');
              const barricadeMul = isDandelion ? 0.5 : 1;
              const dmg = Math.max(1, Math.round(dps * tick * barricadeMul));
              const hp1 = hp0 - dmg;
              if (hp1 <= 0) { try { s.destroy(); } catch (_) {} }
              else s.setData('hp', hp1);
            }
          }
        } catch (_) {}
      }
    }
  }

  // Compute enemy laser line clipped to barricades
  computeEnemyLaserEnd(sx, sy, angle) {
    const maxLen = 1000;
    const ex0 = sx + Math.cos(angle) * maxLen;
    const ey0 = sy + Math.sin(angle) * maxLen;
    const ray = new Phaser.Geom.Line(sx, sy, ex0, ey0);
    let ex = ex0; let ey = ey0; let bestD2 = Infinity;
    const testGroups = [this.barricadesHard, this.barricadesSoft];
    for (let gi = 0; gi < testGroups.length; gi += 1) {
      const g = testGroups[gi]; if (!g) continue;
      const arr = g.getChildren?.() || [];
      for (let i = 0; i < arr.length; i += 1) {
        const s = arr[i]; if (!s?.active) continue;
        const rect = s.getBounds?.() || new Phaser.Geom.Rectangle(s.x - 8, s.y - 8, 16, 16);
        const pts = Phaser.Geom.Intersects.GetLineToRectangle(ray, rect);
        if (pts && pts.length) {
          const p = pts[0]; const dx = p.x - sx; const dy = p.y - sy; const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) { bestD2 = d2; ex = p.x; ey = p.y; }
        }
      }
    }
    // Also clip enemy lasers against active Repulsion Pulse rings so pulses block beams
    try {
      const reps = this._repulses || [];
      if (reps.length) {
        const dxL = ex0 - sx; const dyL = ey0 - sy;
        const a = dxL * dxL + dyL * dyL || 1;
        for (let i = 0; i < reps.length; i += 1) {
          const rp = reps[i]; if (!rp) continue;
          const cx = rp.x; const cy = rp.y;
          const r = rp.r || 0; if (r <= 0) continue;
          const fx = sx - cx; const fy = sy - cy;
          const b = 2 * (fx * dxL + fy * dyL);
          const c = fx * fx + fy * fy - r * r;
          const disc = b * b - 4 * a * c;
          if (disc < 0) continue;
          const sqrtD = Math.sqrt(disc);
          const t1 = (-b - sqrtD) / (2 * a);
          const t2 = (-b + sqrtD) / (2 * a);
          let tHit = null;
          if (t1 >= 0 && t1 <= 1) tHit = t1;
          else if (t2 >= 0 && t2 <= 1) tHit = t2;
          if (tHit === null) continue;
          const px = sx + dxL * tHit; const py = sy + dyL * tHit;
          const dxp = px - sx; const dyp = py - sy; const d2p = dxp * dxp + dyp * dyp;
          if (d2p < bestD2) { bestD2 = d2p; ex = px; ey = py; }
        }
      }
    } catch (_) {}
    return { ex, ey };
  }

  // Check if a line is blocked by hard barricades only
  isLineBlockedByHard(x0, y0, x1, y1) {
    try {
      const arr = this.barricadesHard?.getChildren?.() || [];
      if (!arr.length) return false;
      const line = new Phaser.Geom.Line(x0, y0, x1, y1);
      for (let i = 0; i < arr.length; i += 1) {
        const s = arr[i];
        if (!s?.active) continue;
        const rect = s.getBounds?.() || new Phaser.Geom.Rectangle(s.x - 8, s.y - 8, 16, 16);
        if (Phaser.Geom.Intersects.LineToRectangle(line, rect)) return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  updateBossAI() {
    const e = this.boss; if (!e || !e.active) return;
    const now = this.time.now;
    const target = this.getEnemyTarget();
    const targetX = (target && typeof target.x === 'number') ? target.x : this.player.x;
    const targetY = (target && typeof target.y === 'number') ? target.y : this.player.y;
    const dx = targetX - e.x; const dy = targetY - e.y;
    const angToPlayer = Math.atan2(dy, dx);
    const fireBullet = (angle, speed = 260, damage = e.damage, tint = 0xffaa00, size = 2) => {
      const b = this.enemyBullets.get(e.x, e.y, 'bullet');
      if (!b) return null;
      b.setActive(true).setVisible(true);
      if (size >= 6) b.setCircle(6).setOffset(-6, -6); else b.setCircle(2).setOffset(-2, -2);
      b.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
      b.setTint(tint);
      b.damage = damage;
      // Ensure any Hazel-style tracer graphics are cleaned up whenever this bullet is destroyed
      try {
        b.on('destroy', () => {
          try { b._hzTrailG?.destroy(); } catch (_) {}
        });
      } catch (_) {}
      b.update = () => {
        // Destroy when leaving camera view
        try {
          const view = this.cameras?.main?.worldView;
          if (view && !view.contains(b.x, b.y)) {
            try { b._hzTrailG?.destroy(); } catch (_) {}
            try { b.destroy(); } catch (_) {}
          }
        } catch (_) {}
      };
      return b;
    };
    const fireRocket = (angle, speed = 300, damage = e.damage + 4, radius = 70) => {
      const b = this.enemyBullets.get(e.x, e.y, 'bullet'); if (!b) return;
      b.setActive(true).setVisible(true);
      b.setCircle(6).setOffset(-6, -6);
      try { b.setScale(1.4); } catch (_) {}
      b.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
      b.setTint(0xff8844);
      b.damage = damage; b._rocket = true; b._blastRadius = radius;
      b.update = () => { const view = this.cameras?.main?.worldView; if (view && !view.contains(b.x, b.y)) { try { b.destroy(); } catch (_) {} } };
    };

      if (e.bossType === 'Dandelion') {
        // Initialize Dandelion-specific sweep/cooldown state once
        if (!e._dnInit) {
          e._dnInit = true;
        e._dnMode = 'idle'; // 'idle' | 'sweep' | 'cooldown'
        e._dnSweepDurationMs = 3000;
        e._dnCooldownMs = 1500;
        e._dnSweepStartAt = 0;
        e._dnCooldownUntil = 0;
        e._dnVfxUntil = 0;
        e._dnSweepT = 0;
        e._dnCycles = 0;
        e._dnSpecialState = 'idle'; // 'idle' | 'aim' | 'burst'
        e._dnSpecialAimUntil = 0;
        e._dnSpecialBurstUntil = 0;
        e._dnNextShotAt = 0;
        e._dnAfterSpecialUntil = 0;
        e._dnAfterVfxUntil = 0;
        e._dnTargetLagMs = 100; // ms; used with player position history
        // Dash state: sideways bursts with cooldown
        e._dnDashState = 'idle'; // 'idle' | 'dashing'
        e._dnDashUntil = 0;
        e._dnDashNextAt = now + 3000; // first dash no sooner than 3s in
        e._dnDashTrailLast = null;
        // Assault (dash-melee-mine) state
        e._dnAssaultState = 'idle'; // 'idle' | 'windup' | 'dashIn' | 'melee' | 'dashOut' | 'recover'
        e._dnAssaultNextAt = now + 10000; // first assault no sooner than 10s in
        e._dnAssaultWindupUntil = 0;
        e._dnAssaultRecoverUntil = 0;
        e._dnAssaultDirInX = 0;
        e._dnAssaultDirInY = 0;
        e._dnAssaultDirOutX = 0;
        e._dnAssaultDirOutY = 0;
        e._dnAssaultDashSpeed = 800;
        e._dnAssaultDashOutStartAt = 0;
        e._dnAssaultDashOutDurMs = 500; // 2x normal 250ms dash duration
        e._dnAssaultMeleeDone = false;
        // Mine timing: all mines every 100ms during dash-out
        e._dnAssaultMineInterval = 100;
        e._dnAssaultNextMineAt = 0;
        e._dnAssaultLineG = null;
          e._dnAssaultTrailLast = null;
          e._dnAssaultDashInStartedAt = 0;
          e._dnAssaultWindupStartAt = 0;
          e._dnAssaultWindupLen = 200;
          // Cache base speed for slow/restore
          e._dnBaseSpeed = e.speed || 120;
          // Heal thresholds (60%, 40%, 25%, 10%) – each triggers at most once
          e._dnHealUsed60 = false;
          e._dnHealUsed40 = false;
          e._dnHealUsed25 = false;
          e._dnHealUsed10 = false;
        }

        const dtMsDn = (this.game?.loop?.delta || 16.7);

        // Heal drone ability: trigger once when HP crosses specific ratios
        try {
          const hp = Math.max(0, e.hp || 0);
          const maxHp = Math.max(1, e.maxHp || 1);
          const ratio = hp / maxHp;
          const thresholds = [
            { r: 0.50, flag: '_dnHealUsed50' },
            { r: 0.25, flag: '_dnHealUsed25' },
          ];
          for (let i = 0; i < thresholds.length; i += 1) {
            const t = thresholds[i];
            if (ratio <= t.r && !e[t.flag]) {
              e[t.flag] = true;
              // Visual-only boss channel effect (same style as other bosses)
              try { bossSignalBeam(this, e.x, e.y, { color: 0xaa66ff, duration: 2000 }); } catch (_) {}
              // Queue a delayed HealDrone summon 2s after channel starts
              if (!e._dnHealSummons) e._dnHealSummons = [];
              e._dnHealSummons.push({ spawnAt: now + 2000 });
            }
          }
          // Process any queued HealDrone summons once their delay has elapsed
          if (e._dnHealSummons && e._dnHealSummons.length) {
            const summons = e._dnHealSummons;
            let idx = 0;
            while (idx < summons.length) {
              const s = summons[idx];
              if (!s || now < (s.spawnAt || 0)) { idx += 1; continue; }
              // Time to spawn: cap total HealDrones for this boss at 3
              const enemiesArr2 = this.enemies?.getChildren?.() || [];
              let existing = 0;
              for (let i2 = 0; i2 < enemiesArr2.length; i2 += 1) {
                const d2 = enemiesArr2[i2];
                if (!d2?.active || !d2.isHealDrone) continue;
                if (d2._ownerBoss === e) existing += 1;
              }
              const toSpawn = Math.max(0, 3 - existing);
              if (toSpawn > 0) {
                const baseAngle = Phaser.Math.FloatBetween(0, Math.PI * 2);
                const radius = 60;
                for (let k = 0; k < toSpawn; k += 1) {
                  const ang = baseAngle + (k / Math.max(1, toSpawn)) * Math.PI * 2;
                  const sx = e.x + Math.cos(ang) * radius;
                  const sy = e.y + Math.sin(ang) * radius;
                  try {
                    teleportSpawnVfx(this, sx, sy, {
                      color: 0xaa66ff, // purple, matches other boss summons
                      ringOpts: { radius: 18, lineWidth: 3, duration: 420, scaleTarget: 2.0 },
                      onSpawn: () => {
                        const d = createHealDroneEnemy(this, sx, sy, 30, e);
                        // Initialize orbit angle based on spawn angle
                        d._hdAngle = ang;
                        try { this.enemies.add(d); } catch (_) {}
                      },
                    });
                  } catch (_) {}
                }
              }
              summons.splice(idx, 1);
            }
          }
        } catch (_) {}

      // Handle Dandelion assault ability (dash to player, melee, dash back laying mines)
      const nowDn = now;
      const stunnedDn = nowDn < (e._stunnedUntil || 0);
      const assaultActive = e._dnAssaultState && e._dnAssaultState !== 'idle';

      // Cancel assault if stunned or strongly repulsed; allow immediate recast later (no extra CD)
      if (assaultActive && stunnedDn) {
        try { e.body?.setVelocity?.(0, 0); } catch (_) {}
        e._dnAssaultState = 'idle';
        e._dnAssaultMeleeDone = false;
        try { e._dnAssaultLineG?.destroy(); } catch (_) {}
        e._dnAssaultLineG = null;
      }

      // Assault state machine: when active, skip all other Dandelion attacks
      const assaultState = e._dnAssaultState;
      if (e._dnAssaultState !== 'idle') {
        if (assaultState === 'windup') {
          // 1s windup: slow, no movement, animated red arrows indicating dash direction
          try { e.body?.setVelocity?.(0, 0); } catch (_) {}
          e.speed = e._dnBaseSpeed * 0.4;
          if (!e._dnAssaultLineG) {
            try {
              const g = this.add.graphics();
              g.setDepth(9600);
              g.setBlendMode(Phaser.BlendModes.ADD);
              e._dnAssaultLineG = g;
            } catch (_) {}
          }
          try {
            const g = e._dnAssaultLineG;
            if (g) {
              g.clear();
              const sx = e.x; const sy = e.y;
              // Recompute direction to player each frame so arrow line tracks player,
              // and extend arrows well past the player (visually \"infinite\" in-arena)
              let nx = 0; let ny = 0; let len = 0;
              try {
                const dxp = targetX - sx;
                const dyp = targetY - sy;
                const dist = Math.hypot(dxp, dyp) || 1;
                nx = dxp / dist;
                ny = dyp / dist;
                // Extend line well beyond player hit position
                len = dist + 600;
              } catch (_) {}
              const tWind = Math.max(0, (nowDn - (e._dnAssaultWindupStartAt || nowDn)) / 1000);
              const arrowSpeed = 320; // slower arrows along dash path
              const spacing = 24;     // spacing between arrows
              const headOffset = (tWind * arrowSpeed) % spacing;
              // Fill the whole line from near the boss out past the player
              for (let dist = 16 + headOffset; dist <= len; dist += spacing) {
                const ax = sx + nx * dist;
                const ay = sy + ny * dist;
                const size = 10;
                const ang = Math.atan2(ny, nx);
                const cos = Math.cos(ang); const sin = Math.sin(ang);
                // Triangle points for arrow head
                const tipX = ax + cos * size;
                const tipY = ay + sin * size;
                const leftX = ax + Math.cos(ang + Math.PI * 0.75) * size * 0.7;
                const leftY = ay + Math.sin(ang + Math.PI * 0.75) * size * 0.7;
                const rightX = ax + Math.cos(ang - Math.PI * 0.75) * size * 0.7;
                const rightY = ay + Math.sin(ang - Math.PI * 0.75) * size * 0.7;
                const alpha = 0.25 + 0.35 * Math.min(1, dist / len);
                g.fillStyle(0xff3333, alpha);
                g.beginPath();
                g.moveTo(tipX, tipY);
                g.lineTo(leftX, leftY);
                g.lineTo(rightX, rightY);
                g.closePath();
                g.fillPath();
              }
            }
          } catch (_) {}
          if (nowDn >= (e._dnAssaultWindupUntil || 0)) {
            try { e._dnAssaultLineG?.destroy(); } catch (_) {}
            e._dnAssaultLineG = null;
            e.speed = e._dnBaseSpeed;
            e._dnAssaultState = 'dashIn';
            e._dnAssaultDashInStartedAt = nowDn;
          }
          return;
        } else if (assaultState === 'dashIn') {
          // Dash toward player with constant speed, tracking player until in melee radius or 1s cap
          const dashSpeed = e._dnAssaultDashSpeed || 800;
          let nx = 0; let ny = 0;
          try {
            const dxp = targetX - e.x;
            const dyp = targetY - e.y;
            let len = Math.hypot(dxp, dyp) || 1;
            nx = dxp / len;
            ny = dyp / len;
          } catch (_) {}
          e._dnAssaultDirInX = nx;
          e._dnAssaultDirInY = ny;
          e._dnAssaultDirOutX = -nx;
          e._dnAssaultDirOutY = -ny;
          try {
            e.body?.setVelocity?.(nx * dashSpeed, ny * dashSpeed);
          } catch (_) {}
          // Break any soft barricades passed through while dashing
          try { this._dandelionBreakSoftBarricades(e); } catch (_) {}
          // Dash trail (red), similar to sideways dash
          try {
            if (!e._dnAssaultTrailLast) e._dnAssaultTrailLast = { x: e.x, y: e.y };
            const g = this.add.graphics();
            g.setDepth(9800);
            g.setBlendMode(Phaser.BlendModes.ADD);
            g.lineStyle(6, 0xff3333, 0.95);
            g.beginPath();
            g.moveTo(e._dnAssaultTrailLast.x, e._dnAssaultTrailLast.y);
            g.lineTo(e.x, e.y);
            g.strokePath();
            this.tweens.add({
              targets: g,
              alpha: 0,
              duration: 220,
              ease: 'Quad.easeOut',
              onComplete: () => { try { g.destroy(); } catch (_) {} },
            });
            e._dnAssaultTrailLast.x = e.x;
            e._dnAssaultTrailLast.y = e.y;
          } catch (_) {}
          // Check melee trigger or 1s cap
          let withinMelee = false;
          try {
            const dxp = targetX - e.x;
            const dyp = targetY - e.y;
            const d = Math.hypot(dxp, dyp) || 1;
            const meleeR = 48;
            if (d <= meleeR) withinMelee = true;
          } catch (_) {}
          const exceededCap = nowDn - (e._dnAssaultDashInStartedAt || nowDn) >= 1000;
          if (withinMelee || exceededCap) {
            try { e.body?.setVelocity?.(0, 0); } catch (_) {}
            e._dnAssaultState = 'melee';
          }
          return;
        } else if (assaultState === 'melee') {
          if (!e._dnAssaultMeleeDone) {
            try { this._performDandelionAssaultMelee?.(e); } catch (_) {}
            e._dnAssaultMeleeDone = true;
          }
          e._dnAssaultDashOutStartAt = nowDn;
          // Wait one interval (100ms) before dropping the first mine, so none spawn immediately
          e._dnAssaultNextMineAt = nowDn + (e._dnAssaultMineInterval || 100);
          e._dnAssaultState = 'dashOut';
          return;
        } else if (assaultState === 'dashOut') {
          const dashSpeed = e._dnAssaultDashSpeed || 800;
          const nx = e._dnAssaultDirOutX || 0;
          const ny = e._dnAssaultDirOutY || 0;
          try {
            e.body?.setVelocity?.(nx * dashSpeed, ny * dashSpeed);
          } catch (_) {}
          // Break any soft barricades passed through while dashing
          try { this._dandelionBreakSoftBarricades(e); } catch (_) {}
          // Dash trail
          try {
            if (!e._dnAssaultTrailLast) e._dnAssaultTrailLast = { x: e.x, y: e.y };
            const g = this.add.graphics();
            g.setDepth(9800);
            g.setBlendMode(Phaser.BlendModes.ADD);
            g.lineStyle(6, 0xff3333, 0.95);
            g.beginPath();
            g.moveTo(e._dnAssaultTrailLast.x, e._dnAssaultTrailLast.y);
            g.lineTo(e.x, e.y);
            g.strokePath();
            this.tweens.add({
              targets: g,
              alpha: 0,
              duration: 220,
              ease: 'Quad.easeOut',
              onComplete: () => { try { g.destroy(); } catch (_) {} },
            });
            e._dnAssaultTrailLast.x = e.x;
            e._dnAssaultTrailLast.y = e.y;
          } catch (_) {}
          // Lay mines in a 3-mine fan facing the player at fixed intervals
          if (nowDn >= (e._dnAssaultNextMineAt || 0)) {
            try {
              const px = targetX; const py = targetY;
              const dxp = px - e.x; const dyp = py - e.y;
              const baseAng = Math.atan2(dyp, dxp);
              const spread = Phaser.Math.DegToRad(35); // total 70 fan (35)
              const rFan = 70;

              // Compute fan points in front of Dandelion (toward the player)
              const midX = e.x + Math.cos(baseAng) * rFan;
              const midY = e.y + Math.sin(baseAng) * rFan;
              const angL = baseAng - spread;
              const angR = baseAng + spread;
              const leftX = e.x + Math.cos(angL) * rFan;
              const leftY = e.y + Math.sin(angL) * rFan;
              const rightX = e.x + Math.cos(angR) * rFan;
              const rightY = e.y + Math.sin(angR) * rFan;

              // Shift the entire fan 70px behind Dandelion (away from the player)
              const backOffset = 70;
              const offX = -Math.cos(baseAng) * backOffset;
              const offY = -Math.sin(baseAng) * backOffset;
              const cx = midX + offX;
              const cy = midY + offY;
              const lx = leftX + offX;
              const ly = leftY + offY;
              const rx = rightX + offX;
              const ry = rightY + offY;

              // Spawn mines at shifted fan positions with Hazel-style phase VFX
              this._spawnDandelionMineWithVfx?.(cx, cy);
              this._spawnDandelionMineWithVfx?.(lx, ly);
              this._spawnDandelionMineWithVfx?.(rx, ry);
            } catch (_) {}
            // After each fan, schedule next burst in 100ms
            e._dnAssaultNextMineAt = nowDn + (e._dnAssaultMineInterval || 100);
          }
          // End dash-out after configured duration
          if (nowDn >= (e._dnAssaultDashOutStartAt || nowDn) + (e._dnAssaultDashOutDurMs || 500)) {
            try { e.body?.setVelocity?.(0, 0); } catch (_) {}
            e._dnAssaultState = 'recover';
            e._dnAssaultRecoverUntil = nowDn + 2000; // 2s with no attacks
            e._dnAssaultTrailLast = null;
          }
          return;
        } else if (assaultState === 'recover') {
          // Movement allowed via generic shooter logic; just block attacks
          if (nowDn >= (e._dnAssaultRecoverUntil || 0)) {
            e._dnAssaultState = 'idle';
            e._dnAssaultMeleeDone = false;
          }
          // Fall through to allow generic movement; skip attacks below
        }
      }

      // Attempt to start assault between normal cycles: right after cooldown, before next aim
      if (e._dnAssaultState === 'idle') {
        const betweenCycles = e._dnMode === 'idle' && nowDn >= (e._dnCooldownUntil || 0);
        if (betweenCycles && nowDn >= (e._dnAssaultNextAt || 0) && e._dnSpecialState === 'idle' && e._dnDashState === 'idle') {
          e._dnAssaultState = 'windup';
          e._dnAssaultWindupUntil = nowDn + 2000; // 2s windup
          e._dnAssaultMeleeDone = false;
          e._dnAssaultDashInStartedAt = nowDn;
          e._dnAssaultWindupStartAt = nowDn;
          // Compute initial in/out directions from current player position (fixed for whole windup)
          try {
            const dxp = targetX - e.x;
            const dyp = targetY - e.y;
            let len = Math.hypot(dxp, dyp) || 1;
            const nx = dxp / len;
            const ny = dyp / len;
            e._dnAssaultDirInX = nx;
            e._dnAssaultDirInY = ny;
            e._dnAssaultDirOutX = -nx;
            e._dnAssaultDirOutY = -ny;
            e._dnAssaultWindupLen = Math.min(420, Math.max(120, len));
          } catch (_) {}
          // Set next assault CD (20s)
          e._dnAssaultNextAt = nowDn + 20000;
        }
      }

      // Handle Dandelion special attack (laser machine-gun) first, but skip if assault is active
      if (e._dnAssaultState !== 'idle') {
        // Assault ability blocks other Dandelion attacks
      } else if (e._dnSpecialState === 'aim') {
        // 1.5s aim line at player; Dandelion stays still
        try { e.body?.setVelocity?.(0, 0); } catch (_) {}
        if (!e._dnAimG) e._dnAimG = this.add.graphics();
        try {
          const g = e._dnAimG;
          g.clear();
          g.lineStyle(1, 0xff3333, 1);
          g.beginPath();
          g.moveTo(e.x, e.y);
          g.lineTo(targetX, targetY);
          g.strokePath();
        } catch (_) {}
        if (now >= (e._dnSpecialAimUntil || 0)) {
          e._dnSpecialState = 'burst';
          e._dnSpecialBurstUntil = now + 3000; // 3s burst
          e._dnNextShotAt = now;
          try { e._dnAimG?.clear(); } catch (_) {}
        }
        // Skip normal sweep logic while in special
        return;
      } else if (e._dnSpecialState === 'burst') {
        // 3s laser "machine gun": 4 shots/s toward player with small spread
        try { e.body?.setVelocity?.(0, 0); } catch (_) {}
        if (now >= (e._dnSpecialBurstUntil || 0)) {
          e._dnSpecialState = 'idle';
          e._dnAfterSpecialUntil = now + 3000; // 3s extended cooldown before sweeps resume
          e._dnAfterVfxUntil = now + 2000; // 2s strong exhaust VFX after special
        } else if (now >= (e._dnNextShotAt || 0)) {
          // Sample a true lagged target position from history (e.g., ~300ms ago)
          let txP = targetX;
          let tyP = targetY;
          try {
            if (target === this.player) {
              const hist = this._playerPosHistory || [];
              if (hist.length) {
                const targetMs = now - (e._dnTargetLagMs || 300);
                let best = hist[0];
                for (let i = 1; i < hist.length; i += 1) {
                  const h = hist[i];
                  if (Math.abs(h.t - targetMs) < Math.abs(best.t - targetMs)) best = h;
                }
                txP = best.x; tyP = best.y;
              }
            }
          } catch (_) {}
          // Fire one laser shot
          const base = Math.atan2(tyP - e.y, txP - e.x);
          const spreadRad = Phaser.Math.DegToRad(Phaser.Math.FloatBetween(-1, 1)); // 闂?闂?(~2闂?total)
          const shotAng = base + spreadRad;
          try {
            const hit = this.computeEnemyLaserEnd(e.x, e.y, shotAng);
            const ex = hit.ex, ey = hit.ey;
            let hitX = ex; let hitY = ey;
            const shieldHit = this._directionalShieldLineHit(e.x, e.y, ex, ey);
            if (shieldHit) {
              hitX = shieldHit.x; hitY = shieldHit.y;
            } else {
              // Clip beam visually to player if it hits them, so the beam doesn't draw past the hit point
              try {
                const lineFull = new Phaser.Geom.Line(e.x, e.y, ex, ey);
                const rectP = this.player.getBounds?.() || new Phaser.Geom.Rectangle(this.player.x - 6, this.player.y - 6, 12, 12);
                const pts = Phaser.Geom.Intersects.GetLineToRectangle(lineFull, rectP);
                if (pts && pts.length) {
                  hitX = pts[0].x;
                  hitY = pts[0].y;
                }
              } catch (_) {}
            }
            // Visual: intense red beam that fades quickly
            try {
              const g = this.add.graphics();
              try { g.setDepth(8050); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
              try {
                g.lineStyle(6, 0xff2222, 0.98).beginPath(); g.moveTo(e.x, e.y); g.lineTo(hitX, hitY); g.strokePath();
                g.lineStyle(3, 0xffaaaa, 1).beginPath(); g.moveTo(e.x, e.y - 1); g.lineTo(hitX, hitY); g.strokePath();
              } catch (_) {}
              try {
                this.tweens.add({
                  targets: g,
                  alpha: 0,
                  duration: 160,
                  ease: 'Quad.easeOut',
                  onComplete: () => { try { g.destroy(); } catch (_) {} },
                });
              } catch (_) { try { g.destroy(); } catch (__ ) {} }
            } catch (_) {}
            // Muzzle VFX at Dandelion's laser spawnpoint (railgun-style, tinted red)
            try {
              const mx = e.x + Math.cos(shotAng) * 10;
              const my = e.y + Math.sin(shotAng) * 10;
              muzzleFlashSplit(this, mx, my, { angle: shotAng, color: 0xff3333, count: 3, spreadDeg: 26, length: 20, thickness: 4 });
              const burst = { spreadDeg: 18, speedMin: 140, speedMax: 260, lifeMs: 220, color: 0xff5555, size: 2, alpha: 0.95 };
              pixelSparks(this, mx, my, { angleRad: shotAng - Math.PI / 2, count: 8, ...burst });
              pixelSparks(this, mx, my, { angleRad: shotAng + Math.PI / 2, count: 8, ...burst });
            } catch (_) {}
            // Muzzle VFX at Dandelion's laser spawnpoint (railgun-style, tinted red)
            try {
              const mx = e.x + Math.cos(shotAng) * 10;
              const my = e.y + Math.sin(shotAng) * 10;
              muzzleFlashSplit(this, mx, my, { angle: shotAng, color: 0xff3333, count: 3, spreadDeg: 26, length: 20, thickness: 4 });
              const burst = { spreadDeg: 18, speedMin: 140, speedMax: 260, lifeMs: 220, color: 0xff5555, size: 2, alpha: 0.95 };
              pixelSparks(this, mx, my, { angleRad: shotAng - Math.PI / 2, count: 8, ...burst });
              pixelSparks(this, mx, my, { angleRad: shotAng + Math.PI / 2, count: 8, ...burst });
            } catch (_) {}
            // Muzzle VFX at Dandelion's laser spawnpoint (railgun-style, tinted red)
            try {
              const mx = e.x + Math.cos(shotAng) * 10;
              const my = e.y + Math.sin(shotAng) * 10;
              muzzleFlashSplit(this, mx, my, { angle: shotAng, color: 0xff3333, count: 3, spreadDeg: 26, length: 20, thickness: 4 });
              const burst = { spreadDeg: 18, speedMin: 140, speedMax: 260, lifeMs: 220, color: 0xff5555, size: 2, alpha: 0.95 };
              pixelSparks(this, mx, my, { angleRad: shotAng - Math.PI / 2, count: 8, ...burst });
              pixelSparks(this, mx, my, { angleRad: shotAng + Math.PI / 2, count: 8, ...burst });
            } catch (_) {}
            // One-time hit check against player and soft barricades
            try {
              const line = new Phaser.Geom.Line(e.x, e.y, hitX, hitY);
              // Player hit
              try {
                const rectP = this.player.getBounds?.() || new Phaser.Geom.Rectangle(this.player.x - 6, this.player.y - 6, 12, 12);
                if (!shieldHit && Phaser.Geom.Intersects.LineToRectangle(line, rectP)) {
                  if (this.time.now >= (this.player.iframesUntil || 0)) {
                    const dmg = 10;
                    this.applyPlayerDamage(dmg);
                    try { impactBurst(this, hitX, hitY, { color: 0xff4455, size: 'small' }); } catch (_) {}
                    this.player.iframesUntil = this.time.now; // no extra i-frames
                    if (this.gs.hp <= 0) {
                      const eff = getPlayerEffects(this.gs);
                      this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
                      this.gs.nextScene = SceneKeys.Hub;
                      SaveManager.saveToLocal(this.gs);
                      this.scene.start(SceneKeys.Hub);
                    }
                  }
                }
              } catch (_) {}
              if (shieldHit) this._directionalShieldAbsorb(10);
              // Soft barricades: 100% damage (like regular beam, no half multiplier)
              try {
                const arr = this.barricadesSoft?.getChildren?.() || [];
                for (let i = 0; i < arr.length; i += 1) {
                  const s = arr[i]; if (!s?.active) continue;
                  if (!s.getData('destructible')) continue;
                  const sRect = s.getBounds?.() || new Phaser.Geom.Rectangle(s.x - 8, s.y - 8, 16, 16);
                  if (Phaser.Geom.Intersects.LineToRectangle(line, sRect)) {
                    const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 20;
                    const dmg = 30;
                    const hp1 = hp0 - dmg;
                    if (hp1 <= 0) { try { s.destroy(); } catch (_) {} }
                    else s.setData('hp', hp1);
                    try { impactBurst(this, s.x, s.y, { color: 0xff4455, size: 'small' }); } catch (_) {}
                  }
                }
              } catch (_) {}
            } catch (_) {}
          } catch (_) {}
          e._dnNextShotAt = now + 250; // 4 shots per second
        }
        // Skip normal sweep logic while in special
        return;
      }

      // Handle Dandelion sideways dash (available any time except during special/assault)
      const dashSpeed = 800; // significantly faster than player dash
      const dashDurMs = 250; // ~0.25s dash (~200px at this speed)
      if (e._dnAssaultState !== 'idle') {
        // Assault ability owns dashing during its phases
        } else if (e._dnDashState === 'dashing') {
          if (now >= (e._dnDashUntil || 0)) {
            // End dash; allow generic shooter movement to resume
            e._dnDashState = 'idle';
            e._dnDashTrailLast = null;
          } else {
          // Maintain dash velocity and draw dash trail like the player's
            try {
              const vx = e._dnDashDirX * dashSpeed;
              const vy = e._dnDashDirY * dashSpeed;
              e.body?.setVelocity?.(vx, vy);
            } catch (_) {}
            // Break any soft barricades passed through while dashing
            try { this._dandelionBreakSoftBarricades(e); } catch (_) {}
          try {
            if (e._dnDashTrailLast) {
              const g = this.add.graphics();
              try { g.setDepth(9800); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
              // Dandelion dash trail: wider and red
              g.lineStyle(6, 0xff3333, 0.95);
              g.beginPath();
              g.moveTo(e._dnDashTrailLast.x, e._dnDashTrailLast.y);
              g.lineTo(e.x, e.y);
              g.strokePath();
              try {
                this.tweens.add({
                  targets: g,
                  alpha: 0,
                  duration: 220,
                  ease: 'Quad.easeOut',
                  onComplete: () => { try { g.destroy(); } catch (_) {} },
                });
              } catch (_) { try { g.destroy(); } catch (__ ) {} }
              e._dnDashTrailLast.x = e.x;
              e._dnDashTrailLast.y = e.y;
            }
          } catch (_) {}
        }
      } else if (e._dnSpecialState === 'idle' && e._dnAssaultState === 'idle' && now >= (e._dnDashNextAt || 0)) {
        // Eligible to start a new dash: sideways relative to player, with random side
        try {
          const dxp = targetX - e.x;
          const dyp = targetY - e.y;
          let len = Math.hypot(dxp, dyp) || 1;
          const nx = dxp / len;
          const ny = dyp / len;
          // Perpendicular directions: (-ny, nx) and (ny, -nx)
          const left = { x: -ny, y: nx };
          const right = { x: ny, y: -nx };
          const pickRight = Phaser.Math.Between(0, 1) === 1;
          const dir = pickRight ? right : left;
          e._dnDashDirX = dir.x;
          e._dnDashDirY = dir.y;
          e._dnDashState = 'dashing';
          e._dnDashUntil = now + dashDurMs;
          e._dnDashTrailLast = { x: e.x, y: e.y };
          // Next dash no sooner than 3s later plus a small random delay for variability (0闂?s)
          const extra = Phaser.Math.Between(0, 2000);
          e._dnDashNextAt = now + 3000 + extra;
        } catch (_) {}
      }

      // Handle normal Dandelion attack loop: aim (1s) -> burst (1s) -> cooldown (1.5s)
      if (e._dnAssaultState === 'idle' && e._dnMode === 'idle') {
        // Start a new cycle only if not in post-special cooldown
        if (now >= (e._dnAfterSpecialUntil || 0)) {
          e._dnMode = 'sweep'; // reuse field: 'sweep' = normal aim phase
          e._dnSweepStartAt = now;
          // Initialize/clear normal aim graphics
          if (!e._dnNormAimG) e._dnNormAimG = this.add.graphics();
        }
      }

      if (e._dnAssaultState === 'idle' && e._dnMode === 'sweep') {
        // 1s aim lock at player, Dandelion keeps moving via generic shooter logic
        const aimDur = 1000;
        try {
          const g = e._dnNormAimG;
          if (g) {
            g.clear();
            g.lineStyle(1, 0xff3333, 1);
            g.beginPath();
            g.moveTo(e.x, e.y);
            g.lineTo(targetX, targetY);
            g.strokePath();
          }
        } catch (_) {}
        if (now - (e._dnSweepStartAt || 0) >= aimDur) {
          // Transition to 1s burst using same machine-gun parameters as special
          e._dnMode = 'burst';
          e._dnSweepStartAt = now;
          try { e._dnNormAimG?.clear(); } catch (_) {}
          // Ensure shot timer starts now
          if (now < (e._dnNextShotAt || 0)) e._dnNextShotAt = now;
        }
        } else if (e._dnMode === 'burst') {
        // 1s laser machine-gun burst: 4 shots/s, same behavior as special but shorter and while moving
        const burstDur = 1000;
        if (now - (e._dnSweepStartAt || 0) >= burstDur) {
          // Enter cooldown
          e._dnMode = 'cooldown';
          e._dnCooldownUntil = now + (e._dnCooldownMs || 1500);
          e._dnVfxUntil = now + 1000; // 1s of exhaust VFX during cooldown
        } else if (now >= (e._dnNextShotAt || 0)) {
          // Use same lagged target logic as special: aim where player was ~300ms ago
          let txP = targetX;
          let tyP = targetY;
          try {
            if (target === this.player) {
              const hist = this._playerPosHistory || [];
              if (hist.length) {
                const targetMs = now - (e._dnTargetLagMs || 300);
                let best = hist[0];
                for (let i = 1; i < hist.length; i += 1) {
                  const h = hist[i];
                  if (Math.abs(h.t - targetMs) < Math.abs(best.t - targetMs)) best = h;
                }
                txP = best.x; tyP = best.y;
              }
            }
          } catch (_) {}
          const base = Math.atan2(tyP - e.y, txP - e.x);
          const spreadRad = Phaser.Math.DegToRad(Phaser.Math.FloatBetween(-1, 1)); // 闂?闂?(~2闂?total)
          const shotAng = base + spreadRad;
          try {
            const hit = this.computeEnemyLaserEnd(e.x, e.y, shotAng);
            const ex = hit.ex, ey = hit.ey;
            let hitX = ex; let hitY = ey;
            const shieldHit = this._directionalShieldLineHit(e.x, e.y, ex, ey);
            if (shieldHit) {
              hitX = shieldHit.x; hitY = shieldHit.y;
            } else {
              // Clip beam visually to target if it hits them, so the beam doesn't draw past the hit point
              try {
                const lineFull = new Phaser.Geom.Line(e.x, e.y, ex, ey);
                const rectTFull = target?.getBounds?.() || new Phaser.Geom.Rectangle(targetX - 6, targetY - 6, 12, 12);
                const pts = Phaser.Geom.Intersects.GetLineToRectangle(lineFull, rectTFull);
                if (pts && pts.length) {
                  hitX = pts[0].x;
                  hitY = pts[0].y;
                }
              } catch (_) {}
            }
            // Visual: intense red beam that fades quickly
            try {
              const g = this.add.graphics();
              try { g.setDepth(8050); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
              try {
                g.lineStyle(6, 0xff2222, 0.98).beginPath(); g.moveTo(e.x, e.y); g.lineTo(hitX, hitY); g.strokePath();
                g.lineStyle(3, 0xffaaaa, 1).beginPath(); g.moveTo(e.x, e.y - 1); g.lineTo(hitX, hitY); g.strokePath();
              } catch (_) {}
              try {
                this.tweens.add({
                  targets: g,
                  alpha: 0,
                  duration: 160,
                  ease: 'Quad.easeOut',
                  onComplete: () => { try { g.destroy(); } catch (_) {} },
                });
              } catch (_) { try { g.destroy(); } catch (__ ) {} }
            } catch (_) {}
            // Muzzle VFX at Dandelion's laser spawnpoint (railgun-style, tinted red)
            try {
              const mx = e.x + Math.cos(shotAng) * 10;
              const my = e.y + Math.sin(shotAng) * 10;
              muzzleFlashSplit(this, mx, my, { angle: shotAng, color: 0xff3333, count: 3, spreadDeg: 26, length: 20, thickness: 4 });
              const burst = { spreadDeg: 18, speedMin: 140, speedMax: 260, lifeMs: 220, color: 0xff5555, size: 2, alpha: 0.95 };
              pixelSparks(this, mx, my, { angleRad: shotAng - Math.PI / 2, count: 8, ...burst });
              pixelSparks(this, mx, my, { angleRad: shotAng + Math.PI / 2, count: 8, ...burst });
            } catch (_) {}
            // One-time hit check against player and soft barricades (10 dmg, full barricade damage)
            try {
              const line = new Phaser.Geom.Line(e.x, e.y, hitX, hitY);
              // Player hit
              try {
                const rectP = this.player.getBounds?.() || new Phaser.Geom.Rectangle(this.player.x - 6, this.player.y - 6, 12, 12);
                if (!shieldHit && Phaser.Geom.Intersects.LineToRectangle(line, rectP)) {
                  if (this.time.now >= (this.player.iframesUntil || 0)) {
                    const dmg = 10;
                    this.applyPlayerDamage(dmg);
                    try { impactBurst(this, hitX, hitY, { color: 0xff4455, size: 'small' }); } catch (_) {}
                    this.player.iframesUntil = this.time.now; // no extra i-frames
                    if (this.gs.hp <= 0) {
                      const eff = getPlayerEffects(this.gs);
                      this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
                      this.gs.nextScene = SceneKeys.Hub;
                      SaveManager.saveToLocal(this.gs);
                      this.scene.start(SceneKeys.Hub);
                    }
                  }
                }
              } catch (_) {}
              if (shieldHit) this._directionalShieldAbsorb(10);
              // Soft barricades: 30 damage, no reduction
              try {
                const arr = this.barricadesSoft?.getChildren?.() || [];
                for (let i = 0; i < arr.length; i += 1) {
                  const s = arr[i]; if (!s?.active) continue;
                  if (!s.getData('destructible')) continue;
                  const sRect = s.getBounds?.() || new Phaser.Geom.Rectangle(s.x - 8, s.y - 8, 16, 16);
                  if (Phaser.Geom.Intersects.LineToRectangle(line, sRect)) {
                    const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 20;
                    const dmg = 30;
                    const hp1 = hp0 - dmg;
                    if (hp1 <= 0) { try { s.destroy(); } catch (_) {} }
                    else s.setData('hp', hp1);
                    try { impactBurst(this, s.x, s.y, { color: 0xff4455, size: 'small' }); } catch (_) {}
                  }
                }
              } catch (_) {}
            } catch (_) {}
          } catch (_) {}
          e._dnNextShotAt = now + 250; // 4 shots per second
        }
      } else if (e._dnMode === 'cooldown') {
        // 1.5s fixed cooldown after normal burst: Dandelion keeps moving; exhaust VFX only during first 1s
        if (now >= (e._dnCooldownUntil || 0)) {
          e._dnMode = 'idle';
          e._dnCycles = (e._dnCycles || 0) + 1;
          // Trigger special after four full aim+burst+cooldown cycles
          if ((e._dnCycles || 0) >= 4 && now >= (e._dnAfterSpecialUntil || 0) && e._dnSpecialState === 'idle') {
            e._dnCycles = 0;
            e._dnSpecialState = 'aim';
            e._dnSpecialAimUntil = now + 1500;
          }
        } else if (now < (e._dnVfxUntil || 0)) {
          // Exhaust after a normal burst: medium-strength Hazel-style sparks
          try {
            const facingRight = targetX >= e.x;
            const back = facingRight ? Math.PI : 0;
            const tail = 10;
            const tx = e.x + Math.cos(back) * tail;
            const ty = e.y + Math.sin(back) * tail;
            pixelSparks(this, tx, ty, {
              angleRad: back,
              count: 4,
              spreadDeg: 34,
              speedMin: 90,
              speedMax: 190,
              lifeMs: 220,
              color: 0xffffff,
              size: 4,
              alpha: 1.0,
            });
          } catch (_) {}
        }
      }
      // Stronger exhaust immediately after special: larger, brighter, more spread (independent of sweep cooldown)
      if (now < (e._dnAfterVfxUntil || 0)) {
        try {
          const facingRight = targetX >= e.x;
          const back = facingRight ? Math.PI : 0;
          const tail = 12;
          const tx = e.x + Math.cos(back) * tail;
          const ty = e.y + Math.sin(back) * tail;
          pixelSparks(this, tx, ty, {
            angleRad: back,
            count: 6,
            spreadDeg: 46,
            speedMin: 110,
            speedMax: 230,
            lifeMs: 260,
            color: 0xffeeee,
            size: 5,
            alpha: 1.0,
          });
        } catch (_) {}
      }
    } else if (e.bossType === 'Bigwig') {
      // Initialize Bigwig-specific attack and ability state
      if (!e._bwInit) {
        e._bwInit = true;
        e._bwPhase = 'normal'; // 'normal' burst phase or 'special' grenade barrage
        e._bwNormalBurstsRemaining = 3; // 3 normal bursts before each special
        e._bwBurstLeft = 0;
        e._bwNextBurstShotAt = 0;
        e._bwNextAttackReadyAt = now + 400;
        e._bwCastingGrenades = false;
        e._bwSpecialStarted = false;
        // Bombardment ability state
        e._bwAbilityState = 'idle'; // 'idle' | 'channel' | 'postDelay'
        e._bwAbilityNextTime = now + 12000; // first use after a short delay
        e._bwAbilityUntil = 0;
        e._bwAbilitySignalAt = 0;
        e._bwBombardmentActive = false;
        e._bwBombardmentUntil = 0;
        e._bwBombardmentNextAt = 0;
        e._bwBombardmentCenter = null;
        e._bwBombardmentMarker = null;
        // Turret build ability state
        e._bwTurretState = 'idle'; // 'idle' | 'turretChannel'
        e._bwTurretUntil = 0;
        e._bwTurretNextTime = now + 8000;
      }

      // Handle ongoing bombardment (bombs fall while Bigwig can act normally)
      if (e._bwBombardmentActive) {
        if (now >= (e._bwBombardmentUntil || 0)) {
          e._bwBombardmentActive = false;
          e._bwBombardmentCenter = null;
          e._bwBombardmentUntil = 0;
          e._bwBombardmentNextAt = 0;
          if (e._bwBombardmentMarker && typeof e._bwBombardmentMarker.destroy === 'function') {
            try { e._bwBombardmentMarker.destroy(); } catch (_) {}
          }
          e._bwBombardmentMarker = null;
          if (e._bwBombardmentRing) {
            try { e._bwBombardmentRing.destroy(); } catch (_) {}
          }
          e._bwBombardmentRing = null;
        } else if (now >= (e._bwBombardmentNextAt || 0)) {
          const center = e._bwBombardmentCenter;
          if (center) {
            const radius = e._bwBombardmentRadius || 260;
            const ang = Phaser.Math.FloatBetween(0, Math.PI * 2);
            const r = Phaser.Math.FloatBetween(0, radius);
            const tx = center.x + Math.cos(ang) * r;
            const ty = center.y + Math.sin(ang) * r;
            try { this._spawnBigwigBomb(e, tx, ty, { radius: 80 }); } catch (_) {}
          }
          // Next bomb spawn time (faster random cadence during bombardment)
          e._bwBombardmentNextAt = now + Phaser.Math.Between(80, 220);
        }
      }

      // Bombardment ability logic (channel + signal)
      const abilityCdReady = now >= (e._bwAbilityNextTime || 0);
      if (e._bwAbilityState === 'channel') {
        // During channel: immobilize and suppress all attacks
        try { e.body.setVelocity(0, 0); } catch (_) {}
        if (now >= (e._bwAbilityUntil || 0)) {
          e._bwAbilityState = 'postDelay';
        } else {
          return;
        }
      }
      if (e._bwAbilityState === 'postDelay') {
        if (now >= (e._bwAbilitySignalAt || 0)) {
          const px = targetX;
          const py = targetY;
          e._bwBombardmentCenter = { x: px, y: py };
          e._bwBombardmentRadius = 260; // fixed large radius around marker
          e._bwBombardmentActive = true;
          e._bwBombardmentUntil = now + 10000; // 10s bombardment
          e._bwBombardmentNextAt = now + 200;
          // Spawn marker with shared teleport-style spawn VFX
          try {
            teleportSpawnVfx(this, px, py, {
              color: 0xaa66ff,
              onSpawn: () => {
                try { e._bwBombardmentMarker = spawnBombardmentMarker(this, px, py, {}); } catch (_) {}
              },
            });
          } catch (_) {
            try { e._bwBombardmentMarker = spawnBombardmentMarker(this, px, py, {}); } catch (_) {}
          }
          // Subtle purple ring telegraphing bombardment radius
          try {
            bitSpawnRing(this, px, py, {
              color: 0xaa66ff,
              radius: e._bwBombardmentRadius,
              lineWidth: 2,
              duration: 1600,
              scaleTarget: 1.0,
            });
          } catch (_) {}
          try {
            const ringG = this.add.graphics();
            try { ringG.setDepth?.(9590); } catch (_) {}
            ringG.lineStyle(1, 0xaa66ff, 0.55);
            ringG.strokeCircle(px, py, e._bwBombardmentRadius);
            e._bwBombardmentRing = ringG;
          } catch (_) {}
          e._bwAbilityState = 'idle';
        }
      } else if (e._bwAbilityState === 'idle' && abilityCdReady && !e._bwCastingGrenades) {
        // Start bombardment ability: 1s channel, then 0.5s wait, 45s cooldown
        e._bwAbilityState = 'channel';
        e._bwAbilityUntil = now + 1000;
        e._bwAbilitySignalAt = now + 1500;
        e._bwAbilityNextTime = now + 35000;
        // Cancel any ongoing burst/special activity
        e._bwBurstLeft = 0;
        e._bwNormalBurstsRemaining = Math.max(0, e._bwNormalBurstsRemaining || 0);
        e._bwCastingGrenades = false;
        e._bwSpecialStarted = false;
        // Visual: upward purple signal beam
        try { bossSignalBeam(this, e.x, e.y, { duration: 1000 }); } catch (_) {}
        // During the 1s channel, movement and attacks are blocked via early return above
        return;
      }

      // Turret build ability: Bigwig channels for 2s, then spawns a stationary turret at its location
      if (!e._bwTurretState) e._bwTurretState = 'idle';
      const turretCdReady = now >= (e._bwTurretNextTime || 0);
      if (e._bwTurretState === 'turretChannel') {
        // During channel: immobilize and suppress all other actions
        try { e.body.setVelocity(0, 0); } catch (_) {}
        if (now >= (e._bwTurretUntil || 0)) {
          // Channel complete: deploy turret if under cap
          let turretCount = 0;
          try {
            const arr = this.enemies?.getChildren?.() || [];
            for (let i = 0; i < arr.length; i += 1) {
              const t = arr[i];
              if (t?.active && t.isTurret) turretCount += 1;
            }
          } catch (_) {}
          if (turretCount < 5) {
            try {
              const mods = this.gs?.getDifficultyMods?.() || {};
              const hp = Math.max(1, Math.floor(80 * (mods.enemyHp || 1)));
              const dmg = Math.max(1, Math.floor(10 * (mods.enemyDamage || 1)));
              const turret = createTurretEnemy(this, e.x, e.y, hp, dmg);
              if (turret) this.enemies.add(turret);
            } catch (_) {}
          }
          e._bwTurretState = 'idle';
        } else {
          return;
        }
      } else if (e._bwTurretState === 'idle' && turretCdReady && e._bwAbilityState === 'idle' && !e._bwCastingGrenades) {
        // Check current turret count before starting channel
        let turretCount = 0;
        try {
          const arr = this.enemies?.getChildren?.() || [];
          for (let i = 0; i < arr.length; i += 1) {
            const t = arr[i];
            if (t?.active && t.isTurret) turretCount += 1;
          }
        } catch (_) {}
        if (turretCount < 5) {
          e._bwTurretState = 'turretChannel';
          e._bwTurretUntil = now + 1000; // 1s setup/channel time
          e._bwTurretNextTime = now + 10000;
          try { e.body.setVelocity(0, 0); } catch (_) {}
          return;
        }
      }

      // While performing grenade barrage, Bigwig cannot fire normal bullets
      if (e._bwCastingGrenades) return;

      const canAct = now >= (e._bwNextAttackReadyAt || 0);

      // Transition to special phase after finishing the configured number of bursts
      if (e._bwPhase === 'normal') {
        const burstsLeft = (typeof e._bwNormalBurstsRemaining === 'number') ? e._bwNormalBurstsRemaining : 0;
        if (burstsLeft <= 0 && (!e._bwBurstLeft || e._bwBurstLeft <= 0) && !e._bwSpecialStarted && canAct) {
          e._bwPhase = 'special';
          e._bwNextAttackReadyAt = now + 150;
        }
      }

      if (e._bwPhase === 'special') {
        // Start grenade barrage: 3 waves, each wave throws 3 grenades in a fan (9 total)
        if (!e._bwSpecialStarted && canAct) {
          e._bwSpecialStarted = true;
          e._bwCastingGrenades = true;
          const waves = 3;
          const waveDelay = e._bwGrenadeWaveDelayMs || 340;
          const fanDeg = e._bwGrenadeFanDeg || 18;
          const fanRad = Phaser.Math.DegToRad(fanDeg);
          const range = e._bwGrenadeTargetRange || 220;
          for (let i = 0; i < waves; i += 1) {
            this.time.delayedCall(i * waveDelay, () => {
              if (!e.active) return;
              const px = targetX; const py = targetY;
              const baseAng = Math.atan2(py - e.y, px - e.x);
              const offsets = [-1, 0, 1];
              for (let j = 0; j < offsets.length; j += 1) {
                const ang = baseAng + fanRad * offsets[j];
                const tx = e.x + Math.cos(ang) * range;
                const ty = e.y + Math.sin(ang) * range;
                try { this.throwEnemyGrenade(e, tx, ty); } catch (_) {}
              }
              // After final wave, reset back to normal-burst phase
              if (i === waves - 1) {
                e._bwCastingGrenades = false;
                e._bwSpecialStarted = false;
                e._bwPhase = 'normal';
                e._bwNormalBurstsRemaining = 3;
                e._bwBurstLeft = 0;
                e._bwNextBurstShotAt = 0;
                e._bwNextAttackReadyAt = this.time.now + 700;
              }
            });
          }
          }
          return;
        }

      // Normal phase: Bigwig acts like a stationary machine-gunner with 20-round bursts
      if (e._bwPhase === 'normal' && canAct) {
        const totalBullets = 20;
        const spreadDeg = e._bwSpreadDeg || 36;
        const spreadRad = Phaser.Math.DegToRad(spreadDeg);
        const bulletSpeed = e._bwBulletSpeed || 360;
        const burstGap = e._bwBurstGapMs || 55;

        // Start a new burst if not currently bursting
        if (!e._bwBurstLeft || e._bwBurstLeft <= 0) {
          e._bwBurstLeft = totalBullets;
          e._bwNextBurstShotAt = now;
        }

        // Fire bullets in the current burst; aim updates each shot like MachineGunner
        if (e._bwBurstLeft && now >= (e._bwNextBurstShotAt || 0)) {
          const firedSoFar = totalBullets - e._bwBurstLeft;
          const t = (totalBullets === 1) ? 0 : (firedSoFar / (totalBullets - 1) - 0.5);
          // Recompute angle toward player each shot so burst tracks movement
          const baseAng = angToPlayer;
          let ang = baseAng + t * spreadRad;
          // Slight random jitter and toxin chaos
          const jitterScale = 0.18;
          ang += Phaser.Math.FloatBetween(-jitterScale, jitterScale) * spreadRad;
          if (e._toxinedUntil && now < e._toxinedUntil) {
            const extra = Phaser.Math.DegToRad(50);
            ang += Phaser.Math.FloatBetween(-extra / 2, extra / 2);
          }

          // Bigwig normal machine-gun bullets: fixed 6 damage per hit
          fireBullet(ang, bulletSpeed, 6, 0xffee88, 2);

          e._bwBurstLeft -= 1;
          if (e._bwBurstLeft <= 0) {
            // End of one 20-bullet burst
            e._bwNormalBurstsRemaining = Math.max(0, (e._bwNormalBurstsRemaining || 0) - 1);
            e._bwNextAttackReadyAt = now + (e._bwInterBurstDelayMs || 420);
          } else {
            e._bwNextBurstShotAt = now + burstGap;
          }
        }
      }
    } else { // Hazel
      // Initialize Hazel state once
      if (!e._hzInit) {
        e._hzInit = true;
        e._hzShotsSinceSpecial = 0;
        e._hzNextShotAt = now + 600;
        e._hzSpecialActive = false;
        e._hzSpecialState = 'idle'; // 'idle' | 'deploying'
        e._hzMissilesSpawned = 0;
        e._hzNextMissileAt = 0;
        e._hzBaseSpeed = e.speed || 60;
        e._hzAfterSpecialUntil = 0;
        // Teleport-away mechanic state (15s internal cooldown)
        e._hzTpNextAt = now + 8000;
        e._hzTpCloseSince = null;
        // Phase Bomb ability (25s CD, initial delay similar to Bigwig)
        e._hzPhaseState = 'idle'; // 'idle' | 'channel'
        e._hzPhaseChannelUntil = 0;
        e._hzPhaseStartAt = 0;
        e._hzPhaseNextAt = now + 12000;
        // Laser Drone ability (35s CD): channel then spawn drones around Hazel
        e._hzLaserDroneState = 'idle'; // 'idle' | 'channel'
        e._hzLaserDroneChannelUntil = 0;
        e._hzLaserDroneNextAt = now + 16000;
      }

      const dtMsHz = (this.game?.loop?.delta || 16.7);
      const phaseReady = now >= (e._hzPhaseNextAt || 0);
      const laserReady = now >= (e._hzLaserDroneNextAt || 0);
      const tpReady = now >= (e._hzTpNextAt || 0);
      const afterSpecialBlock = now < (e._hzAfterSpecialUntil || 0);

      // Teleport-away mechanic: if player stays within radius for 1s and Hazel is not using specials
      if (!e._hzSpecialActive && e._hzPhaseState !== 'channel' && e._hzLaserDroneState !== 'channel' && tpReady) {
        const dxp = targetX - e.x;
        const dyp = targetY - e.y;
        const distToPlayer = Math.hypot(dxp, dyp) || 0;
        if (distToPlayer <= 180) {
          if (!e._hzTpCloseSince) e._hzTpCloseSince = now;
          if (now - (e._hzTpCloseSince || 0) >= 1000) {
            try { this._hazelTeleportAway(e); } catch (_) {}
            e._hzTpNextAt = now + 15000; // 15s cooldown
            e._hzTpCloseSince = null;
          }
        } else {
          e._hzTpCloseSince = null;
        }
      } else if (e._hzPhaseState === 'channel' || e._hzSpecialActive || e._hzLaserDroneState === 'channel') {
        e._hzTpCloseSince = null;
      }

      // Laser Drone ability: 2s channel (freeze + upward beam), then spawn LaserDrones around Hazel
      if (e._hzLaserDroneState === 'channel') {
        try { e.body.setVelocity(0, 0); } catch (_) {}
        if (now >= (e._hzLaserDroneChannelUntil || 0)) {
          e._hzLaserDroneState = 'idle';
          e._hzLaserDroneChannelUntil = 0;
          // Spawn 5 LaserDrones around Hazel every time this ability resolves
          try {
            const count = 5;
            const baseAngle = Phaser.Math.FloatBetween(0, Math.PI * 2);
            const radius = 70;
            for (let k = 0; k < count; k += 1) {
              const ang = baseAngle + (k / Math.max(1, count)) * Math.PI * 2;
              const sx = e.x + Math.cos(ang) * radius;
              const sy = e.y + Math.sin(ang) * radius;
              try {
                teleportSpawnVfx(this, sx, sy, {
                  color: 0xaa66ff,
                  ringOpts: { radius: 18, lineWidth: 3, duration: 420, scaleTarget: 2.0 },
                  onSpawn: () => {
                    const d = createLaserDroneEnemy(this, sx, sy, 30, e);
                    d._ldIdleAngle = ang;
                    try { this.enemies.add(d); } catch (_) {}
                  },
                });
              } catch (_) {}
            }
          } catch (_) {}
        } else {
          // During channel, Hazel does nothing else
          return;
        }
      } else if (laserReady && !e._hzSpecialActive && e._hzPhaseState !== 'channel') {
        // Start Laser Drone ability: 2s channel with upward beam, drones spawn at end
        e._hzLaserDroneState = 'channel';
        e._hzLaserDroneChannelUntil = now + 2000;
        e._hzLaserDroneNextAt = now + 35000; // 35s cooldown
        try { bossSignalBeam(this, e.x, e.y, { color: 0xaa66ff, duration: 2000 }); } catch (_) {}
        return;
      }

      // Phase Bomb ability: 1s channel (freeze + upward beam), then bombs around player
      if (e._hzPhaseState === 'channel') {
        try { e.body.setVelocity(0, 0); } catch (_) {}
        // During channel, Hazel does nothing else
        if (now >= (e._hzPhaseChannelUntil || 0)) {
          e._hzPhaseState = 'idle';
        } else {
          return;
        }
      } else if (phaseReady && !e._hzSpecialActive) {
        // Start Phase Bomb ability: 1s channel with upward beam, bombs begin after 0.5s
        e._hzPhaseState = 'channel';
        e._hzPhaseStartAt = now;
        e._hzPhaseChannelUntil = now + 1000;
        e._hzPhaseNextAt = now + 25000; // 25s cooldown
        // Initialize global plan for bombs
        if (!this._hzPhasePlan) this._hzPhasePlan = { active: false, startedAt: 0, bombsSpawned: 0, nextBombAt: 0 };
        this._hzPhasePlan.active = true;
        this._hzPhasePlan.startedAt = now;
        this._hzPhasePlan.bombsSpawned = 0;
        this._hzPhasePlan.nextBombAt = now + 500; // first bomb 0.5s after start
        // Upward purple signal beam from Hazel
        try { bossSignalBeam(this, e.x, e.y, { color: 0xaa66ff, duration: 1000 }); } catch (_) {}
        return;
      }

      // Special: deploy 6 guided Hazel missiles after 8 shotgun volleys
      if (e._hzSpecialActive) {
        if (e._hzSpecialState === 'deploying') {
          // Slow Hazel while deploying missiles
          e.speed = e._hzBaseSpeed * 0.5;
          if (e._hzMissilesSpawned < 6 && now >= (e._hzNextMissileAt || 0)) {
            try { this._spawnHazelMissile(e); } catch (_) {}
            e._hzMissilesSpawned += 1;
            e._hzNextMissileAt = now + 500; // 0.5s between missiles
          }
          // After last missile scheduled, end special after final gap
          if (e._hzMissilesSpawned >= 6 && now >= (e._hzNextMissileAt || 0)) {
            e._hzSpecialActive = false;
            e._hzSpecialState = 'idle';
            e.speed = e._hzBaseSpeed;
            e._hzShotsSinceSpecial = 0;
            // Recovery window after special: 1.5s with no attacks
            e._hzAfterSpecialUntil = now + 1500;
            e._hzNextShotAt = e._hzAfterSpecialUntil + 750; // first volley 0.75s after recovery
          }
        }
        return;
      }

      // Regular attack: 5-pellet shotgun volley toward player every 0.75s
      if (!afterSpecialBlock && now >= (e._hzNextShotAt || 0)) {
        e._hzNextShotAt = now + 750; // 0.75s between volleys
        const pellets = 5;
        const totalSpreadDeg = 60;
        const half = Phaser.Math.DegToRad(totalSpreadDeg / 2);
        const step = pellets > 1 ? (2 * half) / (pellets - 1) : 0;
        const base = angToPlayer;
        const speed = 260;
        for (let i = 0; i < pellets; i += 1) {
          const offset = -half + step * i;
          const ang = base + offset;
          // Hazel shotgun pellets: 12 damage each, purple tint + small tracer
          const pellet = fireBullet(ang, speed, 12, 0xaa66ff, 2);
          if (pellet) {
            try {
              const trail = this.add.graphics();
              try { trail.setDepth(8790); trail.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
              pellet._hzTrailG = trail;
              const prevUpdate = pellet.update;
              pellet.update = () => {
                try {
                  if (pellet.active && pellet._hzTrailG && pellet.body) {
                    const g = pellet._hzTrailG;
                    g.clear();
                    const vx = pellet.body.velocity.x || 0;
                    const vy = pellet.body.velocity.y || 0;
                    const mag = Math.hypot(vx, vy) || 1;
                    const vxN = vx / mag;
                    const vyN = vy / mag;
                    const lenSeg = 6;
                    g.lineStyle(2, 0xaa66ff, 0.9);
                    g.beginPath();
                    g.moveTo(pellet.x, pellet.y);
                    g.lineTo(pellet.x - vxN * lenSeg, pellet.y - vyN * lenSeg);
                    g.strokePath();
                  }
                } catch (_) {}
                try { prevUpdate && prevUpdate(); } catch (_) {}
              };
            } catch (_) {}
          }
        }
        e._hzShotsSinceSpecial = (e._hzShotsSinceSpecial || 0) + 1;
        if (!afterSpecialBlock && e._hzShotsSinceSpecial >= 8) {
          // Begin missile special
          e._hzSpecialActive = true;
          e._hzSpecialState = 'deploying';
          e._hzMissilesSpawned = 0;
          e._hzNextMissileAt = now; // start immediately
        }
      }
    }
  }

  // Ensure ammo entry exists for weaponId. If clampOnly, only caps ammo when above capacity
  ensureAmmoFor(weaponId, capacity, clampOnly = false) {
    if (weaponId == null) return;
    if (this.ammoByWeapon[weaponId] == null) {
      this.ammoByWeapon[weaponId] = Math.max(0, capacity | 0);
      return;
    }
    if (clampOnly) {
      if (this.ammoByWeapon[weaponId] > capacity) this.ammoByWeapon[weaponId] = capacity;
    }
  }

  // Returns reload time in ms for active weapon (default 1.5s, rocket 2s)
  getActiveReloadMs() {
    try {
      const w = getEffectiveWeapon(this.gs, this.gs.activeWeapon);
      if (typeof w.reloadMs === 'number') return w.reloadMs;
      return (w.projectile === 'rocket') ? 1000 : 1500;
    } catch (_) {
      return 1500;
    }
  }

  isStealthed() {
    return !!(this._stealth && this._stealth.active);
  }

  getEnemyTarget() {
    if (this._stealth?.active && this._stealth?.decoy?.active) return this._stealth.decoy;
    return this.player;
  }

  _setPlayerStealthVisible(visible) {
    const alpha = visible ? 1 : 0.4;
    try { if (this.player) this.player.setAlpha(alpha); } catch (_) {}
    try { if (this.weaponSprite) this.weaponSprite.setAlpha(alpha); } catch (_) {}
  }

  _explodeStealthDecoy(x, y) {
    const radius = 120;
    try { impactBurst(this, x, y, { color: 0x66ccff, size: 'large', radius }); } catch (_) {}
    try {
      const r2 = radius * radius;
      const arr = this.enemies?.getChildren?.() || [];
      for (let i = 0; i < arr.length; i += 1) {
        const e = arr[i]; if (!e?.active) continue;
        const dx = e.x - x; const dy = e.y - y;
        if ((dx * dx + dy * dy) <= r2) {
          if (e.isDummy) {
            this._dummyDamage = (this._dummyDamage || 0) + 30;
          } else {
            if (typeof e.hp !== 'number') e.hp = e.maxHp || 20;
            e.hp -= 30;
            try { this._flashEnemyHit?.(e); } catch (_) {}
            if (e.hp <= 0) this.killEnemy?.(e);
          }
        }
      }
    } catch (_) {}
  }

  startStealthDecoy() {
    if (this.isStealthed()) return;
    const now = this.time.now;
    const decoy = this.add.sprite(this.player.x, this.player.y, 'player_inle');
    try { fitImageHeight(this, decoy, 24); } catch (_) {}
    try { decoy.setDepth(9000); } catch (_) {}
    try { decoy.setFlipX(!!this.player?.flipX); } catch (_) {}
    this._stealth = { active: true, until: now + 4000, decoy };
    this._setPlayerStealthVisible(false);
    // Blue smoke burst on activation
    try {
      const cx = this.player.x; const cy = this.player.y;
      for (let i = 0; i < 42; i += 1) {
        const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
        pixelSparks(this, cx, cy, {
          angleRad: a,
          count: 1,
          spreadDeg: 16,
          speedMin: 20,
          speedMax: 120,
          lifeMs: 700,
          color: 0x66ccff,
          size: 4,
          alpha: 0.7,
        });
      }
    } catch (_) {}
  }

  startDirectionalShield() {
    if (this._dirShield?.active) return;
    if (!this._dirShield) this._dirShield = { active: false, hp: 0, maxHp: 1000, decayPerSec: 100, g: null, breakG: null };
    this._dirShield.active = true;
    this._dirShield.maxHp = 1000;
    this._dirShield.hp = 1000;
    this._dirShield.decayPerSec = 100;
    try {
      if (!this._dirShield.g) {
        this._dirShield.g = this.add.graphics();
        this._dirShield.g.setDepth(8800);
      }
    } catch (_) {}
  }

  stopDirectionalShield(breakNow = false) {
    if (!this._dirShield) return;
    if (breakNow) {
      try {
        const cx = this.player.x; const cy = this.player.y;
        const ang = this._directionalShieldAngle();
        const { radius, half } = this._directionalShieldParams();
        const count = 18;
        for (let i = 0; i < count; i += 1) {
          const t = (count === 1) ? 0 : (i / (count - 1) - 0.5);
          const a = ang + t * half * 2;
          const px = cx + Math.cos(a) * radius;
          const py = cy + Math.sin(a) * radius;
          pixelSparks(this, px, py, {
            angleRad: a,
            count: 2,
            spreadDeg: 22,
            speedMin: 120,
            speedMax: 240,
            lifeMs: 260,
            color: 0xffee66,
            size: 2,
            alpha: 0.95,
          });
        }
      } catch (_) {}
    }
    this._dirShield.active = false;
    this._dirShield.hp = 0;
    try { this._dirShield.g?.clear(); } catch (_) {}
  }

  _directionalShieldAngle() {
    try {
      const ptr = this.inputMgr?.pointer || this.input?.activePointer;
      if (!ptr || !this.player) return this.playerFacing || 0;
      return Math.atan2(ptr.worldY - this.player.y, ptr.worldX - this.player.x);
    } catch (_) {
      return this.playerFacing || 0;
    }
  }

  _directionalShieldParams() {
    return { radius: 48, half: Phaser.Math.DegToRad(45), thickness: 8 };
  }

  _directionalShieldBlocksAngle(ang) {
    const shieldAng = this._directionalShieldAngle();
    const diff = Math.abs(Phaser.Math.Angle.Wrap(ang - shieldAng));
    return diff <= this._directionalShieldParams().half;
  }

  _directionalShieldAbsorb(amount) {
    if (!this._dirShield?.active) return false;
    const dmg = Math.max(1, Math.floor(amount || 0));
    this._dirShield.hp = Math.max(0, (this._dirShield.hp || 0) - dmg);
    if (this._dirShield.hp <= 0) this.stopDirectionalShield(true);
    return true;
  }

  _directionalShieldBlocksProjectile(obj) {
    if (!this._dirShield?.active || !obj?.active) return false;
    if (obj._bwBomb) return false;
    const { radius, thickness } = this._directionalShieldParams();
    const dx = obj.x - this.player.x;
    const dy = obj.y - this.player.y;
    const ang = Math.atan2(dy, dx);
    if (!this._directionalShieldBlocksAngle(ang)) return false;
    const d2 = dx * dx + dy * dy;
    const maxR = radius + thickness;
    return d2 <= (maxR * maxR);
  }

  _directionalShieldLineHit(sx, sy, ex, ey) {
    if (!this._dirShield?.active) return null;
    const { radius, half } = this._directionalShieldParams();
    const cx = this.player.x; const cy = this.player.y;
    const dx = ex - sx; const dy = ey - sy;
    const a = dx * dx + dy * dy;
    if (a <= 0.0001) return null;
    const fx = sx - cx; const fy = sy - cy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - radius * radius;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sqrtD = Math.sqrt(disc);
    const t1 = (-b - sqrtD) / (2 * a);
    const t2 = (-b + sqrtD) / (2 * a);
    let t = null;
    if (t1 >= 0 && t1 <= 1) t = t1;
    else if (t2 >= 0 && t2 <= 1) t = t2;
    if (t === null) return null;
    const ix = sx + dx * t; const iy = sy + dy * t;
    const ang = Math.atan2(iy - cy, ix - cx);
    const diff = Math.abs(Phaser.Math.Angle.Wrap(ang - this._directionalShieldAngle()));
    if (diff > half) return null;
    return { x: ix, y: iy };
  }

  deployVulcanTurret() {
    const now = this.time.now;
    const x = this.player.x; const y = this.player.y;
    const turret = {
      x, y,
      base: null,
      head: null,
      spawnAt: now,
      warmUntil: now + 1000,
      until: now + 9000,
      angle: this.playerFacing || 0,
      lastShotAt: 0,
    };
    try {
      const base = this.add.image(x, y, 'turret_base');
      base.setOrigin(0.5, 0.5);
      base.setDepth(8000);
      try {
        const tex = this.textures.get('turret_base');
        const src = tex?.getSourceImage?.();
        const h = (src && (src.naturalHeight || src.height)) || tex?.frames?.['__BASE']?.height || base.height || 1;
        if (h > 0) base.setScale((12 / h) * 2.4);
      } catch (_) {}
      turret.base = base;
    } catch (_) {}
    try {
      const head = this.add.image(x, y, 'turret_vulcan');
      head.setOrigin(0.6, 0.5);
      head.setDepth(8005);
      try {
        const texH = this.textures.get('turret_vulcan');
        const srcH = texH?.getSourceImage?.();
        const h2 = (srcH && (srcH.naturalHeight || srcH.height)) || texH?.frames?.['__BASE']?.height || head.height || 1;
        if (h2 > 0) head.setScale((12 / h2) * 2.6);
      } catch (_) {}
      turret.head = head;
    } catch (_) {}
    this._vulcanTurrets.push(turret);
  }

  endStealthDecoy() {
    if (!this.isStealthed()) return;
    const decoy = this._stealth?.decoy;
    this._stealth.active = false;
    this._stealth.until = 0;
    this._stealth.decoy = null;
    this._setPlayerStealthVisible(true);
    if (decoy && decoy.active) {
      this._explodeStealthDecoy(decoy.x, decoy.y);
      try { decoy.destroy(); } catch (_) {}
    }
  }

  deployADS() {
    const x = this.player.x; const y = this.player.y;
    // Use asset sprite for ADS and fit to small height
    const g = createFittedImage(this, x, y, 'ability_ads',  20);
    try { g.setDepth(9000); } catch (_) {}
    const obj = { x, y, g, radius: 120, nextZapAt: 0, until: this.time.now + 8000 };
    this._gadgets.push(obj);
  }

  deployRepulsionPulse(colors) {
    if (!this._repulses) this._repulses = [];
    const x = this.player.x; const y = this.player.y;
    const g = this.add.graphics({ x, y });
    try { g.setDepth?.(9000); } catch (_) {}
    try { g.setBlendMode?.(Phaser.BlendModes.ADD); } catch (_) {}
    const rect = this.arenaRect || new Phaser.Geom.Rectangle(0, 0, this.scale.width, this.scale.height);
    const corners = [
      { x: rect.left, y: rect.top },
      { x: rect.right, y: rect.top },
      { x: rect.right, y: rect.bottom },
      { x: rect.left, y: rect.bottom },
    ];
    let maxD = 0; for (let i = 0; i < corners.length; i += 1) { const dx = corners[i].x - x; const dy = corners[i].y - y; const d = Math.hypot(dx, dy); if (d > maxD) maxD = d; }
    const obj = { x, y, r: 0, band: 8, speed: 300, maxR: maxD + 24, g };
    // Optional color palette override
    if (colors && typeof colors === 'object') {
      obj.colTrail = colors.trail;
      obj.colOuter = colors.outer;
      obj.colInner = colors.inner;
      obj.colSpark = colors.spark;
      obj.colPixel = colors.pixel;
      obj.colImpact = colors.impact;
    }
    this._repulses.push(obj);
  }

  deployBITs() {
    if (!this._bits) this._bits = [];
    // Green spawn ring for visual parity with Boss room
    try { bitSpawnRing(this, this.player.x, this.player.y, { radius: 18, lineWidth: 3, duration: 420, scaleTarget: 2.0 }); } catch (_) {}
    // Green pixel burst around player on release
    try {
      const cx = this.player.x, cy = this.player.y;
      for (let i = 0; i < 18; i += 1) {
        const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
        pixelSparks(this, cx, cy, { angleRad: a, count: 1, spreadDeg: 6, speedMin: 80, speedMax: 180, lifeMs: 240, color: 0x33ff66, size: 2, alpha: 0.8 });
      }
    } catch (_) {}
    const count = 6;
    for (let i = 0; i < count; i += 1) {
      // Use asset sprite for BIT unit and fit to moderate height
      const g = createFittedImage(this, this.player.x, this.player.y, 'ability_bit', 14);
      try { g.setDepth(9000); } catch (_) {}
      const bit = { x: this.player.x, y: this.player.y, vx: 0, vy: 0, g, target: null, lastShotAt: 0, holdUntil: 0, moveUntil: 0, despawnAt: this.time.now + 7000, spawnScatterUntil: this.time.now + Phaser.Math.Between(260, 420) };
      // Thruster VFX (additive tiny tail like missiles)
      try { bit._thr = this.add.graphics(); bit._thr.setDepth(8800); bit._thr.setBlendMode?.(Phaser.BlendModes.ADD); } catch (_) {}
      // initial scatter velocity
      const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const sp = Phaser.Math.Between(180, 260);
      bit.vx = Math.cos(a) * sp; bit.vy = Math.sin(a) * sp; bit.moveUntil = this.time.now + Phaser.Math.Between(200, 400);
      this._bits.push(bit);
    }
  }

  _spawnSiphonPacket(x, y, color = 0x66ccff, size = 2, speed = 520) {
    try {
      if (!this._siphonPackets) this._siphonPackets = [];
      const g = this.add.rectangle(x, y, Math.max(1, size), Math.max(1, size), color, 0.55);
      try { g.setDepth(9400); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
      this._siphonPackets.push({ x, y, g, speed, bornAt: this.time.now });
    } catch (_) {}
  }

  _spawnSiphonTrace(fromX, fromY, dmg, isKill = false) {
    try {
      const amount = Math.max(1, Math.floor(dmg || 1));
      const col = isKill ? 0xff3333 : 0x66ccff; // player shield color for normal siphon
      const count = isKill
        ? Math.max(16, Math.min(32, Math.floor(amount * 0.8)))
        : Math.max(2, Math.min(14, Math.floor(amount * 0.45)));
      const spread = isKill ? 14 : 6;
      const size = isKill ? 3 : (amount >= 20 ? 3 : 2);
      for (let i = 0; i < count; i += 1) {
        const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
        const r = Phaser.Math.FloatBetween(0, spread);
        const sx = fromX + Math.cos(a) * r;
        const sy = fromY + Math.sin(a) * r;
        const spd = isKill ? Phaser.Math.Between(520, 760) : Phaser.Math.Between(460, 680);
        this._spawnSiphonPacket(sx, sy, col, size, spd);
      }
      // tiny matching burst at source to make siphon event readable
      try { impactBurst(this, fromX, fromY, { color: col, size: isKill ? 'large' : 'small' }); } catch (_) {}
    } catch (_) {}
  }

  _spawnSiphonAbsorbBurst() {
    try {
      if (!this.player?.active) return;
      const px = this.player.x;
      const py = this.player.y;
      const col = 0x66ccff; // match shield ring color
      const count = Phaser.Math.Between(3, 5);
      for (let i = 0; i < count; i += 1) {
        const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
        const r = Phaser.Math.FloatBetween(12, 48);
        const sx = px + Math.cos(a) * r;
        const sy = py + Math.sin(a) * r;
        // Ambient siphon motes are intentionally slower than enemy-to-player siphon packets.
        const spd = Phaser.Math.Between(170, 260);
        this._spawnSiphonPacket(sx, sy, col, 2, spd);
      }
    } catch (_) {}
  }

  // Railgun mechanics
  handleRailgunCharge(now, weapon, ptr) {
    const wid = this.gs.activeWeapon;
    const cap = this.getActiveMagCapacity();
    this.ensureAmmoFor(wid, cap);
    const ammo = this.ammoByWeapon[wid] ?? 0;
    // Cancel charge if swapping away handled elsewhere
    if (this.reload.active || ammo <= 0) {
      this.endRailAim();
      return;
    }
    const maxMs = 1500;
    if (!this.rail) this.rail = { charging: false, startedAt: 0, aimG: null };
    const coreHold = !!weapon.railHold;
    const baseAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, ptr.worldX, ptr.worldY);

    if (ptr.isDown && ((ptr.buttons & 1) === 1)) {
      if (!this.rail.charging) {
        if (!this.lastShot || (now - this.lastShot) > weapon.fireRateMs) {
          this.rail.charging = true;
          this.rail.startedAt = now;
          try {
            const key = ensurePixelParticle(this, 'rail_px', 0x66aaff, 1) || 'rail_px';
            this.rail._mgr = this.add.particles(key);
            try { this.rail._mgr.setDepth(9500); } catch (_) {}
            try { this.rail._mgr.setBlendMode?.(Phaser.BlendModes.ADD); } catch (_) {}
            this.rail._em = this.rail._mgr.createEmitter({
              speed: { min: 10, max: 60 },
              lifespan: { min: 180, max: 320 },
              alpha: { start: 1.0, end: 0 },
              scale: 1,
              gravityY: 0,
              quantity: 0,
            });
          } catch (_) {}
        }
      }
    } else {
      // Released: fire if charging
      if (this.rail.charging) {
        const t = Math.min(1, (now - this.rail.startedAt) / maxMs);
        this.fireRailgun(baseAngle, weapon, t);
        this.rail.charging = false;
        this.endRailAim();
      }
      return;
    }

    // While holding
    if (this.rail.charging) {
      const t = Math.min(1, (now - this.rail.startedAt) / maxMs);
      this.drawRailAim(baseAngle, weapon, t);
      if (t >= 1 && !coreHold) {
        // Auto-fire at max unless core allows holding
        this.fireRailgun(baseAngle, weapon, t);
        this.rail.charging = false;
        this.endRailAim();
      }
    }
  }

  drawRailAim(angle, weapon, t) {
    try {
      if (!this.rail?.aimG) this.rail.aimG = this.add.graphics();
      const g = this.rail.aimG; g.clear(); g.setDepth(9000);
      const spread0 = Phaser.Math.DegToRad(Math.max(0, weapon.spreadDeg || 0));
      const spread = spread0 * (1 - t);
      // Full-screen length: use screen diagonal with small margin
      const diag = Math.hypot(this.scale.width, this.scale.height);
      const len = Math.ceil(diag + 32);
      // Thinner guide line
      g.lineStyle(0.5, 0xffffff, 0.9);
      const a1 = angle - spread / 2; const a2 = angle + spread / 2;
      const x = this.player.x; const y = this.player.y;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a1) * len, y + Math.sin(a1) * len); g.strokePath();
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a2) * len, y + Math.sin(a2) * len); g.strokePath();
      // Blue pixel sparks from multiple points along barrel (very subtle while charging)
      try {
        const ts = [0.35, 0.55, 0.8];
        const pick = Phaser.Math.Between(0, ts.length - 1);
        const pt = getWeaponBarrelPoint(this, ts[pick], 3);
        const common = { spreadDeg: 10, speedMin: 40, speedMax: 90, lifeMs: 140, color: 0x66aaff, size: 1, alpha: 0.45 };
        pixelSparks(this, pt.x, pt.y, { angleRad: angle - Math.PI / 2, count: 1, ...common });
        pixelSparks(this, pt.x, pt.y, { angleRad: angle + Math.PI / 2, count: 1, ...common });
      } catch (_) {}
    } catch (_) {}
  }

  endRailAim() {
    try { this.rail?.aimG?.clear(); this.rail?.aimG?.destroy(); } catch (_) {}
    try { this.rail?._mgr?.destroy(); } catch (_) {}
    if (this.rail) { this.rail.aimG = null; this.rail._mgr = null; this.rail._em = null; }
  }

  fireRailgun(baseAngle, weapon, t) {
    const wid = this.gs.activeWeapon;
    const cap = this.getActiveMagCapacity();
    this.ensureAmmoFor(wid, cap);
    const ammo = this.ammoByWeapon[wid] ?? 0;
    if (ammo <= 0 || this.reload.active) return;
    const dmg = Math.floor(weapon.damage * (1 + 2 * t));
    const speed = Math.floor(weapon.bulletSpeed * (1 + 2 * t));
    const spreadRad = Phaser.Math.DegToRad(Math.max(0, (weapon.spreadDeg || 0))) * (1 - t);
    const off = (spreadRad > 0) ? Phaser.Math.FloatBetween(-spreadRad / 2, spreadRad / 2) : 0;
    const angle = baseAngle + off;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    const b = this.bullets.get(this.player.x, this.player.y, 'bullet');
    if (!b) return;
    b.setActive(true).setVisible(true);
    b.setCircle(2).setOffset(-2, -2);
    b.setVelocity(vx, vy);
    b.damage = dmg;
    b.setTint(0x66aaff);
    b._core = 'pierce';
    b._pierceLeft = 999; // effectively unlimited pierce
    b._rail = true; // identify railgun bullets for special handling
    b._stunOnHit = weapon._stunOnHit || 0;
    // Simple light-blue trail
    const trail = this.add.graphics();
    b._g = trail; trail.setDepth(8000);
    b._px = b.x; b._py = b.y;
    b.update = () => {
      try {
        // Draw trail
        trail.clear();
        trail.lineStyle(2, 0xaaddff, 0.9);
        const tx = b.x - (vx * 0.02); const ty = b.y - (vy * 0.02);
        trail.beginPath(); trail.moveTo(b.x, b.y); trail.lineTo(tx, ty); trail.strokePath();
      } catch (_) {}

      // Manual hit check to avoid tunneling at high speed
      try {
        const line = new Phaser.Geom.Line(b._px ?? b.x, b._py ?? b.y, b.x, b.y);
        if (!b._hitSet) b._hitSet = new Set();
        const arr = this.enemies?.getChildren?.() || [];
        for (let i = 0; i < arr.length; i += 1) {
          const e = arr[i];
          if (!e || !e.active) continue;
          if (b._hitSet.has(e)) continue;
          const rect = e.getBounds();
        if (Phaser.Geom.Intersects.LineToRectangle(line, rect)) {
          if (e.isDummy) {
            // Railgun dummy recording: accumulate but do not change HP
            this._dummyDamage = (this._dummyDamage || 0) + (b.damage || 10);
            if (b._stunOnHit && b._stunOnHit > 0) {
              const nowS = this.time.now;
              e._stunValue = Math.min(10, (e._stunValue || 0) + b._stunOnHit);
              if ((e._stunValue || 0) >= 10) {
                e._stunnedUntil = nowS + 200;
                e._stunValue = 0;
                if (!e._stunIndicator) { e._stunIndicator = this.add.graphics(); try { e._stunIndicator.setDepth(9000); } catch (_) {} e._stunIndicator.fillStyle(0xffff33, 1).fillCircle(0, 0, 2); }
                try { e._stunIndicator.setPosition(e.x, e.y - 22); } catch (_) {}
              }
            }
          } else {
            if (typeof e.hp !== 'number') e.hp = e.maxHp || 20;
            e.hp -= (b.damage || 10);
            try { this._flashEnemyHit(e); } catch (_) {}
            if (b._stunOnHit && b._stunOnHit > 0) {
              const nowS = this.time.now;
              e._stunValue = Math.min(10, (e._stunValue || 0) + b._stunOnHit);
              if ((e._stunValue || 0) >= 10) {
                e._stunnedUntil = nowS + 200;
                e._stunValue = 0;
                if (!e._stunIndicator) { e._stunIndicator = this.add.graphics(); try { e._stunIndicator.setDepth(9000); } catch (_) {} e._stunIndicator.fillStyle(0xffff33, 1).fillCircle(0, 0, 2); }
                try { e._stunIndicator.setPosition(e.x, e.y - 22); } catch (_) {}
              }
            }
          }
            try { impactBurst(this, b.x, b.y, { color: 0xaaddff, size: 'small' }); } catch (_) {}
            b._hitSet.add(e);
            if (!e.isDummy && e.hp <= 0) { try { this.killEnemy ? this.killEnemy(e) : e.destroy(); } catch (_) {} }
          }
        }
        // Railgun should pierce barricades and not damage them.
        // For non-rail bullets, use normal barricade handling; for rail, trigger only a pierce VFX once per barricade.
        if (!b._rail) {
          const hitBarricade = (grp) => {
            if (!grp) return false;
            const arrS = grp.getChildren?.() || [];
            for (let j = 0; j < arrS.length; j += 1) {
              const s = arrS[j]; if (!s?.active) continue;
              const r = s.getBounds();
              if (Phaser.Geom.Intersects.LineToRectangle(line, r)) {
                try { this.onBulletHitBarricade(b, s); } catch (_) { try { b.destroy(); } catch (__ ) {} }
                return true;
              }
            }
            return false;
          };
          if (hitBarricade(this.barricadesHard)) return;
          if (hitBarricade(this.barricadesSoft)) return;
        } else {
          // Rail: spawn a small spark the first time we pass through each barricade
          const pierceVfx = (grp) => {
            if (!grp) return;
            const arrS = grp.getChildren?.() || [];
            if (!b._piercedBarricades) b._piercedBarricades = new Set();
            for (let j = 0; j < arrS.length; j += 1) {
              const s = arrS[j]; if (!s?.active) continue;
              if (b._piercedBarricades.has(s)) continue;
              const r = s.getBounds();
              if (Phaser.Geom.Intersects.LineToRectangle(line, r)) {
                b._piercedBarricades.add(s);
                try { impactBurst(this, b.x, b.y, { color: 0xaaddff, size: 'small' }); } catch (_) {}
              }
            }
          };
          pierceVfx(this.barricadesHard);
          pierceVfx(this.barricadesSoft);
        }
      } catch (_) {}

      // Offscreen cleanup
      const view = this.cameras?.main?.worldView;
      if (view && !view.contains(b.x, b.y)) { try { b.destroy(); } catch (_) {} }
      b._px = b.x; b._py = b.y;
    };
    b.on('destroy', () => { try { b._g?.destroy(); } catch (_) {} });
    // Rail muzzle VFX: big blue split flash + particle burst
    try {
      const m = getWeaponMuzzleWorld(this, 3);
      muzzleFlashSplit(this, m.x, m.y, { angle, color: 0xaaddff, count: 4, spreadDeg: 30, length: 24, thickness: 5 });
      // Stronger pixel spark burst on fire
      const burst = { spreadDeg: 14, speedMin: 160, speedMax: 280, lifeMs: 280, color: 0x66aaff, size: 2, alpha: 0.9 };
      pixelSparks(this, m.x, m.y, { angleRad: angle - Math.PI / 2, count: 10, ...burst });
      pixelSparks(this, m.x, m.y, { angleRad: angle + Math.PI / 2, count: 10, ...burst });
      if (this.rail?._em) { try { this.rail._em.explode?.(60, m.x, m.y); } catch (_) {} }
      try { this.rail?._mgr?.destroy(); } catch (_) {}
      if (this.rail) { this.rail._mgr = null; this.rail._em = null; }
    } catch (_) {}
    // High recoil kick for railgun on fire
    try { this._weaponRecoil = Math.max(this._weaponRecoil || 0, 5.5); } catch (_) {}
    // consume ammo and start cooldown
    this.ammoByWeapon[wid] = Math.max(0, (this.ammoByWeapon[wid] ?? cap) - 1);
    this.registry.set('ammoInMag', this.ammoByWeapon[wid]);
    this.lastShot = this.time.now;
    if (this.ammoByWeapon[wid] <= 0) {
      // trigger reload
      if (!this.reload.active) {
        this.reload.active = true;
        this.reload.duration = this.getActiveReloadMs();
        this.reload.until = this.time.now + this.reload.duration;
        this.registry.set('reloadActive', true);
        this.registry.set('reloadProgress', 0);
      }
    }
  }

  handleFlamethrower(now, weapon, ptr, dt) {
    if (!this._flame) this._flame = { ignited: false, igniteAt: 0, ignitedAt: 0, lastFireAt: 0, idleFxAt: 0, ammoCarry: 0, coneG: null };
    const f = this._flame;
    const wid = this.gs.activeWeapon;
    const cap = this.getActiveMagCapacity();
    this.ensureAmmoFor(wid, cap);

    const holding = !!this.inputMgr?.isLMBDown;
    const igniteMs = weapon.flameIgniteMs || 500;
    const idleMs = weapon.flameIdleMs || 4000;
    if (holding && !f.ignited && !f.igniteAt) {
      f.igniteAt = now + igniteMs;
    }
    if (!f.ignited && f.igniteAt && now >= f.igniteAt) {
      f.ignited = true;
      f.igniteAt = 0;
      f.ignitedAt = now;
    }

    if (f.ignited) {
      const last = f.lastFireAt || 0;
      const ignAt = f.ignitedAt || 0;
      const idleSince = (last && last >= ignAt) ? last : ignAt;
      if (idleSince && (now - idleSince) > idleMs) {
        f.ignited = false;
        f.ignitedAt = 0;
        f.lastFireAt = 0;
        if (holding) f.igniteAt = now + igniteMs;
      }
    }

    const baseAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, ptr.worldX, ptr.worldY);
    let firing = false;
    if (holding && f.ignited && !this.reload.active) {
      const ammo = this.ammoByWeapon[wid] ?? 0;
      if (ammo <= 0) {
        if (!this.reload.active) {
          this.reload.active = true;
          this.reload.duration = this.getActiveReloadMs();
          this.reload.until = now + this.reload.duration;
          this.registry.set('reloadActive', true);
          this.registry.set('reloadProgress', 0);
        }
      } else {
        firing = true;
        f.lastFireAt = now;
        const perSec = weapon.flameAmmoPerSec || 20;
        f.ammoCarry = (f.ammoCarry || 0) + (perSec * dt);
        const spend = Math.floor(f.ammoCarry);
        if (spend > 0) {
          this.ammoByWeapon[wid] = Math.max(0, ammo - spend);
          f.ammoCarry -= spend;
          this.registry.set('ammoInMag', this.ammoByWeapon[wid]);
        }

        const origin = getWeaponMuzzleWorld(this, 2);
        const range = weapon.flameRange || 90;
        const half = Phaser.Math.DegToRad((weapon.flameConeDeg || 35) * 0.5);
        const range2 = range * range;
        const dps = weapon.flameDps || 150;
        const ignitePerSec = weapon.flameIgnitePerSec || 30;
        const dmg = dps * dt;
        const igniteAdd = ignitePerSec * dt;

        const enemies = this.enemies?.getChildren?.() || [];
        for (let i = 0; i < enemies.length; i += 1) {
          const e = enemies[i];
          if (!e?.active) continue;
          const dx = e.x - origin.x;
          const dy = e.y - origin.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > range2) continue;
          const ang = Math.atan2(dy, dx);
          const diff = Phaser.Math.Angle.Wrap(ang - baseAngle);
          if (Math.abs(diff) > half) continue;
          if (this.isLineBlockedByHard(origin.x, origin.y, e.x, e.y)) continue;
          if (e.isDummy) {
            this._dummyDamage = (this._dummyDamage || 0) + dmg;
          } else {
            if (typeof e.hp !== 'number') e.hp = e.maxHp || 20;
            e.hp -= dmg;
            try { this._flashEnemyHit(e); } catch (_) {}
            if (e.hp <= 0) { try { this.killEnemy ? this.killEnemy(e) : e.destroy(); } catch (_) {} }
          }
          if (igniteAdd > 0) {
            e._igniteValue = Math.min(10, (e._igniteValue || 0) + igniteAdd);
            if ((e._igniteValue || 0) >= 10) {
              e._ignitedUntil = now + 2000;
              e._igniteValue = 0;
              if (!e._igniteIndicator) {
                e._igniteIndicator = this.add.graphics();
                try { e._igniteIndicator.setDepth(9000); } catch (_) {}
                e._igniteIndicator.fillStyle(0xff3333, 1).fillCircle(0, 0, 2);
              }
              try { e._igniteIndicator.setPosition(e.x, e.y - 14); } catch (_) {}
            }
          }
        }

        const soft = this.barricadesSoft?.getChildren?.() || [];
        for (let i = 0; i < soft.length; i += 1) {
          const s = soft[i];
          if (!s?.active) continue;
          if (!s.getData('destructible')) continue;
          const dx = s.x - origin.x;
          const dy = s.y - origin.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > range2) continue;
          const ang = Math.atan2(dy, dx);
          const diff = Phaser.Math.Angle.Wrap(ang - baseAngle);
          if (Math.abs(diff) > half) continue;
          if (this.isLineBlockedByHard(origin.x, origin.y, s.x, s.y)) continue;
          const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 20;
          const hp1 = hp0 - dmg;
          if (hp1 <= 0) { try { s.destroy(); } catch (_) {} }
          else s.setData('hp', hp1);
        }

        try {
          const spMul = (typeof weapon._flameParticleSpeedMult === 'number') ? weapon._flameParticleSpeedMult : 1;
          const lifeMul = (typeof weapon._flameParticleLifeMult === 'number') ? weapon._flameParticleLifeMult : 1;
          pixelSparks(this, origin.x, origin.y, {
            angleRad: baseAngle,
            count: 18,
            spreadDeg: weapon.flameConeDeg || 35,
            speedMin: 160 * spMul,
            speedMax: 400 * spMul,
            lifeMs: 310 * lifeMul,
            color: 0xffaa33,
            size: 4,
            alpha: 0.9,
          });
        } catch (_) {}
      }
    }

    if (!firing) {
      if (f.ignited && now >= (f.idleFxAt || 0)) {
        const p = getWeaponMuzzleWorld(this, 2);
        try {
          pixelSparks(this, p.x, p.y, { angleRad: baseAngle, count: 3, spreadDeg: 14, speedMin: 12, speedMax: 50, lifeMs: 140, color: 0xffaa33, size: 2, alpha: 0.8 });
        } catch (_) {}
        f.idleFxAt = now + 120;
      }
    }
  }

  // Laser mechanics: continuous beam with heat/overheat and ignite buildup
  handleLaser(now, weapon, ptr, dt) {
    if (!this.laserByWeapon) this.laserByWeapon = {};
    const key = weapon?.id || 'laser';
    if (!this.laserByWeapon[key]) {
      this.laserByWeapon[key] = { heat: 0, firing: false, overheat: false, startedAt: 0, coolDelayUntil: 0, g: null, lastTickAt: 0 };
    }
    const lz = this.laserByWeapon[key];
    // Initialize graphics once per weapon
    if (!lz.g) {
      lz.g = this.add.graphics();
      try { lz.g.setDepth(8000); } catch (_) {}
      try { lz.g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
    }
    if (!lz.mg) {
      lz.mg = this.add.graphics();
      try { lz.mg.setDepth(9000); } catch (_) {}
      try { lz.mg.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
    }
    const canPress = ptr?.isDown && ((ptr.buttons & 1) === 1);
    const isDmr = weapon?.id === 'laser_dmr';
    const canFire = canPress && !lz.overheat;
    if (isDmr) {
      const hasOverheatCore = weapon._core === 'laser_dmr_overheat';
      const heatPerShot = hasOverheatCore ? (1 / 5) : (1 / 6);
      const coolDelay = 0.5;
      const coolFastPerSec = 0.6;
      const fireRateMs = weapon.fireRateMs || 150;
      const wantsClick = !!ptr?.justDown || (!lz._dmrWasDown && canPress);

      if (!lz._lastShotAt) lz._lastShotAt = 0;
      if (!lz._dmrCooling) lz._dmrCooling = false;

      // Fire discrete laser shots
      if (wantsClick && !lz.overheat && now >= (lz._lastShotAt || 0) + fireRateMs) {
        lz.firing = true;
        lz._lastShotAt = now;
        lz.coolDelayUntil = now + Math.floor(coolDelay * 1000);
        lz.heat = Math.min(1, lz.heat + heatPerShot);

        const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, ptr.worldX, ptr.worldY);
        const muzzle = getWeaponMuzzleWorld(this, 2);
        const sx = muzzle.x;
        const sy = muzzle.y;
        const hit = this.computeLaserEnd(angle, sx, sy);
        const ex = hit.ex, ey = hit.ey;
        const hitEnemy = hit.hitEnemy;

        // Dandelion-style beam VFX, smaller width, blue tint
        try {
          const g = this.add.graphics();
          try { g.setDepth(8050); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
          try {
            g.lineStyle(4, 0x66aaff, 0.98).beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.strokePath();
            g.lineStyle(2, 0xaaddff, 1).beginPath(); g.moveTo(sx, sy - 1); g.lineTo(ex, ey); g.strokePath();
          } catch (_) {}
          this.tweens.add({
            targets: g,
            alpha: 0,
            duration: 160,
            ease: 'Quad.easeOut',
            onComplete: () => { try { g.destroy(); } catch (_) {} },
          });
        } catch (_) {}
        // Muzzle VFX (Dandelion laser machinegun style, blue and smaller)
        try {
          muzzleFlashSplit(this, sx, sy, { angle, color: 0x66aaff, count: 2, spreadDeg: 20, length: 12, thickness: 3 });
          const burst = { spreadDeg: 16, speedMin: 90, speedMax: 180, lifeMs: 180, color: 0x88bbff, size: 1, alpha: 0.9 };
          pixelSparks(this, sx, sy, { angleRad: angle - Math.PI / 2, count: 6, ...burst });
          pixelSparks(this, sx, sy, { angleRad: angle + Math.PI / 2, count: 6, ...burst });
        } catch (_) {}

        // Apply damage to first enemy hit
        if (hitEnemy && hitEnemy.active) {
          const dmg = Math.max(1, Math.floor(weapon.damage || 25));
          if (hitEnemy.isDummy) {
            this._dummyDamage = (this._dummyDamage || 0) + dmg;
          } else {
            if (typeof hitEnemy.hp !== 'number') hitEnemy.hp = hitEnemy.maxHp || 20;
            hitEnemy.hp -= dmg;
            try { this._flashEnemyHit?.(hitEnemy); } catch (_) {}
            if (hitEnemy.hp <= 0) this.killEnemy(hitEnemy);
          }
          try { impactBurst(this, ex, ey, { color: 0x66aaff, size: 'small' }); } catch (_) {}
        }
        // Damage soft barricades the same as enemies
        try {
          const arr = this.barricadesSoft?.getChildren?.() || [];
          const dmg = Math.max(1, Math.floor(weapon.damage || 25));
          for (let i = 0; i < arr.length; i += 1) {
            const s = arr[i]; if (!s?.active) continue;
            if (!s.getData('destructible')) continue;
            const sRect = s.getBounds?.() || new Phaser.Geom.Rectangle(s.x - 8, s.y - 8, 16, 16);
            const line = new Phaser.Geom.Line(sx, sy, ex, ey);
            if (Phaser.Geom.Intersects.LineToRectangle(line, sRect)) {
              const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 20;
              const hp1 = hp0 - dmg;
              if (hp1 <= 0) { try { s.destroy(); } catch (_) {} }
              else s.setData('hp', hp1);
              try { impactBurst(this, s.x, s.y, { color: 0x66aaff, size: 'small' }); } catch (_) {}
              break;
            }
          }
        } catch (_) {}

        if (lz.heat >= 1 && !lz.overheat) {
          lz.overheat = true;
          if (hasOverheatCore) {
            try {
              const cx = this.player.x; const cy = this.player.y;
              const radius = 120; const r2 = radius * radius;
              const enemies = this.enemies?.getChildren?.() || [];
              for (let i = 0; i < enemies.length; i += 1) {
                const e = enemies[i]; if (!e?.active) continue;
                const dx = e.x - cx; const dy = e.y - cy;
                if ((dx * dx + dy * dy) > r2) continue;
                if (e.isDummy) {
                  this._dummyDamage = (this._dummyDamage || 0) + 10;
                } else {
                  if (typeof e.hp !== 'number') e.hp = e.maxHp || 20;
                  e.hp -= 10;
                  try { this._flashEnemyHit?.(e); } catch (_) {}
                  if (e.hp <= 0) this.killEnemy(e);
                }
                e._igniteValue = Math.min(10, (e._igniteValue || 0) + 20);
                if ((e._igniteValue || 0) >= 10) {
                  e._ignitedUntil = now + 2000;
                  e._igniteValue = 0;
                  if (!e._igniteIndicator) {
                    e._igniteIndicator = this.add.graphics();
                    try { e._igniteIndicator.setDepth(9000); } catch (_) {}
                    e._igniteIndicator.fillStyle(0xff3333, 1).fillCircle(0, 0, 2);
                  }
                  try { e._igniteIndicator.setPosition(e.x, e.y - 14); } catch (_) {}
                }
              }
              // Flame-style burst in a full circle
              pixelSparks(this, cx, cy, {
                angleRad: 0,
                count: 40,
                spreadDeg: 360,
                speedMin: 140,
                speedMax: 360,
                lifeMs: 360,
                color: 0xffaa33,
                size: 4,
                alpha: 0.9,
              });
              // Orange ring to indicate range
              const ring = this.add.graphics({ x: cx, y: cy });
              try { ring.setDepth(9000); ring.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
              ring.lineStyle(3, 0xffaa33, 0.9).strokeCircle(0, 0, radius);
              this.tweens.add({
                targets: ring,
                alpha: 0,
                duration: 320,
                ease: 'Quad.easeOut',
                onComplete: () => { try { ring.destroy(); } catch (_) {} },
              });
            } catch (_) {}
          }
          this.reload.active = true;
          this.reload.duration = this.getActiveReloadMs();
          this.reload.until = now + this.reload.duration;
          this.registry.set('reloadActive', true);
          this.registry.set('reloadProgress', 0);
        }
      } else {
        lz.firing = false;
      }

      // Cooling
      if (!lz.overheat) {
        if (now >= (lz.coolDelayUntil || 0)) {
          lz.heat = Math.max(0, lz.heat - coolFastPerSec * dt);
        }
      } else {
        if (!this.reload.active || now >= this.reload.until) {
          lz.overheat = false;
          lz.heat = 0;
          this.reload.active = false;
          this.reload.duration = 0;
          this.registry.set('reloadActive', false);
          this.registry.set('reloadProgress', 1);
        } else {
          const remaining = Math.max(0, this.reload.until - now);
          const dur = Math.max(1, this.reload.duration || this.getActiveReloadMs());
          const prog = 1 - Math.min(1, remaining / dur);
          this.registry.set('reloadActive', true);
          this.registry.set('reloadProgress', prog);
        }
      }

      this.registry.set('laserHeat', lz.heat);
      this.registry.set('laserOverheated', !!lz.overheat);
      lz._dmrWasDown = !!ptr?.isDown;
      return;
    }
    const heatPerSec = 1 / 6; // overheat in 6s
    const coolDelay = 0.2; // start cooling after 0.2s when not firing
    const coolFastPerSec = 0.75; // fast cool
    const tickRate = 0.1; // damage tick 10 Hz

    // Update heat/overheat state
    if (canFire) {
      if (!lz.firing) { lz.firing = true; lz.startedAt = now; }
      lz.heat = Math.min(1, lz.heat + heatPerSec * dt);
      if (lz.heat >= 1 && !lz.overheat) {
        // Force cooldown using reload bar
        lz.overheat = true;
        this.reload.active = true;
        this.reload.duration = this.getActiveReloadMs();
        this.reload.until = now + this.reload.duration;
        this.registry.set('reloadActive', true);
        this.registry.set('reloadProgress', 0);
      }
    } else {
      if (lz.firing) { lz.firing = false; lz.coolDelayUntil = now + Math.floor(coolDelay * 1000); }
      // cooling
      if (!lz.overheat) {
        if (now >= lz.coolDelayUntil) {
          lz.heat = Math.max(0, lz.heat - coolFastPerSec * dt);
        }
      } else {
        // During overheat, rely on reload to finish
        if (!this.reload.active || now >= this.reload.until) {
          // finish cooldown
          lz.overheat = false;
          lz.heat = 0;
          this.reload.active = false;
          this.reload.duration = 0;
          this.registry.set('reloadActive', false);
          this.registry.set('reloadProgress', 1);
        } else {
          // keep UI reload progress updated
          const remaining = Math.max(0, this.reload.until - now);
          const dur = Math.max(1, this.reload.duration || this.getActiveReloadMs());
          const prog = 1 - Math.min(1, remaining / dur);
          this.registry.set('reloadActive', true);
          this.registry.set('reloadProgress', prog);
        }
      }
    }

    // Update UI registry for heat
    this.registry.set('laserHeat', lz.heat);
    this.registry.set('laserOverheated', !!lz.overheat);

    // Draw and apply damage while firing and not overheated
    lz.g.clear();
    try { lz.mg.clear(); } catch (_) {}
    if (canFire && !lz.overheat) {
      const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, ptr.worldX, ptr.worldY);
      // Start exactly at the barrel tip using weapon sprite + origin
      const muzzle = getWeaponMuzzleWorld(this, 2);
      const sx = muzzle.x;
      const sy = muzzle.y;
      const hit = this.computeLaserEnd(angle, sx, sy);
      const ex = hit.ex, ey = hit.ey; const line = hit.line;
      // Draw blue layered beam (player laser), under weapon layer
      try {
        lz.g.lineStyle(3, 0x66aaff, 0.95).beginPath(); lz.g.moveTo(sx, sy); lz.g.lineTo(ex, ey); lz.g.strokePath();
        lz.g.lineStyle(1, 0xaaddff, 1).beginPath(); lz.g.moveTo(sx, sy - 1); lz.g.lineTo(ex, ey); lz.g.strokePath();
      } catch (_) {}

      // Laser muzzle twitch: larger white split rays (5) with subtle jitter
      try {
        const base = angle + Phaser.Math.DegToRad(Phaser.Math.Between(-3, 3));
        const offs = [-28, -14, 0, 14, 28].map((d) => Phaser.Math.DegToRad(d + Phaser.Math.Between(-3, 3)));
        for (let i = 0; i < offs.length; i += 1) {
          const a = base + offs[i];
          const len = 12 + (i === 2 ? 1 : 0);
          const hx = sx + Math.cos(a) * len;
          const hy = sy + Math.sin(a) * len;
          const thick = (i === 2) ? 2 : 1;
          lz.mg.lineStyle(thick, 0xffffff, 0.55).beginPath(); lz.mg.moveTo(sx, sy); lz.mg.lineTo(hx, hy); lz.mg.strokePath();
        }
        // smaller bloom at muzzle
        lz.mg.fillStyle(0xffffff, 0.5).fillCircle(sx, sy, 1.5);
      } catch (_) {}

      // Shield block spark for laser (if recently blocked by a shield / pulse)
      try {
        const lb = this._lastLaserBlockedAt;
        if (lb && (now - lb.t) <= 50) {
          const col = (typeof lb.color === 'number') ? lb.color : 0xff3333;
          impactBurst(this, lb.x, lb.y, { color: col, size: 'small' });
          this._lastLaserBlockedAt = null;
        }
      } catch (_) {}

      // Damage ticking
      lz.lastTickAt = (lz.lastTickAt || 0);
      lz.lastTickAt += dt;
      if (lz.lastTickAt >= tickRate) {
        const step = lz.lastTickAt; lz.lastTickAt = 0;
        let dps = 30; let ignitePerSec = 8;
        try {
          const w = getEffectiveWeapon(this.gs, this.gs?.activeWeapon);
          const usingHeatReuse = w && w._core === 'laser_heat_reuse';
          if (usingHeatReuse && lz.heat > 0.5) {
            dps *= 2;
            ignitePerSec *= 2;
          }
        } catch (_) {}
        const dmg = Math.max(0, Math.round(dps * step));
        const igniteAdd = ignitePerSec * step;
        // Only apply to the first hit enemy (no penetration)
        const e = hit.hitEnemy;
        if (e && e.active) {
          // Hit VFX on enemy at contact point
          try { impactBurst(this, ex, ey, { color: 0x66aaff, size: 'small' }); } catch (_) {}
          if (e.isDummy) {
            this._dummyDamage = (this._dummyDamage || 0) + dmg;
          } else {
            if (typeof e.hp !== 'number') e.hp = e.maxHp || 20;
            e.hp -= dmg;
            if (e.hp <= 0) { this.killEnemy(e); }
          }
          // Ignite buildup
          e._igniteValue = Math.min(10, (e._igniteValue || 0) + igniteAdd);
          if ((e._igniteValue || 0) >= 10) {
            e._ignitedUntil = this.time.now + 2000;
            e._igniteValue = 0; // reset on trigger
            if (!e._igniteIndicator) {
              e._igniteIndicator = this.add.graphics();
              try { e._igniteIndicator.setDepth(9000); } catch (_) {}
              e._igniteIndicator.fillStyle(0xff3333, 1).fillCircle(0, 0, 2);
            }
            try { e._igniteIndicator.setPosition(e.x, e.y - 14); } catch (_) {}
          }
        }
        // Barricade hit VFX at the beam endpoint (both hard and soft)
        try {
          if (hit.hitKind === 'soft' || hit.hitKind === 'hard') {
            const col = (hit.hitKind === 'soft') ? 0xC8A165 : 0xaaaaaa;
            impactBurst(this, ex, ey, { color: col, size: 'small' });
          }
        } catch (_) {}
        // Damage soft barricades intersecting the beam
        try {
          const arr = this.barricadesSoft?.getChildren?.() || [];
          for (let i = 0; i < arr.length; i += 1) {
            const s = arr[i]; if (!s?.active) continue;
            if (!s.getData('destructible')) continue;
            const sRect = s.getBounds?.() || new Phaser.Geom.Rectangle(s.x - 8, s.y - 8, 16, 16);
            if (Phaser.Geom.Intersects.LineToRectangle(line, sRect)) {
              const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 20;
              const bhp = hp0 - dmg;
              if (bhp <= 0) { try { s.destroy(); } catch (_) {} }
              else s.setData('hp', bhp);
            }
          }
        } catch (_) {}
      }
    } else {
      // not firing: clear beam and muzzle twitch
      lz.g.clear();
      try { lz.mg.clear(); } catch (_) {}
    }
  }

  computeLaserEnd(angle, sxOverride = null, syOverride = null) {
    // Ray from start point (weapon) towards angle; clip to nearest barricade
    const maxLen = 1000;
    const sx = (typeof sxOverride === 'number') ? sxOverride : this.player.x;
    const sy = (typeof syOverride === 'number') ? syOverride : this.player.y;
    const ex0 = sx + Math.cos(angle) * maxLen;
    const ey0 = sy + Math.sin(angle) * maxLen;
    const ray = new Phaser.Geom.Line(sx, sy, ex0, ey0);
    let ex = ex0; let ey = ey0; let bestD2 = Infinity; let hitEnemy = null; let hitKind = null; let hitBarricade = null;
    const testGroups = [this.barricadesHard, this.barricadesSoft];
    for (let gi = 0; gi < testGroups.length; gi += 1) {
      const g = testGroups[gi]; if (!g) continue;
      const arr = g.getChildren?.() || [];
      for (let i = 0; i < arr.length; i += 1) {
        const s = arr[i]; if (!s?.active) continue;
        const rect = s.getBounds?.() || new Phaser.Geom.Rectangle(s.x - 8, s.y - 8, 16, 16);
        const pts = Phaser.Geom.Intersects.GetLineToRectangle(ray, rect);
        if (pts && pts.length) {
          // Choose nearest intersection point to player
          for (let k = 0; k < pts.length; k += 1) {
            const p = pts[k]; const dx = p.x - sx; const dy = p.y - sy; const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) { bestD2 = d2; ex = p.x; ey = p.y; hitKind = (gi === 0) ? 'hard' : 'soft'; hitBarricade = s; hitEnemy = null; }
          }
        }
      }
    }
    // Hazel teleport pulses: treat as circular blockers like moving shields (360闂?
    try {
      const pulses = this._hzPulses || [];
      const dxr = Math.cos(angle), dyr = Math.sin(angle);
      for (let i = 0; i < pulses.length; i += 1) {
        const p = pulses[i]; if (!p || !p.g) continue;
        const cx = p.x, cy = p.y; const r = p.r || 0;
        if (r <= 0) continue;
        const fx = sx - cx, fy = sy - cy; // ray origin relative to pulse center
        const a = dxr * dxr + dyr * dyr;
        const bq = 2 * (fx * dxr + fy * dyr);
        const c = fx * fx + fy * fy - r * r;
        const disc = bq * bq - 4 * a * c;
        if (disc >= 0) {
          const sqrtD = Math.sqrt(disc);
          const t1 = (-bq - sqrtD) / (2 * a);
          const t2 = (-bq + sqrtD) / (2 * a);
          const t = (t1 > 0) ? t1 : ((t2 > 0) ? t2 : null);
          if (t != null) {
            const bx = sx + dxr * t; const by = sy + dyr * t;
            const ddx = bx - sx; const ddy = by - sy; const d2 = ddx * ddx + ddy * ddy;
            if (d2 < bestD2) {
              bestD2 = d2; ex = bx; ey = by; hitEnemy = null; hitKind = 'rook'; hitBarricade = null;
              this._lastLaserBlockedAt = { x: ex, y: ey, t: this.time.now, color: 0xaa66ff };
            }
          }
        }
      }
    } catch (_) {}
    // Also stop at first enemy before barricade; handle Rook shield as a blocker
    const enemies = this.enemies?.getChildren?.() || [];
    for (let i = 0; i < enemies.length; i += 1) {
      const e = enemies[i]; if (!e?.active) continue;
      // Rook shield: treat 90闂?arc as obstacle if facing the beam source
      if (e.isRook) {
        try {
          const r = (e._shieldRadius || 60);
          const gap = 35; const off = (gap - r);
          const cx = e.x + Math.cos(e._shieldAngle || 0) * off;
          const cy = e.y + Math.sin(e._shieldAngle || 0) * off;
          const dirToSource = Math.atan2(sy - cy, sx - cx);
          const shieldAng = e._shieldAngle || 0;
          const diff = Math.abs(Phaser.Math.Angle.Wrap(dirToSource - shieldAng));
          const half = Phaser.Math.DegToRad(45);
          if (diff <= half) {
            // Intersect ray with shield radius circle around Rook
            // r from above
            const dxr = Math.cos(angle), dyr = Math.sin(angle);
            const fx = sx - cx, fy = sy - cy; // ray origin relative to shield center
            const a = dxr * dxr + dyr * dyr;
            const bq = 2 * (fx * dxr + fy * dyr);
            const c = fx * fx + fy * fy - r * r;
            const disc = bq * bq - 4 * a * c;
            if (disc >= 0) {
              const sqrtD = Math.sqrt(disc);
              const t1 = (-bq - sqrtD) / (2 * a);
              const t2 = (-bq + sqrtD) / (2 * a);
              const t = (t1 > 0) ? t1 : ((t2 > 0) ? t2 : null);
              if (t != null) {
                const bx = sx + dxr * t; const by = sy + dyr * t;
                const ddx = bx - sx; const ddy = by - sy; const d2 = ddx * ddx + ddy * ddy;
                if (d2 < bestD2) {
                  bestD2 = d2; ex = bx; ey = by; hitEnemy = null; hitKind = 'rook'; hitBarricade = null;
                  this._lastLaserBlockedAt = { x: ex, y: ey, t: this.time.now, color: 0xff3333 };
                }
              }
            }
          }
        } catch (_) {}
      }
      // Standard enemy rect hit if not blocked closer
      // For bosses, compute rect from physics body/hitbox so laser matches boss hit area
      let rect;
      if (e.isBoss) {
        try {
          const hb = (e._hitbox && e._hitbox.body) ? e._hitbox.body : e.body;
          const w = Math.max(1, Math.floor((hb && hb.width) ? hb.width : 36));
          const h = Math.max(1, Math.floor((hb && hb.height) ? hb.height : 36));
          rect = new Phaser.Geom.Rectangle(Math.floor(e.x - w / 2), Math.floor(e.y - h / 2), w, h);
        } catch (_) {
          rect = new Phaser.Geom.Rectangle(e.x - 18, e.y - 18, 36, 36);
        }
      } else {
        rect = e.getBounds?.() || new Phaser.Geom.Rectangle(e.x - 6, e.y - 6, 12, 12);
      }
      const pts = Phaser.Geom.Intersects.GetLineToRectangle(ray, rect);
      if (pts && pts.length) {
        for (let k = 0; k < pts.length; k += 1) {
          const p = pts[k]; const dx = p.x - sx; const dy = p.y - sy; const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) { bestD2 = d2; ex = p.x; ey = p.y; hitEnemy = e; hitKind = null; hitBarricade = null; }
        }
      }
    }
    return { ex, ey, line: new Phaser.Geom.Line(sx, sy, ex, ey), hitEnemy, hitKind, hitBarricade };
  }

  // Spawn a temporary fire field that applies ignite to enemies inside
  spawnFireField(x, y, radius, durationMs = 4000) {
    if (!this._firefields) this._firefields = [];
    // Additive glow
    const g = this.add.graphics();
    try { g.setDepth(7000); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
    // Rising embers via particles
    let pm = null; let em = null;
    try {
      const texKey = 'fire_particle';
      if (!this.textures || !this.textures.exists(texKey)) {
        const tg = this.make.graphics({ x: 0, y: 0, add: false });
        tg.clear();
        tg.fillStyle(0xffdd66, 1).fillCircle(6, 6, 3);
        tg.fillStyle(0xff9933, 0.9).fillCircle(6, 6, 5);
        tg.fillStyle(0xff5522, 0.5).fillCircle(6, 6, 6);
        tg.generateTexture(texKey, 12, 12);
        tg.destroy();
      }
      pm = this.add.particles(texKey);
      try { pm.setDepth(7050); } catch (_) {}
      const zone = new Phaser.Geom.Circle(x, y, Math.max(6, Math.floor(radius * 0.85)));
      em = pm.createEmitter({
        emitZone: { type: 'random', source: zone },
        frequency: 35,
        quantity: 3,
        lifespan: { min: 400, max: 900 },
        speedY: { min: -70, max: -25 },
        speedX: { min: -30, max: 30 },
        alpha: { start: 0.95, end: 0 },
        scale: { start: 0.9, end: 0 },
        gravityY: -30,
        tint: [0xffdd66, 0xffbb55, 0xff9933, 0xff5522],
        blendMode: Phaser.BlendModes.ADD,
      });
    } catch (_) {}
    // Initial draw
    try {
      g.clear();
      const inner = Math.max(4, Math.floor(radius * 0.55));
      g.fillStyle(0xff6622, 0.22).fillCircle(x, y, inner);
      g.fillStyle(0xffaa33, 0.14).fillCircle(x, y, Math.floor(radius * 0.85));
      g.lineStyle(2, 0xffaa33, 0.5).strokeCircle(x, y, radius);
    } catch (_) {}
    // Add an initial orange pixel spark burst (matches railgun/muzzle pixel effect)
    try {
      const bases = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
      for (let i = 0; i < bases.length; i += 1) {
        const base = bases[i] + Phaser.Math.FloatBetween(-0.2, 0.2);
        pixelSparks(this, x, y, { angleRad: base, count: 6, spreadDeg: 38, speedMin: 80, speedMax: 160, lifeMs: 220, color: 0xffaa66, size: 2, alpha: 0.95 });
      }
    } catch (_) {}
    const obj = { x, y, r: radius, until: this.time.now + durationMs, g, pm, em, _pulse: 0 };
    this._firefields.push(obj);
    return obj;
  }

  // Player bullet hits a barricade
  onPlayerBulletHitBarricade(b, s) {
    if (!b || !s || !b.active) return;
    // Railgun: pierce both soft and hard barricades while still chipping them once per bullet.
    if (b._rail) {
      try {
        if (!b._barrHitSet) b._barrHitSet = new Set();
        if (b._barrHitSet.has(s)) return;
        b._barrHitSet.add(s);
        const isSoft = !!s.getData('destructible');
        const dmg = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 10;
        if (isSoft) {
          const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 20;
          const hp1 = hp0 - dmg;
          try { impactBurst(this, b.x, b.y, { color: 0xC8A165, size: 'small' }); } catch (_) {}
          if (hp1 <= 0) { try { s.destroy(); } catch (_) {} } else { s.setData('hp', hp1); }
        } else {
          // Hard barricades: tiny impact VFX but never destroyed by a single rail hit here.
          try { impactBurst(this, b.x, b.y, { color: 0xC8A165, size: 'tiny' }); } catch (_) {}
        }
      } catch (_) {}
      // Do not destroy or stop the rail bullet.
      return;
    }
    // Caustic Cluster: detonate on contact and spawn clusters if primary
    if (b._cc || b._ccCluster) {
      const ex = b.x; const ey = b.y; const r = b._blastRadius || 60; const r2 = r * r;
      try { impactBurst(this, ex, ey, { color: 0x33ff66, size: 'large', radius: r }); } catch (_) {}
      // AoE damage to enemies in radius
      try {
        const arr = this.enemies?.getChildren?.() || [];
        for (let i = 0; i < arr.length; i += 1) {
          const e = arr[i]; if (!e?.active) continue; const dx = e.x - ex; const dy = e.y - ey;
          if ((dx * dx + dy * dy) <= r2) {
            const dmg = b._aoeDamage || 5; if (e.isDummy) { this._dummyDamage = (this._dummyDamage || 0) + dmg; }
            else { if (typeof e.hp !== 'number') e.hp = e.maxHp || 20; e.hp -= dmg; if (e.hp <= 0) { this.killEnemy(e); } }
          }
        }
      } catch (_) {}
      // Toxin field (6s)
      try { this.spawnToxinField(ex, ey, r, 6000, 20); } catch (_) {}
      // Spawn clusters if primary
      if (b._cc) {
        const count = 5; const minD = Math.max(60, Math.floor(r * 1.2)); const maxD = Math.max(minD + 1, Math.floor(r * 2.0));
        for (let i = 0; i < count; i += 1) {
          const base = (i / count) * Math.PI * 2; const jitter = Phaser.Math.FloatBetween(-0.25, 0.25); const ang = base + jitter;
 const dist = Phaser.Math.Between(Math.max(8, Math.floor(r * 1.30)), Math.max(Math.max(8, Math.floor(r * 1.30)) + 1, Math.floor(r * 1.80))); const spd = 420; const vx2 = Math.cos(ang) * spd; const vy2 = Math.sin(ang) * spd;
          const c = this.bullets.get(ex, ey, 'bullet'); if (!c) continue;
          c.setActive(true).setVisible(true); c.setCircle(4).setOffset(-4, -4); try { c.setScale(1.1); } catch (_) {}
          c.setVelocity(vx2, vy2); c.setTint(0x33ff66); c._ccCluster = true; c._startX = ex; c._startY = ey; c._travelMax2 = dist * dist; c._blastRadius = r; c._aoeDamage = 5;
          c.update = () => {
            try {
              const mx = c.x - c._startX; const my = c.y - c._startY; let collide2 = false;
              // Early detonation on barricade contact
              try {
                const scanBarr = (grp) => {
                  const arr2 = grp?.getChildren?.() || [];
                  for (let k = 0; k < arr2.length && !collide2; k += 1) {
                    const s2 = arr2[k]; if (!s2?.active) continue;
                    const rectB = s2.getBounds?.() || new Phaser.Geom.Rectangle(s2.x - 8, s2.y - 8, 16, 16);
                    if (Phaser.Geom.Intersects.CircleToRectangle(new Phaser.Geom.Circle(c.x, c.y, 6), rectB)) { collide2 = true; break; }
                  }
                };
                scanBarr(this.barricadesHard); scanBarr(this.barricadesSoft);
              } catch (_) {}
              if ((mx * mx + my * my) >= c._travelMax2 || collide2) {
                const cx = c.x; const cy = c.y; const rr = c._blastRadius || 60; const r2c = rr * rr;
                try { impactBurst(this, cx, cy, { color: 0x33ff66, size: 'large', radius: rr }); } catch (_) {}
                try { this.spawnToxinField(cx, cy, rr, 6000, 20); } catch (_) {}
                try { const list = this.enemies?.getChildren?.() || []; for (let m = 0; m < list.length; m += 1) { const t = list[m]; if (!t?.active) continue; const ddx = t.x - cx; const ddy = t.y - cy; if ((ddx * ddx + ddy * ddy) <= r2c) { const dmg2 = c._aoeDamage || 5; if (t.isDummy) { this._dummyDamage = (this._dummyDamage || 0) + dmg2; } else { if (typeof t.hp !== 'number') t.hp = t.maxHp || 20; t.hp -= dmg2; if (t.hp <= 0) { this.killEnemy(t); } } } } } catch (_) {}
                try { c.destroy(); } catch (_) {}
              }
            } catch (_) { try { c.destroy(); } catch (__ ) {} }
          };
        }
      }
      try { if (b._g) { b._g.destroy(); b._g = null; } } catch (_) {}
      try { b.destroy(); } catch (_) {}
      return;
    }
    // Default player bullet behavior on barricade: explosive rockets already handled at overlap, others simply destroy
    try { if (b._g) { b._g.destroy(); b._g = null; } } catch (_) {}
    try { b.destroy(); } catch (_) {}
  }

  // Spawn a temporary toxin field that applies toxin buildup to enemies inside
  spawnToxinField(x, y, radius, durationMs = 5000, toxinPerSec = 20) {
    if (!this._toxfields) this._toxfields = [];
    const g = this.add.graphics();
    try { g.setDepth(7000); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
    // Green mist particles
    let pm = null; let em = null;
    try {
      const texKey = 'toxin_particle';
      if (!this.textures || !this.textures.exists(texKey)) {
        const tg = this.make.graphics({ x: 0, y: 0, add: false });
        tg.clear();
        tg.fillStyle(0x99ffcc, 1).fillCircle(6, 6, 3);
        tg.fillStyle(0x55ff99, 0.9).fillCircle(6, 6, 5);
        tg.fillStyle(0x22aa66, 0.5).fillCircle(6, 6, 6);
        tg.generateTexture(texKey, 12, 12);
        tg.destroy();
      }
      pm = this.add.particles(texKey);
      try { pm.setDepth(7050); } catch (_) {}
      const zone = new Phaser.Geom.Circle(x, y, Math.max(6, Math.floor(radius * 0.85)));
      em = pm.createEmitter({
        emitZone: { type: 'random', source: zone },
        frequency: 40,
        quantity: 2,
        lifespan: { min: 500, max: 1000 },
        speedY: { min: -30, max: -10 },
        speedX: { min: -20, max: 20 },
        alpha: { start: 0.9, end: 0 },
        scale: { start: 0.8, end: 0 },
        gravityY: -20,
        tint: [0x99ffcc, 0x66ff99, 0x33ff66, 0x22aa66],
        blendMode: Phaser.BlendModes.ADD,
      });
    } catch (_) {}
    try {
      g.clear();
      const inner = Math.max(4, Math.floor(radius * 0.55));
      g.fillStyle(0x22aa66, 0.22).fillCircle(x, y, inner);
      g.fillStyle(0x33ff66, 0.14).fillCircle(x, y, Math.floor(radius * 0.85));
      g.lineStyle(2, 0x33ff66, 0.5).strokeCircle(x, y, radius);
    } catch (_) {}
    // Initial green pixel spark burst (match fire field, tinted green)
    try {
      const bases = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
      for (let i = 0; i < bases.length; i += 1) {
        const base = bases[i] + Phaser.Math.FloatBetween(-0.2, 0.2);
        pixelSparks(this, x, y, { angleRad: base, count: 6, spreadDeg: 38, speedMin: 80, speedMax: 160, lifeMs: 220, color: 0x66ff99, size: 2, alpha: 0.95 });
      }
    } catch (_) {}
    const obj = { x, y, r: radius, until: this.time.now + 6000, g, pm, em, toxPerSec: toxinPerSec, _pulse: 0 };
    if (!this._toxTickAccum) this._toxTickAccum = 0;
    this._toxfields.push(obj);
    return obj;
  }

  // Ability: Caustic Cluster Grenade
  deployCausticCluster() {
    const startX = this.player.x; const startY = this.player.y;
    const targetX = this.inputMgr.pointer.worldX; const targetY = this.inputMgr.pointer.worldY;
    const angle = Phaser.Math.Angle.Between(startX, startY, targetX, targetY);
    const speed = 360; // mid-flight speed similar to rockets
    const vx = Math.cos(angle) * speed; const vy = Math.sin(angle) * speed;
    const b = this.bullets.get(startX, startY, 'bullet');
    if (!b) return;
    b.setActive(true).setVisible(true);
    b.setCircle(5).setOffset(-5, -5);
    try { b.setScale(1.3); } catch (_) {}
    b.setVelocity(vx, vy);
    b.setTint(0x33ff66);
    b._cc = true; b._startX = startX; b._startY = startY; b._targetX = targetX; b._targetY = targetY;
    b._blastRadius = 60; // > MGL (52) and < Rocket (70)
    b._aoeDamage = 5;
    b.update = () => {
      try {
        const dx = b.x - b._startX; const dy = b.y - b._startY;
        const tx = b._targetX - b._startX; const ty = b._targetY - b._startY;
        const reached = (dx * dx + dy * dy) >= (tx * tx + ty * ty);
        // Collision with enemies or barricades triggers detonation
        let collide = false;
        let hitBossOnContact = false;
        try {
          const enemies = this.enemies?.getChildren?.() || [];
          for (let i = 0; i < enemies.length; i += 1) {
            const e = enemies[i]; if (!e?.active) continue;
            let rect;
            if (e.isBoss) {
              try {
                const hb = (e._hitbox && e._hitbox.body) ? e._hitbox.body : e.body;
                const w = Math.max(1, Math.floor((hb && hb.width) ? hb.width : 36));
                const h = Math.max(1, Math.floor((hb && hb.height) ? hb.height : 36));
                rect = new Phaser.Geom.Rectangle(Math.floor(e.x - w / 2), Math.floor(e.y - h / 2), w, h);
              } catch (_) {
                rect = new Phaser.Geom.Rectangle(e.x - 18, e.y - 18, 36, 36);
              }
            } else {
              rect = e.getBounds?.() || new Phaser.Geom.Rectangle(e.x - 6, e.y - 6, 12, 12);
            }
            if (Phaser.Geom.Intersects.CircleToRectangle(new Phaser.Geom.Circle(b.x, b.y, 6), rect)) { collide = true; hitBossOnContact = !!e.isBoss; break; }
          }
        } catch (_) {}
        try {
          const scanBarr = (grp) => {
            const arr = grp?.getChildren?.() || [];
            for (let i = 0; i < arr.length && !collide; i += 1) {
              const s = arr[i]; if (!s?.active) continue;
              const rect = s.getBounds?.() || new Phaser.Geom.Rectangle(s.x - 8, s.y - 8, 16, 16);
              if (Phaser.Geom.Intersects.CircleToRectangle(new Phaser.Geom.Circle(b.x, b.y, 6), rect)) { collide = true; break; }
            }
          };
          scanBarr(this.barricadesHard); scanBarr(this.barricadesSoft);
        } catch (_) {}
        if (reached || collide) {
          const ex = b.x; const ey = b.y; const r = b._blastRadius || 60;
          try { impactBurst(this, ex, ey, { color: 0x33ff66, size: 'large', radius: r }); } catch (_) {}
          // AoE damage
          try {
            const r2 = r * r; const arr = this.enemies?.getChildren?.() || [];
            for (let i = 0; i < arr.length; i += 1) {
              const e = arr[i]; if (!e?.active) continue;
              const ddx = e.x - ex; const ddy = e.y - ey; if ((ddx * ddx + ddy * ddy) <= r2) {
                const dmg = b._aoeDamage || 5;
                if (e.isDummy) { this._dummyDamage = (this._dummyDamage || 0) + dmg; }
                else { if (typeof e.hp !== 'number') e.hp = e.maxHp || 20; e.hp -= dmg; if (e.hp <= 0) { this.killEnemy(e); } }
              }
            }
          } catch (_) {}
          // Toxin field spawn
          try { this.spawnToxinField(ex, ey, r, 6000, 20); } catch (_) {}
          // Spawn 5 cluster bomblets
          const count = 5; const minD = Math.max(60, Math.floor(r * 1.2)); const maxD = Math.max(minD + 1, Math.floor(r * 2.0));
          for (let i = 0; i < count; i += 1) {
            const base = (i / count) * Math.PI * 2; const jitter = Phaser.Math.FloatBetween(-0.25, 0.25);
             const ang = base + jitter;
 const dist = Phaser.Math.Between(Math.max(8, Math.floor(r * 1.30)), Math.max(Math.max(8, Math.floor(r * 1.30)) + 1, Math.floor(r * 1.80)));
             const spd = 420; const vx2 = Math.cos(ang) * spd; const vy2 = Math.sin(ang) * spd;
             const c = this.bullets.get(ex, ey, 'bullet'); if (!c) continue;
             c.setActive(true).setVisible(true); c.setCircle(4).setOffset(-4, -4); try { c.setScale(1.1); } catch (_) {}
             c.setVelocity(vx2, vy2); c.setTint(0x33ff66); c._ccCluster = true; c._startX = ex; c._startY = ey; c._travelMax2 = dist * dist; c._blastRadius = r; c._aoeDamage = 5; c._ignoreBossForTravel = hitBossOnContact;
             c.update = () => {
               try {
                 const mx = c.x - c._startX; const my = c.y - c._startY; let collide2 = false;
                 // Collision early with enemies/barricades
                 try {
                      const enemies2 = this.enemies?.getChildren?.() || [];
                      for (let k = 0; k < enemies2.length; k += 1) {
                        const e2 = enemies2[k]; if (!e2?.active) continue;
                        if (e2.isBoss && c._ignoreBossForTravel) continue;
                      let rect2;
                      if (e2.isBoss) {
                        try {
                          const hb2 = (e2._hitbox && e2._hitbox.body) ? e2._hitbox.body : e2.body;
                          const w2 = Math.max(1, Math.floor((hb2 && hb2.width) ? hb2.width : 36));
                          const h2 = Math.max(1, Math.floor((hb2 && hb2.height) ? hb2.height : 36));
                          rect2 = new Phaser.Geom.Rectangle(Math.floor(e2.x - w2 / 2), Math.floor(e2.y - h2 / 2), w2, h2);
                        } catch (_) {
                          rect2 = new Phaser.Geom.Rectangle(e2.x - 18, e2.y - 18, 36, 36);
                        }
                      } else {
                        rect2 = e2.getBounds?.() || new Phaser.Geom.Rectangle(e2.x - 6, e2.y - 6, 12, 12);
                      }
                      if (Phaser.Geom.Intersects.CircleToRectangle(new Phaser.Geom.Circle(c.x, c.y, 6), rect2)) { collide2 = true; break; }
                    }
                  } catch (_) {}
                try {
                  const barricades2 = this.barricades?.getChildren?.() || [];
                  for (let k = 0; k < barricades2.length && !collide2; k += 1) {
                    const s2 = barricades2[k]; if (!s2?.active) continue;
                    const rectB = s2.getBounds?.() || new Phaser.Geom.Rectangle(s2.x - 8, s2.y - 8, 16, 16);
                    if (Phaser.Geom.Intersects.CircleToRectangle(new Phaser.Geom.Circle(c.x, c.y, 6), rectB)) { collide2 = true; break; }
                  }
                } catch (_) {}
                if ((mx * mx + my * my) >= c._travelMax2 || collide2) {
                  const cx = c.x; const cy = c.y; const rr = c._blastRadius || 60; const r2c = rr * rr;
                  try { impactBurst(this, cx, cy, { color: 0x33ff66, size: 'large', radius: rr }); } catch (_) {}
                  try { this.spawnToxinField(cx, cy, rr, 6000, 20); } catch (_) {}
                  try {
                    const arr2 = this.enemies?.getChildren?.() || [];
                    for (let m = 0; m < arr2.length; m += 1) {
                      const t = arr2[m]; if (!t?.active) continue; const ddx = t.x - cx; const ddy = t.y - cy; if ((ddx * ddx + ddy * ddy) <= r2c) {
                        const dmg2 = c._aoeDamage || 5; if (t.isDummy) { this._dummyDamage = (this._dummyDamage || 0) + dmg2; } else { if (typeof t.hp !== 'number') t.hp = t.maxHp || 20; t.hp -= dmg2; if (t.hp <= 0) { this.killEnemy(t); } }
                      }
                    }
                  } catch (_) {}
                  try { c.destroy(); } catch (_) {}
                }
              } catch (_) { try { c.destroy(); } catch (__ ) {} }
            };
          }
          try { b.destroy(); } catch (_) {}
        }
      } catch (_) { try { b.destroy(); } catch (__ ) {} }
      // Cull if off-screen
      const view = this.cameras?.main?.worldView; if (view && !view.contains(b.x, b.y)) { try { b.destroy(); } catch (_) {} }
    };
  }

  // Ability: Landmine Dispenser
  deployLandmineDispenser() {
    const x = this.player.x, y = this.player.y;
    // Visual-only dispenser (no physics/collision)
    let disp = null;
    try { disp = createFittedImage(this, x, y, 'ability_landmine', 20); } catch (_) {}
    if (disp) { try { disp.setDepth(8000); } catch (_) {} }
    // Ensure container for mines
    if (!this._mines) this._mines = [];
    const count = 10; const full = Math.PI * 2; const step = full / count;
    const startAng = -Math.PI / 2; // start upward, clockwise placement
    const placeOne = (i) => {
      const ang = startAng + i * step; // clockwise by incrementing i
      const spd = 260; // initial outward speed until blocked
      const vx = Math.cos(ang) * spd; const vy = Math.sin(ang) * spd;
      const mine = this.physics.add.image(x, y, 'bullet');
      mine.setActive(true).setVisible(true);
      // Visual: white box while flying/unarmed
      try { mine.setTint(0xffffff); } catch (_) {}
      try { mine.setScale(1.1); } catch (_) {}
      // Keep square hitbox; slightly larger for stable collisions
      try { mine.body.setSize(6, 6, true); } catch (_) {}
      mine.setVelocity(vx, vy);
      // State for legacy global handler
      mine._armed = false;
      mine._armingUntil = 0;
      // 50px trigger radius, 70px explosion radius
      mine._detRadius = 50;
      mine._blastRadius = 70;
      mine._dmg = 30;
      mine._stunVal = 20;
      mine._ox = x;
      mine._oy = y;
      mine._ang = ang;
      mine._speed = spd;
      const stopR = 120;
      mine._travelMax2 = stopR * stopR;
      // Colliders: if a mine hits enemies/barricades/walls before max range, stop it and begin arming delay
      const onCollideAndArm = () => {
        if (mine._armed || (mine._armingUntil && mine._armingUntil > 0)) return;
        try {
          mine.setVelocity(0, 0);
          mine.body.setVelocity(0, 0);
          mine.body.moves = false;
          mine.body.setImmovable(true);
        } catch (_) {}
        mine._armingUntil = this.time.now + 500; // 0.5s before becoming armed
      };
      try { this.physics.add.collider(mine, this.enemies, () => onCollideAndArm()); } catch (_) {}
      try { if (this.walls) this.physics.add.collider(mine, this.walls, () => onCollideAndArm()); } catch (_) {}
      try {
        if (this.barricadesHard) this.physics.add.collider(mine, this.barricadesHard, () => onCollideAndArm());
        if (this.barricadesSoft) this.physics.add.collider(mine, this.barricadesSoft, () => onCollideAndArm());
      } catch (_) {}
      // Track mines globally; movement/arming handled in update()
      if (!this._mines) this._mines = [];
      this._mines.push(mine);
      // Bind per-mine explosion handler to avoid first-use undefined refs
      mine._explodeFn = (m) => {
        if (!m?.active) return;
        const ex = m.x; const ey = m.y; const r = m._blastRadius || 70; const r2 = r * r;
        // Explosion VFX: match actual blast radius (70px)
        try { impactBurst(this, ex, ey, { color: 0xffaa33, size: 'large', radius: r }); } catch (_) {}
        // Damage + stun enemies (no friendly fire)
        try {
          const arr2 = this.enemies?.getChildren?.() || [];
          const nowS = this.time.now;
          for (let i2 = 0; i2 < arr2.length; i2 += 1) {
            const e2 = arr2[i2]; if (!e2?.active || e2.isDummy) continue;
            const dx2 = e2.x - ex; const dy2 = e2.y - ey; if ((dx2 * dx2 + dy2 * dy2) <= r2) {
              let dmg2 = m._dmg || 30; if (typeof e2.hp !== 'number') e2.hp = e2.maxHp || 20; e2.hp -= dmg2; if (e2.hp <= 0) { this.killEnemy?.(e2); }
              // Apply stun accumulation (20 -> guaranteed stun)
              e2._stunValue = Math.min(10, (e2._stunValue || 0) + (m._stunVal || 0));
              if ((e2._stunValue || 0) >= 10) { e2._stunnedUntil = nowS + 200; e2._stunValue = 0; }
            }
          }
        } catch (_) {}
        try {
          m._armG?.destroy();
          m._armG = null;
        } catch (_) {}
        try { m.destroy(); } catch (_) {}
      };
    };
    // Timed emission clockwise
    for (let i = 0; i < count; i += 1) { this.time.delayedCall(i * 90, () => placeOne(i)); }
    // Cleanup dispenser sprite after emission
    if (disp) this.time.delayedCall(count * 90 + 200, () => { try { disp.destroy(); } catch (_) {} });
    // Scene-level helper retained for compatibility (not used by mines directly)
    this._explodeMine = (mine) => { try { mine?._explodeFn?.(mine); } catch (_) {} };
  }

  // Dandelion assault melee: separate hook so it can diverge from default boss melee later
  _performDandelionAssaultMelee(boss) {
    if (!boss || !this.player) return;
    try {
      // Mirror standard boss melee exactly: same VFX, cone, range, damage, and i-frames.
      const e = boss;
      const cfg = e._bossMeleeCfg || { range: 90, half: Phaser.Math.DegToRad(75), wind: 250, sweep: 90, recover: 650 };
      const px = this.player.x; const py = this.player.y;
      const dx = px - e.x; const dy = py - e.y;
      const facing = Math.atan2(dy, dx);
      // Alternate start angle just like the shared boss melee
      e._bmAlt = !e._bmAlt;
      // Use the same slash VFX as boss melee/Rook: 150闂?cone, 90ms duration, red
      try { this.spawnMeleeVfx(e, facing, 150, 90, 0xff3333, cfg.range, e._bmAlt); } catch (_) {}
      // Damage tick at ~45ms with same geometry and damage rules
      this.time.delayedCall(45, () => {
        if (!this.player?.active || !e.active) return;
        const pdx = this.player.x - e.x; const pdy = this.player.y - e.y;
        const dd = Math.hypot(pdx, pdy) || 1;
        const angP = Math.atan2(pdy, pdx);
        const diff = Math.abs(Phaser.Math.Angle.Wrap(angP - facing));
        if (dd <= cfg.range && diff <= cfg.half) {
          const dmg = (e.damage || 10);
          if (this.time.now >= (this.player.iframesUntil || 0)) {
            try { this.applyPlayerDamage(dmg); } catch (_) {}
            // Same short melee-specific i-frames as standard boss melee
            this.player.iframesUntil = this.time.now + 75;
            try { impactBurst(this, this.player.x, this.player.y, { color: 0xff3333, size: 'small' }); } catch (_) {}
          }
        }
      });
    } catch (_) {}
  }

  // Spawn a stationary Dandelion mine at (x, y)
  _spawnDandelionMine(x, y) {
    try {
      const mine = this.physics.add.image(x, y, 'bullet');
      mine.setVisible(false);
      mine.body.allowGravity = false;
      mine.setImmovable(true);
      mine.body.setVelocity(0, 0);
      mine.isDnMine = true;
      mine.isEnemy = true;
      mine.hp = 10;
      mine.maxHp = 10;
      mine._sensorRadius = 50;
      mine._blastRadius = 70;
      mine._sensorTriggered = false;
      mine._sensorTriggerAt = 0;
      // 12x12 square hitbox centered on mine for physics
      try { mine.setSize(12, 12).setOffset(-6, -6); } catch (_) {}
      // Ensure lasers and any getBounds-based checks see a 12x12 box as well
      try {
        mine.getBounds = () => new Phaser.Geom.Rectangle(mine.x - 6, mine.y - 6, 12, 12);
      } catch (_) {}
      // Add to enemies group so bullets and abilities can damage it
      try { this.enemies?.add?.(mine); } catch (_) {}
      // Explosion handler: only damages player and soft barricades
      mine._explodeFn = (m) => {
        if (!m?.active) return;
        const ex = m.x; const ey = m.y;
        const r = m._blastRadius || 70; const r2 = r * r;
        // Universal enemy explosion VFX
        try { impactBurst(this, ex, ey, { color: 0xff5533, size: 'large', radius: r }); } catch (_) {}
        // Damage player
        try {
          const pdx = this.player.x - ex; const pdy = this.player.y - ey;
          if ((pdx * pdx + pdy * pdy) <= r2) {
            let dmg = 30;
            try {
              const mods = this.gs?.getDifficultyMods?.() || {};
              const mul = (typeof mods.enemyDamage === 'number') ? mods.enemyDamage : 1;
              dmg = Math.max(1, Math.round(dmg * mul));
            } catch (_) {}
            const now = this.time.now;
            if (now >= (this.player.iframesUntil || 0)) {
              try { this.applyPlayerDamage(dmg); } catch (_) {}
              // Mirror enemy bullet behaviour: if HP is now 0 or below, end run and return to Hub
              try {
                if (this.gs && (this.gs.hp | 0) <= 0) {
                  const eff = getPlayerEffects(this.gs);
                  this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
                  this.gs.nextScene = SceneKeys.Hub;
                  SaveManager.saveToLocal(this.gs);
                  this.scene.start(SceneKeys.Hub);
                }
              } catch (_) {}
            }
          }
        } catch (_) {}
        // Damage soft barricades only
        try {
          const soft = this.barricadesSoft?.getChildren?.() || [];
          for (let i = 0; i < soft.length; i += 1) {
            const s = soft[i]; if (!s?.active) continue;
            const dx = s.x - ex; const dy = s.y - ey;
            if ((dx * dx + dy * dy) <= r2) {
              const hp = s.getData('hp');
              if (typeof hp === 'number') {
                const newHp = hp - 30;
                s.setData('hp', newHp);
                if (newHp <= 0) {
                  try { s.destroy(); } catch (_) {}
                }
              }
            }
          }
        } catch (_) {}
        try { m._g?.destroy(); } catch (_) {}
        m._g = null;
        try { m.destroy(); } catch (_) {}
      };
      // Track mines for sensor logic
      if (!this._dnMines) this._dnMines = [];
      this._dnMines.push(mine);
      return mine;
    } catch (_) {
      return null;
    }
  }

  // Spawn a Dandelion mine with Hazel-style purple teleport/phase VFX first,
  // then materialize the red mine after a short delay. Mine behavior is unchanged.
  _spawnDandelionMineWithVfx(x, y) {
    try {
      try { teleportSpawnVfx(this, x, y, { color: 0xaa66ff }); } catch (_) {}
      this.time.delayedCall(250, () => {
        try { this._spawnDandelionMine?.(x, y); } catch (_) {}
      });
    } catch (_) {}
  }

  // Destroy any soft barricades that Dandelion is currently overlapping during a dash
  _dandelionBreakSoftBarricades(boss) {
    try {
      if (!boss || !this.barricadesSoft) return;
      const arr = this.barricadesSoft.getChildren?.() || [];
      const r = 18; const r2 = r * r;
      for (let i = 0; i < arr.length; i += 1) {
        const s = arr[i]; if (!s?.active) continue;
        const dx = s.x - boss.x; const dy = s.y - boss.y;
        if ((dx * dx + dy * dy) <= r2) {
          const hp = s.getData('hp');
          if (typeof hp === 'number') {
            const newHp = hp - 9999;
            s.setData('hp', newHp);
            if (newHp <= 0) {
              try { s.destroy(); } catch (_) {}
            }
          }
        }
      }
    } catch (_) {}
  }
}
















































































    // Reset per-room boss reference to avoid stale state across restarts




