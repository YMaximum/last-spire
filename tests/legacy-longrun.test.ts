import {describe,it,expect} from 'vitest';
import 'fake-indexeddb/auto';
import {createRun,retire} from '../src/legacy/classic/engine';
import {defaultProfile,defaultSettings,exportSave,parseSave,settleInMemory,settleRun,replaceSave,loadSave} from '../src/legacy/classic/storage';
describe('v1 long-run recovery',()=>{
 const make=()=>{const s=createRun(defaultProfile(),'bastion',0,0,10512);s.wave=101;s.cleared=true;s.endless=true;s.kills=2300;s.attacks[0].shots=15000;retire(s);return {version:1 as const,profile:defaultProfile(),run:s,settings:defaultSettings()};};
 it('exports and loads legitimate counters above 1000',()=>{const s=make();expect(parseSave(exportSave(s)).run?.attacks[0].shots).toBe(15000);});
 it('can return with memory-only rewards after wave100',()=>{const settled=settleInMemory(make());expect(settled.run?.settled).toBe(true);expect(settled.profile.credits).toBeGreaterThan(0);expect(settled.profile.stageUnlocked).toBe(2);});
 it('settles long runs persistently once, including reload',async()=>{const s=make();await replaceSave(s);const first=await settleRun(s);const second=await settleRun(s);expect(second.profile.credits).toBe(first.profile.credits);expect((await loadSave()).run?.settled).toBe(true);});
 it('continues rejecting unsafe or fractional lifetime counters',()=>{for(const bad of [Infinity,Number.MAX_SAFE_INTEGER+1,10.2]){const s=make();s.run.attacks[0].shots=bad;expect(()=>exportSave(s)).toThrow();}});
});
