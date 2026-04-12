# Design Philosophy

This document defines the visual and interaction rules that should unify new
pages and future UI reworks.

## Core Direction

The app should feel like a modern browser port of a keyboard-era game, not a
generic contemporary web app.

That means:

1. `Keyboard first`
   Every important screen must be usable without a mouse.
   Mouse support is welcome, but it is secondary.
   Focus order, active states, and selection movement should be obvious enough
   that a player can learn the screen by keyboard alone.

2. `Retro, not nostalgic wallpaper`
   The experience should borrow from classic game UI structure and menu logic,
   not just copy pixel art onto rounded web widgets.

3. `Pixel assets stay pixelated`
   Sprites, portraits, icons, and ship art should preserve their hard edges.
   Avoid smoothing, soft shadows, glassmorphism, and rounded card language that
   makes the art feel detached from the interface.

4. `Persistent space backdrop`
   The starfield should feel like a stable world behind the interface.
   Navigating between pages should feel like changing stations on the same ship,
   not loading unrelated websites.

5. `Structured command surfaces`
   Important interactive areas should read like game control surfaces:
   obvious selectable items, strong active states, and clear hierarchy.

## Interaction Rules

### Keyboard-first navigation

1. Every major page should expose a clear default focus or active selection.
2. Arrow keys, Enter, Escape, and other game-like bindings should remain first-class.
3. Hover-only affordances are not enough; the active item must be visible without hover.
4. Focus styling should feel like game selection, not browser default blue glow.
5. Modal and overlay screens must trap keyboard intent clearly and return focus to the prior context when closed.

### Mouse support

1. Click targets should mirror keyboard actions, not introduce separate interaction models.
2. Hover can preview, but it should not be required for discoverability.
3. If a screen works well with mouse but poorly with keyboard, the screen is not done.

## Visual Rules

### Shape language

1. Prefer square or minimally beveled corners over rounded modern controls.
2. Borders should feel crisp and intentional.
3. Bevels, pixel edges, and high-contrast outlines are good when used consistently.
4. Rounded pill buttons and soft card corners should generally be avoided.

### Typography

1. Menu labels should read like game menu labels: uppercase or small-caps style, compact, deliberate, and high-contrast.
2. Headers should be bold and iconic, not lightweight SaaS headings.
3. Body copy can be simpler, but menu text should always feel game-native.

### Color behavior

We currently want three reusable menu families:

1. `Blue menu`
   Solid blue background with light blue text.
   Active item uses a lighter blue background.

2. `Beveled button menu`
   Grey button-like surfaces.
   Active item turns yellow.

3. `Void menu`
   Black background with blue text.
   Active item turns purple.
   Headers are purple, centered, with three horizontal blue lines behind them.
   The top line is brighter and the lower line(s) fade.

Exact palette tuning can happen later, but new UI work should fit one of these
families instead of inventing a fourth unrelated style.

## Layout Rules

### Command deck layout

The default app composition should use a two-zone layout named
`command deck layout`.

1. `Primary deck`
   The larger left section.
   This is where the main task happens: fleet editing, lists, previews, battle preparation, or other dense interaction.

2. `Command rail`
   The narrower right section.
   This is where supporting controls, status, confirmation actions, submenus, or contextual information live.

Use these names in implementation discussions.

### Layout behavior

1. New pages should prefer the command deck layout unless there is a strong reason not to.
2. The command rail should feel secondary in width, but not visually disconnected.
3. Mobile layouts can stack, but the desktop mental model should still be recognizable.
4. Avoid making the whole page the scroll container for command deck screens when possible.
5. On constrained mobile layouts, keep the command rail reachable and let the primary deck take the internal scroll burden first.

## Shared Styling System

We should maintain a central stylesheet / theme layer that defines:

1. Shared color tokens
2. Shared spacing and borders
3. Shared focus / active states
4. Shared menu family classes
5. Shared command deck layout classes
6. Shared decorative header treatments
7. Shared starfield shell behavior

Page implementations should compose these building blocks instead of restyling controls ad hoc.

## Applying This Philosophy To Reworks

When revisiting an existing page, evaluate it against these questions:

1. Can the whole page be operated comfortably by keyboard only?
2. Does the active state read clearly from across the screen?
3. Does the page fit one of the three menu families?
4. Does the page use the command deck layout or intentionally depart from it?
5. Does the page preserve a crisp retro feel instead of a generic modern-web feel?
6. Does the page still feel like it belongs to the same app shell and starfield world?

If the answer to several of these is "no", the page should be considered out of alignment and a candidate for redesign.
