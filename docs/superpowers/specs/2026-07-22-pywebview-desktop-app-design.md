# Pomodoro Paper Workbench PyWebView Desktop App Design

## Summary

Add a Windows desktop host for the existing static Pomodoro Paper Workbench web application. The desktop version must open in its own application window, show no console window, stop all of its processes when the window closes, retain data across launches, and support a safe one-time migration of the user's existing Edge data.

The existing web application remains the product core. The desktop layer hosts the same HTML, CSS, and JavaScript rather than duplicating timer or task logic.

## Goals

- Launch from a Windows desktop shortcut like a normal application.
- Display the existing interface in a dedicated PyWebView window.
- Avoid a visible PowerShell, Command Prompt, or Python console window.
- Shut down the local HTTP server and Python process when the window closes.
- Persist desktop data across launches in a stable application data directory outside the Git repository.
- Export the existing Edge data and import it into the desktop version without losing records.
- Keep the Git working tree free of generated profiles, logs, user data, and Conda files.
- Leave room for later improvements such as a custom icon, tray support, notifications, autostart, packaging, and updates.

## Non-goals

- Producing a standalone installer or single executable in the first version.
- Synchronizing data through GitHub or a cloud service.
- Reading Edge's internal profile database directly.
- Permanently deleting the old `D:\to do` directory before migration and verification succeed.
- Rewriting the existing web interface or timer domain logic.

## Architecture

### Existing web application

The current `index.html`, styles, and JavaScript modules remain the source of truth. The desktop host serves these files over loopback HTTP because the application uses JavaScript modules and should not rely on `file://` behavior.

### Desktop host

Add a `desktop/` directory containing:

- `app.pyw`: the PyWebView entry point.
- `requirements.txt`: the desktop-only Python dependency declaration.
- supporting launcher documentation or configuration if required.

The host will:

1. Resolve the repository root relative to `app.pyw` rather than relying on the current working directory.
2. Verify that `index.html` exists before opening a window.
3. Start a loopback-only HTTP server on a fixed desktop origin, initially `http://127.0.0.1:4174`.
4. Open that URL in a PyWebView window with an application title and a practical default size.
5. Use a stable WebView storage path under `D:\DevTools\PomodoroLauncher\data` so local storage persists across launches and stays outside Git.
6. Stop the HTTP server in a `finally` path when the window closes or startup fails.
7. Prevent confusing duplicate launches by detecting a port conflict and presenting a native error message instead of showing a console traceback.

The fixed port provides a stable origin for browser storage. Port 4174 is separate from the existing Edge migration origin on port 4173, allowing both versions to be opened during migration.

### Python environment

Create a dedicated Conda environment named `pomodoro-app` under the existing Anaconda installation. Install PyWebView only in that environment. The desktop shortcut targets that environment's `pythonw.exe`, which avoids a console window and does not add dependencies to the Anaconda `base` environment.

### Desktop shortcut

Create a Windows shortcut named `番茄钟` on the user's desktop. It will:

- target `pythonw.exe` from the `pomodoro-app` environment;
- pass the repository's `desktop/app.pyw` as the script argument;
- use the repository as the working directory;
- use an existing system icon for the first version, with a custom project icon deferred to a later visual pass.

## Data persistence and migration

### Current storage

The web app currently stores its complete state in browser local storage under:

```text
pomodoro-paper-workbench-state
```

The user's existing records live in the Edge profile for the old `http://localhost:4173` origin. PyWebView uses a separate browser profile, so direct profile copying is intentionally avoided.

### Export and import feature

Add a small data-management section to the existing interface with:

- **Export data**: download a JSON backup containing a schema version, export timestamp, and application state.
- **Import data**: select a JSON backup, validate it, normalize the state through the existing domain normalization path, ask for confirmation, save it, and reload the interface.

Import must be fail-safe:

- reject invalid JSON and unsupported structures;
- impose a reasonable file-size limit;
- never overwrite current data until validation succeeds and the user confirms;
- show a clear success or error message;
- preserve a recoverable copy of the pre-import state during the current session.

Serialization and validation logic should live in a small pure JavaScript module so it can be unit-tested without browser APIs.

### Migration workflow

1. Serve the cloned repository at `http://localhost:4173` and open it in the user's existing Edge profile.
2. Confirm that the existing records appear.
3. Export a JSON backup and retain that file until the whole migration is complete.
4. Start the PyWebView desktop application.
5. Import the JSON backup.
6. Verify records, settings, timer behavior, and persistence after closing and reopening the desktop application.
7. Only after verification, move `D:\to do` to the Windows Recycle Bin rather than permanently deleting it.

Because the Edge data is tied to the origin rather than to the old source directory, serving the cloned repository on the same Edge origin is sufficient; the old directory is not required for future operation once migration succeeds.

## Error handling

- Missing repository files: show a native message naming the missing path and exit.
- Desktop port already in use: show a native message and exit without starting another instance.
- HTTP server startup failure: show a concise native error and clean up partial resources.
- PyWebView startup failure: stop the server and show an actionable error.
- Invalid import file: keep current state unchanged and show a user-facing validation error.
- Failed export: retain current state and show an error rather than claiming a backup exists.

Errors should be recorded in a small log file under `D:\DevTools\PomodoroLauncher\logs`, never inside the repository.

## Testing and acceptance criteria

### Automated tests

- Existing JavaScript tests continue to pass.
- Add unit tests for export serialization, schema handling, invalid JSON, invalid state structures, and successful import normalization.
- Add a lightweight Python test for repository path resolution and server lifecycle where practical without opening a GUI.

### Manual verification

- Launching the desktop shortcut opens one independent application window.
- No console window appears.
- The current web interface loads without module or asset errors.
- Timer controls and task editing work.
- Export from Edge produces a readable JSON backup.
- Import into PyWebView reproduces the expected records and settings.
- Closing and reopening the app retains imported and newly created data.
- Closing the window leaves no launcher HTTP server or Python process running.
- A second launch while the app is open gives a clear response and does not corrupt data.
- The Git working tree contains only intended source changes and no user data.

## Delivery sequence

1. Implement and test JSON export/import in the web application.
2. Add and test the PyWebView desktop host.
3. Create the dedicated Conda environment and install dependencies.
4. Create the desktop shortcut.
5. Export Edge data and import it into the desktop app.
6. Complete the manual acceptance checks.
7. Move `D:\to do` to the Recycle Bin only after the user confirms the migrated data is correct.

## Future extensions

- Custom Pomodoro icon and refined window chrome.
- System tray controls and background timer behavior.
- Native Windows notifications.
- Optional launch at sign-in.
- PyInstaller packaging and a repeatable release process.
- Explicit application-data backup and restore management.
