"""Daily box-score inputs. No predictions, sportsbook lines or credentials are invented."""
import concurrent.futures as cf
import datetime as dt
import json
import math
from pathlib import Path
import time
import urllib.request
from zoneinfo import ZoneInfo

ET = ZoneInfo('America/New_York')
BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/'
PUBLISHED = 'https://tigerwoodsyall.github.io/-dfs-edge-lab/model-data.json'
SHOOTING_FIELDS = ('fgm','fga','tpm','tpa','ftm','fta')
FIELDS = ('pts', 'reb', 'ast', 'stl', 'blk', 'to', 'threes')

def get_json(url):
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'DFS-Edge-Lab-Model/1.0'})
            with urllib.request.urlopen(req, timeout=25) as response:
                return json.load(response)
        except Exception:
            if attempt: raise
            time.sleep(1)

def dk_points(s):
    doubles = sum(s[k] >= 10 for k in ('pts', 'reb', 'ast', 'stl', 'blk'))
    return s['pts'] + .5*s['threes'] + 1.25*s['reb'] + 1.5*s['ast'] + 2*s['stl'] + 2*s['blk'] - .5*s['to'] + (1.5 if doubles >= 2 else 0) + (3 if doubles >= 3 else 0)

def minutes(raw):
    parts = str(raw).split(':')
    return float(parts[0]) + (float(parts[1])/60 if len(parts) == 2 else 0)

def parse_boxscore(data, event):
    header = data.get('header', {})
    if str(header.get('id')) != str(event['id']) or header.get('season', {}).get('type') != 2:
        raise ValueError('Mismatched event or non-regular-season box score')
    teams = data.get('boxscore', {}).get('players', [])
    if len(teams) != 2:
        raise ValueError('Missing team box score')
    records = []
    competitors=header.get('competitions',[{}])[0].get('competitors',[])
    scores=[float(c['score']) for c in competitors if str(c.get('score','')).replace('.','',1).isdigit()]
    margin=abs(scores[0]-scores[1]) if len(scores)==2 else None
    game_date=dt.datetime.fromisoformat(event['date'].replace('Z','+00:00')).astimezone(ET).date().isoformat()
    for team in teams:
        abbreviation = team['team']['abbreviation']
        abbreviation = {'GS': 'GSW', 'SA': 'SAS', 'NY': 'NYK', 'NO': 'NOP', 'WSH': 'WAS', 'UTAH': 'UTA'}.get(abbreviation, abbreviation)
        parsed = []
        dnps = []
        for table in team['statistics']:
            labels = table.get('names') or table.get('labels')
            if not labels or not set(['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST', 'TO', 'STL', 'BLK']).issubset(labels):
                continue
            for row in table.get('athletes', []):
                if row.get('didNotPlay'):
                    dnps.append(row['athlete'])
                    continue
                if not row.get('stats'):continue
                values = dict(zip(labels, row['stats']))
                if values.get('MIN') in (None, '', '--', '-'):
                    continue
                mins = minutes(values['MIN'])
                if mins <= 0: continue
                if mins > 70: raise ValueError('Invalid minutes')
                stats = {k: float(values[label]) for k, label in [('pts','PTS'),('reb','REB'),('ast','AST'),('stl','STL'),('blk','BLK'),('to','TO')]}
                stats['threes'] = float(values['3PT'].split('-')[0])
                fgm,fga=map(float,values['FG'].split('-'));tpm,tpa=map(float,values['3PT'].split('-'));ftm,fta=map(float,values['FT'].split('-'))
                shooting=dict(zip(SHOOTING_FIELDS,(fgm,fga,tpm,tpa,ftm,fta)))
                if any(not math.isfinite(v) or v<0 for v in shooting.values()) or fgm>fga or tpm>tpa or ftm>fta or tpm>fgm or tpa>fga: raise ValueError('Invalid shooting totals')
                if any(not math.isfinite(v) or v < 0 for v in stats.values()): raise ValueError('Invalid counting stat')
                athlete = row['athlete']
                parsed.append({'id': str(athlete['id']), 'name': athlete['displayName'], 'team': abbreviation, 'minutes': mins, 'stats': stats, 'shooting': shooting, 'starter':row.get('starter') if isinstance(row.get('starter'),bool) else None, 'fouls':float(values['PF']) if str(values.get('PF','')).isdigit() else None, 'margin':margin, 'gameDate':game_date, 'opponent':next(({'GS':'GSW','SA':'SAS','NY':'NYK','NO':'NOP','WSH':'WAS','UTAH':'UTA'}.get(t['team']['abbreviation'],t['team']['abbreviation']) for t in teams if t['team']['id']!=team['team']['id']),None), 'ejected':row.get('ejected') is True, 'earlyExit':any(word in str(row.get('reason','')).lower() for word in ('left game','did not return','ejected')), 'used': fga + .44*fta + stats['to']})
        team_minutes, team_used = sum(r['minutes'] for r in parsed), sum(r['used'] for r in parsed)
        if len(parsed) < 5 or not 230 <= team_minutes <= 360 or team_used <= 0:
            raise ValueError('Incomplete team box score')
        for row in parsed:
            row['regulationMinutes'] = row['minutes']*240/team_minutes
            row['usage'] = 100*row['used']*(team_minutes/5)/(row['minutes']*team_used)
            row['dk'] = dk_points(row['stats'])
            records.append(row)
        for athlete in dnps:
            records.append({'id':str(athlete['id']),'name':athlete['displayName'],'team':abbreviation,'minutes':0,'regulationMinutes':0,'usage':0,'dk':0,'stats':dict.fromkeys(FIELDS,0),'shooting':dict.fromkeys(SHOOTING_FIELDS,0),'starter':False,'fouls':0,'margin':margin,'gameDate':game_date,'opponent':next(({'GS':'GSW','SA':'SAS','NY':'NYK','NO':'NOP','WSH':'WAS','UTAH':'UTA'}.get(t['team']['abbreviation'],t['team']['abbreviation']) for t in teams if t['team']['id']!=team['team']['id']),None),'ejected':False,'earlyExit':False,'didNotPlay':True})
    return records

def new_period():
    return {'games': 0, 'minutes': 0, 'regulationMinuteSum': 0, 'usageMinuteSum': 0, 'dkSum': 0, 'dkSqSum': 0, 'stats': dict.fromkeys(FIELDS, 0), 'shooting': dict.fromkeys(SHOOTING_FIELDS,0), 'recent': []}

def add_game(period, row, event):
    if row['minutes']<=0:
        period['recent'].append({'id':event['id'],'date':event['date'],'minutes':0,'regulationMinutes':0,**{k:row.get(k) for k in ('starter','fouls','margin','gameDate','team','opponent','ejected','earlyExit','didNotPlay')}})
        period['recent']=sorted(period['recent'],key=lambda r:r['date'],reverse=True)[:20]
        return
    period['games'] += 1
    period['minutes'] += row['minutes']
    period['regulationMinuteSum'] = period.get('regulationMinuteSum',0) + row['regulationMinutes']
    period['usageMinuteSum'] += row['usage']*row['minutes']
    period['dkSum'] += row['dk']
    period['dkSqSum'] += row['dk']**2
    for k in FIELDS: period['stats'][k] += row['stats'][k]
    for k in SHOOTING_FIELDS: period['shooting'][k] += row['shooting'][k]
    period['recent'].append({'id': event['id'], 'date': event['date'], 'minutes': row['minutes'], 'regulationMinutes': row['regulationMinutes'], **{k:row.get(k) for k in ('starter','fouls','margin','gameDate','team','opponent','ejected','earlyExit')}})
    period['recent'] = sorted(period['recent'], key=lambda r: r['date'], reverse=True)[:20]

def date_range(start, end):
    while start <= end:
        yield start
        start += dt.timedelta(days=1)

def refresh():
    # Refresh after 6 a.m. ET so late West Coast games finish before a day is closed.
    today = (dt.datetime.now(ET) - dt.timedelta(hours=6)).date()
    start_year = today.year if today.month >= 8 else today.year - 1
    season = start_year + 1
    target = Path('model-data.json')
    cache = None
    try:
        downloaded = get_json(PUBLISHED + '?day=' + today.isoformat())
        if downloaded.get('version') == 1 and downloaded.get('roleVersion',0) >= 1 and downloaded.get('season') == season and isinstance(downloaded.get('players'), list):
            cache = downloaded
            target.write_text(json.dumps(cache, separators=(',', ':')) + '\n')
    except Exception:
        if target.exists():
            try:
                old = json.loads(target.read_text())
                if old.get('season') == season and old.get('roleVersion',0)>=1: cache = old
            except Exception: pass
    if cache is None and target.exists():
        old=json.loads(target.read_text())
        if old.get('season') == season and old.get('roleVersion',0) >= 1: cache=old
    if cache and cache.get('asOfDate') == today.isoformat() and not cache.get('failedGames'):
        print('Daily model inputs already current:', today, flush=True)
        return
    dates = []
    if not cache:
        dates += [('historical', d) for d in date_range(dt.date(start_year-1, 10, 1), dt.date(start_year, 4, 14))]
    current_start = dt.date.fromisoformat(cache['asOfDate']) - dt.timedelta(days=1) if cache else dt.date(start_year, 10, 1)
    dates += [('current', d) for d in date_range(current_start, today - dt.timedelta(days=1))]
    events = {e['id']:e for e in cache.get('failedGames', [])} if cache else {}
    processed = set(cache.get('processedGames', [])) if cache else set()
    with cf.ThreadPoolExecutor(max_workers=5) as pool:
        future_dates = {pool.submit(get_json, BASE + 'scoreboard?dates=' + d.strftime('%Y%m%d')): (period, d) for period, d in dates}
        for future in cf.as_completed(future_dates):
            period, day = future_dates[future]
            scoreboard = future.result()
            if 'events' not in scoreboard: raise ValueError('Scoreboard missing events')
            for event in scoreboard['events']:
                if event.get('season', {}).get('type') != 2 or event.get('season', {}).get('year') != (season if period == 'current' else season - 1) or not event.get('status', {}).get('type', {}).get('completed'):
                    continue
                if event['id'] not in processed:
                    events[event['id']] = {**event, 'period': period}
    print('Fetching', len(events), 'new regular-season box scores', flush=True)
    players = {p['id']: p for p in cache['players']} if cache else {}
    def read_game(event):
        folder = Path('.model-cache')
        folder.mkdir(exist_ok=True)
        file = folder / (str(event['id']) + '.json')
        if file.exists():
            cached_rows=json.loads(file.read_text())
            if all('regulationMinutes' in r and 'shooting' in r and 'starter' in r for r in cached_rows): return cached_rows
        records = parse_boxscore(get_json(BASE + 'summary?event=' + str(event['id'])), event)
        file.write_text(json.dumps(records))
        return records
    failed = []
    with cf.ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(read_game, event): event for event in events.values()}
        for count, future in enumerate(cf.as_completed(futures), 1):
            event = futures[future]
            try:
                records = future.result()
            except Exception as error:
                print('Skipped unavailable box score', event['id'], str(error)[:120], flush=True)
                failed.append({k:event[k] for k in ['id','date','period']})
                continue
            for r in records:
                player = players.setdefault(r['id'], {'id': r['id'], 'name': r['name'], 'historical': new_period(), 'current': new_period()})
                player['name'] = r['name']
                add_game(player[event['period']], r, event)
            processed.add(event['id'])
            if count % 25 == 0: print('Parsed', count, '/', len(events), 'box scores', flush=True)
    if not players: raise ValueError('No valid model input players')
    if len(failed) > max(2, (len(processed)+len(failed))*.05): raise ValueError('Over 5% of requested box scores unavailable; previous inputs retained')
    data = {'version': 1, 'minuteVersion': 2, 'shootingVersion': 1, 'roleVersion': 1, 'failedGames': failed, 'season': season, 'asOfDate': today.isoformat(), 'updatedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'historicalWindow': f'{start_year-1}-10-01 through {start_year}-04-14 (regular season only)', 'currentWindow': f'{start_year}-10-01 through {today - dt.timedelta(days=1)} (regular season only)', 'source': 'ESPN completed NBA regular-season box scores', 'sourceUrl': 'https://www.espn.com/nba/scoreboard', 'processedGames': sorted(processed), 'players': sorted(players.values(), key=lambda p: p['name'])}
    temporary = target.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, separators=(',', ':')) + '\n')
    temporary.replace(target)
    print('Model input feed:', len(players), 'players,', len(processed), 'games', flush=True)

if __name__ == '__main__':
    refresh()
