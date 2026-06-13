package org.g2web.convert;

/**
 * Yamaha DX7 single voice, parsed from the public VCED ("voice edit buffer")
 * sysex format. Clean-room implementation from the documented DX7 MIDI
 * specification — no third-party converter code consulted.
 *
 * <p>Single-voice VCED sysex layout (163 bytes total):
 * <pre>
 *   F0 43 0n 00 01 1B  &lt;155 data bytes&gt;  &lt;checksum&gt;  F7
 * </pre>
 * The 155 data bytes hold six operators (21 bytes each, stored OP6..OP1 first)
 * followed by 29 global bytes and a 10-character voice name.
 *
 * <p>A bare 155-byte VCED payload (without the sysex wrapper) is also accepted.
 */
public final class Dx7Voice {

    /** Number of data bytes in a VCED single voice. */
    public static final int VCED_DATA = 155;
    private static final int OP_BYTES = 21;

    /** One DX7 operator. Field ranges follow the DX7 spec (mostly 0..99). */
    public static final class Operator {
        public int r1, r2, r3, r4;          // EG rates 0..99
        public int l1, l2, l3, l4;          // EG levels 0..99
        public int breakPoint;              // keyboard level scaling break point 0..99
        public int leftDepth, rightDepth;   // 0..99
        public int leftCurve, rightCurve;   // 0..3  (-LIN,-EXP,+EXP,+LIN)
        public int rateScale;               // keyboard rate scaling 0..7
        public int ampModSens;              // 0..3
        public int velSens;                 // key velocity sensitivity 0..7
        public int outputLevel;             // 0..99
        public int oscMode;                 // 0 ratio, 1 fixed
        public int freqCoarse;              // 0..31
        public int freqFine;                // 0..99
        public int detune;                  // 0..14 (7 = centre)
    }

    /** ops[0] = OP1 .. ops[5] = OP6. */
    public final Operator[] ops = new Operator[6];

    // Pitch EG
    public int pitchEgR1, pitchEgR2, pitchEgR3, pitchEgR4;
    public int pitchEgL1, pitchEgL2, pitchEgL3, pitchEgL4;

    public int algorithm;       // 0..31  (DX7 displays 1..32)
    public int feedback;        // 0..7
    public int oscKeySync;      // 0..1
    public int lfoSpeed;        // 0..99
    public int lfoDelay;        // 0..99
    public int lfoPitchModDepth;// 0..99
    public int lfoAmpModDepth;  // 0..99
    public int lfoKeySync;      // 0..1
    public int lfoWave;         // 0..5 (TRI,SAW-DOWN,SAW-UP,SQUARE,SINE,S/H)
    public int pitchModSens;    // 0..7
    public int transpose;       // 0..48 (24 = C3)
    public String name = "INIT VOICE";

    private Dx7Voice() {
        for (int i = 0; i < 6; i++) ops[i] = new Operator();
    }

    /**
     * Parse a single voice from raw bytes: either a full single-voice sysex
     * (starting with 0xF0) or a bare 155-byte VCED payload.
     */
    public static Dx7Voice parse(byte[] raw) {
        if (raw == null) throw new IllegalArgumentException("null input");
        byte[] data;
        if (raw.length > 0 && (raw[0] & 0xFF) == 0xF0) {
            data = unwrapSysex(raw);
        } else if (raw.length == VCED_DATA) {
            data = raw;
        } else {
            throw new IllegalArgumentException(
                    "Not a DX7 single-voice sysex and not a 155-byte VCED (len="
                            + raw.length + ")");
        }
        return fromVced(data);
    }

    private static byte[] unwrapSysex(byte[] s) {
        if (s.length < 6 + VCED_DATA + 2)
            throw new IllegalArgumentException("sysex too short: " + s.length);
        if ((s[1] & 0xFF) != 0x43)
            throw new IllegalArgumentException("not a Yamaha sysex (id=0x"
                    + Integer.toHexString(s[1] & 0xFF) + ")");
        int format = s[3] & 0xFF;       // 0 = single voice (VCED)
        if (format != 0)
            throw new IllegalArgumentException(
                    "not a single-voice dump (format=" + format
                            + "); bank dumps use format 9");
        int count = ((s[4] & 0x7F) << 7) | (s[5] & 0x7F);
        if (count != VCED_DATA)
            throw new IllegalArgumentException("unexpected byte count " + count);
        byte[] data = new byte[VCED_DATA];
        System.arraycopy(s, 6, data, 0, VCED_DATA);

        // Verify the running checksum if the terminating F7 is where we expect.
        int csIx = 6 + VCED_DATA;
        if (csIx < s.length && (s[s.length - 1] & 0xFF) == 0xF7) {
            int sum = 0;
            for (int i = 0; i < VCED_DATA; i++) sum += (data[i] & 0x7F);
            int expected = (128 - (sum & 0x7F)) & 0x7F;
            int actual = s[csIx] & 0x7F;
            if (expected != actual) {
                // Non-fatal: many real-world dumps carry imperfect checksums.
                System.err.println("Dx7Voice: checksum mismatch (expected "
                        + expected + ", got " + actual + ") — continuing");
            }
        }
        return data;
    }

    private static Dx7Voice fromVced(byte[] d) {
        Dx7Voice v = new Dx7Voice();
        // Operators stored OP6 first, OP1 last.
        for (int slot = 0; slot < 6; slot++) {
            int base = slot * OP_BYTES;
            Operator op = v.ops[5 - slot];   // slot 0 -> OP6 -> ops[5]
            op.r1 = u(d, base + 0);  op.r2 = u(d, base + 1);
            op.r3 = u(d, base + 2);  op.r4 = u(d, base + 3);
            op.l1 = u(d, base + 4);  op.l2 = u(d, base + 5);
            op.l3 = u(d, base + 6);  op.l4 = u(d, base + 7);
            op.breakPoint = u(d, base + 8);
            op.leftDepth  = u(d, base + 9);
            op.rightDepth = u(d, base + 10);
            op.leftCurve  = u(d, base + 11);
            op.rightCurve = u(d, base + 12);
            op.rateScale  = u(d, base + 13);
            op.ampModSens = u(d, base + 14);
            op.velSens    = u(d, base + 15);
            op.outputLevel= u(d, base + 16);
            op.oscMode    = u(d, base + 17);
            op.freqCoarse = u(d, base + 18);
            op.freqFine   = u(d, base + 19);
            op.detune     = u(d, base + 20);
        }
        v.pitchEgR1 = u(d, 126); v.pitchEgR2 = u(d, 127);
        v.pitchEgR3 = u(d, 128); v.pitchEgR4 = u(d, 129);
        v.pitchEgL1 = u(d, 130); v.pitchEgL2 = u(d, 131);
        v.pitchEgL3 = u(d, 132); v.pitchEgL4 = u(d, 133);
        v.algorithm        = u(d, 134);
        v.feedback         = u(d, 135);
        v.oscKeySync       = u(d, 136);
        v.lfoSpeed         = u(d, 137);
        v.lfoDelay         = u(d, 138);
        v.lfoPitchModDepth = u(d, 139);
        v.lfoAmpModDepth   = u(d, 140);
        v.lfoKeySync       = u(d, 141);
        v.lfoWave          = u(d, 142);
        v.pitchModSens     = u(d, 143);
        v.transpose        = u(d, 144);
        StringBuilder n = new StringBuilder(10);
        for (int i = 0; i < 10; i++) {
            int c = u(d, 145 + i);
            n.append(c >= 32 && c < 127 ? (char) c : ' ');
        }
        v.name = n.toString().trim();
        if (v.name.isEmpty()) v.name = "DX7 Voice";
        return v;
    }

    private static int u(byte[] d, int i) {
        return d[i] & 0xFF;
    }
}
