#!/usr/bin/env python3
"""Inspect n8n executions straight from the local SQLite DB (handy for headless runs).

  python3 tools/inspect_executions.py            -> list last 10 executions
  python3 tools/inspect_executions.py <id> [--json out.json]  -> node-by-node summary of one execution
"""
import json, os, sqlite3, sys

DB = os.path.join(os.environ.get('N8N_USER_FOLDER', os.path.expanduser('~/.n8n-placidway')), '.n8n', 'database.sqlite')


def unflatten(arr):
    """n8n stores execution data in 'flatted' format: every object/str is an index into the array."""
    seen = {}

    def rev(v):
        if isinstance(v, str) and v.isdigit() and int(v) < len(arr):
            return build(int(v))
        return v

    def build(i):
        if i in seen:
            return seen[i]
        v = arr[i]
        if isinstance(v, dict):
            out = {}
            seen[i] = out
            for k, x in v.items():
                out[k] = rev(x)
            return out
        if isinstance(v, list):
            out = []
            seen[i] = out
            out.extend(rev(x) for x in v)
            return out
        return v
    return build(0)


def main():
    con = sqlite3.connect(DB)
    if len(sys.argv) == 1:
        for r in con.execute('select e.id, w.name, e.status, e.mode, e.startedAt, e.stoppedAt from execution_entity e left join workflow_entity w on w.id=e.workflowId order by e.id desc limit 10'):
            print(r)
        return
    eid = sys.argv[1]
    row = con.execute('select data from execution_data where executionId=?', (eid,)).fetchone()
    data = unflatten(json.loads(row[0]))
    rd = data['resultData']
    print('status error:', (rd.get('error') or {}).get('message'))
    print('last node:', rd.get('lastNodeExecuted'))
    for node, runs in rd['runData'].items():
        for i, run in enumerate(runs):
            outs = (run.get('data') or {}).get('main') or []
            counts = [len(o or []) for o in outs]
            err = (run.get('error') or {}).get('message')
            print(f'  {node:32s} run{i} items/out={counts} {"ERROR: " + err if err else ""}')
    if '--json' in sys.argv:
        json.dump(rd['runData'], open(sys.argv[sys.argv.index('--json') + 1], 'w'), indent=1, default=str)


if __name__ == '__main__':
    main()
