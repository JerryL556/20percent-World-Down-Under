// Edit this file to customize weapons
// Each weapon has: id, name, damage, fireRateMs, bulletSpeed, pelletCount, spreadDeg, color, price, magSize
export const weaponDefs = [
  {
    id: 'pistol',
    name: 'Pistol',
    desc: [
      'Standard-issue pistol — accurate and reliable.',
    ].join('\n'),
    damage: 18,
    fireRateMs: 160,
    bulletSpeed: 450,
    pelletCount: 1,
    spreadDeg: 0,
    maxSpreadDeg: 12,
    color: 0xffff66,
    price: 0,
    magSize: 15,
    singleFire: true,
  },
  {
    id: 'laser',
    name: 'Laser Beam',
    desc: [
      'A prototype handheld laser weapon that fires a scorching particle stream.',
      'The Laser has perfect accuracy even at long range and can ignite enemies.',
    ].join('\n'),
    // Continuous beam weapon: no magazine, uses heat/overheat
    damage: 40, // DPS applied continuously in code
    fireRateMs: 0, // handled continuously
    bulletSpeed: 0,
    pelletCount: 1,
    spreadDeg: 0,
    maxSpreadDeg: 0,
    color: 0xff3344,
    price: 200,
    magSize: 1, // unused for laser; UI uses heat bar
    isLaser: true,
    reloadMs: 2000, // cooldown duration after overheat
  },
  {
    id: 'flamethrower',
    name: 'Flamethrower',
    desc: [
      'Projects a short, wide cone of fire that burns targets and soft cover.',
      'Requires a brief ignition warm-up; flame fades after idling.',
    ].join('\n'),
    damage: 0,
    fireRateMs: 0,
    bulletSpeed: 0,
    pelletCount: 1,
    spreadDeg: 0,
    maxSpreadDeg: 0,
    color: 0xffaa33,
    price: 175,
    magSize: 100,
    reloadMs: 2000,
    isFlamethrower: true,
    flameConeDeg: 35,
    flameRange: 90,
    flameDps: 150,
    flameIgnitePerSec: 30,
    flameAmmoPerSec: 20,
    flameIgniteMs: 500,
    flameIdleMs: 4000,
  },
  {
    id: 'mgl',
    name: 'MGL',
    desc: [
      'A powerful grenade launcher that fires six explosive rounds in succession.',
      'However, it has a long reload time.',
    ].join('\n'),
    // 6-round mag grenade launcher; explosive rounds
    damage: 20, // direct hit
    aoeDamage: 35, // AoE splash
    fireRateMs: 333, // ~3/s
    bulletSpeed: 380, // faster than rocket (300)
    pelletCount: 1,
    spreadDeg: 0,
    maxSpreadDeg: 6,
    color: 0xffaa33,
    price: 180,
    singleFire: true,
    projectile: 'rocket', // reuse explosive projectile behavior
    blastRadius: 52, // smaller than rocket (70)
    magSize: 6,
    reloadMs: 2600, // long reload
  },
  {
    id: 'railgun',
    name: 'Railgun',
    desc: [
      'Hard-hitting prototype that pierces barricades, shields, and enemies.',
      'Launches a tungsten slug via electromagnetic coils; charging boosts damage, accuracy, and velocity.',
    ].join('\n'),
    damage: 24,
    fireRateMs: 350,
    bulletSpeed: 1560,
    pelletCount: 1,
    spreadDeg: 8, // uncharged spread (deg)
    maxSpreadDeg: 8,
    color: 0x66aaff,
    price: 220,
    singleFire: true,
    magSize: 3,
    isRailgun: true,
  },
  {
    id: 'rifle',
    name: 'Assult Rifle',
    desc: [
      'Standard-issue rifle with moderate damage and rate of fire.',
    ].join('\n'),
    damage: 10,
    fireRateMs: 111,
    bulletSpeed: 500,
    pelletCount: 1,
    spreadDeg: 0,
    maxSpreadDeg: 8,
    color: 0x66ccff,
    price: 100,
    magSize: 30,
  },
  {
    id: 'battle_rifle',
    name: 'Battle Rifle',
    desc: [
      'Fires high-caliber rounds, trading magazine size and rate of fire for higher damage and accuracy.',
    ].join('\n'),
    // Higher damage than rifle, slower fire rate, more accurate, 25-round mag
    damage: 16,
    fireRateMs: 160,
    bulletSpeed: 575,
    pelletCount: 1,
    spreadDeg: 0,
    maxSpreadDeg: 4,
    color: 0x88bbff,
    price: 120,
    magSize: 25,
  },
  {
    id: 'shotgun',
    name: 'Shotgun',
    desc: [
      'Semi-auto shotgun that is devastating at close range.',
      'Fires 5 pellets per shot.',
    ].join('\n'),
    damage: 12,
    fireRateMs: 450,
    bulletSpeed: 340,
    pelletCount: 5,
    spreadDeg: 12,
    maxSpreadDeg: 6,
    color: 0xffaa66,
    price: 140,
    magSize: 8,
  },
  {
    id: 'smg',
    name: 'SMG',
    desc: [
      'Close-quarters weapon with an extremely fast rate of fire.',
      'Sustained fire causes significant spread at longer ranges.',
    ].join('\n'),
    damage: 6,
    fireRateMs: 65,
    bulletSpeed: 420,
    pelletCount: 1,
    spreadDeg: 0,
    maxSpreadDeg: 14,
    color: 0x99ff99,
    price: 80,
    magSize: 45,
  },
  {
    id: 'minigun',
    name: 'Minigun',
    desc: [
      'Heavy rotary cannon that needs to spin up before firing.',
      'Sustained fire tightens spread, but firing slows movement.',
    ].join('\n'),
    damage: 10,
    fireRateMs: 30, // 2000 RPM
    bulletSpeed: 500,
    pelletCount: 1,
    spreadDeg: 2,
    maxSpreadDeg: 15,
    color: 0xffee66,
    price: 200,
    magSize: 500,
    reloadMs: 3000,
    isMinigun: true,
  },
  {
    id: 'rocket',
    name: 'Rocket',
    desc: [
      'Launches a propelled explosive that deals area damage over a large radius.',
    ].join('\n'),
    damage: 30, // direct hit
    aoeDamage: 50, // AoE splash
    fireRateMs: 700,
    bulletSpeed: 300,
    pelletCount: 1,
    spreadDeg: 0,
    color: 0xff5533,
    price: 150,
    singleFire: true,
    projectile: 'rocket',
    blastRadius: 80,
    magSize: 1,
    // Increased reload to better balance explosive power
    reloadMs: 1800,
  },
  {
    id: 'guided_missiles',
    name: 'L-G Missiles',
    desc: [
      'A smart weapon that fires propelled, laser-guided mini missiles.',
      'Effectively hits targets even without direct line of sight.',
    ].join('\n'),
    // Micro homing rockets that follow the cursor with limited turn rate
    damage: 10,           // direct hit (rare; explosion handles most damage)
    aoeDamage: 20,        // boosted splash (direct rarely applies)
    fireRateMs: 400,      // slightly faster ROF
    bulletSpeed: 220,     // low velocity
    pelletCount: 1,
    spreadDeg: 0,
    maxSpreadDeg: 0,
    color: 0xffaa33,
    price: 200,
    singleFire: false,
    projectile: 'guided', // custom homing projectile
    blastRadius: 40,      // smaller than MGL (52)
    magSize: 10,
    reloadMs: 1800,       // slightly faster reload
  },
  {
    id: 'smart_hmg',
    name: 'Smart HMG',
    desc: [
      'Heavy machine gun modified to fire mini smart missiles that auto-lock onto enemies.',
      'Missile maneuverability is limited, and per-shot damage is modest due to lack of warheads.',
    ].join('\n'),
    // High-capacity HMG that fires smart bullets with limited turning
    damage: 8,
    fireRateMs: 133,      // reduced ROF (~450 RPM)
    bulletSpeed: 480,     // faster than micro missiles
    pelletCount: 1,
    spreadDeg: 0,
    maxSpreadDeg: 6,
    color: 0xffaa33,
    price: 250,
    singleFire: false,
    projectile: 'smart',  // custom smart bullet (non-explosive)
    magSize: 40,
    reloadMs: 2400,
  },
];

export const defaultWeaponId = 'pistol';

export function getWeaponById(id) {
  return weaponDefs.find((w) => w.id === id) || weaponDefs[0];
}
