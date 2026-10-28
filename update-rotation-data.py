"""Refresh all 30 NBA rosters daily; statuses continue to come from the official NBA report."""
import concurrent.futures as cf
import datetime as dt
import json
from pathlib import Path
import time
import urllib.request
from zoneinfo import ZoneInfo

API='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/'
PUBLISHED='https://tigerwoodsyall.github.io/-dfs-edge-lab/rotation-data.json'
def get(url):
    for attempt in range(2):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'DFS-Slate-Foundry-Rotations/1.0'}),timeout=25) as response:
                return json.load(response)
        except Exception:
            if attempt: raise
            time.sleep(1)
def refresh():
    today=dt.datetime.now(ZoneInfo('America/New_York')).date().isoformat()
    target=Path('rotation-data.json')
    cached=None
    try:
        d=get(PUBLISHED+'?day='+today)
        if d.get('version')==1 and d.get('teamCount')==30 and isinstance(d.get('players'),list):
            cached=d
            target.write_text(json.dumps(d,separators=(',',':'))+'\n')
    except Exception:
        if target.exists():
            cached=json.loads(target.read_text())
    if cached and cached.get('asOfDate')==today:
        print('Daily all-team roster inputs already current:',today)
        return
    listing=get(API+'teams?limit=40')
    teams=[r['team'] for sport in listing['sports'] for league in sport['leagues'] for r in league['teams']]
    if len(teams)!=30: raise ValueError('Expected all 30 NBA teams')
    players=[]
    def roster(team):
        data=get(API+'teams/'+str(team['id'])+'/roster')
        athletes=data.get('athletes',[])
        if len(athletes)<8: raise ValueError('Incomplete roster: '+team['abbreviation'])
        code={'GS':'GSW','SA':'SAS','NY':'NYK','NO':'NOP','WSH':'WAS','UTAH':'UTA'}.get(team['abbreviation'],team['abbreviation'])
        return [{'id':str(a['id']),'name':a.get('fullName') or a['displayName'],'team':code,'position':a.get('position',{}).get('abbreviation',''),'positionName':a.get('position',{}).get('displayName','')} for a in athletes]
    with cf.ThreadPoolExecutor(max_workers=5) as pool:
        for rows in pool.map(roster,teams): players.extend(rows)
    data={'version':1,'asOfDate':today,'updatedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'teamCount':30,'source':'ESPN current NBA roster positions; depth is inferred from observed minutes, not confirmed coaching depth charts','players':players}
    temporary=target.with_suffix('.tmp')
    temporary.write_text(json.dumps(data,separators=(',',':'))+'\n')
    temporary.replace(target)
    print('Daily roster feed:',len(players),'players across all 30 NBA teams')
if __name__=='__main__': refresh()
