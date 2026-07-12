import { SkCards, SkPage, SkTitle } from "@/components/Skeleton";

export default function Loading() {
  return (
    <SkPage>
      <SkTitle />
      <SkCards count={6} height={64} />
    </SkPage>
  );
}
