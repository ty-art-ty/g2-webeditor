package org.g2web.convert;

import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Minimal command-line entry point: convert one DX7 single-voice sysex (.syx)
 * into a Clavia G2 patch (.pch2).
 *
 * <pre>
 *   java org.g2web.convert.Dx2G2Cli voice.syx [out.pch2]
 * </pre>
 *
 * If the output path is omitted, the voice name (or the input base name) is used.
 */
public final class Dx2G2Cli {

    public static void main(String[] args) throws Exception {
        if (args.length < 1) {
            System.err.println("usage: Dx2G2Cli <voice.syx> [out.pch2]");
            System.exit(2);
        }
        Path in = Path.of(args[0]);
        byte[] raw = Files.readAllBytes(in);

        Dx7Voice voice = Dx7Voice.parse(raw);
        byte[] pch2 = Dx2G2.toPch2(voice);

        Path out = args.length >= 2
                ? Path.of(args[1])
                : in.resolveSibling(safeName(voice.name) + ".pch2");
        Files.write(out, pch2);

        System.out.printf("Converted \"%s\" (algorithm %d, feedback %d) -> %s (%d bytes)%n",
                voice.name, voice.algorithm + 1, voice.feedback, out, pch2.length);
    }

    private static String safeName(String name) {
        String s = (name == null ? "" : name).trim().replaceAll("[^A-Za-z0-9 ._-]", "_");
        return s.isBlank() ? "DX7 Voice" : s;
    }

    private Dx2G2Cli() {}
}
