// The sample objection-ledger rows the switch-off pin (test/severity-ledger-pin.test.js) renders: open and closed entries, every disposition word the approved table knows, a quote, an observed line, a compact closed row, and the "left out" note.
const base = { raised_by: { lab: 'la', layer: 1 }, source: { round: 1, draft_sha12: 'aaaaaaaaaaaa' }, first_round: 1, last_raised_round: 1, criterion: 'The plan defines a retry limit.', problem: 'No limit is specified.', reviser: { declined: false, draft_changed: true }, judge: null, observed: {}, status: 'active' };
const row = (id, extra) => ({ ...base, id, ...extra });
export const samples = {
  open_plain: { rows: [row('O-11111111', {})] },
  open_declined_withdrawn: { rows: [row('O-22222222', { reviser: { declined: true, reason: 'The limit is out of scope.', draft_changed: false }, judge: { last_disposition: 'withdrawn', status: 'withdrawn', round: 2, reasoning: 'The passage answers it.' }, status: 'closed' })] },
  exchange_withdrawal_and_quote: { rows: [row('O-33333333', { quote: 'retries failed requests', judge: { last_disposition: 'withdrawn_exchange', status: 'withdrawn', round: 2 }, status: 'closed' }), row('O-44444444', { judge: { last_disposition: 'withdrawal_refused', status: 'withdrawn', round: 2, quoted_from: 'reviewer', quoted_ref: 'lb' } })] },
  observed_and_stated_pass: { rows: [row('O-55555555', { observed: { not_raised_again_in: 3 }, judge: { last_disposition: 'stated_pass_open', status: null, round: 2 } }), row('O-66666666', { observed: { unheard_since: 2 }, judge: { last_disposition: 'unanswered', status: null, round: 2 } })] },
  compact_and_left_out: { rows: [row('O-77777777', { compact: true, judge: { last_disposition: 'withdrawn_exchange', status: 'withdrawn', round: 2 }, status: 'closed' })], omitted: { count: 2, ids: ['O-88888888', 'O-99999999'], more: 0 } },
};
