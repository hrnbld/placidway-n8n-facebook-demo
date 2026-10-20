#!/usr/bin/env python3
"""Builds the importable n8n workflow JSON files from src/code/*.js.

Why a build step: the Code-node logic lives in plain .js files (diffable, testable, reviewable)
and shared helpers (LLM adapter, prompts) are inlined with `//@include lib/x.js`, because n8n
Code nodes cannot import local modules. Output: workflows/*.json (import with `n8n import:workflow`).
"""
import json, os, re, uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src', 'code')
OUT = os.path.join(ROOT, 'workflows')
os.makedirs(OUT, exist_ok=True)

MAIN_ID = 'PwFbDailyPost001'
ERR_ID = 'PwFbErrorHandl01'
DASH_ID = 'PwFbDashboard001'
RUNS, POSTED = 'pw_runs', 'pw_posted'
RUN_COLUMNS = [('run_id', 'string'), ('started_at', 'string'), ('finished_at', 'string'), ('trigger', 'string'), ('mode', 'string'),
               ('content_type', 'string'), ('category', 'string'), ('item_url', 'string'), ('item_title', 'string'), ('image_url', 'string'),
               ('post_text', 'string'), ('chars_before_link', 'number'), ('attempts', 'number'), ('guardrail', 'string'),
               ('fb_post_id', 'string'), ('status', 'string'), ('error', 'string'), ('review_url', 'string')]
POSTED_COLUMNS = [('url', 'string'), ('title', 'string'), ('content_type', 'string'), ('category', 'string'),
                  ('fb_post_id', 'string'), ('status', 'string'), ('posted_at', 'string')]


def load_code(fn):
    def inc(m):
        return open(os.path.join(SRC, m.group(1)), encoding='utf-8').read().rstrip() + '\n'
    return re.sub(r'^//@include (\S+)\s*$', inc, open(os.path.join(SRC, fn), encoding='utf-8').read(), flags=re.M)


def nid(name):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, 'placidway-n8n/' + name))


class WF:
    def __init__(self, wid, name):
        self.wid, self.name, self.nodes, self.conn = wid, name, [], {}

    def add(self, name, type_, ver, pos, params, **extra):
        n = {'id': nid(self.wid + name), 'name': name, 'type': type_, 'typeVersion': ver, 'position': pos, 'parameters': params}
        n.update(extra)
        self.nodes.append(n)
        return name

    def link(self, a, b, out=0, inp=0):
        outs = self.conn.setdefault(a, {'main': []})['main']
        while len(outs) <= out:
            outs.append([])
        outs[out].append({'node': b, 'type': 'main', 'index': inp})

    def chain(self, *names):
        for a, b in zip(names, names[1:]):
            self.link(a, b)

    def note(self, name, pos, text, w=360, h=160, color=7):
        self.add(name, 'n8n-nodes-base.stickyNote', 1, pos, {'content': text, 'width': w, 'height': h, 'color': color})

    def json(self, settings=None):
        return {'id': self.wid, 'name': self.name, 'active': False, 'nodes': self.nodes, 'connections': self.conn,
                'settings': {'executionOrder': 'v1', 'saveManualExecutions': True, 'callerPolicy': 'workflowsFromSameOwner', **(settings or {})},
                'pinData': {}, 'tags': []}

    # ---- node helpers
    def code(self, name, fn, pos, on_error=False, notes=''):
        extra = {'onError': 'continueErrorOutput'} if on_error else {}
        if notes:
            extra.update({'notes': notes, 'notesInFlow': True})
        return self.add(name, 'n8n-nodes-base.code', 2, pos, {'jsCode': load_code(fn)}, **extra)

    def http_get(self, name, pos, url_expr, ua_expr, notes=''):
        return self.add(name, 'n8n-nodes-base.httpRequest', 4.2, pos, {
            'url': url_expr, 'sendHeaders': True,
            'headerParameters': {'parameters': [{'name': 'User-Agent', 'value': ua_expr}, {'name': 'Accept', 'value': 'text/html,application/xml;q=0.9,*/*;q=0.8'}]},
            'options': {'response': {'response': {'fullResponse': True, 'responseFormat': 'text'}}, 'timeout': 30000}},
            retryOnFail=True, maxTries=3, waitBetweenTries=5000, onError='continueErrorOutput', notes=notes, notesInFlow=bool(notes))

    def http_post_json(self, name, pos, url_expr, body_expr, headers=None, on_error='continueErrorOutput', retry=True, notes=''):
        p = {'method': 'POST', 'url': url_expr, 'sendBody': True, 'specifyBody': 'json', 'jsonBody': body_expr, 'options': {'timeout': 30000}}
        if headers:
            p['sendHeaders'] = True
            p['headerParameters'] = {'parameters': [{'name': k, 'value': v} for k, v in headers]}
        extra = {'onError': on_error}
        if retry:
            extra.update(retryOnFail=True, maxTries=3, waitBetweenTries=5000)
        if notes:
            extra.update(notes=notes, notesInFlow=True)
        return self.add(name, 'n8n-nodes-base.httpRequest', 4.2, pos, p, **extra)

    def if_(self, name, pos, left, op='true', right=''):
        ops = {'true': {'type': 'boolean', 'operation': 'true', 'singleValue': True},
               'notEmpty': {'type': 'string', 'operation': 'notEmpty', 'singleValue': True},
               'equals': {'type': 'string', 'operation': 'equals'}}
        return self.add(name, 'n8n-nodes-base.if', 2.2, pos, {
            'conditions': {'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 2},
                           'conditions': [{'id': nid(self.wid + name + 'c'), 'leftValue': left, 'rightValue': right, 'operator': ops[op]}],
                           'combinator': 'and'},
            'looseTypeValidation': True, 'options': {}})

    def dt_create(self, name, pos, table, cols):
        return self.add(name, 'n8n-nodes-base.dataTable', 1, pos, {
            'resource': 'table', 'operation': 'create', 'tableName': table,
            'columns': {'column': [{'name': c, 'type': t} for c, t in cols]}, 'options': {'createIfNotExists': True}})

    def dt_ref(self, table):
        return {'__rl': True, 'mode': 'name', 'value': table}

    def dt_get(self, name, pos, table):
        return self.add(name, 'n8n-nodes-base.dataTable', 1, pos, {
            'resource': 'row', 'operation': 'get', 'dataTableId': self.dt_ref(table), 'returnAll': True}, alwaysOutputData=True)

    def dt_insert(self, name, pos, table):
        return self.add(name, 'n8n-nodes-base.dataTable', 1, pos, {
            'resource': 'row', 'operation': 'insert', 'dataTableId': self.dt_ref(table),
            'columns': {'mappingMode': 'autoMapInputData', 'value': {}, 'matchingColumns': [], 'schema': []}, 'options': {}})

    def dt_upsert(self, name, pos, table, key='run_id'):
        return self.add(name, 'n8n-nodes-base.dataTable', 1, pos, {
            'resource': 'row', 'operation': 'upsert', 'dataTableId': self.dt_ref(table), 'matchType': 'allConditions',
            'filters': {'conditions': [{'keyName': key, 'condition': 'eq', 'keyValue': '={{ $json.%s }}' % key}]},
            'columns': {'mappingMode': 'autoMapInputData', 'value': {}, 'matchingColumns': [], 'schema': []}, 'options': {}})


# =====================================================================================  MAIN
w = WF(MAIN_ID, 'PlacidWay -> Facebook: Daily Post')
X = lambda c: c * 240  # column spacing
Y = lambda r: r * 200

# Triggers
w.add('Daily Schedule', 'n8n-nodes-base.scheduleTrigger', 1.2, [X(0), Y(0)],
      {'rule': {'interval': [{'field': 'cronExpression', 'expression': '0 9 * * *'}]}}, notes='09:00 every day (GENERIC_TIMEZONE)', notesInFlow=True)
w.add('Manual Run', 'n8n-nodes-base.manualTrigger', 1, [X(0), Y(1)], {})
w.add('Run Now (Webhook)', 'n8n-nodes-base.webhook', 2, [X(0), Y(2)],
      {'httpMethod': 'POST', 'path': 'placidway-run', 'responseMode': 'onReceived', 'options': {}},
      webhookId='6f1c2a9e-placidway-run-0001', notes='POST /webhook/placidway-run (optional ?type=&approval=)', notesInFlow=True)

w.dt_create('Ensure Table: pw_runs', [X(1), Y(1)], RUNS, RUN_COLUMNS)
w.dt_create('Ensure Table: pw_posted', [X(2), Y(1)], POSTED, POSTED_COLUMNS)
w.code('Config', 'config.js', [X(3), Y(1)], on_error=True, notes='All settings from env; DRY_RUN defaults to true')
w.dt_get('Load Posted History', [X(4), Y(1)], POSTED)
w.code('Plan Run (Rotation)', 'plan_run.js', [X(5), Y(1)], notes='Weekday -> content type')
w.add('Throttle 1 req/s (start)', 'n8n-nodes-base.wait', 1.1, [X(5) + 120, Y(1) + 160], {'resume': 'timeInterval', 'amount': '={{ $json.cfg.site.minDelaySeconds }}', 'unit': 'seconds'},
      webhookId='0b9a4c7e-placidway-throttle-0', notes='Spacing even for back-to-back manual runs', notesInFlow=True)
w.http_get('Fetch robots.txt', [X(6), Y(1)], "={{ $('Plan Run (Rotation)').first().json.plan.robotsFetchUrl }}", "={{ $('Plan Run (Rotation)').first().json.cfg.site.userAgent }}")
w.code('Apply robots.txt', 'apply_robots.js', [X(7), Y(1)], on_error=True)
w.add('Throttle 1 req/s (a)', 'n8n-nodes-base.wait', 1.1, [X(8), Y(1)], {'resume': 'timeInterval', 'amount': '={{ $json.throttleSeconds }}', 'unit': 'seconds'},
      webhookId='0b9a4c7e-placidway-throttle-a')
w.http_get('Fetch Sitemap', [X(9), Y(1)], "={{ $('Apply robots.txt').first().json.plan.sitemapFetchUrl }}", "={{ $('Apply robots.txt').first().json.cfg.site.userAgent }}",
           notes='One request lists every item + lastmod + image')
w.code('Select Item', 'select_item.js', [X(10), Y(1)], on_error=True, notes='Not posted before, newest, varied category')
w.add('Throttle 1 req/s (b)', 'n8n-nodes-base.wait', 1.1, [X(11), Y(1)], {'resume': 'timeInterval', 'amount': '={{ $json.throttleSeconds }}', 'unit': 'seconds'},
      webhookId='0b9a4c7e-placidway-throttle-b')
w.http_get('Fetch Page', [X(12), Y(1)], "={{ $('Select Item').first().json.item.fetchUrl }}", "={{ $('Select Item').first().json.cfg.site.userAgent }}")
w.code('Parse Page', 'parse_page.js', [X(13), Y(1)], on_error=True, notes='Title, summary, image, main body')

for t in ['Daily Schedule', 'Manual Run', 'Run Now (Webhook)']:
    w.link(t, 'Ensure Table: pw_runs')
w.chain('Ensure Table: pw_runs', 'Ensure Table: pw_posted', 'Config')
w.link('Config', 'Load Posted History')
w.chain('Load Posted History', 'Plan Run (Rotation)', 'Throttle 1 req/s (start)', 'Fetch robots.txt')
w.link('Fetch robots.txt', 'Apply robots.txt')
w.link('Apply robots.txt', 'Throttle 1 req/s (a)')
w.link('Throttle 1 req/s (a)', 'Fetch Sitemap')
w.link('Fetch Sitemap', 'Select Item')
w.link('Select Item', 'Throttle 1 req/s (b)')
w.link('Throttle 1 req/s (b)', 'Fetch Page')
w.link('Fetch Page', 'Parse Page')

# Generate + guardrails (row 4, right-to-left flow kept left-to-right for readability)
w.code('LLM: Write Post', 'llm_write.js', [X(14), Y(1)], on_error=True, notes='OpenAI-compatible or Anthropic')
w.code('Guardrail 1: Rules', 'guardrail_rules.js', [X(15), Y(1)], notes='Length, claims, prices, numbers, quotes')
w.code('Guardrail 2: LLM Review', 'llm_review.js', [X(16), Y(1)], on_error=True, notes='Independent reviewer, temperature 0')
w.code('Guardrail Verdict', 'verdict.js', [X(17), Y(1)])
w.if_('Passed Guardrails?', [X(18), Y(1)], '={{ $json.guardrail.pass }}')
w.if_('Rewrite Allowed?', [X(18), Y(3)], '={{ $json.canRewrite }}')
w.code('Prepare Rewrite', 'prepare_rewrite.js', [X(16), Y(3)], notes='Feed issues back, 1 retry')
w.code('Guardrail Blocked', 'guardrail_blocked.js', [X(19), Y(3)])
w.link('Parse Page', 'LLM: Write Post')
w.link('LLM: Write Post', 'Guardrail 1: Rules')
w.link('Guardrail 1: Rules', 'Guardrail 2: LLM Review')
w.link('Guardrail 2: LLM Review', 'Guardrail Verdict')
w.link('Guardrail Verdict', 'Passed Guardrails?')
w.link('Passed Guardrails?', 'Final Post', 0)
w.link('Passed Guardrails?', 'Rewrite Allowed?', 1)
w.link('Rewrite Allowed?', 'Prepare Rewrite', 0)
w.link('Rewrite Allowed?', 'Guardrail Blocked', 1)
w.link('Prepare Rewrite', 'LLM: Write Post')

# Approval or auto-publish
w.code('Final Post', 'final_post.js', [X(19), Y(1)], notes='Freeze text, build Graph request')
w.if_('Approval Mode?', [X(20), Y(1)], '={{ $json.cfg.approvalMode }}')
w.code('Build Review Request', 'build_review.js', [X(21), Y(0) - 200])
w.if_('Reviewer Webhook Set?', [X(22), Y(0) - 200], '={{ $json.cfg.review.configured }}', 'true')
w.http_post_json('Notify Reviewer', [X(23), Y(0) - 300], "={{ $env.REVIEW_WEBHOOK_URL || $env.ALERT_WEBHOOK_URL }}",
                 "={{ JSON.stringify($('Build Review Request').first().json.approval.payload) }}", notes='Slack-compatible incoming webhook')
w.code('Set Pending', 'set_pending.js', [X(24), Y(0) - 200])
w.code('Row: Pending', 'row_run.js', [X(25), Y(0) - 200])
w.dt_upsert('Log: Pending Approval', [X(26), Y(0) - 200], RUNS)
w.add('Wait for Approval', 'n8n-nodes-base.wait', 1.1, [X(27), Y(0) - 200], {
    'resume': 'webhook', 'httpMethod': 'GET', 'limitWaitTime': True, 'limitType': 'afterTimeInterval',
    'resumeAmount': '={{ Number($env.APPROVAL_TIMEOUT_HOURS || 24) }}', 'resumeUnit': 'hours', 'options': {}},
    webhookId='3d7e5b1a-placidway-approval-0001', notes='Approve/reject link resumes here', notesInFlow=True)
w.if_('Approved?', [X(28), Y(0) - 200], '={{ $json.query?.decision }}', 'equals', 'approve')
w.code('Set Rejected / Expired', 'set_rejected.js', [X(29), Y(-1) - 200])
w.code('Row: Rejected', 'row_run.js', [X(30), Y(-1) - 200])
w.dt_upsert('Log Rejected Run', [X(31), Y(-1) - 200], RUNS)

w.link('Final Post', 'Approval Mode?')
w.link('Approval Mode?', 'Build Review Request', 0)
w.link('Approval Mode?', 'Dry Run?', 1)
w.link('Build Review Request', 'Reviewer Webhook Set?')
w.link('Reviewer Webhook Set?', 'Notify Reviewer', 0)
w.link('Reviewer Webhook Set?', 'Set Pending', 1)
w.link('Notify Reviewer', 'Set Pending', 0)
w.chain('Set Pending', 'Row: Pending', 'Log: Pending Approval', 'Wait for Approval', 'Approved?')
w.link('Approved?', 'Dry Run?', 0)
w.link('Approved?', 'Set Rejected / Expired', 1)
w.code('Row: Seen (rejected)', 'row_posted_rejected.js', [X(32), Y(-1) - 200])
w.dt_insert('Remember Rejected URL', [X(33), Y(-1) - 200], POSTED)
w.chain('Set Rejected / Expired', 'Row: Rejected', 'Log Rejected Run', 'Row: Seen (rejected)', 'Remember Rejected URL')

# Publish
w.if_('Dry Run?', [X(29), Y(1)], "={{ $('Final Post').first().json.cfg.dryRun }}")
w.code('Simulate Publish', 'simulate_publish.js', [X(30), Y(0) + 60], notes='DRY RUN: nothing is sent')
w.if_('Photo Post?', [X(30), Y(2) - 60], "={{ $('Final Post').first().json.fb.endpoint === 'photos' }}")
fb_auth = [('Authorization', '=Bearer {{ $env.FB_PAGE_TOKEN }}')]
w.http_post_json('Facebook: Publish Photo', [X(31), Y(2) - 140],
                 "={{ $('Final Post').first().json.fb.url }}", "={{ JSON.stringify($('Final Post').first().json.fb.body) }}", headers=fb_auth, retry=False,
                 notes='POST /{page-id}/photos (no auto-retry: a timeout may still have published)')
w.http_post_json('Facebook: Publish Link Post', [X(31), Y(2) + 40],
                 "={{ $('Final Post').first().json.fb.url }}", "={{ JSON.stringify($('Final Post').first().json.fb.body) }}", headers=fb_auth, retry=False,
                 notes='POST /{page-id}/feed (no auto-retry: a timeout may still have published)')
w.code('Publish Result', 'publish_result.js', [X(32), Y(2) - 60])
w.code('Row: Run Log', 'row_run.js', [X(33), Y(1)])
w.dt_upsert('Log Run', [X(34), Y(1)], RUNS)
w.code('Row: Posted', 'row_posted.js', [X(35), Y(1)])
w.dt_insert('Mark URL as Posted', [X(36), Y(1)], POSTED)
w.link('Dry Run?', 'Simulate Publish', 0)
w.link('Dry Run?', 'Photo Post?', 1)
w.link('Photo Post?', 'Facebook: Publish Photo', 0)
w.link('Photo Post?', 'Facebook: Publish Link Post', 1)
w.link('Facebook: Publish Photo', 'Publish Result', 0)
w.link('Facebook: Publish Link Post', 'Publish Result', 0)
w.link('Simulate Publish', 'Row: Run Log')
w.link('Publish Result', 'Row: Run Log')
w.chain('Row: Run Log', 'Log Run', 'Row: Posted', 'Mark URL as Posted')

# Failure path (every error output lands here)
w.code('Classify Failure', 'classify_failure.js', [X(14), Y(5)], notes='Error -> code + fix hint')
w.code('Row: Failed', 'row_failed.js', [X(15), Y(5)])
w.dt_upsert('Log Failed Run', [X(16), Y(5)], RUNS)
w.if_('Alert Webhook Set?', [X(17), Y(5)], "={{ $('Classify Failure').first().json.alert.configured }}", 'true')
w.http_post_json('Send Alert', [X(18), Y(5) - 80], '={{ $env.ALERT_WEBHOOK_URL }}',
                 "={{ JSON.stringify($('Classify Failure').first().json.alert.payload) }}", on_error='continueRegularOutput')
w.add('Stop: Mark Run Failed', 'n8n-nodes-base.stopAndError', 1, [X(19), Y(5)],
      {'errorMessage': "=ALERTED {{ $('Classify Failure').first().json.code }} (run {{ $execution.id }}; details already sent to the alert channel and pw_runs)"})
w.chain('Classify Failure', 'Row: Failed', 'Log Failed Run', 'Alert Webhook Set?')
w.link('Alert Webhook Set?', 'Send Alert', 0)
w.link('Alert Webhook Set?', 'Stop: Mark Run Failed', 1)
w.link('Send Alert', 'Stop: Mark Run Failed')
for n in ['Config', 'Fetch robots.txt', 'Apply robots.txt', 'Fetch Sitemap', 'Select Item', 'Fetch Page', 'Parse Page',
          'LLM: Write Post', 'Guardrail 2: LLM Review', 'Notify Reviewer', 'Facebook: Publish Photo', 'Facebook: Publish Link Post']:
    w.link(n, 'Classify Failure', 1)
w.link('Guardrail Blocked', 'Classify Failure')

# Sticky notes (documentation on the canvas)
w.note('Note: Overview', [X(0), Y(-2) - 80], '## PlacidWay -> Facebook daily post\nTrigger -> robots.txt -> sitemap -> pick 1 new item -> parse page -> LLM draft -> 2 guardrails (rules + LLM review, 1 rewrite) -> approval (optional) -> publish / dry-run -> log.\nAll config via env (see README). DRY_RUN=true by default.', w=700, h=200, color=4)
w.note('Note: Extract', [X(6) - 40, Y(-1) - 40], '### Extract (polite)\nrobots.txt is fetched and honoured every run, Crawl-delay respected, >= 1.1 s between requests, 3 requests per run in total. Sitemap gives lastmod + image without crawling listing pages.', w=760, h=170, color=5)
w.note('Note: Guardrails', [X(14) - 40, Y(-1) - 40], '### Generate + guardrails\nRules: length, structure, banned claim words, no prices (unless ALLOW_PRICES), every number must exist in source, every line needs a verbatim source quote.\nLLM review: independent pass at temperature 0. Fail -> one rewrite with the issues -> still failing = blocked + alert.', w=1000, h=190, color=3)
w.note('Note: Failure path', [X(14) - 40, Y(6) + 20], '### Failure path\nEvery risky node has an error output. Classify Failure maps it to a code (SOURCE_BLOCKED, SOURCE_DOWN, FB_TOKEN_EXPIRED, LLM_ERROR, GUARDRAIL_BLOCKED...), logs a failed run, alerts the webhook, then marks the execution failed. Source and LLM HTTP calls retry 3x (5 s apart). Facebook publish calls never auto-retry: a timeout is flagged FB_PUBLISH_UNCERTAIN (check the Page first).', w=1200, h=150, color=2)

main = w.json({'errorWorkflow': ERR_ID, 'timezone': 'Asia/Jakarta'})

# =====================================================================================  ERROR HANDLER
e = WF(ERR_ID, 'PlacidWay -> Facebook: Error Handler')
e.add('Error Trigger', 'n8n-nodes-base.errorTrigger', 1, [0, 0], {})
e.code('Format Alert', 'error_handler.js', [240, 0])
e.if_('Not Alerted Yet?', [480, 0], '={{ !$json.skip }}')
e.http_post_json('Send Alert', [720, -80], '={{ $env.ALERT_WEBHOOK_URL }}', '={{ JSON.stringify($json.alert.payload) }}', on_error='continueRegularOutput')
e.code('Row: Crash', 'row_failed.js', [960, -80])
e.dt_upsert('Log Crash', [1200, -80], RUNS)
e.chain('Error Trigger', 'Format Alert', 'Not Alerted Yet?')
e.link('Not Alerted Yet?', 'Send Alert', 0)
e.link('Send Alert', 'Row: Crash')
e.link('Row: Crash', 'Log Crash')
# row_failed.js reads $input.first().json.row -> after Send Alert the json is the HTTP response, so point it at Format Alert:
for n in e.nodes:
    if n['name'] == 'Row: Crash':
        n['parameters']['jsCode'] = "return [{ json: $('Format Alert').first().json.row }];"
err = e.json()

# =====================================================================================  DASHBOARD
d = WF(DASH_ID, 'PlacidWay -> Facebook: Dashboard')
d.add('Open Dashboard (Webhook)', 'n8n-nodes-base.webhook', 2, [0, 0],
      {'httpMethod': 'GET', 'path': 'placidway-dashboard', 'responseMode': 'responseNode', 'options': {}}, webhookId='9a2f7c4d-placidway-dashboard')
d.dt_create('Ensure Table: pw_runs', [240, 0], RUNS, RUN_COLUMNS)
d.dt_get('Load Runs', [480, 0], RUNS)
d.code('Render HTML', 'dashboard.js', [720, 0])
d.add('Respond with Page', 'n8n-nodes-base.respondToWebhook', 1.1, [960, 0], {
    'respondWith': 'text', 'responseBody': '={{ $json.html }}',
    'options': {'responseHeaders': {'entries': [{'name': 'Content-Type', 'value': 'text/html; charset=utf-8'}]}}})
d.chain('Open Dashboard (Webhook)', 'Ensure Table: pw_runs', 'Load Runs', 'Render HTML', 'Respond with Page')
dash = d.json()

for fn, obj in [('placidway-fb-daily-post.json', main), ('placidway-fb-error-handler.json', err), ('placidway-fb-dashboard.json', dash)]:
    with open(os.path.join(OUT, fn), 'w', encoding='utf-8') as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
    print('wrote', fn, len(obj['nodes']), 'nodes')
