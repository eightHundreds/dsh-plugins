# @dsk/bash-rtk

RTK-aware sandbox bash provider for **unmodified official DSH**, using its public SDK. No DSH core patch, Desktop rebuild or custom runtime is required. See [中文说明](<./README.zh.md>) and [provenance](<./UPSTREAM.md>).

## Compatibility and implementation

Targets the published DSH `0.2.0-rc.2` SDK, Cordis `4.0.4`, and Node 24. Other SDK versions need revalidation; peer dependencies deliberately pin the tested shell and sandbox executor contract.

`RtkBashExecutor` extends the official `SandboxBashExecutor`. Its prototype `resolve()` first calls `super.resolve()` for defaults, caps and caller-specific sandbox policy, then changes only the command text. It inherits `execute()` unchanged: the official code still owns confinement, subprocesses, output, cancellation and background handles. No service monkey-patching, private accessors, tool-argument mutation or unpublished transform API is used.

This plugin **provides `ctx.shell`**, so another shell provider cannot be enabled in the same service scope. It is bash-only, not a PowerShell replacement. Required services are `subprocess`, `sandbox`, and `sandboxPolicy`.

## Behavior

`git status` becomes `rtk git status`. Pipelines, lists, redirections, substitutions, newlines and parentheses pass through. Executable names are case-sensitive. RTK absence falls back to plain commands, still through the official sandbox executor.

The fixed routing map is in [wrap.ts](<./src/wrap.ts>); it is not discovered from RTK at runtime. The guard is conservative character checking, not a shell parser. RTK can change command options, output and exit codes; semantic equivalence is not guaranteed.

## Install and enable

Install this repository's Release tarball; RTK must already be on the host PATH. The bundle patch (`cordis.patch.yml`) **automatically disables the official `bash-sandbox` and enables `bash-rtk`** upon installation via DSH plugin manager:

```yaml
- id: bash-sandbox
  disabled: true
- insert:
    - id: bash-rtk
      name: '@dsk/bash-rtk'
      disabled: false
      config:
        probeTimeoutMs: 2000
```

Also disable `bash-local` or any other shell provider if manually enabled in that scope. **Keep the sandbox backend, sandbox-policy and subprocess providers enabled.** Disabling the `bash-sandbox` shell row does not disable confinement: RTK inherits its implementation. Copy any custom executor settings onto the RTK row. When uninstalling RTK, DSH removes the patch and the official `bash-sandbox` can be re-enabled.

No installed application or profile is changed by building this repository. Apply profile changes explicitly through your normal DSH plugin configuration workflow; do not install the abandoned core-transform candidate.

## Configuration

Inherits official live settings: `cwd`, `timeoutMs`, `maxTimeoutMs`, `maxOutputBytes`, `maxSpillBytes`, `graceMs`.

- `rtkAvailable`: optional availability override. `true` skips probing but does not install RTK.
- `probeTimeoutMs`: positive safe integer within the Node timer range; default `2000`. Bounds the activation-time `rtk --version` probe.

The probe runs once per activation, not per command, and only checks `--version`, not routed subcommands. It checks the host PATH; a per-command PATH override can still make RTK unavailable. Execution failures are not retried or downgraded to unsandboxed execution. Reactivate after installing/updating RTK. Version 0.2 no longer supports the abandoned `order`/core-transform configuration.

## Development

All checks use published SDK packages, including executor/sandbox tests. No sibling core checkout is needed:

```sh
pnpm install
pnpm --filter @dsk/bash-rtk check
pnpm pack:all
```

MIT.
