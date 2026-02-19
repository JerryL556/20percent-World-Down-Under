import { RNG } from './RNG.js';

export const Difficulty = Object.freeze({
  Easy: 'Easy',
  Normal: 'Normal',
  Hard: 'Hard',
});

export function difficultyModifiers(diff) {
  switch (diff) {
    case Difficulty.Easy:
      return { enemyHp: 0.8, enemyDamage: 0.5 };
    case Difficulty.Hard:
      return { enemyHp: 1.4, enemyDamage: 2.0 };
    case Difficulty.Normal:
    default:
      return { enemyHp: 1.0, enemyDamage: 1.0 };
  }
}

export class GameState {
  constructor() {
    this.gold = 1000;
    this.droneCores = 3; // secondary currency for cores
    this.xp = 0;
    this.maxHp = 100;
    this.hp = 100;
    // Energy Shield (Standard Issue baseline)
    this.shieldMax = 50;
    this.shield = 50;
    this.shieldRegenPerSec = 4; // points per second
    this.shieldRegenDelayMs = 4000; // delay before regen starts
    this.lastDamagedAt = 0; // timestamp when last damaged (ms)
    this.allowOverrun = true; // leftover damage spills to HP
    // Equipment & loadout
    // Two weapon slots; active is the one currently used for shooting
    this.ownedWeapons = ['pistol'];
    this.equippedWeapons = ['pistol', null]; // ids or null
    this.activeWeapon = 'pistol'; // mirrors currently active equipped weapon
    // Armour slot
    this.ownedArmours = [];
    this.armour = { id: null, mods: [null, null] };
    // Per-weapon build: mods (3) + core (1); keyed by weaponId
    this.weaponBuilds = {}; // weaponId -> { mods: [m1,m2,m3], core: coreId }
    // Ownership collections for shop-gated content
    this.ownedWeaponMods = [];
    this.ownedWeaponCores = [];
    this.ownedArmourMods = [];
    this.difficulty = Difficulty.Normal;
    this.runSeed = Date.now() >>> 0;
    this.rng = new RNG(this.runSeed);
    this.roomsClearedInCycle = 0; // after 3, spawn boss
    this.currentDepth = 1; // increments per combat
    this.achievements = {};
    this.nextScene = 'Hub';
    // Game mode: 'Normal' or 'BossRush'
    this.gameMode = 'Normal';
    // Campaign progression (Normal mode): replayable stages 1..3
    this.campaignSelectedStage = 1; // current stage to play
    this.campaignMaxUnlocked = 1;   // highest unlocked stage
    this.campaignCompleted = false;
    // Deep Dive state
    this.deepDive = { level: 1, stage: 1, baseNormal: 5, baseElite: 1 };
    // Best Deep Dive record (persists across runs until improved)
    this.deepDiveBest = { level: 0, stage: 0 };
    // Swarm state
    this.swarm = { level: 1 };
    // Best Swarm record (persists across runs until improved)
    this.swarmBest = { level: 0 };
    // Boss Rush sequence queue (array of boss type strings)
    this.bossRushQueue = [];
    // Boss Rush completion flag (per-run)
    this.bossRushCompleted = false;
    // Track last spawned boss type in Normal mode to alternate
    this.lastBossType = null; // 'Shotgunner' | 'Dasher' | null
    // Ability equipped (gadget)
    this.abilityId = 'ads';
    // Owned abilities for shop gating (default: ADS)
    this.ownedAbilities = ['ads'];
    // Ability upgrades by abilityId:
    // { [id]: { selectedPath: null|'pathA'|'pathB', pathA: { minor, major }, pathB: { minor, major } } }
    this.abilityUpgrades = {};
    // Dash settings
    this.dashMaxCharges = 3;
    this.dashRegenMs = 6000;
    // Audio volume settings (0..1), final music volume = master * track
    this.audioVolumes = {
      master: 1,
      hub: 0.7,
      campaign: 0.7,
      boss: 0.7,
      infinite: 0.7,
    };
  }

  startNewRun(seed, difficulty) {
    this.gold = 1000;
    this.droneCores = 3;
    this.xp = 0;
    this.maxHp = 100;
    this.hp = 100;
    this.shieldMax = 50;
    this.shield = 50;
    this.shieldRegenPerSec = 4;
    this.shieldRegenDelayMs = 4000;
    this.lastDamagedAt = 0;
    this.allowOverrun = true;
    this.ownedWeapons = ['pistol'];
    this.equippedWeapons = ['pistol', null];
    this.activeWeapon = 'pistol';
    this.armour = { id: null, mods: [null, null] };
    this.weaponBuilds = {};
    this.ownedWeaponMods = [];
    this.ownedWeaponCores = [];
    this.ownedArmourMods = [];
    if (seed) this.runSeed = seed >>> 0;
    if (difficulty) this.difficulty = difficulty;
    this.ownedArmours = [];
    this.rng = new RNG(this.runSeed);
    this.roomsClearedInCycle = 0;
    this.currentDepth = 1;
    this.nextScene = 'Hub';
    this.gameMode = 'Normal';
    this.campaignSelectedStage = 1;
    this.campaignMaxUnlocked = 1;
    this.campaignCompleted = false;
    this.deepDive = { level: 1, stage: 1, baseNormal: 5, baseElite: 1 };
    this.swarm = { level: 1 };
    this.bossRushQueue = [];
    this.lastBossType = null;
    this.abilityId = 'ads';
    this.ownedAbilities = ['ads'];
    this.abilityUpgrades = {};
    this.dashMaxCharges = 3;
    this.dashRegenMs = 6000;
  }

  getDifficultyMods() {
    return difficultyModifiers(this.difficulty);
  }

  progressAfterCombat() {
    // Mode-specific progression
    if (this.gameMode === 'BossRush') {
      // Not used in BossRush; keep safe default to Boss
      this.nextScene = 'Boss';
      return;
    }
    if (this.gameMode === 'DeepDive') {
      const dd = this.deepDive || { level: 1, stage: 1, baseNormal: 5, baseElite: 1 };
      if (dd.stage < 4) {
        dd.stage += 1;
      } else {
        // Next level
        dd.level += 1;
        dd.stage = 1;
        // Increase baseline normal by 1
        dd.baseNormal += 1;
        // Increase baseline elites if new normal per last elite > 4 (strictly greater)
        const ratio = dd.baseNormal / Math.max(1, dd.baseElite);
        if (ratio > 4) dd.baseElite += 1;
      }
      this.deepDive = dd;
      this.nextScene = 'Combat';
      return;
    }
    if (this.gameMode === 'Swarm') {
      const sw = this.swarm || { level: 1 };
      sw.level = Math.max(1, (sw.level || 1) + 1);
      this.swarm = sw;
      this.currentDepth += 1;
      this.nextScene = 'Combat';
      return;
    }
    // Normal (Campaign) mode: 3 rooms then a boss (1-1,1-2,1-3 -> 1-4 boss per stage)
    this.roomsClearedInCycle += 1;
    this.currentDepth += 1;
    if (this.roomsClearedInCycle >= 3) { this.roomsClearedInCycle = 0; this.nextScene = 'Boss'; }
    else { this.nextScene = 'Combat'; }
  }

  progressAfterBoss() {
    if (this.gameMode === 'BossRush') {
      // Remove the defeated boss and decide next
      if (Array.isArray(this.bossRushQueue) && this.bossRushQueue.length > 0) {
        this.bossRushQueue = this.bossRushQueue.slice(1);
      }
      if (this.bossRushQueue && this.bossRushQueue.length > 0) {
        this.nextScene = 'Boss';
      } else {
        // Finished all bosses in this Boss Rush run
        this.bossRushCompleted = true;
        this.nextScene = 'Hub';
      }
      return;
    }
    // Campaign (Normal) mode: unlock next stage on victory; selected stage doesn't auto-increment
    if (this.gameMode === 'Normal') {
      if (!this.campaignCompleted) {
        const sel = Math.max(1, Math.min(3, this.campaignSelectedStage || 1));
        this.campaignMaxUnlocked = Math.max(this.campaignMaxUnlocked || 1, sel);
        if ((this.campaignMaxUnlocked < 3) && (sel >= this.campaignMaxUnlocked)) {
          this.campaignMaxUnlocked += 1;
        }
        if (this.campaignMaxUnlocked >= 3 && sel === 3) this.campaignCompleted = true;
      }
      this.nextScene = 'Hub';
      return;
    }
    this.nextScene = 'Hub';
  }

  // Decide the next boss type for spawning (does not mutate queues except to init BossRush)
  chooseBossType() {
    if (this.gameMode === 'BossRush') {
      if (!Array.isArray(this.bossRushQueue) || this.bossRushQueue.length === 0) {
        this.setGameMode('BossRush');
      }
      return (this.bossRushQueue && this.bossRushQueue[0]) ? this.bossRushQueue[0] : 'Dandelion';
    }
    // Campaign (Normal) mode: fixed per-stage boss order: 1=Bigwig, 2=Dandelion, 3=Hazel
    const st = Math.max(1, Math.min(3, typeof this.campaignSelectedStage === 'number' ? this.campaignSelectedStage : 1));
    if (st === 1) return 'Bigwig';
    if (st === 2) return 'Dandelion';
    return 'Hazel';
  }

  // Change game mode and initialize any mode-specific state
  setGameMode(mode) {
    if (mode === 'BossRush') {
      this.gameMode = 'BossRush';
      // Fixed order: Bigwig (stage 1), Dandelion (stage 2), Hazel (stage 3)
      this.bossRushQueue = ['Bigwig', 'Dandelion', 'Hazel'];
      this.roomsClearedInCycle = 0;
      this.currentDepth = 1;
      this.nextScene = 'Boss';
    } else if (mode === 'DeepDive') {
      this.gameMode = 'DeepDive';
      this.deepDive = { level: 1, stage: 1, baseNormal: 5, baseElite: 1 };
      this.roomsClearedInCycle = 0;
      this.currentDepth = 1;
      this.nextScene = 'Combat';
    } else if (mode === 'Swarm') {
      this.gameMode = 'Swarm';
      this.swarm = { level: 1 };
      this.roomsClearedInCycle = 0;
      this.currentDepth = 1;
      this.nextScene = 'Combat';
    } else {
      this.gameMode = 'Normal';
      this.bossRushQueue = [];
      this.roomsClearedInCycle = 0;
      this.currentDepth = 1;
      this.nextScene = 'Hub';
      if (typeof this.campaignSelectedStage !== 'number' || this.campaignSelectedStage < 1) this.campaignSelectedStage = 1;
      if (typeof this.campaignMaxUnlocked !== 'number' || this.campaignMaxUnlocked < 1) this.campaignMaxUnlocked = 1;
      if (typeof this.campaignCompleted !== 'boolean') this.campaignCompleted = false;
    }
  }

  serialize() {
    return {
      gold: this.gold,
      droneCores: this.droneCores,
      xp: this.xp,
      maxHp: this.maxHp,
      hp: this.hp,
      shieldMax: this.shieldMax,
      shield: this.shield,
      shieldRegenPerSec: this.shieldRegenPerSec,
      shieldRegenDelayMs: this.shieldRegenDelayMs,
      lastDamagedAt: this.lastDamagedAt,
      allowOverrun: this.allowOverrun,
      ownedWeapons: this.ownedWeapons,
      equippedWeapons: this.equippedWeapons,
      activeWeapon: this.activeWeapon,
      armour: this.armour,
      ownedArmours: this.ownedArmours,
      weaponBuilds: this.weaponBuilds,
      ownedWeaponMods: this.ownedWeaponMods,
      ownedWeaponCores: this.ownedWeaponCores,
      ownedArmourMods: this.ownedArmourMods,
      difficulty: this.difficulty,
      runSeed: this.runSeed,
      roomsClearedInCycle: this.roomsClearedInCycle,
      currentDepth: this.currentDepth,
      achievements: this.achievements,
      nextScene: this.nextScene,
      gameMode: this.gameMode,
      campaignSelectedStage: this.campaignSelectedStage,
      campaignMaxUnlocked: this.campaignMaxUnlocked,
      campaignCompleted: this.campaignCompleted,
      deepDive: this.deepDive,
      deepDiveBest: this.deepDiveBest,
      swarm: this.swarm,
      swarmBest: this.swarmBest,
      bossRushQueue: this.bossRushQueue,
      bossRushCompleted: this.bossRushCompleted,
      lastBossType: this.lastBossType,
      abilityId: this.abilityId,
      ownedAbilities: this.ownedAbilities,
      abilityUpgrades: this.abilityUpgrades,
      dashMaxCharges: this.dashMaxCharges,
      dashRegenMs: this.dashRegenMs,
      audioVolumes: this.audioVolumes,
    };
  }

  static deserialize(obj) {
    const gs = new GameState();
    Object.assign(gs, obj);
    if (typeof gs.xp !== 'number') gs.xp = 0;
    if (typeof gs.droneCores !== 'number') gs.droneCores = 1;
    gs.rng = new RNG(gs.runSeed);
    if (!gs.deepDiveBest) gs.deepDiveBest = { level: 0, stage: 0 };
    if (!gs.swarmBest) gs.swarmBest = { level: 0 };
    if (typeof gs.bossRushCompleted !== 'boolean') gs.bossRushCompleted = false;
    if (!gs.ownedWeapons) gs.ownedWeapons = ['pistol'];
    if (!gs.equippedWeapons || !Array.isArray(gs.equippedWeapons)) gs.equippedWeapons = [gs.ownedWeapons[0] || 'pistol', null];
    if (!gs.activeWeapon) gs.activeWeapon = gs.equippedWeapons[0] || gs.ownedWeapons[0] || 'pistol';
    if (!gs.armour) gs.armour = { id: null, mods: [null, null] };
    if (!Array.isArray(gs.ownedArmours)) gs.ownedArmours = [];
    if (!gs.weaponBuilds) gs.weaponBuilds = {};
    if (!Array.isArray(gs.ownedWeaponMods)) gs.ownedWeaponMods = [];
    if (!Array.isArray(gs.ownedWeaponCores)) gs.ownedWeaponCores = [];
    if (!Array.isArray(gs.ownedArmourMods)) gs.ownedArmourMods = [];
    gs.dashMaxCharges = Math.min(gs.dashMaxCharges || 3, 5);
    gs.dashRegenMs = Math.max(gs.dashRegenMs || 6000, 6000);
    if (!gs.gameMode) gs.gameMode = 'Normal';
    if (typeof gs.campaignSelectedStage !== 'number' || gs.campaignSelectedStage < 1) gs.campaignSelectedStage = 1;
    if (typeof gs.campaignMaxUnlocked !== 'number' || gs.campaignMaxUnlocked < 1) gs.campaignMaxUnlocked = 1;
    if (typeof gs.campaignCompleted !== 'boolean') gs.campaignCompleted = false;
    if (!Array.isArray(gs.bossRushQueue)) gs.bossRushQueue = [];
    if (!gs.deepDive || typeof gs.deepDive !== 'object') gs.deepDive = { level: 1, stage: 1, baseNormal: 5, baseElite: 1 };
    if (!gs.swarm || typeof gs.swarm !== 'object') gs.swarm = { level: 1 };
    // Clamp Deep Dive fields
    if (typeof gs.deepDive.level !== 'number' || gs.deepDive.level < 1) gs.deepDive.level = 1;
    if (typeof gs.deepDive.stage !== 'number' || gs.deepDive.stage < 1 || gs.deepDive.stage > 4) gs.deepDive.stage = 1;
    if (typeof gs.deepDive.baseNormal !== 'number' || gs.deepDive.baseNormal < 1) gs.deepDive.baseNormal = 5;
    if (typeof gs.deepDive.baseElite !== 'number' || gs.deepDive.baseElite < 1) gs.deepDive.baseElite = 1;
    if (typeof gs.swarm.level !== 'number' || gs.swarm.level < 1) gs.swarm.level = 1;
    if (!('lastBossType' in gs)) gs.lastBossType = null;
    if (!gs.abilityId) gs.abilityId = 'ads';
    // Ensure ability ownership defaults and consistency
    if (!Array.isArray(gs.ownedAbilities)) gs.ownedAbilities = ['ads'];
    if (!gs.ownedAbilities.includes('ads')) gs.ownedAbilities.push('ads');
    if (!gs.abilityUpgrades || typeof gs.abilityUpgrades !== 'object') gs.abilityUpgrades = {};
    // If equipped ability is not owned, fall back to ADS
    if (!gs.ownedAbilities.includes(gs.abilityId)) gs.abilityId = 'ads';
    // Ensure shield defaults
    if (typeof gs.shieldMax !== 'number') gs.shieldMax = 20;
    if (typeof gs.shield !== 'number') gs.shield = Math.min(gs.shieldMax, 20);
    if (typeof gs.shieldRegenPerSec !== 'number') gs.shieldRegenPerSec = 4;
    if (typeof gs.shieldRegenDelayMs !== 'number') gs.shieldRegenDelayMs = 4000;
    if (typeof gs.lastDamagedAt !== 'number') gs.lastDamagedAt = 0;
    if (typeof gs.allowOverrun !== 'boolean') gs.allowOverrun = true;
    if (!gs.audioVolumes || typeof gs.audioVolumes !== 'object') {
      gs.audioVolumes = { master: 1, hub: 0.7, campaign: 0.7, boss: 0.7, infinite: 0.7 };
    }
    const clamp01 = (v, d) => (typeof v === 'number' && Number.isFinite(v)) ? Math.max(0, Math.min(1, v)) : d;
    gs.audioVolumes.master = clamp01(gs.audioVolumes.master, 1);
    gs.audioVolumes.hub = clamp01(gs.audioVolumes.hub, 0.7);
    gs.audioVolumes.campaign = clamp01(gs.audioVolumes.campaign, 0.7);
    gs.audioVolumes.boss = clamp01(gs.audioVolumes.boss, 0.7);
    gs.audioVolumes.infinite = clamp01(gs.audioVolumes.infinite, 0.7);
    return gs;
  }
}


