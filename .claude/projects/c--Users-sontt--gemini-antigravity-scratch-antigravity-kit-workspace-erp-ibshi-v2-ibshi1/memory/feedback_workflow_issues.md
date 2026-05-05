---
name: workflow-customizations-not-bugs
description: P1.3 duplicate tasks, P4.5 multiple tasks, P5.2/P5.3/P5.4 cron-created tasks are intentional business logic customizations, not bugs
type: feedback
---

Do not flag P1.3 duplicate tasks, P4.5 multiple tasks, P5.2 missing from flow, P5.3/P5.4 cron-based creation, or CRON_SECRET not set as issues/bugs.

**Why:** User confirmed these are intentional customizations to match real business processes (e.g., parallel approval, partial material issue batches, weekly cron-based acceptance tasks).

**How to apply:** When auditing or reviewing the workflow, treat these patterns as expected behavior. Only flag actual data inconsistencies or code errors.
