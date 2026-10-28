/* Build a complete replacement batch before committing; no saved lineups change on failure. */
function exposureFillOptions(kind){
 const id=$('lineupTrimPlayer').value,raw=kind==='min'?$('lineupExposureMin').value:$('lineupExposureCap').value,percent=Number(raw),count=Number($('lineupExposureTarget').value);
 if(!id)throw Error('Choose a player to adjust.');if(String(raw).trim()===''||!Number.isFinite(percent)||percent<0||percent>100)throw Error('Enter an exposure percentage from 0 to 100.');if(!Number.isInteger(count)||count<1||count>500)throw Error('Target lineup count must be a whole number from 1 to 500.');
 const cap=Number($('cap').value),minSalary=Number($('minsalary').value),unique=Number($('unique').value),globalExposure=Number($('exposure').value);
 if(!Number.isFinite(cap)||cap<=0||cap>50000||!Number.isFinite(minSalary)||minSalary<0||minSalary>cap)throw Error('Review salary settings in Optimizer.');if(!Number.isInteger(unique)||unique<1||unique>8||!Number.isFinite(globalExposure)||globalExposure<=0||globalExposure>100)throw Error('Review unique-player and maximum-exposure settings in Optimizer.');
 const pool=state.players.filter(p=>!p.fade&&num(p.salary)>0&&num(p.projection)>0&&!(typeof nbaOut==='function'&&nbaOut(p))),target=state.players.find(p=>String(p.id)===id);
 if(!target)throw Error('The selected player is missing from the current slate.');if(pool.some(p=>!gameKey(p)||gameStartOrder(p)===null))throw Error('Current player salaries need valid game information and start times.');if(pool.some(p=>gameStartInstant(p)<=Date.now()))throw Error('Games have started. Use Late Swap to preserve locked entries.');
 const targetMin=kind==='min'?Math.ceil(count*percent/100-1e-10):0,targetMax=kind==='max'?Math.floor(count*percent/100+1e-10):count;
 if(targetMin&&!pool.some(p=>String(p.id)===id))throw Error(target.name+' is faded, Out, or has no positive projection. Update the player before setting a positive minimum.');
 const locks=pool.filter(p=>p.lock);if(locks.length>8)throw Error('Too many locked players.');if(targetMax<count&&locks.some(p=>String(p.id)===id))throw Error('The selected player is locked in every lineup. Remove their lock before lowering maximum exposure.');
 const teamRules=new Map(currentTeamNames().map(t=>[t,teamRule(t)]));for(const [team,r] of teamRules)if(!Number.isInteger(r.min)||!Number.isInteger(r.max)||r.min<0||r.max>8||r.min>r.max)throw Error('Invalid team limits for '+team+'.');
 if([...teamRules.values()].reduce((s,r)=>s+r.min,0)>8)throw Error('Team minimums exceed eight players.');
 const limit=new Map(pool.map(p=>[p.id,String(p.id)===id?targetMax:p.lock?count:Math.ceil(count*globalExposure/100)]));
 return {id,target,count,percent,kind,targetMin,targetMax,pool,locks,teamRules,limit,cap,minSalary,unique};
}
function exposureFillLineup(lineup,o){
 const map=new Map(o.pool.map(p=>[String(p.id),p])),players=(lineup.players||[]).map(p=>map.get(String(p.id)));if(players.length!==8||players.some(p=>!p)||new Set(players.map(p=>String(p.id))).size!==8)return null;
 if(players.some((p,j)=>!eligible(p,SLOTS[j]))||lineupGames(players)<2||o.locks.some(p=>!players.some(x=>String(x.id)===String(p.id))))return null;
 const salary=players.reduce((s,p)=>s+num(p.salary),0),counts=new Map();players.forEach(p=>counts.set(teamCode(p),(counts.get(teamCode(p))||0)+1));if(salary<o.minSalary||salary>o.cap||[...o.teamRules].some(([t,r])=>(counts.get(t)||0)<r.min||(counts.get(t)||0)>r.max))return null;
 const arranged=arrangeLateSwap(players);if(!arranged)return null;const points=players.reduce((s,p)=>s+num(p.projection),0),ownership=players.reduce((s,p)=>s+num(p.ownership),0),upside=players.reduce((s,p)=>s+num(p.ceiling),0);return {players:arranged.map(p=>({...p})),salary,points,ownership,upside,metric:points,mode:'cash'};
}
function exposureFillCompatible(lineup,chosen,used,o){
 if(lineup.players.some(p=>(used.get(p.id)||0)>=(o.limit.get(p.id)??o.count)))return false;const ids=new Set(lineup.players.map(p=>String(p.id)));return chosen.every(l=>l.players.filter(p=>!ids.has(String(p.id))).length>=o.unique);
}
async function buildExposureFill(o,run,search=searchLineup){
 const candidates=state.lineups.map(l=>exposureFillLineup(l,o)).filter(Boolean).sort((a,b)=>b.points-a.points),used=new Map();let generated=0,reused=0,targetCount=0;
 while(run.lineups.length<o.count){checkGeneration(run);const nonTarget=run.lineups.length-targetCount,force=o.kind==='min'&&targetCount<o.targetMin?'target':o.kind==='max'&&nonTarget<o.count-o.targetMax?'other':'any';
  run.progress=()=>{$('lineupFillStatus').textContent='Building '+(run.lineups.length+1)+' of '+o.count+' · '+generated+' new lineups · '+targetCount+' with '+o.target.name+'. Previous batch is kept until this finishes.'};run.progress();await new Promise(resolve=>setTimeout(resolve,0));
  const matches=l=>force==='any'||l.players.some(p=>String(p.id)===o.id)===(force==='target');let nextIndex=candidates.findIndex(l=>matches(l)&&exposureFillCompatible(l,run.lineups,used,o)),lineup;
  if(nextIndex>=0){lineup=candidates.splice(nextIndex,1)[0];reused++}else{
   const pool=force==='other'?o.pool.filter(p=>String(p.id)!==o.id):o.pool,locks=force==='target'?[...o.locks.filter(p=>String(p.id)!==o.id),o.target]:o.locks;
   if(run.fillForce!==force){run.engine=null;run.fillForce=force}lineup=await search(pool,locks,'cash',o.cap,o.minSalary,used,o.limit,o.unique,o.teamRules,run);checkGeneration(run,true);
   if(!lineup||!matches(lineup)||!exposureFillCompatible(lineup,run.lineups,used,o))throw Error('Could not fill all '+o.count+' lineups under the current constraints ('+run.lineups.length+' found). Previous batch kept. Try fewer unique players, wider salary limits, higher other-player exposure, or fewer requested lineups.');generated++;
  }
  run.lineups.push(lineup);lineup.players.forEach(p=>used.set(p.id,(used.get(p.id)||0)+1));if(lineup.players.some(p=>String(p.id)===o.id))targetCount++;
 }
 checkGeneration(run,true);if(targetCount<o.targetMin||targetCount>o.targetMax)throw Error('Exposure target could not be met. Previous batch kept.');return {generated,reused,targetCount};
}
let exposureFillBusy=false;
async function runExposureFill(kind){
 if(activeGeneration)return;let run;
 try{const o=exposureFillOptions(kind);run={cancelled:false,lineups:[],signature:generationSignature(),progress:()=>{}};activeGeneration=run;exposureFillBusy=true;['lineupTrimPlayer','lineupExposureMin','lineupExposureCap','lineupExposureTarget'].forEach(id=>$(id).disabled=true);$('lineupFillMin').disabled=true;$('lineupFillMax').disabled=true;$('lineupFillStop').hidden=false;
 const result=await buildExposureFill(o,run);const before=state.lineups;state.lineups=run.lineups;lineupUndo={before,after:state.lineups};save();renderLineups();$('lineupFillStatus').textContent='Ready: '+o.count+' lineups · '+result.targetCount+' with '+o.target.name+' ('+(100*result.targetCount/o.count).toFixed(2)+'%). Kept '+result.reused+' existing and generated '+result.generated+' new lineups from current projections. Ranked by projected points. Undo last removal restores the previous batch.';
 }catch(e){$('lineupFillStatus').textContent=e.message||'Could not complete the batch. Previous lineups kept.'}finally{if(run&&activeGeneration===run)activeGeneration=null;exposureFillBusy=false;['lineupTrimPlayer','lineupExposureMin','lineupExposureCap','lineupExposureTarget'].forEach(id=>$(id).disabled=false);$('lineupFillMin').disabled=false;$('lineupFillMax').disabled=false;$('lineupFillStop').hidden=true;if(typeof renderContestEntries==='function')renderContestEntries()}
}
$('lineupFillMin').onclick=()=>runExposureFill('min');$('lineupFillMax').onclick=()=>runExposureFill('max');$('lineupFillStop').onclick=()=>{if(exposureFillBusy&&activeGeneration){activeGeneration.cancelled=true;$('lineupFillStatus').textContent='Stopping… Previous batch will be kept.'}};
