# Conversation continuity and workspace alternatives

## Sources and comparable workflows

[Session Buddy](https://sessionbuddy.com/) documents tab/bookmark collections, history search and backup. [Tab Session Manager](https://chromewebstore.google.com/detail/tab-session-manager/iaiomicjabeggjcfkbimgmglanimpnae) documents window/tab restoration, tagged sessions and import/export. These are adjacent workflow references, not demonstrated substitutes for conversation capture.

## How this project should earn its place

Compare restoring a tab with restoring actual conversation evidence: mounted versus complete capture, revisions, attachment identity, interrupted capture, duplicate suppression and recovery after restart. Preserve privacy-conscious provider access and user-controlled recovery; benchmark large collections without claiming competitor data loss from missing documentation.

## Evidence and maintenance

Source review: 2026-11-12. Scope: documented capabilities and proposed evaluation criteria, not installed comparative tests or a latest-version certification. Unknown is not unsupported. No measured superiority is claimed.

For each meaningful upstream change, record the source URL, publication/version date, review date, affected workflow, licensing/access constraints, opportunity and reproducible acceptance test. Preserve last-good findings and failed tests. Recheck primary sources before implementation decisions; do not copy proprietary code/assets or change the product scope merely to match another tool. Proposed features remain proposals until authorized. Daily review should record no change honestly rather than invent updates.

## Next comparison pass

- [ ] Pin exact compared versions and representative workloads.
- [ ] Capture source evidence and verify applicable licenses.
- [ ] Measure current implementation before a replacement or optimization.
- [ ] Record correctness, usability, resource cost and recovery results together.
- [ ] Link only proven improvements to implementation milestones; retain unproven candidates as research.

## Reuse foundations and concrete parts to evaluate

[Tab Session Manager source](https://github.com/sienori/Tab-Session-Manager): inspect tab/session serialization and recovery logic; compare an adapter to a clean reimplementation. Session Buddy is workflow inspiration only unless licensing explicitly permits reuse.

## Integration with our projects

Noxviola supplies links to canonical issues and accepted evidence, not another copy of private chats. Agent-Foundry can consume a redacted continuity receipt schema: project ID, source revision, action, evidence status and recovery boundary.

## Target improvement and acceptance boundary

Show exact conversation/artifact recovery beyond merely reopening a URL. Test interruption, duplicate captures and restart with unchanged privacy scope; do not expand browser permissions automatically.

## License, access and adoption gate

Status: research candidate, not integrated or benchmark-proven. Before copying code, pin the exact upstream revision and record its LICENSE, dependency licenses, notices and distribution obligations. Missing/ambiguous terms block reuse; behavioral study or a permitted interoperable adapter may remain possible. Service documentation is not a source-code license or API grant. Preserve existing user permissions, private/public boundaries and creator/game asset rights.

Choose reuse, adapter, fork or independent implementation only after a target-workload comparison. Retain raw failures and rollback; share no credentials, private fixtures or account details. Adoption remains blocked until licensing, correctness, performance and maintenance cost are reviewed together. Review delta dated 2026-11-12.
