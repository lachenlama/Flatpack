import Link from "next/link";
import { formatWif } from "../../lib/format.ts";
import { flywheelStats } from "../../lib/reads/flywheel.ts";
import s from "./layout.module.css";

/** Header burn counter ("🔥 12,345 $WIF burned"), a server component reading `flywheelStats()` (cached 15s). Links to /flywheel. */
export async function BurnCounter() {
  const stats = await flywheelStats();
  return (
    <Link href="/flywheel" className={s.burn} title="Total $WIF burned by Flatpack fees (from FeesHarvested and EpochSettled events)">
      <span aria-hidden="true">{"🔥"}</span>
      <span className="num">{formatWif(stats.burnedWif, { maxFraction: 0 })}</span> $WIF burned
    </Link>
  );
}
