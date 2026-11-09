import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../game.js';
import {fixedGold} from './causal-sim.js';
import {installForecast} from './forecast-experiment.js';
import {Valley,VALLEY} from '../valley.js';

// These archived comparisons were authored for the original 50s/35s gold schedule.
// Keep that fixture explicit instead of silently inheriting today's live balance.
const forecastValley = new Valley({...VALLEY,rare:{...VALLEY.rare,firstAt:50,interval:35,activeSeconds:25}});

test('two public candidate areas do not select or disclose the actual site until six seconds',()=>{
  let actualDraws=0,hintDraws=0;
  const w=installForecast(new World({bots:false,valley:forecastValley,goldLayers:[6,24],
    rareRandom:()=>{actualDraws++;return .99;}}),{mode:'pair',hintRandom:()=>{hintDraws++;return .1;}});
  w.time=31.95;w.timeLeft=148.05;w.updateRareSites();
  assert.equal(w.rareForecast().phase,'none');assert.equal(hintDraws,0);assert.equal(actualDraws,0);
  w.time=32;w.timeLeft=148;w.updateRareSites();
  const possible=w.rareForecast();
  assert.equal(possible.phase,'possible');assert.equal(possible.sites.length,2);
  assert.equal(hintDraws,2);assert.equal(actualDraws,0);
  assert.equal(w.announcedRare.length,0);assert.equal(w.knownGold().length,2);
  assert.ok(w.deposits.filter(d=>d.kind==='gold').every(d=>!d.announced&&!d.active));
  w.time=43.95;w.updateRareSites();assert.equal(actualDraws,0);
  w.time=44;w.updateRareSites();assert.equal(actualDraws,1);
  const confirmed=w.rareForecast();assert.equal(confirmed.phase,'confirmed');
  assert.equal(confirmed.sites.length,1);assert.equal(confirmed.sites[0].id,possible.sites[1].id);
  assert.equal(w.knownGold().length,1);
  const a=w.addPlayer('a','A'),b=w.addPlayer('b','B');
  assert.deepEqual(w.snapshot(a.id).rareForecast,w.snapshot(b.id).rareForecast);
  w.time=50;w.updateRareSites();assert.equal(w.rareForecast().phase,'none');
  assert.equal(w.possibleRare.length,0);assert.equal(w.announcedRare.length,0);
  w.resetRound();assert.deepEqual(w.possibleRare,[]);
});

test('ten-second exact notice is World-local and the offline comparisons retain the same actual sites',()=>{
  const sequences=[];
  for(const mode of ['six','ten','pair']){
    const w=installForecast(new World({bots:false,valley:forecastValley,goldLayers:[6,24]}),{mode});
    assert.equal(w.valley.data.rare.previewSeconds,6);
    w.time=102;w.timeLeft=78;w.nextRareAt=120;w.lastRareIds=new Set(['gold-3']);
    fixedGold(w,['gold-2','gold-4']);
    const actual=[],seen=new Set();
    for(let i=0;i<1560;i++){
      w.tick(.05);
      if(w.announcedRare.length&&!seen.has(w.nextRareAt)){
        seen.add(w.nextRareAt);actual.push(w.announcedRare[0].id);
        assert.ok(w.nextRareAt-w.time<= (mode==='ten'?10:6));
      }
    }
    sequences.push(actual);
  }
  assert.deepEqual(sequences,[['gold-2','gold-4'],['gold-2','gold-4'],['gold-2','gold-4']]);
});
