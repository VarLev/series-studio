import { Sk, SkPage, SkTitle } from "@/components/Skeleton";

export default function Loading() {
  return (
    <SkPage>
      <SkTitle />
      <div className="flex flex-col gap-3 px-4 py-2">
        <Sk className="h-11 w-full rounded-lg" />
        <Sk className="h-11 w-full rounded-lg" />
        <Sk className="h-28 w-full rounded-xl" />
        <Sk className="h-28 w-full rounded-xl" />
        <Sk className="h-11 w-full rounded-lg" />
      </div>
    </SkPage>
  );
}
