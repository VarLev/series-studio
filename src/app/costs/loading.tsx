import { Sk, SkCards, SkPage, SkTitle } from "@/components/Skeleton";

export default function Loading() {
  return (
    <SkPage>
      <SkTitle />
      <div className="flex gap-2 px-4">
        <Sk className="h-20 flex-1 rounded-xl" />
        <Sk className="h-20 flex-1 rounded-xl" />
      </div>
      <SkCards count={4} height={56} />
    </SkPage>
  );
}
