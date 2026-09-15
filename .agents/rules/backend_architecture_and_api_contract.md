# Backend Architecture and API Contract

## 1. Backend model

Use Frappe and ERPNext as the authoritative application platform.

The default architecture is:

```text
DocType / ERPNext controller
    -> domain service
        -> query/selector helpers where needed
            -> thin whitelisted method or Page API
                -> frontend
```

Hooks coordinate lifecycle events. They should not become a hidden second service layer.

## 2. DocType responsibility

A DocType is the authority for:

- Schema
- Document lifecycle
- Standard validation
- Document-level permissions
- Workflow state
- Audit fields
- Standard persistence behavior

Do not create parallel JSON state or browser-only state as the authoritative record for an ERP transaction.

For standard ERPNext documents, extend through supported Frappe mechanisms rather than editing core.

Preferred extension tools include:

- `doc_events`
- `extend_doctype_class` where appropriate
- Custom Fields / Property Setters
- `doctype_js`
- `doctype_list_js`
- Workflows
- Permission Types
- Fixtures and patches where appropriate

Full class or method overrides are exceptional and require a compatibility reason.

## 3. Service layer

Business rules that span more than presentation should live in Python services or controller methods.

A service should:

- Validate inputs
- Load authoritative documents
- Check company/domain scope
- Check permissions or receive a clearly authorized internal context
- Perform business validation
- Call standard ERPNext lifecycle methods
- Return a stable business result

Do not duplicate a business rule in JavaScript and Python. JavaScript may provide early feedback, but Python is authoritative.

## 4. Query layer

For user-visible records, prefer permission-aware APIs such as `frappe.get_list` and standard document access.

Use `frappe.get_all`, Query Builder without normal permission filters, or raw SQL only when the server operation has a documented authorization model.

A query that can return cross-company or restricted data must define company and permission filters explicitly.

Do not assume that knowing a document name grants read permission.

## 5. Permission model

Server-side permission checks are mandatory for protected reads and state-changing actions.

Use:

- Standard DocPerm
- `doc.check_permission(...)`
- `frappe.has_permission(...)`
- Existing repository authorization helpers
- Frappe v16 Permission Types for domain actions such as approve, close, unlock, export-sensitive-data, or other action-specific rights when standard CRUD permissions are insufficient

The frontend may use permission information to hide unavailable actions. This is only a usability feature.

The server is the final authority.

### `ignore_permissions=True`

Do not use `ignore_permissions=True` for an ordinary user-initiated operation.

It is acceptable only when all of these are true:

- The code runs in a trusted server-controlled context or performs a deliberately privileged operation
- The caller's authorization has already been checked explicitly when a user initiated the operation
- The reason is documented near the call
- Company/document scope is still validated
- A normal permission-respecting lifecycle cannot satisfy the requirement

## 6. Whitelisted methods

Whitelisted methods are transport adapters, not the place for large business workflows.

A new method should be small:

1. Parse and validate input
2. Authorize
3. Call a service/controller
4. Map the result to a stable response

State-changing methods must use an appropriate state-changing HTTP method, normally POST.

Read-only methods may use GET.

Do not create multiple RPC endpoints for the same domain action only because different pages need it.

Reuse one domain service and, where compatible, one public API contract.

## 7. API contract

Every new frontend-facing method must define:

| Item | Requirement |
|---|---|
| Method path | Stable dotted path |
| HTTP method | GET for read, POST for mutation by default |
| Input | Named, validated fields |
| Output | Stable dict structure |
| Permission | Role/DocPerm/Permission Type |
| Company scope | Explicit when relevant |
| Side effects | Listed |
| Idempotency | Defined for retriable mutations |
| Errors | User-safe and actionable |
| Tests | Allowed, denied, invalid input, edge cases |

Preserve existing response shapes unless a migration/versioning plan exists.

A recommended new business payload is:

```python
{
    "ok": True,
    "data": {...},
    "warnings": [],
    "meta": {...},
}
```

Frappe will still transport a returned value using its standard response behavior.

Do not add wrapper layers only for aesthetic consistency if they would break existing clients.

## 8. Transactions

Use the request transaction managed by Frappe.

Do not call `frappe.db.commit()` inside ordinary request/service code unless the transaction boundary has a specific documented reason.

State-changing API requests should either complete coherently or fail coherently.

For multiple related document changes:

- Validate first where possible
- Use standard document lifecycle methods
- Do not partially commit halfway through an operation without a recovery design
- Raise an error on invariant failure so the request can roll back

## 9. Idempotency

A mutation must be idempotent or explicitly protected from duplicate execution when retries, double-clicks, queue retries, or network uncertainty can repeat it.

Typical strategies:

- Detect existing linked transaction
- Use unique keys
- Store a source operation ID
- Check current workflow state
- Make repeated synchronization calculate the same desired state

Lifecycle hooks that can fire more than once must be safe to re-enter.

## 10. Background jobs

Use `frappe.enqueue` for long-running or expensive work that should not block web workers.

Use `enqueue_after_commit=True` when a background job depends on data written by the current transaction.

A background job must:

- Be safe to retry
- Revalidate current document state
- Avoid trusting stale frontend input
- Log useful context without secrets
- Record user-visible status when users need to track completion

Do not send a state-changing job before the transaction it depends on has committed.

## 11. Hook discipline

`hooks.py` is a high-conflict registry.

Keep each hook entry declarative.

Hook targets should call small, testable functions.

Do not place business logic directly in `hooks.py`.

Before adding a new `doc_events` handler, inspect existing handlers for the same DocType and event.

Frappe hook resolution can depend on app order. Avoid override hooks when an extension hook can solve the requirement.

## 12. ERPNext lifecycle

For accounting, stock, purchasing, payroll, and other ledger-affecting domains:

- Prefer standard document save/submit/cancel methods
- Read the relevant ERPNext controller before extending the lifecycle
- Do not write ledger tables directly
- Do not fake submitted state by changing `docstatus`
- Do not create browser-only approval state
- Validate linked document state on the server

## 13. Validation ownership

Validation that protects data integrity belongs on the server.

Frontend validation may improve speed and clarity but must not be the only validation.

Examples that must be server-authoritative:

- Company scope
- Permission
- Period lock
- Document status
- Quantity/amount invariants
- Duplicate business transaction checks
- Required evidence
- Approval rights
- Finalization/closing conditions

## 14. Error model

Use clear domain errors.

A user-facing error should identify:

- What action could not complete
- The business object when safe
- Why it failed
- What the user can do next

Do not return secrets, tokens, SQL, or raw internal traceback in a custom payload.

Use Frappe exception mechanisms for request failures rather than returning `ok: false` for conditions that should abort the transaction.

## 15. Compatibility

Before changing a public method:

- Search all repository call sites
- Search Client Scripts and Pages
- Search scheduled jobs
- Search tests
- Check external integrations documented in the repository

Prefer additive compatible changes.

If a breaking change is required, document the migration and update all clients in the same change.

## 16. Backend acceptance checklist

Before completion verify:

- Standard Frappe/ERPNext lifecycle is preserved
- Server permission exists for each protected action
- Company scope is enforced
- No unnecessary `ignore_permissions`
- No unnecessary `get_all`
- No direct ledger writes
- No duplicate public endpoint
- Mutation uses appropriate HTTP method
- Transaction boundary is coherent
- Retriable action is idempotent or duplicate-safe
- Hook is small and safe
- Background jobs are retry-safe
- Existing clients remain compatible
- Tests include denied permission and invalid state
