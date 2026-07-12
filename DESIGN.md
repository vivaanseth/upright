# Design System

## Theme

Posture is used during focused desk work in ordinary daylight and low evening light. The interface uses a restrained, system-aware light/dark theme with cool neutral surfaces and a muted sky-teal anchor. It should feel like a precise desktop instrument without looking technical or clinical.

Color strategy: restrained. Brand color appears only in primary actions, active navigation, focus, and positive posture state.

## Color Palette

All production colors are expressed in OKLCH.

### Light

- Background: `oklch(1 0 0)`
- Surface: `oklch(0.975 0.004 210)`
- Raised surface: `oklch(0.995 0.002 210)`
- Ink: `oklch(0.205 0.018 225)`
- Muted ink: `oklch(0.47 0.018 225)`
- Hairline: `oklch(0.90 0.010 220)`
- Primary: `oklch(0.55 0.105 200)`
- Primary hover: `oklch(0.49 0.115 200)`
- Primary soft: `oklch(0.94 0.035 200)`
- Warning: `oklch(0.70 0.14 70)`
- Poor: `oklch(0.58 0.17 28)`

### Dark

- Background: `oklch(0.13 0.010 225)`
- Surface: `oklch(0.17 0.013 225)`
- Raised surface: `oklch(0.205 0.015 225)`
- Ink: `oklch(0.94 0.006 210)`
- Muted ink: `oklch(0.70 0.014 215)`
- Hairline: `oklch(0.30 0.018 220)`
- Primary: `oklch(0.72 0.105 200)`
- Primary hover: `oklch(0.78 0.10 200)`
- Primary soft: `oklch(0.24 0.045 200)`
- Warning: `oklch(0.78 0.13 75)`
- Poor: `oklch(0.70 0.16 28)`

## Typography

- UI family: system sans (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `sans-serif`).
- Numeric family: system monospace for timers and compact diagnostics only.
- Type scale: 12, 13, 14, 16, 20, 28, 40px.
- Main title uses 40px at normal desktop scale; screen headings use 28px.
- Body text uses 14-16px with 1.5 line height and 65ch maximum prose width.
- Labels and controls never use decorative display typography.

## Shape and Elevation

- Cards and major panels: 14px radius.
- Inputs and secondary controls: 10px radius.
- Buttons and compact status chips: full-pill only when the shape communicates clickability or state.
- Prefer surface contrast and 1px hairlines. Use a small 0-4px shadow only for floating nudge and menus.
- Never nest cards for decoration.

## Layout

- Desktop shell uses a 224px navigation rail and a flexible content canvas.
- Content is capped at 1180px, with 32px outer padding and 24px primary gaps.
- Under 820px, navigation becomes a compact top row and content becomes one column.
- Dashboard hierarchy: status first, session metrics second, camera/control details last.
- Onboarding centers a single 680px workflow panel with the current step and one primary action.

## Components

- Primary button: filled primary color, white text, 38-44px height.
- Secondary button: raised surface with hairline, no wide shadow.
- Danger actions: neutral by default, explicit confirmation, poor color only at the final destructive step.
- Inputs: label above, helper or error below, 40px minimum height.
- Status: icon, label, and score together; color never stands alone.
- Metrics: large number with a plain text label, separated by whitespace rather than a grid of identical cards.
- Nudge: compact 360px floating panel, 14px radius, strong text hierarchy, no stolen focus.

## Motion

- 160-220ms state transitions with ease-out-quart.
- Animate opacity and transform for panels; animate score ring with a short interpolated stroke transition.
- No orchestrated page-load sequence.
- Reduced motion removes transforms and uses immediate or short crossfades.

## Content Voice

- Prefer “Take a moment to reset” over “Bad posture detected.”
- Explain uncertainty: “Step back into view” rather than reporting a poor score.
- Use sentence case throughout.
- Avoid medical promises, guilt, exclamation marks, emojis, and streak language.
