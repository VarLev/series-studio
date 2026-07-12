import { Sk, SkCards, SkPage, SkTitle } from "@/components/Skeleton";

export default function Loading() {
  return (
    <SkPage>
      <SkTitle />
      <div className="flex gap-2 px-4 pb-4">
        <Sk className="h-10 w-24 rounded-md" />
        <span className="flex-1" />
        <Sk className="h-10 w-28 rounded-md" />
      </div>
      <SkCards count={4} height={82} />
    </SkPage>
  );
}
