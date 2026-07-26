# Embedded Wallet Acceptance Evidence

Status: ALL GATES BLOCKED - production integration is not permitted

This record covers the isolated Coinbase CDP EOA Sepolia lab only. It contains no credentials,
wallet addresses, authentication identifiers, private material or customer data. A local build is
not provider, recovery, device, legal or security-review evidence.

The JSON block is validated by
`apps/benefits-wallet-prototype/scripts/verify-security-boundary.mjs`. A gate may be changed to
`passed` only when `result`, `verifiedAt`, `verifiedBy` and at least one non-secret artifact
reference are present. Evidence must use repository-relative redacted artifacts or public HTTPS
references.

<!-- EMBEDDED_WALLET_EVIDENCE_JSON_START -->
```json
{
  "record": "ifr-embedded-wallet-acceptance",
  "version": 1,
  "updated": "2026-07-26",
  "gates": [
    {
      "id": "wallet-creation-repeat-login",
      "status": "blocked",
      "blocker": "No dedicated CDP test project and test identity are configured.",
      "result": "",
      "verifiedAt": null,
      "verifiedBy": null,
      "artifacts": []
    },
    {
      "id": "key-export-owner-escape",
      "status": "blocked",
      "blocker": "No provider-backed MFA export has been executed on a private test device.",
      "result": "",
      "verifiedAt": null,
      "verifiedBy": null,
      "artifacts": []
    },
    {
      "id": "second-device-recovery",
      "status": "blocked",
      "blocker": "No dedicated test wallet exists for a second-device recovery exercise.",
      "result": "",
      "verifiedAt": null,
      "verifiedBy": null,
      "artifacts": []
    },
    {
      "id": "lost-primary-auth",
      "status": "blocked",
      "blocker": "The recovery trust model and a disposable test identity are not approved.",
      "result": "",
      "verifiedAt": null,
      "verifiedBy": null,
      "artifacts": []
    },
    {
      "id": "linked-auth-takeover-resistance",
      "status": "blocked",
      "blocker": "No approved linked-auth test plan or disposable provider account exists.",
      "result": "",
      "verifiedAt": null,
      "verifiedBy": null,
      "artifacts": []
    },
    {
      "id": "provider-outage-sdk-failure",
      "status": "blocked",
      "blocker": "A configured provider test project is required for controlled failure testing.",
      "result": "",
      "verifiedAt": null,
      "verifiedBy": null,
      "artifacts": []
    },
    {
      "id": "secure-mobile-export-no-webview",
      "status": "blocked",
      "blocker": "Physical iPadOS, iOS and Android browser evidence is not available.",
      "result": "",
      "verifiedAt": null,
      "verifiedBy": null,
      "artifacts": []
    },
    {
      "id": "recovery-trust-model",
      "status": "blocked",
      "blocker": "Exactly one recovery trust model has not been selected and threat-modelled.",
      "result": "",
      "verifiedAt": null,
      "verifiedBy": null,
      "artifacts": []
    },
    {
      "id": "account-deletion-data-export",
      "status": "blocked",
      "blocker": "No disposable provider account exists for deletion and data-export testing.",
      "result": "",
      "verifiedAt": null,
      "verifiedBy": null,
      "artifacts": []
    },
    {
      "id": "accessible-mobile-recovery-warnings",
      "status": "blocked",
      "blocker": "Provider-backed recovery screens have not been exercised on physical devices.",
      "result": "",
      "verifiedAt": null,
      "verifiedBy": null,
      "artifacts": []
    },
    {
      "id": "legal-privacy-review",
      "status": "blocked",
      "blocker": "Email, recovery and provider metadata processing has not received legal review.",
      "result": "",
      "verifiedAt": null,
      "verifiedBy": null,
      "artifacts": []
    },
    {
      "id": "independent-security-review",
      "status": "blocked",
      "blocker": "No production candidate exists for an independent security assessment.",
      "result": "",
      "verifiedAt": null,
      "verifiedBy": null,
      "artifacts": []
    }
  ]
}
```
<!-- EMBEDDED_WALLET_EVIDENCE_JSON_END -->

## Update Rules

- Keep failed and blocked evidence redacted; never include one-time codes, session tokens, export
  output, private keys, recovery phrases, unredacted emails or full wallet addresses.
- Store screenshots or logs only after redaction and reference them from `artifacts`.
- A passing source build may support the lab boundary, but it cannot pass any gate above.
- Production remains on external user-controlled wallets until every gate passes and a separate
  production decision is approved.
