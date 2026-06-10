plugins {
    java
    application
}

group = "org.g2web"
version = "0.1.0-SNAPSHOT"

repositories { mavenCentral() }

java {
    toolchain {
        // g2lib (g2fx) nutzt Sprachfeatures > 21; auf dem Zielgerät liegt OpenJDK 25 (apt).
        languageVersion = JavaLanguageVersion.of(25)
    }
}

application { mainClass = "org.g2web.Main" }

dependencies {
    implementation("io.javalin:javalin:6.6.0")
    implementation("org.slf4j:slf4j-simple:2.0.16")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.19.1")

    // g2lib (vendored aus sirlensalot/g2fx @ e75c6d0, BSD-3) — siehe docs/phase1-ergebnis.md
    implementation("org.usb4java:usb4java:1.3.0")
    implementation("org.usb4java:libusb4java:1.3.0:linux-aarch64")
    implementation("com.fasterxml.jackson.dataformat:jackson-dataformat-yaml:2.19.1")
    implementation("com.google.guava:guava:33.4.8-jre")

    testImplementation(platform("org.junit:junit-bom:5.10.0"))
    testImplementation("org.junit.jupiter:junit-jupiter")
}

tasks.test { useJUnitPlatform() }
