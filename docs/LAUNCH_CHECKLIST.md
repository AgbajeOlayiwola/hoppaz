# Public Launch Checklist

This checklist separates repository work from setup that requires the Hoppaz cloud
accounts, event operators, and real partner approvals.

## Cloud and credentials

- [ ] Create the production Supabase project and retain the database recovery details.
- [ ] Run `supabase/schema.sql` once against the clean project and review the SQL
  Editor result for errors. Do not load `supabase/seed.sql` in production.
- [ ] Enable anonymous sign-in and set the production Site URL and redirect URLs.
- [ ] Confirm the private `event-photos` bucket exists and that Storage, PostGIS,
  RLS, and Realtime are enabled.
- [ ] Configure Vercel Production variables: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
  `HOPPAZ_ADMIN_TOKEN`, `NEXT_PUBLIC_MAP_STYLE`, and `NEXT_PUBLIC_SUPPORT_EMAIL`.
- [ ] Set `NEXT_PUBLIC_SITE_URL` to the public https address (no trailing slash) in
  Production. Vercel supplies its own address, but the home page's link preview is
  fixed when the site is built, and on any other host it would point at
  `http://localhost:3000`. After deploying, view the home page source and check that
  the `og:image` tag is the public address. Event links are not affected (they use
  the address the page was served from). Then paste an event link and the home link
  into WhatsApp and X once, to see the preview card.
- [ ] Keep the service role key and admin token server-only. Use a strong unique
  admin token and share it only with authorized moderators.
- [ ] Configure a separate Supabase project for Preview deployments, or ensure
  Preview does not receive production credentials.
- [ ] Deploy and verify anonymous auth, maps, feeds, uploads, realtime chat, and
  server claim functions against the production domain.

## Content and safety

- [ ] Replace any test/fake events with verified, current Lagos event listings,
  correct venue coordinates, ticket links, prices, dates, and organizer contact.
- [ ] Confirm Hoppaz has permission to list each event and use each partner's name,
  logo, discounts, upgrades, and tickets.
- [ ] Configure the monitored privacy/support email and complete controller identity,
  retention, deletion, and privacy-request details in the public notice.
- [ ] Confirm moderators can review events, photos, quest evidence, and user reports.
- [ ] Test block/report handling and the account deletion flow with a disposable user.
- [ ] Set clear drop windows, claim radius, inventory, voucher codes, sponsor reward
  model, and in-person redemption instructions before publishing each drop.
- [ ] Review community rules, accessibility, and support coverage for launch hours.

## Release verification

- [ ] Run `npm run typecheck`, `npm run build`, and dependency audit in the release
  environment; review the results in the deployment record.
- [ ] Verify event check-in, quest evidence review, photo moderation, crew invites,
  meetup RSVPs, monthly report links, and event/neighborhood drop claims.
- [ ] Verify no service credentials, exact participant coordinates, or private
  photos appear in browser responses or public pages.
- [ ] Smoke-test the deployed app on a current mobile browser and desktop browser.
- [ ] Confirm Vercel rollback and Supabase backup/recovery procedures are understood.
- [ ] Before any real Hopper gets Play: check how long the Supabase plan keeps backups
  (deleted `play_fix` rows and box positions stay in a backup until it expires), write
  the number here, and keep the "Play and spawn alerts" section of the privacy page
  true to it. When the 48 hour blanking job (Phase 2) ships, say "48 hours" plainly there.

The schema and screens are prepared in the repository, but a real cloud project,
production credentials, verified content, partner approvals, and owner privacy details
must be supplied before the app can be called publicly live.
