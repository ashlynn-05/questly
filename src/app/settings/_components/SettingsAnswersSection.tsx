import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { QUIZ_CARDS, QUIZ_GOALS } from "@convex/lib/quiz";
import { groupAnswers } from "@/lib/answers";
import { Plate } from "@/components/questly/Plate";
import { Section } from "./Section";

type Profile = FunctionReturnType<typeof api.profiles.me>;

export function SettingsAnswersSection({ profile }: { profile: Profile | undefined }) {
  return (
    <Section id="answers" title="Your answers" topic="answers">
      {profile === undefined ? (
        <p className="text-[13px] text-dim">Looking…</p>
      ) : profile === null ? (
        <p className="text-[13px] leading-snug text-dim">
          Nothing yet. Until you take the quiz, rooms are ranked on budget, distance and mood
          alone.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-5">
            {groupAnswers(QUIZ_CARDS, profile.answers).map((group) => (
              <div key={group.key} className="flex flex-col gap-1.5">
                <h3 className="board text-[11px] text-dim">{group.label}</h3>
                <ul className="flex flex-col gap-1.5">
                  {group.cards.map((card) => (
                    <li key={card.id} className="text-[15px] leading-snug text-text">
                      {card.text}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1.5 pt-1">
            <h3 className="board text-[11px] text-dim">What the night is for</h3>
            {profile.goals && profile.goals.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {QUIZ_GOALS.filter((g) => profile.goals?.includes(g.id)).map((g) => (
                  <li key={g.id} className="text-[15px] leading-snug text-text">
                    {g.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[15px] leading-snug text-dim">Nothing in particular.</p>
            )}
          </div>
        </>
      )}

      <Plate variant="raised" center href="/start?retake=1" label="Retake the quiz" />
    </Section>
  );
}
