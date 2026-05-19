const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const projectRoot = path.resolve(__dirname, "..");
const srcSvgPath = path.join(projectRoot, "gui", "myminifactory_downloader_icon.svg");
const buildDir = path.join(projectRoot, "build");
const outSvgPath = path.join(buildDir, "icon.svg");
const outPngPath = path.join(buildDir, "icon.png");
const outIcoPath = path.join(buildDir, "icon.ico");
const outIcnsPath = path.join(buildDir, "icon.icns");
const tempDir = path.join(buildDir, ".icon-tmp");

async function main() {
    const [{ default: pngToIco }, { Icns, IcnsImage }] = await Promise.all([
        import("png-to-ico"),
        import("@fiahfy/icns")
    ]);

    if (!fs.existsSync(srcSvgPath)) {
        throw new Error(`Source SVG not found: ${srcSvgPath}`);
    }

    fs.mkdirSync(buildDir, { recursive: true });

    const originalSvg = fs.readFileSync(srcSvgPath, "utf8");
    const normalizedSvg = originalSvg
        .replace(/<svg\s+([^>]*?)width="100%"([^>]*)>/i, '<svg $1width="680" height="680"$2>')
        .replace(/<svg\s+([^>]*?)height="100%"([^>]*)>/i, '<svg $1height="680"$2>');

    fs.writeFileSync(outSvgPath, normalizedSvg, "utf8");

    await sharp(Buffer.from(normalizedSvg), { density: 1024 })
        .resize(1024, 1024, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(outPngPath);

    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });

    const icoSizes = [16, 24, 32, 48, 64, 128, 256];
    const icnsTypesBySize = new Map([
        [16, "icp4"],
        [32, "icp5"],
        [64, "icp6"],
        [128, "ic07"],
        [256, "ic08"],
        [512, "ic09"],
        [1024, "ic10"]
    ]);

    const allSizes = Array.from(new Set([...icoSizes, ...icnsTypesBySize.keys()]));
    const generatedPngBySize = new Map();

    for (const size of allSizes) {
        const tempPath = path.join(tempDir, `${size}.png`);
        await sharp(outPngPath)
            .resize(size, size)
            .png()
            .toFile(tempPath);
        generatedPngBySize.set(size, tempPath);
    }

    const icoBuffer = await pngToIco(icoSizes.map((size) => generatedPngBySize.get(size)));
    fs.writeFileSync(outIcoPath, icoBuffer);

    const icns = new Icns();
    for (const [size, osType] of icnsTypesBySize.entries()) {
        const pngBuffer = fs.readFileSync(generatedPngBySize.get(size));
        icns.append(IcnsImage.fromPNG(pngBuffer, osType));
    }
    fs.writeFileSync(outIcnsPath, icns.data);

    fs.rmSync(tempDir, { recursive: true, force: true });

    console.log(`Generated: ${outPngPath}`);
    console.log(`Generated: ${outIcoPath}`);
    console.log(`Generated: ${outIcnsPath}`);
    console.log(`Copied SVG: ${outSvgPath}`);
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});
