import { Sk, SkHeader, SkPage } from "@/components/Skeleton";

export default function Loading() {
  return (
    <SkPage>
      <SkHeader />
      <div className="flex flex-col gap-3 px-4 py-4">
        <Sk className="h-24 w-full rounded-xl" />
        <Sk className="h-40 w-full rounded-xl" />
        <div className="flex gap-2">
          <Sk className="h-24 w-24 shrink-0 rounded-lg" />
          <Sk className="h-24 w-24 shrink-0 rounded-lg" />
          <Sk className="h-24 w-24 shrink-0 rounded-lg" />
        </div>
        <Sk className="h-32 w-full rounded-xl" />
      </div>
    </SkPage>
  );
}
