#!/usr/bin/env python3
"""Generiert frontend/public/module-defs.json + module-icons/ aus einem g2fx-Checkout.

Quellen (g2fx @ e75c6d0, BSD-3):
  - g2lib ModuleType.java  -> ix (= Icon-Dateiname %03d.png), height, shortName
  - g2gui module-uis.yaml  -> Connector-Pixelpositionen (XPos/YPos, Modul = 255x15*height px)
  - g2gui module-icons/    -> Toolbar-Icons, kopiert nach frontend/public/module-icons/

Aufruf: python3 scripts/gen-module-defs.py /pfad/zu/g2fx
"""
import json
import re
import shutil
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
OUT_JSON = REPO / "frontend" / "public" / "module-defs.json"
OUT_ICONS = REPO / "frontend" / "public" / "module-icons"

# Wie Connectors.getConnColor in g2gui: Audio->rot, Control->blau, Logic->gelb
CONN_TYPES = {"Audio": "audio", "Control": "control", "Logic": "logic"}


def short_name(enum_name: str) -> str:
    # g2lib ModuleType.mkShortName: "M_" abschneiden, _ -> -, -and- -> &
    return enum_name[2:].replace("_", "-").replace("-and-", "&")


def parse_module_types(java: str) -> dict[str, dict]:
    """shortName -> {ix, height} aus den Enum-Konstanten M_Xxx(ix, "longName", height, ...)."""
    out = {}
    for m in re.finditer(
        r"^\s{4}(M_\w+)\s*\(\s*(\d+),\s*\"[^\"]*\",\s*(\d+),", java, re.MULTILINE
    ):
        out[short_name(m.group(1))] = {"ix": int(m.group(2)), "height": int(m.group(3))}
    return out


def conns(controls: list[dict], klass: str) -> list[dict]:
    """Inputs/Outputs aus den YAML-Controls, sortiert nach CodeRef (= conn-Index im Kabel)."""
    found = [c for c in controls if c.get("Class") == klass]
    found.sort(key=lambda c: c["CodeRef"])
    res = []
    for c in found:
        if c["CodeRef"] != len(res):
            raise SystemExit(f"CodeRef-Lücke in {klass}: {found}")
        res.append({"x": c["XPos"], "y": c["YPos"], "type": CONN_TYPES[c["Type"]]})
    return res


def main(g2fx: Path) -> None:
    java = (g2fx / "src/main/java/org/g2fx/g2lib/model/ModuleType.java").read_text()
    types = parse_module_types(java)
    uis = yaml.safe_load(
        (g2fx / "src/main/resources/org/g2fx/g2gui/module-uis.yaml").read_text()
    )

    defs, missing = {}, []
    for name, ui in uis.items():
        t = types.get(name)
        if t is None:
            missing.append(name)
            continue
        defs[name] = {
            "ix": t["ix"],
            "height": ui.get("Height", t["height"]),
            "inputs": conns(ui.get("Controls") or [], "Input"),
            "outputs": conns(ui.get("Controls") or [], "Output"),
        }
    if missing:
        raise SystemExit(f"YAML-Module ohne ModuleType: {missing}")
    only_java = sorted(set(types) - set(defs))
    if only_java:
        print(f"Hinweis: ModuleTypes ohne YAML-UI (ok, z.B. Keyboard): {only_java}")

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(defs, separators=(",", ":"), sort_keys=True) + "\n")
    print(f"{OUT_JSON.name}: {len(defs)} Module")

    src_icons = g2fx / "src/main/resources/org/g2fx/g2gui/module-icons"
    OUT_ICONS.mkdir(parents=True, exist_ok=True)
    n = 0
    for png in src_icons.glob("*.png"):
        shutil.copy2(png, OUT_ICONS / png.name)
        n += 1
    print(f"module-icons/: {n} Dateien")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]))
