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
    """shortName -> {ix, height, page} aus M_Xxx(ix, "longName", height, ModPage.Page.ix(n), ...)."""
    out = {}
    for m in re.finditer(
        r"^\s{4}(M_\w+)\s*\(\s*(\d+),\s*\"[^\"]*\",\s*(\d+),\s*ModPage\.(\w+)\.ix",
        java, re.MULTILINE,
    ):
        out[short_name(m.group(1))] = {
            "ix": int(m.group(2)), "height": int(m.group(3)), "page": m.group(4)}
    return out


def conns(controls: list[dict], klass: str) -> list[dict]:
    """Inputs/Outputs aus den YAML-Controls, sortiert nach CodeRef (= conn-Index im Kabel)."""
    found = [c for c in controls if c.get("Class") == klass]
    found.sort(key=lambda c: c["CodeRef"])
    res = []
    for c in found:
        if c["CodeRef"] != len(res):
            raise SystemExit(f"CodeRef-Lücke in {klass}: {found}")
        res.append({"x": c["XPos"], "y": c["YPos"], "type": CONN_TYPES[c["Type"]],
                    "name": c["Control"]})
    return res


def texts(c: dict) -> list[str]:
    """Kommaliste ('a,b,' hat trailing-Komma) -> Labels."""
    return [t for t in c.get("Text", "").split(",") if t != ""]


def control(c: dict) -> dict | None:
    """YAML-Control -> kompaktes JSON fürs Frontend (None = nicht exportieren)."""
    cl = c["Class"]
    out = {"cls": cl, "x": c["XPos"], "y": c["YPos"]}
    if "CodeRef" in c:
        out["p"] = c["CodeRef"]  # Param-Index (wie conn-Index bei Kabeln)
    match cl:
        case "Text":
            out["t"] = str(c["Text"])
        case "Line":
            out["len"] = c["Length"]
            out["vert"] = c["Orientation"] == "Vertical"
            out["thick"] = c["Weight"] == "Thick"
        case "Symbol":
            out["sym"] = c["Type"]
            out["w"], out["h"] = c["Width"], c["Height"]
        case "Bitmap":
            out["w"], out["h"] = c["Width"], c["Height"]
            if "ImageFile" in c:
                out["img"] = c["ImageFile"]
            else:
                out["t"] = str(c.get("CustomText") or c.get("Text") or "")
        case "Knob":
            out["kt"] = c["Type"]
        case "ButtonText" | "TextEdit":
            out["w"] = c["Width"]
            out["push"] = c["Type"] == "Push"
            if c.get("Images"):
                out["imgs"], out["iw"] = c["Images"], c.get("ImageWidth", 0)
            else:
                out["t"] = str(c.get("Text", ""))
        case "ButtonFlat":
            out["w"] = c["Width"]
            if c.get("Images"):
                out["imgs"], out["iw"] = c["Images"], c.get("ImageWidth", 0)
            else:
                out["ts"] = texts(c)
        case "ButtonRadio":
            out["n"] = c["ButtonCount"]
            out["bw"] = c["ButtonWidth"]
            out["vert"] = c["Orientation"] == "Vertical"
            if c.get("Images"):
                out["imgs"], out["iw"] = c["Images"], c.get("ImageWidth", 0)
            else:
                out["ts"] = texts(c)
        case "ButtonRadioEdit":
            out["cols"], out["rows"] = c["ButtonColumns"], c["ButtonRows"]
            out["ts"] = texts(c)
        case "ButtonIncDec":
            out["vert"] = c["Type"] == "Vertical"
        case "TextField":
            out["w"] = c["Width"]
            out["p"] = c["MasterRef"]
            # Param-Index als int, "S<n>" = Mode-Index n des Moduls (als String)
            out["deps"] = [d if d.startswith("S") else int(d)
                           for d in str(c.get("Dependencies", "")).split(",") if d != ""]
            out["tf"] = c["TextFunc"]
        case "PartSelector":
            out["mode"] = True  # CodeRef ist ein Mode-Index (type.modes), kein Param
            out["w"], out["h"] = c["Width"], c["Height"]
            out["imgs"], out["iw"] = c.get("Images", []), c.get("ImageWidth", 0)
        case "Led":
            # p = CodeRef (bei Gruppen: an wenn Gruppenwert == CodeRef),
            # g = GroupId = Visual-Index in g2lib (leds bzw. metersAndGroups)
            out["lt"] = c["Type"]
            out["g"] = c.get("GroupId", 0)
            if c.get("LedGroup") or c["Type"] == "Sequencer":
                out["grp"] = True
        case "MiniVU":
            out["vert"] = c["Orientation"] == "Vertical"
            out["g"] = c.get("GroupId", 0)
        case "LevelShift":
            pass  # nur cls/x/y/p
        case "Graph":
            out["w"], out["h"] = c["Width"], c["Height"]
            out["gf"] = c.get("GraphFunc", 0)
            # wie TextField: Param-Indizes positional, "S<n>" = Mode-Index
            out["deps"] = [d if d.startswith("S") else int(d)
                           for d in str(c.get("Dependencies", "")).split(",") if d != ""]
        case _:
            return None
    return out


# Konstanten-Tabellen aus g2lib ParamConstants.java für die TextFunc-Formatter
# im Frontend (NEGATIVE_INFINITY -> null, TS macht daraus -Infinity).
TABLES = ["LFO_CLOCK_VALS", "DELAY_VALS", "PULSE_DELAY_RANGE",
          "MIX_LEV_DB", "LEV_AMP_DB"]


def parse_tables(java: str) -> dict:
    out = {}
    for name in TABLES:
        m = re.search(name + r"\s*=\s*new\s+\w+\[\]\s*\{(.*?)};", java, re.DOTALL)
        if not m:
            raise SystemExit(f"Tabelle {name} nicht in ParamConstants.java gefunden")
        vals = []
        for tok in m.group(1).split(","):
            tok = tok.strip()
            if not tok:
                continue
            if tok == "Double.NEGATIVE_INFINITY":
                vals.append(None)
            elif tok.startswith('"'):
                vals.append(tok.strip('"'))
            else:
                vals.append(float(tok) if "." in tok else int(tok))
        out[name] = vals
    return out


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
        controls = ui.get("Controls") or []
        defs[name] = {
            "ix": t["ix"],
            "page": t["page"],
            "height": ui.get("Height", t["height"]),
            "inputs": conns(controls, "Input"),
            "outputs": conns(controls, "Output"),
            "controls": [j for c in controls
                         if c["Class"] not in ("Input", "Output")
                         and (j := control(c)) is not None],
        }
    if missing:
        raise SystemExit(f"YAML-Module ohne ModuleType: {missing}")
    only_java = sorted(set(types) - set(defs))
    if only_java:
        print(f"Hinweis: ModuleTypes ohne YAML-UI (ok, z.B. Keyboard): {only_java}")

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(defs, separators=(",", ":"), sort_keys=True) + "\n")
    print(f"{OUT_JSON.name}: {len(defs)} Module")

    tables = parse_tables(
        (g2fx / "src/main/java/org/g2fx/g2lib/model/ParamConstants.java").read_text())
    out_tables = OUT_JSON.parent / "param-tables.json"
    out_tables.write_text(json.dumps(tables, separators=(",", ":")) + "\n")
    print(f"{out_tables.name}: {', '.join(f'{k}[{len(v)}]' for k, v in tables.items())}")

    src_icons = g2fx / "src/main/resources/org/g2fx/g2gui/module-icons"
    OUT_ICONS.mkdir(parents=True, exist_ok=True)
    n = 0
    for png in src_icons.glob("*.png"):
        shutil.copy2(png, OUT_ICONS / png.name)
        n += 1
    print(f"module-icons/: {n} Dateien")

    # Control-Bilder (Bitmap/PartSelector/Button-Images) der Modulflächen
    src_imgs = g2fx / "src/main/resources/org/g2fx/g2gui/img"
    out_imgs = OUT_JSON.parent / "module-images"
    out_imgs.mkdir(parents=True, exist_ok=True)
    n = 0
    for png in src_imgs.glob("*.png"):
        shutil.copy2(png, out_imgs / png.name)
        n += 1
    print(f"module-images/: {n} Dateien")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]))
