# Signal support delivery

Home has a headset button next to X and Telegram. It opens `/support`.
Tickets are delivered through the dedicated Signal Support bot to the private
dev-team Telegram channel/group. Telegram is the ticket record; no additional
public inbox, automated replies or status tracking are included in this version.

## Required configuration

In Cloudflare Worker `signal-platform`, Settings → Variables and Secrets:

- Secret `SIGNAL_SUPPORT_BOT_TOKEN`: token from BotFather for `@SignalChainpadSupportBot`.
- Secret `SIGNAL_SUPPORT_CHAT_ID`: the numeric ID of the dev-team channel/group,
  for example `-100…`. Never use a public username as the destination.

The bot needs Post Messages for a channel. The destination must be private:
no public username or active public usernames. Change the channel type in
Telegram if needed before enabling delivery. Leave the main public community
chat and the existing website Telegram link unchanged.

Obtain the numeric ID using Telegram's official `getUpdates` API after a
new channel post or the bot's membership update, with the token entered only
in a trusted local setup tool, not in chat or a shared browser URL. Do not
forward private team messages to third-party chat-ID bots.

The `SUPPORT_RATE_LIMITER` binding is included in `wrangler.jsonc` with a
dedicated namespace, three attempts per IP per minute per Cloudflare location.
Preview and production secrets must be configured for the intended environment.
Support fails closed without configuration. GET availability exposes only a boolean.

## Validation

Build the site and run `node --test apps/web/tests/support-tickets.test.mjs`.
Before publishing, confirm a ticket from the preview is delivered to the intended
private channel, displays its reference and contact, and that the website reports
that same reference. A simulated test is not proof of live Telegram delivery.

Delivery success requires Telegram's actual sendMessage receipt. No automatic
retries are made: a network timeout can occur after Telegram accepted a message.
Contact the team before resending an unconfirmed ticket. This version has no
durable idempotency store, so a manual resubmission can create another ticket.
Submitted page URLs omit query strings/fragments. Ticket details never enter logs.
User text is sent without Markdown/HTML parsing, with link previews disabled.

## Current state

The bot was created and Post Messages permission configured by the user.
The token, numeric destination ID and live delivery test still need configuration.
Production publishing requires approval of this support feature.
