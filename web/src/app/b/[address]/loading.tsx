import { Skeleton, SkeletonCard, SkeletonHead, SkeletonPage, SkeletonSplit, SkeletonTiles } from "../../../components/ui/Skeleton.tsx";

/** Basket page placeholder: title and lede, KPI tiles, then chart on the left and the buy panel on the right. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading basket">
      <SkeletonHead titleWidth="32%" />
      <Skeleton width={180} height={24} />
      <SkeletonTiles count={4} />
      <SkeletonSplit main={<SkeletonCard height={280} />} side={<SkeletonCard lines={5} />} />
    </SkeletonPage>
  );
}
