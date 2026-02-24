import { useState } from "react";
import { useContracts } from "./hooks/useContracts";
import Header from "./components/Header";
import Overview from "./components/Overview";
import Partners from "./components/Partners";
import TimelockQueue from "./components/TimelockQueue";
import CalldataGenerator from "./components/CalldataGenerator";

const TABS = ["Overview", "Partners", "Timelock Queue", "Calldata Generator"] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  const [tab, setTab] = useState<Tab>("Overview");
  const contracts = useContracts();

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <nav className="border-b border-ifr-border bg-ifr-card/50">
        <div className="max-w-7xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                tab === t
                  ? "border-ifr-accent text-ifr-accent"
                  : "border-transparent text-ifr-muted hover:text-gray-300"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </nav>
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        {tab === "Overview" && <Overview contracts={contracts} />}
        {tab === "Partners" && <Partners contracts={contracts} />}
        {tab === "Timelock Queue" && <TimelockQueue contracts={contracts} />}
        {tab === "Calldata Generator" && <CalldataGenerator />}
      </main>
      <footer className="text-center text-ifr-muted text-xs py-4 border-t border-ifr-border">
        Inferno ($IFR) Governance Dashboard — Read-only · Sepolia Testnet
      </footer>
    </div>
  );
}
