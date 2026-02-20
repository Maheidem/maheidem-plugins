# Discovery Checklist

A comprehensive checklist of WHERE to look in a web application codebase to find every user interaction surface. Use this during Phase 1 of the journey audit.

## Routes and Navigation

- [ ] **Router config files** -- `routes.js`, `router/index.js`, `pages/`, `app/` directory
- [ ] **Dynamic routes with params** -- `:id`, `[slug]`, `[...catchAll]`
- [ ] **Route guards and middleware** -- auth checks, role verification, redirect rules
- [ ] **Redirect rules** -- automatic redirects based on auth state or feature flags
- [ ] **Navigation components** -- Sidebar, TopNav, BottomNav, Breadcrumbs
- [ ] **Tab and subtab systems** -- tabs within pages that change content without URL change
- [ ] **Deep links and hash routes** -- `#section` anchors, query param state (`?tab=settings`)
- [ ] **Programmatic navigation** -- `router.push()`, `navigate()`, `window.location`

## UI Components

- [ ] **Modal and dialog triggers** -- buttons that open overlay content
- [ ] **Modal content and actions** -- forms, confirmations, info display inside modals
- [ ] **Drawer and panel toggles** -- slide-in panels from edges
- [ ] **Dropdown menus and actions** -- user menu, context menus, action dropdowns
- [ ] **Context menus** -- right-click menus with custom actions
- [ ] **Toast and notification systems** -- success/error/info feedback
- [ ] **Tooltip interactions** -- hover tooltips with actionable content
- [ ] **Accordion and collapsible sections** -- expandable content areas
- [ ] **Popovers** -- click-triggered floating content panels
- [ ] **Banners and alerts** -- dismissible info/warning/error banners

## Forms and Input

- [ ] **All `<form>` elements** -- every form tag and its submit handler
- [ ] **File upload inputs** -- `<input type="file">`, dropzones, drag-and-drop
- [ ] **Drag-and-drop zones** -- file drops, reorder lists, kanban boards
- [ ] **Inline editing** -- click-to-edit text, contenteditable elements
- [ ] **Search and filter inputs** -- search bars, filter dropdowns, date ranges
- [ ] **Multi-step wizards** -- onboarding flows, setup wizards, multi-page forms
- [ ] **Settings and preferences forms** -- user settings, app configuration
- [ ] **JSON/code editors** -- textarea-based or Monaco/CodeMirror editors
- [ ] **Rich text editors** -- WYSIWYG content creation
- [ ] **Select and multiselect** -- dropdown selections, tag pickers
- [ ] **Date and time pickers** -- calendar widgets, time selectors
- [ ] **Sliders and range inputs** -- numeric range selectors
- [ ] **Toggle switches** -- boolean on/off controls
- [ ] **Color pickers** -- color selection widgets

## Data Operations (CRUD)

- [ ] **Create operations** -- "New", "Add", "Create" buttons and their flows
- [ ] **Read and display** -- list views, detail views, card grids
- [ ] **Update operations** -- "Edit", "Update", "Save" buttons and their flows
- [ ] **Delete operations** -- "Delete", "Remove" buttons with confirmation modals
- [ ] **Bulk operations** -- "Select All", batch delete, batch update
- [ ] **Import operations** -- CSV import, JSON import, copy/paste
- [ ] **Export operations** -- CSV export, JSON export, PDF download
- [ ] **Sort interactions** -- column header clicks, sort direction toggles
- [ ] **Filter interactions** -- filter dropdowns, active filter chips
- [ ] **Paginate interactions** -- page buttons, items-per-page selector
- [ ] **Infinite scroll or load-more** -- scroll-triggered data loading

## Real-Time Features

- [ ] **WebSocket connections** -- `new WebSocket()`, socket.io, ws library
- [ ] **WebSocket message handlers** -- `onmessage`, `socket.on()` event listeners
- [ ] **Server-Sent Events (SSE)** -- `new EventSource()`, `text/event-stream`
- [ ] **Polling intervals** -- `setInterval` with fetch/API calls
- [ ] **Progress indicators** -- progress bars, spinners, percentage displays
- [ ] **Live update indicators** -- pulse dots, badges, "new" labels
- [ ] **Notification bells and dropdowns** -- real-time notification lists
- [ ] **Auto-save indicators** -- "Saving...", "Saved", draft status

## Authentication and Authorization

- [ ] **Login flow** -- email/password, magic link, SSO
- [ ] **Registration flow** -- sign up, email verification, onboarding
- [ ] **Logout flow** -- session cleanup, redirect to login
- [ ] **Password reset and change** -- forgot password, change password forms
- [ ] **Session expiry handling** -- auto-logout, refresh token, session warning
- [ ] **Role-based UI differences** -- admin panels, user-only features
- [ ] **API key management** -- create, view, revoke API keys
- [ ] **OAuth and social login** -- Google, GitHub, etc.
- [ ] **Two-factor authentication** -- TOTP setup, verification code entry

## Error States and Edge Cases

- [ ] **Network error handling** -- offline banner, timeout retry, connection lost
- [ ] **Validation error display** -- form field errors, inline validation messages
- [ ] **404 page** -- not found routes
- [ ] **403 page** -- forbidden/unauthorized access
- [ ] **500 page** -- server error fallback
- [ ] **Empty state pages** -- "No data yet", first-use experience
- [ ] **Rate limit handling** -- throttle messages, retry-after displays
- [ ] **Retry mechanisms** -- retry buttons, automatic retry with backoff
- [ ] **Concurrent edit conflicts** -- "Someone else modified this" warnings
- [ ] **Large data handling** -- loading skeletons, virtual scrolling

## Responsive and Accessibility

- [ ] **Mobile navigation** -- hamburger menu, bottom tabs, swipe gestures
- [ ] **Keyboard shortcuts** -- hotkeys, keyboard navigation, focus management
- [ ] **Skip navigation** -- skip-to-content links
- [ ] **Screen reader landmarks** -- ARIA roles, labels, live regions

## Framework-Specific Locations

### Vue.js
```
src/router/index.js          # Route definitions
src/views/                   # Page-level components
src/components/              # Reusable UI components
src/stores/                  # Pinia/Vuex state (reveals data flows)
src/composables/             # Shared logic (reveals patterns)
```

### React
```
src/App.jsx                  # Root routes
src/pages/ or src/routes/    # Page components
src/components/              # UI components
src/hooks/                   # Custom hooks (reveals data patterns)
src/context/                 # Context providers (reveals state)
```

### Next.js
```
app/                         # App router pages and layouts
pages/                       # Pages router (legacy)
components/                  # Shared components
middleware.ts                # Route middleware
```

### FastAPI (Backend)
```
routers/                     # API route modules
app.py or main.py            # Root app with route includes
schemas.py                   # Request/response models (reveals API shape)
middleware/                   # Auth, CORS, rate limiting
```

### Django (Backend)
```
urls.py                      # URL patterns
views.py                     # View functions/classes
forms.py                     # Form definitions
templates/                   # HTML templates
```

## Tips for Thorough Discovery

1. **Search for event listeners**: `addEventListener`, `@click`, `@change`, `@input`, `onClick`, `onChange`
2. **Search for fetch/axios calls**: Every API call implies a user-triggered action
3. **Search for state mutations**: `store.commit`, `setState`, `dispatch` -- reveals what changes
4. **Read the store/state files**: They reveal every data entity the UI manages
5. **Check CSS for hidden elements**: `.hidden`, `display: none`, `v-show`, `v-if` -- these are conditional UI states
6. **Look at the package.json**: Dependencies reveal features (chart libraries = charts, PDF libs = exports)
7. **Read error boundaries**: They reveal failure modes that need testing
8. **Check feature flags**: `if (feature.enabled)` patterns reveal features that may or may not be active
