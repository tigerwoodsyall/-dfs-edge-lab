/* Late-swap entries stay in this browser. No contest entries are sent to a server. */
let lateBusy=false;
const lateStartCache=new Map(),lateEasternFormatter=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function csvMatrix(text){
 const rows=[];let row=[],value='',quoted=false;const s=String(text).replace(/^\uFEFF/,'');
 for(let i=0;i<s.length;i++){const c=s[i];if(c==='"'){if(quoted&&s[i+1]==='"'){value+='"';i++}else quoted=!quoted}else if(c===','&&!quoted){row.push(value);value=''}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&s[i+1]==='\n')i++;row.push(value);rows.push(row);row=[];value=''}else value+=c}
 if(quoted)throw Error('The CSV has an unclosed quoted field. Export it again from DraftKings.');row.push(value);if(row.some(x=>x!==''))rows.push(row);return rows;
}
const lateHeader=s=>String(s||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
function entryPlayerId(cell){const s=String(cell||'').trim().replace(/\s*\(LOCKED\)\s*/gi,'').trim();if(/^\d+$/.test(s))return s;const m=s.match(/\((\d+)\)\s*$/);return m?m[1]:null}
function gameStartInstant(p){
 const key=String(p.gameInfo||'');if(lateStartCache.has(key))return lateStartCache.get(key);const wall=gameStartOrder(p);if(wall===null)return null;const wanted=wall*60000;let instant=wanted;
 for(let i=0;i<3;i++){const v=Object.fromEntries(lateEasternFormatter.formatToParts(new Date(instant)).filter(p=>p.type!=='literal').map(p=>[p.type,+p.value]));const represented=Date.UTC(v.year,v.month-1,v.day,v.hour,v.minute,v.second);const delta=wanted-represented;if(!delta)break;instant+=delta}lateStartCache.set(key,instant);return instant;
}
function latePlayerMap(){return new Map(state.players.map(p=>[String(p.id),p]))}
function activeLateProjectionSource(){
 const source=state.lateProjectionSource;
 return source&&source.slateSignature===lateSlateSignature()?source:null;
}
function lateProjectionPlayers(source=activeLateProjectionSource()){
 return state.players.map(player=>{
  const id=String(player.id),uploaded=source?.records[id],adjustment=source?.adjustments[id];
  const out=typeof nbaOut==='function'&&nbaOut(player);
  if(!source&&!out)return player;
  const projection=out?0:adjustment??uploaded?.projection??0;
  const ceiling=projection>0?Math.max(projection,uploaded?.ceiling??projection*1.4):0;
  return {...player,projection,ceiling,ownership:projection>0?uploaded?.ownership??0:0,
   minutes:projection>0?uploaded?.minutes??0:0,usage:projection>0?uploaded?.usage??0:0,
   standardDeviation:adjustment===undefined?uploaded?.standardDeviation:undefined,
   deviationProjection:projection,deviationCeiling:ceiling,
   lateImportedProjection:uploaded?.projection,
   projectionSource:out?'Officially Out':adjustment!==undefined?'Late Swap adjustment':uploaded?source.label:'Missing from Late Swap upload'};
 });
}
function refreshLateLocks(entry,now=Date.now()){
 let changed=false;entry.locked=entry.locked||Array(8).fill(false);
 entry.ids.forEach((id,j)=>{const p=entry.sourcePlayers[j],start=p?gameStartInstant(p):null;if(!entry.locked[j]&&(entry.csvLocked[j]||start!==null&&start<=now)){entry.locked[j]=true;changed=true}});return changed;
}
function readLateOptions(){
 const min=Number($('lateMinSalary').value),cap=Number($('lateCap').value),mode=$('lateMode').value;
 if(!Number.isInteger(min)||!Number.isInteger(cap)||min<0||cap<0||cap>50000||min>cap)throw Error('Use a salary maximum no greater than $50,000 and a minimum between 0 and that maximum.');
 const rules=new Map(currentTeamNames().map(t=>[t,teamRule(t)]));for(const [team,r] of rules)if(!Number.isInteger(r.min)||!Number.isInteger(r.max)||r.min<0||r.max>8||r.max<r.min)throw Error('Invalid team limits for '+team+'. Update them in Optimizer.');
 return {min,cap,mode,rules,fadedIds:new Set(state.players.filter(p=>p.fade).map(p=>String(p.id))),trials:Math.max(1,Math.min(8000,Number($('lateTrials').value)||100))};
}
function lateSignature(){return JSON.stringify({lateSource:state.lateProjectionSource?.revision,players:state.players.map(p=>[String(p.id),p.name,p.position,p.team,p.salary,p.gameInfo,p.projection,p.ceiling,p.ownership,!!p.fade,!!p.lock,typeof nbaOut==='function'&&nbaOut(p)]),excludedTeams:state.lateExcludedTeams||[],teams:state.teamLimits||{},mode:$('lateMode').value,min:$('lateMinSalary').value,cap:$('lateCap').value,trials:$('lateTrials').value})}
function lateSlateSignature(players=state.players){return JSON.stringify(players.map(p=>[String(p.id),p.position,p.team,p.salary,p.gameInfo]).sort((a,b)=>a[0].localeCompare(b[0])))}
function importLateEntries(text,fileName,now=Date.now()){
 const rows=csvMatrix(text),headerIndex=rows.findIndex(r=>{const h=r.map(lateHeader);return h.includes('entryid')&&SLOTS.every(s=>h.includes(s.toLowerCase()))});
 if(headerIndex<0)throw Error('Upload a DraftKings entries CSV with Entry ID and PG, SG, SF, PF, C, G, F, UTIL columns. A player salary file alone is not an entries file.');
 const header=rows[headerIndex],h=header.map(lateHeader),entryCol=h.indexOf('entryid'),slotCols=SLOTS.map(s=>h.indexOf(s.toLowerCase()));
 if(new Set(slotCols).size!==8)throw Error('The roster columns are ambiguous. Export the entries again.');
 const salaryHeader=rows.findIndex(r=>{const x=r.map(lateHeader);return x.includes('name')&&x.includes('salary')&&(x.includes('position')||x.includes('rosterposition'))&&x.includes('id')});
 let players=state.players;const importWarnings=[],requiredIds=new Set(rows.slice(headerIndex+1).filter(r=>/^\d+$/.test(String(r[entryCol]||'').trim())).flatMap(r=>slotCols.map(c=>entryPlayerId(r[c])).filter(Boolean)));
 if(salaryHeader>=0){const sh=rows[salaryHeader].map(lateHeader),old=latePlayerMap(),extracted=[],salaryRows=rows.slice(salaryHeader+1).map((row,i)=>({line:salaryHeader+i+2,r:Object.fromEntries(sh.map((k,i)=>[k,String(row[i]||'').trim()]))})).filter(x=>/^\d+$/.test(x.r.id||'')&&x.r.name),sameSlate=salaryRows.some(({r})=>{const p=old.get(r.id),start=r.gameinfo?gameStartInstant({gameInfo:r.gameinfo}):null;return p&&start!==null&&start===gameStartInstant(p)&&num(r.salary)===num(p.salary)});
  for(const {r,line} of salaryRows){const previous=old.get(r.id),average=num(r.avgpointspergame),normalizeTeam=t=>typeof blendTeam==='function'?blendTeam(t):t,team=normalizeTeam(r.teamabbrev||r.team||''),position=pos(r.position).length?r.position:pos(r.rosterposition).join('/'),gameInfo=String(r.gameinfo||'').replace(/\b([A-Z]{2,3})@([A-Z]{2,3})\b/g,(_,a,b)=>normalizeTeam(a)+'@'+normalizeTeam(b));const p={...(previous||{}),id:r.id,name:r.name,position,team,salary:num(r.salary),gameInfo,average,projection:previous?num(previous.projection):average,ceiling:previous?num(previous.ceiling):+(average*1.4).toFixed(2),ownership:previous?num(previous.ownership):0,minutes:previous?num(previous.minutes):0,lock:!!previous?.lock,fade:!!previous?.fade};
   const invalid=q=>[!pos(q.position).length?'position':null,q.salary<=0?'salary':null,!gameKey(q)?'team/matchup':null,gameStartInstant(q)===null?'dated start time':null].filter(Boolean);
   let bad=invalid(p);const sameIdentity=previous&&(!team||team===previous.team)&&(!r.salary||num(r.salary)<=0||num(r.salary)===num(previous.salary))&&(typeof blendName!=='function'||blendName(r.name)===blendName(previous.name));
   const startedLabel=/^(?:in[ -]?progress|final(?:\s*\/?\s*\d*ot)?|game[ -]?over|locked|live|started)$/i.test(String(r.gameinfo||'').trim()),priorStart=previous?gameStartInstant(previous):null,todayParts=Object.fromEntries(lateEasternFormatter.formatToParts(new Date(now)).filter(x=>['year','month','day'].includes(x.type)).map(x=>[x.type,x.value])),priorDate=previous?gameStartParts(previous):null,verifiedStarted=startedLabel&&priorStart!==null&&priorStart<=now&&priorDate&&Number(priorDate[1])===Number(todayParts.month)&&Number(priorDate[2])===Number(todayParts.day)&&Number(priorDate[3])===Number(todayParts.year);
   if(bad.length&&sameIdentity&&(sameSlate||verifiedStarted)){const fallback={...p,position:pos(p.position).length?p.position:previous.position,salary:p.salary>0?p.salary:previous.salary,team:p.team||previous.team,gameInfo:!p.gameInfo||verifiedStarted?previous.gameInfo:p.gameInfo};if(!invalid(fallback).length){Object.assign(p,fallback);bad=[];importWarnings.push('Row '+line+' '+p.name+': used verified loaded-slate metadata for missing fields.')}}
   if(bad.length){const message='Salary row '+line+' '+p.name+' (DK ID '+p.id+'): missing/invalid '+bad.join(', ')+'.';if(requiredIds.has(p.id))throw Error(message+' This player is in an entry, so lock status cannot be safely verified. Download a fresh DK entries CSV or load the matching DK salaries.');importWarnings.push(message+' Excluded from replacement candidates.');continue}extracted.push(p);
  }
  if(!extracted.length||new Set(extracted.map(p=>p.id)).size!==extracted.length)throw Error('The embedded salary table is empty or has duplicate player IDs.');players=extracted;
 }
 const map=new Map(players.map(p=>[String(p.id),p])),seen=new Set(),entries=[];
 for(const row of rows.slice(headerIndex+1)){
  const id=String(row[entryCol]||'').trim();if(!/^\d+$/.test(id))continue;if(seen.has(id))throw Error('Duplicate entry ID '+id+'. Export a fresh entries CSV.');seen.add(id);
  const raw=slotCols.map(i=>String(row[i]||'')),ids=raw.map(entryPlayerId),sourcePlayers=ids.map(id=>map.get(id)?{...map.get(id)}:null),issues=[];
  if(ids.some(id=>!id))issues.push('Fill all eight roster slots in DraftKings and export again.');if(ids.filter(Boolean).length!==new Set(ids.filter(Boolean)).size)issues.push('A player appears more than once.');
  sourcePlayers.forEach((p,j)=>{if(ids[j]&&!p)issues.push(SLOTS[j]+': player ID '+ids[j]+' is not in the loaded salary pool.');else if(p&&(!eligible(p,SLOTS[j])||gameStartInstant(p)===null||!gameKey(p)))issues.push(SLOTS[j]+': invalid position or missing game/start time.')});
  const entry={entryId:id,row:row.slice(0,Math.max(...slotCols)+1),raw,ids,sourcePlayers,csvLocked:raw.map(s=>/\(LOCKED\)/i.test(s)),locked:Array(8).fill(false),issues,result:null};refreshLateLocks(entry,now);entries.push(entry);
 }
 if(!entries.length)throw Error('No contest entry rows found in the CSV.');
 state.players=players;state.demo=false;state.slateLabel='Imported late-swap salary pool · '+players.length+' players · '+(lineupGames(players)||'unverified')+' games';
 state.lateSwap={fileName,importWarnings,header:header.slice(0,Math.max(...slotCols)+1),slotCols,entryCol,entries,slateSignature:lateSlateSignature(players),importedAt:now,runSignature:null,ranAt:null};save();renderAll();renderLateSwap();return state.lateSwap;
}
function lateMetric(players,mode){return players.reduce((n,p)=>n+num(p.projection)+(mode==='large'?.28:mode==='small'?.12:0)*Math.max(0,num(p.ceiling)-num(p.projection))-(mode==='large'?.065:mode==='small'?.025:0)*num(p.ownership),0)}
function checkLateLineup(entry,players,options,now=Date.now(),settings=true){
 if(!players||players.length!==8||players.some(p=>!p))return 'Missing players.';if(new Set(players.map(p=>String(p.id))).size!==8)return 'Duplicate player.';
 const salary=players.reduce((n,p)=>n+num(p.salary),0);if(salary>50000)return 'DraftKings salary cap exceeded.';
 for(let j=0;j<8;j++){const p=players[j];if(!eligible(p,SLOTS[j]))return 'Ineligible player in '+SLOTS[j]+'.';const start=gameStartInstant(p);if(start===null)return 'Missing game start time.';if(entry.locked[j]){if(String(p.id)!==entry.ids[j])return 'A locked player moved or changed in '+SLOTS[j]+'.'}else if(start<=now)return 'A replacement game has already started.'}
 if(lineupGames(players)<2)return 'At least two NBA games are required.';
 if(players.some((p,j)=>!entry.locked[j]&&(state.lateExcludedTeams||[]).includes(teamCode(p))))return 'An unlocked player is on an excluded team.';
 if(players.some((p,j)=>!entry.locked[j]&&(p.fade||(options.fadedIds?options.fadedIds.has(String(p.id)):state.players.some(current=>String(current.id)===String(p.id)&&current.fade)))))return 'An unlocked player is faded.';
 const teamCounts=new Map();players.forEach(p=>teamCounts.set(teamCode(p),(teamCounts.get(teamCode(p))||0)+1));for(const [team,r] of options.rules)if((teamCounts.get(team)||0)<r.min||(teamCounts.get(team)||0)>r.max)return 'Team limits cannot be met.';
 if(settings){if(salary<options.min||salary>options.cap)return 'Salary settings cannot be met.';const counts=new Map();players.forEach(p=>counts.set(teamCode(p),(counts.get(teamCode(p))||0)+1));for(const [team,r] of options.rules)if((counts.get(team)||0)<r.min||(counts.get(team)||0)>r.max)return 'Team limits cannot be met.';if(players.some((p,j)=>!entry.locked[j]&&(p.fade||(options.fadedIds?options.fadedIds.has(String(p.id)):state.players.some(current=>String(current.id)===String(p.id)&&current.fade)))))return 'An unlocked player is faded.';if(state.players.some(p=>p.lock&&!players.some(x=>String(x.id)===String(p.id))))return 'Player locks cannot be met.'}
 return null;
}
function arrangeWithFixedSlots(players,entry){
 const allowed=players.map(p=>SLOTS.map((slot,j)=>eligible(p,slot)&&(!entry.locked[j]||String(p.id)===entry.ids[j])&&!entry.locked.some((locked,k)=>locked&&k!==j&&entry.ids[k]===String(p.id)))),times=players.map(gameStartOrder),dp=Array(256).fill(null);dp[0]={flex:0,util:0,order:[]};
 for(let mask=0;mask<256;mask++){const cur=dp[mask];if(!cur||cur.order.length===8)continue;const slot=cur.order.length;for(let i=0;i<8;i++){if(mask&(1<<i)||!allowed[i][slot])continue;const next=mask|(1<<i),c={flex:cur.flex+(slot>=5?times[i]:0),util:cur.util+(slot===7?times[i]:0),order:[...cur.order,i]},old=dp[next];if(!old||c.flex>old.flex||c.flex===old.flex&&c.util>old.util)dp[next]=c}}
 return dp[255]?dp[255].order.map(i=>players[i]):null;
}
// Cache player-level calculations once per batch, rather than for every candidate draw.
function createLateSearchContext(options){
 const noiseScale=options.mode==='large'?.85:.55,ceilingWeight=options.mode==='large'?.23:options.mode==='small'?.12:0,ownWeight=options.mode==='large'?5:options.mode==='small'?2:0;
 const source=activeLateProjectionSource(),players=lateProjectionPlayers(source);
 return {uploaded:!!source,map:new Map(players.map(p=>[String(p.id),p])),required:state.players.filter(p=>p.lock).map(p=>String(p.id)),meta:players.map(p=>{const weight=Math.pow(p.salary/1000,.25);return {p,id:String(p.id),team:teamCode(p),start:gameStartInstant(p),slots:SLOTS.map(slot=>eligible(p,slot)),weight,base:p.projection+ceilingWeight*Math.max(0,p.ceiling-p.projection)-ownWeight*Math.min(100,p.ownership)/100,noise:(source?(p.standardDeviation??Math.max(3,(p.ceiling-p.projection)/1.645,p.projection*.19)):playerSimulationSD(p))*noiseScale}})};
}
function* searchLateEntry(entry,options,now,context){
 refreshLateLocks(entry,now);if(entry.issues.length)return {error:entry.issues.join(' ')};
 const map=context.map,original=entry.ids.map((id,j)=>({...entry.sourcePlayers[j],projection:num(map.get(id)?.projection),ceiling:num(map.get(id)?.ceiling),ownership:num(map.get(id)?.ownership),fade:!!map.get(id)?.fade}));
 const originalHasProjections=!context.uploaded||original.every((p,j)=>entry.locked[j]||p.projection>0);
 const fixed=original.map((p,j)=>entry.locked[j]?p:null),fixedIds=new Set(fixed.filter(Boolean).map(p=>String(p.id))),open=SLOTS.map((slot,j)=>({slot,j})).filter(x=>!entry.locked[x.j]);
 if(!open.length)return {players:original,status:'All players locked — original slots preserved.'};
 const pool=context.meta.filter(m=>!fixedIds.has(m.id)&&!m.p.fade&&!(state.lateExcludedTeams||[]).includes(m.team)&&m.p.projection>0&&m.p.salary>0&&m.start!==null&&m.start>now);
 const required=context.required.filter(id=>!fixedIds.has(id));
 let best=!originalHasProjections||checkLateLineup(entry,original,options,now,true)?null:original,bestScore=best?lateMetric(best,options.mode):-Infinity;
 if(required.every(id=>pool.some(m=>m.id===id))){
  const choices=open.map(x=>({...x,choices:pool.filter(m=>m.slots[x.j])})).sort((a,b)=>a.choices.length-b.choices.length),floor=pool.length?Math.min(...pool.map(m=>m.p.salary)):Infinity;
  for(let t=0;t<options.trials;t++){
   if(t%16===0)yield;
   const picked=fixed.slice(),taken=new Set(fixedIds),counts=new Map();fixed.filter(Boolean).forEach(p=>counts.set(teamCode(p),(counts.get(teamCode(p))||0)+1));let budget=options.cap-fixed.filter(Boolean).reduce((n,p)=>n+p.salary,0),valid=true;
   for(let k=0;k<choices.length;k++){const e=choices[k],remaining=choices.length-k;
    const deficit=[...options.rules].reduce((n,[team,r])=>n+Math.max(0,r.min-(counts.get(team)||0)),0);if(deficit>remaining){valid=false;break}
    const needed=required.filter(id=>!taken.has(id)),top=[];
    for(const m of e.choices){const p=m.p,count=counts.get(m.team)||0;
     if(taken.has(m.id)||p.salary>budget-(remaining-1)*floor||count>=(options.rules.get(m.team)?.max??8)||deficit===remaining&&count>=(options.rules.get(m.team)?.min??0)||needed.length>=remaining&&!needed.includes(m.id))continue;
     const value=(m.base+normal()*m.noise)/m.weight+Math.random()*4;
     let at=top.length;while(at>0&&top[at-1].score<value)at--;if(at<7){top.splice(at,0,{m,score:value});if(top.length>7)top.pop()}
    }
    if(!top.length){valid=false;break}const m=top[Math.floor(Math.pow(Math.random(),2.3)*top.length)].m,p=m.p;
    picked[e.j]=p;taken.add(m.id);counts.set(m.team,(counts.get(m.team)||0)+1);budget-=p.salary;
   }
   if(!valid||checkLateLineup(entry,picked,options,now,true))continue;const value=lateMetric(picked,options.mode);if(value>bestScore+1e-8){best=picked;bestScore=value}
  }
 }
 if(!best&&!originalHasProjections)return {error:'No valid swap found with the uploaded projections. An original unlocked player has no positive projection.'};
 if(!best)return checkLateLineup(entry,original,options,now,false)?{error:'No legal swap found that honors locked slots and team exclusions. Try more search attempts or relax constraints.'}:{players:original,status:'Original retained — no lineup found that meets the current settings.'};
 best=arrangeWithFixedSlots(best,entry)||best;return {players:best,status:best.some((p,j)=>String(p.id)!==entry.ids[j])?'Optimized unlocked slots.':'Original retained — no better lineup found.'};
}
function solveLateEntry(entry,options,now=Date.now(),context=createLateSearchContext(options)){
 const search=searchLateEntry(entry,options,now,context);let step;do{step=search.next()}while(!step.done);return step.value;
}
async function solveLateEntryResponsive(entry,options,now,context,validate){
 const search=searchLateEntry(entry,options,now,context);let lastYield=performance.now();
 for(;;){const step=search.next();if(step.done)return step.value;if(performance.now()-lastYield>=8){await new Promise(resolve=>setTimeout(resolve,0));validate();lastYield=performance.now()}}
}
function lateExportRows(now=Date.now()){
 const batch=state.lateSwap;if(!batch||!batch.entries.length)throw Error('Import your filled DraftKings entries CSV first.');if(batch.slateSignature!==lateSlateSignature())throw Error('The player pool differs from the imported entries slate. Reimport current entries before late swapping.');if(batch.runSignature!==lateSignature())throw Error('Projections, player pool or settings changed. Run Late Swap again before export.');const options=readLateOptions();
 const rows=[batch.header];for(const entry of batch.entries){refreshLateLocks(entry,now);if(entry.issues.length||!entry.result?.players)throw Error('Every imported entry must be valid before export. Correct the flagged entries and reimport.');const problem=checkLateLineup(entry,entry.result.players,options,now,false);if(problem)throw Error(problem+' Run Late Swap again using the current lock times.');const row=entry.row.slice();entry.result.players.forEach((p,j)=>{row[batch.slotCols[j]]=String(p.id)===entry.ids[j]?entry.raw[j]:p.name+' ('+p.id+')'});rows.push(row)}return rows;
}
function lateExportText(now=Date.now()){return lateExportRows(now).map(row=>row.map(x=>'"'+String(x??'').replace(/"/g,'""')+'"').join(',')).join('\r\n')}
function renderLateSwap(){
 renderLateSelectionControls();
 const now=Date.now(),batch=state.lateSwap;let changed=false;$('lateClock').textContent='Lock check: '+new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'medium'}).format(new Date(now))+' Eastern time';
 $('lateImport').disabled=lateBusy;$('lateProjImport').disabled=lateBusy;$('lateRun').disabled=lateBusy||!batch||!batch.entries.some(e=>!e.issues.length);$('lateExport').disabled=true;
 if(!batch){$('lateEntries').innerHTML='<p>Upload a filled DraftKings entries CSV to review locked players and open roster slots.</p>';return}
 const map=new Map(lateProjectionPlayers().map(p=>[String(p.id),p])),stale=batch.runSignature&&batch.runSignature!==lateSignature(),slateChanged=batch.slateSignature!==lateSlateSignature();
 if(slateChanged){$('lateRun').disabled=true;$('lateStatus').textContent='The player pool differs from the imported entries slate. Reimport current entries before late swapping.'}else if(stale)$('lateStatus').textContent='Projections, player pool or settings changed. Run Late Swap again.';
 let exportError=null;if(batch.runSignature&&!lateBusy)try{lateExportRows(now);$('lateExport').disabled=false}catch(e){exportError=e.message}
 if(exportError&&!stale&&!lateBusy)$('lateStatus').textContent=exportError;
 $('lateEntries').innerHTML=batch.entries.map(entry=>{changed=refreshLateLocks(entry,now)||changed;const players=entry.result?.players||entry.sourcePlayers,remaining=players.reduce((n,p,j)=>n+(!entry.locked[j]?num(map.get(String(p?.id))?.projection):0),0),salary=players.reduce((n,p)=>n+num(p?.salary),0);return '<div class="lineup"><div class="lineuphead"><b>Entry '+escapeHTML(entry.entryId)+'</b><span class="chip">'+entry.locked.filter(Boolean).length+' locked · '+entry.locked.filter(x=>!x).length+' open</span></div><p class="note">'+escapeHTML(entry.issues.join(' ')||entry.result?.error||entry.result?.status||'Ready to optimize unlocked slots.')+'</p><p class="note">Salary $'+salary.toLocaleString()+' · Remaining projection '+remaining.toFixed(1)+' · '+(lineupGames(players.filter(Boolean))||'unverified')+' games</p>'+SLOTS.map((slot,j)=>{const p=players[j];return '<div class="slot"><span>'+slot+'</span><b>'+escapeHTML(p?.name||'Empty / unknown player')+' <small>'+escapeHTML(p?teamCode(p)+' · '+startTimeLabel(p):'')+'</small></b><small class="'+(entry.locked[j]?'danger':'good')+'">'+(entry.locked[j]?'LOCKED':'OPEN')+'</small><small>$'+num(p?.salary).toLocaleString()+'</small></div>'}).join('')+'</div>'}).join('');if(changed)save();
}
$('lateImport').onclick=async()=>{const file=$('lateFile').files[0];if(!file){$('lateStatus').textContent='Choose your filled DraftKings entries CSV first.';return}try{const batch=importLateEntries(await readImportText(file,'entries'),file.name);const invalid=batch.entries.filter(e=>e.issues.length).length;$('lateStatus').textContent='Imported '+batch.entries.length+' entries. '+(invalid?invalid+' need attention before export.':'Review locks, update projections, then run Late Swap.')+(batch.importWarnings?.length?' '+batch.importWarnings.length+' salary-table warnings: '+batch.importWarnings.slice(0,3).join(' '):'')}catch(e){$('lateStatus').textContent='Entries import failed: '+e.message}renderLateSwap()};
function importLateProjections(text,fileName){
 const source=makeFileProjectionSource(text,fileName),result=computeFileProjections(source);
 if(result.errors.length)throw Error(result.errors.slice(0,8).join(' '));
 if(![...result.records.values()].some(({values})=>values.projection>0))throw Error('No matched players have a positive projection.');
 const records=Object.fromEntries([...result.records].map(([id,{values}])=>[id,values]));
 state.lateProjectionSource={slateSignature:lateSlateSignature(),label:fileName,records,adjustments:{},revision:(state.lateProjectionSource?.revision||0)+1};
 if(state.lateSwap)state.lateSwap.runSignature=null;
 save();renderLateSwap();return result;
}

function mergeLateProjectionFiles(files){
 const results=files.map(f=>{const source=makeFileProjectionSource(f.text,f.name),result=computeFileProjections(source);if(result.errors.length)throw Error(f.name+': '+result.errors.slice(0,4).join(' '));return result});
 const fields=['projection','ceiling','minutes','ownership','usage','standardDeviation'],rows=[['ID','Name',...fields]];
 for(const p of state.players){
 const records=results.map(r=>r.records.get(String(p.id))),excluded=records.some(r=>!r||r.values.projection===0),values={};
 for(const field of fields){const numbers=records.map(r=>r?.values[field]).filter(v=>typeof v==='number'&&Number.isFinite(v));values[field]=numbers.length?numbers.reduce((a,b)=>a+b,0)/numbers.length:''}
 if(excluded){values.projection=0;values.ownership=0;values.minutes=0;values.ceiling=0}
 // Missing SD remains estimated by the model; do not average incomplete deviation inputs.
 if(records.some(r=>r?.values.standardDeviation===undefined))values.standardDeviation='';
 else values.standardDeviation=Math.sqrt(records.reduce((n,r)=>n+r.values.standardDeviation**2,0)/records.length);
 rows.push([p.id,p.name,...fields.map(f=>values[f])]);
 }
 return baseCSV(rows);
}
$('lateProjImport').onclick=async()=>{
 const files=[...$('lateProjFile').files];if(!files.length){$('lateStatus').textContent='Choose one or more updated projection files first.';return}
 const signature=lateSignature();$('lateProjImport').disabled=true;
 try{
 const inputs=await Promise.all(files.map(async f=>({name:f.name,text:await readImportText(f,'projections')})));
 if(lateSignature()!==signature)throw Error('Player inputs changed while reading files. Try again.');
 const text=inputs.length===1?inputs[0].text:mergeLateProjectionFiles(inputs),label=inputs.map(f=>f.name).join(' + '),result=importLateProjections(text,label);
 $('lateStatus').textContent='Imported '+inputs.length+' projection file'+(inputs.length===1?'':'s; merged equally')+'. Late Swap only: '+[...result.records.values()].filter(({values})=>values.projection>0).length+' matched players with positive projections before injury checks. Missing and zero projections are excluded from open slots.';
 }catch(e){$('lateStatus').textContent='Projection import failed: '+e.message}
 finally{$('lateProjImport').disabled=false;renderLateSwap()}
};
$('lateRefresh').onclick=()=>{renderLateSwap();$('lateStatus').textContent='Lock status refreshed using current Eastern time. Run again if any replacement has locked.'};
$('lateRun').onclick=async()=>{
 const batch=state.lateSwap;if(!batch||lateBusy)return;if(batch.slateSignature!==lateSlateSignature()){$('lateStatus').textContent='The player pool differs from the imported entries slate. Reimport current entries before late swapping.';renderLateSwap();return}let options;try{options=readLateOptions()}catch(e){$('lateStatus').textContent=e.message;return}const signature=lateSignature();batch.runSignature=null;lateBusy=true;renderLateSwap();
 try{const context=createLateSearchContext(options);for(let i=0;i<batch.entries.length;i++){$('lateStatus').textContent='Optimizing entry '+(i+1)+' of '+batch.entries.length+'…';await new Promise(r=>setTimeout(r,0));if(state.lateSwap!==batch||lateSignature()!==signature)throw Error('Inputs changed during optimization. Run Late Swap again.');batch.entries[i].result=await solveLateEntryResponsive(batch.entries[i],options,Date.now(),context,()=>{if(state.lateSwap!==batch||lateSignature()!==signature)throw Error('Inputs changed during optimization. Run Late Swap again.')})}
  batch.runSignature=signature;batch.ranAt=Date.now();save();const blocked=batch.entries.filter(e=>e.result?.error||e.issues.length).length;$('lateStatus').textContent='Processed '+batch.entries.length+' entries. '+(blocked?blocked+' blocked; correct the flagged entries before export.':'Locked slots preserved. Review the results, then export your entries CSV.');
 }catch(e){batch.runSignature=null;$('lateStatus').textContent=e.message}finally{lateBusy=false;renderLateSwap()}
};
$('lateExport').onclick=()=>{try{const text=lateExportText(),url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='DKEntries-late-swap.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);$('lateStatus').textContent='Entries CSV exported. Entry IDs and locked roster cells are preserved.'}catch(e){$('lateStatus').textContent=e.message}renderLateSwap()};
['lateMode','lateMinSalary','lateCap','lateTrials'].forEach(id=>$(id).addEventListener('change',renderLateSwap));
$('lateClear').onclick=()=>{if(lateBusy)return;state.lateSwap=null;save();$('lateStatus').textContent='Imported late-swap entries cleared from this browser.';renderLateSwap()};

function renderLateSelectionControls(){
 if(!$('lateTeamExclusions'))return;
 const teams=[...new Set(state.players.map(teamCode))].sort(),excluded=new Set(state.lateExcludedTeams||[]);
 $('lateTeamLimitRows').innerHTML=teams.map(t=>{const r=teamRule(t);return '<tr><td>'+escapeHTML(t)+'</td><td><input class="tiny" type="number" min="0" max="8" step="1" aria-label="Minimum players from '+escapeHTML(t)+'" data-late-team="'+escapeHTML(t)+'" data-bound="min" value="'+r.min+'" '+(lateBusy?'disabled':'')+'></td><td><input class="tiny" type="number" min="0" max="8" step="1" aria-label="Maximum players from '+escapeHTML(t)+'" data-late-team="'+escapeHTML(t)+'" data-bound="max" value="'+r.max+'" '+(lateBusy?'disabled':'')+'></td></tr>'}).join('');$('lateApplyTeamLimits').disabled=lateBusy||!teams.length;$('lateSetAllTeamMax').disabled=lateBusy||!teams.length;
 $('lateTeamExclusions').innerHTML=teams.map(t=>'<label style="display:inline-flex;align-items:center;gap:6px;margin:6px 12px 6px 0"><input style="width:auto" type="checkbox" data-late-exclude="'+escapeHTML(t)+'" '+(excluded.has(t)?'checked ':'')+(lateBusy?'disabled':'')+'>Exclude '+escapeHTML(t)+'</label>').join('')||'Load player salaries first.';
 const source=activeLateProjectionSource();
 $('lateProjectionSourceStatus').textContent=source?'Late Swap projections: '+source.label:'Using current site projections. Upload a file to use its projections exclusively in Late Swap.';
 const q=$('latePlayerSearch').value.toLowerCase(),now=Date.now();
 $('latePlayerLocks').innerHTML=lateProjectionPlayers(source).filter(p=>(p.name+' '+teamCode(p)).toLowerCase().includes(q)).sort((a,b)=>num(b.projection)-num(a.projection)).map(p=>{
 const started=gameStartInstant(p)!==null&&gameStartInstant(p)<=now,editable=!lateBusy&&!started&&(!source||p.lateImportedProjection>0)&&!(typeof nbaOut==='function'&&nbaOut(p));
 return '<tr><td>'+escapeHTML(p.name)+'</td><td>'+escapeHTML(teamCode(p))+'</td><td>'+'<div class="projection-control"><button type="button" data-late-boost="-1" data-late-id="'+escapeHTML(p.id)+'" '+(!editable?'disabled':'')+'>−5%</button><input class="tiny" type="number" min="0" step="0.01" aria-label="Late Swap projection for '+escapeHTML(p.name)+'" data-late-projection="'+escapeHTML(p.id)+'" value="'+num(p.projection).toFixed(2)+'" '+(!editable?'disabled':'')+'><button type="button" data-late-boost="1" data-late-id="'+escapeHTML(p.id)+'" '+(!editable?'disabled':'')+'>+5%</button></div><small title="'+escapeHTML(p.projectionSource||'Current applied projection')+'">'+(Number.isFinite(p.lateImportedProjection)?'Uploaded: '+p.lateImportedProjection.toFixed(2):escapeHTML(p.projectionSource||'Current site projection'))+'</small></td><td>'+num(p.ownership).toFixed(2)+'%</td><td>'+(started?'Started — entry locks apply':'<input style="width:auto" type="checkbox" aria-label="Lock '+escapeHTML(p.name)+' in Late Swap" data-late-player="'+escapeHTML(p.id)+'" '+(p.lock?'checked ':'')+(lateBusy?'disabled':'')+'>')+'</td><td><input style="width:auto" type="checkbox" aria-label="Fade '+escapeHTML(p.name)+' in Late Swap" data-late-fade="'+escapeHTML(p.id)+'" '+(p.fade?'checked ':'')+(lateBusy||started?'disabled':'')+'></td></tr>';
 }).join('');
}

$('lateSetAllTeamMax').onclick=()=>{
 if(lateBusy)return;const raw=$('lateGlobalTeamMax').value,value=Number(raw);
 if(raw.trim()===''||!Number.isInteger(value)||value<0||value>8){$('lateTeamLimitStatus').textContent='Enter a whole-number maximum from 0 to 8.';return}
 const inputs=[...$('lateTeamLimitRows').querySelectorAll('input[data-bound="max"]')];
 if(!inputs.length)return;for(const input of inputs)input.value=String(value);
 $('lateApplyTeamLimits').onclick();
};
$('lateApplyTeamLimits').onclick=()=>{
 if(lateBusy)return;
 try{
 const next={...(state.teamLimits||{})};
 for(const input of $('lateTeamLimitRows').querySelectorAll('input[data-late-team]')){
 const team=input.dataset.lateTeam,value=Number(input.value);
 if(input.value.trim()===''||!Number.isInteger(value)||value<0||value>8)throw Error('Use whole numbers from 0 to 8 for '+team+'.');
 next[team]={...(next[team]||teamRule(team)),[input.dataset.bound]:value};
 }
 let total=0;for(const team of currentTeamNames()){const r=next[team]||teamRule(team);if(r.min>r.max)throw Error(team+': minimum cannot exceed maximum.');if((state.lateExcludedTeams||[]).includes(team)&&r.min>0)throw Error(team+' is excluded. Clear its exclusion or set minimum to 0.');total+=r.min}
 if(total>8)throw Error('Team minimums total more than 8 players.');
 state.teamLimits=next;if(state.lateSwap)state.lateSwap.runSignature=null;save();renderLateSwap();$('lateTeamLimitStatus').textContent='Team limits applied.';
 if(state.lateSwap&&state.lateSwap.entries.some(e=>!e.issues.length))setTimeout(()=>{if(!lateBusy)$('lateRun').onclick()},0);
 }catch(e){$('lateTeamLimitStatus').textContent=e.message}
};

$('latePlayerSearch').oninput=renderLateSelectionControls;
$('lateTeamExclusions').onchange=e=>{if(lateBusy||!e.target.dataset.lateExclude)return;const team=e.target.dataset.lateExclude,teams=new Set(state.lateExcludedTeams||[]);if(e.target.checked)teams.add(team);else teams.delete(team);state.lateExcludedTeams=[...teams];if(state.lateSwap)state.lateSwap.runSignature=null;save();renderLateSwap();$('lateStatus').textContent='Team exclusions updated. Started players stay locked; optimizing open slots…';if(state.lateSwap&&state.lateSwap.entries.some(e=>!e.issues.length))setTimeout(()=>{if(!lateBusy)$('lateRun').onclick()},0)};
function editLateProjection(id,value){
 if(lateBusy)return;const p=state.players.find(p=>String(p.id)===String(id));if(!p)return;
 const start=gameStartInstant(p);if(start!==null&&start<=Date.now())throw Error('Started players cannot be adjusted here.');
 if(typeof nbaOut==='function'&&nbaOut(p))throw Error('Officially Out players remain at zero.');
 if(String(value).trim()===''||!Number.isFinite(Number(value))||Number(value)<0)throw Error('Enter a nonnegative projected point total.');
 const source=activeLateProjectionSource(),projection=+Number(value).toFixed(2);
 if(source){
  if(!(source.records[id]?.projection>0))throw Error('Upload a positive projection for this player before adjusting it.');
  source.adjustments[id]=projection;
  source.revision++;
 }else{
  p.projection=projection;p.ceiling=Math.max(num(p.ceiling),p.projection);p.projectionSource='Manual Late Swap adjustment';
  if(typeof forgetManagedRotations==='function')forgetManagedRotations([String(id)]);
 }
 if(state.lateSwap)state.lateSwap.runSignature=null;
 save();if(!source)renderAll();renderLateSwap();
 $('lateStatus').textContent='Projection updated for '+p.name+'. Select Optimize Unlocked Slots to use your adjustments.';

}
$('latePlayerLocks').onclick=e=>{const b=e.target.closest('button[data-late-boost]');if(!b)return;const p=lateProjectionPlayers().find(p=>String(p.id)===b.dataset.lateId);if(!p)return;try{editLateProjection(p.id,num(p.projection)*(1+Number(b.dataset.lateBoost)*.05))}catch(error){$('lateStatus').textContent=error.message}};
$('latePlayerLocks').onchange=e=>{
 if(e.target.dataset.lateProjection){try{editLateProjection(e.target.dataset.lateProjection,e.target.value)}catch(error){$('lateStatus').textContent=error.message;renderLateSelectionControls()}return}
 const id=e.target.dataset.latePlayer||e.target.dataset.lateFade;
 if(lateBusy||!id)return;const p=state.players.find(p=>String(p.id)===id);if(!p)return;
 const fade=!!e.target.dataset.lateFade;p[fade?'fade':'lock']=e.target.checked;
 if(e.target.checked)p[fade?'lock':'fade']=false;
 if(state.lateSwap)state.lateSwap.runSignature=null;save();renderLateSwap();
 $('lateStatus').textContent='Player '+(fade?'fade':'lock')+' updated. Reoptimizing open slots…';
 if(state.lateSwap&&state.lateSwap.entries.some(e=>!e.issues.length))setTimeout(()=>{if(!lateBusy)$('lateRun').onclick()},0);
};

renderLateSwap();setInterval(()=>{if($('lateSwap').classList.contains('active')&&!lateBusy)renderLateSwap()},15000);

