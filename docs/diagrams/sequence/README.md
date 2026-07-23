# Sequence Diagrams - Backend Log Function

Collection of sequence diagrams documenting the core business flows.

## Table of Contents

| Diagram | Description | File |
|---------|-------------|------|
| Auto-Refund | User request → auto/manual approval → refund execution → gateway outcome | [01-auto-refund.md](01-auto-refund.md) |
| Date-Change User Flow | Request → OTP → payment creation → payment confirmation/cancel | [02-date-change-user-flow.md](02-date-change-user-flow.md) |
| Date-Change Execution & Admin Flow | approve/reject/cancel → seat swap → booking update → embedded refund | [03-date-change-admin-flow.md](03-date-change-admin-flow.md) |

## Quick Reference

### Auto-Refund Status Flow
```
pending → approved → processing → completed
              ↓           ↓
          rejected     failed
```

### Date-Change User Flow
```
pending_otp → pending_payment → approved
     ↓              ↓
   pending       cancelled
     ↓
 approved / rejected / cancelled
```

### Date-Change Execution & Admin Flow
```
pending -> approved -> done
   ↓
rejected / cancelled
```

## Notes

- All diagrams are written in PlantUML for easier maintenance and export.
- Auto-refund remains separated from date-change, but date-change approval can still create an embedded refund record when the recalculated amount becomes refundable.
- These docs now follow the current service-level implementation and route naming more closely than the previous generalized version.
