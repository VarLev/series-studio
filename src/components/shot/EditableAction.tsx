"use client";

import { useRef, useState } from "react";
import { updateShot } from "@/lib/actions/shots";

export default function EditableAction({
  shotId,
  initial,
  cameraHint,
}: {
  shotId: string;
  initial: string;
  cameraHint: string;
}) {
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => updateShot(shotId, { actionMd: next }), 900);
  }

  return (
    <div className="border-l-2 border-violet-600 pl-3">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.min(8, Math.max(3, value.split("\n").length + 1))}
        spellCheck={false}
        className="w-full resize-y bg-transparent font-body text-[15px] italic leading-relaxed text-t200 outline-none"
      />
      {cameraHint && (
        <div className="mt-1 font-mono text-[10.5px] text-t400">🎥 {cameraHint}</div>
      )}
    </div>
  );
}
