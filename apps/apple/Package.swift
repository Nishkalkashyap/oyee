// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Herald",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [
        .library(name: "HeraldKit", targets: ["HeraldKit"]),
        .executable(name: "HeraldMac", targets: ["HeraldMac"]),
    ],
    targets: [
        .target(
            name: "HeraldKit",
            path: "Sources/HeraldKit"
        ),
        .executableTarget(
            name: "HeraldMac",
            dependencies: ["HeraldKit"],
            path: "Sources/HeraldMac"
        ),
        .testTarget(
            name: "HeraldKitTests",
            dependencies: ["HeraldKit"],
            path: "Tests/HeraldKitTests",
            resources: [.copy("Fixtures")]
        ),
    ]
    // swift-tools-version 6.0 ⇒ every target builds in the Swift 6 language mode (strict concurrency).
    // Don't add an explicit `swiftLanguageModes: [.v6]`: with the Command Line Tools' Swift Build backend it stops
    // the Swift Testing macro plugin from loading.
)
