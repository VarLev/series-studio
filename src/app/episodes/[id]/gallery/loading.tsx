import { SkGrid, SkHeader, SkPage } from "@/components/Skeleton";

export default function Loading() {
  return (
    <SkPage>
      <SkHeader />
      <SkGrid count={12} />
    </SkPage>
  );
}
