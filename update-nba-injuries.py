"""Fetch only official NBA injury reports; fail without replacing the last good feed."""
import datetime as dt
import html
import io
import json
import os
from pathlib import Path
import re
import urllib.request
from zoneinfo import ZoneInfo
import pdfplumber

ET = ZoneInfo('America/New_York')
UTC = dt.timezone.utc
TEAM_NAMES = '''Atlanta Hawks|ATL;Boston Celtics|BOS;Brooklyn Nets|BKN;Charlotte Hornets|CHA;Chicago Bulls|CHI;Cleveland Cavaliers|CLE;Dallas Mavericks|DAL;Denver Nuggets|DEN;Detroit Pistons|DET;Golden State Warriors|GSW;Houston Rockets|HOU;Indiana Pacers|IND;LA Clippers|LAC;Los Angeles Clippers|LAC;Los Angeles Lakers|LAL;Memphis Grizzlies|MEM;Miami Heat|MIA;Milwaukee Bucks|MIL;Minnesota Timberwolves|MIN;New Orleans Pelicans|NOP;New York Knicks|NYK;Oklahoma City Thunder|OKC;Orlando Magic|ORL;Philadelphia 76ers|PHI;Phoenix Suns|PHX;Portland Trail Blazers|POR;Sacramento Kings|SAC;San Antonio Spurs|SAS;Toronto Raptors|TOR;Utah Jazz|UTA;Washington Wizards|WAS'''
compact = lambda s: re.sub('[^a-z0-9]', '', s.lower())
TEAMS = {compact(name): code for name, code in (item.split('|') for item in TEAM_NAMES.split(';'))}
STATUSES = {'Out', 'Doubtful', 'Questionable', 'Probable', 'Available'}
PDF_PATTERN = re.compile(r'https://ak-static\.cms\.nba\.com/referee/injury/Injury-Report_(\d{4}-\d{2}-\d{2})_(\d{1,2})_(\d{2})(AM|PM)\.pdf')

def stamp(match):
    return dt.datetime.strptime(' '.join(match.groups()), '%Y-%m-%d %I %M %p').replace(tzinfo=ET)

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'DFS-Edge-Lab-Injury-Feed/1.0', 'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(req, timeout=45) as response:
        if response.geturl().split('/')[2] not in {'official.nba.com', 'ak-static.cms.nba.com'}:
            raise ValueError('Unexpected report redirect')
        content = response.read(12_000_001)
        if len(content) > 12_000_000:
            raise ValueError('Report exceeds size limit')
        return content

def parse_report(content):
    records, pending, seen = [], [], set()
    game_date = matchup = team = None
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        words = pdf.pages[0].extract_words()
        def col(label):
            return next(w['x0'] for w in words if compact(w['text']) == label)
        date_x, match_x, team_x, name_x, status_x, reason_x = [col(k) for k in ['gamedate', 'matchup', 'team', 'playername', 'currentstatus', 'reason']]
        for page in pdf.pages:
            bands = []
            for word in sorted(page.extract_words(), key=lambda w: (w['top'], w['x0'])):
                if word['top'] < 70 or word['top'] > page.height - 45:
                    continue
                if not bands or abs(bands[-1][0] - word['top']) > 2.5:
                    bands.append((word['top'], []))
                bands[-1][1].append(word)
            for _, band in bands:
                if re.fullmatch(r'Page\d+of\d+', ''.join(w['text'] for w in band)):
                    continue
                def cell(left, right):
                    return ' '.join(w['text'] for w in sorted(band, key=lambda w: w['x0']) if left - 2 <= w['x0'] < right - 2).strip()
                date = cell(date_x, match_x)
                date_match = re.search(r'\b\d{2}/\d{2}/\d{4}\b', date)
                if date_match:
                    game_date = dt.datetime.strptime(date_match[0], '%m/%d/%Y').date().isoformat()
                match = cell(match_x, team_x)
                if re.fullmatch(r'[A-Z]{2,3}@[A-Z]{2,3}', match):
                    matchup = match
                label = cell(team_x, name_x)
                if label and compact(label) != 'team':
                    team = TEAMS.get(compact(label))
                    if not team:
                        raise ValueError('Unrecognized team: ' + label)
                name, status, reason = cell(name_x, status_x), cell(status_x, reason_x), cell(reason_x, page.width + 5)
                if 'NOTYETSUBMITTED' in re.sub(r'\s', '', reason):
                    if game_date and matchup and team:
                        pending.append({'gameDate': game_date, 'matchup': matchup, 'team': team})
                if not status or compact(status) == 'currentstatus':
                    continue
                if status not in STATUSES or not name or ',' not in name or not game_date or not matchup or not team or team not in matchup.split('@'):
                    raise ValueError('Unrecognized injury row: ' + repr((game_date, matchup, team, name, status)))
                parts = [p.strip() for p in name.split(',')]
                player = parts[-1] + ' ' + parts[0] + (' ' + ' '.join(parts[1:-1]) if len(parts) > 2 else '')
                key = (game_date, matchup, team, compact(player))
                if key in seen:
                    raise ValueError('Duplicate injury row: ' + player)
                seen.add(key)
                records.append({'name': player, 'team': team, 'gameDate': game_date, 'matchup': matchup, 'status': status})
    if not records and not pending:
        raise ValueError('No recognizable injury rows or pending team reports')
    return records, pending

def refresh(output='nba-injuries.json', now=None):
    now = now or dt.datetime.now(UTC)
    local = now.astimezone(ET)
    year = local.year if local.month >= 7 else local.year - 1
    page_url = f'https://official.nba.com/nba-injury-report-{year}-{str(year + 1)[2:]}-season/'
    page = html.unescape(get(page_url).decode('utf-8'))
    reports = [m for m in PDF_PATTERN.finditer(page) if stamp(m) <= now + dt.timedelta(minutes=10)]
    if not reports:
        raise ValueError('No published official injury report links found')
    report = max(reports, key=stamp)
    report_time = stamp(report)
    if now - report_time > dt.timedelta(hours=36):
        raise ValueError('Latest official report is over 36 hours old')
    records, pending = parse_report(get(report[0]))
    data = {'version': 1, 'schedulerEnabled': os.environ.get('GITHUB_ACTIONS') == 'true', 'checkedAt': now.isoformat(), 'reportAt': report_time.isoformat(), 'sourceUrl': report[0], 'indexUrl': page_url, 'players': records, 'notSubmitted': pending}
    target = Path(output)
    temporary = target.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(target)
    print(f'Official NBA report {report_time.isoformat()}: {len(records)} statuses, {sum(p["status"] == "Out" for p in records)} Out, {len(pending)} pending teams')
    return data

if __name__ == '__main__':
    refresh()
