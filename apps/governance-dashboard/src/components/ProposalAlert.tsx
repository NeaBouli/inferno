import { useEffect, useState } from "react";
import { Contracts } from "../hooks/useContracts";
import { formatCountdown } from "../utils/format";

interface AlertProposal {
  id: number;
  eta: number;
  status: "pending" | "ready";
}

export default function ProposalAlert({ contracts }: { contracts: Contracts }) {
  const [alerts, setAlerts] = useState<AlertProposal[]>([]);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const count = (await contracts.governance.proposalCount()).toNumber();
        const active: AlertProposal[] = [];

        for (let i = 0; i < count; i++) {
          const p = await contracts.governance.getProposal(i);
          if (p.executed || p.cancelled) continue;

          const eta = p.eta.toNumber();
          const now = Math.floor(Date.now() / 1000);
          const status = now >= eta ? "ready" : "pending";
          active.push({ id: i, eta, status });
        }

        if (!cancelled) setAlerts(active);
      } catch (err) {
        console.error("ProposalAlert load error:", err);
      }
    }

    load();
    const interval = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [contracts]);

  // Countdown ticker
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const visible = alerts.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-2 mb-4">
      {visible.map((a) => {
        const now = Math.floor(Date.now() / 1000);
        const isReady = now >= a.eta;

        return (
          <div
            key={a.id}
            className={`flex items-center justify-between gap-4 px-4 py-3 rounded-lg border ${
              isReady
                ? "bg-ifr-accent/10 border-ifr-accent/30 text-ifr-accent"
                : "bg-ifr-yellow/10 border-ifr-yellow/30 text-ifr-yellow"
            }`}
          >
            <div className="flex items-center gap-3 text-sm font-medium">
              <span className="text-lg">{isReady ? "\u26A0" : "\u23F3"}</span>
              <span>
                Proposal #{a.id}
                {isReady
                  ? " is ready for execution"
                  : ` — ${formatCountdown(a.eta)} remaining`}
              </span>
            </div>
            <button
              onClick={() => setDismissed((prev) => new Set([...prev, a.id]))}
              className="text-xs opacity-60 hover:opacity-100 transition-opacity px-2 py-1 rounded border border-current/20"
            >
              Dismiss
            </button>
          </div>
        );
      })}
    </div>
  );
}
