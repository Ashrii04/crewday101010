import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Logo } from '@/components/layout/Logo'

// Shown in the privacy policy and used for data requests. Replace before publishing.
const PRIVACY_CONTACT_EMAIL = '[support email]'

function LegalShell({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-ink-50">
      <header className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <Link to="/">
            <Logo />
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-900"
          >
            <ArrowLeft size={16} aria-hidden /> Home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="font-display text-3xl font-extrabold text-ink-900">{title}</h1>
        <p className="mt-1 text-sm text-ink-500">Last updated {updated}</p>
        <div className="mt-8 space-y-6 text-ink-700 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-ink-900 [&_li]:ml-5 [&_li]:list-disc [&_p]:leading-relaxed [&_ul]:mt-2 [&_ul]:space-y-1.5">
          {children}
        </div>
      </main>
    </div>
  )
}

export function TermsPage() {
  return (
    <LegalShell title="Terms & Conditions" updated="18 September 2026">
      <section>
        <h2>1. About CrewDay</h2>
        <p>
          CrewDay is a platform for discovering and registering for social events, hobby meet-ups
          and activities. By creating an account you agree to these terms.
        </p>
      </section>
      <section>
        <h2>2. Your account</h2>
        <p>
          You are responsible for the accuracy of the details on your profile and for keeping your
          sign-in credentials secure. You must be old enough to enter a binding agreement in your
          jurisdiction, and you may not impersonate another person.
        </p>
      </section>
      <section>
        <h2>3. Registrations and tickets</h2>
        <ul>
          <li>A registration is personal to you and the QR code on it is single use.</li>
          <li>Seats are limited. Once an event reaches capacity, registration closes.</li>
          <li>
            You may cancel an upcoming registration from your ticket page; the seat is released to
            other members.
          </li>
          <li>
            Organisers may cancel or change an event. We will notify you in the app if that happens.
          </li>
        </ul>
      </section>
      <section>
        <h2>4. Paid events</h2>
        <p>
          Event prices are set by the organiser and shown before you register. A registration for a
          paid event is only confirmed once payment has been completed. Refunds for paid events are
          handled by the organiser under the terms shown on the event.
        </p>
      </section>
      <section>
        <h2>5. Conduct at events</h2>
        <p>
          Treat other attendees and organisers with respect. We may suspend or remove accounts that
          harass others, misuse tickets, or repeatedly register and fail to attend.
        </p>
      </section>
      <section>
        <h2>6. Liability</h2>
        <p>
          CrewDay connects people with events; it does not run every event listed. Attending an
          activity is at your own risk, and you are responsible for your own safety and belongings.
        </p>
      </section>
      <section>
        <h2>7. Changes</h2>
        <p>
          We may update these terms as the product grows. Significant changes will be announced in
          the app.
        </p>
      </section>
    </LegalShell>
  )
}

export function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="12 November 2026">
      <section>
        <p>
          This policy explains what the CrewDay app and website (crewday101010mm.vercel.app) collect,
          why, who receives it, and the choices you have. CrewDay is operated by its owner listed in
          the Contact section below.
        </p>
      </section>

      <section>
        <h2>1. Information we collect</h2>
        <ul>
          <li>
            <strong>Account:</strong> name and email address, from your sign-up form or your Google
            account if you sign in with Google. Your password is handled by Firebase Authentication;
            we never see or store it in plain text.
          </li>
          <li>
            <strong>Profile:</strong> phone number, city, area, interests, whether you join as a
            participant or audience, and an optional profile photo.
          </li>
          <li>
            <strong>Events:</strong> the events you register for, your ticket code, and whether you
            were checked in at an event.
          </li>
          <li>
            <strong>Device:</strong> a push-notification token if you allow notifications, so we can
            send you updates about events you registered for.
          </li>
          <li>
            <strong>Camera:</strong> used only when you open the QR scanner (for organisers checking
            in guests). Camera images are read on your device to decode the code and are not stored
            or uploaded.
          </li>
          <li>
            <strong>Usage analytics:</strong> anonymous counts of actions such as sign-ups and
            registrations. These events do not include your name, email or phone number.
          </li>
        </ul>
        <p>
          We do not collect your precise location. We do not collect sensitive personal data such as
          health, religion or financial account details.
        </p>
      </section>

      <section>
        <h2>2. How we use it</h2>
        <ul>
          <li>To create and run your account and profile.</li>
          <li>To show you events that match your interests and your area.</li>
          <li>To issue your ticket and let organisers verify it at the door.</li>
          <li>To send notifications about events you registered for or changes to them.</li>
          <li>To keep the app secure, fix problems and improve the product.</li>
        </ul>
        <p>We do not use your data for advertising, and we do not sell it.</p>
      </section>

      <section>
        <h2>3. Who sees your information</h2>
        <ul>
          <li>
            <strong>Other people:</strong> your email and phone number are never shown publicly. Your
            name and interests are visible to other attendees only as you set in Settings.
          </li>
          <li>
            <strong>Event organisers:</strong> when you register for an event, its organiser can see
            your name, email, phone number and check-in status, because they need these to run the
            event.
          </li>
          <li>
            <strong>Service providers:</strong> we use Google Firebase to host our data
            (Firestore, Storage, Cloud Functions), sign you in (Firebase Authentication, including
            Google sign-in), send notifications (Firebase Cloud Messaging) and collect anonymous
            usage analytics (Firebase Analytics). Google processes this data on our behalf under its
            terms and privacy policy.
          </li>
          <li>
            <strong>Legal reasons:</strong> we may disclose information if the law requires it.
          </li>
        </ul>
        <p>We do not share your personal data with advertisers or data brokers.</p>
      </section>

      <section>
        <h2>4. Your QR code</h2>
        <p>
          Your ticket QR code contains only a random registration token. It carries no personal
          information, so a photo of your ticket does not reveal your details.
        </p>
      </section>

      <section>
        <h2>5. How long we keep it</h2>
        <p>
          We keep your account and profile while your account is active. When you delete your
          account, we remove your personal details and sign-in and cancel your upcoming
          registrations. Past attendance is kept only as an anonymous count so organisers keep
          accurate event records. Backups may keep deleted data for a limited period before they are
          overwritten.
        </p>
      </section>

      <section>
        <h2>6. Your choices and rights</h2>
        <ul>
          <li>Edit your profile and privacy options in Settings at any time.</li>
          <li>Turn notifications off in your phone's settings or in the app.</li>
          <li>Delete your account from Settings.</li>
          <li>
            Ask us for a copy of your data, or to correct or delete it, by emailing the address in the
            Contact section. We will respond within 30 days.
          </li>
        </ul>
      </section>

      <section>
        <h2>7. Security</h2>
        <p>
          Data is sent over encrypted connections. Access is enforced by server-side security rules:
          a member can only read their own profile and registrations, and administrative data is
          restricted to authorised organiser accounts. No system is perfectly secure, so please keep
          your sign-in details private.
        </p>
      </section>

      <section>
        <h2>8. Children</h2>
        <p>
          CrewDay is for people aged 18 and over. We do not knowingly collect data from children. If
          you believe a child has given us information, contact us and we will delete it.
        </p>
      </section>

      <section>
        <h2>9. International transfers</h2>
        <p>
          Firebase stores data in the regions configured for our project, which may be outside your
          country. Google applies safeguards to such transfers under its privacy terms.
        </p>
      </section>

      <section>
        <h2>10. Changes to this policy</h2>
        <p>
          We will update this page when our practices change and show the new date at the top. For
          significant changes we will also tell you in the app.
        </p>
      </section>

      <section>
        <h2>11. Contact</h2>
        <p>
          Questions or requests about your data: <strong>{PRIVACY_CONTACT_EMAIL}</strong>. You can
          also use <strong>Report a problem</strong> in Settings.
        </p>
      </section>
    </LegalShell>
  )
}
