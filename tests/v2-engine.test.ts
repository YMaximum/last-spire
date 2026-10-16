import { describe, it, expect } from 'vitest';
import { defaultProfile } from '../src/storage';
import { CARDS, SYNERGIES, WEAPONS } from '../src/v2/catalog';
import { createRun, acquireCard, activeSynergies, getWeaponStats, effectPower, spawnEnemy, step, dealDamage, takeDamage, useSkill, chooseReward, buyOffer, rerollReward, repair, continueEndless, rewardForRun, retire, previewCard, TICK } from '../src/v2/engine';
import type { RunV2, CardOffer } from '../src/v2/types';
const offer=(cardId:string):CardOffer=>({id:cardId,cardId,rarity:'normal',price:42});
const fresh=()=>createRun(defaultProfile(),'bastion',0,0,1783);
const grant=(s:RunV2,id:string)=>acquireCard(s,offer(id),CARDS.find(c=>c.id===id)?.group==='infusion'?s.weapons[0].id:undefined);
function fixture(){const s=fresh();s.hp=150;s.shield=12;s.scrap=100;s.spawned=s.spawnTotal;s.waveTime=1;
 for(let i=0;i<8;i++){const e=spawnEnemy(s,i===0?'boss':'armored',500+45+i*24,400+(i%2)*28,0);e.hp=e.maxHp=50000;e.speed=0;e.damage=12;e.attackCd=1;e.burn=4;e.poison=3;e.chill=.2;}
 const lone=spawnEnemy(s,'runner',780,550,0);lone.hp=lone.maxHp=50000;lone.speed=0;return s;}
function mechanicalSnapshot(s:RunV2){return JSON.stringify({skillCd:s.skillCd,secondaryCd:s.secondaryCd,stats:s.weapons.map(w=>getWeaponStats(s,w)),hp:s.hp,maxHp:s.maxHp,shield:s.shield,scrap:s.scrap,damage:s.damageByWeapon,element:s.damageByElement,buffs:s.buffs.map(b=>[b.source,b.stat,b.value,b.expires]),p:s.projectiles.map(p=>[p.kind,p.x,p.y,p.vx,p.vy,p.life,p.damage,p.radius,p.pierce,p.homing,p.returning]),areas:s.areas.map(a=>[a.kind,a.x,a.y,a.damage,a.radius,a.life]),enemies:s.enemies.map(e=>[e.x,e.y,e.hp,e.chill,e.burn,e.poison,e.stun]),visuals:s.visuals.map(v=>[v.kind,v.size])});}
function exercise(s:RunV2){const trace:string[]=[mechanicalSnapshot(s)];s.weapons[0].infusions=['fire','frost','lightning','poison','solar','void'];
 useSkill(s,'secondary');trace.push(mechanicalSnapshot(s));takeDamage(s,220,'fire',s.enemies[0]);trace.push(mechanicalSnapshot(s));s.hp=70;takeDamage(s,30,'frost',s.enemies[0]);trace.push(mechanicalSnapshot(s));for(const el of ['lightning','poison','solar','void'] as const){takeDamage(s,15,el,s.enemies[0]);trace.push(mechanicalSnapshot(s));}
 s.hp=Math.max(120,s.hp);s.rng=1;s.weapons[0].cooldown=0;
 for(let i=0;i<180;i++){if(i%20===0){s.rng=1;s.weapons[0].cooldown=0;}step(s);if(i%10===0)trace.push(mechanicalSnapshot(s));}
 const lone=s.enemies.find(e=>e.x>750);if(lone)dealDamage(s,lone,{rootId:11,source:'primary',depth:0,weaponId:s.weapons[0].id,damage:100,element:'physical'});
 const victim=spawnEnemy(s,'swarmer',520,400,1);victim.hp=1;s.kills=4;dealDamage(s,victim,{rootId:10,source:'primary',depth:0,weaponId:s.weapons[0].id,damage:100,element:'solar'});
 trace.push(mechanicalSnapshot(s));useSkill(s,'signature');trace.push(mechanicalSnapshot(s));return trace.join('\n');
}

describe('v2 additive engine',()=>{
 it('keeps six independent cores, upgrades duplicates and replaces only an explicitly selected full slot',()=>{const s=fresh();for(const w of WEAPONS.slice(1,6))expect(grant(s,`weapon-${w.id}`)).toBe(true);expect(s.weapons).toHaveLength(6);const id=s.weapons[0].id;expect(grant(s,'weapon-bolt')).toBe(true);expect(s.weapons[0].id).toBe(id);expect(s.weapons[0].mastery).toBe(2);expect(grant(s,'weapon-meteor')).toBe(false);expect(acquireCard(s,offer('weapon-meteor'),id)).toBe(true);expect(s.weapons).toHaveLength(6);expect(s.weapons.some(w=>w.id===id)).toBe(false);});
 it('adds infusions without overwriting and preserves a fixed direct-hit budget',()=>{const s=fresh();grant(s,'infusion-fire');grant(s,'infusion-poison');expect(s.weapons[0].infusions).toEqual(['solar','fire','poison']);const original=getWeaponStats(s,s.weapons[0]).damage;expect(original).toBe(getWeaponStats(fresh(),fresh().weapons[0]).damage);});
 it('promotes mastery at3/6/9/12 and never downgrades rarity',()=>{const s=fresh();for(let i=0;i<12;i++)grant(s,'mod-damage');expect(s.cards[0].rarity).toBe('mythic');const st=s.cards[0].stacks;expect(acquireCard(s,{...offer('mod-damage'),rarity:'normal'})).toBe(false);expect(s.cards[0].stacks).toBe(st);});
 it('scopes global modifiers globally even when a stale target is passed',()=>{const s=fresh();grant(s,'weapon-swarm');acquireCard(s,offer('mod-damage'),s.weapons[0].id);expect(effectPower(s,'damage',s.weapons[1].id)).toBeGreaterThan(0);});
 it('saves deterministic outstanding choices, continues combat, and charges escalating rerolls',()=>{const s=fresh();s.wave=10;s.waveTime=18;s.spawned=s.spawnTotal;step(s);expect(s.phase).toBe('combat');expect(s.pendingRewards.map(r=>r.kind)).toEqual(['draft','shop']);expect(s.pendingRewards[0].offers).toHaveLength(3);expect(s.pendingRewards[1].offers).toHaveLength(4);const copy=JSON.parse(JSON.stringify(s));step(s);step(copy);expect(s.rng).toBe(copy.rng);expect(s.pendingRewards).toEqual(copy.pendingRewards);s.scrap=100;const r=s.pendingRewards[0];rerollReward(s,r.id);expect(s.scrap).toBe(88);rerollReward(s,r.id);expect(s.scrap).toBe(64);});
 it('handles independent draft/shop, affordability and finite repair stock',()=>{const s=fresh();s.wave=10;s.waveTime=18;s.spawned=s.spawnTotal;step(s);const [draft,shop]=s.pendingRewards;s.scrap=100;s.hp=1;expect(repair(s,shop.id)).toBe(true);expect(repair(s,shop.id)).toBe(false);const o=shop.offers[0];s.scrap=o.price;expect(buyOffer(s,shop.id,o.id,s.weapons[0].id)).toBe(true);expect(s.scrap).toBe(0);expect(s.pendingRewards.some(r=>r.id===draft.id)).toBe(true);});
 it('defers wave100 rewards until explicit endless continuation',()=>{const s=fresh();s.wave=100;s.waveTime=18;s.spawned=s.spawnTotal;step(s);expect(s.phase).toBe('victory');expect(s.pendingRewards).toHaveLength(0);continueEndless(s);expect(s.wave).toBe(101);expect(s.pendingRewards).toHaveLength(2);});
 it('does not grant credits for instant retirement or bounties for summoned enemies',()=>{const s=fresh();retire(s);expect(rewardForRun(s)).toBe(0);const e=spawnEnemy(s,'swarmer',520,400,0);dealDamage(s,e,{rootId:1,source:'primary',depth:0,weaponId:'test',damage:1e8,element:'physical'});expect(s.scrap).toBe(0);});
 it('keeps separate kill buff expiry and bounded proc lineage',()=>{const s=fresh();grant(s,'on-kill-fury');for(let i=0;i<2;i++){s.time=i;const e=spawnEnemy(s,'swarmer',520,400,0);dealDamage(s,e,{rootId:i,source:'primary',depth:0,weaponId:'test',damage:1e8,element:'physical'});}expect(s.buffs.map(b=>b.expires)).toEqual([2,3]);s.time=2.01;step(s);expect(s.buffs).toHaveLength(1);const e=spawnEnemy(s);const hp=e.hp;dealDamage(s,e,{rootId:3,source:'proc',depth:3,weaponId:'test',damage:100,element:'fire'});expect(e.hp).toBe(hp);});
 it('exposes truthful replacement losses without mutating a run',()=>{const s=fresh();for(const w of WEAPONS.slice(1,6))grant(s,`weapon-${w.id}`);const before=JSON.stringify(s),p=previewCard(s,offer('weapon-meteor'),s.weapons[0].id);expect(p.lost.length).toBeGreaterThan(0);expect(JSON.stringify(s)).toBe(before);});
});
describe('every card has a mechanical implementation',()=>{
 for(const c of CARDS)it(c.id,()=>{const control=fixture(),s=JSON.parse(JSON.stringify(control)) as RunV2;expect(grant(s,c.id)).toBe(true);
  if(c.group==='utility'){if(c.effect==='discount'||c.effect==='fortune'){for(const x of [s,control]){x.enemies=[];x.wave=10;x.waveTime=18;x.spawned=x.spawnTotal;step(x);}expect(JSON.stringify(s.pendingRewards)).not.toBe(JSON.stringify(control.pendingRewards));return;}
   if(c.effect==='reroll'||c.effect==='repair'){for(const x of [s,control]){x.enemies=[];x.wave=10;x.waveTime=18;x.spawned=x.spawnTotal;step(x);x.scrap=200;x.hp=50;if(c.effect==='reroll')rerollReward(x,x.pendingRewards[0].id);else repair(x,x.pendingRewards[1].id);}expect([s.hp,s.scrap]).not.toEqual([control.hp,control.scrap]);return;}}
  if(c.effect==='wave-shield'||c.effect==='wave-haste'||c.effect==='wave-damage'){for(const x of [s,control]){x.enemies=[];x.waveTime=18;step(x);}}
  expect(exercise(s)).not.toBe(exercise(control));
 });
});
describe('every synergy changes a supported mechanic',()=>{
 for(const y of SYNERGIES)it(y.id,()=>{const s=fixture();for(const id of y.requires)grant(s,id);s.synergies=activeSynergies(s);expect(s.synergies).toContain(y.id);const control=JSON.parse(JSON.stringify(s)) as RunV2;control.synergies=control.synergies.filter(id=>id!==y.id);
  if(y.effect==='wave-duration'){for(const x of [s,control]){x.enemies=[];x.waveTime=18;step(x);}}
  if(y.effect==='emergency-retaliation'){s.hp=control.hp=60;}
  if(y.effect==='return-pierce'||y.effect==='size-pulse'){for(const x of [s,control]){x.enemies.forEach((e,i)=>{e.x=700+i*12;e.y=500;});x.weapons[0].kind='spiral';}}
  expect(exercise(s)).not.toBe(exercise(control));
 });
});

describe('long-run stability and deterministic encounters',()=>{
 it('separates encounter random numbers from weapon and reward consumption',()=>{const a=fresh(),b=fresh();b.rng=823489;b.nextId=9000;const ea=spawnEnemy(a),eb=spawnEnemy(b);expect([ea.kind,ea.x,ea.y,ea.hp]).toEqual([eb.kind,eb.x,eb.y,eb.hp]);});
 it('fires beyond 1000 attacks without overflowing cycling counters or losing finite save data',()=>{const s=fresh();s.spawned=s.spawnTotal;const e=spawnEnemy(s,'boss',700,400,0);e.hp=e.maxHp=1e9;e.damage=0;e.speed=0;for(let i=0;i<1100;i++){s.weapons[0].cooldown=0;step(s);}expect(s.weapons[0].lifetimeShots).toBeGreaterThan(1000);expect(s.weapons[0].shotCycle).toBeLessThan(12);expect(s.projectiles.length).toBeLessThan(150);const encoded=JSON.stringify(s);expect(encoded).not.toMatch(/NaN|Infinity/);expect(JSON.parse(encoded).weapons[0].lifetimeShots).toBe(s.weapons[0].lifetimeShots);});
 it('preserves 100 cleared waves and an endless encounter through JSON save/load',()=>{const s=fresh();for(let wave=1;wave<=100;wave++){s.wave=wave;s.waveTime=18;s.spawned=s.spawnTotal;s.enemies=[];step(s);}expect(s.phase).toBe('victory');const restored=JSON.parse(JSON.stringify(s)) as RunV2;continueEndless(s);continueEndless(restored);for(let i=0;i<300;i++){step(s);step(restored);}expect(s.wave).toBe(101);expect(JSON.stringify(s)).toBe(JSON.stringify(restored));expect(s.pendingRewards).toHaveLength(60);});
});
