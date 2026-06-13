package org.g2web.convert;

import org.g2fx.g2gui.module.ModuleDelta;
import org.g2fx.g2lib.model.ModuleType;
import org.g2fx.g2lib.model.NamedParam;
import org.g2fx.g2lib.protocol.FieldValues;
import org.g2fx.g2lib.protocol.Protocol;
import org.g2fx.g2lib.state.AreaId;
import org.g2fx.g2lib.state.Coords;
import org.g2fx.g2lib.state.ParamValues;
import org.g2fx.g2lib.state.Patch;
import org.g2fx.g2lib.state.PatchArea;
import org.g2fx.g2lib.state.PatchModule;
import org.g2fx.g2lib.state.Slot;
import org.g2fx.g2lib.usb.OfflineSender;
import org.g2fx.g2lib.usb.UsbSender;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Converts a {@link Dx7Voice} into a Clavia Nord Modular G2 patch (.pch2),
 * built offline through the g2lib model API.
 *
 * <p>Clean-room: the mapping is derived from the public DX7 specification and
 * the G2 module definitions in g2lib ({@code M_Operator}, {@code M_DXRouter}),
 * which Clavia designed as a DX7 emulation (6 operators, 32 algorithms). No
 * third-party converter source was consulted.
 *
 * <p>Topology (algorithm-independent — the DXRouter performs the per-algorithm
 * routing internally from its Algorithm parameter):
 * <pre>
 *   Operator k .Out  --> DXRouter.In(k)      (k = 0..5)
 *   DXRouter.Out(k)  --> Operator k .FM       (k = 0..5)
 *   DXRouter.Main    --> 2-Out .InL, .InR
 * </pre>
 *
 * <p>First-cut scope (single voice): operators, per-operator DX envelope,
 * frequency/level/scaling, algorithm and feedback. LFO, pitch-EG and transpose
 * are not yet modelled (see TODOs) — operators self-gate via the Operator's
 * {@code EnvKB} parameter (default on).
 */
public final class Dx2G2 {

    /** G2 patch file format version byte (Header says "Version=23"). */
    public static final int VERSION = 23;
    private static final int RED = 0;           // audio cable colour

    // ---- module indices in the voice area ----
    private static final int ROUTER = 1;
    private static final int OP_BASE = 2;       // operator k -> OP_BASE + k
    private static final int OUT = 8;

    // ---- DXRouter connectors ----
    private static final int ROUTER_MAIN_OUT = 6;

    // ---- Operator connectors ----
    private static final int OP_OUT = 0;
    private static final int OP_FM_IN = 1;

    // ---- 2-Out connectors ----
    private static final int OUT_L = 0;
    private static final int OUT_R = 1;

    static {
        // g2lib's Protocol has interdependent static initializers: ModuleParams
        // and ModuleParamSet reference each other's FIELDS. Building a patch
        // offline first touches VarParams (via initNew -> default params), which
        // enters that cycle from the wrong end and throws ExceptionInInitializer.
        // The normal device/file path initializes Sections first, forcing the
        // canonical parent-before-leaf order. Reproduce that order here, once.
        if (Protocol.ModuleParams.FIELDS == null
                || org.g2fx.g2lib.protocol.Sections.FILE_SECTIONS == null) {
            throw new IllegalStateException("g2lib Protocol warmup failed");
        }
    }

    private Dx2G2() {}

    /** Build a G2 patch for the given voice in slot A. */
    public static Patch buildPatch(Dx7Voice v) {
        return buildPatch(v, Slot.A);
    }

    public static Patch buildPatch(Dx7Voice v, Slot slot) {
        UsbSender sender = new OfflineSender();
        Patch patch = new Patch(slot, sender);
        patch.setVersion(VERSION);
        patch.initNew();
        patch.name().set(v.name);

        PatchArea voice = patch.getArea(AreaId.Voice);

        // --- collect module definitions ---
        List<FieldValues> moduleDatas = new ArrayList<>();
        // names to apply once the modules exist in the area
        Map<Integer, String> names = new LinkedHashMap<>();

        moduleDatas.add(moduleData(ModuleType.M_DXRouter, ROUTER, "DX Router",
                new Coords(12, 0)));
        names.put(ROUTER, "DX Router");

        for (int k = 0; k < 6; k++) {
            int idx = OP_BASE + k;
            String nm = "Op" + (k + 1);
            moduleDatas.add(moduleData(ModuleType.M_Operator, idx, nm,
                    new Coords(0, k * 12)));
            names.put(idx, nm);
        }

        moduleDatas.add(moduleData(ModuleType.M_2_Out, OUT, "Out",
                new Coords(12, 8)));
        names.put(OUT, "Out");

        voice.addModules(Protocol.ModuleList.FIELDS.values(
                Protocol.ModuleList.ModuleCount.value(moduleDatas.size()),
                Protocol.ModuleList.Modules.value(moduleDatas)));



        // --- parameters ---
        setParams(voice, ROUTER, ModuleType.M_DXRouter, routerOverrides(v));
        for (int k = 0; k < 6; k++) {
            setParams(voice, OP_BASE + k, ModuleType.M_Operator,
                    operatorOverrides(v.ops[k]));
        }
        setParams(voice, OUT, ModuleType.M_2_Out, Map.of());

        // --- names (the ModuleNames section reads EVERY module's name → name
        //     each actual module, not just the indices we expect) ---
        for (PatchModule m : voice.getModules()) {
            int idx = m.getIndex();
            m.setModuleName(Protocol.ModuleName.FIELDS.values(
                    Protocol.ModuleName.ModuleIndex.value(idx),
                    Protocol.ModuleName.Name.value(names.getOrDefault(idx, "Mod" + idx))));
        }

        // --- cables ---
        for (int k = 0; k < 6; k++) {
            int op = OP_BASE + k;
            // operator output -> router input k
            voice.addCable(cable(RED, op, OP_OUT, ROUTER, k));
            // router output k -> operator FM input
            voice.addCable(cable(RED, ROUTER, k, op, OP_FM_IN));
        }
        // router main -> stereo out (mono, both channels)
        voice.addCable(cable(RED, ROUTER, ROUTER_MAIN_OUT, OUT, OUT_L));
        voice.addCable(cable(RED, ROUTER, ROUTER_MAIN_OUT, OUT, OUT_R));

        // snapshot the live model into the section map so writeFile() works offline
        patch.snapshotSections(PatchModule.FILE_VARIATIONS);
        return patch;
    }

    /** Convert a voice straight to .pch2 bytes. */
    public static byte[] toPch2(Dx7Voice v) throws Exception {
        ByteBuffer buf = buildPatch(v).writeFile();
        buf.rewind();
        byte[] out = new byte[buf.limit()];
        buf.get(out);
        return out;
    }

    // ------------------------------------------------------------------ mapping

    private static Map<Integer, Integer> routerOverrides(Dx7Voice v) {
        Map<Integer, Integer> m = new LinkedHashMap<>();
        m.put(0, clamp(v.algorithm, 0, 31));   // Algorithm
        m.put(1, clamp(v.feedback, 0, 7));      // Feedback
        return m;
    }

    private static Map<Integer, Integer> operatorOverrides(Dx7Voice.Operator op) {
        Map<Integer, Integer> m = new LinkedHashMap<>();
        m.put(2, clamp(op.oscMode, 0, 1));        // RatioFixed
        m.put(3, clamp(op.freqCoarse, 0, 31));    // FreqCoarse
        m.put(4, clamp(op.freqFine, 0, 99));      // FreqFine
        m.put(5, clamp(op.detune, 0, 14));        // FreqDetune
        m.put(6, clamp(op.velSens, 0, 7));        // Vel
        m.put(7, clamp(op.rateScale, 0, 7));      // RateScale
        m.put(8, clamp(op.r1, 0, 99));            // R1
        m.put(9, clamp(op.l1, 0, 99));            // L1
        m.put(10, clamp(op.r2, 0, 99));           // R2
        m.put(11, clamp(op.l2, 0, 99));           // L2
        m.put(12, clamp(op.r3, 0, 99));           // R3
        m.put(13, clamp(op.l3, 0, 99));           // L3
        m.put(14, clamp(op.r4, 0, 99));           // R4
        m.put(15, clamp(op.l4, 0, 99));           // L4
        m.put(16, clamp(op.ampModSens, 0, 7));    // AMod
        m.put(17, clamp(op.breakPoint, 0, 99));   // BrPoint
        m.put(18, clamp(op.leftCurve, 0, 3));     // LDepthMode
        m.put(19, clamp(op.leftDepth, 0, 99));    // LDepth
        m.put(20, clamp(op.rightCurve, 0, 3));    // RDepthMode
        m.put(21, clamp(op.rightDepth, 0, 99));   // RDepth
        m.put(22, clamp(op.outputLevel, 0, 99));  // OutLevel
        return m;
        // left at module defaults: Kbt(0), Sync(1), Active(23), EnvKB(24)
    }

    // ------------------------------------------------------------------ helpers

    private static FieldValues moduleData(ModuleType type, int index, String name,
                                          Coords coords) {
        return ModuleDelta.addNewModule(AreaId.Voice, type, index, name, 0, coords)
                .records().get(0).moduleData();
    }

    /**
     * Seed a module's params from type defaults, apply DX overrides, and write
     * all file variations identically (no listeners fire — pure model setup).
     */
    private static void setParams(PatchArea area, int index, ModuleType type,
                                  Map<Integer, Integer> overrides) {
        List<NamedParam> params = type.getParams();
        List<Integer> values = new ArrayList<>(params.size());
        for (NamedParam p : params) values.add(p.def());
        overrides.forEach(values::set);

        List<FieldValues> varParams = new ArrayList<>(PatchModule.FILE_VARIATIONS);
        for (int var = 0; var < PatchModule.FILE_VARIATIONS; var++) {
            varParams.add(ParamValues.mkDefaultParams(values, var));
        }
        area.getModule(index).setParamValues(varParams);
    }

    private static FieldValues cable(int color, int srcMod, int srcConn,
                                     int dstMod, int dstConn) {
        return Protocol.Cable.FIELDS.values(
                Protocol.Cable.Color.value(color),
                Protocol.Cable.SrcModule.value(srcMod),
                Protocol.Cable.SrcConn.value(srcConn),
                Protocol.Cable.Direction.value(true),   // src is an output
                Protocol.Cable.DestModule.value(dstMod),
                Protocol.Cable.DestConn.value(dstConn));
    }

    private static int clamp(int v, int lo, int hi) {
        return v < lo ? lo : Math.min(v, hi);
    }
}
