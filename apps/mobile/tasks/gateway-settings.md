# Task: Add Gateway Agent Settings to Config Screen

## Goal

Add a new "AGENT SETTINGS" section to the Settings tab, positioned between "GATEWAY CONNECTION" and "APPEARANCE". This section lets users view and modify their OpenClaw Gateway's agent configuration directly from the app.

## Settings to implement

### 1. Heartbeat Interval
- **Config path:** `agents.defaults.heartbeat.every`
- **UI:** Tappable row with current value displayed on the right. Tapping opens an action sheet / picker with options: `15m`, `30m`, `1h`, `2h`, `Off`
- **Value mapping:** `"15m"`, `"30m"`, `"1h"`, `"2h"`, `"0m"` (0m = disabled)
- **Label:** "Heartbeat Interval"
- **Subtitle:** "How often the agent checks in"

### 2. Heartbeat Active Hours
- **Config path:** `agents.defaults.heartbeat.activeHours.start` and `agents.defaults.heartbeat.activeHours.end`
- **UI:** Tappable row showing current range (e.g. "08:00 – 24:00"). Tapping opens a modal/sheet with two time pickers (start and end), using hour-only granularity (00:00 to 24:00)
- **Default display:** "All Day" when `activeHours` is not set
- **Label:** "Active Hours"
- **Subtitle:** "Time window for heartbeat activity"

### 3. Default Model
- **Config path:** `agents.defaults.model.primary`
- **UI:** Tappable row showing current model name. Tapping opens a scrollable picker/action sheet listing all available models
- **Data source:** Call `gateway.listModels()` (already implemented) to get the list. Display `name` in the picker, use `id` as the value
- **Label:** "Default Model"
- **Subtitle:** "Primary model for agent responses"

## Architecture

### Reading config
- Use `gateway.getConfig()` (already implemented in `src/services/gateway.ts`) to fetch the current config snapshot
- Extract heartbeat and model values from the returned config object
- Store the `hash` for use in subsequent patches

### Writing config
- Use `gateway.patchConfig(raw, baseHash)` (already implemented) to apply changes
- `raw` is a JSON5 string with only the changed fields, e.g.:
  ```json5
  { agents: { defaults: { heartbeat: { every: "1h" } } } }
  ```
- After a successful patch, the Gateway will auto-restart. Show a brief toast/indicator: "Settings saved. Gateway restarting..."
- Refetch config after a short delay (~3s) to update the displayed values

### Hook: `useAgentSettings`
Create a new hook at `src/screens/ConfigScreen/hooks/useAgentSettings.ts`:
- Fetches config on mount (only when gateway is connected)
- Exposes: `heartbeatEvery`, `activeHoursStart`, `activeHoursEnd`, `defaultModel`, `models[]`, `loading`, `error`
- Exposes setters: `setHeartbeatEvery(value)`, `setActiveHours(start, end)`, `setDefaultModel(modelId)`
- Each setter calls `gateway.patchConfig()` with the appropriate JSON5 patch
- Handles loading/error states gracefully

## UI Implementation

### Location in ConfigScreenLayout.tsx
Insert the new section in the ScrollView between the GATEWAY CONNECTION section and the APPEARANCE section:

```tsx
{/* After gateway connection card and create row */}

<Text style={styles.sectionHeader}>AGENT SETTINGS</Text>

<View style={styles.card}>
  {/* Heartbeat Interval row */}
  <Pressable onPress={handleHeartbeatPicker} style={...}>
    <View style={styles.toggleLabels}>
      <Text style={styles.rowLabel}>Heartbeat Interval</Text>
      <Text style={styles.rowMeta}>How often the agent checks in</Text>
    </View>
    <View style={styles.rowTrailing}>
      <Text style={styles.rowValue}>{heartbeatLabel}</Text>
      <ChevronRight ... />
    </View>
  </Pressable>

  <View style={styles.divider} />

  {/* Active Hours row */}
  <Pressable onPress={handleActiveHoursPicker} style={...}>
    ...
    <Text style={styles.rowValue}>{activeHoursLabel}</Text>
    ...
  </Pressable>

  <View style={styles.divider} />

  {/* Default Model row */}
  <Pressable onPress={handleModelPicker} style={...}>
    ...
    <Text style={styles.rowValue}>{modelLabel}</Text>
    ...
  </Pressable>
</View>
```

### Interaction patterns
- Use `ActionSheetIOS.showActionSheetWithOptions` on iOS and `Alert.alert` on Android for simple pickers (heartbeat interval), matching the existing Theme picker pattern in ConfigScreenLayout.tsx
- For Active Hours, use the shared `Sheet` with two scroll pickers for start/end hour
- For Default Model, use ActionSheetIOS/Alert if model count ≤ 10, otherwise use the shared `Sheet` with a scrollable list
- Show a loading state while fetching config (subtle spinner or skeleton)
- Show the section only when a gateway is connected; hide it when disconnected

### Styling
- Follow exactly the same styling patterns already used in ConfigScreenLayout.tsx (card, row, divider, sectionHeader, etc.)
- Use the existing theme system (`useAppTheme`, `theme.colors`, factory pattern for styles)
- Use existing UI components where possible (`Sheet`, `ChevronRight` icon, etc.)

## Important constraints
- All code comments, variable names, and user-facing text must be in English
- Follow the existing theming rules (see AGENTS.md for details)
- Do not modify gateway.ts — `getConfig()`, `patchConfig()`, and `listModels()` are already implemented
- The `config.patch` API triggers a Gateway restart; handle the brief disconnection gracefully (the gateway reconnects automatically)
- Keep the controller hook pattern consistent with `useConfigScreenController`

## Files to create/modify
- **Create:** `src/screens/ConfigScreen/hooks/useAgentSettings.ts`
- **Modify:** `src/screens/ConfigScreen/hooks/useConfigScreenController.ts` (integrate useAgentSettings)
- **Modify:** `src/screens/ConfigScreen/ConfigScreenLayout.tsx` (add the AGENT SETTINGS section)
