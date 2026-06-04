# Auto-Refund Flow - Sequence Diagram

```mermaid
sequenceDiagram
    participant C as Controller<br/>refund.controller
    participant S as Refund Service
    participant DB as PostgreSQL
    participant OTP as OTP Store<br/>(In-Memory)
    participant MAIL as Mailer
    participant PG as Payment Gateway<br/>(PayPal/PayOS/MoMo)
    participant LOYALTY as Loyalty Service
    participant NOTIF as Notification Service
    participant ADMIN as Admin Panel

    %% ========== USER REQUEST ==========
    User->>C: POST /refunds/user<br/>{bookingCode, reason}
    C->>S: requestRefund(userId, bookingCode, data)
    S->>DB: SELECT_BOOKING_DETAIL(bookingCode)
    S->>DB: SELECT_PAYMENT_BY_BOOKING(bookingId)
    S->>S: validateRefundRequest()
    S->>DB: CHECK_PENDING_REFUND_FOR_BOOKING(bookingId)
    S->>S: findPolicy(hoursLeft)<br/>calculateRefundAmount()
    
    alt Original bill >= OTP threshold
        S->>S: isOTPVerified(email)
        alt NOT verified
            S-->>User: Error: OTP required
        end
    end
    
    alt netRefund < 1M VND
        S->>S: status = 'approved'
    else netRefund >= 1M VND
        S->>S: status = 'pending'
    end
    
    S->>DB: INSERT_REFUND
    S->>DB: UPDATE_BOOKING_STATUS('refund_pending')
    S-->>User: {refundCode, status}

    %% ========== ADMIN APPROVE ==========
    alt Status = 'pending' (need manual approve)
        ADMIN->>C: POST /admin/refunds/:code/approve
        C->>S: approveRefund(adminId, refundCode)
        S->>DB: SELECT_REFUND_BY_CODE(refundCode)
        S->>S: validate status = 'pending'
        S->>DB: UPDATE_REFUND_STATUS('approved')
        S->>NOTIF: createRefundNotification('REFUND_APPROVED')
    end

    %% ========== ADMIN PROCESS (call PG) ==========
    ADMIN->>C: POST /admin/refunds/:code/complete
    C->>S: processRefund(adminId, refundCode)
    S->>DB: SELECT_REFUND_BY_CODE(refundCode)
    S->>DB: UPDATE_REFUND_STATUS('processing')
    
    alt PayPal
        S->>PG: refundPayPalCapture(captureId)
        PG-->>S: refundId
    else PayOS/MoMo
        S-->>S: Mark MANUAL_RECONCILIATION
    end
    
    S->>DB: UPDATE_REFUND_COMPLETED
    S->>DB: UPDATE_BOOKING_STATUS('refunded')
    S->>DB: UPDATE_PAYMENT_STATUS('REFUNDED')
    S->>LOYALTY: revokePointsForRefund()
    S->>NOTIF: createRefundNotification('REFUND_COMPLETED')
    S-->>ADMIN: {success, refundCode}

    %% ========== ADMIN REJECT ==========
    ADMIN->>C: POST /admin/refunds/:code/reject<br/>{reason}
    C->>S: rejectRefund(adminId, refundCode, reason)
    S->>DB: SELECT_REFUND_BY_CODE(refundCode)
    S->>DB: UPDATE_REFUND_STATUS('rejected')
    S->>DB: UPDATE_BOOKING_STATUS('confirmed')
    S->>NOTIF: createRefundNotification('REFUND_REJECTED')
```

## Status Flow

```mermaid
stateDiagram-v2
    [*] --> pending : Auto (amount >= 1M)
    [*] --> approved : Auto (amount < 1M)
    pending --> approved : Admin approves
    pending --> rejected : Admin rejects
    approved --> processing : Admin processes
    processing --> completed : Payment gateway success
    processing --> failed : Payment gateway error
    failed --> processing : Retry
```

## Refund Policies

| Hours Before Departure | Refund % |
|------------------------|----------|
| > 72 hours | 100% |
| 24-72 hours | 80% |
| 12-24 hours | 50% |
| < 12 hours | 0% |
