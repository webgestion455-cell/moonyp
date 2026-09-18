# KYC — corrective phase

- [x] Disable automatic acceptance from client evidence; fail missing MRZ/liveness; regression tests (27 passed).
- [x] Fix assessment signature, OCR timing and unavailable-result presentation (source changes; end-to-end blocked below).
- [x] Use stored applicant identity for submitted-document comparisons; check decision writes.
- [x] Translate client decision messages in 15 languages; audit script passes. Full site translation audit remains outside completed scope.
- [ ] BLOCKED: end-to-end database/camera/admin validation: preview reports missing database environment configuration.
- [ ] BLOCKED: independent document authenticity, face matching, address/bank statement extraction require a contracted verification service and authorized credentials; none is connected. Do not represent local OCR as bank-grade verification.