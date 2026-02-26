import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { parseIFR, formatIFRFull, IFR_DECIMALS } from "../utils/format";

const TIERS = [
  { name: "Bronze", min: 1000 },
  { name: "Silver", min: 2500 },
  { name: "Gold", min: 5000 },
  { name: "Platinum", min: 10000 },
];

function getTier(amount) {
  const num = parseFloat(ethers.utils.formatUnits(amount, IFR_DECIMALS));
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (num >= TIERS[i].min) return TIERS[i].name;
  }
  return "None";
}

export default function LockPanel({ contracts, account, signer }) {
  const [balance, setBalance] = useState(null);
  const [locked, setLocked] = useState(null);
  const [amount, setAmount] = useState("");
  const [allowance, setAllowance] = useState(null);
  const [locking, setLocking] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [approving, setApproving] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!contracts || !account) return;
    try {
      const [bal, loc, allow] = await Promise.all([
        contracts.token.balanceOf(account),
        contracts.ifrLock.lockedBalance(account),
        contracts.token.allowance(account, contracts.ifrLock.address),
      ]);
      setBalance(bal);
      setLocked(loc);
      setAllowance(allow);
    } catch (err) {
      console.error("LockPanel refresh:", err);
    }
  }, [contracts, account]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  const needsApproval = () => {
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) return false;
    if (!allowance) return true;
    try {
      return parseIFR(amount).gt(allowance);
    } catch {
      return false;
    }
  };

  async function handleApprove() {
    if (!signer) return;
    setError(null);
    setTxHash(null);
    setApproving(true);
    try {
      const tokenWithSigner = contracts.token.connect(signer);
      const tx = await tokenWithSigner.approve(
        contracts.ifrLock.address,
        ethers.constants.MaxUint256
      );
      setTxHash(tx.hash);
      await tx.wait();
      await refresh();
    } catch (err) {
      setError(err.reason || err.message || "Approval failed");
    } finally {
      setApproving(false);
    }
  }

  async function handleLock() {
    if (!signer || !amount) return;
    setError(null);
    setTxHash(null);
    setLocking(true);
    try {
      const parsed = parseIFR(amount);
      const lockWithSigner = contracts.ifrLock.connect(signer);
      const tx = await lockWithSigner.lock(parsed);
      setTxHash(tx.hash);
      await tx.wait();
      setAmount("");
      await refresh();
    } catch (err) {
      setError(err.reason || err.message || "Lock failed");
    } finally {
      setLocking(false);
    }
  }

  async function handleUnlock() {
    if (!signer) return;
    setError(null);
    setTxHash(null);
    setUnlocking(true);
    try {
      const lockWithSigner = contracts.ifrLock.connect(signer);
      const tx = await lockWithSigner.unlock();
      setTxHash(tx.hash);
      await tx.wait();
      await refresh();
    } catch (err) {
      setError(err.reason || err.message || "Unlock failed");
    } finally {
      setUnlocking(false);
    }
  }

  const tier = locked ? getTier(locked) : "None";
  const hasLocked = locked && locked.gt(0);

  return (
    <div className="card">
      <h2>IFR Lock</h2>
      {!account ? (
        <p className="muted">Connect your wallet to lock tokens.</p>
      ) : (
        <>
          <div className="token-grid">
            <div className="stat">
              <span className="stat-label">Wallet Balance</span>
              <span className="stat-value">
                {balance ? formatIFRFull(balance) + " IFR" : "..."}
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">Locked</span>
              <span className="stat-value burn">
                {locked ? formatIFRFull(locked) + " IFR" : "..."}
              </span>
            </div>
          </div>

          <div className="stat highlight">
            <span className="stat-label">Tier</span>
            <span className="stat-value">{tier}</span>
          </div>

          <div className="lock-tiers">
            <h3>Tier Requirements</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Min Lock</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {TIERS.map((t) => {
                  const reached = locked
                    ? parseFloat(ethers.utils.formatUnits(locked, IFR_DECIMALS)) >= t.min
                    : false;
                  return (
                    <tr key={t.name}>
                      <td>{t.name}</td>
                      <td>{t.min.toLocaleString()} IFR</td>
                      <td>
                        <span className={`status-badge ${reached ? "verified" : "unverified"}`}>
                          {reached ? "Reached" : "Locked"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="form-group" style={{ marginTop: 16 }}>
            <label>Amount to Lock (IFR)</label>
            <input
              type="text"
              placeholder="5000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="input"
            />
          </div>

          {needsApproval() ? (
            <button
              className="btn btn-send"
              onClick={handleApprove}
              disabled={approving}
            >
              {approving ? "Approving..." : "Approve IFR"}
            </button>
          ) : (
            <button
              className="btn btn-send"
              onClick={handleLock}
              disabled={locking || !amount || isNaN(amount) || parseFloat(amount) <= 0}
            >
              {locking ? "Locking..." : "Lock IFR"}
            </button>
          )}

          {hasLocked && (
            <button
              className="btn btn-send"
              onClick={handleUnlock}
              disabled={unlocking}
              style={{ background: "var(--red)", marginTop: 8 }}
            >
              {unlocking ? "Unlocking..." : "Unlock All"}
            </button>
          )}

          {txHash && (
            <div className="tx-result success">
              TX:{" "}
              <a
                href={`https://sepolia.etherscan.io/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                {txHash.slice(0, 10)}...{txHash.slice(-8)}
              </a>
            </div>
          )}
          {error && <div className="tx-result error">{error}</div>}
        </>
      )}
    </div>
  );
}
