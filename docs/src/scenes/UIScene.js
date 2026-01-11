import { SceneKeys } from '../core/SceneKeys.js';
import { HpBar } from '../ui/HpBar.js';
import { ShieldBar } from '../ui/ShieldBar.js';
import { DashBar } from '../ui/DashBar.js';
import { HeatBar } from '../ui/HeatBar.js';
import { makeTextButton } from '../ui/Buttons.js';
import { SaveManager } from '../core/SaveManager.js';
import { getPlayerEffects } from '../core/Loadout.js';
import { weaponMods, weaponCores, armourMods, armourDefs } from '../core/Mods.js';
import { abilityDefs, getAbilityById } from '../core/Abilities.js';
import { weaponDefs, getWeaponById } from '../core/Weapons.js';
import { bitSpawnRing } from '../systems/Effects.js';

export default class UIScene extends Phaser.Scene {
  constructor() { super(SceneKeys.UI); }

  create() {
    const { width, height } = this.scale;
    // Place combat UI along the bottom
    const uiHpY = Math.max(12, height - 28);
    const uiDashY = Math.max(8, height - 22);
    const dashXStart = 16 + 180 + 20;
    // Shield bar sits above HP bar (same width, slightly thicker)
    this.shieldBar = new ShieldBar(this, 16, uiHpY - 8, 180, 8);
    this.hpBar = new HpBar(this, 16, uiHpY, 180, 16);
    this.goldText = this.add.text(210, 8, 'Gold: 0 | Drone Cores: 0', { fontFamily: 'monospace', fontSize: 14, color: '#ffffff' });
    // Boss UI: centered top name + HP bar (white outline, red fill)
    this.bossNameText = this.add.text(width / 2, 34, '', { fontFamily: 'monospace', fontSize: 22, color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5, 0.5);
    try { this.bossNameText.setStroke('#000000', 3); } catch (_) {}
    this.bossBarG = this.add.graphics();
    this.bossNameText.setVisible(false);
    this.dashBar = new DashBar(this, dashXStart, uiDashY, 14, 4);
    // Weapon label positioned to the right of the dash bar; will be refined in update()
    const gs0 = this.registry.get('gameState');
    const maxC0 = gs0?.dashMaxCharges ?? 3;
    const dashWidth0 = maxC0 * (this.dashBar.size + this.dashBar.gap);
    const weaponX0 = dashXStart + dashWidth0 + 20;
    const uiTextY = Math.max(8, height - 32);
    this.weaponText = this.add.text(weaponX0, uiTextY, 'Weapon: -', { fontFamily: 'monospace', fontSize: 18, color: '#ffff66' }).setOrigin(0, 0);
    this.ammoText = this.add.text(weaponX0 + 180, uiTextY + 2, 'Ammo: -/-', { fontFamily: 'monospace', fontSize: 16, color: '#ffffff' }).setOrigin(0, 0);
    // Heat bar sits where ammo would be, shown only for laser
    this.heatBar = new HeatBar(this, weaponX0 + 180, uiTextY + 6, 120, 6);
    this.heatLabel = this.add.text(weaponX0 + 180, uiTextY - 8, 'HEAT', { fontFamily: 'monospace', fontSize: 10, color: '#ff6666' }).setOrigin(0, 0);
    this.heatBar.setVisible(false); this.heatLabel.setVisible(false);
    // Ability label + cooldown square
    // Ability label starts near the bottom-right, just left of the movement/keybind hints in CombatScene
    const abilityX0 = Math.max(16, width - 320);
    this.abilityText = this.add.text(abilityX0, uiTextY + 2, 'Ability: -', { fontFamily: 'monospace', fontSize: 14, color: '#66aaff' }).setOrigin(0, 0);
    this.abilityG = this.add.graphics();
    // Resource toast stack (top of screen)
    this._resourceToasts = [];
    // Dash/ability UI helper state
    this._dashSlotLevels = [];
    this._abilityGlows = [];
    this._abilityNextGlowAt = 0;
    this._abilityWasReady = false;
    this._abilityRingWasReady = false;

    // HP hit vignette overlay (red screen-edge flash when HP is damaged)
    try {
      const g = this.add.graphics();
      g.setScrollFactor(0);
      g.setDepth(9999);
      g.setVisible(false);
      this.hpHitOverlay = g;
      this.hpHitTween = null;
    } catch (_) {
      this.hpHitOverlay = null;
      this.hpHitTween = null;
    }
    // Shield hit vignette overlay (blue, very subtle)
    try {
      const g2 = this.add.graphics();
      g2.setScrollFactor(0);
      g2.setDepth(9998);
      g2.setVisible(false);
      this.shieldHitOverlay = g2;
      this.shieldHitTween = null;
    } catch (_) {
      this.shieldHitOverlay = null;
      this.shieldHitTween = null;
    }

    // Reload bar graphics (lazy show/hide during reload)
    this.reloadBar = { g: null, tween: null, wasActive: false };
    // Hint to open loadout with Tab (top-left)
    this.loadoutHint = this.add.text(12, 12, 'Loadout (TAB)', { fontFamily: 'monospace', fontSize: 12, color: '#cccccc' }).setOrigin(0, 0).setAlpha(0.9);
    

    const saveBaseX = width - 240;
    this._saveButtons = [];
    const registerSaveButton = (label, handler, offset) => {
      const btn = makeTextButton(this, saveBaseX + offset, 16, label, handler).setOrigin(0, 0);
      if (typeof btn.setButtonVisible === 'function') btn.setButtonVisible(false); else btn.setVisible(false);
      this._saveButtons.push(btn);
      return btn;
    };
    registerSaveButton('Save', () => {
      const gs = this.registry.get('gameState');
      if (gs) SaveManager.saveToLocal(gs);
    }, 0);
    registerSaveButton('Download', () => {
      const gs = this.registry.get('gameState');
      if (gs) SaveManager.download(gs);
    }, 70);
    registerSaveButton('Load', async () => {
      const gs = await SaveManager.uploadFromFile();
      if (gs) {
        this.registry.set('gameState', gs);
        SaveManager.saveToLocal(gs);
        // If we're in the Hub, refresh its view of GameState and Hub labels
        try {
          const hub = this.scene.get(SceneKeys.Hub);
          if (hub && typeof hub.refreshFromGameState === 'function') hub.refreshFromGameState();
        } catch (_) {}
      }
    }, 170);
    this._saveButtonsVisible = null;
    this._refreshSaveButtons = () => {
      const shouldShow = this.scene.isActive(SceneKeys.Hub);
      if (shouldShow === this._saveButtonsVisible) return;
      this._saveButtonsVisible = shouldShow;
      (this._saveButtons || []).forEach((btn) => {
        if (typeof btn.setButtonVisible === 'function') btn.setButtonVisible(shouldShow);
        else {
          btn.setVisible(shouldShow);
          if (shouldShow) btn.setInteractive({ useHandCursor: true }); else btn.disableInteractive();
          if (btn.buttonFrame) btn.buttonFrame.setVisible(shouldShow);
        }
      });
    };
    this._refreshSaveButtons();
    this.events.on('update', this._refreshSaveButtons);

    // Loadout overlay state and keybind
    this.loadout = { panel: null, nodes: [] };
    this.shop = { panel: null, nodes: [], activeCat: 'weapons' };
    this.choicePopup = null;
    this.keys = this.input.keyboard.addKeys({ tab: 'TAB' });

    this.events.on('shutdown', () => {
      this.shieldBar.destroy();
      this.hpBar.destroy();
      this.dashBar.destroy();
      this.closeLoadout();
      this.closeChoicePopup();
      try { (this._resourceToasts || []).forEach((t) => t?.destroy?.()); this._resourceToasts = []; } catch (_) {}
      this._dashSlotLevels = [];
      // Cleanup any ability glow graphics
      try { (this._abilityGlows || []).forEach((g) => { try { g?.g?.destroy?.(); } catch (_) {} }); } catch (_) {}
      this._abilityGlows = [];
      if (this._refreshSaveButtons) {
        this.events.off('update', this._refreshSaveButtons);
        this._refreshSaveButtons = null;
      }
    });
  }

  // Show a brief red vignette when the player takes HP damage (not just shield)
  showHpHitVfx() {
    try {
      if (!this.hpHitOverlay) return;
      const g = this.hpHitOverlay;
      // Stop any existing tween and reset alpha
      if (this.hpHitTween) {
        try { this.hpHitTween.stop(); } catch (_) {}
        this.hpHitTween = null;
      }
      const w = this.scale.width;
      const h = this.scale.height;
      g.clear();
      const base = Math.min(w, h);
      const outer = Math.max(8, Math.floor(base * 0.05));
      const inner = Math.max(4, Math.floor(outer * 0.5));
      // Outer soft band
      g.fillStyle(0xff0000, 0.26);
      g.fillRect(0, 0, w, outer);
      g.fillRect(0, h - outer, w, outer);
      g.fillRect(0, 0, outer, h);
      g.fillRect(w - outer, 0, outer, h);
      // Inner feather band
      g.fillStyle(0xff0000, 0.12);
      g.fillRect(0, outer, w, inner);
      g.fillRect(0, h - outer - inner, w, inner);
      g.fillRect(outer, 0, inner, h);
      g.fillRect(w - outer - inner, 0, inner, h);
      g.setVisible(true);
      // Fade out quickly
      this.hpHitTween = this.tweens.add({
        targets: g,
        alpha: { from: 1, to: 0 },
        duration: 180,
        ease: 'Quad.easeOut',
        onComplete: () => {
          try {
            g.setVisible(false);
            g.setAlpha(1);
            g.clear();
          } catch (_) {}
          this.hpHitTween = null;
        },
      });
    } catch (_) {}
  }

  // Very subtle blue vignette when only shield takes damage
  showShieldHitVfx() {
    try {
      if (!this.shieldHitOverlay) return;
      const g = this.shieldHitOverlay;
      if (this.shieldHitTween) {
        try { this.shieldHitTween.stop(); } catch (_) {}
        this.shieldHitTween = null;
      }
      const w = this.scale.width;
      const h = this.scale.height;
      g.clear();
      const base = Math.min(w, h);
      const outer = Math.max(6, Math.floor(base * 0.04));
      const inner = Math.max(3, Math.floor(outer * 0.5));
      // Outer soft band (blue, low alpha)
      g.fillStyle(0x66aaff, 0.18);
      g.fillRect(0, 0, w, outer);
      g.fillRect(0, h - outer, w, outer);
      g.fillRect(0, 0, outer, h);
      g.fillRect(w - outer, 0, outer, h);
      // Inner feather band (even lower alpha)
      g.fillStyle(0x66aaff, 0.06);
      g.fillRect(0, outer, w, inner);
      g.fillRect(0, h - outer - inner, w, inner);
      g.fillRect(outer, 0, inner, h);
      g.fillRect(w - outer - inner, 0, inner, h);
      g.setVisible(true);
      this.shieldHitTween = this.tweens.add({
        targets: g,
        alpha: { from: 1, to: 0 },
        duration: 150,
        ease: 'Quad.easeOut',
        onComplete: () => {
          try {
            g.setVisible(false);
            g.setAlpha(1);
            g.clear();
          } catch (_) {}
          this.shieldHitTween = null;
        },
      });
    } catch (_) {}
  }

  update() {
    // Recompute viewport metrics each frame for responsive UI
    const { width, height } = this.scale;
    const gs = this.registry.get('gameState');
    if (gs) {
      const eff = getPlayerEffects(gs);
      const effectiveMax = (gs.maxHp || 0) + (eff.bonusHp || 0);
      this.hpBar.draw(gs.hp, effectiveMax);
      // Draw shield above HP (use gs.shield/shieldMax)
      // Use precise shield value so small regen shows immediately
      const sCur = Math.max(0, gs.shield || 0);
      const sMax = Math.max(0, Math.floor(gs.shieldMax || 0));
      this.shieldBar.draw(sCur, sMax);
      const dc = (typeof gs.droneCores === 'number') ? gs.droneCores : 0;
      this.goldText.setText(`Gold: ${gs.gold} | Drone Cores: ${dc}`);
      const wName = (getWeaponById(gs.activeWeapon)?.name || gs.activeWeapon);
      this.weaponText.setText(`Weapon: ${wName}`);
        const charges = this.registry.get('dashCharges');
        const progress = this.registry.get('dashRegenProgress') ?? 0;
        const maxC = gs.dashMaxCharges ?? 3;
        const c = (charges === undefined || charges === null) ? maxC : charges;
        this.dashBar.draw(c, maxC, progress);
        // Dash ready ring per slot when it becomes full
        try {
          const prev = Array.isArray(this._dashSlotLevels) ? this._dashSlotLevels : [];
          const cur = [];
          for (let i = 0; i < maxC; i += 1) {
            let level = 0;
            if (i < c) level = 1;
            else if (i === c && c < maxC) {
              const p = Math.max(0, Math.min(1, progress));
              level = p;
            }
            cur[i] = level;
            const was = (typeof prev[i] === 'number') ? prev[i] : level;
            if (was < 1 && level === 1) {
              const sx = this.dashBar.x + i * (this.dashBar.size + this.dashBar.gap);
              const cx = sx + this.dashBar.size / 2;
              const cy = this.dashBar.y + this.dashBar.size / 2;
              try {
                bitSpawnRing(this, cx, cy, {
                  color: 0x99ccff,
                  radius: 12,
                  lineWidth: 3,
                  duration: 360,
                  scaleTarget: 2.0,
                });
              } catch (_) {}
            }
          }
          this._dashSlotLevels = cur;
        } catch (_) {}
      // Keep the weapon label visually next to the dash bar and at the bottom
      const dashX = 16 + 180 + 20;
      const dashWidth = maxC * (this.dashBar.size + this.dashBar.gap);
      const uiTextY = Math.max(8, this.scale.height - 32);
      const wx = dashX + dashWidth + 20;
      this.weaponText.setPosition(wx, uiTextY);
      const ammoInMag = this.registry.get('ammoInMag');
      const magSize = this.registry.get('magSize');
      const ammoStr = (typeof ammoInMag === 'number' && typeof magSize === 'number') ? `${ammoInMag}/${magSize}` : '-/-';
      this.ammoText.setText(`Ammo: ${ammoStr}`);
      this.ammoText.setPosition(wx + 180, uiTextY + 2);
      // Heat bar for laser
      const wDef = getWeaponById(gs.activeWeapon);
      const isLaser = !!wDef?.isLaser;
      this.ammoText.setVisible(!isLaser);
      this.heatBar.setVisible(isLaser);
      this.heatLabel.setVisible(isLaser);
      if (isLaser) {
        const heat = this.registry.get('laserHeat') ?? 0;
        const overheated = !!this.registry.get('laserOverheated');
        this.heatBar.x = wx + 180; this.heatBar.y = uiTextY + 6;
        this.heatLabel.setPosition(wx + 180, uiTextY - 8);
        this.heatBar.draw(heat, overheated);
      }
      // Boss UI draw
      try {
        const active = !!this.registry.get('bossActive');
        const inCinematic = !!this.registry.get('cinematicActive');
        if (active && !inCinematic) {
          const name = this.registry.get('bossName') || '';
          const cur = Math.max(0, this.registry.get('bossHp') || 0);
          const max = Math.max(1, this.registry.get('bossHpMax') || 1);
          this.bossNameText.setText(String(name));
          this.bossNameText.setVisible(true);
          // Draw centered bar below the name
          const barW = Math.min(280, Math.floor(width * 0.6));
          const barH = 14;
          const bx = Math.floor((width - barW) / 2);
          const by = 48;
          const pct = Math.max(0, Math.min(1, cur / max));
          const fillW = Math.floor((barW - 4) * pct);
          this.bossBarG.clear();
          this.bossBarG.lineStyle(2, 0xffffff, 1);
          this.bossBarG.strokeRect(bx, by, barW, barH);
          this.bossBarG.fillStyle(0xff3333, 1);
          this.bossBarG.fillRect(bx + 2, by + 2, fillW, barH - 4);
        } else {
          this.bossNameText.setVisible(false);
          this.bossBarG.clear();
        }
      } catch (_) {}
      // Ability label + cooldown box
      try {
        const abilityName = (getAbilityById(gs.abilityId)?.name || '-');
          // Anchor ability label near bottom-right, just left of movement/keybind hints
          const ax = Math.max(16, this.scale.width - 320); const ay = uiTextY + 2;
        this.abilityText.setText(`Ability: ${abilityName}`);
        this.abilityText.setPosition(ax, ay);
        // Draw cooldown box next to label
        const b = this.abilityText.getBounds();
        const bx = Math.floor(b.right + 8);
        const by = Math.floor(ay + 2);
        const size = 14;
            const prog = this.registry.get('abilityCooldownProgress');
            const progVal = (typeof prog === 'number' ? prog : 1);
            const w = Math.max(0, Math.min(size, Math.floor(progVal * size)));
            this.abilityG.clear();
            // Border
            this.abilityG.lineStyle(1, 0xffffff, 1).strokeRect(bx + 0.5, by + 0.5, size, size);
            // Fill proportional to cooldown progress
            if (w > 0) {
              this.abilityG.fillStyle(0x66aaff, 0.9).fillRect(bx + 1, by + 1, w - 1, size - 2);
            }
            // Ability ready ring: single blue spawn-ring when ability becomes ready
            try {
              const ringReady = progVal >= 1;
              if (typeof this._abilityRingWasReady !== 'boolean') this._abilityRingWasReady = ringReady;
              if (ringReady && !this._abilityRingWasReady) {
                const hubActive = !!this.scene?.isActive?.(SceneKeys.Hub);
                if (!hubActive) {
                  const cx = bx + size / 2;
                  const cy = by + size / 2;
                  bitSpawnRing(this, cx, cy, {
                    color: 0x99ccff,
                    radius: 12,
                    lineWidth: 3,
                    duration: 360,
                    scaleTarget: 2.0,
                  });
                }
              }
              this._abilityRingWasReady = ringReady;
            } catch (_) {}
          // Ability ready glow: recurring Hazel-style pulse when off cooldown
          try {
            const now = this.time?.now || (this.game?.loop?.now ?? 0);
            const ready = progVal >= 1;
            if (!Array.isArray(this._abilityGlows)) this._abilityGlows = [];
            if (typeof this._abilityNextGlowAt !== 'number') this._abilityNextGlowAt = now + 2800;
            if (ready) {
              if (!this._abilityWasReady) {
                // Immediately allow a glow when becoming ready
                this._abilityNextGlowAt = now;
              }
              const hubActive = !!this.scene?.isActive?.(SceneKeys.Hub);
              if (!hubActive && now >= (this._abilityNextGlowAt || 0)) {
                const cx = bx + size / 2;
                const cy = by + size / 2;
                const gGlow = this.add.graphics({ x: cx, y: cy });
                try {
                  gGlow.setDepth(9001);
                  gGlow.setBlendMode(Phaser.BlendModes.ADD);
                } catch (_) {}
                this._abilityGlows.push({ g: gGlow, createdAt: now, baseSize: size * 1.15 });
                this._abilityNextGlowAt = now + 2800;
              }
              this._abilityWasReady = true;
            } else {
              this._abilityWasReady = false;
              this._abilityNextGlowAt = now + 1500;
            }
          } catch (_) {}
        } catch (_) {}

      // Reload bar handling
      const reloading = !!this.registry.get('reloadActive');
      const rprog = this.registry.get('reloadProgress') ?? 0;
      if (reloading) {
        if (!this.reloadBar.wasActive) this.startReloadBar();
        this.drawReloadBar(rprog);
        this.reloadBar.wasActive = true;
      } else {
        // If just finished, play expand+fade then hide
        if (this.reloadBar.wasActive) {
          this.reloadBar.wasActive = false;
          this.finishReloadBar();
        }
      }
      // Keep highlights in sync: each mod line yellow if that slot has a mod; core line if core equipped;
      // weapon slots if equipped; armour equip + armour mods similarly.
      if (this.loadout?.panel && (this.loadout.modLabels || this.loadout.weaponLabels || this.loadout.armourLabel || this.loadout.armourModLabels)) {
        try {
          const wb = gs.weaponBuilds && gs.weaponBuilds[gs.activeWeapon];
          const hasCore = !!(wb && wb.core);
          (this.loadout.modLabels || []).forEach((lbl, i) => {
            const hasMod = !!(wb && wb.mods && wb.mods[i]);
            lbl?.setStyle({ color: hasMod ? '#ffff33' : '#cccccc' });
          });
          if (this.loadout.coreLabel) this.loadout.coreLabel.setStyle({ color: hasCore ? '#ffff33' : '#cccccc' });
          // Weapon slots
          const slots = gs.equippedWeapons || [];
          (this.loadout.weaponLabels || []).forEach((lbl, i) => {
            const hasW = !!slots[i];
            lbl?.setStyle({ color: hasW ? '#ffff33' : '#cccccc' });
          });
          // Armour equip + mods
          if (this.loadout.armourLabel) this.loadout.armourLabel.setStyle({ color: (gs.armour && gs.armour.id) ? '#ffff33' : '#cccccc' });
          (this.loadout.armourModLabels || []).forEach((lbl, i) => {
            const hasAm = !!(gs.armour && gs.armour.mods && gs.armour.mods[i]);
            lbl?.setStyle({ color: hasAm ? '#ffff33' : '#cccccc' });
          });
        } catch (e) { /* no-op */ }
      }

        // Update ability glow pulses (Hazel-style square glow near ability when ready)
        try {
          if (this._abilityGlows && this._abilityGlows.length) {
            const now = this.time?.now || (this.game?.loop?.now ?? 0);
            const lifeTotal = 900; // ms
            const phaseSplit = 540;
            this._abilityGlows = this._abilityGlows.filter((entry) => {
              if (!entry || !entry.g) return false;
              const g = entry.g;
              const age = now - (entry.createdAt || 0);
              if (age >= lifeTotal) {
                try { g.destroy(); } catch (_) {}
                return false;
              }
              const baseSize = entry.baseSize || 14;
              try {
                g.clear();
                if (age < phaseSplit) {
                  // First phase: soft blue, slower pulse
                  const t = age / phaseSplit;
                  const pulse = 1.0 + 0.14 * Math.sin(t * Math.PI * 2.0);
                  const size = baseSize * pulse;
                  g.fillStyle(0x66aaff, 0.6);
                  g.fillRect(-size / 2, -size / 2, size, size);
                } else {
                  // Second phase: lighter blue, faster pulse and slight growth
                  const t = (age - phaseSplit) / (lifeTotal - phaseSplit);
                  const pulse = 1.0 + 0.24 * Math.sin(t * Math.PI * 6.0);
                  const size = baseSize * (1.08 + 0.22 * t) * pulse;
                  g.fillStyle(0x99ccff, 0.75);
                  g.fillRect(-size / 2, -size / 2, size, size);
                }
              } catch (_) {}
              return true;
            });
          }
        } catch (_) {}

        // If HP hit overlay is visible and no tween is managing it, ensure geometry matches screen size
      if (this.hpHitOverlay && this.hpHitOverlay.visible && !this.hpHitTween) {
        const w = this.scale.width;
        const h = this.scale.height;
        const base = Math.min(w, h);
        const outer = Math.max(8, Math.floor(base * 0.05));
        const inner = Math.max(4, Math.floor(outer * 0.5));
        this.hpHitOverlay.clear();
        // Outer, softer band
        this.hpHitOverlay.fillStyle(0xff0000, 0.2);
        this.hpHitOverlay.fillRect(0, 0, w, outer);
        this.hpHitOverlay.fillRect(0, h - outer, w, outer);
        this.hpHitOverlay.fillRect(0, 0, outer, h);
        this.hpHitOverlay.fillRect(w - outer, 0, outer, h);
        // Inner, very subtle band to feather toward the center
        this.hpHitOverlay.fillStyle(0xff0000, 0.08);
        this.hpHitOverlay.fillRect(0, outer, w, inner);
        this.hpHitOverlay.fillRect(0, h - outer - inner, w, inner);
        this.hpHitOverlay.fillRect(outer, 0, inner, h);
        this.hpHitOverlay.fillRect(w - outer - inner, 0, inner, h);
      }
      // Keep shield hit overlay responsive as well (very subtle blue frame)
      if (this.shieldHitOverlay && this.shieldHitOverlay.visible && !this.shieldHitTween) {
        const w = this.scale.width;
        const h = this.scale.height;
        const base = Math.min(w, h);
        const outer = Math.max(6, Math.floor(base * 0.04));
        const inner = Math.max(3, Math.floor(outer * 0.5));
        this.shieldHitOverlay.clear();
        this.shieldHitOverlay.fillStyle(0x66aaff, 0.14);
        this.shieldHitOverlay.fillRect(0, 0, w, outer);
        this.shieldHitOverlay.fillRect(0, h - outer, w, outer);
        this.shieldHitOverlay.fillRect(0, 0, outer, h);
        this.shieldHitOverlay.fillRect(w - outer, 0, outer, h);
        this.shieldHitOverlay.fillStyle(0x66aaff, 0.05);
        this.shieldHitOverlay.fillRect(0, outer, w, inner);
        this.shieldHitOverlay.fillRect(0, h - outer - inner, w, inner);
        this.shieldHitOverlay.fillRect(outer, 0, inner, h);
        this.shieldHitOverlay.fillRect(w - outer - inner, 0, inner, h);
      }
    }

    

    // Toggle loadout overlay with Tab
    if (Phaser.Input.Keyboard.JustDown(this.keys.tab)) {
      if (this.loadout.panel) this.closeLoadout(); else this.openLoadout();
    }
  }

  drawReloadBar(progress) {
    const w = 240; const h = 6; // thinner
    const cx = Math.floor(this.scale.width / 2);
    // higher up from bottom
    const cy = Math.max(40, this.scale.height - 80);
    if (!this.reloadBar.g) {
      this.reloadBar.g = this.add.graphics();
      this.reloadBar.g.setDepth(1000);
      this.reloadBar.g.setPosition(cx, cy);
      this.reloadBar.g.setAlpha(1);
      this.reloadBar.g.setScale(1, 1);
    }
    const g = this.reloadBar.g;
    g.clear();
    // Track/background (thin outline)
    g.lineStyle(1, 0xffffff, 0.8);
    g.strokeRect(-w / 2, -h / 2, w, h);
    g.fillStyle(0xffffff, 0.9);
    const fillW = Math.floor((Math.max(0, Math.min(1, progress))) * (w - 4));
    if (fillW > 0) g.fillRect(-w / 2 + 2, -h / 2 + 2, fillW, h - 4);
    g.setPosition(cx, cy);
    g.setVisible(true);
  }

  startReloadBar() {
    const w = 240; const h = 6;
    const cx = Math.floor(this.scale.width / 2);
    const cy = Math.max(40, this.scale.height - 80);
    if (!this.reloadBar.g) {
      this.reloadBar.g = this.add.graphics();
      this.reloadBar.g.setDepth(1000);
    }
    const g = this.reloadBar.g;
    try { this.tweens.killTweensOf(g); } catch (_) {}
    g.clear();
    g.setPosition(cx, cy);
    g.setVisible(true);
    g.setAlpha(0);
    g.setScale(0.96, 0.8);
    // Initial frame (blank track)
    g.lineStyle(1, 0xffffff, 0.8);
    g.strokeRect(-w / 2, -h / 2, w, h);
    this.reloadBar.tween = this.tweens.add({
      targets: g,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: 160,
      ease: 'quad.out',
    });
  }

  finishReloadBar() {
    const g = this.reloadBar.g;
    if (!g) return;
    try { this.tweens.killTweensOf(g); } catch (_) {}
    this.reloadBar.tween = this.tweens.add({
      targets: g,
      scaleX: 1.12,
      scaleY: 1.18,
      alpha: 0,
      duration: 180,
      onComplete: () => {
        try {
          g.clear();
          g.setVisible(false);
          g.setAlpha(1);
          g.setScale(1, 1);
        } catch (_) {}
      },
    });
  }

  openLoadout() {
    const gs = this.registry.get('gameState');
    if (!gs || this.loadout.panel) return;
    const { width, height } = this.scale;
      const nodes = [];
      // Full-screen input blocker so clicks don't hit underlying scenes/UI while loadout is open
      const blocker = this.add.zone(0, 0, width, height).setOrigin(0, 0).setInteractive();
      nodes.push(blocker);
    const panel = this.add.graphics();

    // 3-column layout panel
    const desiredW = 780; const desiredH = 520; const margin = 16;
    const panelW = Math.min(desiredW, Math.max(520, width - margin * 2));
    const panelH = Math.min(desiredH, Math.max(320, height - margin * 2));
    const top = Math.max(margin, Math.floor((height - panelH) / 2));
    const left = Math.floor((width - panelW) / 2);
    panel.fillStyle(0x111111, 0.92).fillRect(left, top, panelW, panelH);
    panel.lineStyle(2, 0xffffff, 1).strokeRect(left, top, panelW, panelH);
    nodes.push(this.add.text(width / 2, top + 12, 'Loadout & Stats (Tab to close)', { fontFamily: 'monospace', fontSize: 18, color: '#ffffff' }).setOrigin(0.5));
    // Close button in top-right corner of loadout panel
    const closeX = left + panelW - 40;
    const closeY = top + 18;
    nodes.push(makeTextButton(this, closeX, closeY, 'X', () => {
      this.closeLoadout();
    }));

    // Columns (Stats removed)
    const col2X = left + 40;    // Weapons + Mods/Core (wider)
    const col3X = left + 420;   // Armour

    // Weapons (Column 2)
    let y2 = top + 56;
    nodes.push(this.add.text(col2X, y2, 'Weapons', { fontFamily: 'monospace', fontSize: 16, color: '#ffffff' })); y2 += 28;
    const slotLine = (slotIdx) => {
      const wy = y2; y2 += 32;
      const getName = () => {
        const id = gs.equippedWeapons[slotIdx];
        return id ? (getWeaponById(id)?.name || id) : '-';
      };
      const label = this.add.text(col2X, wy, `Slot ${slotIdx + 1}: ${getName()}`, { fontFamily: 'monospace', fontSize: 14, color: '#cccccc' });
      nodes.push(label);
      try { this.loadout.weaponLabels[slotIdx] = label; label.setStyle({ color: (gs.equippedWeapons && gs.equippedWeapons[slotIdx]) ? '#ffff33' : '#cccccc' }); } catch (e) {}
      const btn = makeTextButton(this, col2X + 210, wy + 8, 'Choose', () => {
        const equipped = Array.isArray(gs.equippedWeapons) ? gs.equippedWeapons : [];
        const list = (gs.ownedWeapons || [])
          .filter((id) => {
            // Prevent equipping the same weapon in multiple slots:
            // allow the current slot's weapon, but exclude weapons already equipped in other slots.
            const others = equipped.filter((_, idx) => idx !== slotIdx);
            return !others.includes(id);
          })
          .map((id) => {
            const w = getWeaponById(id) || { id, name: id };
            // Loadout menu: show only the verbal description (no stat lines)
            const descOnly = w.desc ? String(w.desc).split('\n').map((s) => `(desc) ${s}`).join('\n') : '';
            return ({ id: w.id, name: w.name, desc: descOnly });
          });
        if (!list.length) return;
        const current = gs.equippedWeapons[slotIdx] || null;
        this.openChoicePopup(`Choose Weapon (Slot ${slotIdx + 1})`, list, current, (chosenId) => {
          const prev = gs.equippedWeapons[slotIdx];
          gs.equippedWeapons[slotIdx] = chosenId;
          if (gs.activeWeapon === prev) gs.activeWeapon = chosenId;
          label.setText(`Slot ${slotIdx + 1}: ${getName()}`);
          try { label.setStyle({ color: chosenId ? '#ffff33' : '#cccccc' }); } catch (e) {}
          SaveManager.saveToLocal(gs);
          // If active weapon changed as a result of this slot update, rebuild the loadout UI
          try {
            if (gs.activeWeapon === chosenId && typeof this.reopenLoadout === 'function') {
              this.time.delayedCall(0, () => { this.reopenLoadout(); });
            }
          } catch (_) {}
        });
      }).setOrigin(0, 0.5);
      nodes.push(btn);
    };
    slotLine(0);
    slotLine(1);
    y2 += 16;
    const makeActive = makeTextButton(this, col2X, y2, `Active: ${(getWeaponById(gs.activeWeapon)?.name || gs.activeWeapon)}`, () => {
      const opts = (gs.equippedWeapons || []).filter(Boolean).map((id) => ({ id, name: getWeaponById(id)?.name || id }));
      if (!opts.length) return;
      this.openChoicePopup('Set Active Weapon', opts, gs.activeWeapon, (chosenId) => {
        gs.activeWeapon = chosenId;
        makeActive.setText(`Active: ${(getWeaponById(gs.activeWeapon)?.name || gs.activeWeapon)}`);
        SaveManager.saveToLocal(gs);
        // Rebuild mods/core section to reflect the newly active weapon
        try { this.time.delayedCall(0, () => { this.reopenLoadout?.(); }); } catch (e) { try { this.reopenLoadout?.(); } catch (_) {} }
      });
    }).setOrigin(0, 0.5);
    nodes.push(makeActive);
    y2 += 40;

    // Mods/Core for Active Weapon (Column 2)
    if (!gs.weaponBuilds[gs.activeWeapon]) gs.weaponBuilds[gs.activeWeapon] = { mods: [null, null, null], core: null };
    const activeWeaponName = getWeaponById(gs.activeWeapon)?.name || gs.activeWeapon;
    nodes.push(this.add.text(col2X, y2, `Mods for ${activeWeaponName}`, { fontFamily: 'monospace', fontSize: 16, color: '#ffffff' })); y2 += 28;
    const ensureBuild = () => { if (!gs.weaponBuilds[gs.activeWeapon]) gs.weaponBuilds[gs.activeWeapon] = { mods: [null, null, null], core: null }; };
    // Sanitize any legacy mod ids that were moved to cores (e.g., w_smg_toxin, w_rifle_incendiary)
    try {
      const banned = new Set(['w_smg_toxin', 'w_rifle_incendiary']);
      const modsArr = gs.weaponBuilds[gs.activeWeapon].mods || [];
      let changed = false;
      for (let i = 0; i < modsArr.length; i += 1) {
        if (banned.has(modsArr[i])) { modsArr[i] = null; changed = true; }
      }
      // Enforce: unique mods and only one magazine mod per weapon
      const seen = new Set();
      let magTaken = false;
      for (let i = 0; i < modsArr.length; i += 1) {
        const id = modsArr[i];
        if (!id) continue;
        if (seen.has(id)) { modsArr[i] = null; changed = true; continue; }
        const isMag = String(id).startsWith('w_mag_');
        if (isMag) {
          if (magTaken) { modsArr[i] = null; changed = true; continue; }
          magTaken = true;
        }
        seen.add(id);
      }
      if (changed) { gs.weaponBuilds[gs.activeWeapon].mods = modsArr; SaveManager.saveToLocal(gs); }
    } catch (_) {}
    this.loadout.modLabels = [];
    const modLine = (idx) => {
      const wy = y2; y2 += 30;
      const getName = () => {
        const id = gs.weaponBuilds[gs.activeWeapon].mods[idx];
        const m = weaponMods.find((x) => x.id === id) || weaponMods[0];
        return m.name;
      };
      const hasMod = !!(gs.weaponBuilds[gs.activeWeapon].mods[idx]);
      const label = this.add.text(col2X, wy, `Mod ${idx + 1}: ${getName()}`, { fontFamily: 'monospace', fontSize: 14, color: hasMod ? '#ffff33' : '#cccccc' });
      nodes.push(label);
      this.loadout.modLabels.push(label);
      const btn = makeTextButton(this, col2X + 210, wy + 8, 'Choose', () => {
        ensureBuild();
        const activeId = gs.activeWeapon;
        const baseW = getWeaponById(activeId) || {};
        const owned = new Set((gs.ownedWeaponMods || []).filter(Boolean));
        const opts = weaponMods
          .filter((m) => !m.onlyFor || m.onlyFor === activeId)
          .filter((m) => !m.allow || m.allow(baseW))
          .filter((m) => m.id !== 'w_smg_toxin' && m.id !== 'w_rifle_incendiary')
          .filter((m) => (m.id === null) || owned.has(m.id))
          // Prevent choosing duplicates and second magazine mod
          .filter((m) => {
            const others = (gs.weaponBuilds[gs.activeWeapon].mods || []).filter((_, j) => j !== idx);
            const selectedSet = new Set(others.filter(Boolean));
            const hasMag = others.some((mm) => typeof mm === 'string' && mm.startsWith('w_mag_'));
            if (m.id && selectedSet.has(m.id)) return false;
            if (m.id && String(m.id).startsWith('w_mag_') && hasMag) return false;
            return true;
          })
          .map((m) => {
            // Build footer: if broadly usable, show Not usable on: <exceptions>; else show Usable on: <allowed>
            let usable = [], notUsable = [];
            try {
              (weaponDefs || []).forEach((wd) => {
                if (!wd) return;
                if (m.onlyFor && m.onlyFor !== wd.id) { notUsable.push(wd.name); return; }
                if (typeof m.allow === 'function') { try { if (!m.allow(wd)) { notUsable.push(wd.name); return; } } catch (_) {} }
                usable.push(wd.name);
              });
            } catch (_) {}
            const showNot = usable.length >= notUsable.length;
            const footer = showNot
              ? `Not usable on: ${notUsable.length ? notUsable.join(', ') : 'None'}`
              : `Usable on: ${usable.length ? usable.join(', ') : 'None'}`;
            const desc = (m.desc ? String(m.desc) + '\n' : '') + footer;
            return ({ id: m.id, name: m.name, desc });
          });
        this.openChoicePopup('Choose Mod', opts, gs.weaponBuilds[gs.activeWeapon].mods[idx], (chosenId) => {
          gs.weaponBuilds[gs.activeWeapon].mods[idx] = chosenId;
          label.setText(`Mod ${idx + 1}: ${(weaponMods.find((m) => m.id === chosenId) || weaponMods[0]).name}`);
          const hasModNow = !!chosenId;
          label.setStyle({ color: hasModNow ? '#ffff33' : '#cccccc' });
          SaveManager.saveToLocal(gs);
        });
      }).setOrigin(0, 0.5);
      nodes.push(btn);
    };
    modLine(0); modLine(1); modLine(2);
    const coreWy = y2; y2 += 34;
    try {
      const savedCore = gs.weaponBuilds[gs.activeWeapon].core || null;
      const exists = weaponCores.some((c) => c.id === savedCore);
      const looksLikeMod = typeof savedCore === 'string' && savedCore.startsWith('w_');
      if (savedCore && (!exists || looksLikeMod)) { gs.weaponBuilds[gs.activeWeapon].core = null; SaveManager.saveToLocal(gs); }
    } catch (_) {}
    const coreLabel = this.add.text(col2X, coreWy, `Core: ${(weaponCores.find((c) => c.id === (gs.weaponBuilds[gs.activeWeapon].core || null)) || weaponCores[0]).name}`, { fontFamily: 'monospace', fontSize: 14, color: (!!gs.weaponBuilds[gs.activeWeapon].core) ? '#ffff33' : '#cccccc' }); nodes.push(coreLabel); this.loadout.coreLabel = coreLabel;
    const coreBtn = makeTextButton(this, col2X + 210, coreWy + 8, 'Choose', () => {
      ensureBuild();
      const activeId = gs.activeWeapon;
      const baseW = getWeaponById(activeId) || {};
      const isExplosive = baseW.projectile === 'rocket';
      const ownedC = new Set((gs.ownedWeaponCores || []).filter(Boolean));
      const opts = weaponCores
        .filter((c) => !c.onlyFor || c.onlyFor === activeId)
        .filter((c) => !(c.id === 'core_blast' && isExplosive))
        .filter((c) => !c.allow || c.allow(baseW))
        .filter((c) => !String(c.id || '').startsWith('w_'))
        .filter((c) => (c.id === null) || ownedC.has(c.id))
        .map((c) => {
          // For Piercing/Explosive cores show Not usable on:, others show Usable on:
          let desc = '';
          if (c && (c.id === 'core_pierce' || c.id === 'core_blast')) {
            let notUsable = [];
            try {
              notUsable = (weaponDefs || []).filter((wd) => {
                if (!wd) return false;
                if (c.onlyFor && c.onlyFor !== wd.id) return true;
                if (typeof c.allow === 'function') { try { if (!c.allow(wd)) return true; } catch (_) {} }
                return false;
              }).map((wd) => wd.name);
            } catch (_) {}
            const listStr = notUsable.length ? notUsable.join(', ') : 'None';
            desc = (c.desc ? String(c.desc) + '\n' : '') + `Not usable on: ${listStr}`;
          } else {
            const forName = c.onlyFor ? (getWeaponById(c.onlyFor)?.name || c.onlyFor) : 'Multiple';
            desc = (c.desc ? String(c.desc) + '\n' : '') + `Usable on: ${forName}`;
          }
          return ({ id: c.id, name: c.name, desc });
        });
      this.openChoicePopup('Choose Core', opts, gs.weaponBuilds[gs.activeWeapon].core, (chosenId) => {
        gs.weaponBuilds[gs.activeWeapon].core = chosenId;
        const picked = (weaponCores.find((c) => c.id === chosenId) || weaponCores[0]);
        coreLabel.setText(`Core: ${picked.name}`);
        const isOn = !!chosenId;
        coreLabel.setStyle({ color: isOn ? '#ffff33' : '#cccccc' });
        SaveManager.saveToLocal(gs);
      });
    }).setOrigin(0, 0.5);
    nodes.push(coreBtn);

    // Armour (Column 3)
    let y3 = top + 56;
    nodes.push(this.add.text(col3X, y3, 'Armour', { fontFamily: 'monospace', fontSize: 16, color: '#ffffff' })); y3 += 28;
    const armourName = () => (armourDefs.find((a) => a.id === (gs.armour?.id || null)) || armourDefs[0]).name;
    const armourLabel = this.add.text(col3X, y3, `Equipped: ${armourName()}`, { fontFamily: 'monospace', fontSize: 14, color: '#cccccc' }); nodes.push(armourLabel);
    try { this.loadout.armourLabel = armourLabel; armourLabel.setStyle({ color: (gs.armour && gs.armour.id) ? '#ffff33' : '#cccccc' }); } catch (e) {}
    const armourBtn = makeTextButton(this, col3X + 210, y3 + 8, 'Choose', () => {
      // Only show Standard Issue (null) and armours the player owns
      const ownedSet = new Set((gs.ownedArmours || []).filter(Boolean));
      const opts = (armourDefs || [])
        .filter((a) => a && (a.id === null || ownedSet.has(a.id)))
        .map((a) => ({ id: a.id, name: a.name, desc: a.desc || '' }));
      const cur = gs.armour?.id || null;
      this.openChoicePopup('Choose Armour', opts, cur, (chosenId) => {
        gs.armour = gs.armour || { id: null, mods: [null, null] };
        // Safety: only allow equipping Standard Issue or owned armours
        const canEquip = (chosenId === null) || (Array.isArray(gs.ownedArmours) && gs.ownedArmours.includes(chosenId));
        gs.armour.id = canEquip ? chosenId : null;
        try {
          const id = gs.armour.id;
          if (id === 'exp_shield') {
            // Experimental Shield Generator: 25 HP, 85 Shield
            gs.maxHp = 25; if (gs.hp > gs.maxHp) gs.hp = gs.maxHp;
            gs.shieldMax = 85; if (gs.shield > gs.shieldMax) gs.shield = gs.shieldMax;
            gs.shieldRegenDelayMs = 4000;
          } else if (id === 'proto_thrusters') {
            // Prototype Thrusters: 80 HP, 35 Shield
            gs.maxHp = 80; if (gs.hp > gs.maxHp) gs.hp = gs.maxHp;
            gs.shieldMax = 35; if (gs.shield > gs.shieldMax) gs.shield = gs.shieldMax;
            gs.shieldRegenDelayMs = 4000;
          } else if (id === 'wasp_bits') {
            // BIT Carrier: 80 HP, 50 Shield
            gs.maxHp = 80; if (gs.hp > gs.maxHp) gs.hp = gs.maxHp;
            gs.shieldMax = 50; if (gs.shield > gs.shieldMax) gs.shield = gs.shieldMax;
            gs.shieldRegenDelayMs = 4000;
          } else {
            // Standard Issue: 100 HP, 50 Shield
            gs.maxHp = 100; if (gs.hp > gs.maxHp) gs.hp = gs.maxHp;
            gs.shieldMax = 50; if (gs.shield > gs.shieldMax) gs.shield = gs.shieldMax;
            gs.shieldRegenDelayMs = 4000;
          }
        } catch (_) {}
      armourLabel.setText('Equipped: ' + armourName());
      try { armourLabel.setStyle({ color: (gs.armour && gs.armour.id) ? '#ffff33' : '#cccccc' }); } catch (e) {}
      SaveManager.saveToLocal(gs);
      });
    }).setOrigin(0, 0.5); nodes.push(armourBtn); y3 += 36;
    const armourModLine = (idx) => {
      const wy = y3; y3 += 30;
      const getName = () => (armourMods.find((m) => m.id === (gs.armour?.mods?.[idx] ?? null)) || armourMods[0]).name;
      const lab = this.add.text(col3X, wy, `Mod ${idx + 1}: ${getName()}`, { fontFamily: 'monospace', fontSize: 14, color: '#cccccc' }); nodes.push(lab);
      try { this.loadout.armourModLabels[idx] = lab; lab.setStyle({ color: (gs.armour && gs.armour.mods && gs.armour.mods[idx]) ? '#ffff33' : '#cccccc' }); } catch (e) {}
      const btn = makeTextButton(this, col3X + 210, wy + 8, 'Choose', () => {
        gs.armour = gs.armour || { id: null, mods: [null, null] };
        const owned = new Set((gs.ownedArmourMods || []).filter(Boolean));
        // Prevent equipping the same armour mod in multiple slots:
        // build a set of mods already equipped in other slots and exclude them from options.
        const equippedMods = Array.isArray(gs.armour.mods) ? gs.armour.mods : [];
        const takenElsewhere = new Set(
          equippedMods.map((id, idx2) => (idx2 !== idx ? id : null)).filter((id) => !!id),
        );
        const opts = armourMods
          .filter((m) => (m.id === null) || (owned.has(m.id) && !takenElsewhere.has(m.id)))
          .map((m) => ({ id: m.id, name: m.name, desc: m.desc }));
        const cur = gs.armour.mods[idx] || null;
        this.openChoicePopup(`Choose Armour Mod ${idx + 1}`, opts, cur, (chosenId) => {
          gs.armour.mods[idx] = chosenId;
          lab.setText(`Mod ${idx + 1}: ${(armourMods.find((m) => m.id === chosenId) || armourMods[0]).name}`);
          try { lab.setStyle({ color: chosenId ? '#ffff33' : '#cccccc' }); } catch (e) {}
          SaveManager.saveToLocal(gs);
        });
      }).setOrigin(0, 0.5);
      nodes.push(btn);
    };
    armourModLine(0); armourModLine(1);

    // Ability selection (Column 3)
    y3 += 18;
    nodes.push(this.add.text(col3X, y3, 'Ability', { fontFamily: 'monospace', fontSize: 16, color: '#ffffff' })); y3 += 28;
    const abilityName = () => (getAbilityById(gs.abilityId)?.name || '-');
    const abilityLabel = this.add.text(col3X, y3, `Equipped: ${abilityName()}`, { fontFamily: 'monospace', fontSize: 14, color: '#cccccc' }); nodes.push(abilityLabel);
    const abilityBtn = makeTextButton(this, col3X + 210, y3 + 8, 'Choose', () => {
      // Only show abilities the player owns
      const owned = Array.isArray(gs.ownedAbilities) ? gs.ownedAbilities : ['ads'];
      const opts = abilityDefs
        .filter((a) => owned.includes(a.id))
        .map((a) => ({ id: a.id, name: a.name, desc: a.desc || '' }));
      const cur = gs.abilityId || null;
      this.openChoicePopup('Choose Ability', opts, cur, (chosenId) => {
        // Safety: only allow equipping owned abilities
        const canEquip = (Array.isArray(gs.ownedAbilities) ? gs.ownedAbilities : ['ads']).includes(chosenId);
        gs.abilityId = canEquip ? chosenId : 'ads';
        abilityLabel.setText(`Equipped: ${abilityName()}`);
        SaveManager.saveToLocal(gs);
      });
    }).setOrigin(0, 0.5);
    nodes.push(abilityLabel, abilityBtn); y3 += 36;

    // Close hint
    nodes.push(this.add.text(width / 2, top + panelH + 30, 'Press Tab to close', { fontFamily: 'monospace', fontSize: 12, color: '#999999' }).setOrigin(0.5));

    this.loadout.panel = panel; this.loadout.nodes = nodes;
  }

  closeLoadout() {
    if (this.loadout.panel) { this.loadout.panel.destroy(); this.loadout.panel = null; }
    (this.loadout.nodes || []).forEach((n) => n?.destroy());
    this.loadout.nodes = [];
    this.loadout.modLabels = [];
    this.loadout.coreLabel = null;
    this.closeChoicePopup();
  }

  openShopOverlay() {
    const gs = this.registry.get('gameState'); if (!gs || this.shop.panel) return;
    try {
      const { width, height } = this.scale; const panelW = 780; const panelH = Math.max(320, Math.min(520, height - 80)); const left = Math.floor(width / 2 - panelW / 2); const top = Math.max(20, Math.floor((height - panelH) / 2));
    const nodes = [];
    // Full-screen input blocker so clicks don't hit underlying scenes/UI
    const blocker = this.add.zone(0, 0, width, height).setOrigin(0, 0).setInteractive();
    nodes.push(blocker);
    const panel = this.add.graphics();
    panel.fillStyle(0x111111, 0.92).fillRect(left, top, panelW, panelH);
    panel.lineStyle(2, 0xffffff, 1).strokeRect(left, top, panelW, panelH);
    nodes.push(this.add.text(width / 2, top + 12, 'Shop', { fontFamily: 'monospace', fontSize: 18, color: '#ffffff' }).setOrigin(0.5));
    // Left categories
    const catX = left + 14; const catY = top + 44; const catW = 220; const catH = panelH - 64;
    const catBg = this.add.graphics(); catBg.fillStyle(0x0e0e0e, 0.92).fillRect(catX, catY, catW, catH); nodes.push(catBg);
    const categories = [
      { id: 'weapons', label: 'Weapons' },
      { id: 'armours', label: 'Armours' },
      { id: 'armour_mods', label: 'Armour Mods' },
      { id: 'weapon_mods', label: 'Weapon Mods' },
      { id: 'weapon_cores', label: 'Weapon Cores' },
      { id: 'abilities', label: 'Abilities' },
      { id: 'special', label: 'Special' },
    ];
    let cy = catY + 10; const setCat = (id) => { this.shop.activeCat = id; renderList(); };
    categories.forEach((c) => { const b = makeTextButton(this, catX + Math.floor(catW / 2), cy, c.label, () => setCat(c.id)); try { b.setStyle({ fontSize: 18 }); } catch (_) {} nodes.push(b); cy += 34; });

    // Right scrollable viewport
    const view = { x: left + catW + 26, y: top + 44, w: panelW - (catW + 40), h: panelH - 64 };
    const bg = this.add.graphics(); bg.fillStyle(0x111111, 0.92).fillRect(view.x, view.y, view.w, view.h); nodes.push(bg);
    const maskG = this.add.graphics(); maskG.fillStyle(0xffffff, 1).fillRect(view.x, view.y, view.w, view.h); const mask = maskG.createGeometryMask(); try { maskG.setVisible(false); } catch (_) {}
    const list = this.add.container(view.x, view.y); list.setMask(mask); nodes.push(list);
    const header = this.add.text(view.x + 8, view.y - 22, '', { fontFamily: 'monospace', fontSize: 14, color: '#ffffff' }).setOrigin(0, 0.5); nodes.push(header);
    const scrollG = this.add.graphics(); nodes.push(scrollG);
    let minY = view.y, maxY = view.y;
    const drawScrollbar = (contentH = view.h) => {
      scrollG.clear(); if (contentH <= view.h) return; const trackX = view.x + view.w - 6; const trackY = view.y + 4; const trackH = view.h - 8;
      scrollG.fillStyle(0xffffff, 0.14).fillRoundedRect(trackX, trackY, 3, trackH, 2);
      const total = contentH - view.h; const scrolled = (view.y - list.y); const ratio = Math.max(0, Math.min(1, total > 0 ? (scrolled / total) : 0));
      const thumbH = Math.max(16, Math.floor((view.h / contentH) * trackH)); const thumbY = trackY + Math.floor((trackH - thumbH) * ratio);
      scrollG.fillStyle(0xffffff, 0.6).fillRoundedRect(trackX, thumbY, 3, thumbH, 2);
    };
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const onWheel = (pointer, _objs, _dx, dy) => { const px = pointer.worldX ?? pointer.x; const py = pointer.worldY ?? pointer.y; if (px>=view.x && px<=view.x+view.w && py>=view.y && py<=view.y+view.h) { list.y = clamp(list.y - dy * 0.5, minY, maxY); drawScrollbar(minY === view.y ? view.h : (view.y - minY + view.h)); } };
    this.input.on('wheel', onWheel); this._shopWheelHandler = onWheel;

    // Ensure cores default to unowned (purchasable)\r\n    try { if (!Array.isArray(gs.ownedWeaponCores)) gs.ownedWeaponCores = []; } catch (_) {}
    const priceMod = 120; const priceCoreG = 50; const priceCoreDC = 1;
    const renderList = () => {
      try {
        try { list.removeAll(true); } catch (_) {}
        const cat = this.shop.activeCat || 'weapons'; let ly = 8; const rows = [];
      const pushRow = (text, buyFn) => { const row = this.add.container(0, ly); const label = this.add.text(Math.floor(view.w/2), 0, text, { fontFamily: 'monospace', fontSize: 16, color: '#ffffff' }).setOrigin(0.5, 0); const border = this.add.graphics(); const refresh = () => { border.clear(); border.lineStyle(1, 0xffffff, 1); const b = label.getBounds(); const bx = Math.floor(view.w/2 - b.width/2) - 6 + 0.5; const by = Math.floor(label.y) - 4 + 0.5; const bw = Math.ceil(b.width)+12; const bh = Math.ceil(b.height)+8; border.strokeRect(bx, by, bw, bh); }; refresh(); row.add(border); row.add(label); if (buyFn) label.setInteractive({ useHandCursor: true }).on('pointerover', () => { label.setStyle({ color: '#ffff66' }); refresh(); }).on('pointerout', () => { label.setStyle({ color: '#ffffff' }); refresh(); }).on('pointerdown', buyFn); list.add(row); rows.push(row); ly += 34; };
      if (cat === 'weapons') {
        header.setText('Weapons');
        const fmtRof = (w) => {
          if (!w || w.fireRateMs === 0) return 'Continuous';
          const perSec = 1000 / (w.fireRateMs || 1);
          return `${perSec.toFixed(1)}/s`;
        };
        (weaponDefs || []).forEach((w) => {
          if (w.price > 0 || w.id === 'pistol') {
            const ownedW = Array.isArray(gs.ownedWeapons) && gs.ownedWeapons.includes(w.id);
            const head = ownedW ? `${w.name} (Owned)` : `Buy ${w.name} (${w.price}g)`;
            const buyFn = ownedW ? null : () => {
              const g0 = this.registry.get('gameState');
              if (g0.gold >= w.price) { g0.gold -= w.price; g0.ownedWeapons.push(w.id); SaveManager.saveToLocal(g0); renderList(); }
            };
            pushRow(head, buyFn);
            // Optional short description if present
            if (w.desc) {
              const descLines = String(w.desc).replace(/\\n/g, '\n').split('\n');
              descLines.forEach((ln) => { const t = this.add.text(24, ly, ln.trim(), { fontFamily: 'monospace', fontSize: 12, color: '#cccccc', wordWrap: { width: view.w - 40, useAdvancedWrap: true } }).setOrigin(0, 0); list.add(t); ly += Math.ceil(t.height) + 6; });
            }
            // Stats lines (white)
            let dmgLine = (typeof w.aoeDamage === 'number') ? `Damage: ${w.damage} | Explosion: ${w.aoeDamage}` : ((w.isLaser || w.fireRateMs === 0) ? `Damage (DPS): ${w.damage}` : (w.id === 'shotgun' ? `Damage per Pellet: ${w.damage}` : `Damage: ${w.damage}`));
            const rofLine = (w.id === 'railgun') ? `Max Charge Time: 3.0s` : `Rate of Fire: ${fmtRof(w)}`;
            let velLine = w.isLaser ? `Bullet Velocity: Instant` : `Bullet Velocity: ${w.bulletSpeed}`;
            const magLine = w.isLaser ? `Time Before Overheat: 5s` : `Mag Size: ${w.magSize}`;
            if (w.id === 'railgun') {
              const chargedDmg = Math.round((w.damage || 0) * 3);
              const chargedVel = Math.round((w.bulletSpeed || 0) * 3);
              dmgLine = `Damage: ${w.damage} (Max Charge: ${chargedDmg})`;
              velLine = `Bullet Velocity: ${w.bulletSpeed} (Max Charge: ${chargedVel})`;
            }
            [dmgLine, rofLine, velLine, magLine].forEach((ln) => {
              const t = this.add.text(24, ly, ln, { fontFamily: 'monospace', fontSize: 12, color: '#ffffff', wordWrap: { width: view.w - 40, useAdvancedWrap: true } }).setOrigin(0, 0);
              list.add(t); ly += Math.ceil(t.height) + 6;
            });
            ly += 12;
          }
        });
      } else if (cat === 'weapon_mods') {
        header.setText('Weapon Mods');
        (weaponMods || []).forEach((m) => {
          if (!m.id) return;
          const owned = (gs.ownedWeaponMods || []).includes(m.id);
          const head = owned ? `${m.name} (Owned)` : `Buy ${m.name} (${priceMod}g)`;
          const buyFn = owned ? null : () => {
            const g1 = this.registry.get('gameState');
            if (g1.gold >= priceMod) {
              g1.gold -= priceMod; if (!g1.ownedWeaponMods) g1.ownedWeaponMods = []; g1.ownedWeaponMods.push(m.id); SaveManager.saveToLocal(g1); renderList();
            }
          };
          pushRow(head, buyFn);
          const lines = (() => {
            let usable = [], notUsable = [];
            try {
              (weaponDefs || []).forEach((wd) => {
                if (!wd) return;
                if (m.onlyFor && m.onlyFor !== wd.id) { notUsable.push(wd.name); return; }
                if (typeof m.allow === 'function') { try { if (!m.allow(wd)) { notUsable.push(wd.name); return; } } catch (_) {} }
                usable.push(wd.name);
              });
            } catch (_) {}
            const showNot = usable.length >= notUsable.length;
            const footer = showNot
              ? `Not usable on: ${notUsable.length ? notUsable.join(', ') : 'None'}`
              : `Usable on: ${usable.length ? usable.join(', ') : 'None'}`;
            return ((m.desc ? String(m.desc).replace(/\\n/g, '\n') + '\n' : '') + footer).split('\n');
          })();
          lines.forEach((ln) => {
            const line = ln.trim(); if (!line) return;
            let color = '#cccccc';
            const lower = line.toLowerCase();
            const positiveHints = ['increase', 'faster', 'higher', 'improve', 'improved', 'boost', 'bonus', 'gain'];
            const negativeHints = ['decrease', 'slower', 'lower', 'worse', 'penalty'];
            const beneficialNegTerms = ['spread', 'recoil', 'cooldown', 'reload', 'heat', 'delay', 'cost', 'consumption'];
            const harmfulPosTerms = ['spread', 'recoil', 'cooldown', 'reload', 'heat', 'delay', 'cost', 'consumption'];
            const harmfulNegTerms = ['damage', 'explosion', 'explosive', 'hp', 'health'];
            const isUsableLine = lower.startsWith('usable on:') || lower.startsWith('not usable on:');
            if (!isUsableLine) {
              if (line.startsWith('+')) {
                const isHarmfulPos = harmfulPosTerms.some((term) => lower.includes(term));
                color = isHarmfulPos ? '#ff6666' : '#66ff66';
              } else if (line.startsWith('-')) {
                const isBeneficialNeg = beneficialNegTerms.some((term) => lower.includes(term)) && !harmfulNegTerms.some((term) => lower.includes(term));
                color = isBeneficialNeg ? '#66ff66' : '#ff6666';
              } else if (positiveHints.some((k) => lower.includes(k))) {
                color = '#66ff66';
              } else if (negativeHints.some((k) => lower.includes(k))) {
                color = '#ff6666';
              }
            }
            const t = this.add.text(24, ly, line, { fontFamily: 'monospace', fontSize: 12, color, wordWrap: { width: view.w - 40, useAdvancedWrap: true } }).setOrigin(0, 0);
            list.add(t); ly += Math.ceil(t.height) + 6;
          });
        });
      } else if (cat === 'weapon_cores') {
        header.setText('Weapon Cores');
        (weaponCores || []).forEach((c) => {
          if (!c.id) return;
          const owned = (gs.ownedWeaponCores || []).includes(c.id);
          const head = owned ? `${c.name} (Owned)` : `Buy ${c.name} (${priceCoreG}g + ${priceCoreDC} DC)`;
          const buyFn = owned ? null : () => {
            const g2 = this.registry.get('gameState');
            if ((g2.gold >= priceCoreG) && ((g2.droneCores||0) >= priceCoreDC)) {
              g2.gold -= priceCoreG; g2.droneCores = (g2.droneCores||0) - priceCoreDC; if (!g2.ownedWeaponCores) g2.ownedWeaponCores = []; g2.ownedWeaponCores.push(c.id); SaveManager.saveToLocal(g2); renderList();
            }
          };
          pushRow(head, buyFn);
          // Footer: only Piercing/Explosive cores show Not usable on:, others show Usable on:
          let footer;
          if (c && (c.id === 'core_pierce' || c.id === 'core_blast')) {
            let notUsable = [];
            try {
              notUsable = (weaponDefs || []).filter((wd) => {
                if (!wd) return false;
                if (c.onlyFor && c.onlyFor !== wd.id) return true;
                if (typeof c.allow === 'function') { try { if (!c.allow(wd)) return true; } catch (_) {} }
                return false;
              }).map((wd) => wd.name);
            } catch (_) {}
            const nuList = notUsable.length ? notUsable.join(', ') : 'None';
            footer = `Not usable on: ${nuList}`;
          } else {
            const forName = c.onlyFor ? (getWeaponById(c.onlyFor)?.name || c.onlyFor) : 'Multiple';
            footer = `Usable on: ${forName}`;
          }
          const lines = ((c.desc ? String(c.desc).replace(/\\n/g, '\n') + '\n' : '') + footer).split('\n');
          lines.forEach((ln) => {
            const line = ln.trim(); if (!line) return;
            let color = '#cccccc';
            const lower = line.toLowerCase();
            const positiveHints = ['increase', 'faster', 'higher', 'improve', 'improved', 'boost', 'bonus', 'gain'];
            const negativeHints = ['decrease', 'slower', 'lower', 'worse', 'penalty'];
            const beneficialNegTerms = ['spread', 'recoil', 'cooldown', 'reload', 'heat', 'delay', 'cost', 'consumption'];
            const harmfulPosTerms = ['spread', 'recoil', 'cooldown', 'reload', 'heat', 'delay', 'cost', 'consumption'];
            const harmfulNegTerms = ['damage', 'explosion', 'explosive', 'hp', 'health'];
            const isUsableLine = lower.startsWith('not usable on:') || lower.startsWith('usable on:');
            if (!isUsableLine) {
              if (line.startsWith('+')) {
                const isHarmfulPos = harmfulPosTerms.some((term) => lower.includes(term));
                color = isHarmfulPos ? '#ff6666' : '#66ff66';
              } else if (line.startsWith('-')) {
                const isBeneficialNeg = beneficialNegTerms.some((term) => lower.includes(term)) && !harmfulNegTerms.some((term) => lower.includes(term));
                color = isBeneficialNeg ? '#66ff66' : '#ff6666';
              } else if (positiveHints.some((k) => lower.includes(k))) {
                color = '#66ff66';
              } else if (negativeHints.some((k) => lower.includes(k))) {
                color = '#ff6666';
              }
            }
            const t = this.add.text(24, ly, line, { fontFamily: 'monospace', fontSize: 12, color, wordWrap: { width: view.w - 40, useAdvancedWrap: true } }).setOrigin(0, 0);
            list.add(t); ly += Math.ceil(t.height) + 6;
          });
        });
      } else if (cat === 'armours') {
        header.setText('Armours');
        const prices = { exp_shield: 300, wasp_bits: 300, proto_thrusters: 300 };
        (armourDefs || []).forEach((a) => {
          if (!a) return;
          const id = a.id;
          const owned = id === null || (Array.isArray(gs.ownedArmours) && gs.ownedArmours.includes(id));
          const price = prices[id] ?? 200;
          const head = owned
            ? `${a.name} (Owned)`
            : `Buy ${a.name} (${price}g)`;
          const buyFn = owned ? null : () => {
            const g = this.registry.get('gameState');
            if (g.gold >= price) {
              g.gold -= price;
              if (!Array.isArray(g.ownedArmours)) g.ownedArmours = [];
              if (!g.ownedArmours.includes(id)) g.ownedArmours.push(id);
              SaveManager.saveToLocal(g);
              renderList();
            }
          };
          pushRow(head, buyFn);
          // Show armour description lines with specific colors for HP/Shield
          const descStr = String(a.desc || '').replace(/\\n/g, '\n');
          const lines = descStr.split('\n');
          lines.forEach((ln) => {
            const line = ln.trim(); if (!line) return;
            let color = '#cccccc';
            const lower = line.toLowerCase();
            if (lower.startsWith('hp:')) {
              color = '#66ff66';
            } else if (lower.startsWith('shield:')) {
              color = '#66aaff';
            } else if (line.startsWith('+')) {
              // For armour features, treat leading '+' as beneficial (green)
              color = '#66ff66';
            } else if (line.startsWith('-')) {
              // Consider certain '-' terms beneficial (e.g., cooldown/reload reductions)
              const beneficialNegTerms = ['spread', 'recoil', 'cooldown', 'reload', 'heat', 'delay', 'cost', 'consumption'];
              const harmfulNegTerms = ['damage', 'explosion', 'explosive', 'hp', 'health'];
              const isBeneficialNeg = beneficialNegTerms.some((term) => lower.includes(term)) && !harmfulNegTerms.some((term) => lower.includes(term));
              color = isBeneficialNeg ? '#66ff66' : '#ff6666';
            } else {
              const positiveHints = ['increase', 'faster', 'higher', 'improve', 'improved', 'boost', 'bonus', 'gain'];
              const negativeHints = ['decrease', 'slower', 'lower', 'worse', 'penalty'];
              if (positiveHints.some((k) => lower.includes(k))) {
                color = '#66ff66';
              } else if (negativeHints.some((k) => lower.includes(k))) {
                color = '#ff6666';
              }
            }
            const t = this.add.text(24, ly, line, { fontFamily: 'monospace', fontSize: 12, color, wordWrap: { width: view.w - 40, useAdvancedWrap: true } }).setOrigin(0, 0);
            list.add(t); ly += Math.ceil(t.height) + 6;
          });
          ly += 12;
        });
      } else if (cat === 'armour_mods') {
        header.setText('Armour Mods');
        const priceArmourMod = 120;
        (armourMods || []).forEach((m) => {
          if (!m.id) return; // skip Empty in shop
          const owned = Array.isArray(gs.ownedArmourMods) && gs.ownedArmourMods.includes(m.id);
          const head = owned ? `${m.name} (Owned)` : `Buy ${m.name} (${priceArmourMod}g)`;
          const buyFn = owned ? null : () => {
            const g = this.registry.get('gameState');
            if (g.gold >= priceArmourMod) {
              g.gold -= priceArmourMod; if (!Array.isArray(g.ownedArmourMods)) g.ownedArmourMods = []; g.ownedArmourMods.push(m.id); SaveManager.saveToLocal(g); renderList();
            }
          };
          pushRow(head, buyFn);
          const lines = String(m.desc || '').replace(/\\n/g, '\n').split('\n');
          lines.forEach((ln) => {
            const line = ln.trim(); if (!line) return;
            let color = '#cccccc';
            const lower = line.toLowerCase();
            const positiveHints = ['increase', 'faster', 'higher', 'improve', 'improved', 'boost', 'bonus', 'gain'];
            const negativeHints = ['decrease', 'slower', 'lower', 'worse', 'penalty'];
            const beneficialNegTerms = ['spread', 'recoil', 'cooldown', 'reload', 'heat', 'delay', 'cost', 'consumption'];
            const harmfulPosTerms = ['spread', 'recoil', 'cooldown', 'reload', 'heat', 'delay', 'cost', 'consumption'];
            const harmfulNegTerms = ['damage', 'explosion', 'explosive', 'hp', 'health'];
            if (line.startsWith('+')) {
              const isHarmfulPos = harmfulPosTerms.some((term) => lower.includes(term));
              color = isHarmfulPos ? '#ff6666' : '#66ff66';
            } else if (line.startsWith('-')) {
              const isBeneficialNeg = beneficialNegTerms.some((term) => lower.includes(term)) && !harmfulNegTerms.some((term) => lower.includes(term));
              color = isBeneficialNeg ? '#66ff66' : '#ff6666';
            } else if (positiveHints.some((k) => lower.includes(k))) {
              color = '#66ff66';
            } else if (negativeHints.some((k) => lower.includes(k))) {
              color = '#ff6666';
            }
            const t = this.add.text(24, ly, line, { fontFamily: 'monospace', fontSize: 12, color, wordWrap: { width: view.w - 40, useAdvancedWrap: true } }).setOrigin(0, 0);
            list.add(t); ly += Math.ceil(t.height) + 6;
          });
          ly += 12;
        });
        ly += 12;
      } else if (cat === 'abilities') {
        header.setText('Abilities');
        // Pricing for purchasable abilities (ADS is owned by default)
        const abilityPrices = { bits: 250, repulse: 200, caustic_cluster: 160, landmine_dispenser: 180, stealth_decoy: 400, directional_shield: 200 };
        const owned = Array.isArray(gs.ownedAbilities) ? gs.ownedAbilities : ['ads'];

        abilityDefs.forEach((a) => {
          if (!a || !a.id) return;
          const id = a.id;
          const name = a.name || id;
          const descStr = String(a.desc || '').replace(/\\n/g, '\n');
          const isDefault = id === 'ads';
          const isOwned = owned.includes(id);
          const price = abilityPrices[id] ?? 0;

          // Determine header/label and buy handler
          let head = '';
          let buyFn = null;
          if (isDefault) {
            head = `${name} (Owned by default)`;
          } else if (isOwned) {
            head = `${name} (Owned)`;
          } else if (price > 0) {
            head = `Buy ${name} (${price}g)`;
            buyFn = () => {
              const g = this.registry.get('gameState');
              if (!g) return;
              if ((g.gold || 0) >= price) {
                g.gold -= price;
                if (!Array.isArray(g.ownedAbilities)) g.ownedAbilities = ['ads'];
                if (!g.ownedAbilities.includes(id)) g.ownedAbilities.push(id);
                SaveManager.saveToLocal(g);
                renderList();
              }
            };
          } else {
            head = `${name}`;
          }
          pushRow(head, buyFn);
          // Description lines
          const lines = descStr.split('\n');
          lines.forEach((ln) => {
            const line = ln.trim(); if (!line) return;
            let color = '#cccccc';
            const lower = line.toLowerCase();
            const positiveHints = ['increase', 'faster', 'higher', 'improve', 'improved', 'boost', 'bonus', 'gain'];
            const negativeHints = ['decrease', 'slower', 'lower', 'worse', 'penalty'];
            const beneficialNegTerms = ['spread', 'recoil', 'cooldown', 'reload', 'heat', 'delay', 'cost', 'consumption'];
            const harmfulPosTerms = ['spread', 'recoil', 'cooldown', 'reload', 'heat', 'delay', 'cost', 'consumption'];
            const harmfulNegTerms = ['damage', 'explosion', 'explosive', 'hp', 'health'];
            if (line.startsWith('+')) {
              const isHarmfulPos = harmfulPosTerms.some((term) => lower.includes(term));
              color = isHarmfulPos ? '#ff6666' : '#66ff66';
            } else if (line.startsWith('-')) {
              const isBeneficialNeg = beneficialNegTerms.some((term) => lower.includes(term)) && !harmfulNegTerms.some((term) => lower.includes(term));
              color = isBeneficialNeg ? '#66ff66' : '#ff6666';
            } else if (positiveHints.some((k) => lower.includes(k))) {
              color = '#66ff66';
            } else if (negativeHints.some((k) => lower.includes(k))) {
              color = '#ff6666';
            }
            const t = this.add.text(24, ly, line, { fontFamily: 'monospace', fontSize: 12, color, wordWrap: { width: view.w - 40, useAdvancedWrap: true } }).setOrigin(0, 0);
            list.add(t); ly += Math.ceil(t.height) + 6;
          });
          ly += 12;
        });
      } else if (cat === 'special') {
        header.setText('Special');
        const maxCharges = 5;
        const cur = gs.dashMaxCharges ?? 3;
        const canBuy = cur < maxCharges;
        const label = canBuy ? `Dash Slot +1 (200g) [Now: ${cur}]` : `Dash Slots Maxed [${cur}]`;
        const buyFn = canBuy ? () => {
          const g = this.registry.get('gameState');
          if (g.gold >= 200 && g.dashMaxCharges < maxCharges) {
            g.gold -= 200; g.dashMaxCharges = Math.min(maxCharges, (g.dashMaxCharges || 3) + 1); SaveManager.saveToLocal(g); renderList();
          }
        } : null;
        pushRow(label, buyFn);
      }
      // update scroll bounds after building list
      const contentH = Math.max(view.h, ly + 8);
      minY = view.y - Math.max(0, contentH - view.h);
      maxY = view.y;
      list.y = clamp(list.y, minY, maxY);
      drawScrollbar(contentH);
      } catch (e) {
        const msg = this.add.text(view.x + 8, view.y + 8, `Error: ${e?.message || e}`, { fontFamily: 'monospace', fontSize: 12, color: '#ff6666' }).setOrigin(0, 0);
        list.add(msg);
      }
    };
      // Top-right close button
      const closeBtn = makeTextButton(this, left + panelW - 12, top + 12, 'Close', () => this.closeShopOverlay()).setOrigin(1, 0.5);
      nodes.push(closeBtn);
      // Store references and render initial category
      this.shop.panel = panel;
      this.shop.nodes = nodes;
      renderList();
    } catch (e) {
      try { console.error('Shop overlay error:', e); } catch (_) {}
      // Attempt to clean up any partial UI and leave the game responsive
      try { if (this._shopWheelHandler) { this.input.off('wheel', this._shopWheelHandler); this._shopWheelHandler = null; } } catch (_) {}
      try { if (this.shop && this.shop.panel) { this.shop.panel.destroy(); this.shop.panel = null; } } catch (_) {}
      try { (this.shop.nodes || []).forEach((n) => { try { n?.destroy?.(); } catch (_) {} }); this.shop.nodes = []; } catch (_) {}
      // Show a brief on-screen error message for debugging
      try {
        const { width, height } = this.scale;
        const msg = this.add.text(width / 2, height / 2, `Shop error: ${e?.message || e}`, { fontFamily: 'monospace', fontSize: 14, color: '#ff6666' }).setOrigin(0.5);
        this.time.delayedCall(2000, () => { try { msg.destroy(); } catch (_) {} });
      } catch (_) {}
    }

    }

  closeShopOverlay() {
    try { if (this._shopWheelHandler) { this.input.off('wheel', this._shopWheelHandler); this._shopWheelHandler = null; } } catch (_) {}
    if (this.shop.panel) { try { this.shop.panel.destroy(); } catch (_) {} this.shop.panel = null; }
    (this.shop.nodes || []).forEach((n) => { try { n?.destroy?.(); } catch (_) {} }); this.shop.nodes = []; this.shop.activeCat = 'weapons';
    // Belt-and-suspenders: ensure any Hub panel underlay is closed too
    try { const hub = this.scene.get(SceneKeys.Hub); if (hub && typeof hub.closePanel === 'function') hub.closePanel(); } catch (_) {}
  }

  // Show a brief top-of-screen resource hint. Newer messages are placed below existing ones to avoid overlap.
  showResourceHint(text) {
    try {
      const { width } = this.scale;
      // Place below the in-game "Clear enemies" prompt (y ???40)
      const baseY = 64;
      const gap = 18;
      const idx = (this._resourceToasts || []).length;
      const y = baseY + idx * gap;
      const t = this.add.text(width / 2, y, text, { fontFamily: 'monospace', fontSize: 14, color: '#ffff66' }).setOrigin(0.5, 0).setAlpha(0);
      if (!this._resourceToasts) this._resourceToasts = [];
      this._resourceToasts.push(t);
      // Fade in, hold, fade out
      this.tweens.add({ targets: t, alpha: 1, duration: 160, ease: 'quad.out', onComplete: () => {
        this.time.delayedCall(900, () => {
          this.tweens.add({ targets: t, alpha: 0, duration: 400, onComplete: () => {
            try {
              const arr = this._resourceToasts || [];
              const i = arr.indexOf(t);
              if (i >= 0) arr.splice(i, 1);
              t.destroy();
              // Optional: no upward reflow; new messages always stack below current ones
            } catch (_) {}
          } });
        });
      } });
    } catch (_) {}
  }

  // Helper to refresh the loadout overlay without the user having to toggle Tab
  reopenLoadout() {
    this.closeLoadout();
    this.openLoadout();
  }

  openChoicePopup(title, options, currentId, onChoose) {
    // Prevent multiple popups
    this.closeChoicePopup();
    const { width, height } = this.scale;
    const overlay = this.add.graphics();
    overlay.fillStyle(0x000000, 0.5).fillRect(0, 0, width, height);
    // Block input to underlying UI while popup is open
    overlay.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);
    const panel = this.add.graphics();
    const w = 420;
    // Measure total content height (name + descriptions + spacing per option)
    let contentHeight = 0;
    const measureOption = (opt) => {
      const descStr = String(opt.desc || '').replace(/\\n/g, '\n');
      const desc = descStr.split('\n').filter((s) => s.trim().length > 0);
      const nameH = 26; // taller name row
      const lineH = 20; // more spacing per description line
      const afterGap = desc.length ? 10 : 8; // extra gap between options
      return nameH + (desc.length * lineH) + afterGap;
    };
    options.forEach((opt) => { contentHeight += measureOption(opt); });
    const maxH = 520; // cap the popup height to avoid covering whole screen
    const x = (width - w) / 2; const y = (height - maxH) / 2;
    panel.fillStyle(0x1a1a1a, 0.96).fillRect(x, y, w, maxH);
    panel.lineStyle(2, 0xffffff, 1).strokeRect(x, y, w, maxH);

    const nodes = [];
    nodes.push(this.add.text(x + w / 2, y + 12, title, { fontFamily: 'monospace', fontSize: 16, color: '#ffffff' }).setOrigin(0.5));

    // Scrollable viewport area inside the panel
    const viewportTop = y + 44;
    const viewportBottom = y + maxH - 44; // leave room for close button
    const viewportH = Math.max(80, viewportBottom - viewportTop);

    // Container for scrollable content
    const content = this.add.container(x, viewportTop);
    // Mask to clip content within viewport
    const maskG = this.add.graphics();
    maskG.fillStyle(0x000000, 1).fillRect(x + 1, viewportTop + 1, w - 2, viewportH - 2);
    const geoMask = maskG.createGeometryMask();
    content.setMask(geoMask);
    // Hide the geometry used for the mask so it doesn't render as a black box
    maskG.setVisible(false);

    // Build option entries into the content container
    let yy = 8; // relative to viewport top; start with padding so first row isn't clipped
    const addText = (tx, ty, text, style, originX = 0, originY = 0) => {
      const t = this.add.text(tx, ty, text, style).setOrigin(originX, originY);
      content.add(t);
      return t;
    };
    const addOptionButton = (tx, ty, label, onClick) => {
      // Build a simple button (text + border) within the content container
      const t = this.add.text(tx, ty, label, { fontFamily: 'monospace', fontSize: 16, color: '#ffffff' }).setOrigin(0, 0);
      t.setInteractive({ useHandCursor: true })
        .on('pointerover', () => { t.setStyle({ color: '#ffff66' }); drawBorder(); })
        .on('pointerout', () => { t.setStyle({ color: '#ffffff' }); drawBorder(); })
        .on('pointerdown', () => onClick?.());
      const g = this.add.graphics();
      const drawBorder = () => {
        try {
          g.clear();
          g.lineStyle(1, 0xffffff, 1);
          // Use local coords within the content container so it stays aligned while scrolling
          const bx = Math.floor(t.x) - 4 + 0.5;
          const by = Math.floor(t.y) - 4 + 0.5;
          const bw = Math.ceil(t.width) + 8;
          const bh = Math.ceil(t.height) + 8;
          g.strokeRect(bx, by, bw, bh);
        } catch (_) {}
      };
      drawBorder();
      // Add both to content so they scroll and mask together
      content.add([t, g]);
      // Keep border in sync after the first frame
      this.time.delayedCall(0, drawBorder);
      // Expose a refresh method for scroll updates
      return { text: t, border: g, refresh: drawBorder };
    };

    const itemRecords = [];
    const wrapWidth = Math.max(120, w - 40);
    options.forEach((opt) => {
      const isCurrent = opt.id === currentId;
      const name = opt.name + (isCurrent ? ' (current)' : '');
      const btn = addOptionButton(16, yy, name, () => {
        try { onChoose?.(opt.id); } finally { this.closeChoicePopup(); }
      });
      itemRecords.push(btn);
      yy += 26;
      if (opt.desc) {
        const normalized = String(opt.desc).replace(/\\n/g, '\n');
        const lines = normalized.split('\n');
        lines.forEach((ln) => {
          let t = ln.trim(); if (!t) return;
          let forceNeutral = false;
          if (t.startsWith('(desc) ')) { t = t.slice(7); forceNeutral = true; }
          let color = '#cccccc';
          const lower = t.toLowerCase();
          if (!forceNeutral) {
            if (lower.startsWith('hp:')) {
              color = '#66ff66';
            } else if (lower.startsWith('shield:')) {
              color = '#66aaff';
            } else {
              const positiveHints = ['increase', 'faster', 'higher', 'improve', 'improved', 'boost', 'bonus', 'gain'];
              const negativeHints = ['decrease', 'slower', 'lower', 'worse', 'penalty'];
              const beneficialNegTerms = ['spread', 'recoil', 'cooldown', 'reload', 'heat', 'delay', 'cost', 'consumption'];
              const harmfulPosTerms = ['spread', 'recoil', 'cooldown', 'reload', 'heat', 'delay', 'cost', 'consumption'];
              const harmfulNegTerms = ['damage', 'explosion', 'explosive', 'hp', 'health'];
              if (t.startsWith('+')) {
                color = '#66ff66';
              } else if (t.startsWith('-')) {
                const isBeneficialNeg = beneficialNegTerms.some((term) => lower.includes(term)) && !harmfulNegTerms.some((term) => lower.includes(term));
                color = isBeneficialNeg ? '#66ff66' : '#ff6666';
              } else if (positiveHints.some((k) => lower.includes(k))) {
                color = '#66ff66';
              } else if (negativeHints.some((k) => lower.includes(k))) {
                color = '#ff6666';
              }
            }
          }
          const style = { fontFamily: 'monospace', fontSize: 12, color, wordWrap: { width: wrapWidth, useAdvancedWrap: true } };
          const tObj = addText(24, yy, t, style);
          itemRecords.push({ text: tObj, border: null, refresh: null });
          yy += Math.ceil(tObj.height) + 4;
        });
        yy += 8;
      } else {
        yy += 8;
      }
    });

    // Footer close button (fixed, not scrolled)
    const closeBtn = makeTextButton(this, x + w - 16, y + maxH - 16, 'Close', () => this.closeChoicePopup()).setOrigin(1, 1);
    nodes.push(closeBtn);

    // Scroll handling
    const contentTotalH = Math.max(yy, 0);
    let scrollY = 0;
    const maxScroll = Math.max(0, contentTotalH - viewportH);
    const setScroll = (val) => {
      scrollY = Math.max(0, Math.min(maxScroll, val));
      content.y = viewportTop - scrollY;
      // update borders for crisp lines after move
      itemRecords.forEach((r) => r.refresh && r.refresh());
      // Update scroll indicator
      drawScrollbar();
    };

    // Scrollbar indicator at right
    const scrollG = this.add.graphics();
    const drawScrollbar = () => {
      scrollG.clear();
      if (maxScroll <= 0) return; // nothing to draw
      const trackX = x + w - 8; // inside right edge
      const trackY = viewportTop + 4;
      const trackH = viewportH - 8;
      scrollG.fillStyle(0xffffff, 0.15).fillRoundedRect(trackX, trackY, 4, trackH, 2);
      // thumb size proportional to viewport/content
      const thumbH = Math.max(20, Math.floor((viewportH / contentTotalH) * trackH));
      const thumbY = trackY + Math.floor((scrollY / maxScroll) * (trackH - thumbH));
      scrollG.fillStyle(0xffffff, 0.6).fillRoundedRect(trackX, thumbY, 4, thumbH, 2);
    };

    // Wheel listener (only when pointer over viewport rect)
    const wheelHandler = (_pointers, _gobjs, dx, dy) => {
      const pointer = _pointers?.worldX !== undefined ? _pointers : (_pointers && _pointers[0]) || null;
      const px = pointer ? (pointer.worldX ?? pointer.x) : 0;
      const py = pointer ? (pointer.worldY ?? pointer.y) : 0;
      if (px >= x && px <= x + w && py >= viewportTop && py <= viewportTop + viewportH) {
        const step = 40; // pixels per wheel notch
        setScroll(scrollY + (dy > 0 ? step : -step));
      }
    };
    this.input.on('wheel', wheelHandler);

    // Initialize positions and indicator
    setScroll(0);

    this.choicePopup = { overlay, panel, nodes, content, maskG, geoMask, scrollG, wheelHandler };
  }

  closeChoicePopup() {
    if (!this.choicePopup) return;
    try { if (this.choicePopup.wheelHandler) this.input.off('wheel', this.choicePopup.wheelHandler); } catch (_) {}
    this.choicePopup.overlay?.destroy();
    this.choicePopup.panel?.destroy();
    this.choicePopup.scrollG?.destroy();
    if (this.choicePopup.content) {
      (this.choicePopup.content.list || []).forEach((obj) => obj?.destroy?.());
      this.choicePopup.content.destroy();
    }
    if (this.choicePopup.maskG) {
      try { this.choicePopup.content?.clearMask?.(); } catch (_) {}
      this.choicePopup.maskG.destroy();
    }
    (this.choicePopup.nodes || []).forEach((n) => n?.destroy());
    this.choicePopup = null;
  }
}






