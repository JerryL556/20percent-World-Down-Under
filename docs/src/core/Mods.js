// Simple, customizable mod/core system. Extend these lists as you add content.

// Weapon normal mods (3 slots)
export const weaponMods = [
  { id: null, name: 'Empty', desc: 'No changes', apply: (w) => w },
  { id: 'w_dmg_up', name: 'FMJ Rounds', desc: '+10% damage', apply: (w) => ({ ...w, damage: Math.floor(w.damage * 1.1) }) },
  { id: 'w_firerate_up', name: 'Custom Trigger', desc: '+12% fire rate', allow: (base) => !!base && !base.isFlamethrower && base.projectile !== 'rocket', apply: (w) => ({ ...w, fireRateMs: Math.max(60, Math.floor(w.fireRateMs * 0.88)) }) },
  {
    id: 'w_spread_down',
    name: 'Muzzle Brake',
    desc: '-20% spread angle & bloom cap',
    // Not applicable to Laser or rocket-projectile weapons (e.g., Rocket/MGL)
    allow: (base) => !!base && !base.isLaser && !base.isFlamethrower && base.projectile !== 'rocket',
    apply: (w) => {
      const newBase = Math.max(0, Math.floor((w.spreadDeg || 0) * 0.8));
      const hasMax = typeof w.maxSpreadDeg === 'number';
      const newMax = hasMax ? Math.max(0, Math.floor(w.maxSpreadDeg * 0.8)) : undefined;
      return hasMax ? { ...w, spreadDeg: newBase, maxSpreadDeg: newMax } : { ...w, spreadDeg: newBase };
    },
  },
  
  { id: 'w_speed_up', name: 'Advanced Propellant', desc: '+15% bullet speed', allow: (base) => !!base && !base.isLaser && !base.isFlamethrower, apply: (w) => ({ ...w, bulletSpeed: Math.floor(w.bulletSpeed * 1.15) }) },
  // (Incendiary/Toxic moved to cores per design)
  {
    id: 'w_mag_improved',
    name: 'Improved Magazine',
    desc: [
      '+10% magazine size',
      '-30% reload time',
    ].join('\n'),
    allow: (base) => {
      if (!base) return false;
      const id = base.id;
      const explosive = base.projectile === 'rocket' || id === 'mgl' || id === 'rocket';
      return !base.isLaser && !base.isRailgun && !explosive;
    },
    apply: (w) => {
      if (!w) return w;
      const id = w.id; const explosive = w.projectile === 'rocket' || id === 'mgl' || id === 'rocket';
      if (w.isLaser || w.isRailgun || explosive) return w;
      const mag = Math.max(1, Math.ceil((w.magSize || 1) * 1.1));
      const baseReload = (typeof w.reloadMs === 'number') ? w.reloadMs : ((w.projectile === 'rocket') ? 1000 : 1500);
      const reloadMs = Math.max(200, Math.floor(baseReload * 0.7));
      return { ...w, magSize: mag, reloadMs, _magRoundUp: true };
    },
  },
  {
    id: 'w_mag_extended',
    name: 'Extended Magazine',
    desc: [
      '+30% magazine size',
    ].join('\n'),
    allow: (base) => {
      if (!base) return false;
      const id = base.id;
      const explosive = base.projectile === 'rocket' || id === 'mgl' || id === 'rocket';
      return !base.isLaser && !base.isRailgun && !explosive;
    },
    apply: (w) => {
      if (!w) return w;
      const id = w.id; const explosive = w.projectile === 'rocket' || id === 'mgl' || id === 'rocket';
      if (w.isLaser || w.isRailgun || explosive) return w;
      const mag = Math.max(1, Math.ceil((w.magSize || 1) * 1.3));
      return { ...w, magSize: mag, _magRoundUp: true };
    },
  },
  {
    id: 'w_stun_ammo',
    name: 'Stun Ammunition',
    desc: [
      '+ Bullets apply Stun buildup on hit',
      '-10% bullet speed',
    ].join('\n'),
    allow: (base) => {
      if (!base) return false;
      return !base.isLaser && !base.isFlamethrower;
    },
    apply: (w) => {
      if (!w) return w;
      if (w.isLaser) return w;
      const heavy = (w.id === 'railgun') || (w.id === 'mgl') || (w.id === 'rocket') || (w.projectile === 'rocket');
      const stun = heavy ? 10 : 2;
      const bs = Math.max(0, Math.floor((w.bulletSpeed || 0) * 0.9));
      return { ...w, bulletSpeed: bs, _stunOnHit: stun };
    },
  },
  {
    id: 'w_laser_heatsink',
    name: 'Quick Swap HeatSink',
    desc: [
      '-30% reload time (overheat cooldown)',
    ].join('\n'),
    // Laser only
    allow: (base) => !!base && !!base.isLaser,
    apply: (w) => {
      if (!w || !w.isLaser) return w;
      const baseReload = (typeof w.reloadMs === 'number') ? w.reloadMs : 2000;
      const reloadMs = Math.max(100, Math.floor(baseReload * 0.7));
      return { ...w, reloadMs };
    },
  },
];

// Weapon cores (1 slot)
export const weaponCores = [
  { id: null, name: 'No Core', desc: 'No special effect', apply: (w) => w },
  {
    id: 'core_pierce',
    name: 'Piercing Core',
    desc: [
      '+Bullets pierce one target',
      '+15% bullet speed',
    ].join('\n'),
    allow: (base) => !!base && !base.isLaser && !base.isFlamethrower && base.projectile !== 'rocket',
    apply: (w) => {
      if (!w || w.isLaser || w.projectile === 'rocket') return w;
      const speed = typeof w.bulletSpeed === 'number' ? Math.floor(w.bulletSpeed * 1.15) : w.bulletSpeed;
      return { ...w, _core: 'pierce', bulletSpeed: speed };
    },
  },
  {
    id: 'core_laser_heat_reuse',
    name: 'Heat Reuse',
    onlyFor: 'laser',
    desc: [
      '+ Laser deals 2x DPS while charge bar is above 50%',
      '+ Laser applies 2x Ignite buildup while charge bar is above 50%',
      '- Beam lock-out time doubled',
    ].join('\n'),
    apply: (w) => {
      if (!w || w.id !== 'laser') return w;
      const baseReload = (typeof w.reloadMs === 'number') ? w.reloadMs : 2000;
      return {
        ...w,
        reloadMs: baseReload * 2,
        _core: 'laser_heat_reuse',
      };
    },
  },
  {
    id: 'core_laser_dmr_overheat',
    name: 'Overheat Surge',
    onlyFor: 'laser_dmr',
    desc: [
      '+ Overheating triggers a 120px fire burst that damages and ignites enemies',
      '- Higher thermal load per shot',
    ].join('\n'),
    apply: (w) => {
      if (!w || w.id !== 'laser_dmr') return w;
      return { ...w, _core: 'laser_dmr_overheat' };
    },
  },
  {
    id: 'core_flame_compression',
    name: 'Compression Nozzle',
    onlyFor: 'flamethrower',
    desc: [
      '- Cone angle reduced to 12°',
      '+ Flame range increased to 135px',
    ].join('\n'),
    apply: (w) => {
      if (!w || w.id !== 'flamethrower') return w;
      return {
        ...w,
        flameConeDeg: 12,
        flameRange: 150,
        _flameParticleSpeedMult: 1.2,
        _flameParticleLifeMult: 1.2,
      };
    },
  },
  {
    id: 'core_blast',
    name: 'Explosive Core',
    desc: '+Small explosion on hit',
    // Do not apply to explosive weapons (rocket-like projectiles), Laser, or L-G Missiles
    allow: (base) => !!base && !base.isLaser && !base.isFlamethrower && base.projectile !== 'rocket' && base.id !== 'guided_missiles',
    apply: (w) => {
      if (!w) return w;
      if (w.isLaser) return w; // disallow on Laser
      if (w.projectile === 'rocket') return w; // disallow on explosive weapons (e.g., rocket, mgl)
      if (w.id === 'guided_missiles') return w; // disallow on L-G Missiles
      return { ...w, _core: 'blast' };
    },
  },
  {
    id: 'core_smart_missiles',
    name: 'Smart Missiles',
    onlyFor: 'guided_missiles',
    desc: [
      '+ Lock-on to nearest enemy within 90° cone',
      '+ Tracks enemies instead of cursor',
      '- Reduced turn rate for tighter arcs',
      'Missiles still collide with walls/barricades',
    ].join('\n'),
    apply: (w) => {
      if (!w || w.id !== 'guided_missiles') return w;
      // Enable smart seeking and reduce per-frame turn rate
      // Base guided turn is ~2°/frame; reduce further
      // Make turning significantly harder: reduce per-frame turn to ~25%
      const baseReload = (typeof w.reloadMs === 'number') ? w.reloadMs : 2000;
      const reloadMs = Math.max(200, Math.floor(baseReload * 0.9));
      return { ...w, _smartMissiles: true, _smartTurnMult: 0.4, reloadMs };
    },
  },
  {
    id: 'core_guided_full',
    name: 'Full-Size Missiles',
    onlyFor: 'guided_missiles',
    desc: [
      '+30 Explosion damage',
      '-7 magazine size',
      '-Slower rate of fire',
      '-Slightly reduced turn rate',
    ].join('\n'),
    apply: (w) => {
      if (!w || w.id !== 'guided_missiles') return w;
      const aoe = Math.max(0, (w.aoeDamage ?? (w.damage || 0)) + 30);
      const rof = Math.max(700, w.fireRateMs || 700);
      return {
        ...w,
        aoeDamage: aoe,
        magSize: 3,
        fireRateMs: rof,
        _guidedTurnMult: 0.7,
        _guidedFullSize: true,
      };
    },
  },
  {
    id: 'core_burst_rifle',
    name: 'Burst Fire',
    onlyFor: 'rifle',
    desc: [
      '+ Fires 3 rounds per click',
      '+ Short gap between bursts',
      '+ Greatly increased bullet speed',
    ].join('\n'),
    apply: (w) => {
      if (!w || w.id !== 'rifle') return w;
      return {
        ...w,
        singleFire: true,
        _burstN: 3,
        _burstGapMs: 70,
        // Gap between bursts is governed by fireRateMs from initial shot
        fireRateMs: 360,
        // Substantially increase muzzle velocity
        bulletSpeed: 800,
      };
    },
  },
  {
    id: 'core_2tap_pistol',
    name: '2Tap Trigger',
    onlyFor: 'pistol',
    desc: [
      '+ Fires two quick, accurate rounds per click',
      '+ Slightly increases time between clicks',
    ].join('\n'),
    apply: (w) => {
      if (!w || w.id !== 'pistol') return w;
      const slower = Math.floor((w.fireRateMs || 220) * 1.2); // +20% interval between pulls
      return { ...w, _twoTap: true, fireRateMs: slower };
    },
  },
  {
    id: 'core_hmg_propelled',
    name: 'Standard Bullets',
    onlyFor: 'smart_hmg',
    desc: [
      '+ Magazine size set to 60',
      '+ 25% bullet speed',
      '+ 50% damage',
      '- Removes homing effect',
    ].join('\n'),
    apply: (w) => {
      if (!w || w.id !== 'smart_hmg') return w;
      const newDmg = Math.max(1, (w.damage || 0) + 4); // buff damage (8 -> 12)
      return {
        ...w,
        // Disable homing by clearing special projectile type
        projectile: null,
        // Spread values
        spreadDeg: 0,
        maxSpreadDeg: 6,
        // Stronger rounds
        damage: newDmg,
        bulletSpeed: 600,
        // Bigger belt
        magSize: 60,
      };
    },
  },
  {
    id: 'core_minigun_brushless',
    name: 'Brushless Motors',
    onlyFor: 'minigun',
    desc: [
      '+ Barrel spin-up is 10x faster',
      '- Rate of fire reduced to 1650 RPM',
    ].join('\n'),
    apply: (w) => {
      if (!w || w.id !== 'minigun') return w;
      return {
        ...w,
        fireRateMs: 36, // 1650 RPM
        _spinUpMult: 10,
      };
    },
  },
  {
    id: 'core_minigun_lightweight',
    name: 'Lightweight Bullet',
    onlyFor: 'minigun',
    desc: [
      '- Damage reduced to 6',
      '+ Move speed while firing increased to 70%',
    ].join('\n'),
    apply: (w) => {
      if (!w || w.id !== 'minigun') return w;
      return {
        ...w,
        damage: 6,
        _firingMoveMult: 0.7,
      };
    },
  },
  {
    id: 'core_smart_explosives',
    name: 'Smart Explosives',
    onlyFor: 'rocket',
    desc: [
      '+ Proximity-detonates when enemies are near',
      '+ If no target at aim point, becomes a mine',
    ].join('\n'),
    apply: (w) => {
      if (!w || w.projectile !== 'rocket') return w;
      return { ...w, _smartExplosives: true, _detectScale: 0.65 };
    },
  },
  {
    id: 'core_cluster_bomb',
    name: 'Cluster Bomb',
    onlyFor: 'rocket',
    desc: [
      '+ Spawns 8 cluster bomblets on detonation',
      '- Direct hit damage set to 5',
      '- Explosion damage set to 20',
      'Reload time penalty +30%'
    ].join('\n'),
    apply: (w) => {
      if (!w || w.projectile !== 'rocket') return w;
      const baseReload = (typeof w.reloadMs === 'number') ? w.reloadMs : 1800;
      const reloadMs = Math.max(200, Math.floor(baseReload * 1.3));
      return {
        ...w,
        damage: 5,
        aoeDamage: 20,
        reloadMs,
        _clusterBomb: true,
      };
    },
  },
  {
    id: 'core_smart_explosives_mgl',
    name: 'Smart Explosives',
    onlyFor: 'mgl',
    desc: [
      '+ Proximity-detonates when enemies are near',
      '+ If no target at aim point, becomes a mine',
    ].join('\n'),
    apply: (w) => {
      if (!w || w.projectile !== 'rocket') return w;
      return { ...w, _smartExplosives: true, _detectScale: 0.65 };
    },
  },
  {
    id: 'core_mgl_firefield',
    name: 'Napalm Rounds',
    onlyFor: 'mgl',
    desc: [
      '+ Leaves fire field on explosion (4s)',
      '+ Fire Field applies Ignition buildup to enemies inside',
      '- Explosion damage reduced to 25%',
      '- Mag size set to 4',
    ].join('\n'),
    apply: (w) => {
      if (!w || w.id !== 'mgl') return w;
      const newAoe = Math.max(1, Math.floor((w.aoeDamage || w.damage || 10) * 0.25));
      return {
        ...w,
        aoeDamage: newAoe,
        magSize: 4,
        _firefield: true,
      };
    },
  },
  {
    id: 'core_rail_hold',
    name: 'Rail Stabilizer',
    onlyFor: 'railgun',
    desc: 'Hold max charge without auto-fire',
    apply: (w) => {
      if (!w || w.id !== 'railgun') return w;
      return { ...w, railHold: true };
    },
  },
  {
    id: 'core_lead_storm',
    name: 'Lead Storm',
    onlyFor: 'shotgun',
    desc: '+150% fire rate\n+ Pellets per shot set to 10\n-65% damage\n+85% spread\n+ Mag size set to 16',
    apply: (w) => {
      // Apply only when the weapon matches the required id
      if (!w || w.id !== 'shotgun') return w;
      const faster = Math.max(60, Math.floor((w.fireRateMs || 300) / 2.5));
      const newDmg = Math.max(1, Math.floor((w.damage || 1) * 0.35));
      const newSpread = Math.max(0, Math.floor((w.spreadDeg || 0) * 1.85));
      return { ...w, fireRateMs: faster, pelletCount: 10, damage: newDmg, spreadDeg: newSpread, magSize: 16 };
    },
  },
  {
    id: 'core_shotgun_pump',
    name: 'Pump Action',
    onlyFor: 'shotgun',
    desc: [
      '+ Pellets per shot +2',
      '+ Damage per pellet +3',
      '- Converts shotgun to semi-auto per click',
      '- Magazine size set to 5',
    ].join('\n'),
    apply: (w) => {
      if (!w || w.id !== 'shotgun') return w;
      return {
        ...w,
        singleFire: true,
        pelletCount: (w.pelletCount || 1) + 2,
        damage: (w.damage || 0) + 3,
        magSize: 5,
      };
    },
  },
  {
    id: 'core_battle_semi',
    name: 'Semi Auto',
    onlyFor: 'battle_rifle',
    desc: [
      '- Single-fire',
      '-7 magazine size',
      '+12 damage',
      '+30% bullet speed',
    ].join('\n'),
    apply: (w) => {
      if (!w || w.id !== 'battle_rifle') return w;
      return {
        ...w,
        singleFire: true,
        magSize: 18,
        damage: 28,
        bulletSpeed: 750,
      };
    },
  },
  {
    id: 'core_rifle_incendiary',
    name: 'Incendiary Chamber',
    onlyFor: 'rifle',
  desc: [
      '+ Bullets apply Ignition buildup on hit',
      '- Fire rate reduced by 25%',
      '- Direct damage -2',
    ].join('\n'),
    apply: (w) => {
      if (!w || w.id !== 'rifle') return w;
      const slower = Math.floor((w.fireRateMs || 111) * 1.25);
      const newDmg = Math.max(1, (w.damage || 0) - 2);
      return { ...w, fireRateMs: slower, damage: newDmg, _igniteOnHit: 4 };
    },
  },
  {
    id: 'core_smg_toxin',
    name: 'Toxic Rounds',
    onlyFor: 'smg',
    desc: [
      '+ Bullets apply high Toxin buildup on hit',
      '-2 direct damage',
    ].join('\n'),
    apply: (w) => {
      if (!w || w.id !== 'smg') return w;
      const newDmg = Math.max(1, (w.damage || 0) - 2);
      return { ...w, damage: newDmg, _toxinOnHit: 4 };
    },
  },
];

// Armour mods (2 slots)
export const armourMods = [
  { id: null, name: 'Empty', desc: 'No changes', apply: (a) => a, applyEffect: (e) => e },
  {
    id: 'a_hp_up',
    name: 'Steel Chassis',
    desc: '+40 max HP\n-10% movement speed',
    apply: (a) => ({ ...a, bonusHp: (a.bonusHp || 0) + 40, moveSpeedMult: (a.moveSpeedMult || 1) * 0.9 }),
    applyEffect: (e) => ({ ...e, bonusHp: (e.bonusHp || 0) + 40, moveSpeedMult: (e.moveSpeedMult || 1) * 0.9 }),
  },
  {
    id: 'a_dr_small',
    name: 'Carbon Fiber Frame',
    desc: '-1s Dash Cooldown',
    apply: (a) => ({ ...a, dashRegenMs: Math.min(4000, a.dashRegenMs || 4000) }),
    applyEffect: (e) => ({ ...e, dashRegenMs: Math.min(4000, e.dashRegenMs || 999999) }),
  },
  {
    id: 'a_explosion_resist',
    name: 'FLAK Paddings',
    desc: '+40% Explosion damage reduced',
    apply: (a) => a,
    applyEffect: (e) => ({ ...e, enemyExplosionDmgMul: Math.min((e.enemyExplosionDmgMul || 1), 0.6) }),
  },
  {
    id: 'a_shield_regen_plus',
    name: 'Large Capacitors',
    desc: '+2 Energy Shield regen per second',
    apply: (a) => a,
    applyEffect: (e) => ({ ...e, shieldRegenBonus: (e.shieldRegenBonus || 0) + 2 }),
  },
  {
    id: 'a_no_overflow',
    name: 'Emergency Pulse',
    desc: [
      '+Prevents damage overflow when Energy Shield breaks',
      '+Automatically releases a Repulsion Pulse on shield break',
    ].join('\n'),
    apply: (a) => a,
    // Mark an effect flag that scenes can honor when applying damage
    applyEffect: (e) => ({ ...e, preventShieldOverflow: true }),
  },
];

// Armour list is intentionally minimal; you can extend later.
export const armourDefs = [
  {
    id: null,
    name: 'Standard Issue',
    desc: [
      'HP: 100',
      'Shield: 50',
      // No special features
    ].join('\n'),
  },
  {
    id: 'proto_thrusters',
    name: 'Prototype Thrusters',
    desc: [
      'HP: 80',
      'Shield: 35',
      '+30% move speed; -30% dash cooldown',
    ].join('\n'),
  },
  {
    id: 'exp_shield',
    name: 'Experimental Shield Generator',
    desc: [
      'HP: 25',
      'Shield: 85',
    ].join('\n'),
  },
  {
    id: 'wasp_bits',
    name: 'BIT Carrier',
    desc: [
      'HP: 80',
      'Shield: 50',
      '+ Spawns two WASP BITs that attack and stun nearby enemies',
    ].join('\n'),
  },
];


