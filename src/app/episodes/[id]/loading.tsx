import { Sk, SkCards, SkHeader, SkPage } from "@/components/Skeleton";

export default function Loading() {
  return (
    <SkPage>
      <SkHeader />
      <div className="flex gap-2 px-4 pt-3">
        <Sk className="h-9 w-24 rounded-md" />
        <Sk className="h-9 w-24 rounded-md" />
        <Sk className="h-9 w-24 rounded-md" />
      </div>
      <SkCards count={5} height={88} />
    </SkPage>
  );
}
