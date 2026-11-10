import { formatWif } from "../../lib/format.ts";
import { flywheelStats } from "../../lib/reads/flywheel.ts";
import { Flame } from "./Flame.tsx";
import s from "./layout.module.css";

/** Header burn counter (flame mark + "12,345 $WIF burned"), a server component reading `flywheelStats()` (cached 15s). */
export async function BurnCounter() {
  const stats = await flywheelStats();
  return (
    <span className={s.burn} title="Total $WIF burned by Flatpack fees (from FeesHarvested and EpochSettled events)">
      <Flame />
      <span>
        <span className="num">{formatWif(stats.burnedWif, { maxFraction: 0 })}</span> $WIF<span className={s.burnWord}> burned</span>
      </span>
    </span>
  );
}
