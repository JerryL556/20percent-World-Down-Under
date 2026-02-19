import { SceneKeys } from '../core/SceneKeys.js';
import { preloadWeaponAssets } from '../systems/WeaponVisuals.js';

export default class BootScene extends Phaser.Scene {
  constructor() { super(SceneKeys.Boot); }
  preload() {
    // Load external PNG assets for weapons
    try { preloadWeaponAssets(this); } catch (_) {}
    // Load player/NPC PNG assets
    try {
      const A = (k, p) => { if (!this.textures.exists(k)) this.load.image(k, p); };
      A('player_inle', 'assets/Inle.png');
      A('npc_shop', 'assets/Shop.png');
      A('npc_mode', 'assets/Mode.png');
      A('title_logo', 'assets/TITLE.png');

      A('dummy_target', 'assets/Dummy.png');
      A('turret_base', 'assets/Turret Base.png');
      A('turret_head', 'assets/Turret Head.png');
    } catch (_) {}
    // Load player PNG asset
    try {
      const A = (k, p) => { if (!this.textures.exists(k)) this.load.image(k, p); };
      A('player_inle', 'assets/Inle.png');
    } catch (_) {}
    // Load enemy PNG assets (non-boss)
    try {
      const A = (k, p) => { if (!this.textures.exists(k)) this.load.image(k, p); };
      A('enemy_shredder', 'assets/Shredder.png');       // base melee
      A('enemy_charger', 'assets/Charger.png');         // runner
      A('enemy_gunner', 'assets/Gunner.png');           // shooter
      A('enemy_machine_gunner', 'assets/MachineGunner.png');
      A('enemy_rocketeer', 'assets/Rocketeer.png');
      A('enemy_sniper', 'assets/Sniper.png');
      A('enemy_prism', 'assets/Prism.png');
      A('enemy_commander', 'assets/Commander.png');     // snitch
      A('enemy_rook', 'assets/Rook.png');
      A('enemy_bombardier', 'assets/Bombardier.png');   // grenadier
      A('enemy_bombardier_special', 'assets/BombardierSpecial.png');
      A('enemy_heal_drone', 'assets/HealDrone.png');
      A('enemy_laser_drone', 'assets/LaserDrone.png');
    } catch (_) {}
    // Backgrounds
    try {
      if (!this.textures.exists('bg_normal')) this.load.image('bg_normal', 'assets/Normal Background.png');
      if (!this.textures.exists('bg_boss')) this.load.image('bg_boss', 'assets/Boss Background.png');
    } catch (_) {}
    // Boss intro art (keys exactly the boss IDs) and shared terminals/NPCs
    try {
      const A = (k, p) => { if (!this.textures.exists(k)) this.load.image(k, p); };
      A('Bigwig', 'assets/Bigwig.png');
      A('Dandelion', 'assets/Dandelion.png');
      A('Hazel', 'assets/Hazel.png');
      A('diff_terminal', 'assets/Terminal.png');
      A('hub_drill', 'assets/Drill.png');
      A('Woundwort', 'assets/Woundwort.png');
    } catch (_) {}
    // Audio
    try {
      if (!this.cache.audio.exists('bgm_boss')) this.load.audio('bgm_boss', 'assets/AUDIO/BOSS.mp3');
      if (!this.cache.audio.exists('bgm_campaign')) this.load.audio('bgm_campaign', 'assets/AUDIO/CAMPAIGN.mp3');
      if (!this.cache.audio.exists('bgm_hub')) this.load.audio('bgm_hub', 'assets/AUDIO/HUB.mp3');
      if (!this.cache.audio.exists('bgm_infinite')) this.load.audio('bgm_infinite', 'assets/AUDIO/INFINITE.mp3');
      if (!this.textures.exists('volume_up_fx')) this.load.image('volume_up_fx', 'assets/AUDIO/Up.png');
      if (!this.textures.exists('volume_down_fx')) this.load.image('volume_down_fx', 'assets/AUDIO/Down.png');
    } catch (_) {}
    // Generate simple textures used by bullets and optional sprites
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.clear(); g.fillStyle(0xffffff, 1); g.fillRect(0, 0, 4, 4);
    g.generateTexture('bullet', 4, 4);
    g.clear(); g.fillStyle(0xffffff, 1); g.fillRect(0, 0, 12, 12);
    g.generateTexture('player_square', 12, 12);
    g.clear(); g.fillStyle(0xff4444, 1); g.fillRect(0, 0, 12, 12);
    g.generateTexture('enemy_square', 12, 12);
    // Portal (simple ring)
    g.clear();
    g.fillStyle(0x00ffcc, 0.25); g.fillCircle(12, 12, 12);
    g.lineStyle(2, 0x22ff88, 1).strokeCircle(12, 12, 10);
    g.generateTexture('portal', 24, 24);
    // Wall tile
    g.clear(); g.fillStyle(0x666666, 1); g.fillRect(0, 0, 16, 16);
    g.lineStyle(1, 0x999999, 1).strokeRect(0, 0, 16, 16);
    g.generateTexture('wall_tile', 16, 16);
    // Barricade tiles
    // Destructible (light brown)
    g.clear(); g.fillStyle(0xC8A165, 1); g.fillRect(0, 0, 16, 16);
    g.lineStyle(1, 0x9c7b4a, 1).strokeRect(0, 0, 16, 16);
    g.generateTexture('barricade_soft', 16, 16);
    // Indestructible (light grey)
    g.clear(); g.fillStyle(0xBBBBBB, 1); g.fillRect(0, 0, 16, 16);
    g.lineStyle(1, 0x8f8f8f, 1).strokeRect(0, 0, 16, 16);
    g.generateTexture('barricade_hard', 16, 16);
    // BITs particle (small green circle for spawn burst)
    g.clear();
    g.fillStyle(0x33ff66, 1);
    g.fillCircle(4, 4, 4);
    g.generateTexture('bit_particle', 8, 8);
    g.destroy();
  }
  create() {
    this.scene.start(SceneKeys.Start);
  }
}

