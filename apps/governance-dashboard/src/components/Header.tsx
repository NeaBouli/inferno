export default function Header() {
  return (
    <header className="bg-ifr-card border-b border-ifr-border">
      <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-3">
        <img src="/token.png" alt="IFR" className="w-8 h-8 rounded-full" />
        <h1 className="text-lg font-bold text-gray-100">
          Inferno Governance
        </h1>
        <span className="ml-auto text-xs bg-ifr-accent/20 text-ifr-accent px-2 py-1 rounded">
          Sepolia
        </span>
      </div>
    </header>
  );
}
