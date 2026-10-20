#!/usr/bin/env python3
"""Trigger the workflow through its webhook and print a readable summary of the run.

  python3 tools/trigger_run.py                      # today's rotation
  python3 tools/trigger_run.py type=answer approval=true
Writes the full summary to output/runs/<execution-id>.json
"""
import json, os, sqlite3, sys, time, urllib.request, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from inspect_executions import DB, unflatten  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get('N8N_BASE', 'http://127.0.0.1:5678')
q = dict(a.split('=', 1) for a in sys.argv[1:])
con = sqlite3.connect(DB)
before = con.execute('select coalesce(max(id),0) from execution_entity').fetchone()[0]
req = urllib.request.Request(f"{BASE}/webhook/placidway-run?{urllib.parse.urlencode(q)}", method='POST', data=b'{}',
                             headers={'Content-Type': 'application/json', 'x-run-token': os.environ.get('RUN_TOKEN', '')})
urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=30).read()  # local call: bypass any HTTP proxy
eid, status = None, None
for _ in range(120):
    time.sleep(1)
    r = con.execute("select id, status from execution_entity where id>? and workflowId='PwFbDailyPost001' order by id desc limit 1", (before,)).fetchone()
    if r and r[1] in ('success', 'error', 'crashed', 'waiting', 'canceled'):
        eid, status = r
        break
row = con.execute('select data from execution_data where executionId=?', (eid,)).fetchone()
rd = unflatten(json.loads(row[0]))['resultData']['runData']


def last(node):
    runs = rd.get(node)
    if not runs:
        return None
    m = (runs[-1].get('data') or {}).get('main') or []
    for out in m:
        if out:
            return out[0]['json']
    return None


s = last('Simulate Publish') or last('Publish Result') or last('Final Post') or last('Guardrail Verdict') or {}
fail = last('Classify Failure')
summary = {
    'execution_id': eid, 'execution_status': status, 'query': q,
    'llm': {k: ((s.get('cfg') or {}).get('llm') or {}).get(k) for k in ('provider', 'model')},
    'nodes_run': [f"{n} x{len(r)}" if len(r) > 1 else n for n, r in rd.items()],
    'content_type': (s.get('item') or {}).get('contentType'), 'item_url': (s.get('item') or {}).get('url'),
    'category': (s.get('item') or {}).get('category'), 'image': (s.get('page') or {}).get('image'),
    'post': (s.get('post') or {}).get('message'), 'chars_before_link': (s.get('post') or {}).get('charsBeforeLink'),
    'guardrail_history': [{'attempt': g['attempt'], 'rules': g['rulesPass'], 'llm': g['llmPass'], 'issues': g['issues']} for g in s.get('guardrailHistory', [])],
    'result': s.get('result'), 'failure': {k: fail[k] for k in ('code', 'message', 'hint')} if fail else None,
    'approval_links': (last('Build Review Request') or {}).get('approval', {}) if 'Build Review Request' in rd else None,
}
os.makedirs(os.path.join(ROOT, 'output', 'runs'), exist_ok=True)
json.dump(summary, open(os.path.join(ROOT, 'output', 'runs', f'{eid}.json'), 'w'), indent=2, ensure_ascii=False)
print(json.dumps({k: v for k, v in summary.items() if k != 'nodes_run'}, indent=2, ensure_ascii=False)[:4000])
print('nodes:', ' > '.join(summary['nodes_run']))
