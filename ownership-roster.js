/* Entropy-regularized marginal roster model. No realized fantasy points are inputs. */
const OWNERSHIP_MODEL_VERSION='salary-roster-v2';
const ownershipRosterCache=new Map();
function rosterOwnershipEstimate(free,held,concentration){
 const fixed=new Map(held.map(r=>[String(r.player.id),num(r.player.ownership)/100])),rows=[...free,...held.filter(r=>num(r.player.ownership)>0)],key=JSON.stringify([concentration,rows.map(r=>[r.player.id,r.player.salary,r.player.position,r.projection,r.ceiling,r.minutes,fixed.has(String(r.player.id))?fixed.get(String(r.player.id)):null])]);
 if(ownershipRosterCache.has(key))return ownershipRosterCache.get(key);
 const n=rows.length,slots=SLOTS.length,temp=7/concentration,salaries=rows.map(r=>num(r.player.salary)/1000),targets=rows.map(r=>fixed.has(String(r.player.id))?fixed.get(String(r.player.id)):-1),valueSignals=ownershipZ(rows.map(r=>r.projection/(r.player.salary/1000))),masks=rows.map(r=>SLOTS.map(s=>eligible(r.player,s))),utility=rows.map((r,i)=>r.projection+3*valueSignals[i]+.08*Math.max(0,r.ceiling-r.projection)-(r.minutes===null?0:.25*Math.max(0,24-r.minutes)));
 for(let j=0;j<slots;j++)if(!masks.some((row,i)=>row[j]&&targets[i]!==0))throw Error('Ownership model needs an available '+SLOTS[j]+' player. Review the player pool and imported zeros.');
 let warm=Array(slots).fill(1);
 function solve(price){
  const raw=utility.map((v,i)=>(v-price*salaries[i])/temp),top=Math.max(...raw),kernel=raw.map((v,i)=>Math.exp(Math.max(-65,v-top))/masks[i].filter(Boolean).length),u=new Float64Array(n),v=Float64Array.from(warm);let error=Infinity,iterations=0;
  for(;iterations<1400;iterations++){
   for(let i=0;i<n;i++){let sum=0;for(let j=0;j<slots;j++)if(masks[i][j])sum+=kernel[i]*v[j];u[i]=targets[i]>=0?targets[i]/Math.max(1e-100,sum):Math.min(1,1/Math.max(1e-100,sum))}
   for(let j=0;j<slots;j++){let sum=0;for(let i=0;i<n;i++)if(masks[i][j])sum+=kernel[i]*u[i];v[j]=1/Math.max(1e-100,sum)}
   if(iterations%8===0){error=0;for(let i=0;i<n;i++){let sum=0;for(let j=0;j<slots;j++)if(masks[i][j])sum+=kernel[i]*u[i]*v[j];error=Math.max(error,targets[i]>=0?Math.abs(sum-targets[i]):Math.max(0,sum-1))}if(error<1e-8)break}
  }
  if(error>2e-5||!Array.from(v).every(Number.isFinite))throw Error('Imported ownership and roster eligibility cannot be reconciled. Review the supplied values and player pool.');
  const values=new Map(),slotTotals=Array(slots).fill(0);let salary=0;
  for(let i=0;i<n;i++){let sum=0;for(let j=0;j<slots;j++)if(masks[i][j]){const x=kernel[i]*u[i]*v[j];sum+=x;slotTotals[j]+=x}values.set(String(rows[i].player.id),sum*100);salary+=sum*salaries[i]*1000}
  warm=Array.from(v);return {values,salary,slotTotals,iterations};
 }
 let result=solve(0),price=0;
 if(result.salary>50000+.05){let lo=0,hi=1,high;for(let tries=0;tries<12;tries++){high=solve(hi);if(high.salary<=50000)break;lo=hi;hi*=2}if(high.salary>50000+.05)throw Error('Ownership inputs cannot fit the $50,000 salary cap. Review imported values or add eligible players.');result=high;for(let k=0;k<19;k++){const mid=(lo+hi)/2,next=solve(mid);if(next.salary>50000)lo=mid;else{hi=mid;result=next}}price=hi}
 const output={weights:free.map(r=>result.values.get(String(r.player.id))||0),expectedSalary:result.salary,slotTotals:result.slotTotals,price,temperature:temp};ownershipRosterCache.set(key,output);if(ownershipRosterCache.size>8)ownershipRosterCache.delete(ownershipRosterCache.keys().next().value);return output;
}

function roundRosterOwnership(allocations,free,held){const fixedCost=held.reduce((sum,r)=>sum+num(r.player.ownership)*r.player.salary/100,0),cost=()=>fixedCost+free.reduce((sum,r,i)=>sum+allocations[i]*r.player.salary/100,0);let salary=cost(),steps=0;while(salary>50000+.00001&&steps++<2000){let from=-1,to=-1;for(let i=0;i<free.length;i++){if(allocations[i]>=.01&&(from<0||free[i].player.salary>free[from].player.salary))from=i;if(allocations[i]<99.995&&(to<0||free[i].player.salary<free[to].player.salary))to=i}if(from<0||to<0||free[from].player.salary<=free[to].player.salary)throw Error('Rounded ownership cannot fit the salary budget.');allocations[from]=+(allocations[from]-.01).toFixed(2);allocations[to]=+(allocations[to]+.01).toFixed(2);salary=cost()}if(salary>50000+.00001)throw Error('Ownership budget could not be reconciled.');return salary}
