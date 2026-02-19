import { SceneKeys } from '../core/SceneKeys.js';
import { InputManager } from '../core/Input.js';
import { SaveManager } from '../core/SaveManager.js';
import { drawPanel } from '../ui/Panels.js';
import { makeTextButton } from '../ui/Buttons.js';
import { getPlayerEffects } from '../core/Loadout.js';
import { fitImageHeight } from '../systems/WeaponVisuals.js';
import { weaponDefs } from '../core/Weapons.js';
import { Difficulty } from '../core/GameState.js';

export default class HubScene extends Phaser.Scene {
  constructor() { super(SceneKeys.Hub); }

  // Refresh Hub's view of GameState and Hub-related UI labels (campaign/deep dive/boss rush/mode)
  refreshFromGameState() {
    try {
      // Update local reference from registry if present
      const gsFromRegistry = this.registry.get('gameState');
      if (gsFromRegistry) this.gs = gsFromRegistry;
    } catch (_) {}

    try {
      const ui = this.scene.get(SceneKeys.UI);
      if (ui) {
        // Deep Dive label
        try {
          if (!ui.deepDiveText || !ui.deepDiveText.active) {
            ui.deepDiveText = ui.add.text(12, 28, '', { fontFamily: 'monospace', fontSize: 12, color: '#66ffcc' }).setOrigin(0, 0).setAlpha(0.95);
          }
          if (this.gs?.gameMode === 'DeepDive') {
            const best = this.gs?.deepDiveBest || { level: 0, stage: 0 };
            const L = Math.max(0, best.level || 0);
            const S = Math.max(0, Math.min(4, best.stage || 0));
            ui.deepDiveText.setText(`Deepest dive: ${L}-${S}`);
            ui.deepDiveText.setVisible(true);
          } else {
            ui.deepDiveText.setVisible(false);
          }
        } catch (_) {}
        // Swarm label
        try {
          if (!ui.swarmText || !ui.swarmText.active) {
            ui.swarmText = ui.add.text(12, 28, '', { fontFamily: 'monospace', fontSize: 12, color: '#66ffcc' }).setOrigin(0, 0).setAlpha(0.95);
          }
          if (this.gs?.gameMode === 'Swarm') {
            const best = this.gs?.swarmBest || { level: 0 };
            const L = Math.max(0, best.level || 0);
            ui.swarmText.setText(`Deepest swarm: ${L}`);
            ui.swarmText.setVisible(true);
          } else {
            ui.swarmText.setVisible(false);
          }
        } catch (_) {}

        // Campaign label
        try {
          if (!ui.campaignText || !ui.campaignText.active) {
            ui.campaignText = ui.add.text(12, 28, '', { fontFamily: 'monospace', fontSize: 12, color: '#66ffcc' }).setOrigin(0, 0).setAlpha(0.95);
          }
          if (this.gs?.gameMode === 'Normal') {
            const st = Math.max(1, this.gs?.campaignSelectedStage || 1);
            const completed = !!this.gs?.campaignCompleted;
            const txt = completed ? 'Campaign: Completed' : `Campaign: Stage ${st}`;
            ui.campaignText.setText(txt);
            ui.campaignText.setVisible(true);
          } else {
            ui.campaignText.setVisible(false);
          }
        } catch (_) {}

        // Boss Rush label
        try {
          if (!ui.bossRushText || !ui.bossRushText.active) {
            ui.bossRushText = ui.add.text(12, 28, '', { fontFamily: 'monospace', fontSize: 12, color: '#66ffcc' }).setOrigin(0, 0).setAlpha(0.95);
          }
          if (this.gs?.gameMode === 'BossRush') {
            const completed = !!this.gs?.bossRushCompleted;
            const txt = completed ? 'Boss Rush Completed' : 'Boss Rush Not Completed';
            ui.bossRushText.setText(txt);
            ui.bossRushText.setVisible(true);
          } else {
            ui.bossRushText.setVisible(false);
          }
        } catch (_) {}
      }
    } catch (_) {}

    // Update mode prompt text if it exists
    try {
      if (this.prompt && this.prompt.active) {
        const modeLabel = () => {
          try {
            if (this.gs?.shootingRange) return 'Mode: Shooting Range';
            const m = this.gs?.gameMode || 'Normal';
            if (m === 'BossRush') return 'Mode: Boss Rush';
            if (m === 'DeepDive') return 'Mode: Deep Dive';
            if (m === 'Swarm') return 'Mode: Swarm';
            return 'Mode: Campaign';
          } catch (_) { return 'Mode: Campaign'; }
        };
        this.prompt.setText(modeLabel());
      }
    } catch (_) {}
  }

  create() {
    const { width, height } = this.scale;
    this.gs = this.registry.get('gameState');
    // Hub/Training BGM: restart from beginning whenever player returns to Hub.
    try {
      try { this.sound.stopByKey('bgm_boss'); } catch (_) {}
      try { this.sound.stopByKey('bgm_campaign'); } catch (_) {}
      try { this.sound.stopByKey('bgm_hub'); } catch (_) {}
      try { this.sound.stopByKey('bgm_infinite'); } catch (_) {}
      const av = (this.gs && this.gs.audioVolumes) ? this.gs.audioVolumes : {};
      const clamp01 = (v, d) => (typeof v === 'number' && Number.isFinite(v)) ? Math.max(0, Math.min(1, v)) : d;
      const v = clamp01(av.master, 1) * clamp01(av.hub, 0.7);
      const hubBgm = this.sound.add('bgm_hub', { loop: true, volume: v });
      hubBgm.play();
    } catch (_) {}
    // Launch UI overlay for gameplay scenes
    this.scene.launch(SceneKeys.UI);
    // Ensure boss HUD is hidden when entering Hub
    try { this.registry.set('bossActive', false); this.registry.set('bossName', ''); this.registry.set('bossHp', 0); this.registry.set('bossHpMax', 0); this.registry.set('cinematicActive', false); } catch (_) {}
    this.inputMgr = new InputManager(this);
    // Deep Dive indicator in Hub when DeepDive mode is selected (mirror CombatScene behavior with retries)
    try {
      const ensureDeepDiveLabel = () => {
        const ui = this.scene.get(SceneKeys.UI);
        if (!ui) return;
        if (!ui.deepDiveText || !ui.deepDiveText.active) {
          ui.deepDiveText = ui.add.text(12, 28, '', { fontFamily: 'monospace', fontSize: 12, color: '#66ffcc' }).setOrigin(0, 0).setAlpha(0.95);
        }
        if (this.gs?.gameMode === 'DeepDive') {
          const best = this.gs?.deepDiveBest || { level: 0, stage: 0 };
          const L = Math.max(0, best.level || 0);
          const S = Math.max(0, Math.min(4, best.stage || 0));
          ui.deepDiveText.setText(`Deepest dive: ${L}-${S}`);
          ui.deepDiveText.setVisible(true);
        } else {
          ui.deepDiveText.setVisible(false);
        }
      };
      ensureDeepDiveLabel();
      this.time.delayedCall(50, ensureDeepDiveLabel);
      this.time.delayedCall(150, ensureDeepDiveLabel);
    } catch (_) {}
    // Swarm indicator in Hub when Swarm mode is selected
    try {
      const ensureSwarmLabel = () => {
        const ui = this.scene.get(SceneKeys.UI);
        if (!ui) return;
        if (!ui.swarmText || !ui.swarmText.active) {
          ui.swarmText = ui.add.text(12, 28, '', { fontFamily: 'monospace', fontSize: 12, color: '#66ffcc' }).setOrigin(0, 0).setAlpha(0.95);
        }
        if (this.gs?.gameMode === 'Swarm') {
          const best = this.gs?.swarmBest || { level: 0 };
          const L = Math.max(0, best.level || 0);
          ui.swarmText.setText(`Deepest swarm: ${L}`);
          ui.swarmText.setVisible(true);
        } else {
          ui.swarmText.setVisible(false);
        }
      };
      ensureSwarmLabel();
      this.time.delayedCall(50, ensureSwarmLabel);
      this.time.delayedCall(150, ensureSwarmLabel);
    } catch (_) {}

    // Campaign indicator in Hub when Campaign (Normal) mode is selected
    try {
      const ensureCampaignLabel = () => {
        const ui = this.scene.get(SceneKeys.UI);
        if (!ui) return;
        if (!ui.campaignText || !ui.campaignText.active) {
          // Align with other trackers (top-left y=28)
          ui.campaignText = ui.add.text(12, 28, '', { fontFamily: 'monospace', fontSize: 12, color: '#66ffcc' }).setOrigin(0, 0).setAlpha(0.95);
        }
        if (this.gs?.gameMode === 'Normal') {
          const st = Math.max(1, this.gs?.campaignSelectedStage || 1);
          const completed = !!this.gs?.campaignCompleted;
          const txt = completed ? 'Campaign: Completed' : `Campaign: Stage ${st}`;
          ui.campaignText.setText(txt);
          ui.campaignText.setVisible(true);
        } else {
          ui.campaignText.setVisible(false);
        }
      };
      ensureCampaignLabel();
      this.time.delayedCall(50, ensureCampaignLabel);
      this.time.delayedCall(150, ensureCampaignLabel);
    } catch (_) {}

    // Boss Rush indicator in Hub when BossRush mode is selected
    try {
      const ensureBossRushLabel = () => {
        const ui = this.scene.get(SceneKeys.UI);
        if (!ui) return;
        if (!ui.bossRushText || !ui.bossRushText.active) {
          // Align with other trackers (top-left y=28)
          ui.bossRushText = ui.add.text(12, 28, '', { fontFamily: 'monospace', fontSize: 12, color: '#66ffcc' }).setOrigin(0, 0).setAlpha(0.95);
        }
        if (this.gs?.gameMode === 'BossRush') {
          const completed = !!this.gs?.bossRushCompleted;
          const txt = completed ? 'Boss Rush Completed' : 'Boss Rush Not Completed';
          ui.bossRushText.setText(txt);
          ui.bossRushText.setVisible(true);
        } else {
          ui.bossRushText.setVisible(false);
        }
      };
      ensureBossRushLabel();
      this.time.delayedCall(50, ensureBossRushLabel);
      this.time.delayedCall(150, ensureBossRushLabel);
    } catch (_) {}


    // Fully restore player HP and Shield upon entering Hub
    try {
      const eff = getPlayerEffects(this.gs) || {};
      const effectiveMaxHp = Math.max(0, (this.gs?.maxHp || 0) + (eff.bonusHp || 0));
      this.gs.hp = effectiveMaxHp;
      // Restore shields to max and clear damage timestamp to allow immediate regen visuals
      this.gs.shield = Math.max(0, Math.floor(this.gs?.shieldMax || 0));
      this.gs.lastDamagedAt = 0;
      SaveManager.saveToLocal(this.gs);
    } catch (_) {}

    // World bounds
    this.physics.world.setBounds(0, 0, width, height);

    // Player (Inle art, scaled to 12px height)
    this.player = this.physics.add.sprite(width / 2, height / 2 + 60, 'player_inle').setCollideWorldBounds(true);
    try { fitImageHeight(this, this.player, 24); } catch (_) {}
    this.player.setSize(12, 12);
    // no graphics draw; use texture
    this.player.iframesUntil = 0;
    this.playerFacing = 0;
    this.dash = { active: false, until: 0, cooldownUntil: 0, vx: 0, vy: 0, charges: 0, regen: [] };
    this.dash.charges = this.gs.dashMaxCharges;
    this.registry.set('dashCharges', this.dash.charges);
    this.registry.set('dashRegenProgress', 1);

    // NPC vendor (static)
    // Shop NPC: move much further left and up
    this.npcZone = this.add.zone(width - 320, height - 240, 40, 40);
    this.physics.world.enable(this.npcZone);
    this.npcZone.body.setAllowGravity(false);
    this.npcZone.body.setImmovable(true);
    // Shop NPC sprite
    try {
      this.npcSprite = this.add.image(this.npcZone.x, this.npcZone.y, 'npc_shop');
      fitImageHeight(this, this.npcSprite, 24);
      // Label: Shop
      this.add.text(this.npcZone.x, this.npcZone.y - 24, 'Shop', {
        fontFamily: 'monospace',
        fontSize: 12,
        color: '#ffffff',
      }).setOrigin(0.5);
    } catch (_) {}

    // Mode-select NPC (upper-right)
    // Mode-select NPC: top-right corner, further inset toward center
    this.modeNpcZone = this.add.zone(width - 140, 120, 40, 40);
    this.physics.world.enable(this.modeNpcZone);
    this.modeNpcZone.body.setAllowGravity(false);
    this.modeNpcZone.body.setImmovable(true);
    // Mode-select NPC sprite
    try {
      this.modeNpcSprite = this.add.image(this.modeNpcZone.x, this.modeNpcZone.y, 'npc_mode');
      fitImageHeight(this, this.modeNpcSprite, 24);
      // Label: Mode Selection
      this.add.text(this.modeNpcZone.x, this.modeNpcZone.y - 24, 'Mode Selection', {
        fontFamily: 'monospace',
        fontSize: 12,
        color: '#ffffff',
      }).setOrigin(0.5);
    } catch (_) {}

    // Portal to Combat/Boss
    this.portalZone = this.add.zone(width - 60, height / 2, 40, 80);
    this.physics.world.enable(this.portalZone);
    this.portalZone.body.setAllowGravity(false);
    this.portalZone.body.setImmovable(true);
    this.portalG = this.add.graphics();
    // Drill portal sprite (Drill.png)
    try {
      this.portalSprite = this.add.image(this.portalZone.x, this.portalZone.y, 'hub_drill');
      this.portalSprite.setOrigin(0.5);
      this.portalSprite.setFlipX(true);
      try { fitImageHeight(this, this.portalSprite, 64); } catch (_) {}
    } catch (_) {}
    // Label: Drill To Combat
    this.add.text(this.portalZone.x, this.portalZone.y - 28, 'Drill To Combat', {
      fontFamily: 'monospace',
      fontSize: 12,
      color: '#ffffff',
    }).setOrigin(0.5);

    // Bonus block (left side): grants 5000g + 20 DC on interact
    this.bonusZone = this.add.zone(24, height / 2, 20, 20);
    this.physics.world.enable(this.bonusZone);
    this.bonusZone.body.setAllowGravity(false);
    this.bonusZone.body.setImmovable(true);
    this.bonusG = this.add.graphics();
    this.bonusG.fillStyle(0xff3333, 1).fillRect(this.bonusZone.x - 10, this.bonusZone.y - 10, 20, 20);

    // Difficulty terminal (upper-left from screen center)
    const termX = width / 2 - 140;
    const termY = height / 2 - 80;
    this.diffTerminalZone = this.add.zone(termX, termY, 32, 32);
    this.physics.world.enable(this.diffTerminalZone);
    this.diffTerminalZone.body.setAllowGravity(false);
    this.diffTerminalZone.body.setImmovable(true);
    this.diffTerminalG = this.add.graphics();
    // Difficulty terminal sprite (Terminal.png)
    try {
      this.diffTerminalSprite = this.add.image(this.diffTerminalZone.x, this.diffTerminalZone.y, 'diff_terminal');
      this.diffTerminalSprite.setOrigin(0.5);
      try { fitImageHeight(this, this.diffTerminalSprite, 24); } catch (_) {}
      // Label: Difficulty Terminal
      this.add.text(this.diffTerminalZone.x, this.diffTerminalZone.y - 24, 'Difficulty Terminal', {
        fontFamily: 'monospace',
        fontSize: 12,
        color: '#ffffff',
      }).setOrigin(0.5);
    } catch (_) {}
    // Difficulty terminal placeholder hidden (replaced by sprite)

    // Hint NPC (Woundwort) placed left and below difficulty terminal
    const hintX = termX - 80;
    const hintY = termY + 110;
    this.hintNpcZone = this.add.zone(hintX, hintY, 40, 40);
    this.physics.world.enable(this.hintNpcZone);
    this.hintNpcZone.body.setAllowGravity(false);
    this.hintNpcZone.body.setImmovable(true);
    try {
      this.hintNpcSprite = this.add.image(this.hintNpcZone.x, this.hintNpcZone.y, 'Woundwort');
      fitImageHeight(this, this.hintNpcSprite, 24);
      this.add.text(this.hintNpcZone.x, this.hintNpcZone.y - 24, 'Hints', {
        fontFamily: 'monospace',
        fontSize: 12,
        color: '#ffffff',
      }).setOrigin(0.5);
    } catch (_) {}

    // Overlap detection
    this.physics.add.overlap(this.player, this.npcZone);
    this.physics.add.overlap(this.player, this.modeNpcZone);
    this.physics.add.overlap(this.player, this.portalZone);
    this.physics.add.overlap(this.player, this.hintNpcZone);

    // UI prompt (top): show selected mode instead of generic WASD hint
    const modeLabel = () => {
      try {
        if (this.gs?.shootingRange) return 'Mode: Shooting Range';
        const m = this.gs?.gameMode || 'Normal';
        if (m === 'BossRush') return 'Mode: Boss Rush';
        if (m === 'DeepDive') return 'Mode: Deep Dive';
        if (m === 'Swarm') return 'Mode: Swarm';
        return 'Mode: Campaign';
      } catch (_) { return 'Mode: Campaign'; }
    };
    this.prompt = this.add.text(width / 2, 40, modeLabel(), { fontFamily: 'monospace', fontSize: 14, color: '#ffffff' }).setOrigin(0.5);
    // Keybinds hint (bottom-right, small font)
    const binds = [
      'W/A/S/D: Move',
      'Space: Dash',
      'E: Interact',
      'C: Melee',
      'F: Ability',
      'LMB: Shoot',
      'Q: Swap Weapon',
      'R: Reload',
      'Tab: Loadout',
    ].join('\n');
    this.add.text(width - 10, height - 10, binds, { fontFamily: 'monospace', fontSize: 12, color: '#cccccc' })
      .setOrigin(1, 1)
      .setAlpha(0.9);

    // Dialogue/Shop panel hidden
    this.panel = null;

    // Flip player left/right based on cursor X (update each frame)
    try {
      this.events.on('update', () => {
        try {
          const ptr = this.input?.activePointer;
          if (ptr && this.player) this.player.setFlipX(ptr.worldX < this.player.x);
        } catch (_) {}
          // Make NPCs face the player (left/right only)
          try {
            if (this.npcSprite) this.npcSprite.setFlipX(this.player.x < this.npcSprite.x);
            if (this.modeNpcSprite) this.modeNpcSprite.setFlipX(this.player.x < this.modeNpcSprite.x);
            if (this.hintNpcSprite) this.hintNpcSprite.setFlipX(this.player.x < this.hintNpcSprite.x);
          } catch (_) {}
      });
    } catch (_) {}

    // Save on enter
    if (this.gs) SaveManager.saveToLocal(this.gs);
  }

  openNpcPanel() {
    if (this.panel) return;
    const { width } = this.scale;
    this.panel = drawPanel(this, width / 2 - 140, 80, 280, 120);
    // Mark this panel as the lightweight conversation box (pre-shop)
    this.panel._type = 'npcPrompt';
    const t = this.add.text(width / 2, 110, 'Open Shop?', { fontFamily: 'monospace', fontSize: 16, color: '#ffffff' }).setOrigin(0.5);
    const yes = makeTextButton(this, width / 2 - 50, 150, 'Yes', () => { this.openShop(); });
    const no = makeTextButton(this, width / 2 + 50, 150, 'No', () => { this.closePanel([t, yes, no]); });
    this.panel._extra = [t, yes, no];
  }

  openShop() {
    // Ensure any previous shop wheel handler is removed
    try { if (this._shopWheelHandler) { this.input.off('wheel', this._shopWheelHandler); this._shopWheelHandler = null; } } catch (_) {}
    this.closePanel();
    // Open a UI overlay version of the shop so it renders above all UI elements
    try { const ui = this.scene.get(SceneKeys.UI); if (ui && typeof ui.openShopOverlay === 'function') { ui.openShopOverlay(); return; } } catch (_) {}
    return;
    const { width } = this.scale;
    // Larger panel to host future category menu + scrollable content
    const panelX = width / 2 - 380;
    const panelY = 40;
    const panelW = 760;
    const panelH = 520;
    this.panel = drawPanel(this, panelX, panelY, panelW, panelH);
    const t = this.add.text(width / 2, panelY + 22, 'Shop', { fontFamily: 'monospace', fontSize: 18, color: '#ffffff' }).setOrigin(0.5);
    const buy = makeTextButton(this, width / 2, panelY + 60, 'Buy potion for 20g (+30 HP)', () => {
      if (this.gs.gold >= 20) {
        this.gs.gold -= 20;
        const effMax = (this.gs.maxHp || 0) + ((getPlayerEffects(this.gs).bonusHp) || 0);
        this.gs.hp = Math.min(effMax, this.gs.hp + 30);
      }
    });
    const buyMax = makeTextButton(this, width / 2, panelY + 90, 'Increase Max HP +10 (40g)', () => {
      if (this.gs.gold >= 40) {
        this.gs.gold -= 40; this.gs.maxHp += 10;
        const effMax = (this.gs.maxHp || 0) + ((getPlayerEffects(this.gs).bonusHp) || 0);
        this.gs.hp = Math.min(effMax, this.gs.hp + 10);
      }
    });
    const dashUp = makeTextButton(this, width / 2, panelY + 120, `Dash Slot +1 (100g) [Now: ${this.gs.dashMaxCharges}]`, () => {
      if (this.gs.dashMaxCharges >= 5) { dashUp.setText(`Dash Slots Maxed [${this.gs.dashMaxCharges}]`); return; }
      if (this.gs.gold >= 100) {
        this.gs.gold -= 100; this.gs.dashMaxCharges = Math.min(5, this.gs.dashMaxCharges + 1);
        dashUp.setText(this.gs.dashMaxCharges >= 5 ? `Dash Slots Maxed [${this.gs.dashMaxCharges}]` : `Dash Slot +1 (100g) [Now: ${this.gs.dashMaxCharges}]`);
      }
    });
    // Scrollable list area for items (weapons / future cores/mods)
    const viewport = { x: panelX + 20, y: panelY + 160, w: panelW - 40, h: panelH - 210 };
    // Dark background behind the scroll area for readability
    const listBgG = this.add.graphics();
    listBgG.fillStyle(0x111111, 0.92).fillRect(viewport.x, viewport.y, viewport.w, viewport.h);
    // Geometry mask shape (hidden) used to clip the scroll list
    const listMaskG = this.add.graphics();
    listMaskG.fillStyle(0xffffff, 1).fillRect(viewport.x, viewport.y, viewport.w, viewport.h);
    const listMask = listMaskG.createGeometryMask();
    try { listMaskG.setVisible(false); } catch (_) {}
    const list = this.add.container(viewport.x, viewport.y);
    list.setMask(listMask);

    const nodes = [];
    // Section header
    const header = this.add.text(viewport.x + 8, viewport.y - 22, 'Weapons', { fontFamily: 'monospace', fontSize: 14, color: '#ffffff' }).setOrigin(0, 0.5);
    nodes.push(header);

    // Populate weapons into the scroll container
    // Start slightly lower so the first line isn't clipped by the mask
    let ly = 8;
    const lineGap = 34;
    weaponDefs.forEach((w) => {
      if (!this.gs.ownedWeapons.includes(w.id) && w.price > 0) {
        const row = this.add.container(0, ly);
        const label = this.add.text(viewport.w / 2, 0, `Buy ${w.name} (${w.price}g)`, { fontFamily: 'monospace', fontSize: 16, color: '#ffffff' }).setOrigin(0.5, 0);
        const border = this.add.graphics();
        const refreshBorder = () => {
          border.clear(); border.lineStyle(1, 0xffffff, 1);
          const b = label.getBounds();
          const bx = Math.floor(viewport.w / 2 - b.width / 2) - 6 + 0.5;
          const by = Math.floor(label.y) - 4 + 0.5;
          const bw = Math.ceil(b.width) + 12; const bh = Math.ceil(b.height) + 8;
          border.strokeRect(bx, by, bw, bh);
        };
        refreshBorder();
        row.add(border); row.add(label);
        label.setInteractive({ useHandCursor: true })
          .on('pointerover', () => { label.setStyle({ color: '#ffff66' }); refreshBorder(); })
          .on('pointerout', () => { label.setStyle({ color: '#ffffff' }); refreshBorder(); })
          .on('pointerdown', () => {
            if (this.gs.gold >= w.price) {
              this.gs.gold -= w.price; this.gs.ownedWeapons.push(w.id);
              label.setText(`${w.name} (Owned)`); refreshBorder();
            }
          });
        list.add(row);
        nodes.push(row);
        ly += lineGap;
      }
    });
    const listContentHeight = Math.max(ly, viewport.h);

    // Scroll behavior (mouse wheel within viewport)
    let minY = viewport.y - (listContentHeight - viewport.h);
    let maxY = viewport.y;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const onWheel = (pointer, gameObjects, dx, dy) => {
      const px = pointer.worldX ?? pointer.x; const py = pointer.worldY ?? pointer.y;
      if (px >= viewport.x && px <= viewport.x + viewport.w && py >= viewport.y && py <= viewport.y + viewport.h) {
        list.y = clamp(list.y - dy * 0.5, minY, maxY);
        drawScrollbar();
      }
    };
    this.input.on('wheel', onWheel);
    this._shopWheelHandler = onWheel;

    // Right-side scroll indicator (shows only when scrolling is possible)
    const scrollG = this.add.graphics();
    const drawScrollbar = () => {
      scrollG.clear();
      const canScroll = listContentHeight > viewport.h + 1;
      if (!canScroll) return;
      const trackX = viewport.x + viewport.w - 6; // slim bar near right edge
      const trackY = viewport.y + 4;
      const trackH = viewport.h - 8;
      scrollG.fillStyle(0xffffff, 0.14).fillRoundedRect(trackX, trackY, 3, trackH, 2);
      // Compute current scroll amount from list.y
      const total = listContentHeight - viewport.h;
      const scrolled = (viewport.y - list.y);
      const ratio = Math.max(0, Math.min(1, total > 0 ? (scrolled / total) : 0));
      const thumbH = Math.max(16, Math.floor((viewport.h / listContentHeight) * trackH));
      const thumbY = trackY + Math.floor((trackH - thumbH) * ratio);
      scrollG.fillStyle(0xffffff, 0.6).fillRoundedRect(trackX, thumbY, 3, thumbH, 2);
    };
    // Initial indicator state
    drawScrollbar();

    // Close button stays anchored to bottom of panel
    const close = makeTextButton(this, width / 2, panelY + panelH - 20, 'Close', () => {
      this.closePanel([t, buy, buyMax, dashUp, header, listBgG, list, listMaskG, scrollG, close]);
      try { this.input.off('wheel', onWheel); this._shopWheelHandler = null; } catch (_) {}
    });
    // Track all extras for cleanup on generic close
    this.panel._extra = [t, buy, buyMax, dashUp, header, listBgG, list, listMaskG, scrollG, close];
  }

  openModePanel() {
    if (this.panel) return;
    const { width } = this.scale;
    // Taller panel to support vertical list + description area
    const panelW = 320; const panelH = 370; const panelX = width / 2 - panelW / 2; const panelY = 80;
    this.panel = drawPanel(this, panelX, panelY, panelW, panelH);
    this.panel._type = 'modeSelect';
    const title = this.add.text(width / 2, 105, 'Select Mode', { fontFamily: 'monospace', fontSize: 18, color: '#ffffff' }).setOrigin(0.5);

    // Vertical choices
    const y0 = 140; const line = 30; const cx = width / 2;
    const campaignBtn = makeTextButton(this, cx, y0 + 0 * line, 'Campaign', () => {
      try { this.openCampaignStageMenu(); } catch (_) {}
    });
    const bossRushBtn = makeTextButton(this, cx, y0 + 1 * line, 'Boss Rush', () => {
      try {
        this.gs.shootingRange = false;
        this.gs.setGameMode('BossRush');
        SaveManager.saveToLocal(this.gs);
      } catch (_) {}
      this.closePanel([title, campaignBtn, bossRushBtn, deepDiveBtn, swarmBtn, rangeBtn, desc, closeBtn]);
    });
    const deepDiveBtn = makeTextButton(this, cx, y0 + 2 * line, 'Deep Dive', () => {
      try {
        this.gs.shootingRange = false;
        this.gs.setGameMode('DeepDive');
        SaveManager.saveToLocal(this.gs);
      } catch (_) {}
      this.closePanel([title, campaignBtn, bossRushBtn, deepDiveBtn, swarmBtn, rangeBtn, desc, closeBtn]);
    });
    const swarmBtn = makeTextButton(this, cx, y0 + 3 * line, 'Swarm', () => {
      try {
        this.gs.shootingRange = false;
        this.gs.setGameMode('Swarm');
        SaveManager.saveToLocal(this.gs);
      } catch (_) {}
      this.closePanel([title, campaignBtn, bossRushBtn, deepDiveBtn, swarmBtn, rangeBtn, desc, closeBtn]);
    });
    const rangeBtn = makeTextButton(this, cx, y0 + 4 * line, 'Shooting Range', () => {
      try { this.gs.setGameMode('Normal'); this.gs.shootingRange = true; SaveManager.saveToLocal(this.gs); } catch (_) {}
      this.closePanel([title, campaignBtn, bossRushBtn, deepDiveBtn, swarmBtn, rangeBtn, desc, closeBtn]);
      // Do not auto-enter; use the portal (E) like other modes
    });

    // Description area (placeholder; ready to populate detailed text)
    const desc = this.add.text(cx, y0 + 5 * line + 20, 'Select a mode to view its description', {
      fontFamily: 'monospace', fontSize: 12, color: '#cccccc', wordWrap: { width: panelW - 40 }, align: 'center', lineSpacing: 2,
    }).setOrigin(0.5, 0);

    // Optional: preview description on hover (basic hooks; can refine text later)
    const setDesc = (s) => { try { desc.setText(s); } catch (_) {} };
    try {
      campaignBtn.on('pointerover', () => setDesc('Campaign: Progress through the game'));
      bossRushBtn.on('pointerover', () => setDesc('Boss Rush: Fight all three bosses in a row'));
      deepDiveBtn.on('pointerover', () => setDesc('Deep Dive: Endless escalating rooms with stage cycles.'));
      swarmBtn.on('pointerover', () => setDesc('Swarm: Endless drone waves with level scaling.'));
      rangeBtn.on('pointerover', () => setDesc('Shooting Range: Test weapons and builds in a safe arena.'));
    } catch (_) {}

    const closeBtn = makeTextButton(this, cx, panelY + panelH - 22, 'Close', () => {
      this.closePanel([title, campaignBtn, bossRushBtn, deepDiveBtn, swarmBtn, rangeBtn, desc, closeBtn]);
    });
    this.panel._extra = [title, campaignBtn, bossRushBtn, deepDiveBtn, swarmBtn, rangeBtn, desc, closeBtn];
  }

  openDifficultyPanel() {
    if (this.panel) return;
    const { width } = this.scale;
    const panelW = 320; const panelH = 260; const panelX = width / 2 - panelW / 2; const panelY = 90;
    this.panel = drawPanel(this, panelX, panelY, panelW, panelH);
    this.panel._type = 'difficultySelect';
    const title = this.add.text(width / 2, panelY + 20, 'Select Difficulty', { fontFamily: 'monospace', fontSize: 18, color: '#ffffff' }).setOrigin(0.5);

    const cx = width / 2;
    const y0 = panelY + 90;
    const line = 32;
    let current = this.gs?.difficulty || Difficulty.Normal;

    // Current difficulty hint between title and Easy button
    const midY = (panelY + 20 + y0) / 2;
    const currentLabel = this.add.text(cx, midY, `Current: ${current}`, {
      fontFamily: 'monospace', fontSize: 14, color: '#ffffff',
    }).setOrigin(0.5);

    // Description of how difficulty changes enemy stats (Normal as standard)
    const descLabel = this.add.text(cx, panelY + panelH - 64, '', {
      fontFamily: 'monospace', fontSize: 12, color: '#cccccc', wordWrap: { width: panelW - 40 }, align: 'center', lineSpacing: 2,
    }).setOrigin(0.5, 0.5);

    const applyDesc = () => {
      let text;
      if (current === Difficulty.Easy) {
        text = 'Easy: Enemies have 20% less HP and 50% damage.';
      } else if (current === Difficulty.Hard) {
        text = 'Hard: Enemies have 40% more HP and 2x damage.';
      } else {
        text = 'Normal: Standard enemy HP and damage.';
      }
      try { descLabel.setText(text); } catch (_) {}
    };
    applyDesc();

    const setDiff = (d) => {
      current = d;
      try { currentLabel.setText(`Current: ${current}`); } catch (_) {}
      try { this.gs.difficulty = current; SaveManager.saveToLocal(this.gs); } catch (_) {}
      applyDesc();
    };

    const easyBtn = makeTextButton(this, cx, y0 + 0 * line, 'Easy', () => setDiff(Difficulty.Easy));
    const normalBtn = makeTextButton(this, cx, y0 + 1 * line, 'Normal', () => setDiff(Difficulty.Normal));
    const hardBtn = makeTextButton(this, cx, y0 + 2 * line, 'Hard', () => setDiff(Difficulty.Hard));

    const closeBtn = makeTextButton(this, cx, panelY + panelH - 22, 'Close', () => {
      this.closePanel([title, easyBtn, normalBtn, hardBtn, currentLabel, descLabel, closeBtn]);
    });

      this.panel._extra = [title, easyBtn, normalBtn, hardBtn, currentLabel, descLabel, closeBtn];
    }

    openHintPanel() {
      // If a panel is already open, only allow one at a time
      if (this.panel && this.panel._type !== 'hint') {
        this.closePanel();
      } else if (this.panel && this.panel._type === 'hint') {
        return;
      }

      // Always refresh the hint list so code edits are reflected immediately
      // Order: general/modes -> weapons/cores -> survival/resources/abilities -> enemies/details
      this.hints = [
        // General game / modes
        '1#: Utilize the Shooting Range: you can spawn all kinds of enemies and use the dummy to test how different weapons perform.',
        '2#: Explore multiple modes: Campaign offers the most authentic experience, Deep Dive focuses on clearing waves, Swarm is a pure drone onslaught, and Boss Rush is dedicated to consecutive boss fights.',

        // Weapons, mods, cores
        '3#: Armor and armor mods are your main defensive upgrades. Investing in them can reduce incoming damage, improve survivability, and make mistakes more forgiving.',
        '4#: Each weapon handles differently. Some excel up close, others at long range—swap weapons when a room\'s layout doesn\'t suit your current gun.',
        '5#: Weapons with high fire rate develop heavy bullet spread during continuous fire. Use short, controlled bursts if you want to hit enemies from far away.',
        '6#: Explosive weapons are excellent at hitting groups of enemies. Aim at the ground or clustered targets to catch multiple enemies in a single blast.',
        '7#: Weapon cores can completely change a weapon\'s properties. Always read both the positive and negative effects of a core before committing it to a gun.',
        '8#: Guided weapons can be very precise. They may launch micromissiles that auto-lock on enemies, or require you to guide them manually toward their targets.',

        // Survival, resources, abilities
        '9#: Dash makes you briefly invincible. Use it to pass through continuous barrages or lasers instead of sidestepping them.',
        '10#: Your shield regenerates slowly over time. When the shield bar is emptied, get to cover immediately and wait for it to recharge before re-engaging.',
        '11#: You can increase your dash charges and reduce dash cooldown by purchasing dash slots, armor, and armor mods in the shop.',
        '12#: Abilities are crucial tools for surviving tough fights. Use them for crowd control, neutralizing projectiles, or finishing enemies up close.',

        // Enemies and behavior details
        '13#: Enemies that show an aim line before attacking usually have very precise or high-damage attacks. Use dash or barricades to avoid them.',
        '14#: Commanders can spawn extra enemies. When this happens, a purple halo appears on the map—track it down and destroy the Commander as soon as possible.',
        '15#: Chargers are extremely dangerous up close: they move very fast and deal high melee damage. If a Charger gets inside your minimal firing distance, dash aggressively to keep space and use melee to finish it when it closes the gap.',
        '16#: Rooks have an indestructible shield that covers a 90-degree arc. Rotate around to hit their backs, or use railguns and piercing shots to punch through the shield.',
        '17#: Prism can sweep the field with a high-damage laser. Dash through the laser to avoid damage, or stay behind barricades until the beam passes.',
        '18#: Bombardiers are deadly up close, but their grenades have short range. Fight them from a distance and be ready to dodge their suicide run when they are low on health.',
        '19#: Bigwig is a devastating boss that uses machineguns, grenade launchers, turrets, and area bombardment to control the arena. Always stay on the move, destroy turrets as soon as they appear, and get out of bombardment zones immediately.',
        '20#: Dandelion is a precise yet deadly menace. Keep moving and dashing to evade its laser machinegun, and be ready to dash when it charges in for a melee attack. Watch for the landmines it drops after dashing back, clear a safe path, and focus fire on any healing drones that appear.',
        '21#: Hazel is an experimental prototype drone that constantly uses teleportation. It can launch missiles that lock on to you—shoot them down, dodge them, or lure them into crashing on barricades. Hazel also teleports phase bombs nearby, so keep moving, and it warps in attack drones that must be destroyed before they overwhelm you. When you get too close, Hazel will teleport away, so be ready to chase or reposition.',
      ];

      // Ensure hintIndex is valid; choose random starting hint if not
      if (typeof this.hintIndex !== 'number' || this.hintIndex < 0 || this.hintIndex >= this.hints.length) {
        this.hintIndex = Math.floor(Math.random() * this.hints.length);
      }

      const { width } = this.scale;
      const panelW = 360; const panelH = 200; const panelX = width / 2 - panelW / 2; const panelY = 110;
      this.panel = drawPanel(this, panelX, panelY, panelW, panelH);
      this.panel._type = 'hint';

      const title = this.add.text(width / 2, panelY + 18, 'Hints', {
        fontFamily: 'monospace', fontSize: 16, color: '#ffffff',
      }).setOrigin(0.5);

      const cx = width / 2;
      const hintText = this.add.text(cx, panelY + 46, this.hints[this.hintIndex] || '', {
        fontFamily: 'monospace',
        fontSize: 12,
        color: '#cccccc',
        wordWrap: { width: panelW - 40 },
        align: 'left',
        lineSpacing: 2,
      }).setOrigin(0.5, 0);

      const btnY = panelY + panelH - 26;
      const prevBtn = makeTextButton(this, cx - 90, btnY, '<', () => {
        if (!this.hints.length) return;
        this.hintIndex = (this.hintIndex - 1 + this.hints.length) % this.hints.length;
        try { hintText.setText(this.hints[this.hintIndex] || ''); } catch (_) {}
      });

      const nextBtn = makeTextButton(this, cx + 90, btnY, '>', () => {
        if (!this.hints.length) return;
        this.hintIndex = (this.hintIndex + 1) % this.hints.length;
        try { hintText.setText(this.hints[this.hintIndex] || ''); } catch (_) {}
      });

      const closeBtn = makeTextButton(this, cx, btnY, 'Close', () => {
        this.closePanel([title, hintText, prevBtn, nextBtn, closeBtn]);
      });

      this.panel._extra = [title, hintText, prevBtn, nextBtn, closeBtn];
    }

  openCampaignStageMenu() {
    // Close existing menu if any
    if (this.panel) this.closePanel();
    const { width } = this.scale;
    const panelW = 300; const panelH = 220; const panelX = width / 2 - panelW / 2; const panelY = 100;
    this.panel = drawPanel(this, panelX, panelY, panelW, panelH);
    this.panel._type = 'campaignStageSelect';
    const title = this.add.text(width / 2, panelY + 18, 'Select Campaign Stage', { fontFamily: 'monospace', fontSize: 16, color: '#ffffff' }).setOrigin(0.5);
    const cx = width / 2; const y0 = panelY + 60; const line = 28;
    const gs = this.gs;
    const unlocked = Math.min(3, Math.max(1, (gs?.campaignCompleted ? 3 : (gs?.campaignMaxUnlocked || 1))));
    const mk = (iy, label, stage) => {
      const btn = makeTextButton(this, cx, y0 + iy * line, label, () => {
        try { this.gs.setGameMode('Normal'); this.gs.shootingRange = false; this.gs.campaignSelectedStage = stage; SaveManager.saveToLocal(this.gs); } catch (_) {}
        this.closePanel([title, s1, s2, s3, closeBtn]);
      });
      if (stage > unlocked) { try { btn.disableInteractive(); btn.setAlpha(0.4); } catch (_) {} }
      return btn;
    };
    const s1 = mk(0, 'Stage 1', 1);
    const s2 = mk(1, 'Stage 2', 2);
    const s3 = mk(2, 'Stage 3', 3);
    const closeBtn = makeTextButton(this, cx, panelY + panelH - 18, 'Close', () => { this.closePanel([title, s1, s2, s3, closeBtn]); });
    this.panel._extra = [title, s1, s2, s3, closeBtn];
  }

  closePanel(extra = []) {
    // Detach shop wheel handler if active
    try { if (this._shopWheelHandler) { this.input.off('wheel', this._shopWheelHandler); this._shopWheelHandler = null; } } catch (_) {}
    // Always destroy any extras tracked on the current panel
    const extras = [
      ...(Array.isArray(extra) ? extra : []),
      ...(this.panel && Array.isArray(this.panel._extra) ? this.panel._extra : []),
    ];
    if (this.panel) {
      this.panel.destroy();
      this.panel = null;
    }
    extras.forEach((o) => o?.destroy());
  }

  update() {
    // Update dash charge display for UI
    this.registry.set('dashCharges', this.dash.charges);
    // Dash regen progress for UI (0..1) for next slot
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

    const mv = this.inputMgr.moveVec;
    const now = this.time.now;
    if (this.inputMgr.pressedDash && now >= this.dash.cooldownUntil && this.dash.charges > 0) {
      const angle = (mv.x !== 0 || mv.y !== 0) ? Math.atan2(mv.y, mv.x) : this.playerFacing;
      const dashSpeed = 520;
      const dur = 180;
      this.dash.active = true; this.dash.until = now + dur; this.dash.cooldownUntil = now + 600;
      this.dash.vx = Math.cos(angle) * dashSpeed; this.dash.vy = Math.sin(angle) * dashSpeed;
      this.player.iframesUntil = now + dur;
      // Initialize dash trail start
      this._dashTrailLast = { x: this.player.x, y: this.player.y };
      this.dash.charges -= 1; this.dash.regen.push(now + (eff.dashRegenMs || this.gs.dashRegenMs));
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
      this.player.setVelocity(this.dash.vx, this.dash.vy);
    } else {
      this.dash.active = false;
      this._dashTrailLast = null;
      const speed = 160 * (eff.moveSpeedMult || 1);
      this.player.setVelocity(mv.x * speed, mv.y * speed);
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

    // Interaction
    const nearNpc = Phaser.Geom.Intersects.RectangleToRectangle(this.player.getBounds(), this.npcZone.getBounds());
    const nearModeNpc = Phaser.Geom.Intersects.RectangleToRectangle(this.player.getBounds(), this.modeNpcZone.getBounds());
    let nearPortal = false;
    try {
      const dxp = this.player.x - this.portalZone.x;
      const dyp = this.player.y - this.portalZone.y;
      const r = 80;
      nearPortal = (dxp * dxp + dyp * dyp) <= (r * r);
    } catch (_) {}
    const nearBonus = this.bonusZone ? Phaser.Geom.Intersects.RectangleToRectangle(this.player.getBounds(), this.bonusZone.getBounds()) : false;
    const nearDiffTerminal = Phaser.Geom.Intersects.RectangleToRectangle(this.player.getBounds(), this.diffTerminalZone.getBounds());
    const nearHintNpc = Phaser.Geom.Intersects.RectangleToRectangle(this.player.getBounds(), this.hintNpcZone.getBounds());
    if (nearBonus && !this.gs._bonusClaimed) this.prompt.setText('E: Claim Bonus');
    else if (nearNpc) this.prompt.setText('E: Shop');
    else if (nearModeNpc) this.prompt.setText('E: Select Mode');
    else if (nearDiffTerminal) this.prompt.setText('E: Difficulty');
    else if (nearHintNpc) this.prompt.setText('E: Hint');
    else if (nearPortal) {
      if (this.gs?.gameMode === 'BossRush') this.prompt.setText('E: Enter Boss');
      else if (this.gs?.shootingRange) this.prompt.setText('E: Enter Range');
      else this.prompt.setText('E: Enter Combat');
    }
    else {
      try {
        if (this.gs?.shootingRange) this.prompt.setText('Mode: Shooting Range');
        else if (this.gs?.gameMode === 'BossRush') this.prompt.setText('Mode: Boss Rush');
        else if (this.gs?.gameMode === 'DeepDive') this.prompt.setText('Mode: Deep Dive');
        else if (this.gs?.gameMode === 'Swarm') this.prompt.setText('Mode: Swarm');
        else this.prompt.setText('Mode: Campaign');
      } catch (_) { this.prompt.setText('Mode: Campaign'); }
    }

    // Keep Deep Dive best record label updated every frame while in Hub
    try {
      const ui = this.scene.get(SceneKeys.UI);
      if (ui) {
        if (!ui.deepDiveText || !ui.deepDiveText.active) {
          ui.deepDiveText = ui.add.text(12, 28, '', { fontFamily: 'monospace', fontSize: 12, color: '#66ffcc' }).setOrigin(0, 0).setAlpha(0.95);
        }
        if (this.gs?.gameMode === 'DeepDive') {
          const best = this.gs?.deepDiveBest || { level: 0, stage: 0 };
          const L = Math.max(0, best.level || 0);
          const S = Math.max(0, Math.min(4, best.stage || 0));
          ui.deepDiveText.setText(`Deepest dive: ${L}-${S}`);
          ui.deepDiveText.setVisible(true);
        } else {
          ui.deepDiveText.setVisible(false);
        }
      }
    } catch (_) {}

    // Keep Swarm best record label updated every frame while in Hub
    try {
      const ui = this.scene.get(SceneKeys.UI);
      if (ui) {
        if (!ui.swarmText || !ui.swarmText.active) {
          ui.swarmText = ui.add.text(12, 28, '', { fontFamily: 'monospace', fontSize: 12, color: '#66ffcc' }).setOrigin(0, 0).setAlpha(0.95);
        }
        if (this.gs?.gameMode === 'Swarm') {
          const best = this.gs?.swarmBest || { level: 0 };
          const L = Math.max(0, best.level || 0);
          ui.swarmText.setText(`Deepest swarm: ${L}`);
          ui.swarmText.setVisible(true);
        } else {
          ui.swarmText.setVisible(false);
        }
      }
    } catch (_) {}

    // Keep Campaign label updated dynamically while in Hub
    try {
      const ui = this.scene.get(SceneKeys.UI);
      if (ui) {
        if (!ui.campaignText || !ui.campaignText.active) {
          ui.campaignText = ui.add.text(12, 28, '', { fontFamily: 'monospace', fontSize: 12, color: '#66ffcc' }).setOrigin(0, 0).setAlpha(0.95);
        }
        if (this.gs?.gameMode === 'Normal') {
          const st = Math.max(1, this.gs?.campaignSelectedStage || 1);
          const completed = !!this.gs?.campaignCompleted;
          ui.campaignText.setText(completed ? 'Campaign: Completed' : `Campaign: Stage ${st}`);
          ui.campaignText.setVisible(true);
        } else {
          ui.campaignText.setVisible(false);
        }
      }
    } catch (_) {}

    // Keep Boss Rush label updated dynamically while in Hub
    try {
      const ui = this.scene.get(SceneKeys.UI);
      if (ui) {
        if (!ui.bossRushText || !ui.bossRushText.active) {
          ui.bossRushText = ui.add.text(12, 28, '', { fontFamily: 'monospace', fontSize: 12, color: '#66ffcc' }).setOrigin(0, 0).setAlpha(0.95);
        }
        if (this.gs?.gameMode === 'BossRush') {
          const left = Array.isArray(this.gs?.bossRushQueue) ? this.gs.bossRushQueue.length : 0;
          ui.bossRushText.setText(left === 0 ? 'Boss Rush Completed' : 'Boss Rush Not Completed');
          ui.bossRushText.setVisible(true);
        } else {
          ui.bossRushText.setVisible(false);
        }
      }
    } catch (_) {}

    // Auto-close the conversation box if player moves away from NPC
    if (this.panel && this.panel._type === 'npcPrompt') {
      const dx = this.player.x - this.npcZone.x;
      const dy = this.player.y - this.npcZone.y;
      const dist = Math.hypot(dx, dy);
      const closeDist = 100; // pixels threshold to auto-close
      if (dist > closeDist) {
        this.closePanel();
      }
    }

    if (this.inputMgr.pressedInteract) {
      if (nearBonus && !this.gs._bonusClaimed) {
        this.gs.gold = (this.gs.gold || 0) + 5000;
        this.gs.droneCores = (this.gs.droneCores || 0) + 20;
        this.gs._bonusClaimed = true;
        try { SaveManager.saveToLocal(this.gs); } catch (_) {}
        try { this.bonusG.clear(); this.bonusG.fillStyle(0x444444, 1).fillRect(this.bonusZone.x - 10, this.bonusZone.y - 10, 20, 20); } catch (_) {}
      }
        if (nearNpc) this.openNpcPanel();
        if (nearModeNpc) this.openModePanel();
        if (nearDiffTerminal) this.openDifficultyPanel();
        if (nearHintNpc) this.openHintPanel();
      if (nearPortal) {
        let next = (this.gs?.gameMode === 'BossRush') ? SceneKeys.Combat : SceneKeys.Combat;
        // Ensure Boss Rush queue is ready when entering boss portal
        try {
          if (this.gs?.gameMode === 'BossRush' && (!Array.isArray(this.gs.bossRushQueue) || this.gs.bossRushQueue.length === 0)) {
            this.gs.setGameMode('BossRush');
          }
        } catch (_) {}
        this.gs.nextScene = (this.gs?.gameMode === 'BossRush') ? 'Boss' : 'Combat';
        SaveManager.saveToLocal(this.gs);
        if (this.gs?.gameMode === 'BossRush') {
          let bossId = 'Dandelion';
          try { if (typeof this.gs.chooseBossType === 'function') bossId = this.gs.chooseBossType(); } catch (_) {}
          this.scene.start(SceneKeys.Combat, { bossRoom: true, bossId });
        } else {
          this.scene.start(SceneKeys.Combat);
        }
      }
    }

    // No deep dive tracker in Hub; handled by CombatScene only.

    // Allow swapping weapons in the Hub with Q
    if (Phaser.Input.Keyboard.JustDown(this.inputMgr.keys.q)) {
      const slots = this.gs.equippedWeapons || [];
      const a = this.gs.activeWeapon;
      if (slots[0] && slots[1]) {
        this.gs.activeWeapon = a === slots[0] ? slots[1] : slots[0];
      } // else: do nothing when fewer than two equipped
    }
  }
}

