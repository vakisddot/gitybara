# C# support in the Files view

Gitybara manages a pinned Microsoft Roslyn language server for C# source in the
working repository. Opening a `.cs` file in **Files** starts it automatically.
The first use downloads the server from NuGet; later starts use the cached copy.
The .NET 10 SDK must be installed and `dotnet` must be on PATH. Gitybara does not
install or change global .NET tools.

- Semantic colors distinguish types, methods, variables, and control keywords.
- **F12** or **Ctrl-click** goes to a definition (**Cmd-click** on macOS).
- **Shift+F12** lists references. Click a result to open its source location.
- **Mouse4**, the **Back** button, or **Alt+Left** returns to the previous source
  location. **Mouse5**, **Forward**, or **Alt+Right** moves forward again.
  These actions restore the caret position. A new source jump clears the forward
  history. Mouse side buttons use Electron's native browser commands on Windows
  and Linux.

Roslyn analyzes unsaved editor text. Moving between files keeps those documents
in its workspace. Closing the Files view releases the server and its build hosts.
The existing basic colors remain available while it loads or if setup fails.
An error banner offers a retry.

This first integration supports source navigation inside the current repository.
Historical revisions, removed lines, and deleted files keep basic syntax colors.
Definitions from external assemblies and generated documents are not opened.
Roslyn automatically discovers a single solution at the repository root, or
projects when no solution is present. Repositories with multiple root solutions
will need solution selection in a later change.

## Implementation

`app/src/lib/csharp/runtime.ts` installs version `5.12.0-1.26475.2` into
`<Gitybara userData>/csharp/<version>`, using only the official NuGet source.
The version is upgraded with the application, rather than automatically changing
between runs. Cached support works without another download.

`client.ts` uses `vscode-jsonrpc` over stdio. It synchronizes documents, watches
C# and project files, and requests semantic tokens for the visible editor range.
Roslyn's range-only token capability avoids processing every line on each edit.
Requests time out and use LSP cancellation. Main-process IPC owns a workspace per
window and repository; renderers never choose an executable or launch command.

Semantic marks do not edit the document or enter its undo history. The editor
ignores responses for older text and removes marks as soon as the text changes.
CodeMirror and LSP positions both count UTF-16 code units from zero.

References:

- [Roslyn server documentation](https://github.com/dotnet/roslyn/blob/main/src/LanguageServer/roslyn-language-server/README.md)
- [Pinned NuGet package](https://www.nuget.org/packages/roslyn-language-server/5.12.0-1.26475.2)
- [Language Server Protocol](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/)
