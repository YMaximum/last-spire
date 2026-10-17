import { describe, it, expect } from 'vitest';
import { defaultProfile } from '../src/storage';
import * as old from '../src/v2/engine';
import { CARDS, isDefensiveKind } from '../src/v3/catalog';
import {
  createRun, step, TICK, acquireCard, getWeaponStats, spawnEnemy, takeDamage,
  dealDamage, grantXp, advanceMastery, getDefenseStats, useSkill, rewardForRun,
  chooseReward, refreshPendingOffers, rerollReward, continueEndless, describeNextThreat,
} from '../src/v3/engine';
import type { RunV3 } from '../src/v3/types';
const fresh = (mode: 'quick'|'normal'|'endless' = 'normal') => {
  const s = createRun(defaultProfile(), 'bastion', 0, 0, 542, { mode });
  s.spawnTimer = s.spawnTotal = 999;
  return s;
};
function grant(s: RunV3, cardId: string, targetId?: string) {
  expect(acquireCard(s, { id: `pick-${s.nextId++}`, cardId, rarity: 'normal', price: 0 }, targetId)).toBe(true);
}
function dummy(s: RunV3, x = 600, y = 400) {
  const e = spawnEnemy(s, 'armored', x, y, 0);
  e.hp = e.maxHp = 100000; e.armor = 0; e.speed = e.damage = 0;
  return e;
}
function coreRun(kind: string) {
  const s = fresh(); s.weapons = []; grant(s, `weapon-${kind}`); dummy(s);
  return s;
}
const primary = (s: RunV3, damage = 100) => ({ rootId:s.nextId++, source:'primary' as const, depth:0, weaponId:s.weapons[0].id, damage, element:'physical' as const });

describe('modern rules and XP budgets', () => {
  it('keeps legacy rules byte-for-byte equivalent through the dispatch facade', () => {
    const a = old.createRun(defaultProfile(), 'bastion', 0, 0, 14), b = structuredClone(a);
    for (let i = 0; i < 300; i++) { old.step(a); step(b); }
    expect(b).toEqual(a);
    expect(rewardForRun(b)).toBe(old.rewardForRun(a));
  });
  it('queues multi-level choices, distinct useful offers, and independent reward RNG', () => {
    const s = createRun(defaultProfile(), 'bastion', 0, 0, 34, { runes:{choices:2} });
    const rng = s.rng;
    grantXp(s, 100);
    expect(s.level).toBeGreaterThan(5);
    expect(s.rng).toBe(rng);
    expect(s.pendingRewards.length).toBe(s.level-1);
    for (const reward of s.pendingRewards) {
      expect(reward.level).toBeGreaterThan(1);
      expect(reward.offers).toHaveLength(5);
      expect(new Set(reward.offers.map(o=>o.cardId)).size).toBe(5);
      expect(reward.offers.some(o=>o.cardId==='weapon-bolt')).toBe(true);
    }
    expect(JSON.parse(JSON.stringify(s)).pendingRewards).toEqual(s.pendingRewards);
  });
  it('conserves splitter XP and gives summons no XP or bounty', () => {
    const s = fresh(), parent = spawnEnemy(s, 'splitter');
    parent.hp = 1; parent.armor = 0;
    dealDamage(s,parent,primary(s));
    expect(s.counters.totalXp).toBe(0.5);
    const children = s.enemies.filter(e=>e.kind==='swarmer');
    expect(children).toHaveLength(2);
    for (const child of children) { child.hp=1; dealDamage(s,child,primary(s)); }
    expect(s.counters.totalXp).toBe(1);
    const summoned = spawnEnemy(s,'runner',600,400,0); summoned.hp=1;
    dealDamage(s,summoned,primary(s));
    expect(s.counters.totalXp).toBe(1);
    expect(children.reduce((n,e)=>n+e.bounty,0)).toBe(0);
  });
  it('uses Quick XP pacing, finite endpoints, boss schedules and direct Endless', () => {
    const quick = fresh('quick'), normal=fresh();
    expect(grantXp(quick,8,'elite')).toBe(6);
    expect(grantXp(normal,8,'elite')).toBe(8);
    for (const [s,endpoint] of [[quick,50],[normal,100]] as const) {
      s.wave=endpoint; s.spawned=s.spawnTotal=0; s.spawnTimer=999; s.waveTime=18;
      step(s); expect(s.phase).toBe('victory'); expect(s.pendingRewards).toHaveLength(0);
    }
    const endless=fresh('endless'); endless.wave=100; endless.spawned=endless.spawnTotal=0; endless.waveTime=18;
    step(endless); expect(endless.wave).toBe(101); expect(endless.phase).toBe('combat');
  });
  it('does not award a wave draft and leaves milestone shops on their wave', () => {
    const s=fresh(); s.wave=2;s.spawned=s.spawnTotal=0;s.waveTime=18;step(s);
    expect(s.pendingRewards).toHaveLength(0);
    s.wave=10;s.spawned=s.spawnTotal=0;s.waveTime=18;step(s);
    expect(s.pendingRewards.map(r=>r.kind)).toEqual(['shop']);
  });
  it('repairs maxed banked offers without touching combat RNG or shrinking choice runes', () => {
    const s=createRun(defaultProfile(),'bastion',0,0,555,{runes:{choices:2}});
    grant(s,'mod-range');grantXp(s,100);
    const card=s.cards.find(c=>c.cardId==='mod-range')!;
    card.stacks=11;card.mastery=11;card.rarity='legendary';
    for(const reward of s.pendingRewards) reward.offers[0]={id:`range-${reward.id}`,cardId:'mod-range',rarity:'mythic',price:0};
    const selected=s.pendingRewards[0], rng=s.rng;
    expect(chooseReward(s,selected.id,selected.offers[0].id)).toBe(true);
    expect(s.pendingRewards.every(r=>r.offers.every(o=>o.cardId!=='mod-range'))).toBe(true);
    expect(s.pendingRewards.every(r=>r.offers.length===5)).toBe(true);
    expect(s.rng).toBe(rng);
    s.scrap=100;const next=s.pendingRewards[0];
    expect(rerollReward(s,next.id)).toBe(true);expect(next.offers).toHaveLength(5);
    refreshPendingOffers(s);expect(s.rng).toBe(rng);
  });
  it('places all four compressed bosses and continues Quick safely beyond its endpoint', () => {
    for(const wave of [12,25,37,50]) {
      const s=fresh('quick');s.wave=wave;s.spawned=0;s.spawnTotal=1;s.spawnTimer=0;
      step(s);expect(s.enemies.some(e=>e.kind==='boss')).toBe(true);
      expect(describeNextThreat(s)).toContain('watch the marked strike zones');
    }
    const s=fresh('quick');s.wave=50;s.phase='victory';s.cleared=true;
    continueEndless(s);expect(s.wave).toBe(51);expect(s.phase).toBe('combat');expect(s.endless).toBe(true);
    s.enemies=[];s.spawned=s.spawnTotal=0;s.waveTime=18;step(s);expect(s.wave).toBe(52);
  });
});
describe('normalized equipment mastery', () => {
  it('normalizes fast, slow, area, and defensive participation by combat seconds', () => {
    const s=fresh(); grant(s,'weapon-rail');grant(s,'weapon-pulse');grant(s,'weapon-core-mirror');dummy(s);
    for(let i=0;i<300;i++)step(s);
    for(const w of s.weapons) expect(w.masteryProgress).toBeCloseTo(10,4);
    expect(s.weapons[0].lifetimeShots).toBeGreaterThan(s.weapons[1].lifetimeShots);
    const idle=fresh();for(let i=0;i<30;i++)step(idle);
    expect(idle.weapons[0].masteryProgress).toBe(0);
  });
  it('accelerates Quick and duplicate investment, caps at visible rank six', () => {
    const s=fresh('quick');dummy(s);for(let i=0;i<30;i++)step(s);
    expect(s.weapons[0].masteryProgress).toBeCloseTo(1.5);
    grant(s,'weapon-bolt');expect(s.weapons[0].masteryProgress).toBeCloseTo(151.5);
    advanceMastery(s.weapons[0],10000);
    expect(s.weapons[0]).toMatchObject({masteryRank:6,masteryProgress:900,masteryRequired:900,fusionReady:true});
    grant(s,'weapon-bolt');expect(s.weapons[0].masteryRank).toBe(6);
  });
});
describe('eight defensive cores', () => {
  for(const kind of ['core-mirror','core-thorn','core-capacitor','core-cinder','core-frost','core-mending','core-gravitic','core-echo']) {
    it(`mechanically activates ${kind} without firing an ordinary weapon`, () => {
      const s=coreRun(kind), e=s.enemies[0], before=e.hp;
      s.hp=s.maxHp-50;s.shield=100;
      takeDamage(s,40,'physical',e);
      for(let i=0;i<100;i++)step(s);
      expect(s.weapons.every(w=>isDefensiveKind(w.kind))).toBe(true);
      expect(s.projectiles).toHaveLength(0);
      if(kind==='core-mending') { expect(s.counters.totalHealing).toBeGreaterThan(0);expect(e.hp).toBeLessThan(before); }
      else if(kind==='core-gravitic') { expect(e.hp).toBeLessThan(before);expect(getDefenseStats(s).mitigation.physical).toBeCloseTo(.18); }
      else expect(e.hp).toBeLessThan(before);
      if(kind==='core-cinder')expect(e.burn).toBeGreaterThan(0);
      if(kind==='core-frost')expect(e.chill).toBeGreaterThan(0);
      expect(s.damageByWeapon[s.weapons[0].id]).toBeGreaterThan(0);
    });
  }
  it('starts Monolith with reflection and empowers its retaliation signature', () => {
    const s=createRun(defaultProfile(),'monolith',0,0,1);
    expect(s.maxHp).toBe(640);expect(s.weapons.map(w=>w.kind)).toEqual(['core-mirror']);
    expect(getDefenseStats(s).mitigation.physical).toBeCloseTo(.2);
    const before=getDefenseStats(s).retaliationDamage;expect(useSkill(s,'signature')).toBe(true);
    expect(getDefenseStats(s).retaliationDamage).toBeGreaterThan(before);
    expect(s.shield).toBeGreaterThan(0);
  });
  it('retaliates against ranged attackers and resistant bosses with bounded infusions', () => {
    const s=coreRun('core-mirror');grant(s,'weapon-core-thorn');grant(s,'weapon-core-echo');
    grant(s,'infusion-lightning',s.weapons[0].id);
    const ranged=spawnEnemy(s,'ranged',740,400,0),boss=spawnEnemy(s,'boss',730,400,0);
    ranged.hp=ranged.maxHp=boss.hp=boss.maxHp=10000;
    takeDamage(s,20,'fire',ranged);takeDamage(s,20,'fire',boss);
    expect(ranged.hp).toBeLessThan(10000);expect(boss.hp).toBeLessThan(10000);
    expect(Object.values(s.damageByWeapon).reduce((n,v)=>n+v,0)).toBeLessThan(500);
    expect(s.projectiles.length).toBe(0);
  });
});
describe('sixteen new support card mechanics',()=>{
  it('general XP gain increases grants',()=>{const s=fresh();grant(s,'mod-insight');expect(grantXp(s,1)).toBeCloseTo(1.1);});
  it('trophy lore specifically boosts elite and boss XP',()=>{const s=fresh();grant(s,'mod-trophy-lore');expect(grantXp(s,8,'elite')).toBe(10);expect(grantXp(s,1)).toBe(1);});
  it('kill-chain learning stacks only within the short kill window',()=>{const s=fresh();grant(s,'on-learning-chain');grantXp(s,1);expect(grantXp(s,1)).toBeGreaterThan(1);s.time=3;expect(grantXp(s,1)).toBe(1);});
  it('last lesson boosts learning only while low on health',()=>{const s=fresh();grant(s,'on-last-lesson');s.hp=s.maxHp*.3;expect(grantXp(s,1)).toBe(1.15);s.hp=s.maxHp;expect(grantXp(s,1)).toBe(1);});
  it('apprenticeship targets one core without accelerating its neighbors',()=>{const s=fresh();grant(s,'weapon-rail');grant(s,'utility-apprenticeship',s.weapons[0].id);dummy(s);for(let i=0;i<30;i++)step(s);expect(s.weapons[0].masteryProgress).toBeCloseTo(1.25);expect(s.weapons[1].masteryProgress).toBeCloseTo(1);});
  it('shared study converts support investments to mastery progress',()=>{const s=fresh();grant(s,'utility-shared-study');const before=s.weapons[0].masteryProgress!;grant(s,'mod-range');expect(s.weapons[0].masteryProgress).toBeGreaterThan(before);});
  it('rebound coating sends a bounded reflection to another enemy',()=>{const s=coreRun('core-mirror');const next=dummy(s,650,400);grant(s,'mod-rebound-coating');takeDamage(s,10,'physical',s.enemies[0]);expect(next.hp).toBeLessThan(next.maxHp);});
  it('serrated refraction emits nearby barbs on a reflection',()=>{const s=coreRun('core-mirror');const next=dummy(s,650,400);grant(s,'on-serrated-refraction');takeDamage(s,10,'physical',s.enemies[0]);expect(next.hp).toBeLessThan(next.maxHp);});
  it('mending conversion turns genuine overheal into a limited discharge',()=>{const s=fresh();dummy(s);grant(s,'def-mending-conversion');grant(s,'def-regen');const e=s.enemies[0];step(s);expect(s.damageByWeapon['overheal-discharge']).toBeGreaterThan(0);const before=e.hp;step(s);expect(e.hp).toBe(before);});
  it('aegis siphon charges shields from root weapon hits',()=>{const s=fresh();const e=dummy(s);grant(s,'on-aegis-siphon');dealDamage(s,e,primary(s));expect(s.shield).toBeGreaterThan(0);const shield=s.shield;dealDamage(s,e,primary(s));expect(s.shield).toBe(shield);});
  it('pain reserve increases attack damage temporarily after being hit',()=>{const s=fresh();grant(s,'on-pain-reserve');const before=getWeaponStats(s,s.weapons[0]).damage;takeDamage(s,1);expect(getWeaponStats(s,s.weapons[0]).damage).toBeGreaterThan(before);s.time+=5;expect(getWeaponStats(s,s.weapons[0]).damage).toBe(before);});
  it('ward reach enlarges defensive coverage',()=>{const s=coreRun('core-mirror');const before=getWeaponStats(s,s.weapons[0]).range;grant(s,'mod-ward-reach');expect(getWeaponStats(s,s.weapons[0]).range).toBeGreaterThan(before);});
  for(const [id,check] of [['mod-mass-driver','knockback'],['mod-long-flight','damage'],['mod-accelerant','speed'],['mod-wake-condenser','pulse']] as const) {
    it(`${id} changes actual projectile ${check}`,()=>{
      const a=fresh(),b=fresh(); const ea=dummy(a,760,400),eb=dummy(b,760,400);
      grant(b,id); a.weapons[0].cooldown=b.weapons[0].cooldown=0;
      const initialA=ea.x,initialB=eb.x;
      for(let i=0;i<40;i++){step(a);step(b);}
      if(check==='knockback')expect(eb.x-initialB).toBeGreaterThan(ea.x-initialA);
      if(check==='damage')expect(eb.hp).toBeLessThan(ea.hp);
      if(check==='speed')expect(Math.max(...b.projectiles.map(p=>Math.hypot(p.vx,p.vy)),0)).toBeGreaterThan(Math.max(...a.projectiles.map(p=>Math.hypot(p.vx,p.vy)),0));
      if(check==='pulse')expect(b.visuals.some(v=>v.kind==='pulse') || eb.hp<ea.hp).toBe(true);
    });
  }
  it('contains exactly the agreed twenty-four new distinct families',()=>{expect(CARDS).toHaveLength(124);});
});
