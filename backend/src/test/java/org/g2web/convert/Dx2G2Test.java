package org.g2web.convert;

import org.g2fx.g2lib.state.AreaId;
import org.g2fx.g2lib.state.Patch;
import org.g2fx.g2lib.state.PatchArea;
import org.g2fx.g2lib.state.Slot;
import org.g2fx.g2lib.usb.OfflineSender;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Round-trip verification for the DX7 -> G2 converter:
 * build a synthetic DX7 voice, convert to .pch2, then re-read the file with
 * g2lib and assert the structure and mapped parameter values survive.
 */
class Dx2G2Test {

    // module indices used by Dx2G2
    private static final int ROUTER = 1;
    private static final int OP1 = 2;

    /** Build a 155-byte VCED payload with distinctive, known values. */
    private static byte[] syntheticVced() {
        byte[] d = new byte[Dx7Voice.VCED_DATA];

        // Operators are stored OP6..OP1. OP1 lives in storage slot 5 (offset 5*21).
        int op1 = 5 * 21;
        d[op1 + 0]  = 50;   // R1
        d[op1 + 4]  = 80;   // L1
        d[op1 + 16] = 99;   // Output Level
        d[op1 + 17] = 1;    // Osc mode = fixed
        d[op1 + 18] = 2;    // Freq coarse
        d[op1 + 20] = 10;   // Detune

        // OP6 lives in storage slot 0.
        d[0 + 16] = 42;     // OP6 output level

        d[134] = 21;        // Algorithm (0-based) -> displays 22
        d[135] = 6;         // Feedback

        // name "TESTVOICE "
        String name = "TESTVOICE ";
        for (int i = 0; i < 10; i++) d[145 + i] = (byte) name.charAt(i);
        return d;
    }

    private static byte[] wrapSysex(byte[] vced) {
        byte[] s = new byte[6 + vced.length + 2];
        s[0] = (byte) 0xF0; s[1] = 0x43; s[2] = 0x00; s[3] = 0x00;
        s[4] = 0x01; s[5] = 0x1B;                       // 155
        System.arraycopy(vced, 0, s, 6, vced.length);
        int sum = 0;
        for (byte b : vced) sum += (b & 0x7F);
        s[6 + vced.length] = (byte) ((128 - (sum & 0x7F)) & 0x7F);
        s[s.length - 1] = (byte) 0xF7;
        return s;
    }

    @Test
    void parsesVoiceFields() {
        Dx7Voice v = Dx7Voice.parse(wrapSysex(syntheticVced()));
        assertEquals(21, v.algorithm);
        assertEquals(6, v.feedback);
        assertEquals("TESTVOICE", v.name);
        // ops[0] is OP1
        assertEquals(2, v.ops[0].freqCoarse);
        assertEquals(1, v.ops[0].oscMode);
        assertEquals(99, v.ops[0].outputLevel);
        assertEquals(50, v.ops[0].r1);
        // ops[5] is OP6
        assertEquals(42, v.ops[5].outputLevel);
    }

    @Test
    void roundTripsThroughPch2(@org.junit.jupiter.api.io.TempDir Path tmp) throws Exception {
        Dx7Voice v = Dx7Voice.parse(wrapSysex(syntheticVced()));
        byte[] pch2 = Dx2G2.toPch2(v);
        assertTrue(pch2.length > 80, "file should be larger than the header");

        Path f = tmp.resolve("test.pch2");
        Files.write(f, pch2);

        // g2lib must accept its own output (header + CRC validated inside)
        Patch p = Patch.readFromFile(Slot.A, f.toString(), new OfflineSender());
        PatchArea voice = p.getArea(AreaId.Voice);

        assertEquals(8, voice.getModules().size(), "router + 6 ops + out");

        // DXRouter: Algorithm=param0, Feedback=param1
        assertEquals(21, voice.getModule(ROUTER).getParamValueProperty(0, 0).get());
        assertEquals(6, voice.getModule(ROUTER).getParamValueProperty(0, 1).get());

        // Op1: FreqCoarse=param3, R1=param8, OutLevel=param22, RatioFixed=param2
        assertEquals(1, voice.getModule(OP1).getParamValueProperty(0, 2).get());
        assertEquals(2, voice.getModule(OP1).getParamValueProperty(0, 3).get());
        assertEquals(50, voice.getModule(OP1).getParamValueProperty(0, 8).get());
        assertEquals(99, voice.getModule(OP1).getParamValueProperty(0, 22).get());

        // cables: 6 op->router + 6 router->op + 2 main->out = 14
        assertEquals(14, voice.getCables().size());
    }
}
