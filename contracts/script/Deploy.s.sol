// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {InterestRateModel} from "../src/InterestRateModel.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {LendingPool} from "../src/LendingPool.sol";
import {CollateralManager} from "../src/CollateralManager.sol";
import {BorrowManager} from "../src/BorrowManager.sol";
import {LiquidationManager} from "../src/LiquidationManager.sol";
import {MarketRegistry} from "../src/MarketRegistry.sol";
import {MezoLendLens} from "../src/MezoLendLens.sol";
import {MezoLendZap, IMezoPoolsRouter} from "../src/MezoLendZap.sol";
import {ILendingPool, ICollateralManager, IPriceOracle, IBorrowManager} from "../src/interfaces/IMezoLend.sol";

/// @notice Deploys the full MezoLend protocol (two markets + the Mezo Pools zap) to Mezo Testnet and writes
///         ../deployments/mezo-testnet.json. Env: DEPLOYER_PRIVATE_KEY (0x-prefixed).
///         Oracle-dependent configuration and demo data run afterwards on-chain (web/scripts/seed-demo.mjs).
contract Deploy is Script {
    // Mezo testnet
    address constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;
    address constant SKIP_BTC_USD = 0x7b7c000000000000000000000000000000000015;
    address constant PYTH = 0x2880aB155794e7179c9eE2e38200202908C17B43;
    bytes32 constant PYTH_BTC_USD = 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43;
    address constant BTC = 0x7b7C000000000000000000000000000000000000;
    address constant MEZO = 0x7B7c000000000000000000000000000000000001;
    address constant POOLS_ROUTER = 0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9;
    address constant POOLS_FACTORY = 0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A;

    struct MarketParams {
        string name;
        string description;
        string shareName;
        string shareSymbol;
        uint256 baseRate;
        uint256 slope1;
        uint256 slope2;
        uint256 kink;
        uint256 reserveFactor;
        uint256 originationFee;
        uint64 ltv;
        uint64 liqThreshold;
        uint64 liqBonus;
        uint256 protocolShare;
    }

    struct Deployed {
        address irm;
        address pool;
        address cm;
        address bm;
        address lm;
    }

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        uint256 startBlock = block.number;

        vm.startBroadcast(pk);

        // NOTE: Mezo's Skip oracle is a chain precompile. Its stub bytecode recurses in a vanilla EVM, so any
        // call that reads it (oracle.setFeed, borrows) can't run in forge's local simulation. Those steps run
        // on-chain afterwards via script/configure.sh (cast send).
        PriceOracle oracle = new PriceOracle(deployer, PYTH);

        MarketRegistry registry = new MarketRegistry(deployer, MUSD, address(oracle));

        Deployed memory core = _deployMarket(
            deployer,
            oracle,
            registry,
            MarketParams({
                name: "Core",
                description: "Conservative BTC-backed market. 70% max LTV, gentle rate curve with a kink at 80% utilization.",
                shareName: "MezoLend Core MUSD",
                shareSymbol: "mlMUSD-C",
                baseRate: 0.01e18,
                slope1: 0.06e18,
                slope2: 0.8e18,
                kink: 0.8e18,
                reserveFactor: 0.1e18,
                originationFee: 0.001e18,
                ltv: 0.7e18,
                liqThreshold: 0.8e18,
                liqBonus: 0.05e18,
                protocolShare: 0.1e18
            })
        );

        Deployed memory edge = _deployMarket(
            deployer,
            oracle,
            registry,
            MarketParams({
                name: "Edge",
                description: "Higher-yield BTC-backed market. 78% max LTV, steeper curve above 85% utilization.",
                shareName: "MezoLend Edge MUSD",
                shareSymbol: "mlMUSD-E",
                baseRate: 0.02e18,
                slope1: 0.1e18,
                slope2: 1.2e18,
                kink: 0.85e18,
                reserveFactor: 0.15e18,
                originationFee: 0.0025e18,
                ltv: 0.78e18,
                liqThreshold: 0.85e18,
                liqBonus: 0.075e18,
                protocolShare: 0.15e18
            })
        );

        MezoLendLens lens = new MezoLendLens(registry);
        MezoLendZap zap =
            new MezoLendZap(IMezoPoolsRouter(POOLS_ROUTER), POOLS_FACTORY, IERC20(MUSD), registry, MEZO);

        vm.stopBroadcast();

        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeUint(obj, "startBlock", startBlock);
        vm.serializeAddress(obj, "deployer", deployer);
        vm.serializeAddress(obj, "musd", MUSD);
        vm.serializeAddress(obj, "btc", BTC);
        vm.serializeAddress(obj, "oracle", address(oracle));
        vm.serializeAddress(obj, "registry", address(registry));
        vm.serializeAddress(obj, "lens", address(lens));
        vm.serializeAddress(obj, "zap", address(zap));
        vm.serializeAddress(obj, "mezo", MEZO);
        vm.serializeAddress(obj, "poolsRouter", POOLS_ROUTER);
        vm.serializeAddress(obj, "poolsFactory", POOLS_FACTORY);
        vm.serializeString(obj, "core", _marketJson("core", core));
        string memory json = vm.serializeString(obj, "edge", _marketJson("edge", edge));
        vm.writeJson(json, "../deployments/mezo-testnet.json");

        console2.log("Registry", address(registry));
        console2.log("Lens", address(lens));
        console2.log("Zap", address(zap));
        console2.log("Core pool", core.pool);
        console2.log("Edge pool", edge.pool);
    }

    function _deployMarket(address deployer, PriceOracle oracle, MarketRegistry registry, MarketParams memory p)
        internal
        returns (Deployed memory d)
    {
        InterestRateModel irm = new InterestRateModel(p.baseRate, p.slope1, p.slope2, p.kink);
        CollateralManager cm = new CollateralManager(deployer);
        LendingPool pool = new LendingPool(
            IERC20(MUSD), p.shareName, p.shareSymbol, deployer, irm, deployer, p.reserveFactor, p.originationFee, 10e18
        );
        BorrowManager bm = new BorrowManager(
            deployer, ILendingPool(address(pool)), ICollateralManager(address(cm)), IPriceOracle(address(oracle))
        );
        LiquidationManager lm = new LiquidationManager(
            deployer,
            ILendingPool(address(pool)),
            ICollateralManager(address(cm)),
            IBorrowManager(address(bm)),
            0.5e18,
            0.95e18,
            100e18,
            p.protocolShare
        );

        pool.grantRole(pool.BORROW_MANAGER_ROLE(), address(bm));
        pool.grantRole(pool.LIQUIDATION_MANAGER_ROLE(), address(lm));
        cm.grantRole(cm.CONTROLLER_ROLE(), address(bm));
        cm.grantRole(cm.CONTROLLER_ROLE(), address(lm));
        cm.configureAsset(BTC, true, false, p.ltv, p.liqThreshold, p.liqBonus, 100 ether);
        pool.setRiskParams(p.reserveFactor, p.originationFee, 10_000_000e18, 0, 10e18);

        registry.addMarket(
            MarketRegistry.Market({
                name: p.name,
                description: p.description,
                pool: address(pool),
                borrowManager: address(bm),
                collateralManager: address(cm),
                liquidationManager: address(lm),
                interestRateModel: address(irm),
                active: true
            })
        );

        d = Deployed({irm: address(irm), pool: address(pool), cm: address(cm), bm: address(bm), lm: address(lm)});
    }

    function _marketJson(string memory key, Deployed memory d) internal returns (string memory) {
        vm.serializeAddress(key, "interestRateModel", d.irm);
        vm.serializeAddress(key, "pool", d.pool);
        vm.serializeAddress(key, "collateralManager", d.cm);
        vm.serializeAddress(key, "borrowManager", d.bm);
        return vm.serializeAddress(key, "liquidationManager", d.lm);
    }
}
