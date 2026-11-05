import type { Address } from "viem";
import { basketAbi } from "../../../../shared/abi/index.ts";
import { cached } from "../../lib/cache.ts";
import { getDeployment } from "../../lib/deployment.ts";
import { getEventLogs } from "../../lib/reads/events.ts";
import { countHolders } from "./holders.ts";

type TransferArgs = { from: Address; to: Address; value: bigint };

/**
 * Number of addresses holding a positive balance of a basket's shares, derived from `Transfer` logs (no indexer).
 * The zero address and the FeeHarvester (which holds fee shares until it redeems them) are not counted. Cached 60s.
 * @returns undefined when the logs cannot be read
 */
export function holderCount(basket: Address): Promise<number | undefined> {
  return cached(`holders:${basket.toLowerCase()}`, 60_000, async () => {
    try {
      const logs = await getEventLogs<TransferArgs>(basket, basketAbi, "Transfer");
      const harvester = getDeployment().addresses.FeeHarvester.toLowerCase();
      return countHolders(logs.map((l) => l.args), [harvester]);
    } catch {
      return undefined;
    }
  });
}
