# Simple Terminal Controls

Three small VS Code buttons for terminal work:

- `Run`: run the active editor file or selected Explorer file.
- `Stop`: restart the active terminal process, or create a fresh empty terminal if none exists.
- `CD`: change the terminal directory to the active file's folder or selected folder.

Run and CD are also available from editor and Explorer context menus. The extension intentionally does not include rerun, clear, cmd, package tree, install, or kill-port features.
Run does not change the terminal directory; use CD when you want to move the terminal first.
Run uses VS Code shell integration when available. Without shell integration, VS Code does not expose the terminal's typed input buffer, so Run sends the command directly without first clearing or interrupting the terminal.

## Running Files

Built-in run commands are single-file oriented and only use runtimes that are detected or configured, except JavaScript/TypeScript fallbacks noted below.

- JavaScript: Deno project, Bun project, then Node.
- TypeScript: Deno project, Bun project, local or PATH `tsx`, local or PATH `ts-node`, then native Node for `.ts`, `.mts`, and `.cts`.
- `.tsx`: Deno, Bun, `tsx`, or `ts-node`; native Node is not used because Node does not support `.tsx`.
- Other supported single-file runtimes: Python, Go, Java source files, Kotlin scripts, Lua, PHP, Perl, PowerShell, R, Ruby, shell scripts, Swift, Julia, and MATLAB/Octave when the matching runtime is found.

Runtime detection is lazy. Nothing is probed at startup; PATH lookups are cached, and project files such as `bun.lock`, `deno.json`, and local `node_modules/.bin` runners are checked on Run.

## Custom Commands

Set `simpleTerminalControls.runCommands` in user or workspace settings. Keys can be a basename, extension, `*.extension`, extension without the dot, VS Code language id, `folder`, or `default`.

```json
{
  "simpleTerminalControls.runCommands": {
    "vitest.config.ts": "vitest --config ${file}",
    ".ts": "tsx --env-file=.env ${file}",
    "py": "uv run ${file}",
    "folder": "npm test"
  }
}
```

Template variables:

- `${file}`, `${runFile}`, `${fileDirname}`, `${folder}`, `${workspaceFolder}`, `${relativeFile}`
- `${fileBasename}`, `${fileBasenameNoExtension}`, `${fileExtname}`
- Raw variants such as `${fileRaw}` are unquoted; non-raw path variables are shell-quoted.

`${file}` is always the full path. `${runFile}` is relative to the terminal's current directory when VS Code shell integration reports the cwd and the target is inside it; otherwise it is the full path. `${relativeFile}` is relative to the workspace folder, not the terminal's current directory.

## Settings

- `simpleTerminalControls.preferActiveTerminal`: use the active terminal when available. Default: `true`.
- `simpleTerminalControls.stopBehavior`: `restart`, `interrupt`, or `dispose`. Default: `restart`.
- `simpleTerminalControls.statusBarPriority`: status bar priority for the button group. Default: `10`; lower values place right-aligned items farther right.
- `simpleTerminalControls.colors`: status bar foreground colors for `run`, `stop`, and `cd`.
- `simpleTerminalControls.pathStyle`: `auto`, `native`, or `wsl`. Default: `auto`.
- `simpleTerminalControls.enableDefaultRunCommands`: enable built-in run defaults. Default: `true`.
- `simpleTerminalControls.autoDetectRuntimes`: enable lazy PATH runtime detection. Default: `true`.
- `simpleTerminalControls.terminalName`: dedicated terminal name. Default: `Simple Terminal Controls`.
- `simpleTerminalControls.tools`: override detected runtime commands or executable paths.

Example tool overrides:

```json
{
  "simpleTerminalControls.colors": {
    "run": "#00FF66",
    "stop": "#FF3B30",
    "cd": "#00D7FF"
  },
  "simpleTerminalControls.tools": {
    "tsx": "pnpm exec tsx",
    "python": "uv run python",
    "pwsh": "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
  }
}
```

## WSL

Remote WSL paths are already Linux paths and are left unchanged. In local Windows sessions, `pathStyle: auto` uses VS Code's detected terminal shell, shell-integration cwd, and WSL-like profiles to convert paths such as `C:\Users\me\project` to `/mnt/c/Users/me/project`.

If a terminal was launched as `cmd` or PowerShell and then entered WSL by running `wsl`, auto mode works when VS Code reports the live terminal shell as `wsl`. If VS Code still reports the original shell, run `Simple Terminal Controls: Set Terminal Path Mode` and choose `WSL` for that terminal. Choose `Auto` to return to normal detection.
