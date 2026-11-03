# GLKVM KVMD

> **Fork summary — iPhone Duo foldable laptop mode.** This fork adds a
> split keyboard + touchpad for the GLKVM web UI on foldable phones
> (built for the iPhone Duo inner display in portrait, half-folded):
> the remote screen stays in the top half and a touch panel fills the
> bottom half, with a toolbar toggle between a 91-key keyboard (sticky
> modifiers, Fn/Nav rows, no native keyboard) and a full-panel
> trackpad (drag to move via an absolute virtual cursor, tap to
> click, two-finger scroll, Left/Right click buttons).
>
> The current, device-verified patch is the **same-page SPA patch**:
> it injects into the GLKVM SPA the device actually serves
> (`/usr/share/kvmd/glweb/`, whose source is not public) without
> modifying the SPA bundle — see the
> [`glweb-fold-2.3` release](https://github.com/gh-htmd/glkvm/releases/tag/glweb-fold-2.3)
> for the installer and install steps. Earlier patch lines (the legacy
> PiKVM-UI patch and the standalone-page patch) are superseded and
> their releases have been removed; this branch
> (`feature/iphone-duo-split-keyboard`) holds the work. A firmware
> upgrade may wipe the installed patch files — just re-run the
> release installer to restore them.

GLKVM KVMD is a derivative project based on the open-source [PiKVM](https://github.com/pikvm/pikvm). We would like to express our sincere gratitude to the PiKVM team for their outstanding contributions to the open-source community.

## License

GLKVM KVMD is released under the [GPL V3](https://github.com/gl-inet/glkvm/blob/main/LICENSE) license. As a derivative project of PiKVM, we are committed to complying with all terms of the GPL V3 license.

## About KVMD

KVMD is the core daemon of GLKVM/PiKVM. This repository contains the configuration and code of KVMD. If you have any questions not directly related to this codebase, please submit them to the [GLKVM](https://github.com/gl-inet/glkvm/issues) repository.

## Firmware Download

If you want to download the latest or previous firmware, please visit: https://dl.gl-inet.com/kvm/rm1/stable

## Synchronize kvmd changes to the device

When you modify the contents of the kvmd folder and want to synchronize it to the kvm device, you can do so by executing the **apply_to_glkvm.sh** script (note: it needs to be in the same LAN as the kvm device). After execution, you need to restart the kvm device.
