import { SkCards, SkPage, SkTitle } from "@/components/Skeleton";

export default function Loading() {
  return (
    <SkPage>
      <SkTitle />
      <SkCards count={5} height={72} />
    </SkPage>
  );
}
