# Brief: Relay Operations management interface

Build a new responsive dispatcher queue for **Relay Operations**, using the provided local
reference as design research. This is a complete build request, including analysis and verification.
No existing project, assets or chosen variation: choose the direction that fits this brief.

Audience: dispatchers deciding which service request needs attention. Primary task: scan, find,
inspect and resolve work. Use original text and system fonts; no external assets or backend.

Render all eight supplied records, with owner, status, priority, subject and updated time visible
or clearly discoverable. Times are fixture labels, not a claim about the current clock.

| ID | Subject | Owner | Status | Priority | Updated |
|---|---|---|---|---|---|
| R-104 | Confirm arrival window | Mina | Open | High | 09:40 |
| R-105 | Replace the damaged access panel | Tomas | In progress | Normal | 09:32 |
| R-106 | Coordinate a revised delivery time with the building manager and the service crew before the afternoon access window closes | Jae | Open | High | 09:25 |
| R-107 | Send maintenance notes | Noor | Resolved | Low | 09:18 |
| R-108 | Check spare part availability | Mina | Open | Normal | 09:10 |
| R-109 | Review the follow-up visit | Tomas | In progress | Normal | 08:55 |
| R-110 | Confirm the replacement was received | Noor | Resolved | Low | 08:42 |
| R-111 | Assign an owner for tomorrow's inspection | Jae | Open | High | 08:30 |

Required behavior:
- Search by ID, subject or owner; combine with status filter (All, Open, In progress, Resolved).
- Show visible result count and status totals; update them after filtering or resolving.
- An empty result state offers **Reset filters** and restores the full queue.
- Open a record to inspect its details; offer **Mark resolved** for unresolved records. Update
  the status in the queue, the detail view and counts immediately. Offer a clear close action
  and keep keyboard focus usable. Resolving is in-memory only; reload restores fixture data.
- Include a visible **Local demo — changes reset on reload** note. No fabricated integrations,
  performance charts or invented data are required.

Verify 1440×900, 768×1024 and 390×844, the long supplied subject, search/filter combinations,
empty/reset, record details, resolving/count changes and keyboard focus. Keep DESIGN.md,
VARIATIONS.md and distinct verification images. Explain which principles transfer and how the
reference's editorial structure was adapted to support operational work.
