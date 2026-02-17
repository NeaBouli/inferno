import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { parseIFR, formatIFRFull, IFR_DECIMALS } from "../utils/format";

export default function Transfer({ contracts, account, signer }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [fees, setFees] = useState(null);
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function calcFees() {
      if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
        setFees(null);
        return;
      }
      try {
        const [senderBps, recipientBps, poolBps] = await Promise.all([
          contracts.token.senderBurnBps(),
          contracts.token.recipientBurnBps(),
          contracts.token.poolFeeBps(),
        ]);

        const parsed = parseIFR(amount);
        const senderBurn = parsed.mul(senderBps).div(10000);
        const recipientBurn = parsed.mul(recipientBps).div(10000);
        const poolFee = parsed.mul(poolBps).div(10000);
        const net = parsed.sub(senderBurn).sub(recipientBurn).sub(poolFee);

        setFees({ senderBurn, recipientBurn, poolFee, net, total: parsed });
      } catch {
        setFees(null);
      }
    }
    calcFees();
  }, [amount, contracts]);

  async function handleSend(e) {
    e.preventDefault();
    if (!signer || !to || !amount) return;

    setError(null);
    setTxHash(null);
    setSending(true);

    try {
      if (!ethers.utils.isAddress(to)) {
        throw new Error("Invalid address");
      }
      const parsed = parseIFR(amount);
      const tokenWithSigner = contracts.token.connect(signer);
      const tx = await tokenWithSigner.transfer(to, parsed);
      setTxHash(tx.hash);
      await tx.wait();
    } catch (err) {
      setError(err.reason || err.message || "Transaction failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card">
      <h2>Transfer IFR</h2>
      {!account ? (
        <p className="muted">Connect your wallet to transfer tokens.</p>
      ) : (
        <form onSubmit={handleSend}>
          <div className="form-group">
            <label>Recipient Address</label>
            <input
              type="text"
              placeholder="0x..."
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="input"
            />
          </div>
          <div className="form-group">
            <label>Amount (IFR)</label>
            <input
              type="text"
              placeholder="1000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="input"
            />
          </div>

          {fees && (
            <div className="fee-preview">
              <h4>Fee Preview</h4>
              <table className="table">
                <tbody>
                  <tr><td>You send</td><td>{formatIFRFull(fees.total)} IFR</td></tr>
                  <tr className="burn"><td>Sender Burn (2%)</td><td>-{formatIFRFull(fees.senderBurn)} IFR</td></tr>
                  <tr className="burn"><td>Recipient Burn (0.5%)</td><td>-{formatIFRFull(fees.recipientBurn)} IFR</td></tr>
                  <tr><td>Pool Fee (1%)</td><td>-{formatIFRFull(fees.poolFee)} IFR</td></tr>
                  <tr className="net"><td>Recipient gets</td><td>{formatIFRFull(fees.net)} IFR</td></tr>
                </tbody>
              </table>
            </div>
          )}

          <button type="submit" className="btn btn-send" disabled={sending || !to || !amount}>
            {sending ? "Sending..." : "Send IFR"}
          </button>

          {txHash && (
            <div className="tx-result success">
              TX: <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer">
                {txHash.slice(0, 10)}...{txHash.slice(-8)}
              </a>
            </div>
          )}
          {error && <div className="tx-result error">{error}</div>}
        </form>
      )}
    </div>
  );
}
