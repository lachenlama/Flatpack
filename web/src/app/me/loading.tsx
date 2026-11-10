import { SkeletonHead, SkeletonPage, SkeletonRows, SkeletonTiles } from "../../components/ui/Skeleton.tsx";

/** Portfolio placeholder: title and lede, KPI tiles, then position rows. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading portfolio">
      <SkeletonHead titleWidth="26%" />
      <SkeletonTiles count={3} />
      <SkeletonRows rows={4} cols={3} />
    </SkeletonPage>
  );
}
