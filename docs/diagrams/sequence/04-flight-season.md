# Flight Season Pricing Flow - Sequence Diagram

```mermaid
sequenceDiagram
    participant FS as Flight Search<br/>flight.service
    participant FCS as Flight Combo Service
    participant SS as Season Service
    participant DB as PostgreSQL
    participant PAS as Price Alert Service
    participant ADMIN as Admin Panel

    %% ========== SEARCH TIME ==========
    User->>FS: Search flights
    FS->>FCS: searchFlights(params)
    FCS->>DB: Query flights (FIND_DIRECT, etc.)

    loop For each flight found
        FCS->>PAS: generatePriceAlertsForFlights(flights)
        PAS->>SS: getSeasonInfo(departureDate)
        
        rect rgb(240, 248, 255)
            Note over SS,DB: Priority Check
            SS->>DB: Check price_overrides<br/>WHERE date = ? AND is_active = true
            alt Override exists
                SS->>SS: return override info<br/>type='override'
            else No override
                SS->>DB: Check holidays<br/>WHERE is_active = true
                alt Holiday match
                    SS->>SS: return holiday info<br/>type='holiday'
                else No holiday
                    SS->>DB: Check season_periods<br/>WHERE is_active = true<br/>ORDER BY priority DESC
                    loop For each active season
                        SS->>SS: isDateInSeason(date, season)
                    end
                    alt Season match (highest multiplier)
                        SS->>SS: return season info<br/>type='season'
                    else Off-peak
                        SS-->>PAS: null (no season)
                    end
                end
            end
        end
        
        SS-->>PAS: {isPeak, name, multiplier,<br/>reason, type}
        PAS-->>FCS: alertData with season info
    end

    FCS-->>User: Flights with season info<br/>& price alerts

    %% ========== ADMIN OVERRIDE ==========
    ADMIN->>ADMIN: CRUD price_overrides
    
    alt CREATE/UPDATE/DELETE override
        ADMIN->>FCS: POST /admin/price-overrides
        FCS->>SS: clearOverrideCache()
        Note over SS: Map cleared for<br/>specific date
    end

    %% ========== ADMIN SEASON CONFIG ==========
    ADMIN->>ADMIN: CRUD season_periods
    
    alt UPDATE season config
        ADMIN->>SS: refreshCache()
        Note over SS: Clear all caches<br/>seasonCache, holidayCache,<br/>overrideCache
    end

    %% ========== ALERT TRIGGER ==========
    alt User enable price alert
        User->>PAS: POST /price-alerts<br/>{flightId, threshold}
        PAS->>SS: shouldAlert(departureDate)
        alt shouldAlert = true
            PAS->>PAS: Schedule alert check
            PAS->>User: Alert: Price may increase<br/>due to season/holiday
        end
    end
```

## Priority Order

```mermaid
flowchart TD
    A["getSeasonInfo(date)"] --> B{"price_overrides<br/>exists?"}
    B -->|Yes| B1["Return Override<br/>type: 'override'"]
    B -->|No| C{"holidays<br/>match?"}
    C -->|Yes| C1["Return Holiday<br/>type: 'holiday'"]
    C -->|No| D["Check season_periods"]
    D --> E{"Season<br/>match?"}
    E -->|Yes| E1["Return Season<br/>type: 'season'<br/>(highest multiplier)"]
    E -->|No| E2["Return null<br/>off-peak (1.0)"]
    
    style B1 fill:#ff6b6b
    style C1 fill:#ffa94d
    style E1 fill:#ffd93d
    style E2 fill:#69db7c
```

## Cache Strategy

```mermaid
stateDiagram-v2
    [*] --> cacheHit : Data in cache
    [*] --> cacheMiss : Cache expired
    
    cacheHit --> returnData : TTL < 1 hour
    cacheMiss --> queryDB : Query database
    queryDB --> updateCache : Store result
    updateCache --> returnData
    
    note right of cacheHit: seasonCache<br/>holidayCache<br/>overrideCache
```

## Cache Configuration

| Cache | Data | TTL | Invalidation |
|-------|------|-----|--------------|
| `seasonCache` | season_periods | 1 hour | `refreshCache()` |
| `holidayCache` | holidays | 1 hour | `refreshCache()` |
| `overrideCache` | Map<date, override> | 1 hour | `clearOverrideCache()` |

## Season Detection Logic

```mermaid
flowchart LR
    subgraph "Same Year Season"
        A["start_month <= end_month"] --> B{"month >= start_month<br/>AND month <= end_month"}
        B -->|Start month| C{"day >= start_day"}
        B -->|End month| D{"day <= end_day"}
    end
    
    subgraph "Cross-Year Season"
        E["start_month > end_month<br/>(e.g., Tet)"] --> F{"month >= start_month<br/>OR month <= end_month"}
    end
    
    F --> G{"Valid day range"}
```

## Functions Reference

| Function | Purpose |
|----------|---------|
| `getActiveSeasons()` | Get all active season periods |
| `getActiveHolidays()` | Get all active holidays |
| `isDateInSeason(date, season)` | Check if date falls in season range |
| `isHoliday(date, holidays)` | Check if date is a holiday |
| `getOverrideForDate(date)` | Get admin override for specific date |
| `getSeasonInfo(date)` | Main function - returns season info |
| `getSeasonMultiplier(date)` | Returns multiplier (1.0 if off-peak) |
| `isApproachingPeakSeason(date)` | Check if approaching peak |
| `shouldAlert(date)` | Quick check for alerts |
| `clearOverrideCache()` | Invalidate override cache |
| `refreshCache()` | Invalidate all caches |
