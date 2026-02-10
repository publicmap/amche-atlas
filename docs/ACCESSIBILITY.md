# Accessibility Features

Amche Atlas includes keyboard navigation and screen reader support to improve accessibility for all users, including those with visual impairments.

## Keyboard Shortcuts

### Navigation
- `/` - Focus search input (from anywhere on the page)
- `Escape` - Close current modal/overlay and return focus to search
- `Tab` / `Shift+Tab` - Navigate between interactive elements
- `Ctrl+B` - Toggle map browser
- `Ctrl+L` - Focus layer controls

### Search
- When the page loads, focus automatically moves to the search input
- Type to search for locations
- Use arrow keys to navigate search results
- Press `Enter` to select a location

### Modals and Dialogs
- `Escape` - Close the current modal
- `Tab` - Cycle through focusable elements within modal
- Focus automatically moves to first interactive element when modal opens
- Focus returns to previous element when modal closes

## Screen Reader Support

### ARIA Labels
All interactive elements include descriptive ARIA labels for screen readers:
- Buttons describe their action
- Links describe their destination
- Map container is labeled as "Interactive map"
- Search input is labeled as "Search for locations on the map"

### Live Regions
Important status changes are announced to screen readers:
- Layer loading states
- Search results
- Modal open/close events
- Error messages

### Focus Management
The keyboard controller ensures proper focus management:
- Automatic focus on search input at page load
- Focus trapping within modals
- Focus restoration when closing overlays
- Visual focus indicators on all interactive elements

## Browser Integration

### Map Browser (iframe)
When the map browser opens:
- Focus automatically moves to the search input within the browser
- Keyboard navigation works within the iframe
- `Escape` closes the browser and returns focus to main search

### Layer Information Modal
When viewing layer details:
- Focus moves to modal content
- All links open in new windows with proper attributes
- `Escape` closes modal and restores focus

## Testing Accessibility

### With Screen Readers
Tested with:
- VoiceOver (macOS/iOS)
- NVDA (Windows)
- JAWS (Windows)

### Keyboard-Only Navigation
All functionality is accessible via keyboard:
1. Load the page - search input receives focus
2. Press `/` from anywhere to return to search
3. Use `Tab` to navigate through UI elements
4. Use `Escape` to close overlays
5. Use `Ctrl+B` to toggle map browser

## Implementation Details

The accessibility features are implemented in `js/keyboard-controller.js`:
- Auto-focuses search input on page load
- Manages global keyboard shortcuts
- Handles focus within iframes
- Provides screen reader announcements
- Enhances existing elements with ARIA attributes

## Future Improvements

Planned accessibility enhancements:
- Keyboard navigation for map features
- Spatial audio cues for map exploration
- High contrast mode
- Customizable keyboard shortcuts
- Voice control integration
