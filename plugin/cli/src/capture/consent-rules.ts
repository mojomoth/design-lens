/**
 * design-lens's built-in generic consent ruleset (ADR-012).
 *
 * WHY this exists. The default remote list, fanboy-cookiemonster, is superb at the long tail —
 * ~15 000 generic cosmetic rules — but it deliberately carries NO generic rule for the two most
 * ordinary consent containers, `.cookie-banner` and `#consent`. It scopes those to specific domains
 * (`ft.com###consent`, `sellme.ee##.cookie-banner`, …) because an adblocker hiding an element on
 * every site on the web must be conservative. design-lens is not an adblocker: it photographs ONE
 * page the user explicitly asked to clone, where an over-removed cookie bar costs nothing and a
 * surviving one ruins the reference. So we prepend a small curated ruleset of unambiguous consent
 * containers, and it is also what remains when the remote list cannot be downloaded — consent
 * blocking degrades to "fewer rules", never to "no rules".
 *
 * These are uBlock-syntax GENERIC cosmetic rules (`###id` / `##.class`). They are matched by the
 * same engine, through the same `PlaywrightBlocker.parse(text)` path, as every other list — nothing
 * here special-cases any site or fixture (specs/09-fixture-contract.md forbids that), and every
 * selector below names a consent UI and nothing else.
 *
 * Spec: specs/02-clone-engine.md §M2 (Consent blocking); ADR-012.
 */

export const BUILTIN_CONSENT_RULES = [
  '! design-lens built-in generic consent rules (ADR-012). Prepended to the default remote list.',
  '! Ids',
  '###cookie-banner',
  '###cookie-bar',
  '###cookie-notice',
  '###cookie-consent',
  '###cookie-policy-banner',
  '###cookiebanner',
  '###cookieconsent',
  '###gdpr-banner',
  '###gdpr-consent',
  '! Classes',
  '##.cookie-banner',
  '##.cookie-bar',
  '##.cookie-notice',
  '##.cookie-consent',
  '##.cookie-popup',
  '##.cookie-notification',
  '##.cookies-banner',
  '##.consent-banner',
  '##.consent-popup',
  '##.gdpr-banner',
  '##.gdpr-consent',
  // The container class of `cookieconsent`/Osano, one of the most widely deployed consent widgets.
  '##.cc-window',
  '',
].join('\n');
