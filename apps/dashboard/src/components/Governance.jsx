import { useState, useEffect } from "react";

export default function Governance({ contracts }) {
  const [count, setCount] = useState(null);
  const [delay, setDelay] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const [c, d] = await Promise.all([
          contracts.governance.proposalCount(),
          contracts.governance.delay(),
        ]);
        setCount(c.toNumber());
        setDelay(d.toNumber());
      } catch (err) {
        console.error("Governance load error:", err);
      }
    }
    load();
  }, [contracts]);

  return (
    <div className="card">
      <h2>Governance</h2>
      <div className="token-grid">
        <div className="stat">
          <span className="stat-label">Proposals</span>
          <span className="stat-value">{count !== null ? count : "..."}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Timelock Delay</span>
          <span className="stat-value">{delay !== null ? `${delay / 3600}h` : "..."}</span>
        </div>
      </div>
      <p className="muted">Full governance UI coming in Phase 2.</p>
    </div>
  );
}
