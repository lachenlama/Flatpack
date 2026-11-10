import { SkeletonCard, SkeletonHead, SkeletonPage } from "../../components/ui/Skeleton.tsx";

/** Assemble placeholder: title and lede, then the first form cards. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading the assembly form">
      <SkeletonHead titleWidth="34%" />
      <SkeletonCard lines={4} />
      <SkeletonCard lines={3} />
    </SkeletonPage>
  );
}
