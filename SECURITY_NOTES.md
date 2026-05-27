# Security Notes — Firestore Rules Audit

Audit date: 2026-05-27
Rules source: CLAUDE.md (documented deployed rules)
Action: Read-only audit. No rules were modified.

---

## Findings

### 1. Rules match CLAUDE.md documentation

The rules documented in CLAUDE.md were reviewed against the security architecture
decisions table. The following issues were previously identified and marked as fixed
in the SPA:

- **Note list cross-user access** — Fixed: `allow list` requires `resource.data.userId == request.auth.uid`
- **Tier/status self-promotion** — Fixed: `noPrivilegeEscalation()` on update; create locks tier to `free`, status to `active`

### 2. No `groqApiKey` field in profileValid()

The `profileValid()` function in the documented rules does not include `groqApiKey`
in its field allowlist. If the client writes `groqApiKey` directly to Firestore
(bypassing Next.js API routes), it would be rejected by the `keys().hasOnly()`
check — or the field is absent from the validator, meaning it could silently pass.

**Recommendation:** Confirm that `groqApiKey` is either:
(a) included in `profileValid()` with a size limit, or
(b) only written via a server-side API route that validates it separately.

Do NOT auto-fix this — it requires checking the live deployed rules.

### 3. `patientProfiles` subcollection has no field validation

```
match /users/{userId}/patientProfiles/{profileId} {
  allow read:   if owns(userId);
  allow write:  if owns(userId);
  allow delete: if owns(userId);
}
```

No `profileValid()`-equivalent function guards patient profile writes.
Any authenticated user can write arbitrary fields and sizes to their own
patient profiles. This is low risk (users can only write to their own data)
but could allow storage of unexpectedly large documents.

**Recommendation:** Add a `patientProfileValid()` function with field size limits
when patient profile fields are finalised.

### 4. `deletion_feedback` allows creation but not deletion

```
match /deletion_feedback/{docId} {
  allow create: if verified() && request.resource.data.userId == request.auth.uid;
}
```

Deleted users cannot remove their own feedback document after account deletion
(since they are no longer authenticated). This is intentional for audit purposes
but worth noting.

### 5. No rate limiting in Firestore rules

Firestore rules do not enforce request rate limits. Rate limiting is now handled
at the API route layer (`lib/rateLimit.ts`) for the three AI endpoints.
Direct Firestore SDK calls from the client (profile reads, note saves) are not
rate-limited beyond Firebase's own internal quotas.

**Recommendation:** Monitor Firestore read/write quotas in the Firebase console.
Client-side rate limiting of direct Firestore calls is out of scope for this layer.

---

## Summary

| Finding | Severity | Action |
|---|---|---|
| groqApiKey not in profileValid() | Medium | Verify against live rules before next deployment |
| patientProfiles has no field validation | Low | Add validator when fields are finalised |
| deletion_feedback not deletable by user | Informational | Intentional — no action needed |
| No Firestore-level rate limiting | Informational | Mitigated by API route rate limiting |
