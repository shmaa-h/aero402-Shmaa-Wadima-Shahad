# AERO402 — Supersonic Diamond-Wedge Analysis

Interactive Shock–Expansion Theory Calculator.

## Run locally

1. Extract the complete ZIP.
2. Keep these four files together in the extracted AERO402-Diamond-Wedge folder:
   - index.html — interface structure
   - style.css — layout, responsive behavior, and visual styling
   - app.js — approved calculation engine, presentation helpers, and interface
   - README.md — these instructions
3. Open index.html in a modern browser with JavaScript enabled.
4. Enter or modify the inputs and press **Calculate / Update Analysis**.

There is no installation, build step, backend server, database, external library, network-loaded font, or external engineering calculation service. Opening the HTML file directly is supported: the scripts use ordinary local script loading, not module imports or fetch calls.

The requested demonstration case is displayed and calculated on initial load:

| Input | Default |
| --- | ---: |
| Freestream Mach number | 2.5 |
| Freestream static pressure | 101325 Pa |
| Angle of attack | 0 deg |
| Leading-edge half-angle | 8 deg |
| Trailing-edge half-angle | 8 deg |
| Chord | 1 m |
| Specific-heat ratio | 1.4 |

## Demonstration workflow

1. Start with the default symmetric case. Check matching upper/lower states and CL approximately zero.
2. Change angle of attack, then calculate again. Inspect the shock angles, panel pressures and force coefficients.
3. Select a panel or wave callout to open the panel/wave inspector. Enter or Space also activates focused diagram/plot segments.
4. Review Panel States, Surface Pressure Distribution and Detailed Wave Results.
5. Demonstrate a wave transition using alpha = 8 deg and deltaL = 8 deg: the upper leading edge has no wave.
6. Demonstrate an error with M = 1.5, alpha = 10 deg and deltaL = 5 deg: the lower leading edge has no attached-shock solution.
7. Demonstrate a warning with M = 1.5, alpha = 0 deg and deltaL = 11.2 deg: the near-limit warning permits the valid downstream calculation.
8. Expand Engineering Model & Numerical Details to review controls, assumptions, reference values and automated checks.

Edits clear earlier results so old values cannot be mistaken for a newly entered case. The Calculate button updates the page without reloading it. On narrow screens, inputs appear before the diagram and results; wide tables and detailed schematics scroll horizontally inside their own containers.

## Engineering model preservation

The Step 5 interface originally preserved the Step 4 engineering model. The subsequent user-approved correction sets the freestream direction to phiInf = +alpha, replacing the earlier negative sign. Wave classifications and force projections use this corrected freestream state; the equations, supported ranges, numerical controls and validation rules are unchanged. Interface defaults remain separate from the engine's fixed regression-test baseline.

app.js has three labeled sections:

1. Approved engineering model: geometry, equations, local limits, sequential flow, validation, forces and tests.
2. Presentation data: pressure-plot segments and wave-ray directions derived from calculated states.
3. Interface: input handling, formatting, status messages, SVG rendering and interaction.

Engineering assumptions: steady, two-dimensional, inviscid flow; calorically perfect gas with constant gamma per case; sharp diamond wedge; weak attached shocks; Prandtl–Meyer expansions; pressure forces only.

Body coordinates: +x from leading edge to trailing edge, +y upward, angles positive counterclockwise. The freestream direction is phiInf = +alpha. Panel directions are UF = +deltaL, UR = -deltaT, LF = -deltaL and LR = +deltaT. Upper positive turns and lower negative turns are compression.

Each surface is calculated sequentially. The front-panel downstream state supplies the upstream state for the rear panel. Upper and lower surface calculations remain independent. An error blocks only dependent states, but the full aerodynamic result requires all four valid panel pressures.

Lift and drag use the established force projections onto the directions perpendicular and parallel to the freestream. Coefficients are formatted to four decimal places; internal values retain full numerical precision.

## Supported ranges and numerical controls

| Quantity | Supported range or control |
| --- | --- |
| Freestream Mach | 1.5–5.0 |
| Angle of attack | -10 to +10 deg |
| Leading and trailing half-angles | 2–15 deg |
| Static pressure | Positive finite Pa |
| Chord | Positive finite m |
| Gamma | Finite and greater than 1; default 1.4 |
| Root angular tolerance | 1e-10 rad |
| Maximum iterations | 200 |
| Zero-turn angular tolerance | 1e-9 rad |
| Near-zero denominator tolerance | 1e-14 in internal units |
| Near-zero CD tolerance | 1e-10 |
| Attached-shock warning margin | Within 1 deg below thetaMax |
| Existing local numerical Mach ceiling | 100 |

The application-supported input range does not guarantee an attached solution. Each compression uses the local upstream Mach number and gamma to find thetaMax. The expansion target must be below the theoretical Prandtl–Meyer maximum; a finite Mach-100 inversion bracket is a separate numerical limit.

VALID, WARNING and ERROR are displayed inside the page. Warnings preserve usable results. Unavailable output is labeled explicitly; no missing state is replaced by zero, freestream conditions or an older case.

## Verification and remaining validation

The application includes 112 established model tests and 8 presentation-data tests, plus 8 named boundary cases. Expand Engineering Model & Numerical Details, then Automated Checks, to run them.

The Step 5 interface checks cover defaults and labels, section order, separate shock/expansion fields, force-card formatting, warning continuation, failure propagation, wave transitions, diagram/plot regeneration, keyboard selection, Pa handling and stale-result clearing. Seventeen of the eighteen interface acceptance checks pass; check 16 (real-browser laptop/mobile usability) remains pending. The calculation functions are compared with the original approved source, allowing only the user-approved freestream sign correction. Sign-dependent checks now verify phiInf = alpha, upper/lower wave transitions and failure propagation, and positive/negative lift for positive/negative incidence.

A browser could not be launched in the execution environment because local browser IPC was blocked. JavaScript/interface logic and generated SVG rendering are checked; laptop/mobile browser layout and portability still require a real-browser review. Open the exact extracted project in the team's target browser and check at approximately 1366x768 and a narrow mobile width.

The team's five independent representative validation cases remain pending. The supplied shock/Prandtl–Meyer reference limits and automated checks do not substitute for the required independent panel-state and force calculations.

## Source and output access

The public calculation API is available in the browser console as AERO402. The current submitted result is lastResult, and the current pressure-plot data is lastPressureData. These are null while input edits are awaiting recalculation; engineering output cells never display those raw sentinel values.

The browser-only view helpers are available as AERO402_VIEW. Use the named functions and the equation traceability table in Engineering Model & Numerical Details for review.

The previous one-file application is retained as the prior version; this four-file project is the Step 5 delivery.

