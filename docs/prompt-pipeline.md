# DartBoard Prompt Pipeline Documentation

## Overview

This document describes how the DartBoard chat prompt is assembled and the priority order of different instruction layers.

## Unified Prompt Assembly

All prompt assembly is centralized in `lib/promptAssembly.ts`. This ensures deterministic behavior and clear priority hierarchy.

## Priority Order (Layers 1-6)

The system message is assembled in this exact order:

### Layer 1: System Prompt Kernel (Runtime Laws)
- **Source:** `lib/runtimeLaws.ts`
- **Content:** Global, non-negotiable rules
- **Example:** "Treat this as a stateless tactical shell. Prefer compression over narration..."
- **You control:** Edit `lib/runtimeLaws.ts` directly
- **Priority:** Highest - these rules always apply

### Layer 2: Core Specification
- **Source:** `user_profile.core_spec` (from database)
- **Content:** Your personal architecture, preferences, and core directives
- **You control:** Edit via `/profile` page → "Core Specification" field
- **Priority:** Very high - your personal rules

### Layer 3: User Profile
- **Source:** `user_profile` table (name, style, preferences)
- **Content:** Display name, communication style, general preferences
- **You control:** Edit via `/profile` page
- **Priority:** High - personalization layer

### Layer 4: Mode Directives
- **Source:** `lib/modes.ts`
- **Content:** Mode-specific behavior (Tactical, Builder, Simplicity, Chill, Dissect)
- **You control:** 
  - Select mode in Chat UI
  - Edit mode definitions in `lib/modes.ts`
- **Priority:** Medium-high - overrides generic behavior but respects core rules

### Layer 5: Focus Mode / UOS
- **Source:** Chat UI (Focus Mode toggle + UOS structure)
- **Content:** Objective-driven behavior narrowing (AIM, CONSTRAINTS, STEPS, etc.)
- **You control:** 
  - Toggle Focus Mode in Chat UI
  - Set focus goal (simple string or UOS JSON)
  - Set intensity (low/medium/high/lockdown)
- **Priority:** Medium - narrows behavior but doesn't break core/modes

### Layer 6: Memory Context (Vault)
- **Source:** `memories` table (selected folder)
- **Content:** Saved memory summaries from your Vault
- **You control:** 
  - Organize memories into folders
  - Select folder in Chat UI
- **Priority:** Lowest - content injection, not behavior rules

## Message History (Layers 7-8)

After the system message, the following are added:

### Layer 7: System Summaries
- **Source:** `messages` table where `role = 'system_summary'`
- **Content:** Compressed conversation summaries (auto-generated every 40 messages)
- **You control:** Automatic - no manual control needed
- **Priority:** Context layer

### Layer 8: Recent Raw Messages
- **Source:** Last 20 messages from `messages` table
- **Content:** Recent user/assistant conversation
- **You control:** Just chat normally
- **Priority:** Most recent context

## Current Implementation

### File Structure

```
lib/
  promptAssembly.ts      ← Unified prompt assembly (canonical)
  boot.ts                ← Simple boot function (kept for other routes)
  runtimeLaws.ts         ← Layer 1
  modes.ts               ← Layer 4
  db.ts                  ← Database access

app/api/
  chat/route.ts          ← Main chat route (uses promptAssembly)
  system-message/route.ts ← Uses buildBootSystemMessage (simpler)
  objective/route.ts     ← Uses buildBootSystemMessage (simpler)
  doc-assistant/route.ts ← Uses buildBootSystemMessage (simpler)
```

### How It Works

1. **Chat Route** (`app/api/chat/route.ts`):
   - Receives request with mode, focus settings, memory folder
   - Calls `buildSystemPrompt()` with all options
   - Gets back complete system message (Layers 1-6)
   - Adds system summaries (Layer 7)
   - Adds recent messages (Layer 8)
   - Sends to OpenAI

2. **Prompt Assembly** (`lib/promptAssembly.ts`):
   - Loads profile from database
   - Loads runtime laws
   - Loads mode directives
   - Appends Focus Mode (if enabled)
   - Appends memory context (if folder selected)
   - Returns complete system message

## Where You Have Control

### Direct File Edits (You control completely)

1. **`lib/runtimeLaws.ts`** - Edit global rules
2. **`lib/modes.ts`** - Edit mode definitions
3. **`lib/promptAssembly.ts`** - Edit prompt assembly logic (advanced)

### UI Controls (You control via interface)

1. **`/profile` page** - Edit:
   - Display Name
   - Style
   - Preferences
   - Core Specification

2. **Chat UI** - Control:
   - Mode selection (Tactical/Builder/etc.)
   - Focus Mode toggle
   - Focus goal (UOS structure)
   - Focus intensity
   - Memory folder selection

3. **Vault** - Organize:
   - Memory folders
   - Memory importance
   - Memory titles/summaries

## What the AI Does

The AI (via code) handles:
- Assembling the prompt in the correct order
- Loading data from database
- Formatting the final message
- Following the rules you've defined

The AI does NOT:
- Change your rules
- Modify your profile
- Alter the priority order (unless you edit the code)

## Benefits of Unified Prompt Assembly

1. **Centralized Logic** - All prompt assembly in one place
2. **Clear Priority** - Explicit order prevents conflicts
3. **Easier Debugging** - See exactly what's being sent to OpenAI
4. **Maintainable** - Change priority order in one file
5. **Deterministic** - Same inputs always produce same prompt structure

## Future Enhancements

Potential additions to the prompt assembly pipeline:
- People profiles context injection
- Location profiles context injection
- Archive message context (if selected)
- Custom instruction layers
- Versioned prompt templates

## Notes

- The old `buildBootSystemMessage()` function is still available in `lib/boot.ts` for simpler routes that don't need memories/focus mode
- The prompt assembly pipeline respects the priority order: Core → Profile → Mode → Focus → Memories
- Later layers can narrow behavior but cannot override core rules
