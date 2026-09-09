import type { RefObject } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { AVATAR_TYPES } from "@convex/lib/account/avatar";
import { initialsFor } from "@/lib/account/avatar";
import { Hint } from "@/components/questly/Hint";
import { Plate } from "@/components/questly/Plate";
import { Input } from "@/components/ui";
import { Field, Section } from "./Section";

type User = Exclude<FunctionReturnType<typeof api.auth.getCurrentUser>, null | undefined>;
type Profile = FunctionReturnType<typeof api.profiles.me>;

export function SettingsProfileSection({
  user,
  profile,
  displayName,
  busy,
  saved,
  uploading,
  fileInput,
  setName,
  setSaved,
  saveName,
  uploadAvatar,
  removeAvatar,
}: {
  user: User;
  profile: Profile | undefined;
  displayName: string;
  busy: boolean;
  saved: boolean;
  uploading: boolean;
  fileInput: RefObject<HTMLInputElement | null>;
  setName: (value: string) => void;
  setSaved: (value: boolean) => void;
  saveName: () => Promise<void>;
  uploadAvatar: (file: File | null) => Promise<void>;
  removeAvatar: () => Promise<void>;
}) {
  return (
    <Section id="you" title="You">
      <p className="text-[15px] leading-snug text-text">{user.email ?? user.name}</p>

      <div className="flex items-center gap-4">
        <span
          className="board flex size-[44px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-action-edge bg-action text-[11px] text-on-action"
          aria-hidden="true"
        >
          {profile?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatarUrl} alt="" className="size-full object-cover" />
          ) : (
            initialsFor(profile?.displayName ?? user.name ?? user.email)
          )}
        </span>

        <div className="flex flex-1 flex-wrap items-center gap-3">
          <label
            htmlFor="avatar"
            className="board flex min-h-[44px] cursor-pointer items-center rounded-[6px] bg-ground-raised px-4 text-[11px] text-text"
          >
            {uploading ? "Uploading…" : profile?.avatarUrl ? "Change picture" : "Add a picture"}
          </label>
          <input
            id="avatar"
            type="file"
            className="sr-only"
            accept={AVATAR_TYPES.join(",")}
            ref={fileInput}
            disabled={uploading}
            onChange={(e) => void uploadAvatar(e.target.files?.[0] ?? null)}
          />

          {profile?.avatarUrl ? (
            <button
              type="button"
              onClick={() => void removeAvatar()}
              disabled={uploading}
              className="flex min-h-[44px] min-w-[44px] items-center px-1 text-[13px] text-dim underline underline-offset-4"
            >
              Remove
            </button>
          ) : null}
        </div>

        <Hint topic="picture" />
      </div>

      <Field htmlFor="display-name" label="Display name" topic="name">
        <Input
          id="display-name"
          value={displayName}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          maxLength={40}
          autoComplete="name"
        />
      </Field>
      <Plate
        variant="raised"
        center
        label={busy ? "Saving…" : saved ? "Saved" : "Save name"}
        disabled={busy || !displayName.trim() || displayName.trim() === profile?.displayName}
        onClick={() => void saveName()}
      />
    </Section>
  );
}
