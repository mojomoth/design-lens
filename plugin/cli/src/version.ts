/**
 * Single source of truth for the product version.
 *
 * MUST equal `package.json` "version" and both plugin manifests (spec 00-product §Product
 * identity: `design-lens --version` output is identical to the manifest versions). The strict
 * gate's S4 asserts this lock, and the clone provenance stamp (T27) reads it. Hard-coded (rather
 * than read from package.json at runtime) so the CJS bundle carries no filesystem lookup.
 */
export const VERSION = '0.1.0';
