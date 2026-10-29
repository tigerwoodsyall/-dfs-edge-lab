let minuteScenarioSignature="";
/* Forecast tracking stays on this device; importing a role never edits official injuries. */
function minuteHistoryState(){if(!state.minuteForecastHistory)state.minuteForecastHistory=[];return state.minuteForecastHistory}
function captureMinuteForecast(rows=null,onlyKey=null,now=Date.now()){
 const history=minuteHistoryState(),map=new Map(history.map(r=>[r.key,r]));let count=0;
 for(const p of state.players){if(onlyKey&&rotationKey(p)!==onlyKey)continue;const start=gameStartInstant(p);if(start===null||start<=now)continue;const r=rows?.find(r=>String(r.player.id)===String(p.id));if(rows&&(!r||!r.ready))continue;
 const minutes=r?r.minutes:num(p.minutes);if(!Number.isFinite(minutes)||minutes<0||minutes>48)continue;const key=nbaKey(p),old=map.get(key);if(old&&old.start<=now)continue;
 const game=nbaGame(p),profile=r?.rotation?.profile,category=profile?.note.startsWith('Similar teammate-absence')?'Injury replacement':profile?.starter===true?'Starter':profile?.starter===false?'Bench':'Unknown';
 map.set(key,{key,id:String(p.id),name:p.name,team:p.team,date:game.date,opponent:game.matchup.split('@').find(t=>t!==p.team),start,capturedAt:now,minutes,category,source:r?'Base model / rotation':'Current projections'});count++;
 }
 state.minuteForecastHistory=[...map.values()].sort((a,b)=>b.capturedAt-a.capturedAt).slice(0,10000);return count;
}
function minuteHistoryResults(){
 const index=new Map();for(const p of baseData?.players||[]){const key=baseName(p.name);if(!index.has(key))index.set(key,[]);index.get(key).push(p)}let changed=false;
 const results=minuteHistoryState().map(f=>{const matches=index.get(baseName(f.name))||[];if(matches.length!==1)return {...f,actual:f.actual??null};
 const match=g=>g.gameDate===f.date&&g.team===f.team&&(!g.opponent||g.opponent===f.opponent),game=matches[0].current?.recent?.find(match);
 if(game){const actual=game.regulationMinutes??game.minutes;if(f.actual!==actual||f.raw!==game.minutes){Object.assign(f,{actual,raw:game.minutes});changed=true}}
 return {...f,actual:f.actual??null};});if(changed)save();return results;
}
function renderMinuteTools(){
 const group=rotationView?.group,signature=group?group.key+'|'+rotationInputSignature(group):'';if(signature!==minuteScenarioSignature){minuteScenarioSignature=signature;$('minuteScenarioRows').innerHTML='';$('minuteScenarioStatus').textContent='Select a player and compare both availability scenarios.'}const starters=group?reportedTeamStarters(group):null;$('startingLineupStatus').textContent=(startingLineupError?startingLineupError+' · ':'')+(startingLineupFeed?'Checked '+new Date(startingLineupFeed.checkedAt).toLocaleString()+' · ':'')+(starters?starters.source+': '+starters.starters.join(', '):'Starting five pending / not verified for this team; using recent-role estimates.');const selected=$('minuteScenarioPlayer').value;$('minuteScenarioPlayer').innerHTML=(group?.rows||[]).map(r=>'<option value="'+escapeHTML(r.player.id)+'">'+escapeHTML(r.player.name)+(r.out?' · Official Out':'')+'</option>').join('');if(group?.rows.some(r=>String(r.player.id)===selected))$('minuteScenarioPlayer').value=selected;
 const results=minuteHistoryResults(),graded=results.filter(f=>f.actual!==null),mae=rows=>rows.length?(rows.reduce((s,f)=>s+Math.abs(f.minutes-f.actual),0)/rows.length).toFixed(2):'—';
 $('minuteHistorySummary').textContent=results.length+' forecasts saved · '+graded.length+' completed comparisons · Mean absolute error: '+mae(graded)+' min. '+['Starter','Bench','Injury replacement'].map(k=>{const a=graded.filter(f=>f.category===k);return k+': '+mae(a)+' ('+a.length+' games)'}).join(' · ');
 $('minuteHistoryRows').innerHTML=results.slice(0,100).map(f=>'<tr><td>'+escapeHTML(f.name+' · '+f.date)+'</td><td>'+escapeHTML(f.category)+'</td><td>'+f.minutes.toFixed(1)+'</td><td>'+(f.actual===null?'Pending':f.actual.toFixed(1)+' / '+f.raw.toFixed(1))+'</td><td>'+(f.actual===null?'—':Math.abs(f.minutes-f.actual).toFixed(1))+'</td></tr>').join('')||'<tr><td colspan="5">No forecasts saved yet. Capture before game time.</td></tr>';
}
function compareMinuteAvailability(id){const group=rotationView?.group;if(!group)throw Error('Select a slate team.');return [false,true].map(out=>{const scenario={...group,availabilityOverrides:{[String(id)]:out}};return allocateCourtMinutes(group.rows.map(r=>rotationMember(r,scenario,String(r.player.id)===String(id)?{availability:out?'out':'in'}:null)))})}
$('minuteScenarioCompare').onclick=()=>{try{const id=$('minuteScenarioPlayer').value,[inside,outside]=compareMinuteAvailability(id);if(!inside.valid||!outside.valid)throw Error('A scenario cannot allocate 240 minutes: '+[...inside.errors,...outside.errors].join(' '));const name=rotationView.group.rows.find(r=>String(r.player.id)===id)?.player.name;$('minuteScenarioStatus').textContent='Preview only: '+name+' playing vs out. Both scenarios total 240 minutes; displayed player values are rounded. Choose an availability assumption and apply the team to use it.';$('minuteScenarioRows').innerHTML=inside.allocation.map(a=>{const b=outside.allocation.find(b=>b.p.id===a.p.id),delta=b.minutes-a.minutes;return '<tr><td>'+escapeHTML(a.p.name)+'</td><td>'+a.minutes.toFixed(1)+'</td><td>'+b.minutes.toFixed(1)+'</td><td>'+(delta>=0?'+':'')+delta.toFixed(1)+'</td></tr>'}).join('')}catch(e){$('minuteScenarioStatus').textContent=e.message}};
$('minuteScenarioPlayer').onchange=()=>{$('minuteScenarioRows').innerHTML='';$('minuteScenarioStatus').textContent='Click Compare to preview this player.'};
$('minuteCapture').onclick=()=>{const n=captureMinuteForecast();save();renderMinuteTools();$('minuteHistoryStatus').textContent='Saved '+n+' pregame forecasts. Started games were not changed.'};
$('minuteHistoryExport').onclick=()=>downloadBaseCSV(baseCSV([['Player','Team','Game Date','Group','Captured At','Projected Minutes','Actual Regulation Minutes','Actual Raw Minutes','Absolute Error'],...minuteHistoryResults().map(f=>[f.name,f.team,f.date,f.category,new Date(f.capturedAt).toISOString(),f.minutes,f.actual??'',f.raw??'',f.actual===null?'':Math.abs(f.minutes-f.actual)])]),'minutes-forecast-tracking.csv');
renderMinuteTools();

$('startingLineupRefresh').onclick=loadStartingLineups;loadStartingLineups();setInterval(loadStartingLineups,120000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadStartingLineups()});
