#!/usr/bin/env python3
"""Local test doubles for running the workflow end to end without touching anything public.

  :8787  REPLAY MIRROR  - serves fixtures/replay/ (real PlacidWay robots.txt, sitemap entries and page text)
                          GET /__mode?set=ok|down|cf  switches failure simulation (503 / Cloudflare 403)
  :8788  MOCK LLM       - OpenAI-compatible POST /v1/chat/completions and Anthropic POST /v1/messages.
                          Deterministic, extractive: builds a post only from source sentences. For PIPELINE
                          TESTS ONLY - never used for the sample posts. GET /__inject?on=1 makes the next
                          WRITER call add a forbidden claim + invented price (guardrail demo);
                          /__inject?on=1&sticky=1 keeps injecting into the rewrite too (guardrail block demo).
  :8789  WEBHOOK SINK   - records every POST (reviewer notifications, alerts) to output/outbox.jsonl
  :8790  MOCK GRAPH API - POST /vXX.X/{page-id}/photos|feed. access_token "EXPIRED" (or GET /__token?expired=1) returns OAuth error 190.
                          Records requests (token redacted) to output/graph_requests.jsonl

Usage: python3 tools/sandbox_services.py   (Ctrl+C to stop)
"""
import json, os, re, threading, time, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPLAY = os.path.join(ROOT, 'fixtures', 'replay')
OUT = os.path.join(ROOT, 'output'); os.makedirs(OUT, exist_ok=True)
STATE = {'mode': 'ok', 'inject': False, 'hits': [], 'token_expired': False}


def log_jsonl(name, obj):
    with open(os.path.join(OUT, name), 'a', encoding='utf-8') as f:
        f.write(json.dumps(obj, ensure_ascii=False) + '\n')


class Base(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype='application/json', headers=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body)
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return self.rfile.read(n).decode('utf-8') if n else ''


# ---------------------------------------------------------------- replay mirror
class Replay(Base):
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == '/__mode':
            STATE['mode'] = urllib.parse.parse_qs(u.query).get('set', ['ok'])[0]
            return self.send(200, {'mode': STATE['mode']})
        STATE['hits'].append((time.time(), u.path))
        log_jsonl('replay_hits.jsonl', {'t': round(time.time(), 3), 'path': u.path, 'ua': self.headers.get('User-Agent')})
        if STATE['mode'] == 'down':
            return self.send(503, '<h1>503 Service Unavailable</h1>', 'text/html')
        if STATE['mode'] == 'cf' and u.path != '/robots.txt':
            return self.send(403, '<html><head><title>Just a moment...</title></head><body>challenge-platform</body></html>',
                             'text/html', {'cf-mitigated': 'challenge', 'server': 'cloudflare'})
        f = os.path.normpath(os.path.join(REPLAY, urllib.parse.unquote(u.path).lstrip('/')))
        if not f.startswith(REPLAY) or not os.path.isfile(f):
            return self.send(404, '<h1>404 Not Found</h1>', 'text/html')
        ctype = 'application/xml' if f.endswith('.xml') else 'text/plain' if f.endswith('.txt') else 'text/html; charset=UTF-8'
        return self.send(200, open(f, 'rb').read(), ctype)


# ---------------------------------------------------------------- mock LLM
BANNED = re.compile(r'cure|heal|guarant|revers|eliminat|proven|best|safest|miracle|100%|\$|\d', re.I)


def mock_writer(prompt):
    src = prompt.split('<<<SOURCE', 1)[-1]
    title = (re.search(r'^TITLE: (.*)$', src, re.M) or [None, 'this guide'])[1].strip()
    ctype = (re.search(r'^CONTENT TYPE: (.*)$', src, re.M) or [None, 'article'])[1].strip()
    body = src.split('BODY:', 1)[-1]
    sents = re.split(r'(?<=[.?!])\s+', re.sub(r'\s+', ' ', body))
    picks = []
    for s in sents:
        s = s.strip()
        if 45 <= len(s) <= 115 and not BANNED.search(s) and s.endswith('.') and s not in picks:
            picks.append(s)
        if len(picks) == 3:
            break
    lines = [p for p in picks]
    hook = f"Planning care abroad? {title.split('|')[0].strip()}"[:110]
    tags = {'package': ['#MedicalTourism', '#TreatmentAbroad', '#HealthcareTravel'],
            'answer': ['#MedicalTourism', '#PatientQuestions', '#HealthcareTravel'],
            'article': ['#MedicalTourism', '#HealthcareTravel', '#PatientGuide']}.get(ctype, ['#MedicalTourism', '#HealthcareTravel', '#PatientGuide'])
    out = {'hook': hook, 'lines': lines, 'cta': 'Read the full details on PlacidWay:', 'hashtags': tags,
           'evidence': [{'line': i, 'quote': q} for i, q in enumerate(picks)]}
    if STATE['inject'] and (STATE.get('sticky') or 'PREVIOUS ATTEMPT FAILED' not in prompt):
        if not STATE.get('sticky'):
            STATE['inject'] = False
        out['lines'] = out['lines'][:2] + ['Guaranteed results for only $999 - this treatment cures it for good.']
    return out


def mock_reviewer(prompt):
    post = prompt.split('<<<POST', 1)[-1].split('POST>>>', 1)[0]
    post = re.sub(r'https?://\S+', ' ', post)  # the source URL slug is not a claim
    issues = []
    if re.search(r'guarant|cures?\b', post, re.I):
        issues.append({'type': 'outcome_promise', 'excerpt': 'Guaranteed results', 'reason': 'Promises an outcome.'})
    if re.search(r'\$\s?\d', post):
        issues.append({'type': 'invented_price', 'excerpt': '$999', 'reason': 'Price not in source.'})
    return {'pass': not issues, 'issues': issues}


class LLM(Base):
    def do_POST(self):
        req = json.loads(self.body() or '{}')
        if self.path.endswith('/messages'):  # Anthropic
            system = req.get('system', '')
            user = ' '.join(m['content'] if isinstance(m['content'], str) else m['content'][0]['text'] for m in req['messages'])
        else:
            system = ' '.join(m['content'] for m in req['messages'] if m['role'] == 'system')
            user = ' '.join(m['content'] for m in req['messages'] if m['role'] == 'user')
        res = mock_reviewer(user) if 'ROLE: REVIEWER' in system else mock_writer(user)
        text = json.dumps(res)
        log_jsonl('llm_calls.jsonl', {'t': time.time(), 'role': 'reviewer' if 'ROLE: REVIEWER' in system else 'writer', 'response': res})
        if self.path.endswith('/messages'):
            return self.send(200, {'id': 'msg_mock', 'type': 'message', 'role': 'assistant', 'model': req.get('model'),
                                   'content': [{'type': 'text', 'text': text}], 'stop_reason': 'end_turn'})
        return self.send(200, {'id': 'chatcmpl-mock', 'object': 'chat.completion', 'model': req.get('model'),
                               'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': text}, 'finish_reason': 'stop'}]})

    def do_GET(self):
        if self.path.startswith('/__inject'):
            STATE['inject'] = 'on=1' in self.path
            STATE['sticky'] = STATE['inject'] and 'sticky=1' in self.path  # sticky: rewrite is injected too -> guardrail block
            return self.send(200, {'inject': STATE['inject'], 'sticky': STATE['sticky']})
        self.send(404, {})


# ---------------------------------------------------------------- webhook sink
class Sink(Base):
    def do_POST(self):
        b = self.body()
        try:
            b = json.loads(b)
        except Exception:
            pass
        log_jsonl('outbox.jsonl', {'t': time.strftime('%Y-%m-%dT%H:%M:%S'), 'path': self.path, 'body': b})
        self.send(200, 'ok', 'text/plain')


# ---------------------------------------------------------------- mock Graph API
class Graph(Base):
    def do_GET(self):
        if self.path.startswith('/__token'):
            STATE['token_expired'] = 'expired=1' in self.path
            return self.send(200, {'token_expired': STATE['token_expired']})
        self.send(404, {})

    def do_POST(self):
        raw = self.body()
        ctype = self.headers.get('Content-Type', '')
        params = json.loads(raw) if 'json' in ctype else {k: v[0] for k, v in urllib.parse.parse_qs(raw).items()}
        q = {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).items()}
        params.update(q)
        token = params.pop('access_token', '') or self.headers.get('Authorization', '').replace('Bearer ', '')
        log_jsonl('graph_requests.jsonl', {'t': time.time(), 'path': self.path.split('?')[0], 'params': params,
                                            'token': 'REDACTED' if token else 'MISSING'})
        if token == 'EXPIRED' or STATE['token_expired']:
            return self.send(400, {'error': {'message': 'Error validating access token: Session has expired.',
                                             'type': 'OAuthException', 'code': 190, 'error_subcode': 463, 'fbtrace_id': 'mock'}})
        m = re.match(r'^/v[\d.]+/(\d+)/(photos|feed)', self.path)
        if not m:
            return self.send(404, {'error': {'message': 'Unknown path', 'code': 803}})
        pid, n = m.group(1), str(int(time.time() * 1000))[-10:]
        if m.group(2) == 'photos':
            return self.send(200, {'id': n, 'post_id': f'{pid}_{n}'})
        return self.send(200, {'id': f'{pid}_{n}'})


def serve(port, handler):
    ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()


if __name__ == '__main__':
    for port, h in [(8787, Replay), (8788, LLM), (8789, Sink), (8790, Graph)]:
        threading.Thread(target=serve, args=(port, h), daemon=True).start()
    print('sandbox services up: replay :8787, mock-llm :8788, webhook-sink :8789, mock-graph :8790', flush=True)
    while True:
        time.sleep(3600)
