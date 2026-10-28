// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Oyee",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [
        .library(name: "OyeeKit", targets: ["OyeeKit"]),
        .executable(name: "OyeeMac", targets: ["OyeeMac"]),
    ],
    targets: [
        .target(
            name: "OyeeKit",
            path: "Sources/OyeeKit"
        ),
        .executableTarget(
            name: "OyeeMac",
            dependencies: ["OyeeKit"],
            path: "Sources/OyeeMac"
        ),
        .testTarget(
            name: "OyeeKitTests",
            dependencies: ["OyeeKit"],
            path: "Tests/OyeeKitTests",
            resources: [.copy("Fixtures")]
        ),
    ]
    // swift-tools-version 6.0 ⇒ every target builds in the Swift 6 language mode (strict concurrency).
    // Don't add an explicit `swiftLanguageModes: [.v6]`: with the Command Line Tools' Swift Build backend it stops
    // the Swift Testing macro plugin from loading.
)
