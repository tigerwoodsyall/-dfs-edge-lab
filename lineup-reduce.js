/* Select existing complete rosters while preserving the batch's exposure mix. */
async function reduceLineupBatch(lineups,target,progress=async()=>{}){
 if(!Number.isInteger(target)||target<1||target>lineups.length)throw Error('Enter a whole lineup count from 1 to '+lineups.length+'.');
 const ids=new Map(),original=[];
 const rows=lineups.map((lineup,index)=>{const players=[...new Set((lineup.players||[]).map(p=>String(p.id)))];if(players.length!==8)throw Error('Every saved lineup must contain eight different players.');return {lineup,index,ids:players.map(id=>{if(!ids.has(id)){ids.set(id,ids.size);original.push(0)}const k=ids.get(id);original[k]++;return k}),points:(lineup.players||[]).reduce((s,p)=>s+num(p.projection),0)}});
 const counts=original.slice(),kept=new Set(rows.map((_,i)=>i));let remaining=rows.length;
 // At each step choose the removal closest to the proportional exposure targets.
 while(remaining>target){let best=-1,bestDelta=Infinity;
  for(const i of kept){const row=rows[i];let delta=0;for(const k of row.ids){const error=counts[k]-original[k]*(remaining-1)/rows.length;delta+=1-2*error}if(delta<bestDelta-1e-9||Math.abs(delta-bestDelta)<1e-9&&(best<0||row.points<rows[best].points)){best=i;bestDelta=delta}}
  kept.delete(best);rows[best].ids.forEach(k=>counts[k]--);remaining--;if(remaining%20===0)await progress(remaining);
 }
 // Improve final exposure error with one-for-one roster swaps; projections break ties.
 const desired=original.map(n=>n*target/rows.length);let checks=0;
 for(let pass=0;pass<4;pass++){let best=null,bestDelta=0,bestPoints=0;
  for(const i of kept)for(let j=0;j<rows.length;j++){if(kept.has(j))continue;const changes=new Map();rows[i].ids.forEach(k=>changes.set(k,(changes.get(k)||0)-1));rows[j].ids.forEach(k=>changes.set(k,(changes.get(k)||0)+1));let delta=0;for(const [k,d]of changes)delta+=2*(counts[k]-desired[k])*d+d*d;const points=rows[j].points-rows[i].points;
   if(delta<bestDelta-1e-9||Math.abs(delta-bestDelta)<1e-9&&points>bestPoints+1e-9){best=[i,j];bestDelta=delta;bestPoints=points}if(++checks%10000===0)await progress(target);
  }
  if(!best)break;kept.delete(best[0]);kept.add(best[1]);rows[best[0]].ids.forEach(k=>counts[k]--);rows[best[1]].ids.forEach(k=>counts[k]++);
 }
 const selected=[...kept].map(i=>rows[i]).sort((a,b)=>b.points-a.points||a.index-b.index).map(r=>r.lineup),maxDrift=Math.max(0,...counts.map((n,k)=>Math.abs(100*n/target-100*original[k]/rows.length)));
 return {lineups:selected,maxDrift};
}
$('lineupReduce').onclick=async()=>{
 if(activeGeneration){$('lineupReduceStatus').textContent='Finish or stop the current operation first.';return}
 const before=state.lineups,target=Number($('lineupReduceCount').value);if(!before.length){$('lineupReduceStatus').textContent='Generate lineups first.';return}
 let run;try{if(!Number.isInteger(target)||target<1||target>=before.length)throw Error('Choose a whole number smaller than your '+before.length+' saved lineups.');
 run={cancelled:false};activeGeneration=run;$('lineupReduce').disabled=true;
 const result=await reduceLineupBatch(before,target,async n=>{$('lineupReduceStatus').textContent='Selecting '+target+' from '+before.length+' lineups · balancing player exposure…';await new Promise(r=>setTimeout(r,0));if(run.cancelled||state.lineups!==before)throw Error('Batch changed. Previous lineups kept.')});
 if(state.lineups!==before)throw Error('Batch changed. Previous lineups kept.');state.lineups=result.lineups;lineupUndo={before,after:state.lineups};lineupPage=1;$('lineupPlayerFilter').value='';save();renderLineups();$('lineupReduceStatus').textContent='Reduced '+before.length+' to '+target+' saved lineups. Largest player exposure change: '+result.maxDrift.toFixed(2)+' percentage points. Exports use this reduced batch. Undo last removal restores all '+before.length+'.';
 }catch(e){$('lineupReduceStatus').textContent=e.message}finally{if(activeGeneration===run)activeGeneration=null;$('lineupReduce').disabled=false;if(typeof renderContestEntries==='function')renderContestEntries()}
};
