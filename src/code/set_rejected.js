// Reviewer rejected, or the approval window expired (the Wait node times out with no decision).
const s = $('Final Post').first().json;
const decision = $input.first().json.query?.decision;
const status = decision === 'reject' ? 'rejected' : 'expired';
return [{ json: { ...s, result: { status, error: status === 'expired' ? 'No reviewer decision before timeout' : '' } } }];
