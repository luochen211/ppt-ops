export const STATE_MACHINES = Object.freeze({
  candidate: {
    generated: ["validating"], validating: ["ready_for_review", "rejected"],
    ready_for_review: ["accepted", "rejected"], accepted: ["applied_to_draft"],
    rejected: [], applied_to_draft: []
  },
  version: {
    draft: ["approval_pending"], approval_pending: ["approved", "changes_requested"],
    changes_requested: ["draft"], approved: ["frozen"], frozen: []
  },
  build: {
    queued: ["preparing", "cancelled"], preparing: ["rendering", "failed", "cancelled"],
    rendering: ["validating", "failed", "cancelled"], validating: ["succeeded", "failed", "cancelled"],
    succeeded: [], failed: [], cancelled: []
  },
  review: {
    automated_pending: ["automated_complete"], automated_complete: ["human_pending"],
    human_pending: ["accepted", "rejected"], accepted: [], rejected: []
  },
  handoff: {
    preparing: ["packaged"], packaged: ["verified"], verified: ["delivered"],
    delivered: ["archived"], archived: []
  }
});

export function canTransition(machine, from, to) {
  const states = STATE_MACHINES[machine];
  if (!states) throw new Error(`unknown state machine: ${machine}`);
  if (!(from in states)) throw new Error(`unknown ${machine} state: ${from}`);
  if (!(to in states)) throw new Error(`unknown ${machine} state: ${to}`);
  return states[from].includes(to);
}

export function transition(machine, record, to) {
  if (!record || typeof record !== "object") throw new Error("record is required");
  if (!canTransition(machine, record.state, to)) throw new Error(`invalid ${machine} transition: ${record.state} -> ${to}`);
  return { ...record, state: to };
}
