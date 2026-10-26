# Business branding, greetings and owner updates

This release adds sourced business artwork and details to Studio concepts, an
automatic device-voice welcome, a business-domain email option, and owner email
and Telegram updates. These features have separate connection and delivery
states: code being available does not mean an account is linked or a message has
been received. See [DEPLOYMENT.md](DEPLOYMENT.md) for the current hosted release
and [INSTALLATION-REPORT.md](INSTALLATION-REPORT.md) for verified connections.

## Business logos, photographs and location

Open **Studio → Website concept** for a researched business. Creating a concept
now checks its recorded official website for public branding and facts. Existing
concepts can use **Find logo, photos & details** to check again and create a new
private revision. **Evidence & contact** shows the same source summary alongside
the existing contact review.

The importer looks for a logo, up to three business photographs, a public
business description, address, phone number and service names. It reads website
HTML, image references and structured business data; it does not execute the
website's scripts or treat webpage text as instructions. Each captured image
records its source, dimensions and hash. The dashboard lists sources; the
concept itself embeds the captured image bytes, so visitors do not hotlink the
business's image server or load third-party image trackers.

Only usable PNG, JPEG and WebP images are accepted. SVG logos, unreadable sites,
JavaScript-only galleries, private content, oversized images and unsupported
formats may leave gaps. The importer has a bounded request/time/size allowance,
uses public HTTPS addresses, checks redirects and DNS, and rejects private
network targets. It does not pay an image-search service or substitute an
unrelated logo from a search result. A cached profile can be reused for seven
days; the explicit refresh action checks again.

If a logo or photo is unavailable, the concept keeps its business name and
labelled original illustration. If a street address was not found, Studio shows
the recorded research locality as such. It does not invent an address, services,
reviews, accreditation, staff, prices or project outcomes. A sourced page can
still be outdated or describe the wrong business, so check the source against
the intended prospect before sharing.

Public availability does not establish copyright ownership or permission to
reuse artwork. The importer records this limitation. If the source page contains
an explicit copying/reproduction restriction detected by the importer, it skips
downloading the logo and photographs and explains why; use authorised assets or
obtain permission instead. This check is a limited text detector, not a complete
licence review. The free template licences cover the referenced template code;
they do not grant rights to a prospect's logo or photographs.

Refreshing branding creates a new HTML hash and email revision. Any earlier
review no longer approves that revision. Concepts remain labelled independent
and unofficial, with private owner previews until the exact publication or send
action is approved. The existing [outreach approval and contact eligibility
rules](CLIENT-ACQUISITION.md) still apply.

## Automatic welcome without AI credits

The **Welcome voice** bar appears after owner sign-in. With **Auto on**, Jarvis
attempts one fixed welcome for that sign-in, using morning/afternoon/evening in
Melbourne time. Changing screens does not keep repeating the welcome. **Auto
off** saves the preference on that device; **Speak greeting** is an explicit
replay and **Stop welcome** stops its current speech.

Open **Voice** to choose an available device/browser voice. Automatic selection
prefers an installed Australian English voice, then another installed voice. The
operating system or browser supplies this speech. Jarvis makes no model request,
spends no AI tokens and makes no ElevenLabs request for the greeting. Some
browser-provided voices can use the browser vendor's service; choose an installed
voice when available if local playback matters.

The welcome works while the signed-in app is open. iPhone/Safari and some other
browsers require a trusted tap before speech; use **Speak greeting** when the
bar requests it. It is not an always-listening wake word and cannot greet from a
closed app or override iOS background restrictions. Microphone use, command
speech and other playing media take priority over the welcome. Explicit
ElevenLabs playback remains a separate action that can consume its credits.

## Send from outside Gmail

Open **Studio → Sender settings** and choose **Own business email · Resend**.
Both supported connections can already send *to* recipients at any email
provider. Resend adds sending *from* a domain you own without Google sign-in.
Your existing inbox can remain with Microsoft 365, Fastmail, Zoho or another
mailbox host; Resend handles outbound submission and does not create or read that
inbox.

1. Use an existing domain you control and a working sender inbox on that domain.
2. Add that exact domain in [Resend](https://resend.com/domains), add its displayed
   verification DNS records at the domain host, and wait for **Verified**.
3. Create a Resend API key with permission to read verified domains and send
   emails. Save it privately as `RESEND_API_KEY` in the existing Jarvis Railway
   service. Do not paste it into chat or the sender identity form.
4. Set `ATLAS_OUTREACH_FROM` to the exact authorised sending address. Deploy the
   pending Railway variable changes.
5. Choose Resend in Studio and confirm that the domain check reports connected.
   Save the matching sender name, organisation, email and genuine contact
   details. Review each exact prospect email before sending.

The protected **business-domain email setup guide** in Sender settings explains
the same steps. Selecting an option alone does not authenticate it. The app does
not silently fall back to a different provider if the selected connection fails.
Changing the provider requires another exact review.

Resend cannot authorise an arbitrary `@outlook.com`, `@icloud.com` or
`@gmail.com` sender. Direct Microsoft/Outlook OAuth sign-in is not part of this
release. A Microsoft 365 mailbox on a domain you control can receive replies to
mail sent through the verified-domain connection above. No SMTP configuration
or Railway Pro upgrade is needed; submission uses HTTPS.

## Owner email and phone messages

Open **Devices → Keep me informed**. Owner updates are separate from prospect
outreach and do not approve an email or publish a website. Both channels start
disabled. Connecting a channel does not enable delivery or send a test by itself.

For owner email:

1. Connect and select the verified sender in **Studio → Sender settings** using
   Gmail or Resend as described above.
2. Enter your own recipient under **My email for updates**. This recipient can
   use any email provider.
3. Enable **Email me action alerts** and save preferences.
4. Select **Send me a test email** when you want a real test submission.

For free Telegram messages:

1. In Telegram, open the verified [@BotFather](https://t.me/BotFather), send
   `/newbot`, and follow its prompts to create your bot.
2. Open your new bot and press **Start** in your own private chat.
3. Obtain your positive numeric private chat/user ID. The setup panel links to
   [@userinfobot](https://t.me/userinfobot), a third-party helper which receives
   your interaction with it; never send that helper your bot token.
4. In Jarvis's **Connect free Telegram messages** panel, enter the bot token in
   the private password field and your own numeric private chat ID. Select
   **Verify private connection**. Jarvis checks the bot and private chat using
   read-only Telegram operations. Groups and channels are rejected.
5. Enable **Message me action alerts**, save preferences, and choose **Send me a
   test message** when ready.

The bot token is encrypted in the server's persistent store using a key derived
from the owner access key, and is never returned by the settings API. Changing
that key can require relinking. Telegram verification checks the selected bot
and private target; it does not independently prove who controls that chat. Use
your own ID and confirm receipt with the explicit test. **Disconnect Telegram**
disables the Jarvis connection; revoke the token through BotFather separately
if required.

Telegram bot chats are cloud messages, not end-to-end encrypted secret chats.
SMS, WhatsApp and phone calls are not enabled by this setup. Paid telephony
needs a separate connected provider and its own setup.

With a channel enabled, new action-needed and critical events can send a generic
owner alert directing you to the private dashboard. Routine events stay on the
dashboard. Enable **Include a daily summary after 9 am Melbourne time** to send
one preparation summary per Melbourne day through the enabled channels. It runs
on the next background check after 09:00 while the host is running; it is not a
guaranteed delivery exactly at 09:00.

The summary reports candidate, private-concept and review counts. These are
preparation counts, not customers, revenue or sales. Outbound owner updates do
not include customer identities, payment details or untrusted webpage/email
text. Delivery has durable event deduplication, a limit of twenty submissions
per channel per Melbourne day across tests, alerts and digests, and one attempt
per job. Repeated test clicks within the same minute reuse the same event.
Ambiguous submissions do not automatically retry. **Recent owner updates** shows
recorded outcomes; provider acceptance does not establish inbox delivery, phone
receipt or owner acknowledgement.

## Costs and remaining setup

The welcome and official-site artwork lookup make no paid AI calls. Telegram
bot messages use Telegram's ordinary bot service. Resend and Gmail remain
subject to their current account quotas and policies; check provider limits
before enabling delivery. No domain, mailbox, subscription or SMS service is
purchased automatically. The A$300 experiment ceiling is unchanged, and hosting
or provider bills are not automatically reconciled into the app's budget.

The owner's domain/DNS access, sender credentials, Telegram bot/chat and enabled
preferences are necessary for real deliveries. Local browser checks and mocked
provider tests verify behaviour without establishing live connections or
sending actual messages. Use the app's connection status and the explicit owner
test buttons to verify an account after setup.
