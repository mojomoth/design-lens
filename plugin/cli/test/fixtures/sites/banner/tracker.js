// Decoy third-party tracker for the banner fixture. It is a no-op: its only purpose is to be a
// network-block target for `/tracker.js$script` and to be removed by the inert-sanitize pass.
// A real clone must never execute or retain this file.
window.__dlFixtureTracker = { loaded: true, pings: 0 };
