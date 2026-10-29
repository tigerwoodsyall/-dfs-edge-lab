/* Keep the highest projected existing rosters, independent of ownership/exposure. */
async function reduceLineupBatch(lineups,target,progress=async()=>{}){
 if(!Number.isInteger(target)||target<1||target>lineups.length)throw Error('Enter a whole lineup count from 1 to '+lineups.length+'.');
 const pool=new Map(state.players.map(p=>[String(p.id),p]));
 const ranked=lineups.map((lineup,index)=>({lineup,index,points:(lineup.players||[]).reduce((sum,p)=>sum+num((pool.get(String(p.id))||p).projection),0)})).sort((a,b)=>b.points-a.points||a.index-b.index);
 return {lineups:ranked.slice(0,target).map(r=>r.lineup)};
}
$('lineupReduce').onclick=async()=>{
 if(activeGeneration){$('lineupReduceStatus').textContent='Finish or stop the current operation first.';return}
 const before=state.lineups,target=Number($('lineupReduceCount').value);if(!before.length){$('lineupReduceStatus').textContent='Generate lineups first.';return}
 let run;try{if(!Number.isInteger(target)||target<1||target>=before.length)throw Error('Choose a whole number smaller than your '+before.length+' saved lineups.');
 run={cancelled:false};activeGeneration=run;$('lineupReduce').disabled=true;
 const result=await reduceLineupBatch(before,target,async n=>{$('lineupReduceStatus').textContent='Selecting the highest projected '+target+' lineups…';await new Promise(r=>setTimeout(r,0));if(run.cancelled||state.lineups!==before)throw Error('Batch changed. Previous lineups kept.')});
 if(state.lineups!==before)throw Error('Batch changed. Previous lineups kept.');state.lineups=result.lineups;lineupUndo={before,after:state.lineups};lineupPage=1;$('lineupPlayerFilter').value='';save();renderLineups();$('lineupReduceStatus').textContent='Reduced '+before.length+' to '+target+' highest projected lineups. Player exposure recalculated from the remaining batch. Exports use only these lineups. Undo last removal restores all '+before.length+'.';
 }catch(e){$('lineupReduceStatus').textContent=e.message}finally{if(activeGeneration===run)activeGeneration=null;$('lineupReduce').disabled=false;if(typeof renderContestEntries==='function')renderContestEntries()}
};
