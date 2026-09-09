"use client";

import { Plate } from "@/components/questly/Plate";
import { usePush } from "@/hooks/usePush";
import { Section } from "./Section";

/**
 * Turn notifications on and off, and prove they work.
 *
 * `id="notifications"` is public API, not decoration: the test notification's
 * own tap target is `/settings#notifications`, and the account menu already
 * deep-links to `#leaving` the same way.
 *
 * Unlike its neighbours this section holds its own state rather than taking it
 * as props. Every piece of that state is a browser fact -- the permission, the
 * service worker registration, whether THIS device holds a subscription -- and
 * none of it exists on the server or matters to any other section. Threading it
 * up to the page would be threading through a component that cannot read it.
 *
 * The toggle is a `Plate` with `selected`, which is what makes it announce as
 * `aria-pressed`. There is no Switch in this codebase and this does not add
 * one.
 */
export function SettingsPushSection() {
  const push = usePush();

  return (
    <Section id="notifications" title="Notifications" topic="push">
      {push.publicKey === undefined ? (
        <p className="text-[13px] text-dim">Looking…</p>
      ) : push.publicKey === null ? (
        // The deployment has no VAPID keys. Said plainly rather than drawn as a
        // broken toggle: the feature genuinely does not exist here, and that is
        // a fact about the deployment rather than anything this person did.
        <p className="text-[13px] leading-snug text-dim">
          Notifications are not switched on for this deployment yet.
        </p>
      ) : !push.supported ? (
        <p className="text-[13px] leading-snug text-dim">
          This browser cannot receive notifications.
        </p>
      ) : push.iosNeedsInstall ? (
        // The one platform rule worth a sentence. On iOS there is no web push
        // in a Safari tab at all, so a toggle here would be a control that can
        // never work -- and the fix is a thing the person can actually do.
        <p className="text-[13px] leading-snug text-dim">
          On an iPhone or iPad, notifications work once Questly is on your home screen. Add it from
          Safari&rsquo;s Share menu, open it from there, and this will be waiting.
        </p>
      ) : (
        <>
          <Plate
            variant="raised"
            selected={push.subscribed}
            label={
              push.busy
                ? "One moment…"
                : push.subscribed
                  ? "Notifications are on"
                  : "Turn notifications on"
            }
            sub={
              push.subscribed
                ? push.deviceCount > 1
                  ? `On this device, and ${push.deviceCount - 1} other.`
                  : "On this device."
                : "Room filled, everyone matched, plan written, night booked."
            }
            onClick={() => void (push.subscribed ? push.disable() : push.enable())}
          />

          {/* Only once there is something to test. Offered before subscribing it
              would send to nothing and report success. */}
          {push.subscribed ? (
            <Plate
              variant="ghost"
              label={push.busy ? "Sending…" : push.sent ? "Sent" : "Send a test notification"}
              sub="Goes to every device you have turned this on for."
              onClick={() => void push.test()}
            />
          ) : null}

          {/* The section's own live region, mounted empty so what arrives in it
              is actually announced. Separate from the page's because this
              section owns its own mutations and the page never sees them. */}
          <p role="alert" className="text-[13px] leading-snug text-danger empty:hidden">
            {push.error ?? ""}
          </p>
        </>
      )}
    </Section>
  );
}
