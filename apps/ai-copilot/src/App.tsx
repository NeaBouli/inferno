import IFRCopilot from "./components/IFRCopilot";

export default function App() {
  return (
    <div className="min-h-screen bg-ifr-dark text-white flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-2">IFR AI Copilot</h1>
        <p className="text-ifr-muted text-sm">Click the button in the bottom-right corner to start.</p>
      </div>
      <IFRCopilot />
    </div>
  );
}
