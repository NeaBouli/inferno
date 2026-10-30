import React from "react";
import ReactDOM from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { wagmiConfig } from "./config/wagmi";
import App from "./App";
import "@rainbow-me/rainbowkit/styles.css";
import "./App.css";

const queryClient = new QueryClient();
const walletTheme = darkTheme({
  accentColor: "#e74c3c",
  accentColorForeground: "#000",
  borderRadius: "medium",
});
walletTheme.colors.connectButtonTextError = "#000";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={walletTheme}>
          <App />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>
);
