import { Sk, SkGrid, SkHeader, SkPage } from "@/components/Skeleton";

export default function Loading() {
  return (
    <SkPage>
      <SkHeader />
      <div className="flex flex-col gap-3 px-4 py-4">
        <Sk className="h-11 w-full rounded-lg" />
        <Sk className="h-28 w-full rounded-xl" />
      </div>
      <SkGrid count={6} />
    </SkPage>
  );
}
