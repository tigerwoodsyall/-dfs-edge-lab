/* Excel conversion runs locally; CSV import parsers still validate slate IDs and rosters. */
let spreadsheetParserPromise=null;
function loadSpreadsheetParser(){
 if(typeof XLSX!=='undefined')return Promise.resolve(XLSX);
 if(!spreadsheetParserPromise)spreadsheetParserPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='./spreadsheet-parser.js?v=0.20.3';script.onload=()=>typeof XLSX!=='undefined'?resolve(XLSX):reject(Error('Excel parser did not load.'));script.onerror=()=>{spreadsheetParserPromise=null;reject(Error('Excel reader could not load. Refresh and try again.'))};document.head.appendChild(script)});return spreadsheetParserPromise;
}
function workbookImportCSV(book,kind,engine){
 const normalized=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]/g,''),slots=['pg','sg','sf','pf','c','g','f','util'];let best=null;
 for(let index=0;index<book.SheetNames.length;index++){if(book.Workbook?.Sheets?.[index]?.Hidden)continue;const name=book.SheetNames[index],sheet=book.Sheets[name];if(!sheet?.['!ref'])continue;const range=engine.utils.decode_range(sheet['!ref']);if(range.e.r>100000||range.e.c>250)throw Error('Worksheet is too large. Keep the lineup/projection table in a separate workbook.');
 const sample=engine.utils.sheet_to_json(sheet,{header:1,raw:false,defval:'',range:{s:range.s,e:{r:Math.min(range.e.r,range.s.r+99),c:range.e.c}}});
 for(const row of sample){const h=row.map(normalized),hasSlots=slots.every(s=>h.includes(s));let score=0;if(kind==='entries')score=hasSlots&&h.includes('entryid')?100:0;else if(kind==='rankings')score=hasSlots&&h.includes('rank')?100:0;else if(kind==='payouts')score=h.some(s=>['rank','start','rankstart','startrank'].includes(s))&&h.some(s=>['payout','prize','amount','winnings'].includes(s))?100:0;else if(kind==='salary')score=h.includes('id')&&h.includes('salary')&&h.some(s=>['name','player','playername'].includes(s))?100:0;else score=h.some(s=>['name','player','playername','id','dkid','draftkingsid'].includes(s))&&h.some(s=>['dk','projection','proj','fpts','fantasypoints','dkprojection','dkproj','projectedfpts','dkpoints'].includes(s))?100:0;
 if(score&&(!best||score>best.score))best={sheet,name,score};}
 }
 if(!best)throw Error('No matching '+kind+' worksheet found. Check the column headers and use a visible worksheet.');
 // Preserve numeric IDs as exact integer strings rather than display formats/scientific notation.
 const sheet={...best.sheet},range=engine.utils.decode_range(sheet['!ref']);for(let r=range.s.r;r<=Math.min(range.e.r,range.s.r+99);r++){const idCols=[];for(let c=range.s.c;c<=range.e.c;c++){const cell=sheet[engine.utils.encode_cell({r,c})];if(/^(?:entryid|contestid|id|dkid|draftkingsid|playerid|pg|sg|sf|pf|c|g|f|util)$/.test(normalized(cell?.v)))idCols.push(c)}if(idCols.length)for(const c of idCols)for(let rr=r+1;rr<=range.e.r;rr++){const key=engine.utils.encode_cell({r:rr,c}),cell=sheet[key];if(cell?.t==='n'&&Number.isSafeInteger(cell.v))sheet[key]={...cell,t:'s',v:String(cell.v),w:String(cell.v)}}}
 return {text:engine.utils.sheet_to_csv(sheet,{FS:',',RS:'\r\n',blankrows:true}),sheetName:best.name};
}
async function readImportText(file,kind='projections'){
 if(!/\.xlsx$/i.test(file.name))return file.text();
 if(file.size>20*1024*1024)throw Error('Excel file exceeds 20 MB. Keep only the needed worksheet.');const engine=await loadSpreadsheetParser();let book;try{book=engine.read(await file.arrayBuffer(),{type:'array',cellDates:false,cellFormula:false,cellHTML:false})}catch(e){throw Error('Cannot read this Excel workbook. Save it as an unencrypted .xlsx file and retry.')}
 return workbookImportCSV(book,kind,engine).text;
}
