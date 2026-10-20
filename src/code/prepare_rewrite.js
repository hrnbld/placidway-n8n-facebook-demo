// Prepare Rewrite: feed the exact issues back to the writer for one more attempt.
const state = $input.first().json;
return [{ json: { ...state, rewrite: { issues: state.guardrail.issues, previous: state.draft } } }];
