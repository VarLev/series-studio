import { SkCards, SkPage, SkTitle } from "@/components/Skeleton";

export default function Loading() {
  return (
    <SkPage>
      <SkTitle />
      <SkCards count={7} height={56} />
    </SkPage>
  );
}
