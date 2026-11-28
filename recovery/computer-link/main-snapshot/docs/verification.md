# Verification checkpoint 2026-11-14

Linux source checkout: 8 unittest cases passed, including actual separate Python process malformed-line recovery, actual selected-volume disk capacity, no implicit workspace, unsupported-method refusal, duplicate registration and independent adapter removal. These are foundation tests, not Windows or remote desktop acceptance. Windows/Python matrix is configured for hosted CI and must be checked on its exact commit. No comparative performance result exists yet, and no upstream has been installed or executed.

Initial repository c3197a218b0d4411d501b429b9c6261b719b681f. Shared guidance is pinned from Agent-Foundry through the versioned manifest/lock; repository-specific guidance and skill remain local. Wiki Home was independently published through GitHub and observed with the creation confirmation. No runtime connector/grant was created.

## Retained hosted failure and repair

Run 43558212791 exposed an incorrect test assumption on Linux: total disk size need not equal used plus user-available bytes because blocks can be reserved. Actual values were154993672192 total versus154976894976 sum. The API now explicitly names available_bytes; the test checks raw values with a reserved-block fixture rather than misreporting all unused bytes as available. Nine tests pass locally after correction; new hosted run pending.
