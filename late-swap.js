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
function refreshLateLocks(entry,now=Date.now()){
 let changed=false;entry.locked=entry.locked||Array(8).fill(false);
 entry.ids.forEach((id,j)=>{const p=entry.sourcePlayers[j],start=p?gameStartInstant(p):null;if(!entry.locked[j]&&(entry.csvLocked[j]||start!==null&&start<=now)){entry.locked[j]=true;changed=true}});return changed;
}
function readLateOptions(){
 const min=Number($('lateMinSalary').value),cap=Number($('lateCap').value),mode=$('lateMode').value;
 if(!Number.isInteger(min)||!Number.isInteger(cap)||min<0||cap<0||cap>50000||min>cap)throw Error('Use a salary maximum no greater than $50,000 and a minimum between 0 and that maximum.');
 const rules=new Map(currentTeamNames().map(t=>[t,teamRule(t)]));for(const [team,r] of rules)if(!Number.isInteger(r.min)||!Number.isInteger(r.max)||r.min<0||r.max>8||r.max<r.min)throw Error('Invalid team limits for '+team+'. Update them in Optimizer.');
 return {min,cap,mode,rules,trials:Number($('lateTrials').value)||1500};
}
function lateSignature(){return JSON.stringify({players:state.players.map(p=>[String(p.id),p.name,p.position,p.team,p.salary,p.gameInfo,p.projection,p.ceiling,p.ownership,!!p.fade,!!p.lock]),teams:state.teamLimits||{},mode:$('lateMode').value,min:$('lateMinSalary').value,cap:$('lateCap').value,trials:$('lateTrials').value})}
function lateSlateSignature(players=state.players){return JSON.stringify(players.map(p=>[String(p.id),p.position,p.team,p.salary,p.gameInfo]).sort((a,b)=>a[0].localeCompare(b[0])))}
function importLateEntries(text,fileName,now=Date.now()){
 const rows=csvMatrix(text),headerIndex=rows.findIndex(r=>{const h=r.map(lateHeader);return h.includes('entryid')&&SLOTS.every(s=>h.includes(s.toLowerCase()))});
 if(headerIndex<0)throw Error('Upload a DraftKings entries CSV with Entry ID and PG, SG, SF, PF, C, G, F, UTIL columns. A player salary file alone is not an entries file.');
 const header=rows[headerIndex],h=header.map(lateHeader),entryCol=h.indexOf('entryid'),slotCols=SLOTS.map(s=>h.indexOf(s.toLowerCase()));
 if(new Set(slotCols).size!==8)throw Error('The roster columns are ambiguous. Export the entries again.');
 const salaryHeader=rows.findIndex(r=>{const x=r.map(lateHeader);return x.includes('name')&&x.includes('salary')&&x.includes('position')&&x.includes('id')});
 let players=state.players;
 if(salaryHeader>=0){const sh=rows[salaryHeader].map(lateHeader),old=latePlayerMap();const extracted=[];
  for(const row of rows.slice(salaryHeader+1)){const r=Object.fromEntries(sh.map((k,i)=>[k,String(row[i]||'').trim()]));if(!/^\d+$/.test(r.id||'')||!r.name)continue;const previous=old.get(r.id),average=num(r.avgpointspergame);const p={...(previous||{}),id:r.id,name:r.name,position:r.position,team:r.teamabbrev||r.team||'',salary:num(r.salary),gameInfo:r.gameinfo||'',average,projection:previous?num(previous.projection):average,ceiling:previous?num(previous.ceiling):+(average*1.4).toFixed(2),ownership:previous?num(previous.ownership):0,minutes:previous?num(previous.minutes):0,lock:!!previous?.lock,fade:!!previous?.fade};
   if(!pos(p.position).length||p.salary<=0||!gameKey(p)||gameStartInstant(p)===null)throw Error('The embedded salary table has missing or invalid positions, salaries or start times.');extracted.push(p)}
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
 state.lateSwap={fileName,header:header.slice(0,Math.max(...slotCols)+1),slotCols,entryCol,entries,slateSignature:lateSlateSignature(players),importedAt:now,runSignature:null,ranAt:null};save();renderAll();renderLateSwap();return state.lateSwap;
}
function lateMetric(players,mode){return players.reduce((n,p)=>n+num(p.projection)+(mode==='large'?.28:mode==='small'?.12:0)*Math.max(0,num(p.ceiling)-num(p.projection))-(mode==='large'?.065:mode==='small'?.025:0)*num(p.ownership),0)}
function checkLateLineup(entry,players,options,now=Date.now(),settings=true){
 if(!players||players.length!==8||players.some(p=>!p))return 'Missing players.';if(new Set(players.map(p=>String(p.id))).size!==8)return 'Duplicate player.';
 const salary=players.reduce((n,p)=>n+num(p.salary),0);if(salary>50000)return 'DraftKings salary cap exceeded.';
 for(let j=0;j<8;j++){const p=players[j];if(!eligible(p,SLOTS[j]))return 'Ineligible player in '+SLOTS[j]+'.';const start=gameStartInstant(p);if(start===null)return 'Missing game start time.';if(entry.locked[j]){if(String(p.id)!==entry.ids[j])return 'A locked player moved or changed in '+SLOTS[j]+'.'}else if(start<=now)return 'A replacement game has already started.'}
 if(lineupGames(players)<2)return 'At least two NBA games are required.';
 if(settings){if(salary<options.min||salary>options.cap)return 'Salary settings cannot be met.';const counts=new Map();players.forEach(p=>counts.set(teamCode(p),(counts.get(teamCode(p))||0)+1));for(const [team,r] of options.rules)if((counts.get(team)||0)<r.min||(counts.get(team)||0)>r.max)return 'Team limits cannot be met.';if(players.some((p,j)=>!entry.locked[j]&&p.fade))return 'An unlocked player is faded.';if(state.players.some(p=>p.lock&&!players.some(x=>String(x.id)===String(p.id))))return 'Player locks cannot be met.'}
 return null;
}
function arrangeWithFixedSlots(players,entry){
 const times=players.map(gameStartOrder),dp=Array(256).fill(null);dp[0]={flex:0,util:0,order:[]};
 for(let mask=0;mask<256;mask++){const cur=dp[mask];if(!cur||cur.order.length===8)continue;const slot=cur.order.length;for(let i=0;i<8;i++){if(mask&(1<<i)||!eligible(players[i],SLOTS[slot])||entry.locked[slot]&&String(players[i].id)!==entry.ids[slot]||entry.locked.some((locked,j)=>locked&&j!==slot&&entry.ids[j]===String(players[i].id)))continue;const next=mask|(1<<i),c={flex:cur.flex+(slot>=5?times[i]:0),util:cur.util+(slot===7?times[i]:0),order:[...cur.order,i]},old=dp[next];if(!old||c.flex>old.flex||c.flex===old.flex&&c.util>old.util)dp[next]=c}}
 return dp[255]?dp[255].order.map(i=>players[i]):null;
}
function solveLateEntry(entry,options,now=Date.now()){
 refreshLateLocks(entry,now);if(entry.issues.length)return {error:entry.issues.join(' ')};
 const map=latePlayerMap(),original=entry.ids.map((id,j)=>({...entry.sourcePlayers[j],projection:num(map.get(id)?.projection),ceiling:num(map.get(id)?.ceiling),ownership:num(map.get(id)?.ownership),fade:!!map.get(id)?.fade}));
 const fixed=original.map((p,j)=>entry.locked[j]?p:null),fixedIds=new Set(fixed.filter(Boolean).map(p=>String(p.id))),open=SLOTS.map((slot,j)=>({slot,j})).filter(x=>!entry.locked[x.j]);
 if(!open.length)return {players:original,status:'All players locked — original slots preserved.'};
 const pool=state.players.filter(p=>!fixedIds.has(String(p.id))&&!p.fade&&p.projection>0&&p.salary>0&&gameStartInstant(p)!==null&&gameStartInstant(p)>now);
 const required=state.players.filter(p=>p.lock&&!fixedIds.has(String(p.id))).map(p=>String(p.id));
 let best=checkLateLineup(entry,original,options,now,true)?null:original,bestScore=best?lateMetric(best,options.mode):-Infinity;
 if(required.every(id=>pool.some(p=>String(p.id)===id))){
  const choices=open.map(x=>({...x,choices:pool.filter(p=>eligible(p,x.slot))})).sort((a,b)=>a.choices.length-b.choices.length),floor=pool.length?Math.min(...pool.map(p=>p.salary)):Infinity;
  for(let t=0;t<options.trials;t++){
   const picked=fixed.slice(),taken=new Set(fixedIds),counts=new Map();fixed.filter(Boolean).forEach(p=>counts.set(teamCode(p),(counts.get(teamCode(p))||0)+1));let budget=options.cap-fixed.filter(Boolean).reduce((n,p)=>n+p.salary,0),valid=true;
   for(let k=0;k<choices.length;k++){const e=choices[k],remaining=choices.length-k;let candidates=e.choices.filter(p=>!taken.has(String(p.id))&&p.salary<=budget-(remaining-1)*floor&&(counts.get(teamCode(p))||0)<(options.rules.get(teamCode(p))?.max??8));
    const deficit=[...options.rules].reduce((n,[team,r])=>n+Math.max(0,r.min-(counts.get(team)||0)),0);if(deficit>remaining){valid=false;break}if(deficit===remaining)candidates=candidates.filter(p=>(counts.get(teamCode(p))||0)<options.rules.get(teamCode(p)).min);
    const needed=required.filter(id=>!taken.has(id));if(needed.length>=remaining)candidates=candidates.filter(p=>needed.includes(String(p.id)));
    if(!candidates.length){valid=false;break}const ranked=candidates.map(p=>({p,score:score(p,options.mode)/Math.pow(p.salary/1000,.25)+Math.random()*4})).sort((a,b)=>b.score-a.score),top=ranked.slice(0,7),p=top[Math.floor(Math.pow(Math.random(),2.3)*top.length)].p;
    picked[e.j]={...p};taken.add(String(p.id));counts.set(teamCode(p),(counts.get(teamCode(p))||0)+1);budget-=p.salary;
   }
   if(!valid||checkLateLineup(entry,picked,options,now,true))continue;const value=lateMetric(picked,options.mode);if(value>bestScore+1e-8){best=picked;bestScore=value}
  }
 }
 if(!best)return checkLateLineup(entry,original,options,now,false)?{error:'No legal swap found and the original lineup is invalid.'}:{players:original,status:'Original retained — no lineup found that meets the current settings.'};
 best=arrangeWithFixedSlots(best,entry)||best;return {players:best,status:best.some((p,j)=>String(p.id)!==entry.ids[j])?'Optimized unlocked slots.':'Original retained — no better lineup found.'};
}
function lateExportRows(now=Date.now()){
 const batch=state.lateSwap;if(!batch||!batch.entries.length)throw Error('Import your filled DraftKings entries CSV first.');if(batch.slateSignature!==lateSlateSignature())throw Error('The player pool differs from the imported entries slate. Reimport current entries before late swapping.');if(batch.runSignature!==lateSignature())throw Error('Projections, player pool or settings changed. Run Late Swap again before export.');const options=readLateOptions();
 const rows=[batch.header];for(const entry of batch.entries){refreshLateLocks(entry,now);if(entry.issues.length||!entry.result?.players)throw Error('Every imported entry must be valid before export. Correct the flagged entries and reimport.');const problem=checkLateLineup(entry,entry.result.players,options,now,false);if(problem)throw Error(problem+' Run Late Swap again using the current lock times.');const row=entry.row.slice();entry.result.players.forEach((p,j)=>{row[batch.slotCols[j]]=String(p.id)===entry.ids[j]?entry.raw[j]:p.name+' ('+p.id+')'});rows.push(row)}return rows;
}
function lateExportText(now=Date.now()){return lateExportRows(now).map(row=>row.map(x=>'"'+String(x??'').replace(/"/g,'""')+'"').join(',')).join('\r\n')}
function renderLateSwap(){
 const now=Date.now(),batch=state.lateSwap;let changed=false;$('lateClock').textContent='Lock check: '+new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'medium'}).format(new Date(now))+' Eastern time';
 $('lateImport').disabled=lateBusy;$('lateProjImport').disabled=lateBusy;$('lateRun').disabled=lateBusy||!batch||!batch.entries.some(e=>!e.issues.length);$('lateExport').disabled=true;
 if(!batch){$('lateEntries').innerHTML='<p>Upload a filled DraftKings entries CSV to review locked players and open roster slots.</p>';return}
 const map=latePlayerMap(),stale=batch.runSignature&&batch.runSignature!==lateSignature(),slateChanged=batch.slateSignature!==lateSlateSignature();
 if(slateChanged){$('lateRun').disabled=true;$('lateStatus').textContent='The player pool differs from the imported entries slate. Reimport current entries before late swapping.'}else if(stale)$('lateStatus').textContent='Projections, player pool or settings changed. Run Late Swap again.';
 let exportError=null;if(batch.runSignature&&!lateBusy)try{lateExportRows(now);$('lateExport').disabled=false}catch(e){exportError=e.message}
 if(exportError&&!stale&&!lateBusy)$('lateStatus').textContent=exportError;
 $('lateEntries').innerHTML=batch.entries.map(entry=>{changed=refreshLateLocks(entry,now)||changed;const players=entry.result?.players||entry.sourcePlayers,remaining=players.reduce((n,p,j)=>n+(!entry.locked[j]?num(map.get(String(p?.id))?.projection):0),0),salary=players.reduce((n,p)=>n+num(p?.salary),0);return '<div class="lineup"><div class="lineuphead"><b>Entry '+escapeHTML(entry.entryId)+'</b><span class="chip">'+entry.locked.filter(Boolean).length+' locked · '+entry.locked.filter(x=>!x).length+' open</span></div><p class="note">'+escapeHTML(entry.issues.join(' ')||entry.result?.error||entry.result?.status||'Ready to optimize unlocked slots.')+'</p><p class="note">Salary $'+salary.toLocaleString()+' · Remaining projection '+remaining.toFixed(1)+' · '+(lineupGames(players.filter(Boolean))||'unverified')+' games</p>'+SLOTS.map((slot,j)=>{const p=players[j];return '<div class="slot"><span>'+slot+'</span><b>'+escapeHTML(p?.name||'Empty / unknown player')+' <small>'+escapeHTML(p?teamCode(p)+' · '+startTimeLabel(p):'')+'</small></b><small class="'+(entry.locked[j]?'danger':'good')+'">'+(entry.locked[j]?'LOCKED':'OPEN')+'</small><small>$'+num(p?.salary).toLocaleString()+'</small></div>'}).join('')+'</div>'}).join('');if(changed)save();
}
$('lateImport').onclick=async()=>{const file=$('lateFile').files[0];if(!file){$('lateStatus').textContent='Choose your filled DraftKings entries CSV first.';return}try{const batch=importLateEntries(await file.text(),file.name);const invalid=batch.entries.filter(e=>e.issues.length).length;$('lateStatus').textContent='Imported '+batch.entries.length+' entries. '+(invalid?invalid+' need attention before export.':'Review locks, update projections, then run Late Swap.')}catch(e){$('lateStatus').textContent='Entries import failed: '+e.message}renderLateSwap()};
$('lateProjImport').onclick=async()=>{const f=$('lateProjFile').files[0];if(!f){$('lateStatus').textContent='Choose an updated projection CSV first.';return}try{let matched=0;const parsed=parseCSV(await f.text());validateOwnershipColumns(parsed);if(typeof requireNonExclusiveModel==='function')requireNonExclusiveModel();for(const r of parsed){const id=pick(r,'id','playerid'),name=pick(r,'name','playername').toLowerCase(),p=state.players.find(p=>id?String(p.id)===id:name&&p.name.toLowerCase()===name);if(!p)continue;let touched=false;for(const [key,aliases] of Object.entries({projection:['projection','proj','fpts','fantasypoints'],ceiling:['ceiling','upside'],ownership:['ownership','own','ownpct','projectedownership','ownershipprojection','ownershippercent','ownershippct','projown'],minutes:['minutes','mins']})){const raw=pick(r,...aliases);if(raw!==''){if(key==='ownership'){p[key]=parseOwnershipPercent(raw);p.ownershipSource='Imported: '+f.name}else p[key]=Math.max(0,num(raw));touched=true}}if(touched)matched++}save();renderAll();$('lateStatus').textContent=matched?'Updated '+matched+' matched players. Run Late Swap to use these projections.':'No matching projection fields found. Include ID or Name and Projection.'}catch(e){$('lateStatus').textContent='Projection import failed: '+e.message}renderLateSwap()};
$('lateRefresh').onclick=()=>{renderLateSwap();$('lateStatus').textContent='Lock status refreshed using current Eastern time. Run again if any replacement has locked.'};
$('lateRun').onclick=async()=>{
 const batch=state.lateSwap;if(!batch||lateBusy)return;if(batch.slateSignature!==lateSlateSignature()){$('lateStatus').textContent='The player pool differs from the imported entries slate. Reimport current entries before late swapping.';renderLateSwap();return}let options;try{options=readLateOptions()}catch(e){$('lateStatus').textContent=e.message;return}const signature=lateSignature();batch.runSignature=null;lateBusy=true;renderLateSwap();
 try{for(let i=0;i<batch.entries.length;i++){$('lateStatus').textContent='Optimizing entry '+(i+1)+' of '+batch.entries.length+'…';await new Promise(r=>setTimeout(r,0));if(state.lateSwap!==batch||lateSignature()!==signature)throw Error('Inputs changed during optimization. Run Late Swap again.');batch.entries[i].result=solveLateEntry(batch.entries[i],options,Date.now())}
  batch.runSignature=signature;batch.ranAt=Date.now();save();const blocked=batch.entries.filter(e=>e.result?.error||e.issues.length).length;$('lateStatus').textContent='Processed '+batch.entries.length+' entries. '+(blocked?blocked+' blocked; correct the flagged entries before export.':'Locked slots preserved. Review the results, then export your entries CSV.');
 }catch(e){batch.runSignature=null;$('lateStatus').textContent=e.message}finally{lateBusy=false;renderLateSwap()}
};
$('lateExport').onclick=()=>{try{const text=lateExportText(),url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='DKEntries-late-swap.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);$('lateStatus').textContent='Entries CSV exported. Entry IDs and locked roster cells are preserved.'}catch(e){$('lateStatus').textContent=e.message}renderLateSwap()};
['lateMode','lateMinSalary','lateCap','lateTrials'].forEach(id=>$(id).addEventListener('change',renderLateSwap));
$('lateClear').onclick=()=>{if(lateBusy)return;state.lateSwap=null;save();$('lateStatus').textContent='Imported late-swap entries cleared from this browser.';renderLateSwap()};
renderLateSwap();setInterval(()=>{if($('lateSwap').classList.contains('active')&&!lateBusy)renderLateSwap()},15000);

