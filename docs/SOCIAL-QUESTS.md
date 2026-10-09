# Social quests: what we can really verify

Feedback note for Jae and Ola. Written 9 October 2026. Covers Game Plan section 7 (Brand quests) and open item 8.

How to read this. The research read the official developer docs on 9 October 2026. Nobody made a live API call, because we have no credentials yet. Anything marked TEST needs a live check before we promise it to a brand. Prices and rules for X and Meta have moved a lot in 2026, so check again before launch.

## 1. The verdict in five bullets

1. **In-person actions are the strongest proof we have.** Check-in, venue QR, in-app photo with a vision check, and referral conversion are all checked inside Hoppaz. They cost almost nothing and cannot be faked from a couch. Zealy and Galxe cannot offer this. This stays the core.
2. **X is the one platform we can verify well.** Follow, repost, quote, reply and "post with a hashtag or mention" are all checkable through the X API. Likes are checkable only in a narrow way. Cost is about 1 to 7 US cents per person. X has no free tier any more: it is pay per use since 6 February 2026.
3. **Instagram is half possible, and only through the brand.** The brand connects its Business or Creator account. Then we can see comments, @mentions, tagged photos and story mentions. Follow is checkable only if the person sends the brand a DM first. Likes and reposts cannot be checked at all. Meta's API is free, but approval for other brands' accounts takes weeks.
4. **TikTok, YouTube and Spotify are weak for brand quests.** TikTok can check a user's own posts for a hashtag, but not follow, like or repost. YouTube is technically easy, but its policy bans rewards for subscribing, liking or commenting. Spotify is closed to a small app and also bans rewards for follows.
5. **The biggest risk is not technical. It is platform rules.** X's developer policy has a "Pay to engage" rule that, as one researcher read it, bans paying people with money or virtual rewards for X actions, including follows, reposts and likes. Meta's spam rules ban trading rewards for likes and follows. The account that gets flagged would be Hoppaz's app. We need a lawyer's read before real brand money rides on follows and likes.

## 2. Quest actions by platform

Key:
- **API** = Verified by API. The person signs in with the platform (OAuth) and we check with their own token.
- **BRAND** = Verified by API, but the brand must connect its account to Hoppaz first.
- **PROOF** = Proof link or screenshot. Checked by a vision model, with a review queue. Forgeable, so cap the reward.
- **NO** = Not possible to verify.

Costs are per check, from official prices on 9 October 2026. "Free" means no fee, but quotas and approval apply.

| Action | X | Instagram | TikTok | YouTube | Spotify |
|---|---|---|---|---|---|
| Follow an account | **API**, $0.01. Also **BRAND** event, $0.01 | **BRAND**, free. Person must DM the brand first | **PROOF** | **API**, free, 1 quota unit | API, but closed to us (see below) |
| Like a post | **API** only with the person's own consent (like.read), about $0.001 to $0.005. Fragile. Treat as lowest trust | **PROOF** (no read endpoint) | **PROOF** | **API**, free (getRating). Person can unlike later | n/a |
| Repost or retweet | **API**, about $0.01 per reposter, one batch pass per post. Or **BRAND** event, $0.005 | **PROOF**. Use a story mention instead | **PROOF** | n/a | n/a |
| Quote or reply | **API**, $0.005 per post found | **BRAND** for replies on the brand's own comments and stories, free | **PROOF** | n/a | n/a |
| Comment on a brand post | **API** (a reply), $0.005 | **BRAND**, free, real time by webhook | **BRAND**, free, but needs TikTok business onboarding and is unconfirmed | **API**, free, 1 unit per page | n/a |
| Post with a hashtag | **API**, $0.005 per post found | Hashtag alone: **NO** per person. Hashtag plus @brand: **BRAND** | **API** (the person's own videos, caption only, 150 character cap), free | **API**, free (video descriptions) | n/a |
| Post that mentions the brand | **API** or **BRAND** event, $0.005 | **BRAND**, free. Person's account must be public | **API** for the person's own caption. Brand mentions feed is partner gated | **API**, free | n/a |
| Story mention | n/a (X has no stories) | **BRAND**, free. Person's account must be public or follow the brand. Proves it happened, not that it stayed up | **NO** | n/a | n/a |
| Join or subscribe | **NO** (Communities show counts only) | **NO** (broadcast channels), WhatsApp Channel and Community **NO** | n/a | **API**, free (subscribe) | n/a |
| Watch | **NO**. Fallback: reply with a code word shown in the video | **NO** | **NO** (only a person's own video views) | **NO**. Fallback: code word | **NO** |

Notes that matter:
- **WhatsApp** works for one thing: a "message us" handshake. The person taps a link with a code, and the webhook gives us their number. This proves they control that number. Inbound messages are free. Replies inside 24 hours become billable from 1 October 2026 (rates to confirm).
- **Private accounts.** On X and TikTok, private posts are invisible to us. On Instagram, private accounts trigger no mention webhooks, except story mentions when they follow the brand.
- **Deleted posts and unfollows.** Nothing tells us. We must re-check before paying out.
- **Spotify** needs 250,000 monthly users for real access. Development mode allows only 5 allowlisted users. Drop it.
- **YouTube policy** bars incentives for viewing, liking, sharing, subscribing or commenting. Use it for XP at most.
- **Nigeria.** We found no country block on any of these APIs. X is available in Nigeria again since January 2022. Nigerian naira cards often fail on US web charges, so plan on a USD or virtual card to buy X credits (TEST). Meta Business Verification needs company papers. A CAC certificate is the obvious one, but we could not confirm Meta accepts it.

## 3. Recommended v1 brand quest types

Cheapest trustworthy set. Build in this order.

**Tier 1: Verified by Hoppaz (brand rewards allowed)**
- Say you are going to the event.
- Check in at the venue (server-verified location).
- Scan the sponsor's venue QR.
- Photo task taken in the app after check-in ("snap the DJ", "snap a picture with four people"). A cheap vision model checks it. Low confidence goes to the review queue.
- Referral that converts: a friend signs up, buys a ticket or checks in. Unique discount codes per person are the cleanest proof for the brand.
- Recap photo, only after a verified check-in.

**Tier 2: Verified by X (our one strong social platform)**
- Follow the brand on X.
- Repost the announcement.
- Quote or reply with a code word.
- Post with the event hashtag or tag the brand.
- Release the reward only after a re-check 3 to 7 days later.
- Gate these on the policy question in section 7 below. Until it is answered, show the verified tick and give XP and badges, and keep brand-funded rewards on Tier 1.

**Tier 3: Verified through the brand's Instagram (after Meta approval)**
- Comment a code word on the brand's post.
- Story mention or tagged photo.
- Follow, using the DM handshake: "DM the word HOP to @brand."
- Pilot with Blockfest and South Social as app testers while review is pending.

**Tier 4: XP only, never brand-funded**
- Instagram and TikTok follow, like or repost by screenshot.
- Any like.
- Any watch.
- Facebook, YouTube, Spotify, WhatsApp Channel or Community joins.
- Shares and invites. This matches the Game Plan guardrail already in place.

**What to avoid**
- Scraping, or third-party "check follow" APIs. They add a second policy risk.
- Promising "verified" in marketing for anything in Tier 4.
- Requiring identical post text. Platforms read that as manipulation.
- Scanning follower lists on X. At $0.01 per follower, a 50,000-follower brand costs about $500 per full scan.
- Any prize draw without an NLRC permit.
- Requesting write scopes (posting, following or liking for the person). We only read.

Swap "like the post" for "comment CODE", and "repost" for "story mention" or "quote with a code". These are far easier to prove.

## 4. Cost per month at small scale

These are estimates from official unit prices. Check against the first real invoice.

| Item | Small month (300 people, one X quest) | Busy month (2,000 people, follow + like + repost) |
|---|---|---|
| X: person signs in, we check | about $10 to $20 | $60 to $140 |
| X: re-checks after 3 to 7 days | about $3 | about $20 |
| X: if the brand also connects (events) | about $6 instead of the first line | about $40 instead |
| Vision checks (Groq), 5 photos each | about $4.50 | about $30 |
| Instagram, TikTok, YouTube APIs | $0 | $0 |
| WhatsApp handshake (inbound) | $0 | $0 |
| **Total** | **about $20 to $30** | **about $110 to $190** |

Plain facts:
- X charges per item returned, once per UTC day. Credits are bought upfront. Set a spending limit. A zero balance blocks every call.
- New X accounts may get a $20 credit when they save a first card, plus a match up to $50 on the first auto recharge (rolling out since 2 October 2026).
- A vision check is about $0.002 to $0.003 per image on Groq (Qwen 3.8 27B at $0.80 per million input tokens). Confirm the model is still listed.
- Pass the API cost to the brand per verified action. It is small next to the reward value. Zealy does the same through credits, and charges about $0.09 to $0.14 for a three to five action X quest.
- The real costs are time and approvals, not API fees. Meta app review takes 4 to 8 weeks including one rejection cycle (unofficial estimate).

## 5. Build steps

1. **Link accounts with OAuth.** One "Connect" button per platform, each asking for the smallest scope.
   - X: OAuth 2.0 with PKCE. Start with `tweet.read` and `users.read`, plus `offline.access` so we can re-check. Ask for `follows.read` only on follow quests and `like.read` only on like quests. Store the numeric user id, never the handle.
   - TikTok: Login Kit with `user.info.basic`, `user.info.profile`, `video.list`. App review needs a demo video. About 3 days to 2 weeks (secondary source).
   - Instagram, for the brand: Business Login for Instagram. Scopes `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages`.
   - YouTube and Spotify: skip for v1.
   - Supabase has an X OAuth 2.0 provider, but we could not confirm it can request extra scopes or keep refresh tokens. Build a separate "Connect X" flow and store tokens encrypted on the server.
2. **Identity binding.** Link once, then match every event to the stored id. For Instagram, the person DMs a one-time code to the Hoppaz account. We store their Instagram id and username.
3. **Webhooks.** Add a public HTTPS route on the Next.js host. X needs a CRC check and a reply within 10 seconds. Meta needs a live app, retries for only 36 hours and then drops the event, and stores nothing. Save every payload as evidence. Deduplicate.
4. **Verification service.** One function per action that returns verified, not verified or unsure, with a timestamp and the evidence id. Store ids, flags and timestamps, not platform content. X requires deleting content within 24 hours when it is removed. Meta forbids storing story media.
5. **Review queue.** One queue for screenshots, photo-task failures and low-confidence vision results. Use the existing screenshot and photo flow where it fits. Add the checks already in the Game Plan: handle must match the linked account, fresh timestamp, near-duplicate image catch across all submissions, random spot checks.
6. **Brand dashboard.** The brand connects its X and Instagram accounts, deposits reward codes before the quest goes live, and sees verified counts.
7. **Delayed payout.** Hold reward codes until a re-check passes (follow with `connection_status`, repost with the reposted-by list).
8. **Anti-sybil.**
   - One linked account per Hopper, per platform. One Hopper per social account.
   - Verified email and phone OTP.
   - Minimum account age and follower floor on the linked social account. X returns `created_at` and `public_metrics`.
   - Reward caps per person.
   - Real-world proof (check-in) required for the larger rewards.
9. **Meta paperwork, start now.** Business Verification, Tech Provider Access Verification and App Review. Hoppaz's own Instagram account needs none of this, so we can launch with that while we wait.
10. **Test first, half a day, with a funded X dev app.**
    - `connection_status` returns "following" for a known follow.
    - `liked_tweets` ordering, depth and price.
    - Whether X follow events need the brand to sign in.
    - Repost list depth on a post with over 1,000 reposts.
    - A Nigerian or virtual card can pay for credits.
    - Instagram follow flag in the DM handshake, including delay for new followers.

## 6. In-person quests stay the core

Jae asked about task checking, photo quests and "four people in a picture". These work, and they are the best part of the offer.

- **Check in.** Location checked on the server. No platform needed.
- **Venue QR.** Signed, short-lived, single-use tokens, checked against the server-side location.
- **Photo at the venue.** Taken inside the app after check-in, so it cannot be an old photo or a screenshot. A vision model checks the task. Four people, the DJ, the sponsor's banner. About $0.003 per image. Low confidence goes to a human.
- **Group photo.** Same flow. The vision model counts faces. Reject near-duplicates across all submissions.
- **Referral.** Per-person link or code. Count it when the friend signs up, buys or checks in.

Why this wins for brands: Zealy and Galxe verify tweets and follows. They cannot say a person stood in the venue. Hoppaz can. Social quests are the wrapper around that, not the proof.

Our wider pitch can say: "Every reward is paid for something Hoppaz saw happen." Keep it true by labelling Tier 4 actions as XP only.

## 7. Open questions

1. **X "Pay to engage" rule.** One researcher found the text: services may not pay money or virtual rewards for X actions, listed as posts, follows, reposts, likes, comments and replies. It was live in an archived copy from 3 January 2026. On 15 January 2026 X's head of product said apps that reward users for posting would lose access. Zealy and Galxe still sell X follow and repost quests with XP and token rewards, and we found no report of them being cut off. Another researcher read X's giveaway guidance as only "risky", not banned. These disagree. Ask a lawyer, and ask X for written guidance.
2. **Meta rewards rules.** Meta's spam standard bans trading anything of value for likes and follows. Instagram promotion guidelines are described differently by different sources, and Meta's help page would not load. Read it directly. Also, a brand's own promotion terms should carry the usual disclaimer that it is not endorsed by Instagram.
3. **Who runs the promotion?** If the brand runs and funds it and Hoppaz only verifies, exposure may shift to the brand. A lawyer should say.
4. **Paid post disclosure.** Nigerian advertising rules on rewarded posts are not researched. X added a `paid_partnership` label field on 3 June 2026.
5. **Does an X follow event need the brand to sign in?** The docs are unclear.
6. **Instagram follow check.** Can it be repeated after the 24-hour message window? Does a story mention count as the first message? Does a new follower show up fast?
7. **X private likes.** Is `liked_tweets` deep enough to see yesterday's like on page one?
8. **Meta Business Verification in Nigeria.** Will a CAC certificate be accepted?
9. **TikTok business API.** Can a small developer get Mentions access? Does the business user id match the Login Kit id?
10. **Pricing drift.** X moved from subscriptions to pay per use in 2026, and Basic and Pro migration dates are reported, not official. Recheck before we quote brands.
11. **"XABS".** The Game Plan names it as Absinthe's X check. We could not find it anywhere public. Absinthe's own site says it is winding down. Jae to confirm what it was.
12. **Vision price on Groq.** Only one vision model is listed in October 2026 docs. Confirm before building.

## 8. Sources

All read on 9 October 2026 unless noted. "Secondary" means a vendor or blog summary, not official docs.

**X**
- docs.x.com/x-api/getting-started/pricing (pay per use, unit prices)
- docs.x.com/x-api/fundamentals/rate-limits
- docs.x.com/x-api/activity/introduction and event-payloads (webhook events)
- docs.x.com/x-api/posts/likes/introduction; retweets; quote-tweets; search (endpoints and limits)
- api.x.com/2/openapi.json, v2.170 (connection_status, scopes)
- docs.x.com/changelog (6 Feb 2026 pay per use; 16 Apr 2026 write removals; 4 May 2026 search change)
- docs.x.com/developer-guidelines (giveaways marked risky)
- docs.x.com/developer-terms/policy and web.archive.org copy dated 3 Jan 2026 (Pay to engage)
- x.com/nikitabier/status/2011825522817270230 (15 Jan 2026 announcement, reported)
- docs.x.com/x-api/getting-started/free-credits (credits, rolling out from 2 Oct 2026)
- Secondary: devcommunity.x.com posts on private likes (June 2024) and Basic/Pro migration; bankless.com on the January 2026 reward-app ban

**Meta**
- developers.facebook.com/documentation/instagram-platform (overview, rate limits, webhooks, mentions)
- .../messaging-api/user-profile (is_user_follow_business)
- .../business-messaging/instagram-messaging/features/story-mention
- .../instagram-platform/changelog (22 Apr 2026 changes) and graph-api/changelog (v26.0, 29 Jul 2026)
- .../release/access-verification (Tech Provider, about 5 days after Business Verification)
- .../whatsapp/pricing and business-scoped-user-ids (service messages billable from 1 Oct 2026)
- transparency.meta.com/policies/community-standards/spam (last updated 26 Jun 2024)
- developers.facebook.com/terms (updated 3 Feb 2026)
- Secondary: bundle.social App Review estimate; manychat community on follow flag lag; contedy.com and woobox.com on promotion rules (they conflict)

**TikTok, YouTube, Spotify**
- developers.tiktok.com/doc (Display API, scopes, video list, rate limits, app review, content posting, research API, webhooks)
- developers.google.com/youtube/v3/docs (subscriptions.list, videos.getRating, commentThreads.list), quota cost page, revision history, developer policies (III.F.3.c) and policy guide
- developer.spotify.com/documentation/web-api (quota modes, February 2026 migration guide, check-library-contains) and developer.spotify.com/policy
- Secondary: techcrunch.com 6 Feb 2026 on Spotify developer mode; Cision help page on TikTok mentions

**Quest platforms and tools**
- zealy.io/pricing and zealy.io/docs/tasks/twitter (credit costs, AI review)
- help.galxe.com, article dated 10 Aug 2026 (authentic verification credits; like unsupported)
- questn.gitbook.io/docs, sweepwidget.com/docs, gleam.io FAQ (search-indexed text only, Cloudflare blocked)
- console.groq.com/docs/vision and /models (vision price)
- absinthe.network (wind-down notice)
- Secondary: api.sorsa.io and docs.socialdata.tools (third-party X check APIs, not recommended)
- Hoppaz Game Plan, section 7 and section 16 item 8, in this repo
