/*!
 * IFR Benefits Widget v1.0.0 (MIT) — https://ifrunit.tech/wiki/integrate-benefits.html
 *
 * Serverless display widget for partner websites. It reads the visitor's IFRLock balance directly
 * from Ethereum Mainnet through a public RPC and shows which of the partner's IFR Benefits rules the
 * visitor meets. The rules come from the partner's own entry in IFR Benefits (shop.ifrunit.tech).
 *
 * DISPLAY ONLY. A browser check is not access control and grants nothing. The discount itself is
 * granted at checkout through IFR Benefits, which re-verifies every condition on-chain.
 *
 * Usage: add an element with the attributes data-ifr-benefits and data-business="your-shop-slug", then
 * load this file with its published integrity hash (snippet on the wiki page above). Without
 * data-business the widget shows the generic IFRLock tier ladder (no discounts).
 */
(function (root) {
  "use strict";

  var VERSION = "1.0.0";
  var IFR_DECIMALS = 9n;
  var UNIT = 10n ** IFR_DECIMALS;
  var MAINNET_CHAIN_ID = "0x1";
  var IFR_TOKEN = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
  var IFRLOCK = "0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb";
  var SELECTOR_LOCKED_BALANCE = "0x9ae697bf"; // lockedBalance(address)
  var SELECTOR_BALANCE_OF = "0x70a08231"; // balanceOf(address)
  var DEFAULT_API = "https://shop.ifrunit.tech";
  var DEFAULT_RPC = "https://ethereum-rpc.publicnode.com";
  var SHOP_URL = "https://shop.ifrunit.tech";
  // Same presets as the IFR Benefits shop (apps/benefits-network/frontend/src/components/WalletStatus.tsx).
  // Labels and lock thresholds only: discounts are always defined by each partner.
  var TIER_PRESETS = [
    { label: "Bronze", amount: 1000 },
    { label: "Silver", amount: 2500 },
    { label: "Gold", amount: 5000 },
    { label: "Platinum", amount: 10000 },
  ];

  function units(wholeIFR) {
    if (typeof wholeIFR !== "number" || !Number.isSafeInteger(wholeIFR) || wholeIFR < 0) return null;
    return BigInt(wholeIFR) * UNIT;
  }

  /**
   * Evaluate partner rules exactly as far as a browser can verify them.
   * Status per rule: "met" (IFRLock path verified), "not_met", or "checkout" (only the shop can decide,
   * e.g. CommitmentVault time locks or malformed data). A rule is never reported as met unless the
   * shop would accept it through the IFRLock path with the same thresholds.
   * @param {Array} rules rules from GET /api/businesses/:id/rules
   * @param {{locked: bigint, held: bigint}} balances raw units (9 decimals)
   */
  function evaluateRules(rules, balances) {
    var results = [];
    var list = Array.isArray(rules) ? rules : [];
    for (var i = 0; i < list.length; i++) {
      var rule = list[i] || {};
      var required = units(rule.requiredLockIFR);
      var heldRequired = units(rule.minIFRHeld == null ? 0 : rule.minIFRHeld);
      var discount = Number.isSafeInteger(rule.discountPercent) && rule.discountPercent >= 0 && rule.discountPercent <= 100
        ? rule.discountPercent : null;
      var source = rule.lockSource == null ? "ifrlock" : rule.lockSource;
      var status;
      if (required === null || required === 0n || heldRequired === null || discount === null || rule.active === false) {
        status = "checkout";
      } else if (source === "commitment_time_only") {
        status = "checkout";
      } else if (source === "ifrlock" || source === "either") {
        var ifrLockMet = balances.locked >= required && balances.held >= heldRequired;
        status = ifrLockMet ? "met" : (source === "either" ? "checkout" : "not_met");
      } else {
        status = "checkout";
      }
      results.push({
        id: rule.id || null,
        label: typeof rule.label === "string" ? rule.label : "",
        productName: typeof rule.productName === "string" ? rule.productName : null,
        productId: rule.productId || null,
        discountPercent: discount,
        requiredLockIFR: rule.requiredLockIFR,
        minIFRHeld: rule.minIFRHeld == null ? 0 : rule.minIFRHeld,
        lockSource: source,
        status: status,
      });
    }
    var best = null;
    for (var j = 0; j < results.length; j++) {
      var r = results[j];
      if (r.status === "met" && !r.productId && (best === null || r.discountPercent > best.discountPercent)) best = r;
    }
    return { results: results, best: best };
  }

  /** Highest preset tier reached by an IFRLock balance (raw units), or null. */
  function tierFor(lockedUnits) {
    var reached = null;
    for (var i = 0; i < TIER_PRESETS.length; i++) {
      if (lockedUnits >= BigInt(TIER_PRESETS[i].amount) * UNIT) reached = TIER_PRESETS[i];
    }
    return reached;
  }

  function formatIFR(raw) {
    var whole = (raw / UNIT).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var frac = (raw % UNIT).toString().padStart(9, "0").replace(/0+$/, "").slice(0, 3);
    return frac ? whole + "." + frac : whole;
  }

  function encodeAddressCall(selector, address) {
    var clean = String(address).toLowerCase().replace(/^0x/, "");
    if (!/^[0-9a-f]{40}$/.test(clean)) throw new Error("invalid address");
    return selector + "0".repeat(24) + clean;
  }

  function rpc(url, method, params, fetchImpl) {
    return fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params }),
    }).then(function (r) {
      if (!r.ok) throw new Error("rpc http " + r.status);
      return r.json();
    }).then(function (j) {
      if (j.error || typeof j.result !== "string") throw new Error("rpc error");
      return j.result;
    });
  }

  function readBalances(rpcUrl, address, fetchImpl) {
    return rpc(rpcUrl, "eth_chainId", [], fetchImpl).then(function (chain) {
      if (String(chain).toLowerCase() !== MAINNET_CHAIN_ID) throw new Error("rpc is not Ethereum Mainnet");
      return Promise.all([
        rpc(rpcUrl, "eth_call", [{ to: IFRLOCK, data: encodeAddressCall(SELECTOR_LOCKED_BALANCE, address) }, "latest"], fetchImpl),
        rpc(rpcUrl, "eth_call", [{ to: IFR_TOKEN, data: encodeAddressCall(SELECTOR_BALANCE_OF, address) }, "latest"], fetchImpl),
      ]);
    }).then(function (out) {
      for (var i = 0; i < out.length; i++) if (!/^0x[0-9a-fA-F]{64}$/.test(out[i])) throw new Error("malformed rpc result");
      return { locked: BigInt(out[0]), held: BigInt(out[1]) };
    });
  }

  function fetchRules(api, business, fetchImpl) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(business)) return Promise.reject(new Error("invalid business id"));
    return fetchImpl(api.replace(/\/$/, "") + "/api/businesses/" + encodeURIComponent(business) + "/rules", {
      headers: { accept: "application/json" }, credentials: "omit",
    }).then(function (r) {
      if (!r.ok) throw new Error("rules http " + r.status);
      return r.json();
    }).then(function (j) {
      if (!j || !Array.isArray(j.rules)) throw new Error("malformed rules");
      return j.rules;
    });
  }

  // ---------- UI (textContent only; remote data is never parsed as HTML) ----------
  var STYLE = ".ifrbw{font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e8e8ed;background:#111113;border:1px solid #2a2a2e;border-radius:12px;padding:16px;max-width:420px}" +
    ".ifrbw h4{margin:0 0 8px;font-size:15px;color:#ff6a33}.ifrbw button{font:inherit;background:#ff4500;color:#fff;border:0;border-radius:8px;padding:8px 14px;cursor:pointer}" +
    ".ifrbw button:disabled{opacity:.6;cursor:default}.ifrbw ul{margin:8px 0;padding-left:18px}.ifrbw .ok{color:#22c55e;font-weight:600}.ifrbw .no{color:#8a8a96}" +
    ".ifrbw .chk{color:#eab308}.ifrbw .err{color:#f87171;font-weight:600}.ifrbw small{display:block;color:#8a8a96;margin-top:10px}.ifrbw a{color:#ff6a33}";

  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  function mount(node, options) {
    options = options || {};
    var fetchImpl = options.fetch || (root.fetch && root.fetch.bind(root));
    var provider = options.provider || root.ethereum;
    var business = options.business != null ? options.business : node.getAttribute("data-business");
    var api = options.api || node.getAttribute("data-api") || DEFAULT_API;
    var rpcUrl = options.rpc || node.getAttribute("data-rpc") || DEFAULT_RPC;

    if (!document.getElementById("ifrbw-style")) {
      var st = el("style", STYLE); st.id = "ifrbw-style"; document.head.appendChild(st);
    }
    node.textContent = "";
    var box = el("div", null, "ifrbw");
    box.setAttribute("data-ifrbw-state", "idle");
    box.appendChild(el("h4", business ? "Your IFR benefits here" : "Your IFRLock tier"));
    var out = el("div");
    var btn = el("button", "Check with my wallet");
    var note = el("small", "Display only: nothing is granted here. Discounts are granted at checkout through IFR Benefits, which re-verifies on-chain. ");
    var link = el("a", "IFR Benefits"); link.href = SHOP_URL; link.target = "_blank"; link.rel = "noopener noreferrer";
    note.appendChild(link);
    box.appendChild(out); box.appendChild(btn); box.appendChild(note);
    node.appendChild(box);

    function show(state, lines) {
      box.setAttribute("data-ifrbw-state", state);
      out.textContent = "";
      for (var i = 0; i < lines.length; i++) out.appendChild(lines[i]);
    }

    btn.addEventListener("click", function () {
      if (!provider || typeof provider.request !== "function") {
        show("no-wallet", [el("p", "No browser wallet found. Install a wallet such as MetaMask to check your IFR lock.", "err")]);
        return;
      }
      btn.disabled = true;
      show("loading", [el("p", "Checking on Ethereum Mainnet…")]);
      provider.request({ method: "eth_requestAccounts" }).then(function (accounts) {
        var address = accounts && accounts[0];
        if (!address) throw new Error("no account");
        return Promise.all([
          readBalances(rpcUrl, address, fetchImpl).catch(function () { return "rpc-failed"; }),
          business ? fetchRules(api, business, fetchImpl).catch(function () { return "rules-failed"; }) : Promise.resolve(null),
        ]);
      }).then(function (res) {
        var balances = res[0], rules = res[1];
        if (balances === "rpc-failed") {
          show("rpc-failed", [el("p", "Could not verify your IFR lock right now, so no benefit is shown. Please try again later.", "err")]);
          return;
        }
        var lines = [el("p", "Locked in IFRLock: " + formatIFR(balances.locked) + " IFR")];
        if (!business) {
          var tier = tierFor(balances.locked);
          lines.push(el("p", tier ? "Tier: " + tier.label : "No tier yet (Bronze starts at 1,000 IFR locked).", tier ? "ok" : "no"));
          show(tier ? "tier" : "no-tier", lines);
          return;
        }
        if (rules === "rules-failed") {
          lines.push(el("p", "Could not load this partner's benefit rules, so no benefit is shown.", "err"));
          show("rules-failed", lines);
          return;
        }
        var ev = evaluateRules(rules, balances);
        if (!ev.results.length) {
          lines.push(el("p", "This partner has no active IFR benefit right now.", "no"));
          show("no-rules", lines);
          return;
        }
        lines.push(el("p", ev.best ? "You qualify for " + ev.best.discountPercent + "% (" + ev.best.label + ")." : "You do not qualify for a store-wide benefit yet.", ev.best ? "ok" : "no"));
        var ul = el("ul");
        for (var i = 0; i < ev.results.length; i++) {
          var r = ev.results[i];
          var what = (r.productName ? r.productName + ": " : "") + (r.label ? r.label + " — " : "") +
            (r.discountPercent == null ? "?" : r.discountPercent) + "% from " + Number(r.requiredLockIFR).toLocaleString("en-US") + " IFR locked" +
            (r.minIFRHeld ? " and " + Number(r.minIFRHeld).toLocaleString("en-US") + " IFR held" : "");
          var tag = r.status === "met" ? " ✓ met" : r.status === "not_met" ? " — not met" : " — checked at checkout";
          ul.appendChild(el("li", what + tag, r.status === "met" ? "ok" : r.status === "not_met" ? "no" : "chk"));
        }
        lines.push(ul);
        show(ev.best ? "qualified" : "not-qualified", lines);
      }).catch(function () {
        show("wallet-declined", [el("p", "Wallet connection was declined or failed. No benefit is shown.", "err")]);
      }).then(function () { btn.disabled = false; });
    });
    return box;
  }

  var api = { VERSION: VERSION, TIER_PRESETS: TIER_PRESETS, evaluateRules: evaluateRules, tierFor: tierFor, formatIFR: formatIFR, mount: mount };
  root.IFRBenefitsWidget = api;
  if (typeof module === "object" && module.exports) module.exports = api;

  if (typeof document !== "undefined") {
    var start = function () {
      var nodes = document.querySelectorAll("[data-ifr-benefits]");
      for (var i = 0; i < nodes.length; i++) if (!nodes[i].getAttribute("data-ifrbw-mounted")) {
        nodes[i].setAttribute("data-ifrbw-mounted", "1");
        mount(nodes[i]);
      }
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  }
})(typeof window !== "undefined" ? window : globalThis);
