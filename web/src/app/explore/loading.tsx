import { SkeletonHead, SkeletonPage, SkeletonRows } from "../../components/ui/Skeleton.tsx";

/** Explore placeholder: title and lede, then ruled table rows. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading baskets">
      <SkeletonHead titleWidth="30%" />
      <SkeletonRows rows={7} cols={4} />
    </SkeletonPage>
  );
}
