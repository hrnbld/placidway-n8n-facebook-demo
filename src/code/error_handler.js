// Error Handler workflow: safety net for anything the main workflow did not catch itself.
// Errors already alerted in-flow are prefixed "ALERTED" and skipped to avoid double alerts.
const e = $input.first().json;
const msg = String(e.execution?.error?.message || e.trigger?.error?.message || 'Unknown error');
// n8n may rewrite a node's error message (e.g. ECONNREFUSED -> "The service refused the connection"),
// so look for the ALERTED marker in every message variant it keeps.
const variants = [msg, ...(e.execution?.error?.messages || []), String(e.execution?.error?.description || '')];
const already = variants.some((m) => /^ALERTED\b/.test(String(m)));
const text = `:rotating_light: *${e.workflow?.name || 'workflow'} crashed* (unhandled)\nExecution: ${e.execution?.id || 'n/a'} ${e.execution?.url || ''}\nLast node: ${e.execution?.lastNodeExecuted || 'n/a'}\nError: ${msg.slice(0, 800)}`;
const fmt = $env.WEBHOOK_FORMAT || 'slack';
return [{ json: {
  skip: already || !$env.ALERT_WEBHOOK_URL,
  alert: { configured: !!$env.ALERT_WEBHOOK_URL, payload: fmt === 'slack' ? { text } : { event: 'workflow_crashed', execution_id: e.execution?.id, last_node: e.execution?.lastNodeExecuted, message: msg } },
  row: { run_id: String(e.execution?.id || ''), finished_at: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC', status: 'failed', error: ('UNHANDLED: ' + msg).slice(0, 1500) },
} }];
