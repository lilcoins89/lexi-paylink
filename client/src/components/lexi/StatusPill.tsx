const labels: Record<string, string> = {
  CREATED: "Created", AWAITING_PAYMENT: "Awaiting payment", DETECTED: "Detected", VERIFYING: "Verifying",
  CONFIRMED: "Confirmed", UNDERPAID: "Underpaid", OVERPAID: "Overpaid", EXPIRED: "Expired",
  FAILED: "Failed", REJECTED: "Rejected", QUEUED: "Queued", RUNNING: "Running",
  SUCCEEDED: "Succeeded", DEAD_LETTER: "Needs attention", SIMULATED: "Simulation",
};
export default function StatusPill({ status }: { status: string }) {
  return <span className={`status-pill status-${status.toLowerCase()}`}><i aria-hidden="true"/>{labels[status] ?? status.replaceAll("_", " ")}</span>;
}
