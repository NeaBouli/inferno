#!/usr/bin/env bash
set -euo pipefail

CMC_API_BASE="https://pro-api.coinmarketcap.com"
KEY_INFO_URL="${CMC_API_BASE}/v1/key/info"
DEX_QUOTES_URL="${CMC_API_BASE}/v4/dex/pairs/quotes/latest"
NETWORK_ID="1"
IFR_POOL_ADDRESS="0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0"
MAX_ATTEMPTS=3

require_tools() {
  local missing=0

  for tool in curl jq mktemp; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "Fehler: benoetigtes Tool fehlt: $tool" >&2
      missing=1
    fi
  done

  if [[ "$missing" -ne 0 ]]; then
    exit 1
  fi
}

require_api_key() {
  if [[ -z "${CMC_API_KEY:-}" ]]; then
    cat >&2 <<'EOF'
Fehler: CMC_API_KEY ist nicht gesetzt.

Bitte den CoinMarketCap API-Key nur lokal in der Shell setzen, zum Beispiel:
  export CMC_API_KEY="..."

Der Key darf nicht in Dateien, Commits, Logs oder Chat-Ausgaben geschrieben werden.
EOF
    exit 1
  fi
}

cmc_get() {
  local url="$1"
  local body_file="$2"
  shift 2

  local attempt http_code sleep_seconds

  for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)); do
    if ! http_code=$(
      curl -sS \
        -o "$body_file" \
        -w '%{http_code}' \
        --connect-timeout 10 \
        --max-time 30 \
        -H "Accept: application/json" \
        -H "X-CMC_PRO_API_KEY: ${CMC_API_KEY}" \
        --get "$url" "$@"
    ); then
      echo "Fehler: Anfrage an CoinMarketCap ist fehlgeschlagen." >&2
      return 1
    fi

    if [[ "$http_code" != "429" ]]; then
      printf '%s\n' "$http_code"
      return 0
    fi

    if [[ "$attempt" -lt "$MAX_ATTEMPTS" ]]; then
      sleep_seconds=$((attempt * 5))
      echo "CMC Rate Limit (429). Neuer Versuch ${attempt}/${MAX_ATTEMPTS} nach ${sleep_seconds}s ..." >&2
      sleep "$sleep_seconds"
    fi
  done

  printf '%s\n' "$http_code"
}

print_json_error() {
  local body_file="$1"

  jq -r '.status.error_message // .status.error_code // .error // "Keine CMC-Fehlermeldung im JSON gefunden."' "$body_file" 2>/dev/null || {
    echo "Antwort war kein lesbares JSON:"
    sed -n '1,80p' "$body_file"
  }
}

validate_key() {
  local body_file http_code
  body_file="$(mktemp)"
  trap 'rm -f "$body_file" "${dex_body_file:-}"' EXIT

  echo "1/2 CMC API-Key wird validiert ..."
  http_code="$(cmc_get "$KEY_INFO_URL" "$body_file")"

  case "$http_code" in
    200)
      echo "CMC API-Key: OK"
      jq -r '
        .data as $d |
        "Plan: \($d.plan.name // $d.plan // "unbekannt")",
        "Monatslimit Credits: \($d.plan.credit_limit_monthly // $d.credit_limit_monthly // "unbekannt")",
        "Monatlich genutzte Credits: \($d.usage.current_month.credits_used // $d.usage.current_month.requests_made // "unbekannt")",
        "Taeglich genutzte Credits: \($d.usage.current_day.credits_used // $d.usage.current_day.requests_made // "unbekannt")"
      ' "$body_file"
      ;;
    401)
      echo "Fehler: CMC API-Key ist ungueltig oder nicht autorisiert." >&2
      echo "CMC Fehlermeldung:" >&2
      print_json_error "$body_file" >&2
      exit 1
      ;;
    500)
      echo "Fehler: CMC lieferte HTTP 500 bei der Key-Validierung." >&2
      echo "Rohantwort von CMC:" >&2
      sed -n '1,120p' "$body_file" >&2
      cat >&2 <<'EOF'

Hinweis: Wenn der Key gerade kopiert wurde, pruefe ihn lokal auf versteckte Steuerzeichen,
Zeilenumbrueche oder fuehrende/nachlaufende Leerzeichen. Den Key dabei nicht ausgeben.
EOF
      exit 1
      ;;
    *)
      echo "Fehler: Unerwarteter HTTP-Status bei der Key-Validierung: ${http_code}" >&2
      echo "CMC Fehlermeldung:" >&2
      print_json_error "$body_file" >&2
      exit 1
      ;;
  esac

  rm -f "$body_file"
  trap 'rm -f "${dex_body_file:-}"' EXIT
}

print_pair_data() {
  local body_file="$1"

  jq -r '
    def first_pair:
      if .data == null then
        null
      elif (.data | type) == "array" then
        .data[0]
      elif (.data | type) == "object" then
        if ((.data | has("name")) or (.data | has("pair_name")) or (.data | has("base_asset"))) then
          .data
        else
          ([.data[]] | flatten | map(select(type == "object")) | .[0])
        end
      else
        null
      end;

    def pair_name($p):
      $p.name //
      $p.pair_name //
      (if ($p.base_asset.symbol? and $p.quote_asset.symbol?) then
        "\($p.base_asset.symbol)/\($p.quote_asset.symbol)"
      else
        "unbekannt"
      end);

    def first_quote($p):
      if ($p.quote | type) == "array" then
        $p.quote[0]
      elif ($p.quote | type) == "object" then
        ($p.quote.USD // ([ $p.quote[] ] | map(select(type == "object")) | .[0]) // {})
      else
        {}
      end;

    first_pair as $p |
    if $p == null then
      "Pool NICHT im CMC DexScan-Index gefunden"
    else
      first_quote($p) as $q |
      "Pool im CMC DexScan-Index gefunden",
      "Pool: \(pair_name($p))",
      "Preis: \($p.price_quote // $p.price_usd // $q.price // "unbekannt")",
      "Liquiditaet: \($p.liquidity // $p.liquidity_usd // $q.liquidity // "unbekannt")",
      "24h Volumen: \($p.volume_24h // $p.volume_24h_usd // $q.volume_24h // "unbekannt")",
      "Letztes Update: \($p.last_updated // $q.last_updated // "unbekannt")"
    end
  ' "$body_file"
}

check_ifr_pool() {
  local http_code
  dex_body_file="$(mktemp)"

  echo
  echo "2/2 IFR/WETH Uniswap V2 Pool wird im CMC DexScan-Index gesucht ..."
  echo "Pool: ${IFR_POOL_ADDRESS}"
  echo "Network ID: ${NETWORK_ID} (Ethereum Mainnet)"

  http_code="$(
    cmc_get "$DEX_QUOTES_URL" "$dex_body_file" \
      --data-urlencode "contract_address=${IFR_POOL_ADDRESS}" \
      --data-urlencode "network_id=${NETWORK_ID}"
  )"

  if [[ "$http_code" == "200" ]]; then
    print_pair_data "$dex_body_file"
    return 0
  fi

  echo "CMC HTTP-Status: ${http_code}" >&2
  echo "CMC Fehlermeldung:" >&2
  print_json_error "$dex_body_file" >&2
  return 1
}

main() {
  require_tools
  require_api_key
  validate_key
  check_ifr_pool
}

main "$@"
