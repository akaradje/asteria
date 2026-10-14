"""Create the desktop shortcut for the Asteria Farm control panel.

Uses the Windows Script Host COM object through pywin32, which resolves the real Desktop
folder (including a redirected OneDrive Desktop) and writes a proper .lnk with a custom
icon.

    <managed python> scripts/make_shortcut.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# Defaults keep the original one-shortcut behaviour; --target/--name let this make a second
# shortcut for the six-window launcher without a second copy of the script.
_argv = {}
for _a in sys.argv[1:]:
    if _a.startswith("--") and "=" in _a:
        _k, _v = _a[2:].split("=", 1)
        _argv[_k] = _v

TARGET = _argv.get("target") or os.path.join(ROOT, "Asteria Farm.cmd")
ICON = _argv.get("icon") or os.path.join(ROOT, "assets", "asteria-farm.ico")
NAME = _argv.get("name") or "Asteria Farm"
DESC = _argv.get("desc") or "Asteria Farm - control panel for the multi-window auto-player"


def main():
    if not os.path.exists(TARGET):
        print("ERROR: launcher not found:", TARGET)
        return 1
    if not os.path.exists(ICON):
        print("WARNING: icon not found, the shortcut will use the default one:", ICON)

    import win32com.client

    shell = win32com.client.Dispatch("WScript.Shell")
    desktop = shell.SpecialFolders("Desktop")
    link_path = os.path.join(desktop, NAME + ".lnk")

    link = shell.CreateShortCut(link_path)
    link.TargetPath = TARGET
    link.WorkingDirectory = ROOT
    link.Description = DESC
    if os.path.exists(ICON):
        link.IconLocation = ICON + ",0"
    link.WindowStyle = 1
    link.Save()

    print("desktop :", desktop)
    print("shortcut:", link_path)
    print("target  :", TARGET)
    print("icon    :", ICON)
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
