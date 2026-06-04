# Date-Change Flow - Sequence Diagram

```mermaid
sequenceDiagram
    participant C as Controller<br/>date-change.controller
    participant S as DateChange Service
    participant DB as PostgreSQL
    participant OTP as OTP Store<br/>(In-Memory)
    participant MAIL as Mailer
    participant PAY as Payment Provider<br/>(PayOS/MoMo/PayPal)
    participant NOTIF as Notification Service
    participant ADMIN as Admin Panel

    %% ========== STEP 1: REQUEST ==========
    User->>C: POST /change-flight<br/>{newFlightId, newSeatClass, reason}
    C->>S: requestDateChange(userId, bookingCode, data)
    S->>DB: SELECT_BOOKING_DETAIL(bookingCode)
    S->>S: validateDateChangeRequest()<br/>- booking.status = 'confirmed'<br/>- hoursUntilDeparture >= 24h<br/>- newFlight exists<br/>- newFlight.available_seats >= passengers
    S->>S: calculatePriceDiff()
    S->>DB: CHECK_PENDING_DATE_CHANGE_FOR_BOOKING(bookingId)
    S->>DB: INSERT_DATE_CHANGE(status='pending_otp')
    S->>OTP: requestDateChangeOTP(email, requestCode)
    OTP->>MAIL: sendRefundOTPEmail(otp)
    S->>NOTIF: createDateChangeNotification('DATE_CHANGE_REQUESTED')
    S-->>User: {requestCode, status='pending_otp', priceDiff}

    %% ========== STEP 2: VERIFY OTP ==========
    User->>C: POST /confirm<br/>{requestCode, otp}
    C->>S: confirmDateChange(email, otp, requestCode)
    S->>OTP: verifyDateChangeOTP(email, otp)
    S->>DB: SELECT_DATE_CHANGE_BY_CODE(requestCode)
    
    alt priceDiff > 0
        S->>DB: UPDATE_STATUS('pending_payment')
        S-->>User: {status='pending_payment', requires_payment=true}
    else priceDiff <= 0 AND < 1M
        S->>S: auto-approveDateChange()
        S-->>User: {status='approved', auto_approved=true}
    else priceDiff > 0 AND >= 1M
        S->>DB: UPDATE_STATUS('pending')
        S-->>User: {status='pending', wait_admin}
    end

    %% ========== STEP 3: CREATE PAYMENT ==========
    alt requires_payment = true
        User->>C: POST /payment<br/>{paymentMethod: BANK_QR|MOMO|PAYPAL}
        C->>S: createDateChangePayment(requestCode, method)
        S->>DB: Lock row FOR UPDATE
        S->>DB: INSERT_PAYMENT
        alt BANK_QR
            S->>PAY: createBankQrInstruction()
        else MOMO
            S->>PAY: createMomoPaymentInstruction()
        else PAYPAL
            S->>PAY: createPayPalOrder()
        end
        PAY-->>S: paymentUrl/qrPayload
        S-->>User: {paymentUrl, expiresAt}
    end

    %% ========== STEP 4: PAYMENT CONFIRMED ==========
    alt Payment webhook
        PAY->>C: Webhook /payment/webhook
        C->>S: confirmDateChangePayment(paymentCode)
        S->>DB: SELECT_PAYMENT
        S->>S: validateAmount()
        S->>DB: UPDATE_PAYMENT_STATUS('SUCCESS')
        S->>DB: UPDATE_DATE_CHANGE_PAID
        S->>S: approveDateChange()
    end

    %% ========== STEP 5: APPROVE (CORE EXECUTION) ==========
    S->>DB: SELECT_DATE_CHANGE_BY_CODE
    S->>DB: SELECT_SEAT_INFO(newFlight)
    S->>S: passengers = adults + children
    S->>DB: UPDATE flight_seats<br/>available_seats += passengers<br/>(release old flight)
    S->>DB: UPDATE flight_seats<br/>available_seats -= passengers<br/>(reserve new flight)
    S->>DB: UPDATE_BOOKING_FLIGHT
    S->>DB: UPDATE_DATE_CHANGE_STATUS('approved')
    S->>NOTIF: createDateChangeNotification('DATE_CHANGE_APPROVED')
    S-->>User: {success, new flight details}

    %% ========== ADMIN REJECT ==========
    ADMIN->>C: DELETE /admin/date-changes/:code<br/>{reason}
    C->>S: rejectDateChange(adminId, code, reason)
    S->>DB: UPDATE_DATE_CHANGE_STATUS('rejected')
    S->>NOTIF: createDateChangeNotification('DATE_CHANGE_REJECTED')
```

## Status Flow

```mermaid
stateDiagram-v2
    [*] --> pending_otp : User requests
    pending_otp --> pending_payment : OTP verified, priceDiff > 0
    pending_otp --> approved : OTP verified, priceDiff <= 0 & < 1M
    pending_otp --> pending : OTP verified, priceDiff > 0 & >= 1M
    pending_payment --> approved : Payment confirmed
    pending --> approved : Admin approves
    pending --> rejected : Admin rejects
    pending_otp --> cancelled : User cancels
    pending_payment --> cancelled : User cancels
    pending --> cancelled : User/Admin cancels
    approved --> completed : Date change executed
```

## Business Rules

| Rule | Value |
|------|-------|
| minHoursBeforeFlight | 24 hours |
| maxDateRange | 365 days |
| Auto-approve threshold | 1,000,000 VND |
| OTP expiry | 5 minutes |
| Payment expiry | 30 minutes |
