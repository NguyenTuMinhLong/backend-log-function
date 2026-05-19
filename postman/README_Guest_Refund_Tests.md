# Guest Refund API Tests

## Overview

This Postman collection tests the **Guest Refund API** functionality including:
- Creating refund requests without authentication
- Viewing refund details with email verification
- Rate limiting protection
- Linking guest refunds to user accounts

## Files

- `Guest_Refund_API_Tests.postman_collection.json` - Test collection
- `Guest_Refund_Test_Environment.postman_environment.json` - Test environment

## Setup

### 1. Import into Postman

1. Open Postman
2. Click **Import** button
3. Select both JSON files or drag and drop them

### 2. Configure Environment

1. Go to **Environments** tab
2. Select "Guest Refund Test Environment"
3. Update these variables:
   - `base_url` - Your API base URL (default: `http://localhost:3000`)
   - `auth_token` - JWT token for authenticated tests
   - `test_booking_code` - A valid booking code in your test database
   - `test_guest_email` - Email matching the booking's contact_email
   - `test_contact_email` - Contact email for the test booking

### 3. Database Prerequisites

Before running tests, ensure you have:

1. A **confirmed booking** with status `confirmed` in the database
2. The booking's `contact_email` matches your test email
3. The booking's flight departure time is in the future
4. The booking has an associated successful payment

```sql
-- Check booking status
SELECT booking_code, status, contact_email, outbound_departure_time
FROM bookings
WHERE status = 'confirmed';

-- Check payments
SELECT booking_id, status FROM payments WHERE booking_id = <booking_id>;
```

## Test Structure

### Test Folders

1. **Create Refund Requests**
   - Full refund
   - Partial refund (1 leg)
   - Validation errors
   - Error scenarios

2. **Get Refund Details**
   - With correct email
   - With wrong email
   - Without email

3. **Rate Limiting**
   - Test 429 response after 3 requests

4. **Link Refunds (Auth Required)**
   - Success case
   - Without authentication
   - Missing parameters

## Running Tests

### Run All Tests
1. Select the collection
2. Click **Run Collection**
3. Select the environment

### Run Specific Test
1. Expand the test folder
2. Click **Send** on the individual request

## Expected Test Flow

### Happy Path

```
1. Create Full Refund Request → 201 Created
   └─ Returns refund_code (stored in variable)

2. Get Refund Detail → 200 OK
   └─ Uses stored refund_code and email

3. Create Partial Refund → 201 Created
   └─ Returns different refund_code

4. Link to User Account → 200 OK
   └─ Requires auth_token
```

### Error Scenarios

```
- Missing booking code → 400 Bad Request
- Missing email → 400 Bad Request
- Missing reason → 400 Bad Request
- Invalid booking → 404 Not Found
- Email mismatch → 400 Bad Request
- Duplicate request → 400 Bad Request
- Rate limited → 429 Too Many Requests
- Link without auth → 401 Unauthorized
```

## Rate Limiting

The API implements rate limiting:
- **Limit**: 3 requests per 15 minutes per IP
- **Response**: HTTP 429 with `Retry-After` header

To test rate limiting:
1. Run "Rate Limiting" request 4 times
2. The 4th request should return 429

## Test Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `base_url` | API base URL | `http://localhost:3000` |
| `auth_token` | JWT token for auth tests | `eyJhbGci...` |
| `guest_refund_code` | Refund code from create test | `REF-20260519-ABC123` |
| `test_booking_code` | Valid booking code | `BK20250501001` |
| `test_guest_email` | Guest email for create | `guest@example.com` |
| `test_contact_email` | Contact email for verification | `john.doe@example.com` |

## API Endpoints Tested

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/refunds/guest` | No | Create guest refund |
| GET | `/api/refunds/guest/:refundCode?email=` | No | Get refund detail |
| POST | `/api/refunds/link-guest-refunds` | Yes | Link refunds to user |

## Troubleshooting

### "No recipient email found" warning
- Check that the booking has a valid `contact_email`

### "Email xác thực không khớp" error
- Ensure `guestEmail` matches the booking's `contact_email`

### "Đã có yêu cầu refund đang chờ" error
- A pending refund already exists for this booking
- Cancel or wait for the existing refund to complete

### Rate limit not working
- Rate limit is per IP address
- Restart the server to reset in-memory rate limit store

## Notes

- Tests use real database operations
- Some tests (duplicate, rate limit) may affect other tests
- Consider using a separate test database
