# Flight Combo Flow - Sequence Diagram

```mermaid
sequenceDiagram
    participant C as Controller<br/>flight-combo.controller
    participant S as Flight Combo Service
    participant DB as PostgreSQL
    participant PRICING as Pricing Utils<br/>applyDynamicPricing()
    participant PAS as Price Alert Service

    %% ========== SEARCH PARAMS ==========
    User->>C: GET /mixed-search<br/>?from=SGN&to=HAN<br/>&outbound_date=2026-07-01<br/>&return_date=2026-07-05<br/>&adults=2&children=1<br/>&seat_class=economy<br/>&max_stops=2&limit=20

    C->>S: mixedSearch(params)

    %% ========== OUTBOUND SEARCH ==========
    par PARALLEL: Direct + 1-stop + 2-stop
        S->>DB: FIND_DIRECT_FLIGHTS<br/>FROM SGN TO HAN ON date
        Note over S,DB: 0 stops

        S->>DB: FIND_FIRST_LEG<br/>FROM SGN to any airport
        S->>DB: FIND_SECOND_LEG<br/>FROM mid TO HAN
        Note over S,DB: 1 stop (A→X→B)

        S->>DB: FIND_FIRST_LEG_2STOP<br/>FROM SGN
        S->>DB: FIND_MID_LEG<br/>FROM mid1
        S->>DB: FIND_LAST_LEG<br/>FROM mid2 TO HAN
        Note over S,DB: 2 stops (A→X→Y→B)
    end

    DB-->>S: Raw flight rows

    loop For each flight/combo
        S->>PRICING: applyDynamicPricing(<br/>basePrice, availableSeats,<br/>totalSeats, departureTime)
        PRICING-->>S: finalPrice
        S->>S: calcTotalPrice(<br/>adults, children, infants)
        S->>S: calcLayoverMinutes()
        S->>S: formatLeg()
    end

    S->>S: scoreCombo()<br/>price(40%) + duration(30%)<br/>+ layover(20%) + bonus
    S->>S: rankCombos()

    %% ========== RETURN SEARCH (if roundtrip) ==========
    alt return_date provided
        par PARALLEL: Return direction
            S->>S: findAllCombosForDirection(<br/>HAN→SGN on return_date)
        end
        S->>S: Cross-product<br/>outbound × return
        S->>S: rankRoundtripCombos()
    end

    S-->>C: {<br/>one_way_options[],<br/>roundtrip_combinations[],<br/>total_outbound: N,<br/>total_return: M<br/>}
    C-->>User: JSON response

    %% ========== PRICE ALERTS (optional) ==========
    Note over S,PAS: Background price alert generation
    S->>PAS: generatePriceAlertsForFlights()
    PAS-->>User: Price alert notification
```

## Pricing Calculation

```mermaid
flowchart LR
    A["basePrice<br/>(from DB)"] --> B["applyDynamicPricing()"]
    B --> C["dynamicPrice"]
    
    C --> D["Adult: dynamicPrice × 1"]
    C --> E["Child: dynamicPrice × 0.75"]
    C --> F["Infant: dynamicPrice × 0.1"]
    
    D --> G["totalPrice"]
    E --> G
    F --> G
    
    G --> H["scoreCombo()"]
```

## Scoring Formula

```mermaid
stateDiagram-v2
    [*] --> scoreCalculation
    scoreCalculation --> priceScore : 40% weight
    scoreCalculation --> durationScore : 30% weight
    scoreCalculation --> layoverScore : 20% weight
    scoreCalculation --> airlineBonus : ±bonus
    
    priceScore --> totalScore
    durationScore --> totalScore
    layoverScore --> totalScore
    airlineBonus --> totalScore
    
    totalScore --> penaltyCheck : layover < 45min
    totalScore --> penaltyCheck : layover > 8hrs
    
    penaltyCheck --> finalScore
    finalScore --> sortedByScore
```

## Layover Rules

| Rule | Value |
|------|-------|
| MIN_LAYOVER_MINUTES | 45 minutes |
| MAX_LAYOVER_HOURS | 8 hours |
