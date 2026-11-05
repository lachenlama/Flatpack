import type { HardhatUserConfig } from "hardhat/config";
import { configVariable } from "hardhat/config";
import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";

const RH_RPC_URL = process.env.RH_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";

const config: HardhatUserConfig = {
  plugins: [hardhatToolboxViem],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
          evmVersion: "cancun",
          optimizer: { enabled: true, runs: 200 },
        },
      },
    },
  },
  paths: {
    sources: "src",
    tests: { solidity: "test" },
  },
  test: {
    solidity: {
      fuzz: { runs: 1000 },
      invariant: { runs: 256, depth: 64, failOnRevert: false },
      // fork tests call vm.createSelectFork("robinhood") and are named test_F_* (see docs/TEST-PLAN.md)
      forking: { rpcEndpoints: { robinhood: RH_RPC_URL } },
    },
  },
  networks: {
    // Robinhood Chain is an Arbitrum Orbit chain, hence chainType "generic"
    robinhood: {
      type: "http",
      chainType: "generic",
      chainId: 4663,
      url: configVariable("RH_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
    robinhoodFork: {
      type: "edr-simulated",
      chainType: "generic",
      forking: { url: RH_RPC_URL },
    },
  },
};

export default config;
