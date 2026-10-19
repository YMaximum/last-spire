# Player patch notes

Players open **What’s new · patch notes** from expedition setup or the main menu, or **What’s new** from Settings. The draggable, resizable information window leaves combat running and uses native expandable sections for earlier updates. It never opens automatically over a run.

Edit `src/content/patch-notes.ts` in the same PR as a player-visible change. Keep entries newest first, use stable descriptive IDs, describe the resulting behavior, and explain whether existing expeditions keep older rules. Group related fixes rather than listing implementation commits. Do not advertise unimplemented features or claim a merged change has already been deployed. Notes travel with the checked build, so the public game shows only the history included in its release.

Dates and software version labels are intentionally omitted from the initial history: review/merge dates are not production publication dates. Do not use the save schema or the package version as a release identifier. Add accurate release labels only when the release process establishes them.

Keep operational details, private infrastructure, player identities, saves, and QA logs out of player notes. Reading notes creates no new profile fields and requires neither an account nor a network request. Only normal device-local window geometry may be remembered by the existing window manager.
