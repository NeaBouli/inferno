import { shortenAddress } from "../utils/format";
import { SEPOLIA_CHAIN_ID, MAINNET_CHAIN_ID } from "../config/addresses";

function getNetworkBadge(chainId) {
  if (chainId === SEPOLIA_CHAIN_ID) return { label: "Sepolia", className: "badge-sepolia" };
  if (chainId === MAINNET_CHAIN_ID) return { label: "Mainnet", className: "badge-mainnet" };
  if (chainId) return { label: "Wrong Network", className: "badge-wrong" };
  return { label: "Not Connected", className: "badge-disconnected" };
}

export default function Header({ account, chainId, connect, disconnect, switchToSepolia }) {
  const network = getNetworkBadge(chainId);

  return (
    <header className="header">
      <div className="header-left">
        <img src="/ifr_logo.png" alt="Inferno" className="logo" />
        <h1>Inferno Dashboard</h1>
      </div>
      <div className="header-right">
        <span className={`network-badge ${network.className}`}>
          {network.label}
        </span>
        {chainId && chainId !== SEPOLIA_CHAIN_ID && (
          <button className="btn btn-small" onClick={switchToSepolia}>
            Switch to Sepolia
          </button>
        )}
        {account ? (
          <button className="btn btn-wallet connected" onClick={disconnect}>
            {shortenAddress(account)}
          </button>
        ) : (
          <button className="btn btn-wallet" onClick={connect}>
            Connect Wallet
          </button>
        )}
      </div>
    </header>
  );
}
