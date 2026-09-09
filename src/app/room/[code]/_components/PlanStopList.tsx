import type { RefObject } from "react";
import type { Stop } from "@convex/lib/plans/stops";
import { Plate } from "@/components/questly/Plate";
import { Rail, RailEnd, RailNode } from "@/components/questly/Rail";
import { lockLine, proposalCard, proposalLine } from "@/lib/room/houseRules";
import { stopsDirectionsUrl, stopsEmbedUrl } from "@/lib/room/maps";
import type { RoomView } from "../page";
import { MapsLink } from "./MapsLink";

export type SheetTab = "ask" | "search";
type Plan = NonNullable<RoomView["plan"]>;
type ProposalId = RoomView["proposals"][number]["_id"];

/**
 * Read once at module scope, like `CONVEX_SITE` in `Deck.tsx`.
 *
 * A `NEXT_PUBLIC_` variable is inlined at build time, so this is a constant and
 * not a lookup -- which is why a missing key needs no loading state further
 * down. Absent, `stopsEmbedUrl` answers null and the plan renders without a map.
 */
const MAPS_BROWSER_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;

const time = (at: number) =>
  new Date(at).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
const money = (cents: number) => (cents === 0 ? "Free" : `$${Math.round(cents / 100)}`);
const SLOT_LABEL: Record<Stop["slot"], string> = { meet: "Meet", main: "Main", after: "After" };

export function PlanStopList({
  view,
  plan,
  headingRef,
  isGroup,
  lockByVote,
  mayLock,
  sheetFor,
  tab,
  options,
  queryText,
  reason,
  loading,
  sheetClosedBecause,
  setSheetFor,
  setTab,
  setOptions,
  setQueryText,
  setReason,
  openSheet,
  loadOptions,
  choose,
  toggleLock,
  castVote,
  focusAskedVote,
}: {
  view: RoomView;
  plan: Plan;
  headingRef: RefObject<HTMLHeadingElement | null>;
  isGroup: boolean;
  lockByVote: boolean;
  mayLock: boolean;
  sheetFor: string | null;
  tab: SheetTab;
  options: Stop[];
  queryText: string;
  reason: string;
  loading: boolean;
  sheetClosedBecause: string | null;
  setSheetFor: (value: string | null) => void;
  setTab: (value: SheetTab) => void;
  setOptions: (value: Stop[]) => void;
  setQueryText: (value: string) => void;
  setReason: (value: string) => void;
  openSheet: (stopId: string) => void;
  loadOptions: (stopId: string, which: SheetTab, text?: string) => Promise<void>;
  choose: (stopId: string, replacement: Stop) => Promise<void>;
  toggleLock: (stopId: string, locked: boolean) => Promise<void>;
  castVote: (proposalId: ProposalId, vote: "yes" | "no") => Promise<void>;
  focusAskedVote: (node: HTMLDivElement | null) => void;
}) {
  // Both null on a night the model named badly -- see `stopQuery`. The map and
  // the link then simply are not there, which is the whole of this feature's
  // failure handling and deliberately not more.
  const routeUrl = stopsDirectionsUrl(plan.stops);
  const embedUrl = stopsEmbedUrl(plan.stops, MAPS_BROWSER_KEY);

  return (
    <>
      <div>
        <p className="board text-[11px] text-accent">The plan</p>
        <h1 ref={headingRef} tabIndex={-1} className="display mt-2 text-[34px] text-text">
          {plan.stops.find((s) => s.slot === "main")?.name ?? "Your night"}
        </h1>
        <p className="mt-2 text-[13px] text-dim">
          <span className="num">{view.members.length}</span>{" "}
          {view.members.length === 1 ? "person" : "people"}, starting{" "}
          <span className="num">{time(view.room.whenAt)}</span>.
        </p>
        <p className="mt-2 text-[12px] leading-snug text-dim">
          {lockLine(view.room.lockRule, isGroup)}
        </p>
      </div>

      <div className="relative">
        <Rail drawing />
        <ol className="m-0 flex list-none flex-col gap-7 p-0">
          {plan.stops.map((stop, i) => {
            const proposal = view.proposals.find((p) => p.stopId === stop.id);
            return (
              <li key={stop.id} className="relative pl-14">
                <RailNode top={6} state={proposal ? "live" : stop.locked ? "locked" : "open"} />
                <p aria-live="polite" className="sr-only">
                  {proposal
                    ? `${proposalLine(
                        proposal.kind,
                        proposal.proposedByName,
                        stop.name,
                        proposal.replacement?.name ?? null,
                      )} ${proposal.yes} of ${proposal.needed} needed.`
                    : ""}
                </p>

                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p className="board text-[10px] text-accent">
                      {SLOT_LABEL[stop.slot]} · <span className="num">{time(stop.startAt)}</span>
                      {stop.locked ? (
                        <span className="ml-2 text-dim">
                          {stop.lockedBy ? `Locked by ${stop.lockedBy}` : "Locked"}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-[19px] leading-snug text-text">{stop.name}</p>
                    {stop.note ? (
                      <p className="mt-1 text-[13px] leading-snug text-dim">{stop.note}</p>
                    ) : null}
                  </div>
                  <p className="num shrink-0 text-[17px] text-text">
                    {money(stop.costPerHeadCents)}
                  </p>
                </div>

                <div className="mt-3 flex gap-2">
                  {!mayLock ? null : lockByVote ? (
                    proposal ? null : (
                      <Plate
                        variant="ghost"
                        label={stop.locked ? "Ask the room to unlock this" : "Ask the room to lock this"}
                        onClick={() => void toggleLock(stop.id, !stop.locked)}
                      />
                    )
                  ) : (
                    <Plate
                      variant="ghost"
                      selected={stop.locked}
                      label="Lock this stop"
                      onClick={() => void toggleLock(stop.id, !stop.locked)}
                    />
                  )}
                  {!stop.locked && !proposal ? (
                    <Plate
                      variant="ghost"
                      label={isGroup ? "Propose a change" : "Swap this stop"}
                      onClick={() => openSheet(stop.id)}
                    />
                  ) : null}
                </div>

                {proposal ? (
                  <div
                    ref={focusAskedVote}
                    data-stop-id={stop.id}
                    className="mt-3 rounded-[6px] border border-hairline p-3"
                  >
                    <p className="board text-[10px] text-accent">
                      {proposalCard(
                        proposal.kind,
                        proposal.proposedByName,
                        proposal.replacement?.name ?? null,
                      ).heading}
                    </p>
                    <p className="mt-1 text-[15px] leading-snug text-text">
                      {proposalCard(
                        proposal.kind,
                        proposal.proposedByName,
                        proposal.replacement?.name ?? null,
                      ).detail}
                    </p>
                    {proposal.reason ? (
                      <p className="mt-1 text-[13px] leading-snug text-dim">“{proposal.reason}”</p>
                    ) : null}
                    <p className="num mt-2 text-[13px] text-dim">
                      {proposal.yes} of {proposal.needed} needed
                    </p>
                    {stop.locked && proposal.kind === "swap" ? (
                      <p className="mt-2 text-[12px] leading-snug text-dim">
                        This stop is locked, so an accepted swap cannot be applied until it is
                        unlocked. A no still counts.
                      </p>
                    ) : null}
                    {proposal.yourVote === null ? (
                      <div className="mt-3 flex gap-2">
                        <Plate
                          variant="action"
                          center
                          label="Yes"
                          onClick={() => void castVote(proposal._id, "yes")}
                        />
                        <Plate
                          variant="ghost"
                          center
                          label="No"
                          onClick={() => void castVote(proposal._id, "no")}
                        />
                      </div>
                    ) : (
                      <div className="mt-3 flex flex-col gap-2">
                        <p className="text-[12px] text-dim">You voted {proposal.yourVote}.</p>
                        <Plate
                          variant="ghost"
                          label={proposal.yourVote === "yes" ? "Change it to no" : "Change it to yes"}
                          onClick={() =>
                            void castVote(proposal._id, proposal.yourVote === "yes" ? "no" : "yes")
                          }
                        />
                      </div>
                    )}
                  </div>
                ) : null}

                {sheetFor === stop.id ? (
                  <div className="mt-3 rounded-[6px] border border-hairline p-3">
                    <p aria-live="polite" className="text-[13px] leading-snug text-dim">
                      {sheetClosedBecause ?? ""}
                    </p>

                    {sheetClosedBecause ? (
                      <Plate
                        variant="ghost"
                        center
                        label="Close"
                        className="mt-3"
                        onClick={() => setSheetFor(null)}
                      />
                    ) : (
                      <>
                        <h2 className="board text-[10px] text-accent">Instead of {stop.name}</h2>

                        <div className="mt-3 flex gap-2">
                          <Plate
                            variant="raised"
                            selected={tab === "ask"}
                            label="Suggest something"
                            onClick={() => {
                              setTab("ask");
                              void loadOptions(stop.id, "ask");
                            }}
                          />
                          <Plate
                            variant="raised"
                            selected={tab === "search"}
                            label="Pick it yourself"
                            onClick={() => {
                              setTab("search");
                              setOptions([]);
                            }}
                          />
                        </div>

                        {tab === "search" ? (
                          <form
                            className="mt-3 flex gap-2"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void loadOptions(stop.id, "search", queryText);
                            }}
                          >
                            <label htmlFor={`q-${stop.id}`} className="sr-only">
                              Search for a place
                            </label>
                            <input
                              id={`q-${stop.id}`}
                              value={queryText}
                              onChange={(e) => setQueryText(e.target.value)}
                              placeholder="wine bar in Fitzroy"
                              className="min-h-[44px] flex-1 rounded-[5px] border border-hairline bg-transparent px-3 text-[16px] text-text"
                            />
                            <button
                              type="submit"
                              className="board min-h-[44px] shrink-0 rounded-[5px] border border-action-edge bg-action px-4 text-[11px] text-on-action"
                            >
                              Find
                            </button>
                          </form>
                        ) : null}

                        {isGroup ? (
                          <div className="mt-3 flex flex-col gap-2">
                            <label htmlFor={`why-${stop.id}`} className="board text-[10px] text-dim">
                              Why, in a few words (optional)
                            </label>
                            <input
                              id={`why-${stop.id}`}
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              maxLength={80}
                              placeholder="it is five minutes from the tram"
                              className="min-h-[44px] rounded-[5px] border border-hairline bg-transparent px-3 text-[16px] text-text"
                            />
                          </div>
                        ) : null}

                        <div aria-live="polite" className="mt-3 flex flex-col gap-2">
                          {loading ? <p className="text-[13px] text-dim">Looking…</p> : null}
                          {!loading && options.length === 0 ? (
                            <p className="text-[13px] leading-snug text-dim">
                              {tab === "search" ? "Type what you are after." : "Nothing came back. Try picking it yourself."}
                            </p>
                          ) : null}
                          {options.map((option) => (
                            <Plate
                              key={option.id}
                              variant="raised"
                              label={option.name}
                              sub={option.note}
                              right={money(option.costPerHeadCents)}
                              onClick={() => void choose(stop.id, option)}
                            />
                          ))}
                        </div>

                        <p className="mt-3 text-[12px] leading-snug text-dim">
                          Costs are estimates, not quotes.{" "}
                          {isGroup ? "Picking one puts it to the room." : "Picking one changes the plan."}
                        </p>

                        <Plate
                          variant="ghost"
                          center
                          label="Close"
                          className="mt-3"
                          onClick={() => setSheetFor(null)}
                        />
                      </>
                    )}
                  </div>
                ) : null}

                {i === plan.stops.length - 1 ? <RailEnd top={15} /> : null}
              </li>
            );
          })}
        </ol>
      </div>

      {/* The shape of the night, which the list above cannot draw. Three stops
          in sequence say nothing about whether they are next door or across
          town, and that is the question a group asks before agreeing to any of
          it.

          An IFRAME, not `@vis.gl/react-google-maps`, and the reason is the bill:
          the Maps Embed API is SKU 9C10-8313-F21F, unlimited at no charge, while
          the JS SDK that package loads is Dynamic Maps at $7 per 1000 loads past
          10k a month. Same route, same interactivity, one of them free. See
          `src/lib/room/maps.ts` for the full comparison.

          `loading="lazy"` so the plan paints before Google does -- this is the
          screen a room is trying to agree on and it must not wait on a third
          party. `referrerpolicy` is Google's own recommendation: it sends the
          origin so an HTTP-referrer key restriction can validate, without
          leaking which room is being planned. 240px clears the 200px minimum
          below which the Embed API refuses to render at all. */}
      {embedUrl ? (
        <iframe
          src={embedUrl}
          title="The three stops on a map"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          className="h-[240px] w-full rounded-[6px] border border-hairline"
        />
      ) : null}

      {/* The whole night, not one venue of it. `booking.deepLink` links the
          anchor quest alone, which is why the booked screen used to offer the
          night and show a single place. */}
      {routeUrl ? (
        <MapsLink
          href={routeUrl}
          className="board border border-hairline text-[11px] text-text"
        >
          Open every stop in Maps
        </MapsLink>
      ) : null}

      <div className="flex items-baseline justify-between border-t border-hairline pt-4">
        <p className="board text-[11px] text-dim">Est. per head</p>
        <p className={`num text-[24px] ${plan.overBudget ? "text-danger" : "text-text"}`}>
          {money(plan.totalPerHeadCents)}
        </p>
      </div>
    </>
  );
}
