"""Publish only provider-reported starting fives, never predicted lineups."""
import concurrent.futures as cf
import datetime as dt
import json
from pathlib import Path
from zoneinfo import ZoneInfo
import urllib.request
ET=ZoneInfo('America/New_York')
def get(url):
    req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 DFS-Slate-Foundry/1.0','Accept':'application/json'})
    with urllib.request.urlopen(req,timeout=20) as r:return json.load(r)
def code(s):return {'GS':'GSW','SA':'SAS','NY':'NYK','NO':'NOP','WSH':'WAS','UTAH':'UTA'}.get(s,s)
def extract_nba(data,now):
    g=data.get('game',{});date=dt.datetime.fromisoformat(g['gameTimeUTC'].replace('Z','+00:00')).astimezone(ET).date().isoformat();home=g['homeTeam'];away=g['awayTeam'];matchup=code(away['teamTricode'])+'@'+code(home['teamTricode']);result=[]
    for team in [away,home]:
        players=[p for p in team.get('players',[]) if str(p.get('starter',''))=='1'];names=[p.get('name') or (' '.join([p.get('firstName',''),p.get('familyName','')])).strip() for p in players]
        if len(names)==5 and len(set(names))==5 and all(names):result.append(dict(date=date,matchup=matchup,team=code(team['teamTricode']),starters=names,source='NBA reported starting five',reportedAt=now,status='reported',gameStatus=g.get('gameStatus')))
    return result

def extract_espn(data,event,now):
    if str(data.get('header',{}).get('id'))!=str(event['id']):raise ValueError('Wrong game')
    date=dt.datetime.fromisoformat(event['date'].replace('Z','+00:00')).astimezone(ET).date().isoformat();teams=event['competitions'][0]['competitors'];home=next(t for t in teams if t['homeAway']=='home');away=next(t for t in teams if t['homeAway']=='away');matchup=code(away['team']['abbreviation'])+'@'+code(home['team']['abbreviation']);result=[]
    for team in data.get('boxscore',{}).get('players',[]):
        rows=[r for table in team.get('statistics',[]) for r in table.get('athletes',[]) if r.get('starter') is True];names=[r['athlete']['displayName'] for r in rows]
        if len(names)==5 and len(set(names))==5:result.append(dict(date=date,matchup=matchup,team=code(team['team']['abbreviation']),starters=names,source='ESPN reported starting five',reportedAt=now,status='reported',gameStatus=event.get('status',{}).get('type',{}).get('state')))
    return result

def refresh():
    now=dt.datetime.now(dt.timezone.utc).isoformat();today=dt.datetime.now(ET).date().isoformat();records={};errors=[];pending=[]
    try:
        board=get('https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json')
        def nba_game(g):return extract_nba(get('https://cdn.nba.com/static/json/liveData/boxscore/boxscore_'+g['gameId']+'.json'),now)
        with cf.ThreadPoolExecutor(max_workers=5) as pool:
            for f in [pool.submit(nba_game,g) for g in board.get('scoreboard',{}).get('games',[])]:
                try:
                    for r in f.result():
                        if r['date']==today:records[(r['date'],r['matchup'],r['team'])]=r
                except Exception as e:errors.append('NBA game: '+str(e)[:100])
    except Exception as e:errors.append('NBA lineup source: '+str(e)[:100])
    try:
        root='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/'
        board=get(root+'scoreboard?dates='+today.replace('-',''))
        events=board.get('events',[])
        def espn_game(e):return extract_espn(get(root+'summary?event='+e['id']),e,now)
        with cf.ThreadPoolExecutor(max_workers=5) as pool:
            for e,f in [(e,pool.submit(espn_game,e)) for e in events]:
                try:
                    found=f.result()
                    for r in found:records.setdefault((r['date'],r['matchup'],r['team']),r)
                    if not found:pending.append(e.get('shortName',e['id']))
                except Exception as err:errors.append('ESPN game '+e['id']+': '+str(err)[:100])
    except Exception as e:errors.append('ESPN lineup source: '+str(e)[:100])
    # Preserve recently reported fives on transient failures, retaining their original timestamp.
    try:
        old=get('https://tigerwoodsyall.github.io/-dfs-edge-lab/starting-lineups.json')
        for r in old.get('teams',[]):
            age=dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(r['reportedAt'].replace('Z','+00:00'))
            if r['date']==today and age.total_seconds()<1200:records.setdefault((r['date'],r['matchup'],r['team']),r)
    except Exception:pass
    output=dict(version=1,checkedAt=now,asOfDate=today,teams=list(records.values()),pending=pending,errors=errors)
    Path('starting-lineups.json').write_text(json.dumps(output,separators=(',',':'))+'\n')
    print('Starting lineups:',len(records),'reported team fives;',len(pending),'games pending;',len(errors),'source errors')
if __name__=='__main__':refresh()
