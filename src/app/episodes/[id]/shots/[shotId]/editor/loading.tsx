import { Sk, SkHeader, SkPage } from "@/components/Skeleton";

export default function Loading() {
  return (
    <SkPage>
      <SkHeader />
      <div className="flex flex-1 flex-col gap-3 px-4 py-4">
        <Sk className="min-h-64 w-full flex-1 rounded-xl" />
        <Sk className="h-12 w-full rounded-lg" />
      </div>
    </SkPage>
  );
}
