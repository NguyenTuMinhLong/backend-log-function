# Sequence Diagrams - Backend Log Function

Collection of sequence diagrams documenting the core business flows.

## Table of Contents

| Diagram | Description | File |
|---------|-------------|------|
| Auto-Refund | User request → Admin approve → Payment gateway → Complete | [01-auto-refund.md](01-auto-refund.md) |
| Date-Change | Request → OTP → Payment → Approve → Release/Reserve seats | [02-date-change.md](02-date-change.md) |
| Flight Combo | Mixed search with direct, 1-stop, 2-stop + roundtrip | [03-flight-combo.md](03-flight-combo.md) |
| Flight Season | Season/Holiday/Override detection with caching | [04-flight-season.md](04-flight-season.md) |

## Quick Reference

### Auto-Refund Status Flow
```
pending → approved → processing → completed
              ↓
          rejected
```

### Date-Change Status Flow
```
pending_otp → pending_payment → approved → completed
     ↓              ↓
   pending       (pay & auto-approve)
     ↓
  rejected/cancelled
```

### Season Priority
```
Override > Holiday > Season > 1.0 (off-peak)
```

### Flight Combo Types
- Direct (0 stops)
- 1-stop (A → X → B)
- 2-stop (A → X → Y → B)
- Roundtrip (cross-product of outbound × return)
