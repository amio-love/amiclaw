/* Shared external-link constants for the platform package.
   Single source of truth so any component (Game Lab tile, footer link, …)
   imports the same value instead of hard-coding it. */

/* Discord community invite. Empty-string sentinel = not yet configured:
   callers MUST treat '' as "no link" and keep their placeholder (non-clickable)
   state, so the empty value is a zero-regression no-op.
   TODO: the user will replace '' with the real invite, e.g.
   'https://discord.gg/xxxx'. */
export const DISCORD_INVITE_URL = ''
