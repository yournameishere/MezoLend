#!/usr/bin/env bash
# Post-deploy steps that must execute on-chain (they read Mezo precompiles, which forge can't simulate):
#   1. Register the BTC/USD price feed (Skip primary, Pyth fallback)
#   2. (SEED=true) Seed both pools with MUSD liquidity and open an example borrow position in each market
# Usage: PRIVATE_KEY=0x... [SEED=true] ./script/configure.sh
set -euo pipefail
cd "$(dirname "$0")/.."

RPC="${RPC:-https://rpc.test.mezo.org}"
DEP="deployments/mezo-testnet.json"
BTC=0x7b7C000000000000000000000000000000000000
SKIP_BTC_USD=0x7b7c000000000000000000000000000000000015
PYTH_BTC_USD=0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43

j() { node -e "const d=require('./$DEP'); console.log($1)"; }
ORACLE=$(j 'd.oracle')
MUSD=$(j 'd.musd')
DEPLOYER=$(j 'd.deployer')
CORE_POOL=$(j 'd.core.pool')
CORE_BM=$(j 'd.core.borrowManager')
EDGE_POOL=$(j 'd.edge.pool')
EDGE_BM=$(j 'd.edge.borrowManager')

send() { cast send --rpc-url "$RPC" --private-key "$PRIVATE_KEY" "$@" | grep -E '^(status|transactionHash)' ; }
wei() { cast to-wei "$1"; }

echo "→ setFeed BTC (Skip primary, Pyth fallback)"
send "$ORACLE" "setFeed(address,address,uint32,bytes32,uint32,uint128,uint128)" \
  $BTC $SKIP_BTC_USD 1800 $PYTH_BTC_USD 3600 "$(wei 1000)" "$(wei 10000000)"
echo "  price: $(cast call --rpc-url "$RPC" "$ORACLE" 'getPrice(address)(uint256)' $BTC)"

if [[ "${SEED:-false}" == "true" ]]; then
  MAX=0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
  CORE_SUPPLY="${CORE_SUPPLY:-60}"; EDGE_SUPPLY="${EDGE_SUPPLY:-35}"
  echo "→ approve MUSD"
  send "$MUSD" "approve(address,uint256)" "$CORE_POOL" $MAX
  send "$MUSD" "approve(address,uint256)" "$EDGE_POOL" $MAX
  echo "→ supply $CORE_SUPPLY MUSD to Core, $EDGE_SUPPLY MUSD to Edge"
  send "$CORE_POOL" "deposit(uint256,address)(uint256)" "$(wei "$CORE_SUPPLY")" "$DEPLOYER"
  send "$EDGE_POOL" "deposit(uint256,address)(uint256)" "$(wei "$EDGE_SUPPLY")" "$DEPLOYER"
  echo "→ example positions: Core 0.0015 BTC / 25 MUSD, Edge 0.001 BTC / 15 MUSD"
  send "$CORE_BM" "depositAndBorrow(address,uint256,uint256)" $BTC "$(wei 0.0015)" "$(wei 25)" --value 0.0015ether
  send "$EDGE_BM" "depositAndBorrow(address,uint256,uint256)" $BTC "$(wei 0.001)" "$(wei 15)" --value 0.001ether
fi

# Optionally co-grant admin + pauser roles to another address (e.g. the owner's main wallet / a multisig).
if [[ -n "${CO_ADMIN:-}" ]]; then
  ADMIN_ROLE=0x0000000000000000000000000000000000000000000000000000000000000000
  PAUSER_ROLE=$(cast keccak "PAUSER_ROLE")
  echo "→ granting admin roles to $CO_ADMIN"
  send "$ORACLE" "grantRole(bytes32,address)" $ADMIN_ROLE "$CO_ADMIN"
  send "$(j 'd.registry')" "grantRole(bytes32,address)" $ADMIN_ROLE "$CO_ADMIN"
  for M in core edge; do
    for K in pool collateralManager borrowManager liquidationManager; do
      ADDR=$(j "d.$M.$K")
      send "$ADDR" "grantRole(bytes32,address)" $ADMIN_ROLE "$CO_ADMIN"
      if [[ "$K" != "collateralManager" ]]; then send "$ADDR" "grantRole(bytes32,address)" "$PAUSER_ROLE" "$CO_ADMIN"; fi
    done
  done
fi
echo "done"
