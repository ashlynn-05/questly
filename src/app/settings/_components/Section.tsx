import type { ReactNode } from "react";
import type { HelpTopic } from "@/lib/help";
import { Hint } from "@/components/questly/Hint";

export function Section({
  id,
  title,
  topic,
  children,
}: {
  id: string;
  title: string;
  topic?: HelpTopic;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section id={id} aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 border-b border-hairline pb-2">
        <h2 id={headingId} className="board text-[11px] text-accent">
          {title}
        </h2>
        {topic ? <Hint topic={topic} /> : null}
      </div>
      {children}
    </section>
  );
}

export function Field({
  htmlFor,
  label,
  topic,
  children,
}: {
  htmlFor: string;
  label: string;
  topic: HelpTopic;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={htmlFor} className="board text-[11px] text-accent">
          {label}
        </label>
        <Hint topic={topic} />
      </div>
      {children}
    </div>
  );
}
